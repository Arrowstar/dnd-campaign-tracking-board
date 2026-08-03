import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser, hashPassword } from '@/lib/auth';
import {
  validateImportPayload,
  buildImportRow,
  validateBoardId,
  MAX_IMPORT_BYTES,
} from '@/lib/exportImport';

export const runtime = 'nodejs';

/**
 * Import an exported board file as a NEW board owned by the importer (role
 * dm). Merging into an existing board is explicitly out of scope.
 *
 * Body = the export file payload, optionally plus top-level `newBoardId` and
 * `boardPassword` fields. All item ids are remapped (uuidv4) so the new board
 * can coexist with the source board on the same host. Memberships from the
 * file are ignored — the new board has exactly one member (the importer).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Read the body as text so we can enforce the size cap before parsing.
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) {
      return NextResponse.json(
        {
          error: `Import file is too large (${(Buffer.byteLength(text, 'utf8') / (1024 * 1024)).toFixed(1)} MB). Maximum import size is ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))} MB.`,
        },
        { status: 413 }
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Import file is not valid JSON.' }, { status: 400 });
    }

    const result = validateImportPayload(raw);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const payload = result.payload;

    // New board id: prefer an explicit one from the client; fall back to the
    // source board's id (which will 409 below if that board still exists —
    // importing the same file twice must create two distinct boards).
    const body = raw as Record<string, unknown>;
    const requestedId =
      typeof body.newBoardId === 'string' && body.newBoardId.trim()
        ? body.newBoardId
        : payload.board.id;
    const cleanId = validateBoardId(requestedId);
    if (!cleanId) {
      return NextResponse.json(
        { error: 'Board ID must be 2–48 lowercase letters, numbers, or hyphens.' },
        { status: 400 }
      );
    }

    await ensureSchema();
    const sql = getSql();

    const existing = await sql`SELECT id FROM boards WHERE id = ${cleanId} LIMIT 1`;
    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'A board with that ID already exists. Choose a different board ID.' },
        { status: 409 }
      );
    }

    let boardPasswordHash: string | null = null;
    let boardPasswordSalt: string | null = null;
    const requestedPassword =
      typeof body.boardPassword === 'string' ? body.boardPassword : '';
    if (requestedPassword && requestedPassword.trim()) {
      const bPass = await hashPassword(requestedPassword);
      boardPasswordHash = bPass.hash;
      boardPasswordSalt = bPass.salt;
    }

    const row = buildImportRow(
      payload,
      { id: user.id, displayName: user.displayName },
      cleanId,
      boardPasswordHash ? { hash: boardPasswordHash, salt: boardPasswordSalt! } : null
    );

    await sql`
      INSERT INTO boards (id, board_password_hash, board_password_salt, members, tabs, settings)
      VALUES (
        ${row.id},
        ${row.board_password_hash},
        ${row.board_password_salt},
        ${JSON.stringify(row.members)}::jsonb,
        ${JSON.stringify(row.tabs)}::jsonb,
        ${JSON.stringify(row.settings)}::jsonb
      )
    `;

    return NextResponse.json({ success: true, boardId: cleanId, role: 'dm' });
  } catch (err) {
    console.error('Import board error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
