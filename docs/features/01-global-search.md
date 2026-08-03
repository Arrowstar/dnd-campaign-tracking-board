# Feature 01 — Global Search (Ctrl+K)

**Status:** Proposed · **Priority:** P1 (highest) · **Dependencies:** none (works standalone; integrates with Feature 02 tags when available)

## Summary

Add a command-palette-style global search overlay (Ctrl/Cmd+K) that searches every card on the board — across all tabs — by title, tags, plain-text field content, linked-item titles, and comments. Selecting a result flies the user to the card using the existing `handleScrollToItem` machinery (tab switch + pan/zoom + flash highlight).

**Why:** The board is a free 4000×4000 canvas with 12 card types. The only search today is inside the cross-link picker (`StructuredBoardItemFields.tsx`, ~line 606). DMs routinely run boards with hundreds of cards and cannot find "that tavern NPC from session 3."

## User stories

1. As a DM, I press Ctrl+K, type "nezznar", and jump straight to the NPC card even if it's on another tab.
2. As a DM, I search "secret" and find all cards/fields containing DM-hidden content (which only I can see — see Visibility).
3. As a player, I search "quest" and only see cards and field content I'm permitted to view (field-level visibility is respected).
4. As a user, I can filter results by item type and see which tab each result lives on.

## UX spec

### Trigger & dismissal
- **Open:** Ctrl/Cmd+K anywhere in the board view (also `/` when not typing in a form field is a nice-to-have). A toolbar search button is a fallback.
- **Close:** Escape, click outside, or selecting a result. Preserve focus back to the canvas.
- **Behavior while open:** board stays visible behind a scrim; overlay is centered near the top (viewport width ~560px).

### Overlay contents (`components/GlobalSearchModal.tsx`)
- **Input row:** icon + text input + hint text ("↑↓ to navigate · Enter to open · Esc to close").
- **Results list:** grouped by item type (Characters & Factions, World & Quests, Lore & Resources, Images) or flat with a type badge — flat with badges is simpler and works better with filters.
  - Each row: type badge, title, tab name (right-aligned), and a one-line preview snippet of the matched field (e.g. the matching field label + first ~60 chars of plain text).
  - Tag matches show a `#tag` chip; comment matches show a 💬 marker.
- **Filter chips row:** the 12 item types (multi-select), plus "DM" toggle (DM only — include hidden content) and "Include comments" toggle.
- **Empty state:** "No cards match 'xyz'".
- **Recent items:** when the query is empty, show the last ~8 opened cards (FocusDrawer opens) per user, stored in `localStorage` keyed by board id.

### Result interaction
- **Click or Enter:** call the same navigation path as cross-link chips → reuse `handleScrollToItem` (Board.tsx:1319) so behavior is identical (switch tab if needed, center, flash highlight).
- **After navigation:** close the overlay, then open nothing else (unlike cross-links, search should not open the FocusDrawer — user asked to go *to* the card; opening the drawer is optional. Recommend: navigate only; hold Shift+Enter to open the FocusDrawer).

## Data model changes

None. All data already exists in the loaded `BoardState` (per-tab `items`).

## Search index (client-side)

Build once per board load (and on visibility-scrubbed state changes) with `useMemo`:

```
extractSearchableText(item: BoardItem): string[]
```

- `item.title`
- `item.tags` (match as `#tag` and as plain token)
- `item.content` — strip HTML for rich text; for image-type items the URL is NOT indexed.
- `item.fields[]` — index `label` + `textValue` (run `getPlainText` from `lib/crossref.ts` to flatten `@@MULTILINK` values; strip HTML tags from rich text).
- `item.comments[].text` and `item.comments[].userName` (only if "include comments" is on).
- `ownerName`.

**Visibility filtering** (critical): before indexing, apply the same rules the render path uses:
- `canViewField(field, item, {id, role})` from `lib/fieldVisibility.ts` — skip content of fields the viewer cannot see (but *do* index the field label so a DM-only field is still findable by its label for the DM; players should not see those labels either — players get labels of hidden fields scrubbed? No — `scrubItemForUser` keeps id/label/type/visibility but strips content, so labels ARE visible to players. Index labels only when content is viewable, or always index labels but never content for hidden fields. **Decision: index label always, content only when viewable.**)
- Item-level `visibility: 'dm' | 'owner'`: DM sees everything; players see `all` items and their own `owner` items (mirror existing behavior in Board.tsx rendering).

### Matching
- Case-insensitive substring, token-prefix scoring: title match (10 pts) > tag match (6) > field label (4) > field content (3) > comment (1).
- Rank: score desc, then type order, then title asc. Cap at ~50 results.

## Implementation plan

### Files
| File | Change |
|---|---|
| `components/GlobalSearchModal.tsx` | **New.** Overlay + index rendering + keyboard nav. |
| `components/Board.tsx` | Add `openSearch` state; wire Ctrl/Cmd+K and `/` in the keyboard handler (`latestKeyHandlerRef`, Board.tsx:1197); render `<GlobalSearchModal>`; pass `allBoardItems` (already exists — cross-tab list), `user`/`role`, `onNavigate={handleScrollToItem}`. |
| `lib/search.ts` | **New.** `buildSearchIndex(items, viewer)` + `searchIndex(query, filters)`. Pure functions → unit-testable. |
| `components/Toolbar.tsx` | Add search button (Search icon) beside undo/redo. |

### Keyboard wiring (important detail)
The existing keydown handler (Board.tsx:1199–1305) returns early when `e.metaKey || e.ctrlKey || e.altKey` (line 1227), so Ctrl+K currently falls through to nothing. Wire the shortcut **before** that guard:

```ts
// In latestKeyHandlerRef, before the isFormField check:
if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
  e.preventDefault();
  setOpenSearch(true);   // state setter must be stable via the ref pattern
  return;
}
```

Note the ref pattern: `latestKeyHandlerRef.current` is reassigned every render, so a plain `setOpenSearch` closure is safe there.

While the modal is open, suppress the board-level shortcuts (early-return when `openSearch`), and the modal's own input must capture arrow keys / Enter before they hit the board handler (the board handler already ignores events from focused form fields — the modal input will be focused, so this is mostly free; still add an explicit guard).

### Navigation
`handleScrollToItem` (Board.tsx:1319) already:
1. Finds the owning tab and switches `activeTabId` if needed.
2. Waits a tick, then centers the item with `setTransformRef.current(...)`.
3. Flash-highlights the card (existing behavior — verify where the flash class is applied and reuse).

### Index freshness
Rebuild when: board load, poller applies a remote revision, or a local save completes. `allBoardItems` is derived via `useMemo` already — key the search index off the same inputs (`tabs`/`allBoardItems` + `user`). For boards with > 300 cards, defer index build with a microtask/rAF and show a subtle "Indexing…" state; at < 1000 cards this is instant.

## Edge cases & conflicts

- **Hidden-content leakage:** the scrub + `canViewField` rules above are the only guard. Server never changes; search is purely client-side over the *scrubbed* state a user already received, so there is no new leak surface beyond what rendering already allows.
- **Cross-tab results:** navigation must work when the item is on a non-active tab (already handled by `handleScrollToItem`).
- **Deleted items mid-search:** re-check the item still exists in `allBoardItems` before navigating (it may have been deleted by a remote user while the modal was open).
- **Minimized items:** still searchable (they're normal items).
- **`isContentEditable` focus:** if the user is typing in Tiptap or a textarea, Ctrl+K should still work (like Ctrl+Z does) — wire before the form-field guard.
- **Mobile:** no keyboard; the toolbar search button covers this. Overlay should be full-width on small screens.
- **Multiple matches in one card:** show the card once, snippet from the best-matching field.

## Rollout / migration

None — client-only feature. Ships behind the toolbar button even if keyboard shortcut is missed.

## Acceptance criteria

- [ ] Ctrl/Cmd+K opens the overlay from anywhere on the board; Escape closes it.
- [ ] Typing 3+ chars returns results across all tabs with type badge + tab name + snippet.
- [ ] Enter/click navigates to the card (tab switch, center, flash) and closes the overlay.
- [ ] Player accounts never see content from `dm`/`owner`-visibility fields in search results.
- [ ] DM search finds DM-hidden content; results show a lock/diamond marker.
- [ ] Type-filter chips work; empty query shows recent cards from `localStorage`.
- [ ] `/` opens search when focus is not in a form field.
- [ ] No regressions in existing Ctrl+Z/Y/Delete handling (test while modal open).
- [ ] Search index unit tests pass (`lib/search.ts`): substring, tag, link-token, HTML-stripped content, visibility scrub.

## Open questions

1. Should Shift+Enter open the FocusDrawer from a result? (Proposed: yes, cheap.)
2. FTS overkill? If boards exceed ~1500 cards, consider PG full-text search via a server route — out of scope for v1.
3. Should search include board-level settings/tab names? (Nice-to-have; skip v1.)
