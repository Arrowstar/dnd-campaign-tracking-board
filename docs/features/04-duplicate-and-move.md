# Feature 04 — Card Duplication & Move to Tab (v2, updated 2026-08-05)

**Status:** Partially implemented · **Priority:** P1 · **Dependencies:** Feature 02 multi-select/bulk bar (**shipped**); Feature 11 delta-based undo (**shipped** — duplicates/moves get undo for free)

> **v2 note:** The original spec assumed multi-select and the bulk bar were still to build. Both shipped (plus bulk Align). This revision only specs the **remaining** work: Duplicate (single + bulk), Move to Tab (single + bulk), and the right-click context menu — all integrated into the existing bulk bar and selection machinery.

## Summary

Two of the most common DM operations are still impossible: **duplicating a card** (variant NPCs, quest templates, recurring loot) and **moving a card between tabs** (reorganizing a growing board). Everything they need already exists:

- Multi-select + bulk bar (`selectedItemIds`, `editableSelectedItems`, Board.tsx:327–374, bulk bar UI at Board.tsx:2615–2721)
- Ownership-aware editing (`editableSelectedItems`: DM edits all, others only their own — mirrors server merge, Board.tsx:354–359)
- Delta-based undo with skip notices (lib/undoHistory.ts; `recordHistory` keyed per operation)
- Tab list + `activeTabId` for the move target picker
- `saveState(newItems, newConns, newAnns?, historyKey)` and `saveFullTabsState` — the single funnel every mutation uses

## User stories

1. As a DM, I duplicate an NPC card to create a near-identical town guard, edit the name, and re-place the copy (fresh UUID — no shared state with the original).
2. As a DM, I select 8 cards and move them to the "Session 8" tab in one action.
3. As a DM, I Ctrl+D a quest card as a template, keep the structure, and change the fields.
4. As a player, I duplicate my own character card to draft a variant (players cannot duplicate others' cards — enforced by `editableSelectedItems` + the server merge as backstop).
5. As a user, one Ctrl+Z undoes an entire duplicate or move (Feature 11 patches make this exact).

## What's already shipped (do NOT rebuild)

| Piece | Location |
|---|---|
| Ctrl/Shift-click multi-select + gold rings | Board.tsx:327–374, 2512 |
| Bulk bar: count, "N can be edited" hint, Tag… / Align… / Delete (two-click confirm) / Clear | Board.tsx:2615–2721 |
| `editableSelectedItems` (DM-else-owner rule) | Board.tsx:354–359 |
| `clearItemSelection` (resets bulk transient state) | Board.tsx:368–374 |
| Bulk delete via keyboard Delete | Board.tsx:1751–1761 |
| Delta undo/redo + persisted history + skip notices | lib/undoHistory.ts; Board.tsx:889–1028 |
| Tag filter/dimming, bulk tag popover | Board.tsx:332–351, 2698–2719 |

## UX spec (remaining work)

### 1. Duplicate — single card
- **Triggers:**
  - **Ctrl/Cmd+D** on a selected card (single or multi).
  - **Bulk bar "Duplicate" button** (new, between Align… and Delete).
  - **FocusDrawer** header action "Duplicate" (next to the existing "Delete this item" control, FocusDrawer.tsx:517–524).
  - Context menu (section 3).
- **Behavior:**
  - New `uuidv4()`; position = original + (24, 24) canvas px (clamped to the 4000×4000 world); width/height copied.
  - Title: if it matches the default `New <type>` pattern → `${title} (copy)`; otherwise copied verbatim.
  - **Deep copy:** `fields` (structured JSON + `@@MULTILINK` values are immutable strings — shallow spread is safe), `content`, `color`, `tags`, `crop`, `lines`, `previewLayout`, `previewFields`, `minimized`, `date`.
  - **Not copied:** `comments` (fresh `[]`), `ownerId`/`ownerName` → **duplicator** (`user.id`/`user.name`), `id` (new).
  - **Connections:** NOT copied (incoming/outgoing). Documented: the copy starts unconnected.
  - **Annotation pins:** untouched — pins reference the original's id and `navigateToItem` (lib/viewNavigation.ts) already locates across tabs.
  - After single duplicate: the copy is selected and its FocusDrawer opens (matches the add-item affordance).
- **Undo:** one history entry, historyKey `'duplicate'` — Feature 11 records the delta; one Ctrl+Z reverts.

### 2. Duplicate — bulk (multi-select)
- Bulk bar button acts on `editableSelectedItems` (per the existing "N of M can be edited" hint).
- Copies arranged in a **fan** from the selection's bounding box: index i → offset (24 + i*12, 24 + i*12) mod 96, wrapping so a 20-card batch stays on-canvas and readable.
- All copies become the new selection (like bulk bar "Clear" then select-copies).
- One history entry, key `'duplicate'`.

### 3. Move to Tab — single + bulk
- **Triggers:**
  - **Bulk bar "Move…" button** → popover listing tabs (name + color dot, excluding the current tab; reuses the tab color model from TabBar).
  - **FocusDrawer** header action "Move to tab ▸" (same list).
  - Context menu "Move to tab ▸".
- **Behavior:**
  - Item(s) removed from source tab's `items`, appended to the target tab's `items` — **x/y preserved** (tabs share one world space).
  - **Connections rule:** connections where **either endpoint** is a moved item are **deleted** (connections are per-tab arrays; cross-tab edges would dangle). Show the count in the popover: "2 connections will be removed."
  - Annotation pins and `@@MULTILINK` cross-links are tab-agnostic (id-based) — untouched.
  - **Undo:** one entry, key `'move-to-tab'` (Feature 11 patch covers both tab arrays).
- **Bulk:** operates on `editableSelectedItems`; popover header mirrors the bulk Tag popover pattern ("Move N selected cards").

### 4. Context menu — `components/ItemContextMenu.tsx` (new)
- Right-click on a card (long-press on touch, if cheap) opens a small menu: **Open**, **Duplicate**, **Move to tab ▸**, **Tag…** (reuse bulk-tag popover with single item), **Delete**. Position at cursor, clamp to viewport, close on Escape/click-away.
- On multi-select: right-clicking an *already-selected* card shows bulk variants ("Duplicate (3)", "Move to tab ▸", "Delete (3)"); right-clicking an unselected card re-selects it first.
- Screen-space positioning — canvas transform doesn't affect it.
- **Scope note:** this is the only genuinely new component. If you want to cut scope, keyboard + bulk bar + FocusDrawer cover the same operations; the context menu is the ergonomic cherry on top.

## Data model changes

None. `BoardItem` is self-contained; tabs are arrays of items; ids are UUIDs; structured values are immutable strings.

## API changes

None. All operations are client-side mutations persisted through the existing `POST /api/boards/[boardId]/state` path. `mergeTabsForSave` (lib/fieldVisibility.ts) already enforces ownership server-side — the client pre-empts via `editableSelectedItems`.

## Implementation plan

### Files
| File | Change |
|---|---|
| `lib/duplicate.ts` | **New.** `duplicateItem(item, newOwner, offset)` (rules above), `duplicateItems(items, newOwner)` (fan layout). Pure → unit tests (`lib/duplicate.test.ts`). |
| `lib/tabMove.ts` | **New.** `moveItemsToTab(tabs, ids, targetTabId)` → `{ tabs, droppedConnections }` (rule above). Pure → tests. |
| `components/Board.tsx` | `handleDuplicateItems(ids)`, `handleMoveToTab(ids, targetTabId)`; Ctrl/Cmd+D in the keydown switch (Board.tsx:1728+ — add before the form-field-adjacent guards, mirroring how `Delete` handles single-vs-bulk at 1751); bulk bar buttons Duplicate/Move + Move popover state (`bulkMoveOpen`, TabBar-style tab list); select-copies-after-bulk-duplicate. |
| `components/BoardItem.tsx` | `onContextMenu` → context menu state; verify no gesture conflicts with the existing pointer handlers (drag). |
| `components/ItemContextMenu.tsx` | **New.** Single + bulk variants (section 4). |
| `components/FocusDrawer.tsx` | Duplicate + "Move to tab ▸" actions beside the existing delete control (FocusDrawer.tsx:517–524). |

### Integration details (verified current refs)

- **History keys:** `saveState`/`saveFullTabsState` take a `historyKey` — existing usages: `'bulk-tags'` (Board.tsx:1596), `'bulk-delete'` (Board.tsx:1647). Use `'duplicate'` and `'move-to-tab'`. One entry per operation; Feature 11 coalescing + skip notices apply automatically (an undo after a remote edit skips instead of clobbering).
- **Move must call `saveFullTabsState`** (the tabs-array funnel, Board.tsx:868) — not `saveState` — because it changes tab membership, not just items within the active tab. Verify its signature and that it re-derives `items`/`connections` for the active tab from the new tabs.
- **Bulk bar wiring:** new buttons disabled when `editableSelectedItems.length === 0` (same pattern as Tag…/Align…/Delete at Board.tsx:2628–2661); Move popover mirrors `bulkAlignOpen`/`bulkTagOpen` state pattern (Board.tsx:341–342) and `clearItemSelection` resets it (Board.tsx:368).
- **Keyboard:** Ctrl+D must run **before** the `if (e.metaKey || e.ctrlKey || e.altKey) return;` guard in the keydown handler (the same pattern used for Ctrl+Z and Feature 01's Ctrl+K) and must `preventDefault()` (browser bookmark shortcut); skip when `document.activeElement.isContentEditable` (Tiptap owns its shortcuts).

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
(`fields`, `lines`, `crop`, `previewLayout`, `files` are replaced wholesale by `handleUpdateItem` — shared references after the spread are safe because nothing mutates them in place.)

### Move helper sketch
```ts
export function moveItemsToTab(tabs: BoardTab[], ids: Set<string>, targetTabId: string): {
  tabs: BoardTab[]; droppedConnections: number;
} {
  // 1. Target tab missing → no-op.
  // 2. Collect moved items from source tabs; remove them from source items arrays.
  // 3. Delete connections in source tabs with fromId/toId ∈ ids; count them.
  // 4. Append moved items to target tab's items.
}
```

## Edge cases & conflicts

- **Ctrl+D inside a form field / Tiptap:** guard on `isContentEditable` + input/textarea (existing keydown guard pattern).
- **Duplicate while a save is in flight:** `saveQueueRef` chains saves in order (Board.tsx:655) — duplicates piggyback safely.
- **Move + concurrent remote edit:** last-write-wins via the existing merge; the item lands on whichever client saved last. Feature 12's per-item rows (when it ships) tighten this.
- **Moving the last item of a tab:** empty tabs are valid (deletable via TabBar) — fine.
- **Destination tab deleted mid-menu:** validate the target exists at apply time; close the popover if not.
- **Player duplication of DM-only content:** a player can't see DM-only cards (scrubbed server-side) → can't duplicate them. No leak.
- **Huge bulk selects:** 50 cards = 50 new items, one save — fine.
- **Context menu vs drag:** right-click must not start the drag handlers (verify BoardItem's pointer handlers are left-button-only; if not, gate on `e.button === 2`).

## Rollout / migration

None — client-only, additive. Recommended commit order: `lib/duplicate.ts` + `lib/tabMove.ts` + tests → Board handlers + bulk bar buttons + Ctrl+D → FocusDrawer actions → context menu.

## Acceptance criteria

- [ ] Ctrl/Cmd+D duplicates the selected card: fresh UUID, +24px offset, owner = duplicator, no comments, no connections.
- [ ] Bulk bar Duplicate fans copies from the selection bounding box and selects them; one undo reverts the whole batch.
- [ ] Move to tab moves items, deletes only their connections (count shown), preserves x/y, keeps pins/cross-links working; one undo reverts.
- [ ] `editableSelectedItems` gating: players see disabled buttons for others' cards; server merge backstops.
- [ ] Context menu works for single + multi selections, closes on Escape/click-away, doesn't interfere with drag.
- [ ] Undo skip notices appear correctly when a remote edit precedes an undo of a duplicate/move.
- [ ] Unit tests: `duplicateItem` (copy rules, title suffix), `duplicateItems` (fan offsets), `moveItemsToTab` (removal, connection drop count, target append, no-op on missing tab).
- [ ] `npm run lint` and `npm test` pass.

## Open questions

1. Should duplicate copy connections when the original's other endpoint is **also** being duplicated in the same bulk action (clone-subgraph)? (Proposed: v2 — useful for copying encounter groups.)
2. Reset `date` on duplicate? (Proposed: keep original — quests spanning sessions keep context.)
3. Long-press context menu on touch: worth the gesture conflicts with drag? (Proposed: skip in v1; bulk bar + FocusDrawer cover touch users.)
