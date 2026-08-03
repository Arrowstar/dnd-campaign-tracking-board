import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser, generateToken } from '@/lib/auth';
import {
  validateCreatePayload,
  underShareCap,
  expiryForDays,
  MAX_SHARE_LINKS,
} from '@/lib/shareTokens';

export const runtime = 'nodejs';

/** DM-only: list active share links for the board. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { boardId } = await params;
    await ensureSchema();
    const sql = getSql();

    const boardRows = await sql`SELECT members FROM boards WHERE id = ${boardId} LIMIT 1`;
    if (boardRows.length === 0) {
      return NextResponse.json({ error: 'Board not found.' }, { status: 404 });
    }
    if (boardRows[0].members?.[user.id]?.role !== 'dm') {
      return NextResponse.json({ error: 'Only the Dungeon Master can manage share links.' }, { status: 403 });
    }

    const rows = await sql`
      SELECT token, label, created_at AS "createdAt", expires_at AS "expiresAt"
      FROM board_shares WHERE board_id = ${boardId}
      ORDER BY created_at DESC
    `;

    return NextResponse.json({ shares: rows });
  } catch (err) {
    console.error('List share links error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

/** DM-only: create a share link (label + optional expiry), capped at 20 active. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { boardId } = await params;
    await ensureSchema();
    const sql = getSql();

    const boardRows = await sql`SELECT members FROM boards WHERE id = ${boardId} LIMIT 1`;
    if (boardRows.length === 0) {
      return NextResponse.json({ error: 'Board not found.' }, { status: 404 });
    }
    if (boardRows[0].members?.[user.id]?.role !== 'dm') {
      return NextResponse.json({ error: 'Only the Dungeon Master can manage share links.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = validateCreatePayload(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const countRows = await sql`SELECT COUNT(*)::int AS count FROM board_shares WHERE board_id = ${boardId}`;
    const count = countRows[0]?.count ?? 0;
    if (!underShareCap(count)) {
      return NextResponse.json(
        { error: `You've reached the limit of ${MAX_SHARE_LINKS} active share links. Revoke one before creating another.` },
        { status: 400 }
      );
    }

    const token = generateToken();
    const expiresAt = expiryForDays(parsed.expiresInDays);
    await sql`
      INSERT INTO board_shares (token, board_id, label, created_by, expires_at)
      VALUES (${token}, ${boardId}, ${parsed.label}, ${user.id}, ${expiresAt})
    `;

    return NextResponse.json({
      token,
      label: parsed.label,
      // Path only — the client builds the full URL from window.location.origin
      // so it works in dev and prod. (No APP_URL env exists in this app.)
      path: `/board/${boardId}/view/${token}`,
      expiresAt,
    });
  } catch (err) {
    console.error('Create share link error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
