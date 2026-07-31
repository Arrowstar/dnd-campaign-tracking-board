import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { scrubTabsForUser, mergeTabsForSave } from '@/lib/fieldVisibility';

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

    const rows = await sql`SELECT members, tabs FROM boards WHERE id = ${boardId} LIMIT 1`;
    if (rows.length === 0) return NextResponse.json({ error: 'Board not found.' }, { status: 404 });

    const board = rows[0];
    const member = board.members?.[user.id];
    if (!member) {
      return NextResponse.json({ error: 'You are not a member of this board.' }, { status: 403 });
    }

    return NextResponse.json({
      userId: user.id,
      username: user.displayName,
      role: member.role,
      // Strip per-field restricted content (e.g. DM-only fields) before
      // sending — the stored data is never mutated.
      tabs: scrubTabsForUser(board.tabs || [], { id: user.id, role: member.role }),
    });
  } catch (err) {
    console.error('Load board state error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

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

    const rows = await sql`SELECT members FROM boards WHERE id = ${boardId} LIMIT 1`;
    if (rows.length === 0) return NextResponse.json({ error: 'Board not found.' }, { status: 404 });

    const member = rows[0].members?.[user.id];
    if (!member) {
      return NextResponse.json({ error: 'You are not a member of this board.' }, { status: 403 });
    }

    const { tabs } = (await request.json()) as { tabs?: any[] };
    if (tabs) {
      // Merge on top of stored state so clients can never overwrite or delete
      // content they are not permitted to see (per-field visibility, item ownership).
      const storedRows = await sql`SELECT tabs FROM boards WHERE id = ${boardId} LIMIT 1`;
      const storedTabs: any[] = storedRows[0]?.tabs || [];
      const merged = mergeTabsForSave(storedTabs, tabs, { id: user.id, role: member.role });
      await sql`UPDATE boards SET tabs = ${JSON.stringify(merged)}::jsonb, updated_at = NOW() WHERE id = ${boardId}`;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Save board state error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
