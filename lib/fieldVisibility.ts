import { BoardItem, BoardTab, Comment, ItemField, User, Visibility } from './types';

/**
 * Per-field visibility helpers.
 *
 * Semantics (mirroring the existing item-level rules where they apply):
 *  - 'all'    → every board member
 *  - 'dm'     → only users with role 'dm'
 *  - 'owner'  → only the item's owner (no DM override — same as item-level 'owner')
 * Undefined visibility is treated as 'all' (backward compatible with existing data).
 */

/** Words that hint a field holds DM-only material. Matched case-insensitively on whole words. */
const DM_ONLY_HINT = /\b(secret|secrets|hidden|private|dm|spoiler|weakness|weaknesses|plot|ulterior|confidential|true nature|true identity|inner circle)\b/i;

/** Sensible default visibility from a field label — 'dm' for secret-ish labels, else 'all'. */
export function inferFieldVisibility(label: string): Visibility {
  return DM_ONLY_HINT.test(label) ? 'dm' : 'all';
}

export type Viewer = Pick<User, 'id' | 'role'> & { displayName?: string };

/** Whether `user` may see the content of `field` on `item`. */
export function canViewField(field: ItemField, item: BoardItem, user: Viewer): boolean {
  const v = field.visibility;
  if (!v || v === 'all') return true;
  if (v === 'dm') return user.role === 'dm';
  if (v === 'owner') return user.id === item.ownerId;
  return true;
}

/**
 * Deep-copies the board with content stripped from fields the viewer cannot see.
 * The field itself (id/label/type/visibility) is kept so clients can render a
 * lock placeholder. Stored data is never mutated — scrub only for responses.
 */
export function scrubItemForUser(item: BoardItem, user: Viewer): BoardItem {
  if (!item.fields || item.fields.length === 0) return item;
  const fields = item.fields.map((f) => {
    if (canViewField(f, item, user)) return f;
    return { ...f, textValue: undefined, imageUrl: undefined, lines: undefined, files: undefined };
  });
  return { ...item, fields };
}

export function scrubTabsForUser(tabs: BoardTab[], user: Viewer): BoardTab[] {
  return tabs.map((tab) => ({
    ...tab,
    items: (tab.items || []).map((item) => scrubItemForUser(item, user)),
  }));
}

/**
 * Merges incoming (client-supplied) comments onto the stored comments so that
 * comment integrity is enforced server-side (Security-Audit.md high #3):
 *  - Comments are identified by id: new ids are accepted but stamped with the
 *    authenticated user (client-supplied userId/userName is never trusted);
 *    existing ids keep the stored comment verbatim (no text/attribution edits).
 *  - A stored comment missing from the incoming array is only deleted when the
 *    caller is its author, the item's owner, or a DM — otherwise it is restored
 *    (mirrors the client delete affordance in FocusDrawer).
 */
export function mergeCommentsForSave(
  stored: Comment[],
  incoming: Comment[] | undefined,
  user: Viewer,
  itemOwnerId: string | undefined
): Comment[] {
  const storedById = new Map(stored.map((c) => [c.id, c]));
  const merged: Comment[] = [];
  const seen = new Set<string>();

  for (const c of stored) {
    const incomingMatch = (incoming || []).find((ic) => ic.id === c.id);
    // Deleted: incoming omits it and the caller is allowed to delete it.
    if (!incomingMatch && (c.userId === user.id || user.role === 'dm' || user.id === itemOwnerId)) {
      continue;
    }
    merged.push(c);
    seen.add(c.id);
  }

  for (const c of incoming || []) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    // New comment: stamp attribution server-side from the session.
    merged.push({
      ...c,
      userId: user.id,
      userName: user.displayName ?? user.id,
    });
  }

  return merged;
}

/**
 * Forces the authenticated ownership on items the caller may create:
 *  - Players can only own items they create (Security-Audit.md high #4) —
 *    any claimed ownerId/ownerName is replaced with the caller's own.
 *  - DMs may assign ownership on new items, but only to existing board
 *    members (when `memberIds` is provided) — otherwise it falls back to
 *    the DM's own id (same rule as ownership reassignment of stored items).
 */
function enforceNewItemOwnership(
  item: BoardItem,
  user: Viewer,
  memberIds?: Set<string>
): BoardItem {
  if (user.role !== 'dm') {
    return { ...item, ownerId: user.id, ownerName: user.displayName ?? user.id };
  }
  if (item.ownerId && memberIds && !memberIds.has(item.ownerId)) {
    return { ...item, ownerId: user.id, ownerName: user.displayName ?? user.id };
  }
  return item;
}

/**
 * Merges an incoming (client-supplied) board state onto the stored state so that
 * non-DM clients can never overwrite, blank out, or delete content they cannot
 * see:
 *  - Non-owner edits of another user's items are reduced to comments only.
 *  - Ownership can only be reassigned by a DM, and only to an existing board
 *    member (when `memberIds` is provided); any other attempt is reverted to
 *    the stored owner. New items (including items inside brand-new tabs) are
 *    owned by their creator — players can never claim another member's id.
 *  - Comments are merged by id with server-side attribution (see
 *    `mergeCommentsForSave`); stored comments may only be removed by their
 *    author, the item owner, or a DM.
 *  - Fields the user cannot view are restored from the stored item (and
 *    re-appended if the user tried to delete them).
 */
export function mergeTabsForSave(
  stored: BoardTab[],
  incoming: BoardTab[],
  user: Viewer,
  memberIds?: Set<string>
): BoardTab[] {
  return incoming.map((incomingTab) => {
    const storedTab = stored.find((t) => t.id === incomingTab.id);
    if (!storedTab) {
      return {
        ...incomingTab,
        items: (incomingTab.items || []).map((item) => enforceNewItemOwnership(item, user, memberIds)),
      };
    }
    return {
      ...incomingTab,
      items: (incomingTab.items || []).map((inItem) => {
        const stItem = storedTab.items?.find((i) => i.id === inItem.id);
        if (!stItem) return enforceNewItemOwnership(inItem, user, memberIds);

        // Non-owner, non-DM: only comments may change.
        if (user.role !== 'dm' && stItem.ownerId !== user.id) {
          return {
            ...stItem,
            comments: mergeCommentsForSave(stItem.comments || [], inItem.comments, user, stItem.ownerId),
          };
        }

        // Players can never reassign ownership — not even of their own items.
        if (user.role !== 'dm') {
          inItem = { ...inItem, ownerId: stItem.ownerId, ownerName: stItem.ownerName };
        }

        // DM ownership changes must target an existing board member.
        if (user.role === 'dm' && memberIds && inItem.ownerId !== stItem.ownerId) {
          if (!inItem.ownerId || !memberIds.has(inItem.ownerId)) {
            inItem = { ...inItem, ownerId: stItem.ownerId, ownerName: stItem.ownerName };
          }
        }

        // Owner or DM: take the incoming item, but restore hidden fields and
        // any hidden fields the client attempted to delete.
        const incomingFields = inItem.fields || [];
        const restoredHidden = (stItem.fields || []).filter(
          (sf) => !canViewField(sf, stItem, user) && !incomingFields.some((f) => f.id === sf.id)
        );
        const fields = incomingFields.map((f) => {
          const stF = stItem.fields?.find((sf) => sf.id === f.id);
          if (!canViewField(f, stItem, user) && stF) return stF;
          return f;
        });
        return {
          ...inItem,
          fields: [...fields, ...restoredHidden],
          comments: mergeCommentsForSave(stItem.comments || [], inItem.comments, user, stItem.ownerId),
        };
      }),
    };
  });
}
