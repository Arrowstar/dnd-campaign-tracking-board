# Feature 05 — Board History & Restore

**Status:** Proposed · **Priority:** P2 (data-safety before feature-growth; ship early) · **Dependencies:** none

## Summary

Today the entire board is one JSONB column (`boards.tabs`) with a single `updated_at` revision. Every save is last-write-wins; a bad merge, a mis-clicked Delete, or a malicious player can destroy hours of DM prep with **no recovery path** — undo is client-local and dies on refresh. This feature adds server-side versioned snapshots of board state with DM-only restore:

1. **Snapshot capture** — throttled automatic snapshots in the save path + manual DM "Checkpoint" button.
2. **History browser** — DM-only modal listing snapshots (time, author, change summary).
3. **Restore** — DM restores any snapshot; all connected clients reload (existing revision-poll machinery does this for free).

Phase 2 (deferred, spec'd): snapshot *diff* view and per-item "restore single card" (recover a deleted card without rolling back the board).

## User stories

1. As a DM, I accidentally delete the quest board; one click restores it from 20 minutes ago.
2. As a DM, a player's botched edit corrupts a card; I restore last night's snapshot, losing < a few hours of edits (documented tradeoff).
3. As a DM, I click "Checkpoint" before a big session-prep session so I have a clean rollback point.
4. As a DM, I see a change summary ("+3 items, −1 item, 2 titles changed") before restoring.

## Data model changes

### New table (`lib/db.ts` — add to `ensureSchema`)
```sql
CREATE TABLE IF NOT EXISTS board_history (
  id BIGSERIAL PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  snapshot JSONB NOT NULL,          -- { tabs: [...], settings: {...} }
  created_by UUID,                  -- sessions.users.id; NULL for automatic captures
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reason TEXT,                      -- 'auto-throttle' | 'checkpoint' | 'pre-restore'
  change_summary JSONB              -- { addedItems, removedItems, changedTitles } | NULL
);
CREATE INDEX IF NOT EXISTS board_history_board_id_idx ON board_history (board_id, created_at DESC);
```
Neon serverless + `ensureSchema` are idempotent — same pattern as existing tables. `ON DELETE CASCADE` means **board deletion** (not yet implemented, but planned) cleans up history for free.

### Snapshot capture policy (server, in `POST /api/boards/[boardId]/state`)
Throttle to avoid snapshot-per-save:
- If the board's **last snapshot is older than `HISTORY_CAPTURE_INTERVAL_MS`** (recommend 10 min) → write a snapshot of the **pre-save** stored state.
- **Manual checkpoint:** client calls a new endpoint; always writes a snapshot of current stored state, tagged `reason: 'checkpoint'`, `created_by` = requesting user (DM only).
- **Pre-restore snapshot:** before applying a restore, snapshot current state tagged `'pre-restore'` so a bad restore is itself recoverable.
- **Retention:** keep newest 50 snapshots per board; prune older in the same transaction (`DELETE ... WHERE id IN (SELECT id ... ORDER BY created_at DESC OFFSET 50)`). 50 × full JSONB is cheap (a heavy board ≈ 1–5 MB → ≤ 250 MB worst case per board; prune can be lowered to 20 if needed).

Two queries needed per snapshot: the snapshot itself + the prune. Both are single-row/single-index ops — negligible on the existing save path.

## API changes

### New: `GET /api/boards/[boardId]/history`
- Auth: member check (same as state route). **Returns full snapshots only to the DM**; players get `403`.
- Response: `{ history: [{ id, createdAt, createdBy, reason, summary }] }` — **exclude the snapshot payload** from the list response (list is metadata-only; sizes add up).

### New: `GET /api/boards/[boardId]/history/[historyId]`
- DM-only. Returns `{ snapshot }` for preview (Phase 2 diff UI consumes this; v1 can skip if the diff is computed client-side from the list — **v1: include a precomputed `change_summary` in the list and skip this route entirely**).

### New: `POST /api/boards/[boardId]/history/[historyId]/restore`
- DM-only. Behavior:
  1. Snapshot current stored state (`reason: 'pre-restore'`).
  2. `UPDATE boards SET tabs = <snapshot.tabs>, settings = <snapshot.settings>, updated_at = NOW()`.
  3. Return `{ success, updatedAt }`.
- **Client propagation is automatic:** the revision poller (Board.tsx:499–548) sees `updated_at` change on the next poll and re-downloads the full state; the restoring DM's own client does the same (their echo tells them to re-fetch — verify the poller skips only its own in-flight save echo).
- **Validation:** history row must belong to this board; snapshot payload must parse; cap snapshot size (reject > 10 MB) at capture time so restore can never blow the function body limit.

## UX spec

### Modal: `components/BoardHistoryModal.tsx`
- DM-only entry point: new "History" button in the toolbar's settings cluster (Toolbar.tsx) and inside `BoardSettingsModal`.
- List (newest first): relative timestamp + clock time, author name (or "Automatic"), reason chip (Checkpoint / Auto / Pre-restore), change summary line ("+3 items · −1 item · 2 titles changed").
- Row actions: **Restore…** (confirm dialog: "Restore the board to <timestamp>? Current state is saved first and can be restored from History.") and **View** (Phase 2 diff — hidden in v1).
- **Checkpoint button** at the top of the modal (also exposed as a toolbar icon for speed).
- Empty state: "No history yet. Snapshots are captured automatically every ~10 minutes while the board is edited."

### Restore confirmation
- Modal-style confirm, not `window.confirm` (matches existing app patterns — no native confirms anywhere in the codebase).
- Text spells out the tradeoff: *"Any changes made since <timestamp> will be replaced. The current state is saved as a snapshot first."*

### Client behavior after restore
- The restoring DM: close history modal; the poller re-fetches; `appliedRevisionRef` update causes full re-render (existing machinery at Board.tsx:516–528). If the DM has **unsaved local edits**, they will be merged on top by `mergeTabsForSave` on their next save — **this is dangerous** (restored-deleted items could be resurrected). Mitigation for v1: after a successful restore, **clear the client's undo stack and local pending-edit flag** (set a `pendingReload` state that forces a full replace of local `tabs` — the poller path already replaces wholesale; verify and reuse it).
- Other clients: poller picks up the new revision; their unsaved edits can still resurrect content (last-write-wins). Accepted for v1; documented in the modal copy: "Players with unsaved edits may overwrite the restore — ask them to reload."

## Implementation plan

### Files
| File | Change |
|---|---|
| `lib/db.ts` | Add `board_history` table + index to `ensureSchema`. |
| `lib/history.ts` | **New.** `captureSnapshot(sql, boardId, reason, userId)`, `pruneHistory(sql, boardId, keep)`, `computeChangeSummary(before, after)` (item-id set diff + title-diff count). |
| `app/api/boards/[boardId]/state/route.ts` | Throttled capture inside the tabs-save branch (after `UPDATE`, read old `updated_at`/last snapshot time in the same SELECT). |
| `app/api/boards/[boardId]/history/route.ts` | **New.** GET metadata list (DM-only). |
| `app/api/boards/[boardId]/history/[historyId]/restore/route.ts` | **New.** POST restore (DM-only). |
| `components/BoardHistoryModal.tsx` | **New.** List + restore + checkpoint. |
| `components/Toolbar.tsx` / `components/BoardSettingsModal.tsx` | History entry points. |
| `components/Board.tsx` | Wire modal; force local state replacement after restore (reuse poller replace path); clear undo stack on restore. |

### computeChangeSummary
```ts
function computeChangeSummary(before: BoardTab[], after: BoardTab[]): {
  addedItems: number; removedItems: number; changedTitles: number;
} {
  const idOf = (t: BoardTab[]) => new Set(t.flatMap(tab => tab.items.map(i => i.id)));
  // count by set difference; changedTitles = ids present in both whose title differs
}
```
Stored at capture time (so the list route needs no heavy compute).

## Edge cases & conflicts

- **Restore + concurrent saves from other clients:** last-write-wins merge can resurrect deleted items. v1 accepted (see UX copy). Phase 2 idea: a `historyEpoch` column — saves from clients whose loaded `updated_at` predates the restore get rejected with a "please reload" error. **Recommend implementing `historyEpoch` as part of v1** — it's one int column + one comparison in the save route, and it closes the resurrection hole.
- **Snapshot of pre-save vs post-save state:** capture the *stored* state *before* the save applies (that's what the throttle reads anyway). The most recent snapshot therefore lags live state — that's fine and correct for "undo point" semantics.
- **Large boards:** 50 snapshots × 5 MB = 250 MB per board is real. Make `KEEP` a constant (50) and log prune counts; revisit with per-item storage later.
- **History for deleted boards:** CASCADE handles it once board deletion exists.
- **Timestamps:** use `updated_at` ordering ties — `created_at` in the history table is authoritative; the board's `updated_at` jumps around on restore. Sorting by history `created_at` is deterministic.

## Rollout / migration

- Schema adds a table — `ensureSchema` runs on every warm start; no manual migration.
- Optional backfill: on first save after deploy, the throttle captures within 10 minutes. No action needed.

## Acceptance criteria

- [ ] Editing a board for >10 min produces an automatic snapshot; a checkpoint button always writes one immediately.
- [ ] DM sees history list with author/reason/summary; players get 403.
- [ ] Restore replaces tabs+settings, bumps `updated_at`, saves pre-restore snapshot; all clients reload (test with two browser windows).
- [ ] A client with unsaved edits cannot resurrect content after a restore (historyEpoch check).
- [ ] Pruning keeps newest 50; no history row growth beyond bound.
- [ ] Undo stack cleared after restore; no stale local state.
- [ ] Restore of an invalid/corrupt snapshot is rejected with a clear error, current state untouched.

## Open questions

1. History interval: 10 min good, or tie to "N saves since last snapshot" instead? (Proposed: both — whichever fires first.)
2. Should players be able to *request* restore (DM approves)? (Proposed: no — DM-only, keeps attack surface small.)
3. Phase 2 per-item restore: worth it? (Proposed: yes — "undelete this one card" is the #1 DM recovery ask; the diff machinery is already in place.)
