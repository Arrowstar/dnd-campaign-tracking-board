import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, clearSessionCookie } from '@/lib/auth';
import { getSql, ensureSchema } from '@/lib/db';
import {
  reassignItemsToDm,
  findBoardDm,
  findBlockingBoards,
  intersectMemberBoards,
  MemberEntry,
} from '@/lib/accountDeletion';

export const runtime = 'nodejs';

interface AccountDeleteBody {
  confirmed?: boolean;
  deleteBoardIds?: string[];
}

interface BoardRow {
  id: string;
  members: Record<string, MemberEntry>;
  tabs: any[];
}

/**
 * Feature 07 — account deletion (soft delete). The users row is kept with
 * `deleted_at` set (audit trail; comment authorship stays resolvable) but:
 *  - sessions and notifications are deleted explicitly (the FK cascades only
 *    fire on row deletion),
 *  - username is renamed to `deleted_<id>` so the UNIQUE slot is released,
 *  - memberships are removed and owned items/annotations reassigned to each
 *    survivor board's DM (no frozen `owner`-visibility fields),
 *  - boards where the user is the sole member, or that they checked, are
 *    deleted outright.
 *
 * `confirmed` is mandatory — this is the server-side guard against accidental
 * client deletions. Reads happen first; every write is precomputed and applied
 * in a single non-interactive transaction (neon HTTP driver batches them).
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body: AccountDeleteBody = {};
    try {
      body = (await request.json()) as AccountDeleteBody;
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    if (body.confirmed !== true) {
      return NextResponse.json(
        { error: 'Account deletion requires confirmation.' },
        { status: 400 }
      );
    }
    const deleteBoardIds = Array.isArray(body.deleteBoardIds)
      ? body.deleteBoardIds.filter((id): id is string => typeof id === 'string')
      : [];

    await ensureSchema();
    const sql = getSql();

    // Re-read the user's memberships fresh — never trust client claims.
    const rows = await sql`SELECT id, members, tabs FROM boards`;
    const boards = rows as BoardRow[];

    const memberships = boards.filter((b) => b.members?.[user.id]);
    // IDOR guard: only boards the caller actually belongs to may be deleted
    // (Security-Audit.md critical #1). Any other id is silently dropped.
    const requestedDeletions = intersectMemberBoards(deleteBoardIds, memberships);
    const dmBoards = memberships.filter((b) => b.members[user.id].role === 'dm');

    // DM-run boards with other members that aren't being deleted block the
    // whole deletion: the account would leave a board without a DM.
    const blocking = findBlockingBoards(
      dmBoards.map((b) => {
        const memberCount = Object.keys(b.members || {}).length;
        return { boardId: b.id, memberCount, otherMembers: memberCount - 1, hasOthers: memberCount > 1 };
      }),
      requestedDeletions
    );
    if (blocking.length > 0) {
      return NextResponse.json(
        {
          error: 'Resolve your Dungeon Master boards before deleting your account.',
          blockingBoards: blocking.map((b) => ({ boardId: b.boardId, otherMembers: b.otherMembers })),
        },
        { status: 409 }
      );
    }

    // Deleted outright: the checked boards + DM boards where the user is the
    // only member (a board with zero members is unreachable dead data).
    // `requestedDeletions` was already intersected with the caller's
    // memberships above, so this set can only contain their own boards.
    const toDelete = new Set<string>(requestedDeletions);
    for (const b of dmBoards) {
      const memberCount = Object.keys(b.members || {}).length;
      if (memberCount <= 1) toDelete.add(b.id);
    }

    const survivors = memberships.filter((b) => !toDelete.has(b.id));

    // Resolve display names for the reassignment targets (board DMs).
    const dmIds = [...new Set(survivors.map((b) => findBoardDm(b.members)).filter((id): id is string => !!id))];
    const dmNames: Record<string, string> = {};
    if (dmIds.length > 0) {
      const userRows = await sql`SELECT id, display_name AS "displayName" FROM users WHERE id = ANY(${dmIds})`;
      for (const u of userRows) dmNames[u.id] = u.displayName;
    }

    // Precompute every write, then apply the batch atomically.
    const survivorUpdates = survivors.map((b) => {
      const dmId = findBoardDm(b.members);
      const members = { ...b.members };
      delete members[user.id];
      const tabs = dmId
        ? reassignItemsToDm(b.tabs, user.id, { id: dmId, displayName: dmNames[dmId] ?? dmId })
        : b.tabs;
      return { id: b.id, members, tabs };
    });

    // Precompute every write, then apply the batch atomically. The neon
    // transaction callback is synchronous — the queries are built from the
    // already-computed data above.
    await sql.transaction((tx) => [
      ...(toDelete.size > 0 ? [tx`DELETE FROM boards WHERE id = ANY(${Array.from(toDelete)})`] : []),
      ...survivorUpdates.map(
        (u) => tx`UPDATE boards SET members = ${JSON.stringify(u.members)}::jsonb, tabs = ${JSON.stringify(u.tabs)}::jsonb, updated_at = NOW() WHERE id = ${u.id}`
      ),
      // Soft delete: row retained, username renamed to release the UNIQUE
      // slot; sessions and notifications are cleaned up explicitly since no
      // FK cascade fires on an UPDATE.
      tx`DELETE FROM notifications WHERE user_id = ${user.id}`,
      tx`DELETE FROM sessions WHERE user_id = ${user.id}`,
      tx`UPDATE users SET deleted_at = NOW(), username = 'deleted_' || id WHERE id = ${user.id}`,
    ]);

    return clearSessionCookie(NextResponse.json({ success: true }));
  } catch (err) {
    console.error('Delete account error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
