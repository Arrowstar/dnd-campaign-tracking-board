# Feature 03 — Quest & Session Lifecycle (status badges, session recap, session log)

**Status:** Proposed · **Priority:** P1 · **Dependencies:** Feature 02 filter bar pattern (reused for status filters)

## Summary

Make quest and session cards *stateful*. Quests already have a `status` select inside the structured `quest-info` field (`QUEST_STATUS_OPTIONS = ['Active', 'On Hold', 'Completed', 'Failed', 'Abandoned']`, BoardItem.tsx:59, wired at BoardItem.tsx:189) — but it is invisible on the canvas, cannot be filtered, and sessions have no status at all. This feature:

1. Surfaces quest status as a colored badge on the card (canvas + previews).
2. Adds a session status (Upcoming / In Progress / Done) plus a distinct player-facing Recap field.
3. Adds status filter chips reusing the Feature 02 filter-bar pattern.
4. (Phase 2) Adds a chronological Session Log timeline — the DM's campaign spine.

**Why:** DMs live in "what's active, what's done, what's next." Today that answer requires opening every quest card.

## Current state (verify against these before coding)

- `QUEST_FIELDS` (BoardItem.tsx:183–199): structured `quest-info` with keys `giver`, `status`, `reward`, `deadline`, `difficulty`.
- `SESSION_FIELDS` (BoardItem.tsx:165–181): `sess-banner` (image), `sess-info` structured (`number`, `played` date, `ingame`, `locations` link, `players` members), `sess-summary` (isContentField), `sess-moments`, `sess-threads`, `sess-files`.
- Structured values are read with `parseStructured(field.textValue, fallbackKey)` (StructuredBoardItemFields.tsx:92); rendering reads `quest-info.status` via `parseStructured` (see BoardItem.tsx:511 preview path).

## User stories

1. As a DM, I see at a glance which quests are Active (gold), On Hold (amber), Completed (green), Failed (red), Abandoned (gray) — from across the room / at a glance on the canvas.
2. As a DM, I filter the board to `Status: Active` to see only live threads during prep.
3. As a DM, after each session I open the session card, mark it Done, and write a player-facing recap that players can see but my DM-only notes stay hidden.
4. As a player, I open the session cards in order and scroll the campaign history (Phase 2).
5. As a DM, I see "Next up: Session 8 — in-game date 4 Mirtul" without opening the card.

## UX spec

### 1. Status badges on cards (BoardItem.tsx)
- **Quest badge:** derived from `quest-info.status` (parse the structured value; fall back to reading it when the field is missing → no badge).
  - Placement: top-right corner of the card header (opposite the type badge), pill with status text; color per map below; dark/light text via `isLightColor` (FocusDrawer.tsx:63).
  - Status → color: `Active` #B58D3D (gold), `On Hold` #C28A4A/amber, `Completed` #3E7C4F (green), `Failed` #8C3A3A (red), `Abandoned` #6B6660 (gray).
- **Session badge:** from new `sess-info.status` key (same UI). Plus the session number is already a structured key — show `#N` as a small badge next to the title when present.
- Badges render on full-card LOD and on the compact card (text version only). Pin LOD unchanged.

### 2. Session status + Recap field (BoardItem.tsx `SESSION_FIELDS`)
- Add `{ key: 'status', label: 'Status', widget: 'select', options: ['Upcoming', 'In Progress', 'Done'] }` to the `sess-info` structured block.
- **Recap field:** add `{ id: 'sess-recap', label: 'Recap (shareable)', type: 'text' }` AFTER `sess-summary`:
  - `sess-summary` → keep as the DM's full log (suggest setting its default visibility to `dm` via the existing per-field `visibility` — do NOT change existing data; recommend it in the field editor instead: set the field's `visibility: 'dm'` once at creation time for new items only via `buildDefaultFields`, BoardItem.tsx:108; old items keep whatever they have).
  - `sess-recap` → player-facing, `visibility: 'all'` by default. 2–4 sentences the DM writes for the party.
- Both are ordinary text fields: they get everything (rich text, cross-links) for free.

### 3. Status filter chips (Board.tsx / Toolbar)
- One row below the toolbar: `[All] [Active] [On Hold] [Completed] [Failed]` for quests and `[All] [Upcoming] [In Progress] [Done]` for sessions — implement as **two chips per status** in a single row using the Feature 02 pill-row pattern (same dim/clear behavior).
- Status filter is AND-combinable with tag filter (Feature 02).
- Filtering applies only to `quest` and `session` items; other types always pass.

### 4. Phase 2 — Session Log timeline (separate component, deferred)
- A collapsible panel (right edge, docked like FocusDrawer but read-only) listing `session` items sorted by `sess-info.number`/`played`, newest first: number, title, in-game date, status chip, first line of recap.
- Click a row → `handleScrollToItem` navigation.
- Place behind a toolbar icon (Calendar icon). Out of v1 scope; spec'd here so the data model doesn't need changes later.

## Data model changes

None. Status/recap live inside existing structured `textValue` JSON (`parseStructured`/`buildDefaultFields` handle them). If a raw convenience is wanted later (e.g. server-side filtering), a denormalized `item.status` field would be additive — **not needed for v1.**

## API changes

None. All state flows through the existing `POST /api/boards/[boardId]/state` save + `mergeTabsForSave` merge. The per-field visibility semantics for `sess-recap`/`sess-summary` are already enforced by `scrubTabsForUser` / `mergeTabsForSave` (lib/fieldVisibility.ts) — the server already knows how to keep DM-only content hidden from players.

## Implementation plan

### Files
| File | Change |
|---|---|
| `components/BoardItem.tsx` | Add `STATUS_COLOR_MAP`, `SESSION_STATUS_OPTIONS`; badge component inline in `BoardItem`; read status via `parseStructured`; add `sess-info.status` key + `sess-recap` field to `SESSION_FIELDS`. |
| `components/Board.tsx` | `statusFilter: { quest: string | null; session: string | null }` state; filter + dim in the visible-item derivation (same point as tag filter); pill row render; `onSetStatusFilter` prop to BoardItem. |
| `components/StructuredBoardItemFields.tsx` | No change required (select widget + options are data-driven). Verify `buildDefaultFields` copies `visibility` defaults when present in a `FieldDef` — if it doesn't, add an optional `defaultVisibility` to `FieldDef` (used for `sess-summary` → `dm`). |
| `components/FocusDrawer.tsx` | No change (fields render generically). |
| Phase 2: `components/SessionLogPanel.tsx` | New read-only timeline. |

### Badge derivation helper (put in `lib/questStatus.ts` or inline)
```ts
function questStatusOf(item: BoardItem): string | null {
  const f = item.fields?.find(x => x.id === 'quest-info');
  if (!f) return null;
  return parseStructured(f.textValue, 'status').status ?? null;
}
```

### Preview layout note
`getDefaultPreviewFields` (previewLayout.ts) per-type defaults decide what shows on the card preview. If `quest-info` is already in the quest preview default, the badge adds the status at a glance; if not, recommend adding `quest-info` to the default quest preview so the status is visible without clicking. Verify in `previewLayout.ts` (quest/session entries) and update defaults there — it's the single source of truth for what a fresh card previews.

## Edge cases & conflicts

- **Legacy quests without `quest-info`:** badge absent; filter treats as no status (and "All" shows them). Optionally count them: "N quests without status" in the filter row tooltip.
- **Free-text statuses:** users could type into the placeholder instead of the select (the structured widget stores whatever the select picks; the select widget prevents free text — verify the widget enforces `options`; if a user's existing data has free text, badge renders it as-is with the default gray).
- **Concurrent edits:** same last-write-wins semantics as all structured fields. History (F05) covers recovery.
- **Players editing sessions:** players can already edit their own items only (merge rule). A player-owned session card can be edited freely; DM-owned session cards are DM-editable only (plus comments). Status/recap inherit these rules — no new surface.

## Rollout / migration

- No schema change; new fields only appear on newly created session cards (existing ones get them via the "Add field" affordance, or a tiny migration script that appends the two fields to existing session items — recommend shipping the migration as a one-off `scripts/add-session-status.ts` so all sessions gain the fields uniformly, mirroring the migrate-embedded-images pattern).

## Acceptance criteria

- [ ] Quest cards show a status badge matching the stored `quest-info.status`; color map applied; no badge when absent.
- [ ] Session cards show `#N` + status badge; new sessions include status + recap fields.
- [ ] Recap default visibility is `all`; DM can flip `sess-summary` to DM-only and players then see a lock on it (existing field-visibility UX).
- [ ] Status filter chips dim/hide non-matching quests and sessions; combine with tag filter without conflict.
- [ ] Undo/redo covers status changes (they're item edits — verify with the existing history capture).
- [ ] Migration script idempotent (safe to re-run).
- [ ] (Phase 2) Session Log panel lists sessions sorted by number, navigates on click.

## Open questions

1. Should `event` items get a status too? (Events are often single-shot; proposed no.)
2. Should "Active" quests auto-rank at the top of any future quest list view? (Phase 2.)
3. Mark quest completed automatically when its linked session(s) are Done? (Nice idea, risky heuristics — proposed no.)
