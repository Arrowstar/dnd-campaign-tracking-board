import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

export const runtime = 'nodejs';

/** Public check: does this board exist, and does joining need a password? */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const { boardId } = await params;
    await ensureSchema();
    const sql = getSql();

    const rows = await sql`SELECT board_password_hash FROM boards WHERE id = ${boardId} LIMIT 1`;
    if (rows.length === 0) {
      return NextResponse.json({ exists: false });
    }

    return NextResponse.json({
      exists: true,
      requiresBoardPassword: !!rows[0].board_password_hash,
    });
  } catch (err) {
    console.error('Board existence check error:', err);
    return NextResponse.json({ exists: false });
  }
}

/**
 * Feature 07 — board deletion. DM-only, destructive: removes the board row and
 * every member's access instantly. Cascades: notifications (F08), share links
 * (F09), and board_history (F05, once it ships) via their ON DELETE CASCADE
 * foreign keys. The client's typed-id confirm is UX-only; the `boardId` echoed
 * in the body is the server-side guard that the right board is being deleted.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { boardId } = await params;

    let body: { boardId?: string; force?: boolean } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    if (body.boardId !== boardId) {
      return NextResponse.json({ error: 'Board id does not match the requested board.' }, { status: 400 });
    }

    await ensureSchema();
    const sql = getSql();

    const rows = await sql`SELECT members FROM boards WHERE id = ${boardId} LIMIT 1`;
    if (rows.length === 0) return NextResponse.json({ error: 'Board not found.' }, { status: 404 });

    const member = rows[0].members?.[user.id];
    if (!member || member.role !== 'dm') {
      return NextResponse.json(
        { error: 'Only the Dungeon Master can delete this board.' },
        { status: 403 }
      );
    }

    // `force` is reserved for future use (e.g. admin override); ignored for now.
    await sql`DELETE FROM boards WHERE id = ${boardId}`;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Delete board error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
