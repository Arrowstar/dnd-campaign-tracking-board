import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

export const runtime = 'nodejs';

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

    const members = boardRows[0].members || {};
    if (!members[user.id]) {
      return NextResponse.json({ error: 'You are not a member of this board.' }, { status: 403 });
    }

    const memberIds = Object.keys(members);
    if (memberIds.length === 0) return NextResponse.json({ members: [] });

    const userRows = await sql`SELECT id, username, display_name AS "displayName" FROM users`;
    const usersById: Record<string, any> = {};
    for (const u of userRows) usersById[u.id] = u;

    const membersList = memberIds.map((mId) => ({
      id: mId,
      displayName: usersById[mId]?.displayName || 'Unknown User',
      username: usersById[mId]?.username || '',
      role: members[mId].role,
      joinedAt: members[mId].joinedAt,
    }));

    return NextResponse.json({ members: membersList });
  } catch (err) {
    console.error('List members error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
