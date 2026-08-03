/**
 * accountDeletion.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Pure helpers for Feature 07 — account deletion. Everything here is
 * side-effect free (no DB, no I/O) → unit-testable, mirroring lib/exportImport.ts.
 *
 * Semantics (see docs/features/07-board-deletion-account-management.md):
 *  - A user's memberships are removed on deletion; boards where they are the
 *    sole member (or that they explicitly checked) are deleted outright.
 *  - On surviving boards, every item AND annotation they owned is reassigned
 *    to the board's DM so `owner`-visibility fields never freeze.
 *  - Comments keep their original `userId`/`userName` — they are a historical
 *    record (and with soft delete the users row is retained anyway).
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { BoardTab } from './types';

export interface MemberEntry {
  role: 'dm' | 'player';
  joinedAt?: string;
}

export interface DmOwner {
  id: string;
  displayName: string;
}

export interface DmBoardSummary {
  boardId: string;
  memberCount: number;
  otherMembers: number;
  hasOthers: boolean;
}

export interface MemberBoardSummary {
  boardId: string;
  dmName?: string;
  ownedItems: number;
}

export interface DeletionSummary {
  dmBoards: DmBoardSummary[];
  memberBoards: MemberBoardSummary[];
  ownedItemsOnOtherBoards: number;
}

/**
 * Rewrites ownership of every item and annotation owned by `ownerId` to the
 * board's DM. Returns a shallow-copied tab tree; tabs/items not owned are
 * returned as-is (reference-preserving where nothing changes).
 */
export function reassignItemsToDm(tabs: BoardTab[], ownerId: string, dm: DmOwner): BoardTab[] {
  let changed = false;
  const mapped = tabs.map((tab) => {
    let items = tab.items;
    if (items?.some((item) => item.ownerId === ownerId)) {
      items = items.map((item) =>
        item.ownerId === ownerId ? { ...item, ownerId: dm.id, ownerName: dm.displayName } : item
      );
    }
    let annotations = tab.annotations;
    if (annotations?.some((ann) => ann.ownerId === ownerId)) {
      annotations = annotations.map((ann) =>
        ann.ownerId === ownerId ? { ...ann, ownerId: dm.id, ownerName: dm.displayName } : ann
      );
    }
    if (items === tab.items && annotations === tab.annotations) return tab;
    changed = true;
    return { ...tab, items, annotations };
  });
  return changed ? mapped : tabs;
}

/** First DM in the members map, or undefined (boards always have ≥ 1 DM by construction). */
export function findBoardDm(members: Record<string, MemberEntry> | null | undefined): string | undefined {
  if (!members) return undefined;
  const entry = Object.entries(members).find(([, m]) => m?.role === 'dm');
  return entry?.[0];
}

function countOwnedItems(tabs: BoardTab[] | null | undefined, userId: string): number {
  let count = 0;
  for (const tab of tabs || []) {
    for (const item of tab.items || []) {
      if (item.ownerId === userId) count++;
    }
  }
  return count;
}

/**
 * Builds the account-deletion summary for one user from the full boards scan
 * (same query shape as `my-boards`). `userNameOf` resolves a user id to a
 * display name for the DM of each member-board (the DM is never the deleted
 * user on a member-board, but the resolver keeps this pure).
 */
export function summarizeDeletion(
  userId: string,
  boards: { id: string; members?: Record<string, MemberEntry> | null; tabs?: BoardTab[] | null }[],
  userNameOf: (id: string) => string | undefined
): DeletionSummary {
  const dmBoards: DmBoardSummary[] = [];
  const memberBoards: MemberBoardSummary[] = [];
  let ownedItemsOnOtherBoards = 0;

  for (const board of boards) {
    const membership = board.members?.[userId];
    if (!membership) continue;
    const memberCount = Object.keys(board.members || {}).length;

    if (membership.role === 'dm') {
      dmBoards.push({
        boardId: board.id,
        memberCount,
        otherMembers: Math.max(0, memberCount - 1),
        hasOthers: memberCount > 1,
      });
      continue;
    }

    const dmId = findBoardDm(board.members);
    const ownedItems = countOwnedItems(board.tabs, userId);
    ownedItemsOnOtherBoards += ownedItems;
    memberBoards.push({
      boardId: board.id,
      dmName: dmId ? userNameOf(dmId) : undefined,
      ownedItems,
    });
  }

  return { dmBoards, memberBoards, ownedItemsOnOtherBoards };
}

/**
 * Boards that block account deletion: DM-run boards with other members that
 * the user did not opt to delete. The server rejects deletion with a 409
 * listing exactly these.
 */
export function findBlockingBoards(dmBoards: DmBoardSummary[], deleteBoardIds: string[]): DmBoardSummary[] {
  return dmBoards.filter((b) => b.hasOthers && !deleteBoardIds.includes(b.boardId));
}
