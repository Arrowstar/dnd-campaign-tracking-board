import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSql, ensureSchema } from '@/lib/db';
import { summarizeDeletion } from '@/lib/accountDeletion';

export const runtime = 'nodejs';

/**
 * Feature 07 — account deletion summary. Shows exactly what will happen before
 * anything is deleted: DM boards (with member counts) and member boards (with
 * owned-item counts). Same full-table scan shape as `my-boards` — improving it
 * is the tracked scalability work item, not this feature.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await ensureSchema();
    const sql = getSql();

    const rows = await sql`SELECT id, members, tabs FROM boards`;

    // Resolve display names for member-board DMs (same all-users scan the
    // members route uses — small scale).
    const userRows = await sql`SELECT id, display_name AS "displayName" FROM users WHERE deleted_at IS NULL`;
    const nameById: Record<string, string> = {};
    for (const u of userRows) nameById[u.id] = u.displayName;

    const summary = summarizeDeletion(user.id, rows as any[], (id) => nameById[id]);
    return NextResponse.json(summary);
  } catch (err) {
    console.error('Deletion summary error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
