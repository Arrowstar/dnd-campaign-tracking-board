# Feature 09 — Read-Only Share Links

**Status:** Proposed · **Priority:** P2 · **Dependencies:** none hard; reuses the scrub machinery from lib/fieldVisibility.ts and the read-only rendering pieces of BoardItem.tsx / AnnotationCanvas.tsx

## Summary

Joining a board today requires an account (register/login) plus the board id (plus password, if set). For a table-top group, that's a real barrier: the player who "just wants to look at the map" must create an account, join, and keep a session alive. This feature lets a DM mint **read-only view links** that work for anyone with the URL — no account, no login, no board password:

1. **Link management (DM)** — create named links with optional expiry, copy/share the URL, revoke individually. Multiple links = one per player or per group.
2. **Public view page** — a read-only board renderer at `/board/<id>/view/<token>`: pan/zoom, cards (all LOD tiers), annotations, connections, cross-link navigation, read-only FocusDrawer.
3. **Least-privilege data** — the view ships state scrubbed for an anonymous *player*: `dm`/`owner`-visibility items and fields are hidden entirely (lock placeholders kept, per existing scrub semantics).

**Non-goals:** no editing via links, no account creation behind links, no password-protected links (v1), no per-link analytics, no print/export from the view.

## User stories

1. As a DM, I right-click-style create "Party map link" in Board settings, copy the URL, and text it to my players. They open it in any browser — no login — and see the world board.
2. As a DM, I revoke a link when a player leaves the group; the page immediately shows "This link is no longer active."
3. As a player, I click a cross-link chip in the read-only view and it flies to the linked card on another tab, exactly like the full app.
4. As a DM, I confirm DM-only fields (secrets, plot) never appear in the share view, even though they're in the same board JSON.

## Current state (verify before coding)

- **Auth model:** every board route authenticates via `Authorization: Bearer` (`getAuthUser`, lib/auth.ts) and checks `boards.members`. The view page needs a **token-authenticated, member-less** path — a new pattern for this codebase, but the *scrubbing* side already exists:
  - `scrubTabsForUser(tabs, { id, role })` (lib/fieldVisibility.ts:46) strips hidden field content.
  - Item-level `visibility: 'all' | 'dm' | 'owner'` filtering is done **client-side** in Board.tsx's visible-item derivation — the view renderer must apply the same rule with a synthetic viewer (`role: 'player'`, no owned items → only `all` items pass).
- **Board route files:** `app/api/boards/[boardId]/route.ts` (GET existence), `state/route.ts` (GET full state + save), `revision/route.ts` (GET `updated_at` only). Revision currently auth-only — needs token support for live updates on the view page.
- **Renderer:** `Board.tsx` (2062 lines) owns all editing; `BoardItem.tsx` renders cards across three LOD tiers and takes `canEdit`-style handler props (already permission-aware for the DM/owner model); `AnnotationCanvas.tsx` renders the SVG annotation layer and gates edits by DM/owner. A read-only renderer should **reuse BoardItem + AnnotationCanvas with no-op handlers**, not fork the canvas logic.
- **Token primitives:** `generateToken()` in lib/auth.ts already produces 32 random bytes hex — reuse for share tokens.
- **Session tokens** are stored raw as PKs (256-bit entropy, un-hashed) — share tokens follow the same pattern; they're high-entropy bearer secrets, not user passwords.

## UX spec

### 1. Link management (DM) — `ShareLinksModal` (new; entry: BoardSettingsModal "Sharing" section, and a toolbar button is optional)
- List of existing links: label, relative created time, expiry ("Never" or date), copy button (copies full URL: `{APP_URL}/board/{id}/view/{token}` — use `window.location.origin` at copy time so it works in dev/prod), revoke (trash) button with inline confirm.
- "Create link" form: label (optional, defaults to "View link"), expiry select (Never / 7 days / 30 days / 90 days). Creates and immediately shows the URL with a copy affordance.
- Cap: **20 active links per board** (enforced server-side; the form explains when the cap is hit).
- Revoked links disappear from the list and instantly stop working.

### 2. Public view page — `app/board/[id]/view/[token]/page.tsx` + `components/BoardView.tsx`
- Server component page renders a minimal shell (same dark/parchment theme, no toolbar, no sidebar, no tabs-bar editing chrome — but a **tab strip for switching tabs**, read-only) and a client `BoardView` that:
  - Fetches `GET /api/boards/[boardId]/share/[token]` on mount; loading spinner; error states for 403 ("This link is no longer active") and 404 ("This board doesn't exist or the link is invalid") with a friendly note.
  - Renders the same `TransformWrapper` canvas (react-zoom-pan-pinch), dotted grid, `BoardItem` at all LOD tiers with **no-op handlers** (no drag/resize/context menu/selection), and `AnnotationCanvas` in view-only mode (no selection, no drawing).
  - Supports `handleScrollToItem` navigation for cross-link chips (tab switch + center + flash) — the logic lives in Board.tsx today; extract the navigation core into `lib/viewNavigation.ts` (or export the callback pattern) so both edit and view modes share it.
  - Read-only FocusDrawer (open by clicking a card): Content tab viewable (rich text display, images with annotations, structured fields), Comments tab read-only, **no Board Card / edit tabs**.
  - Receives live updates over the token-authed SSE stream (`/events?shareToken=`); a slow fallback poller against `/revision?shareToken=` keeps expiry detection (EventSource exposes no status codes); on 403 → "link expired" state.
  - Card font scale from settings applied (rendering consistency).
- `robots` meta `noindex` on the page (private content by default).
- Optional deep link: `#tab-<tabId>` hash → initial active tab (cheap, useful for "open this map" sharing).

### 3. Data shipped to the view (least privilege)
Server route returns, **scrubbed**:
```ts
{
  boardId: string;
  title: string;              // board id today (no board-name field exists)
  updatedAt: string | null;
  settings: BoardSettings;    // cardFontScale — rendering-only, safe
  tabs: BoardTab[];           // scrubTabsForUser(..., { id: 'shared-viewer', role: 'player' })
}
```
- Item-level filtering (`visibility !== 'all'` excluded) happens **client-side** in BoardView using the same rule as Board.tsx — server scrubbing for fields + client filtering for items keeps the logic in one place (the board's own GET state path returns items to members *before* client filtering; the share route must not leak `dm`-visibility items in the payload at all).
  - **Decision: the share route also filters items server-side** (`visibility === 'all'` only) — cheaper than shipping and hiding, and removes any doubt about leakage through the payload.
- `ownerName`/`ownerId`: keep (display-only; owner-visibility items are excluded anyway). Comments: kept (all members see them).

## Data model changes

```sql
-- lib/db.ts ensureSchema
CREATE TABLE IF NOT EXISTS board_shares (
  token TEXT PRIMARY KEY,                       -- generateToken() 32-byte hex
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'View link',
  created_by UUID,                              -- sessions.users.id, nullable (legacy rows)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE           -- NULL = never
);
CREATE INDEX IF NOT EXISTS board_shares_board_idx ON board_shares (board_id);
```
- Board deletion (F07) cascades links automatically.
- Account deletion (F07): links survive (they're board resources, not user resources) — document that revoking is a DM job.

## API changes

### New: `GET/POST /api/boards/[boardId]/shares` — DM-only
- GET → `{ shares: [{ token, label, createdAt, expiresAt }] }`.
- POST `{ label?, expiresInDays?: number | null }` → validates: DM role, cap 20, label ≤ 40 chars, `expiresInDays` in {7, 30, 90} or null. Returns `{ token, url }` (url built server-side from `APP_URL` env with `window.location.origin` fallback — client copies; server returns path or full URL).

### New: `DELETE /api/boards/[boardId]/shares/[token]` — DM-only
- Deletes the row; `{ success: true }`. 404 if token not on this board.

### New: `GET /api/boards/[boardId]/share/[token]` — **no auth** (token is the credential)
- Validates token exists for board; checks `expires_at > NOW()` (else 403 "expired").
- Returns the scrubbed payload above (fields scrubbed via `scrubTabsForUser` with synthetic viewer; items filtered to `visibility === 'all'` server-side).

### Change: `GET /api/boards/[boardId]/revision`
- Accept optional `?shareToken=`: when present, skip the Bearer check, validate the token (same expiry check), return `{ updatedAt }`. When absent, behave exactly as today. This is the only auth-branching endpoint; keep it isolated there.

## Implementation plan

### Files
| File | Change |
|---|---|
| `lib/db.ts` | Add `board_shares` table + index. |
| `lib/shareTokens.ts` | **New.** `validateShareToken(sql, boardId, token)` (expiry check), `buildViewPayload(board, viewer)` (scrub + server-side item filter), token/expiry constants. Pure where possible → unit tests. |
| `app/api/boards/[boardId]/shares/route.ts` | **New.** GET list / POST create (DM-only, cap, expiry validation). |
| `app/api/boards/[boardId]/shares/[token]/route.ts` | **New.** DELETE revoke (DM-only). |
| `app/api/boards/[boardId]/share/[token]/route.ts` | **New.** Public GET (scrubbed payload). |
| `app/api/boards/[boardId]/revision/route.ts` | Token query-param support (isolated branch). |
| `app/board/[id]/view/[token]/page.tsx` | **New.** Shell + `noindex`. |
| `components/BoardView.tsx` | **New.** Read-only canvas: TransformWrapper, BoardItem (no-op handlers), AnnotationCanvas (view-only), read-only tab strip, view-only FocusDrawer, cross-link navigation (shared helper), polling. |
| `lib/viewNavigation.ts` | **New.** Extract tab-switch + center + flash from `handleScrollToItem` (Board.tsx:1319) into a shared helper both Board.tsx and BoardView.tsx call. |
| `components/ShareLinksModal.tsx` | **New.** Link management UI. |
| `components/BoardSettingsModal.tsx` | "Sharing" section entry. |
| `components/FocusDrawer.tsx` | Accept a `readOnly` prop (hide edit tabs/controls; Comments read-only). Reused by both modes. |

### Read-only reuse strategy (the main refactor risk)
- **Preferred:** `BoardView.tsx` is a sibling of Board.tsx that reuses `BoardItem` (pass `undefined`/no-op for `onUpdateItem`, `onDeleteItem`, drag callbacks — verify BoardItem's prop types allow a read-only mode; if it requires edit handlers, add a `readOnly?: boolean` prop that disables the affordances internally) and `AnnotationCanvas` (pass read-only flag so pointer handlers no-op).
- Do **not** try to reuse Board.tsx wholesale with a `readOnly` prop — its 2062 lines interleave edit state everywhere; the blast radius of guarding every handler is larger than a focused view component.
- `FocusDrawer` gets the `readOnly` prop (small, contained change — most editors are per-tab already; gate the tabs + the comment form).
- View-mode tab strip: small read-only list (name + color dot), no add/rename/reorder/delete.

## Edge cases & conflicts

- **Token in URL / logs:** bearer secret by design; don't log query strings; don't render the token into the page HTML (fetch only). Noindex set.
- **Expired link mid-view:** poll 403 → swap to the "link expired" state (no auto-refresh loop).
- **Revoked link on a cached page:** same 403 path on next fetch/poll.
- **DM-only content:** server-side item filter + field scrub — double-check via a test that exports a board, sets a field `visibility: 'dm'`, and asserts the share payload has the lock-shell but no content.
- **Images:** blob URLs are public by nature (Vercel Blob) — fine for share links; the 403/404 page is what's gated.
- **Board password:** share links deliberately bypass it (the DM minted the link); document in the modal: "Links bypass the board password."
- **Large boards on the view page:** same payload size as the member view — no new cost.
- **Account deletion of a viewer:** viewers have no accounts — nothing to clean up. DM account deletion (F07) leaves links intact (see Data model).
- **Restore-from-history (F05) / board delete (F07):** links reference the board; delete cascades; restore doesn't touch them.

## Rollout / migration

- New table via `ensureSchema`; additive routes; no existing behavior changes (revision route's token branch is opt-in via query param).
- The one risky change is `FocusDrawer`'s new `readOnly` prop and `BoardItem`'s no-op-handler tolerance — gate behind the view page; the edit path is untouched when props are undefined.

## Acceptance criteria

- [ ] DM can create/copy/revoke links with label + expiry; 20-link cap enforced; revoked/expired links show the friendly "no longer active" state.
- [ ] Anonymous browser (no session, incognito) opens the link and sees the board: pan/zoom, all card LOD tiers, annotations, connections, tab switching, cross-link navigation.
- [ ] Share payload contains no `dm`/`owner`-visibility items and no hidden field content (lock shells only) — verified by API test.
- [ ] No editing affordances anywhere in the view: no drag/resize/delete/context menu/sidebar/toolbar, no comment input, no edit tabs in the drawer.
- [ ] Live updates: editing the board in a member session appears in the open view within one poll interval; expired/revoked token flips the view to the error state on poll.
- [ ] Existing member flows (auth'd revision, state GET/POST) are byte-identical to before (regression check on revision route).
- [ ] `noindex` present on the view page.
- [ ] Unit tests: `validateShareToken` (valid/expired/revoked/wrong board), `buildViewPayload` (scrub + item filter), share create cap.

## Open questions

1. Should links support an optional **password** (share-level, not board-level) for semi-private sharing? (Proposed: v2 — the URL is already a bearer secret; password adds friction the table-top use case doesn't want.)
2. Should the view page offer **"Request to join"** (opens the lobby join flow with the board id pre-filled) as a gentle upgrade path for players who want to edit? (Proposed: yes, v1.5 — small CTA on the 403 page is all it needs.)
3. Tab deep-linking (`#tab-<id>`) in v1 or later? (Cheap; proposed v1.)
4. Should DM-created links be listed in the Lobby sidebar for quick copy? (Proposed: no — Board settings is the single surface.)
