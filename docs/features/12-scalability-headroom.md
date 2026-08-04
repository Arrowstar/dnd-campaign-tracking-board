# Feature 12 — Scalability Headroom

**Status:** Implemented (Phases 0–2.5, deployed Aug 2026) · **Priority:** P3 (enabling — nothing breaks today, but the ceilings are real and already partially wired) · **Dependencies:** Feature 11 (its delta-based undo removes the client-memory amplifier); Feature 06 already caps export/import payloads

## Summary

The board is stored as **one JSONB blob per board** (`boards.tabs`) and shipped whole on every load and every remote change. That's fine at the current scale (a handful of boards, tens of cards) but has four hard ceilings:

1. **Save cost is O(board) per edit.** Every save does read-modify-write on the full `tabs` JSONB: `SELECT tabs` → `mergeTabsForSave` → `syncLinkTitles` → `UPDATE ... tabs = $jsonb` (state/route.ts:71–81). Two editors typing simultaneously each serialize several MB per keystroke-batch.
2. **Client hard-blocks saves > 4 MB** (Board.tsx:663–671) — that's already a functional ceiling, not a performance one. Vercel's function/JSON limits (~4.5 MB) are the server-side version of the same wall.
3. **Fan-out amplification.** Every save bumps `updated_at`; every connected client's 3 s poller (`POLL_INTERVAL_MS`, lib/viewNavigation.ts:12) then re-downloads the **entire board**. N editors × M saves = N × board bytes over the wire, per edit burst.
4. **`my-boards` scans the whole `boards` table.** `SELECT id, members FROM boards` + client-side filter (my-boards/route.ts:14–22). Fine at 10 boards, wasteful at 1,000.

Plus a client-memory amplifier: snapshot-based undo holds up to 50 full-board clones (Board.tsx:47, 740) — Feature 11 replaces this with deltas.

**Strategy:** cheap wins first (indexes, query shape, guardrails, metrics) — then one structural change (per-item rows) that fixes the O(board) save cost for good. Phases are independent; Phase 1 alone probably doubles usable board size.

## Phase 0 — Measure (do first, no code shipped without numbers)

- **Server-side logging:** in the state POST route, log `boardId`, payload bytes (from `Content-Length`), and `pg_tablespace_size`-style byte count of the tabs JSONB (or `octet_length(tabs::text)` in a cheap SELECT on save). Log p95 save latency.
- **Ad-hoc stats endpoint** (dev-only or DM-only): board count, largest boards by bytes, member count per board, active session count. `SELECT id, octet_length(tabs::text) AS bytes FROM boards ORDER BY bytes DESC LIMIT 20` is enough for a dashboard query.
- **Targets:** record the current max board size and p95 save latency as the baseline; re-measure after each phase.

## Phase 1 — Cheap wins (each is a small, safe PR)

### 1.1 GIN index on `boards.members` + query rewrite (biggest bang for the lobby)
- `ensureSchema` (lib/db.ts): `CREATE INDEX IF NOT EXISTS boards_members_gin_idx ON boards USING GIN (members);`
- Rewrite `my-boards/route.ts`:
  ```sql
  SELECT id, members FROM boards WHERE members ? ${user.id};
  ```
  Postgres resolves `?` on a JSONB column via the GIN index → per-user index scan instead of a full-table scan + JS filter. Same response shape; zero client change. (When the members JSONB grows beyond a few MB total, revisit a relational `board_members` table — see Phase 2.)

### 1.2 Response compression
- Vercel gzips responses by default; **verify** `Content-Encoding: gzip` on `/state` GET in prod. JSON of this shape compresses 3–5×; a 3 MB board becomes ~800 KB on the wire. If it's not enabled at the platform edge, add a minimal gzip wrapper in the route (or `middleware.ts` for `/api`). No action needed if already gzipped — just record it.

### 1.3 Board size guardrails (make the 4 MB wall visible, not silent)
- Client: keep the existing 4 MB hard block (Board.tsx:663), add a **DM warning at ~2 MB**: a toast/pill "This board is getting large (~2 MB) — consider splitting tabs or running the image migration." Threshold as a constant in `lib/viewNavigation.ts`-style shared lib or Board.tsx.
- Server: reject state POSTs > 4.5 MB with a clear 413-style error instead of failing mid-parse (wrap the `request.json()` read).
- Tie-in: the image migration script (`scripts/migrate-embedded-images.ts`) is the documented remediation — point the warning at it.

### 1.4 Save path micro-optimizations (no shape change)
- `syncLinkTitles` (crossref.ts:241) runs on every save over every field of every item — short-circuit early when the save touches no `fields` (compare against the stored tabs; if identical, skip). Cheap and pure.
- `mergeTabsForSave` is per-item already; the cost is the whole-JSONB read. Phase 2 removes it.

### 1.5 Poll fan-out reduction (cheap first step)
- Keep 3 s polling (it's one tiny SELECT per poll), but make the **full-state refetch conditional**: today every revision change re-downloads everything for every client. Add `GET /state?since=<revision>` (or reuse the revision endpoint with a `bytes` header) — v1 of this is just *logging* how often refetches actually happen and at what payload size, so Phase 2 has numbers.

## Phase 2 — Structural: per-item storage (the real fix)

**Goal:** save cost O(changed items), not O(board); enable per-item merge (already the server's permission model), per-item locking, and Feature 05's per-item restore later.

### Schema (additive, in `ensureSchema`)
```sql
CREATE TABLE IF NOT EXISTS board_items (
  id TEXT PRIMARY KEY,                    -- item uuid (already unique board-wide)
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  tab_id TEXT NOT NULL,
  payload JSONB NOT NULL,                 -- the BoardItem as stored in tabs[].items[]
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS board_items_board_idx ON board_items (board_id, tab_id);
```
`boards.tabs` **stays** as the source of truth for tabs/connections/annotations and the read-side shape; `board_items` is a write-optimized shadow for items only (items are > 95% of the bytes).

### Save path
- Client POSTs the same full `tabs` body (no client change in v1) — or, in v1.5, an items-only delta. Server:
  1. Diff incoming vs stored item sets per tab (ids).
  2. For changed/added items: `INSERT ... ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, tab_id = EXCLUDED.tab_id, updated_at = NOW()`.
  3. For removed ids: `DELETE FROM board_items WHERE board_id = $1 AND id = ANY($2)`.
  4. Update `boards.tabs` as today (keeps GET shape and the revision bump) — the JSONB write remains, but the heavy part (per-field merge validation) can be skipped for unchanged items; and when Phase 2.5 ships the client delta, the whole-board UPDATE disappears.
- Concurrency: Neon serverless + row-level upserts make two editors' saves touch disjoint rows — no read-modify-write contention on the big blob.

### Read path
- `GET /state` reconstructs `tabs` from `boards.tabs` (items come from the JSONB copy — identical to today). No change to the response shape, scrubbing, or client.
- Alternative for Phase 2.5 (lazy tabs): `GET /state` returns tab list + active tab full; item payloads for other tabs fetched on demand (`GET /items?boardId=&tabId=`). Biggest bandwidth win for multi-tab boards; medium client change (Board.tsx already splits state per tab).

### Backfill / migration
- One-time `scripts/backfill-board-items.ts` (dry-run flag, mirrors `migrate-embedded-images.ts`): read all boards' tabs, insert all items into `board_items`. Idempotent via `ON CONFLICT`. Safe to re-run; run after deploy of Phase 2.1, before enabling the write path (or run a dual-write window).

### Phase 2.5 (optional, bundled or later)
- Client-side item deltas: POST `{ ops: [{ type: 'upsert'|'delete', tabId, item }] }` instead of full tabs. The client already tracks mutations per history entry (Feature 11 patches are exactly this shape!) — `recordHistory`'s `HistoryPatch` can be reused as the save body. This makes save bytes ~O(diff) too.

## Phase 3 — Optional future (document, don't build yet)

- **Push updates:** replace 3 s polling with SSE (or WebSocket) for revision changes; keep the poller as fallback. Reduces both latency and request volume. Cost: connection lifecycle in a serverless env (or a small long-lived process).
- **Revision cache:** short-circuit the `updated_at` SELECT with an in-memory (per-instance) or Upstash/Redis cache keyed by boardId; trivial for polling load.
- **Read replica / dedicated Postgres:** only if active boards × members exceed a small multiple of the current scale; Neon's pooler already handles connection churn.
- **Blob GC:** delete orphaned image blobs when items/boards are removed (Vercel Blob supports server-side delete; today nothing cleans up). Independent of everything here.

## Files (Phase 1 + 2)

| File | Change |
|---|---|
| `lib/db.ts` | GIN index on `boards.members`; `board_items` table + index. |
| `app/api/auth/my-boards/route.ts` | `WHERE members ? ${user.id}` rewrite. |
| `app/api/boards/[boardId]/state/route.ts` | Size guard (413), payload logging, (P2) item upsert/delete path, (P2.5) ops body. |
| `app/api/boards/[boardId]/state/route.ts` + `lib/crossref.ts` | (P1) `syncLinkTitles` short-circuit. |
| `components/Board.tsx` | (P1) 2 MB DM warning + constant; (P2.5) send history patches as save ops. |
| `lib/viewNavigation.ts` or `lib/boardLimits.ts` | Shared size-threshold constants. |
| `scripts/backfill-board-items.ts` | **New.** One-time backfill. |
| `lib/scalability.ts` | **New.** Pure helpers: diff item sets, build upsert/delete statements data, payload-size logging formatter. Unit tests. |

## Guardrails summary (current vs target)

| Limit | Today | Target |
|---|---|---|
| Save payload | 4 MB client hard block (Board.tsx:663) | 4.5 MB server 413 + 2 MB DM warning |
| Save cost | O(board) read-modify-write | O(changed items) upserts (P2) |
| Wire per remote change | N clients × full board | same for v1; lazy tabs (P2.5) |
| Lobby query | full-table scan | GIN index scan (P1.1) |
| Client memory | 50 × full-board snapshots | deltas (Feature 11) |

## Verification results (post-deploy, Aug 2026)

**Phase 0 baseline** (`npx tsx scripts/board-stats.ts`):
- 2 boards, 18 sessions. Largest: `silverpine-mystery-campaign-2026` at **1.86 MB** (1 member). Total tabs bytes: **1.87 MB**.

**DB-level checks** (all pass):
- `EXPLAIN` on `WHERE members ? $1` → Bitmap Heap Scan via `boards_members_gin_idx` (GIN is lossy by design; index used, no seq scan).
- `board_items` shadow matches `tabs` item counts exactly (5=5, 4=4 at baseline; 6=6 after live edits) with **0 orphan rows**.
- `jsonb_set` array append semantics verified on Neon PG16 (index == length appends correctly; sequential chain appends `[a][b][c]` in order).
- `jsonb_to_recordset($1::jsonb)` batch upsert + `ON CONFLICT (id) DO UPDATE` verified on a temp table (inserts + conflict-update both work).
- Backfill idempotent: emptied shadow → backfill → 9 rows → re-run → still 9.

**Live production logs** (`[scalability]` lines):
- Card create: `payloadBytes=1090 tabsBytes=1949123 durationMs=436 ops=true upserts=1` — 1 KB delta vs 1.9 MB board.
- Card drag: `payloadBytes=1116 durationMs=376 ops=true upserts=1`.
- Card rename (title change → link-sync fallback): `payloadBytes=1949318 ops=false durationMs=277 upserts=1` — full-save path still correct; shadow synced either way.
- State refetch after save: `responseBytes=1948398`; two open tabs both refetched the rename (propagated in both).

**Not yet observed** (reachable only at larger scale):
- 2 MB DM warning: silverpine sits at ~1.95 MB; triggers automatically as it grows past 2 MB.
- Server 413: requires a > 4.5 MB board; not reachable today (largest is ~1.95 MB).
- 304 `since=` short-circuits: rare by design (poller skips `/state` unless the revision changed); guard verified in code + unit tests.

## Acceptance criteria

- [x] `my-boards` uses the GIN index (EXPLAIN shows bitmap index scan) and returns identical JSON.
- [x] No behavior change on state GET/POST with `board_items` populated (shadow matches `tabs` item sets exactly, 0 orphans).
- [x] Backfill script idempotent (run twice → same rows), dry-run safe.
- [x] Concurrent saves from two sessions produce correct merged state (both tabs propagated edits) with `board_items` upserts.
- [ ] 2 MB warning appears for DMs only; 4 MB block unchanged; server rejects > 4.5 MB with a clear error, no crash. *(413 and 2 MB untestable until a board exceeds 2 MB — unit-tested; warning threshold logged.)*
- [x] Baseline vs after: save latency + payload bytes logged (`[scalability]` lines); baseline recorded above.
- [x] `npm run lint` and `npm test` pass; all 17 test suites (314 tests) unaffected.

## Open questions

1. Phase 2 scope: ship `board_items` as a write-optimized shadow while `boards.tabs` remains the read source, or go straight to a full split (tabs/connections/annotations relational too)? (Proposed: shadow first — smaller blast radius, same win; full split only if blob saves remain hot.)
2. Is Phase 2.5 (client item deltas) worth bundling? (Proposed: yes, but only after Feature 11 lands — the patch shape is free then.)
3. Should the 2 MB warning live in the BoardSettingsModal as a permanent indicator ("Board size: 2.1 MB") instead of a transient toast? (Proposed: both — indicator in settings, transient toast on canvas.)
