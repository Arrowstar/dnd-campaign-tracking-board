import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser, verifyPassword } from '@/lib/auth';
import { authLimited, JOIN_LIMIT, JOIN_WINDOW_MS } from '@/lib/rateLimit';

export const runtime = 'nodejs';

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

    const rows = await sql`
      SELECT members, board_password_hash, board_password_salt
      FROM boards WHERE id = ${boardId} LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Board not found.' }, { status: 404 });
    }

    const board = rows[0];
    const members = board.members || {};

    const existing = members[user.id];
    if (existing?.role === 'dm') {
      return NextResponse.json(
        { error: 'You are already the Dungeon Master of this board.' },
        { status: 400 }
      );
    }
    if (existing?.role === 'player') {
      return NextResponse.json({ success: true, role: 'player' });
    }

    if (board.board_password_hash) {
      // Board-password guessing is rate-limited per IP+user (Security-Audit.md
      // medium #6).
      const limited = authLimited(request, `join:${user.id}`, JOIN_LIMIT, JOIN_WINDOW_MS);
      if (limited) return limited;

      const { boardPassword } = (await request.json().catch(() => ({}))) as {
        boardPassword?: string;
      };
      if (!boardPassword) {
        return NextResponse.json(
          { error: 'This board requires a join password.', requiresPassword: true },
          { status: 401 }
        );
      }
      const valid = await verifyPassword(boardPassword, board.board_password_hash, board.board_password_salt);
      if (!valid) {
        return NextResponse.json({ error: 'Incorrect board password.' }, { status: 401 });
      }
    }

    members[user.id] = { role: 'player', joinedAt: new Date().toISOString() };
    await sql`UPDATE boards SET members = ${JSON.stringify(members)}::jsonb, updated_at = NOW() WHERE id = ${boardId}`;

    return NextResponse.json({ success: true, role: 'player' });
  } catch (err) {
    console.error('Join board error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
