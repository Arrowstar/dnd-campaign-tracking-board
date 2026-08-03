# Feature 04 — Card Duplication & Move to Tab (plus shared multi-select)

**Status:** Proposed · **Priority:** P1 · **Dependencies:** multi-select groundwork shared with Feature 02 (build once, consume in both)

## Summary

Two of the most common DM operations are impossible today: **duplicating a card** (variant NPCs, quest templates, recurring loot) and **moving a card between tabs** (reorganizing a growing board). This feature adds:

1. Single-card duplicate: Ctrl/Cmd+D, context menu, and FocusDrawer action.
2. Move to Tab: context menu and FocusDrawer action; moves item (and, by rule, its connections) between tabs.
3. Shared multi-select + bulk bar (also consumed by Feature 02 bulk tagging): Ctrl/Shift-click and marquee selection with bulk Duplicate / Move / Delete.

**Why:** Every DM workflow — session prep, worldbuilding sprints, campaign handoff — hits "I need 5 near-identical guards" or "this belongs on the Party tab" dozens of times a session.

## User stories

1. As a DM, I duplicate an NPC card to create a near-identical town guard, edit the name, and re-place the copy (with new UUIDs — no shared-state bugs with the original).
2. As a DM, I select the 8 cards I just created and move them to the "Session 8" tab in one action.
3. As a DM, I Ctrl+D a quest card as a template for a new quest, keep the structure, and change the fields.
4. As a player, I duplicate my own character card to draft a variant before committing (players cannot duplicate others' cards — server-enforced).

## UX spec

### Duplicate (single card)
- **Triggers:** Ctrl/Cmd+D on a selected card; "Duplicate" in a new right-click context menu (see below); "Duplicate" button in FocusDrawer header (next to minimize/delete).
- **Behavior:**
  - New UUID via `uuidv4()`; position = original + (24, 24) canvas px (clamped to stay on-canvas); width/height copied.
  - Title copied; if the item is a *new/untitled* card ("New NPC"), append " (copy)" so the copy is distinguishable. `#title (copy)` — use `(copy)` suffix always when title matches the `'New <type>'` default, else exact copy.
  - **Deep copy:** `fields` (structured JSON + `@@MULTILINK` values are plain strings — copy as-is), `content`, `color`, `tags`, `crop`, `lines`, `previewLayout`, `previewFields`, `minimized`, `date` (keep original), `visibility`.
  - **Not copied:** `comments` (fresh `[]`), `ownerId` → **the duplicator** (`user.id`/`user.name`), `id` (new).
  - **Connections:** outgoing/incoming connections are NOT copied. (Copying edges would require choosing between cloning endpoints or dangling references; both are confusing. Documented behavior: fresh card is unconnected.)
  - **Annotation pins:** pins on annotations reference the original item id and are untouched — the copy is not auto-pinned.
  - New card is selected and its FocusDrawer opens (matches "create item" affordance patterns).
- **Undo:** record one history entry for the whole operation (same mutation-merging path as add/delete — see Board.tsx:557–640).

### Move to Tab
- **Triggers:** context menu → "Move to tab ▸ [tab list]"; FocusDrawer header → "Move to tab ▸" submenu.
- **Behavior:**
  - Item is removed from source tab's `items`, appended (preserving x/y — tabs share the same world space) to destination tab's `items`.
  - **Connections rule:** connections where **either endpoint** is the moved item are **deleted** (connections are per-tab arrays; a cross-tab edge would render on the wrong tab's SVG layer). Document in the confirm hint: "2 connections will be removed."
  - **Annotation pins:** pins reference item ids and `handleScrollToItem` (Board.tsx:1321) already locates items across tabs — pins keep working; no change.
  - Cross-links (`@@MULTILINK`) point at ids, not tabs — unaffected.
- **Undo:** single history entry (both arrays change in one commit).

### Context menu (new — `components/ItemContextMenu.tsx`)
- Right-click (and long-press on touch) on a card opens a small menu: **Open**, **Duplicate**, **Move to tab ▸**, **Tag…** (F02), **Delete**. Position at cursor, clamp to viewport.
- Menu placement is in screen space; the canvas transform doesn't affect it. Close on Escape/click-away.
- On multi-select, right-clicking an already-selected card shows bulk variants of the same items ("Duplicate (3)", "Move to tab ▸", "Delete (3)").

### Multi-select (shared with Feature 02)
Fully specified in Feature 02 ("Bulk tagging" section) — selection mechanics, bulk bar, ownership rules are identical. This doc adds:
- **Bulk duplicate:** each selected card duplicated with the rules above; copies arranged in a slight fan (24px cascade) from the *bounding box* of the selection; all copies become the new selection.
- **Bulk move:** all editable selected cards move to the chosen tab; per-item connection cleanup applies.
- Bulk bar buttons are disabled individually when no editable cards in the selection ("N editable of M selected").

## Data model changes

None. `BoardItem` is self-contained; tabs are arrays of items; ids are UUIDs.

## API changes

None. All operations are client-side state mutations persisted through the existing `POST /api/boards/[boardId]/state` path. **Server merge already enforces the ownership rules** (`mergeTabsForSave`, lib/fieldVisibility.ts:80): a player attempting to duplicate/move another user's card is reduced to their original state on save — the client should additionally *pre-empt* by disabling actions on non-editable items.

## Implementation plan

### Files
| File | Change |
|---|---|
| `components/Board.tsx` | `handleDuplicateItem(id)` and `handleDuplicateItems(ids: string[])`; `handleMoveToTab(ids: string[], targetTabId)`; multi-select state + marquee (from F02); selection → FocusDrawer wiring; Ctrl/Cmd+D in `latestKeyHandlerRef` (Board.tsx:1197, **before** the `if (e.metaKey || e.ctrlKey || e.altKey) return;` guard at line 1227 — mirror the Feature 01 Ctrl+K wiring); bulk bar actions for Duplicate/Move/Delete. |
| `components/BoardItem.tsx` | `onDuplicate`, `onMoveToTab` props; right-click handler → context menu state; keep click/ctrl-click semantics from F02. |
| `components/ItemContextMenu.tsx` | **New.** Menu with item + bulk variants. |
| `components/FocusDrawer.tsx` | Header buttons: Duplicate + "Move to tab ▸" submenu (list of tabs excluding current). |
| `lib/duplicate.ts` | **New.** Pure helpers: `duplicateItem(item, opts)`, `moveItemsToTab(tabs, itemIds, targetTabId)` → returns new tabs + count of dropped connections. Unit-testable without React. |

### Duplicate helper sketch
```ts
export function duplicateItem(item: BoardItem, newOwner: { id: string; name: string }, offset = 24): BoardItem {
  const id = uuidv4();
  const title = /^New .+$/.test(item.title) ? `${item.title} (copy)` : item.title;
  return {
    ...item,
    id,
    title,
    x: item.x + offset,
    y: item.y + offset,
    ownerId: newOwner.id,
    ownerName: newOwner.name,
    comments: [],
  };
}
```
(`fields`, `lines`, `crop`, `previewLayout` etc. are shallow-copied by spread; structured values are immutable strings, so no deep clone is needed — verify no mutable nested arrays beyond `comments` exist: `files`/`lines`/`pins` are never mutated in place in the codebase — they're replaced wholesale via `handleUpdateItem` — so shared references are safe.)

### Move helper sketch
```ts
export function moveItemsToTab(tabs: BoardTab[], ids: Set<string>, targetTabId: string): { tabs: BoardTab[]; droppedConnections: number } {
  // 1. Find target tab; if missing, no-op.
  // 2. Collect moved items from source tabs.
  // 3. Remove moved items from their source tabs' items arrays.
  // 4. Delete connections (in source tabs) with fromId/toId in ids; count them.
  // 5. Append moved items to target tab's items.
  // 6. Return { tabs, droppedConnections }.
}
```
Call `saveState` once with the new tabs; push one undo entry.

## Edge cases & conflicts

- **Ctrl+D with a form field focused:** guard like Delete/arrows — the keydown handler already returns early for `isFormField` (Board.tsx:1219). But Ctrl+D *inside* the FocusDrawer text editors is a browser "bookmark" shortcut — `e.preventDefault()` is required and safe only outside contentEditable (the Tiptap editor handles its own shortcuts; check `document.activeElement.isContentEditable`).
- **Duplicate while save is in flight:** `saveState` is queued (`saveQueueRef`, Board.tsx:556) — duplicates piggyback on the queue; ordering is preserved.
- **Move + concurrent remote edits:** a remote user editing the same item mid-move is subject to the existing last-write-wins merge; the item ends up on the tab of whichever client saved last. Acceptable for v1 (history F05 covers recovery).
- **Moving the last item of a tab:** tabs can be empty — fine, empty tabs are valid (they can be deleted via TabBar).
- **Destination tab deleted mid-move:** validate target tab still exists at apply time; if not, clear the pending menu.
- **Duplicate ownership of DM-visible-only cards:** a player cannot *see* DM-only content (scrubbed server-side), so they can't duplicate what they can't see — no leak.
- **Very large selections:** bulk duplicate of 50 cards is 50 new items — one save; fine.

## Rollout / migration

None — client-only; additive.

## Acceptance criteria

- [ ] Ctrl/Cmd+D duplicates the selected card: new UUID, +24px offset, fresh owner = duplicator, no comments, connection-free.
- [ ] FocusDrawer Duplicate + context menu Duplicate behave identically.
- [ ] Move to tab moves item, deletes only its connections, keeps pins/cross-links functional, and is undoable as one step.
- [ ] Multi-select (ctrl/shift + marquee) with bulk bar: Duplicate/Move/Delete operate on editable subset with "N of M" hint.
- [ ] Players cannot move/duplicate/delete others' cards (client disabled + server merge as backstop).
- [ ] Undo stack: single undo restores the whole duplicate/move operation.
- [ ] No regressions in drag, delete, or cross-link navigation.

## Open questions

1. Should duplicate copy connections when the original's other endpoint is ALSO being duplicated in the same bulk action? (Reasonable "clone subgraph" behavior for moving whole encounter groups; proposed v2.)
2. Should `date` be reset to today on duplicate? (Proposed: keep original — quests spanning sessions keep context.)
3. Right-click context menu on mobile: long-press is proposed; confirm no gesture conflicts with existing drag/draw handlers.
