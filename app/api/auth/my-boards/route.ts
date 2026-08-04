import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSql, ensureSchema } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await ensureSchema();
    const sql = getSql();
    // Feature 12 — resolve membership via the JSONB `?` operator (GIN index
    // scan) instead of pulling every board and filtering in JS.
    const rows = await sql`SELECT id, members FROM boards WHERE members ? ${user.id}`;

    const boards = rows.map((r: any) => ({
      boardId: r.id,
      role: r.members[user.id].role,
      joinedAt: r.members[user.id].joinedAt,
    }));

    return NextResponse.json({ boards });
  } catch (err) {
    console.error('My-boards error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
