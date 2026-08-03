# Feature 02 — Tags

**Status:** Proposed · **Priority:** P1 · **Dependencies:** none hard; integrates with Feature 01 (search) and shares multi-select groundwork with Feature 04 (duplicate/move)

## Summary

`BoardItem.tags: string[]` has existed in the data model since the beginning (initialized to `[]` at Board.tsx:900) but **nothing reads or writes it**. This feature wires tags into the full lifecycle: editing on cards, chips on the canvas, a filter bar, and (with Feature 01) search. Tags are the DM's primary lightweight organization tool — complementing the free-form canvas — and unlock bulk operations shared with Feature 04.

**Scope guardrail:** multi-select + bulk operations are shared infrastructure with Feature 04. Implement them once (this doc describes the shared design; Feature 04 consumes it).

## User stories

1. As a DM, I tag quests with `#main-story` and NPCs with `#villain`, then click a chip on any card to highlight all cards with that tag.
2. As a DM, I tag 20 NPC cards at once (bulk) with `#red-larch` after session prep.
3. As a player, I filter the board to `#loot` to see only loot cards when the party divides treasure.
4. As a DM, I define a tag color (e.g. red for villains) so the board reads at a glance.
5. As a DM, I search `#red-larch` in Feature 01 and get all matching cards.

## UX spec

### Tag model
- **Storage:** tags remain `string[]` on `BoardItem`. Tags are lowercase, trimmed, `[a-z0-9-]+`, max 24 chars, max 8 tags per card.
- **Board-level tag definitions:** `settings.tagDefs: Record<string, { color?: string }>` added to `BoardSettings` (lib/types.ts). Definitions are optional decoration — a tag with no def still works (default gray). Keeps the data model additive and backward compatible.
- **DM ownership of defs:** only the DM can create/rename/recolor definitions (same rule as `cardFontScale` in the settings save path — see state route). Players can still *apply* any existing tag to cards they may edit.

### Card chips (BoardItem.tsx)
- Full-card LOD: a chip row under the header (or overlaid bottom-left, above the owner line), max 4 chips visible + "+n". `minimized` cards show chips too.
- Chip: `#label` pill, background = tag color (or derived gray), dark/light text by luminance (`isLightColor` pattern already exists in FocusDrawer.tsx:63).
- **Click chip → filter mode** (not just select): clicking toggles a board-wide tag filter (see Filter bar).
- Image-compact LOD: show up to 2 chips overlaid at bottom-right.

### Filter bar (Toolbar area)
- When a tag filter is active, show a floating pill row (top-center, below the toolbar): active filter chips with an × per chip + "Clear" button.
- **Filter semantics (default):** dim non-matching cards to ~25% opacity and show a "Filtering by #x — showing N of M" hint. **Toggle in the row:** "Hide non-matching" — dimming is the default because the canvas layout (positioning) is the primary spatial metaphor; hiding breaks orientation.
- Filtering is per-user and per-tab-independent: it applies across all tabs (indicator persists when switching tabs). Applied to `allBoardItems` before the visibility/zoom LOD pipeline in Board.tsx.
- Multi-tag filter = OR (any tag matches). Document as v1 decision; AND is a one-line change if DMs want it later.

### Tag editor (FocusDrawer)
New "Tags" section above Comments (or a small popover next to the title):
- Chips of current tags with × to remove.
- Add input with datalist autocomplete from all tags in use across the board + defined defs.
- When adding a tag with no def, offer an inline color swatch row (8 presets) that creates the def (DM only; players just get default gray).

### Bulk tagging (shared multi-select infrastructure)
- **Select:** click = single select (existing); Ctrl/⌘ or Shift-click = add/remove from selection; drag on empty canvas = rubber-band select (marquee over item bounds — items have known x/y/w/h, so a rect intersection test in Board.tsx is straightforward).
- **Selection chrome:** selected cards get the existing gold ring (reuse current selection style); a floating "Bulk bar" appears bottom-center: `N selected` + actions [Tag…] [Duplicate] (F04) [Move to tab] (F04) [Delete] [Clear].
- **Tag… action:** small popover, same tag editor UI as FocusDrawer; applies to all selected cards (respecting per-item edit rights — see Edge cases).
- Escape clears selection; Delete (with selection > 1) deletes all selected after a confirm (`n cards will be deleted`).

## Data model changes

```ts
// lib/types.ts — BoardSettings
export type TagDef = { color?: string };
export type BoardSettings = {
  cardFontScale?: number;
  tagDefs?: Record<string, TagDef>;   // NEW
};
```

`BoardItem.tags` already exists — no change.

## Server / API changes

- **None** for tags themselves: tags ride along in `tabs` JSONB and survive the existing `mergeTabsForSave` path unchanged.
- **Settings merge:** the state route already merges settings shallowly: `{ ...storedSettings, ...settings }` (state/route.ts:92). Nested `tagDefs` must merge per-key instead, else one client's tag defs wipe another's:

```ts
// state/route.ts — DM settings branch
const mergedSettings = {
  ...storedSettings,
  ...settings,
  tagDefs: { ...(storedSettings.tagDefs ?? {}), ...(settings.tagDefs ?? {}) },
};
```

**Privacy check:** tags are not sensitive content — no scrubbing. (A tag named `#secret-villain` is metadata; if this becomes a concern, treat tags like fields later.)

## Implementation plan

### Files
| File | Change |
|---|---|
| `lib/types.ts` | Add `TagDef`; extend `BoardSettings`. |
| `app/api/boards/[boardId]/state/route.ts` | Deep-merge `tagDefs` in the settings branch. |
| `components/Board.tsx` | `tagFilter: string[]` state; filter/dim logic in the item render path; multi-select state (`selectedItemIds: Set<string>`) + marquee; bulk bar render; pass handlers to `BoardItem` and a new `BulkTagPopover`. |
| `components/BoardItem.tsx` | Chip row render; chip click → `onToggleTagFilter`; ctrl/shift-click selection handling. |
| `components/FocusDrawer.tsx` | Tags section editor (add/remove/color). |
| `components/Toolbar.tsx` | Nothing required; filter row lives in Board.tsx above the canvas. |
| `lib/tags.ts` | **New.** `normalizeTag`, `mergeTagDefs`, `tagColor(tag, defs)` helpers. |

### Filtering pipeline placement
In Board.tsx the visible-item list is derived per tab. Apply `tagFilter` at the same point visibility filtering happens, producing `visibleItems`; keep dimmed items in the DOM (motion.div with `opacity: 0.25`, pointer-events preserved so they can still be clicked) unless "hide" mode is on.

### Multi-select ownership rules (must match server merge semantics)
`mergeTabsForSave` (lib/fieldVisibility.ts:80) lets non-DMs edit **only their own items** (plus comments on others'). Therefore bulk actions must silently skip items the user cannot edit: show "3 of 5 selected can be edited" in the bulk bar. DM sees all.

## Edge cases & conflicts

- **Concurrent tag edits:** tags are part of the item JSON; last-write-wins per item (same as every other field). Acceptable; Feature 05 (history) mitigates.
- **Renaming a defined tag:** with defs stored in settings but tags stored on items, a rename must rewrite every item's `tags` array. Do it client-side in one save; server merge keeps it. Alternatively treat defs as pure decoration (no rename, only color). **v1 decision: defs are decoration-only (no rename)** — rename is a v2 nicety.
- **Player-deleted DM tag:** can't happen — players may only edit their own items; deletion of a tag from a player-owned item is their prerogative.
- **Marquee on a panned/zoomed canvas:** compute marquee in canvas coordinates (`(screenX - positionX)/scale`), using the same transform math as `handleAddItem` (Board.tsx:876).
- **Performance:** dimming hundreds of cards is fine (opacity is cheap); the index of tags-per-card is trivial.

## Rollout / migration

- No DB migration: `tags` and `settings.tagDefs` are both JSONB and additive.
- Optional one-off: seed `tagDefs` colors from a hash of existing tag names so old tags aren't all gray (`scripts/` pattern already exists, e.g. `migrate-embedded-images.ts`).

## Acceptance criteria

- [ ] Existing boards load with no tag regressions; cards without tags render unchanged.
- [ ] Adding/removing tags on a card via FocusDrawer saves through the normal save path and appears on the canvas chip row.
- [ ] Clicking a chip filters the board (dim non-matching), works across tabs, and shows the active-filter pill row.
- [ ] Ctrl/Shift-click and marquee select multiple cards; bulk bar appears with Tag/Delete; bulk tag applies only to editable cards (players see the "3 of 5" hint).
- [ ] DM-defined tag colors persist across reload and are not wiped by a concurrent player save (deep merge test).
- [ ] `#tag` search works once Feature 01 lands.
- [ ] Undo/redo (Board.tsx:640) restores tag/bulk operations.

## Open questions

1. AND vs OR multi-tag filtering (v1: OR).
2. Should tag chips appear on pin-card LOD? (Proposed: no — pins are icon+label only.)
3. Is marquee selection worth it in v1, or ctrl/shift-click only? (Proposed: click-only for v1, marquee v1.5 — it's ~30 lines and high value for DMs with dense boards.)
