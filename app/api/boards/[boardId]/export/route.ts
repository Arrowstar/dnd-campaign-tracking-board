import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { buildExportPayload, MAX_EXPORT_BYTES, BoardRowForExport } from '@/lib/exportImport';

export const runtime = 'nodejs';

/**
 * DM-only full-board export. Returns the unscrubbed server state (tabs,
 * items, connections, annotations, settings, member meta) as a JSON file
 * download. Players get 403 — a player export would either leak DM content
 * or produce an unusable partial board.
 */
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

    const rows = await sql`
      SELECT id, members, tabs, settings FROM boards WHERE id = ${boardId} LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Board not found.' }, { status: 404 });
    }

    const board = rows[0];
    const member = board.members?.[user.id];
    if (!member) {
      return NextResponse.json({ error: 'You are not a member of this board.' }, { status: 403 });
    }
    if (member.role !== 'dm') {
      return NextResponse.json(
        { error: 'Only the Dungeon Master can export this board.' },
        { status: 403 }
      );
    }

    const payload = buildExportPayload(board as unknown as BoardRowForExport);
    const json = JSON.stringify(payload, null, 2);
    const bytes = Buffer.byteLength(json, 'utf8');
    if (bytes > MAX_EXPORT_BYTES) {
      return NextResponse.json(
        {
          error: `Board is too large to export (${(bytes / (1024 * 1024)).toFixed(1)} MB). Maximum export size is ${Math.round(MAX_EXPORT_BYTES / (1024 * 1024))} MB.`,
        },
        { status: 400 }
      );
    }

    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${boardId}-${date}.json"`,
      },
    });
  } catch (err) {
    console.error('Export board error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
