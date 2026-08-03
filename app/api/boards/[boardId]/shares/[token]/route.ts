import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

export const runtime = 'nodejs';

/** DM-only: revoke a single share link on this board. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; token: string }> }
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { boardId, token } = await params;
    await ensureSchema();
    const sql = getSql();

    const boardRows = await sql`SELECT members FROM boards WHERE id = ${boardId} LIMIT 1`;
    if (boardRows.length === 0) {
      return NextResponse.json({ error: 'Board not found.' }, { status: 404 });
    }
    if (boardRows[0].members?.[user.id]?.role !== 'dm') {
      return NextResponse.json({ error: 'Only the Dungeon Master can manage share links.' }, { status: 403 });
    }

    const deleted = await sql`
      DELETE FROM board_shares WHERE token = ${token} AND board_id = ${boardId}
    `;
    // neon returns { command, rowCount } for DELETE.
    const rowCount = (deleted as unknown as { rowCount?: number })?.rowCount ?? 0;
    if (rowCount === 0) {
      return NextResponse.json({ error: 'Share link not found on this board.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Revoke share link error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
