# Feature 11 — Global Undo Across Syncs (persistent, remote-safe undo/redo)

**Status:** Proposed · **Priority:** P2 · **Dependencies:** none hard; its delta design also relieves the client-memory pressure called out in Feature 12, and it must tolerate Feature 05 (server history restore) when that ships

## Summary

Undo/redo today is **snapshot-based and in-memory only** (Board.tsx:361–374, 717–770):

- Every local mutation records `{ before, after }` snapshots of the **full tabs array** (plus active tab id) into `undoStackRef`/`redoStackRef` (refs — they die on refresh, navigation, or remount).
- `HISTORY_LIMIT = 50` and `COALESCE_MS = 1000` (Board.tsx:47–48); coalescing merges same-`key` mutations within 1s **only when `last.after.tabs === prevTabs`** (reference equality, Board.tsx:729) — a deliberate guard against merging across a remote realtime apply.
- Remote applies (`applyFullState`, Board.tsx:561) call `setTabs(freshTabs)` directly and never touch the history — but they leave **stale snapshots behind**: entries recorded before the remote apply still hold whole-board `before`/`after` copies from an older world state.

**Two real problems this feature fixes:**

1. **Undo can clobber remote work.** `handleUndo` (Board.tsx:746) does `setTabs(entry.before.tabs)` then `persistBoardState(entry.before.tabs)` — it re-saves the *stale snapshot wholesale*. The server-side `mergeTabsForSave` only protects hidden fields and ownership; it does **not** protect content another user added between the snapshot and the undo. Undoing "my typo" can silently delete your teammate's new quest card.
2. **History evaporates on refresh.** The stack lives in refs. A refresh — or a slow-phone tab re-mount — wipes 50 steps of undo, and the "oh no" moment always happens after a reload.

**Design:** switch from full-board snapshots to **id-keyed deltas** (what changed, per item/connection/annotation/tab), persist the stacks to `localStorage`, and make undo/redo **reconcile against the current state** instead of restoring a stale world.

## User stories

1. As a DM, I press Ctrl+Z after a page refresh and my last five edits still undo — the history survived the reload.
2. As a DM, I undo an edit I made this morning's session, two refreshes ago; only *my* changes revert — cards a player added in between stay on the board.
3. As a user, if a player edited the same card I'm about to undo, the undo skips that card and tells me ("1 step skipped — the board changed").
4. As a user, my undo history is private to me: it never syncs to other members, and switching accounts on the same machine shows no one else's steps.

## Current state (verified line refs)

- `HistorySnapshot = { tabs: BoardTab[]; activeTabId: string }`; `HistoryEntry = { key, time, before, after }` — Board.tsx:366–374.
- `recordHistory(prevTabs, nextTabs, key, nextActiveTabId?)` — Board.tsx:717. `before` is `structuredClone`d (Board.tsx:740); `after` is the **same reference** as the new tabs (used for the coalescing equality check); `redoStackRef` cleared on any new branch (Board.tsx:736); stack trimmed to `HISTORY_LIMIT` (Board.tsx:743).
- `handleUndo`/`handleRedo` — Board.tsx:746/759: pop → push to the other stack → `setTabs` + `setActiveTabId` → `persistBoardState` (server save) → clear selection → prune `focusedItemId` if the item vanished.
- All local mutations funnel through `saveState` (Board.tsx:773) or `saveFullTabsState` (Board.tsx:868), both of which call `recordHistory` with a `historyKey` — so **one integration point** (inside `recordHistory` + the two handlers) covers every mutation type.
- The realtime poller (Board.tsx:595–635) is the only other writer of `tabs`; `appliedRevisionRef` (Board.tsx:359) tracks the last applied remote revision.
- No `localStorage` persistence exists for history today (verified: no localStorage usage in Board.tsx).

## Design

### 1. Delta representation (`lib/undoHistory.ts` — new, pure, unit-testable)

```ts
type DeltaEntry<T extends { id: string }> = {
  before: Record<string, T>;   // id → value before the mutation (for changed/removed ids)
  after:  Record<string, T>;   // id → value after  the mutation (for changed/added ids)
};
type HistoryPatch = {
  items: DeltaEntry<BoardItem>;
  connections: DeltaEntry<Connection>;
  annotations: DeltaEntry<BoardAnnotation>;
  tabs: DeltaEntry<BoardTab>;   // tab add/rename/recolor/reorder/delete
};
type UndoEntry = { key: string; time: number; patch: HistoryPatch };
```

- `computeDiff(beforeTabs, afterTabs): HistoryPatch` — for each of the four collections, diff by id: `before = {id: value}` for ids in `before` but not identical in `after` (changed or removed); `after = {id: value}` for ids in `after` but not identical in `before` (changed or added). **Reference-equality shortcut:** reuse the existing `last.after.tabs === prevTabs` coalescing check for the *snapshot* merge; the diff is computed fresh each step.
- Size estimate: a typical edit diff is a handful of ids × a few KB of item JSON; 50 entries ≈ tens of KB — versus 50 × full board (up to 50 × 4 MB = 200 MB in memory today, and the same again in JSON if we had naively persisted snapshots).
- Item JSON can be large (rich text, file lists). Cap a single entry's serialized size (e.g. 256 KB); if exceeded, drop the *oldest* entries first (see persistence).

### 2. Applying a patch on top of the CURRENT state

```ts
function applyPatch(currentTabs: BoardTab[], patch: HistoryPatch, dir: 'undo' | 'redo'): {
  tabs: BoardTab[]; skipped: string[];
}
```

- **Undo:** for each collection, take the `before` map and reconcile per id:
  - id in `before`, exists in current **and current value matches `patch.after[id]`** → replace with `before[id]` (clean revert of my own edit).
  - id in `before`, exists in current but value **differs from `after[id]`** → skip, add to `skipped` (someone else edited it since — never clobber remote work).
  - id in `before` but **not in current** → skip silently (deleted remotely; don't resurrect).
  - id in `after` but not in `before` → delete from current (this was my "add").
  - **Remote-only ids (in current, in neither map) → untouched.** This is the property that makes undo safe across syncs: the patch can only touch ids the local user mutated.
- **Redo:** mirror with `after`; same skip rules (skip when current ≠ `before[id]`).
- Tabs: reorder/rename/delete are per-id too; `activeTabId` stored alongside (entry keeps `activeTabId` before/after like today).
- Return `skipped` so the UI can surface "N step(s) skipped because the board changed."

### 3. Persistence (`localStorage`)

- Keys: `dnd_undo_<userId>_<boardId>` and `dnd_redo_<userId>_<boardId>` — **user-scoped** (no cross-account leakage on a shared machine) and board-scoped. Version suffix in the payload (`{ v: 1, entries: [...] }`); on version mismatch, discard.
- Write: debounced (e.g. 500 ms) after `recordHistory` / `handleUndo` / `handleRedo`. Read: once on mount (Board's state-load effect), hydrated into the refs; `undoCount`/`redoCount` states computed from the refs already (Board.tsx:379–382) so the toolbar buttons light up immediately.
- Size cap: 1 MB per key; when exceeded, drop oldest entries (serialized size tracked per entry at write time).
- Cleanup: remove the key when the board is deleted (F07 flow already clears board-scoped state) and on logout (`dnd_session` is cleared there — piggyback or do it in the lobby's logout path).
- Storage-failure tolerance: wrap reads/writes in try/catch (private mode `localStorage` throws); history silently degrades to in-memory.

### 4. Integration (Board.tsx)

- `recordHistory`: keep the coalescing branch (same `key` + window + reference-equality check) but merge the diff by recomputing `computeDiff(last.beforeTabs, nextTabs)` — the coalesced entry grows; **the snapshot-of-truth for coalescing is the first `before` plus accumulated `after`** (track both internally, serialize only the patch). `structuredClone(prevTabs)` disappears from the hot path (only the diff is computed); this also fixes the memory cost (see Feature 12).
- `handleUndo`/`handleRedo`: `applyPatch(currentTabs, entry.patch, dir)` → `setTabs(reconciled.tabs)` → `persistBoardState(reconciled.tabs)` (**never the raw snapshot** — this is the clobber fix) → existing selection/focus pruning → if `skipped.length > 0`, set a transient toast "N undo step(s) skipped — the board changed" (reuse the existing `saveStatus`/'syncing' pill or a new inline notice).
- The poller (`applyFullState`) needs **no change**: patches are applied relative to current state at undo time, so a remote apply in between just makes some ids "differ from `after`" → skipped, never clobbered.

### 5. Interaction with Feature 05 (server history restore) and Feature 07

- F05 restore bumps `updated_at` → poller applies full state → current state differs from all entries' `after` values → subsequent undos skip conservatively (correct: the world changed under us). No special handling needed beyond the skip rule.
- F07 board deletion → localStorage key cleanup (section 3).

## Files

| File | Change |
|---|---|
| `lib/undoHistory.ts` | **New.** `computeDiff`, `applyPatch`, `serializeHistory`/`deserializeHistory`, size caps. Pure functions + tests. |
| `lib/undoHistory.test.ts` | **New.** Diff/apply/skip/merge-coalescing tests. |
| `components/Board.tsx` | Swap `recordHistory` internals to patches; rewrite `handleUndo`/`handleRedo` to `applyPatch` + `persistBoardState(reconciled)`; hydrate from/persist to localStorage; skipped-step toast. |
| Lobby (`app/page.tsx`) | Clear `dnd_undo_<userId>_*` on logout. |

## Edge cases & conflicts

- **Two tabs open on the same board in one browser:** same `userId`+`boardId` key — last write wins; the tab that reloads later hydrates the other tab's history. Acceptable (rare), documented.
- **Undo right after a remote apply with an untouched selection:** the coalescing reference-equality guard already prevents merging into the wrong entry; `applyPatch` skips instead of clobbering.
- **Deleted-and-recreated id (uuid collision):** uuids are unique per item; a recreated item has a new id, so `after` map entries for the old id find "not in current" → skip. Correct.
- **Huge item payloads in a delta:** per-entry size cap (section 1) + oldest-first eviction; rich text on one card is typically < 100 KB.
- **Mid-edit undo (typing in Tiptap):** Tiptap keeps its own undo (exempt today, Board.tsx:1418–1421) — unchanged.
- **`focusedItemId` pruning after undo:** existing logic checks whether the focused id still exists; keep, but it must run against the *reconciled* tabs, not the snapshot.

## Acceptance criteria

- [ ] Refresh preserves the undo stack (same user + board); toolbar Undo lights up and steps revert after reload.
- [ ] Undo never removes or overwrites ids the user didn't mutate: two-session test (Browser A edits item X; Browser B adds item Y and edits item X; B undoes → Y stays, X's B-edit is skipped with a toast).
- [ ] Coalescing still merges per-keystroke typing into one step (behavior parity with today).
- [ ] Redo mirrors undo symmetrically, including skip rules.
- [ ] localStorage writes are debounced, capped at 1 MB/key, versioned, and fail silently in private mode.
- [ ] Logout and board deletion clear the keys.
- [ ] Unit tests for `computeDiff`/`applyPatch` cover: clean revert, remote-edited-id skip, remote-deleted-id skip, my-add undone, reorder/rename/delete of tabs, coalesced entry merge.
- [ ] `npm run lint` and `npm test` pass.

## Open questions

1. Should the skipped-step toast be a blocking notice or a passive pill? (Proposed: passive pill, auto-dismiss ~3 s.)
2. Persist redo across reloads too, or only undo? (Proposed: both — symmetric, and cheap since entries are shared.)
3. Should history survive account switch on the same board (same boardId, different userId)? (Proposed: no — keys are user-scoped by design.)
