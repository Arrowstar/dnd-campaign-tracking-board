import { BoardItem, BoardTab, ItemField, User, Visibility } from './types';

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

export type Viewer = Pick<User, 'id' | 'role'>;

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
 * Merges an incoming (client-supplied) board state onto the stored state so that
 * non-DM clients can never overwrite, blank out, or delete content they cannot
 * see:
 *  - Non-owner edits of another user's items are reduced to comments only.
 *  - Fields the user cannot view are restored from the stored item (and
 *    re-appended if the user tried to delete them).
 */
export function mergeTabsForSave(stored: BoardTab[], incoming: BoardTab[], user: Viewer): BoardTab[] {
  return incoming.map((incomingTab) => {
    const storedTab = stored.find((t) => t.id === incomingTab.id);
    if (!storedTab) return incomingTab;
    return {
      ...incomingTab,
      items: (incomingTab.items || []).map((inItem) => {
        const stItem = storedTab.items?.find((i) => i.id === inItem.id);
        if (!stItem) return inItem;

        // Non-owner, non-DM: only comments may change.
        if (user.role !== 'dm' && stItem.ownerId !== user.id) {
          return { ...stItem, comments: inItem.comments ?? stItem.comments };
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
        return { ...inItem, fields: [...fields, ...restoredHidden] };
      }),
    };
  });
}
