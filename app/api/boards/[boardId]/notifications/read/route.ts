import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

export const runtime = 'nodejs';

/**
 * Marks notifications read (Feature 08). Body: `{ ids?: number[] }` — the
 * given ids, or every unread notification for the current board when omitted.
 * Rows are always scoped to (user, board), so a caller can never touch
 * another user's notifications.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const boardId = (await params).boardId;
    await ensureSchema();
    const sql = getSql();

    const boardRows = await sql`SELECT members FROM boards WHERE id = ${boardId} LIMIT 1`;
    if (boardRows.length === 0) return NextResponse.json({ error: 'Board not found.' }, { status: 404 });
    const members = boardRows[0].members || {};
    if (!members[user.id]) {
      return NextResponse.json({ error: 'You are not a member of this board.' }, { status: 403 });
    }

    const { ids } = (await request.json().catch(() => ({}))) as { ids?: number[] };
    if (ids !== undefined) {
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'number')) {
        return NextResponse.json({ error: 'Invalid ids.' }, { status: 400 });
      }
      if (ids.length === 0) {
        return NextResponse.json({ success: true });
      }
      await sql`
        UPDATE notifications SET read = TRUE
        WHERE user_id = ${user.id} AND board_id = ${boardId} AND id = ANY(${ids})
      `;
    } else {
      await sql`
        UPDATE notifications SET read = TRUE
        WHERE user_id = ${user.id} AND board_id = ${boardId} AND read = FALSE
      `;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Mark notifications read error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
