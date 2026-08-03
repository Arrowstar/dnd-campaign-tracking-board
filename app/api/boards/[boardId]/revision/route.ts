import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { isTokenUsable, ShareRow } from '@/lib/shareTokens';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const { boardId } = await params;
    await ensureSchema();
    const sql = getSql();

    // Feature 09 — share-view polling branch (the only auth-branching
    // endpoint): when a share token is supplied, the token itself is the
    // credential. No Bearer check, no membership requirement — kept isolated
    // here so the authenticated path below stays byte-identical to before.
    const shareToken = request.nextUrl.searchParams.get('shareToken');
    if (shareToken) {
      const shareRows = (await sql`
        SELECT token, board_id, label, created_at, expires_at
        FROM board_shares WHERE token = ${shareToken} AND board_id = ${boardId} LIMIT 1
      `) as ShareRow[];
      const share = shareRows[0];
      if (!share || !isTokenUsable(share)) {
        return NextResponse.json({ error: 'This link is no longer active.' }, { status: 403 });
      }
      const rows = await sql`SELECT updated_at FROM boards WHERE id = ${boardId} LIMIT 1`;
      if (rows.length === 0) {
        return NextResponse.json({ error: 'Board not found.' }, { status: 404 });
      }
      return NextResponse.json({ updatedAt: rows[0].updated_at ?? null });
    }

    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rows = await sql`SELECT members, updated_at FROM boards WHERE id = ${boardId} LIMIT 1`;
    if (rows.length === 0) return NextResponse.json({ error: 'Board not found.' }, { status: 404 });

    const member = rows[0].members?.[user.id];
    if (!member) {
      return NextResponse.json({ error: 'You are not a member of this board.' }, { status: 403 });
    }

    return NextResponse.json({ updatedAt: rows[0].updated_at ?? null });
  } catch (err) {
    console.error('Load board revision error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
