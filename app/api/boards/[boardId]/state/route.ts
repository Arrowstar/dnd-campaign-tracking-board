import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { scrubTabsForUser, mergeTabsForSave } from '@/lib/fieldVisibility';
import { syncLinkTitles } from '@/lib/crossref';

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

    const rows = await sql`SELECT members, tabs, updated_at FROM boards WHERE id = ${boardId} LIMIT 1`;
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
      updatedAt: board.updated_at ?? null,
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
    let updatedAt: string | null = null;
    if (tabs) {
      // Merge on top of stored state so clients can never overwrite or delete
      // content they are not permitted to see (per-field visibility, item ownership).
      const storedRows = await sql`SELECT tabs FROM boards WHERE id = ${boardId} LIMIT 1`;
      const storedTabs: any[] = storedRows[0]?.tabs || [];
      // Owners may only be reassigned to existing board members.
      const memberIds = new Set(Object.keys(rows[0].members || {}));
      const merged = mergeTabsForSave(storedTabs, tabs, { id: user.id, role: member.role }, memberIds);
      // Keep link-token title snapshots in sync with item titles.
      const synced = syncLinkTitles(merged);
      const updated = await sql`
        UPDATE boards SET tabs = ${JSON.stringify(synced)}::jsonb, updated_at = NOW() WHERE id = ${boardId}
        RETURNING updated_at
      `;
      updatedAt = updated[0]?.updated_at ?? null;
    }

    // Echo the revision back so the saving client can skip re-fetching the
    // full board state it already has.
    return NextResponse.json({ success: true, updatedAt });
  } catch (err) {
    console.error('Save board state error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
