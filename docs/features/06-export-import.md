# Feature 06 — Export & Backup (JSON export/import)

**Status:** Proposed · **Priority:** P2 · **Dependencies:** none; coordinates with Feature 05 (history) — export is the manual backup, history is the automatic one

## Summary

There is currently **no way to get data out of the app** (or into it) other than the one-off migration script (`scripts/migrate-embedded-images.ts`). The DM's campaign lives in one Postgres JSONB column with no portable copy. This feature adds:

1. **Full-board export** — DM downloads the entire board (all tabs, items, settings, member list) as a single JSON file.
2. **Import as new board** — DM creates a fresh board from an exported file, with all IDs remapped (items, connections, annotation pins, cross-link tokens) so it can coexist with the source board.
3. **(Deferred) Single-card export** — copy one card as JSON for sharing/migration; and **blob bundling** so a board keeps its images when moved off the host.

**Why:** DMs want backups they control, portability ("we moved to a different tool instance", "I ran the same world twice"), and a safety net independent of the server. Export/import is also the natural bridge for any future migration tooling.

## User stories

1. As a DM, I export my board before a risky refactor and keep the file on my drive.
2. As a DM, I run the same homebrew world in two groups: I export the world board and import it as a new board for group B, then edit.
3. As a DM, I share my campaign template with another DM (they import it on their own instance).
4. As a DM, I verify a backup by importing it into a scratch board and diffing card counts.

## Data model — export format (canonical)

```ts
type BoardExportFile = {
  schemaVersion: 1;
  exportedAt: string;                       // ISO
  app: 'mythos-canvas';
  board: {
    id: string;                             // original id (informational only)
    name: string;                           // = board.id today; kept for future board titles
    settings: BoardSettings;                // includes tagDefs once F02 ships
    members: Record<string, { role: 'dm' | 'player'; joinedAt: string }>;  // meta only
  };
  tabs: BoardTab[];                         // full fidelity: items, connections, annotations
};
```

- **Fidelity:** exported JSON is the *unscrubbed* server state — this is why export is **DM-only** (a player export would either leak DM content or produce an unusable partial board).
- **Blob URLs:** `imageUrl`/`file.url`/`content` (image items) reference Vercel Blob URLs. Blobs are NOT included; they persist independently and export works as-is **on the same host**. Cross-host imports need blob bundling (deferred — see below).
- **Determinism:** `exportedAt` differs per run; `tabs` order preserved. Do NOT reorder items on export (stable output aids diffing).

## API changes

### New: `GET /api/boards/[boardId]/export`
- Auth: **DM only** (see fidelity note). Member check first, then `role === 'dm'`.
- Response: JSON with `Content-Disposition: attachment; filename="<boardId>-<YYYY-MM-DD>.json"` (Next `NextResponse.json` supports headers; set `Content-Disposition` via `new NextResponse(JSON.stringify(exportData, null, 2), { headers })`).
- Reads `boards` row (id, members, settings, tabs) — the same SELECT shape as the state GET; no new queries.
- **Size cap:** reject export when serialized size > ~15 MB with a clear error (function body limits); realistically boards are 1–5 MB.

### New: `POST /api/boards/[boardId]/import` — body is the export file payload
Semantics: **import creates a NEW board** (id = request body board id or a provided `newBoardId`), owned by the importer as DM. Importing *into* an existing board (merge) is explicitly out of scope v1.

Behavior:
1. **Validate strictly.** Reject non-objects, wrong `app`/`schemaVersion`, > 10 MB bodies, and unknown `ItemType`s/`FieldType`s. All strings length-capped (title 200, label 100, content 1 MB). Sanity-check every item has an id/type/title.
2. **Remap all ids** (mandatory — the source board still exists on the same host, so id collisions are real):
   - Build `Map<oldId, newId>` (uuidv4) for every item id across all tabs.
   - Rewrite: `tabs[].items[].id`; `tabs[].connections[].fromId/toId`; `tabs[].annotations[].pins[].itemId`; `BoardAnnotation.pins`; item `fields[].textValue` cross-links via the `@@MULTILINK` token format — parse with `parseTokens`, remap link token `id` fields, re-encode with `encodeTokens` (lib/crossref.ts has exactly these primitives; add a `remapLinksInValue(value, idMap)` helper).
   - **Tab ids:** keep original tab ids (tabs are scoped to a board; `'default-tab'` collisions are fine) — or remap for cleanliness; keeping is simpler and safe.
3. **Ownership:** every item's `ownerId`/`ownerName` → the importer (avoids dangling references to users who don't exist in the new board; `mergeTabsForSave`'s owner rules would otherwise fight the importer on their first edit).
   - Preserve `ownerName` as a *display string*? No — keep history clean: set both to importer. (Documented decision; the original names are visible in comments.)
4. **Comments:** keep as-is (userId references a user who may not exist in the new instance — comments render `userName` primarily, so keep `userName`, and null out `userId` if it's not the importer).
5. `members` from the file are **ignored** — the new board has exactly one member (the importer, role dm). Memberships are host-local.
6. Insert via the same `INSERT INTO boards` path as `app/api/boards/route.ts` (password optional, pass through).
7. Response mirrors create: `{ success: true, boardId, role: 'dm' }`.

## UX spec

### Export
- **Entry point:** `BoardSettingsModal` ("Export board (JSON)") + a Toolbar overflow menu if one exists later. Keep it in Board settings for v1.
- Click → fetch → download. Show transient "Exporting…" state; on failure (size cap, auth expiry) show inline error.

### Import
- **Entry point:** the Lobby ("Create a Campaign" section gets a secondary action: "Import from JSON"). Requires an authenticated session (DM role comes from being the new board's only member).
- Flow: file input (accept `.json`) → client-side pre-validation (parse JSON, check `app`/`schemaVersion`) → optional "New board ID" field (validated like create: `[a-z0-9-]`, 2–48) → POST → on success, navigate to `/board/<newId>`.
- **Error surfacing:** server returns `{ error }` strings; lobby shows them inline (matches existing create/join error handling in `app/page.tsx`).

### Deferred (documented, not v1)
- **Single-card export:** right-click → "Export card…" writes `{ schemaVersion: 1, card: BoardItem }`; import creates a card on the current tab. Useful for sharing stat blocks.
- **Blob bundling:** export resolves every blob URL to its bytes and inlines base64 (with a size cap per file), import re-uploads via the existing `/api/upload` path. Needed only for cross-host moves; adds ~200 lines and a batch-upload endpoint.
- **Board deletion UI** (separate feature) — history CASCADE already prepared for it.

## Implementation plan

### Files
| File | Change |
|---|---|
| `lib/exportImport.ts` | **New.** `buildExportPayload(boardRow)`; `validateImportPayload(raw): BoardExportFile | { error }`; `remapBoardIds(payload, idMap)`; `remapLinksInValue` (uses `parseTokens`/`encodeTokens`); `buildImportRow(payload, importer, newBoardId)`. All pure → unit-testable. |
| `app/api/boards/[boardId]/export/route.ts` | **New.** DM-only GET. |
| `app/api/boards/[boardId]/import/route.ts` | **New.** POST; mirrors create-board validations (id format + uniqueness 409). |
| `components/BoardSettingsModal.tsx` | Export button + status. |
| `app/page.tsx` | Import card in the Create section; file read + pre-validation + navigate. |
| `lib/crossref.ts` | Add `remapLinksInValue(value, idMap)`. |
| `lib/types.ts` | Add `BoardExportFile` type (canonical format above). |

### Validation constants (single source, `lib/exportImport.ts`)
`MAX_EXPORT_BYTES = 15 * 1024 * 1024`, `MAX_IMPORT_BYTES = 10 * 1024 * 1024`, title/label/content caps. Reuse `MAX_FILE_BYTES` pattern (duplicated today between `lib/utils.ts` and `app/api/upload/route.ts` — consolidate if touching both).

## Edge cases & conflicts

- **Import of a board exported from a newer schemaVersion:** reject with "exported by a newer version" (fail loud, not silently lossy).
- **Duplicate import (idempotency):** importing the same file twice creates two boards (ids differ by the supplied `newBoardId`). Provide the new ID in the UI to make this explicit.
- **Cross-link remap gaps:** a link token whose target item was NOT in the export (shouldn't happen — links reference in-board items, but a corrupt file could contain one): leave the token's title, null the id → renders as plain text (existing renderer handles token without a match gracefully — verify `getPlainText` fallback).
- **Blob URLs on a different host:** images 404 after cross-host import — the deferred bundling covers this; the import page should show a one-line note: "Images are preserved if importing on the same server."
- **Password protection:** exported file contains NO password material (hash/salt live on the boards row, not in tabs/settings) — a fresh board gets its own password. State this in the modal copy.
- **Huge boards:** 15 MB export cap; boards beyond that must wait for per-item storage (scalability work — out of scope).

## Rollout / migration

- Pure additive endpoints + one helper file. No schema change. Ship independent of all other features (works before/after F02/F05).

## Acceptance criteria

- [ ] DM can download a JSON export of any board; players get 403.
- [ ] Export contains all tabs, items (incl. fields, tags, previewLayout, lines, crop), connections, annotations, and settings — byte-comparable round trip.
- [ ] Import into a fresh board succeeds with all IDs remapped: cross-links, connection endpoints, and annotation pins point at the new items (verify by clicking a chip → `handleScrollToItem` navigates, and by rendering a pinned annotation).
- [ ] Imported board has one member (importer, dm); all items owned by importer; comments retained with original display names.
- [ ] Round-trip test: export board A → import → export board B → diff normalized (ignoring ids/exportedAt) shows zero structural differences.
- [ ] Invalid payloads (wrong version, bad types, oversized) rejected with clear errors; no partial inserts.
- [ ] Duplicate import with same/different board IDs behaves as documented.
- [ ] Import UI in lobby navigates to the new board on success and shows inline errors on failure.

## Open questions

1. Should export include a `settings.cardFontScale` + `tagDefs` (F02)? — Yes, they're in `settings` already.
2. Import "as a new tab in the current board" instead of a new board? (Merging tabs wholesale is easy; merging *items with id remap into an existing tab* is also easy — proposed v2: import-as-tab, since tab ids don't collide.)
3. Export compression (gzip)? Blob URLs are already compressed-ish; JSON gzips ~10×. Cheap win on the export endpoint — proposed v1.5.
