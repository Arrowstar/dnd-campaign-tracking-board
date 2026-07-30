import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

export const runtime = 'nodejs';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; targetUserId: string }> }
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { boardId, targetUserId } = await params;
    await ensureSchema();
    const sql = getSql();

    const rows = await sql`SELECT members FROM boards WHERE id = ${boardId} LIMIT 1`;
    if (rows.length === 0) return NextResponse.json({ error: 'Board not found.' }, { status: 404 });

    const members = rows[0].members || {};
    const callerMember = members[user.id];
    if (!callerMember || callerMember.role !== 'dm') {
      return NextResponse.json(
        { error: 'Only a Dungeon Master can manage board members.' },
        { status: 403 }
      );
    }
    if (!members[targetUserId]) {
      return NextResponse.json({ error: 'Target user is not a member of this board.' }, { status: 404 });
    }
    if (targetUserId === user.id) {
      return NextResponse.json({ error: 'Dungeon Master cannot remove themselves.' }, { status: 400 });
    }

    delete members[targetUserId];
    await sql`UPDATE boards SET members = ${JSON.stringify(members)}::jsonb, updated_at = NOW() WHERE id = ${boardId}`;

    return NextResponse.json({ success: true, message: 'Member removed successfully.' });
  } catch (err) {
    console.error('Remove member error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
