# Feature 07 — Board Deletion & Account Management

**Status:** Proposed · **Priority:** P2 (housekeeping; unblocks lobby hygiene and data-privacy expectations) · **Dependencies:** none hard; ties into Feature 05 (history `ON DELETE CASCADE`) and Feature 06 (export as a pre-delete safety net)

## Summary

Today the app has **no way to remove anything at the account level**: boards live forever in the `boards` table, users can never leave a board or delete their account, and a DM who stops running a campaign leaves a permanent orphan row. This feature adds:

1. **Board deletion** — DM-only, with a two-step confirm; cascades history (F05) and removes access for all members instantly.
2. **Account deletion** — authenticated user removes their account; sessions cascade, their memberships are removed, and their owned items are reassigned to each board's DM; boards where they are the sole member are deleted (explicitly confirmed).
3. **Deletion summary endpoint** — the confirmation UI shows exactly what will happen before anything is deleted.

**Password reset is explicitly deferred** (see "Password reset" section): the app has username+password auth with **no email infrastructure**, so a self-service reset requires a verified email or OAuth first. This plan documents the gap and the options rather than pretending to solve it.

## User stories

1. As a DM, I delete my finished campaign board; it disappears from every member's lobby within their next refresh and its history (F05) is cleaned up.
2. As a DM, I get an "Export before you delete" hint in the confirmation modal (F06), since this is the last chance to back up.
3. As a player, I delete my account; my membership vanishes from every board I joined, and the NPCs I created become owned by each board's DM (no dangling `ownerId`s, no frozen `owner`-visibility fields).
4. As a user, before deleting my account I see a summary: "You are DM of 2 boards (3 other members) and a member of 5 others."
5. As a DM with other members, I cannot delete my account until I resolve my boards — the app tells me exactly which boards block me and why.

## Current state (verify before coding)

- **Boards table** (`lib/db.ts:43–51`): `id`, `board_password_hash/salt`, `members` JSONB, `tabs` JSONB, `settings` JSONB, `updated_at`. No delete anywhere.
- **Users/sessions** (`lib/db.ts:23–41`): `sessions.user_id` has `ON DELETE CASCADE` — deleting a user row already kills all their sessions. `board_history.board_id` (F05 plan) is `ON DELETE CASCADE` — board deletion cleans history for free.
- **Board route file** `app/api/boards/[boardId]/route.ts` exists with a GET (public existence check) — the DELETE handler goes in the same file.
- **Membership loss handling** already exists client-side: the revision poller treats 403 as "no longer a member" (`handleMembershipLost`, Board.tsx:458) and 401 as "session lost" (Board.tsx:463). Board deletion will surface as 404 → need a small extension to redirect to the lobby.
- **Auth routes**: register/login/me/logout/change-password. `change-password` (with `UserSettingsModal`) already exists — account deletion is the missing counterpart.
- **Lobby** (`app/page.tsx`): "My Campaigns" from `GET /api/auth/my-boards`, create/join forms, `UserSettingsModal`, logout. `my-boards` scans the whole `boards` table (noted in the scalability section — a membership index or query-scoped fix belongs to that work, not this feature).

## UX spec

### 1. Board deletion

**Entry point:** `BoardSettingsModal` → new "Danger zone" section at the bottom: red "Delete board…" button (DM sees it; players never see the section).

**Confirmation modal** (`components/DeleteBoardModal.tsx`):
- Header: "Delete campaign board".
- Body: board id + member count ("3 other members will lose access immediately"), and the consequences list:
  - All cards, tabs, connections, annotations, and comments are permanently deleted.
  - Board history (F05) is deleted.
  - **"Tip: Export a JSON backup first."** → button "Export board" that runs the F06 export then stays in the modal (both shipped independently; hide the tip if F06 isn't deployed).
- **Requires typing the board id** into a text field to enable the delete button (matches the gravity; board ids are short slugs like `red-larch-campaign`).
- Buttons: "Cancel" / "Delete board" (disabled until typed id matches, red).
- Loading state on delete; on success: `router.push('/')` (lobby) and clear any local board state.

### 2. Account deletion

**Entry point:** `UserSettingsModal` → "Danger zone": "Delete account…" (red). 

**Flow** — two-step, because account deletion has cross-board effects:

*Step 1 — Summary screen* (`components/DeleteAccountModal.tsx`), from `GET /api/auth/account/deletion-summary`:
- "As **DM** on N board(s):" — each board row with member count and a checkbox: `☐ Also delete "red-larch-campaign" (3 other members)` **or** `"red-larch-campaign" — delete this board too` if they want it gone.
  - Rule: boards where the user is DM **and has no other members** are shown as "will be deleted" (non-optional, they can't be left in limbo — a board with zero members is unreachable dead data).
  - Boards where the user is DM **with other members** are optional: checked = deleted; unchecked = **DM role must be resolved first** (see "The DM-role blocker" below) → deletion is blocked until every such board is either checked or has its DM situation resolved.
- "As **member** on M board(s):" — informational list (membership removed; owned items reassigned to that board's DM).
- Footer: "Type your username to confirm" + red "Delete account" button.

*Step 2 — Deletion*:
- `DELETE /api/auth/account` with `{ confirmed: true, deleteBoardIds: string[] }`.
- On success: clear `localStorage['dnd_session']`, then the lobby shows the auth screen (existing session-loss path).

### 3. The DM-role blocker (no transfer feature yet)

There is **no "transfer DM role" or "leave board" feature** (kick exists for players; a DM cannot be kicked). Therefore a DM with other members cannot satisfy "unchecked board" unless they first kick all members or check the delete box. The modal copy must say this plainly:
> "You are the only DM of 'red-larch-campaign' (3 members). Delete it, or remove its members first, before deleting your account."

**Recommended follow-up (small, same PR if cheap): "Leave board / transfer DM"** — in the Lobby sidebar, DM-owned board row gets "Transfer to…" (member picker from `GET /api/boards/[boardId]/members`, sets `members[target].role = 'dm'`, demotes self to player then removes self, or just removes self). ~1 new endpoint + one modal. Without it, account deletion for DMs with groups is unusable. **Decision needed from product owner** (see Open questions).

## Data model changes

- **None required.** FKs already cascade (`sessions`, and `board_history` per F05). `members` JSONB and item `ownerId`s are updated in-place by the new routes.
- Comments: `Comment.userId` references the deleted user but there is **no FK** (comments are JSONB). Keep comments as-is with `userName` intact — they're a historical record; do not null them.

## API changes

### New: `DELETE /api/boards/[boardId]` (in existing route file)
- Auth: member check → `role === 'dm'` else 403. (DM-only: board deletion is a destructive campaign-wide action; members are just removed.)
- Body: none required (client confirm is UX-only). Keep `{ force?: boolean }` reserved for future use.
- Logic: `DELETE FROM boards WHERE id = $1` (cascades `board_history` once F05 lands). Return `{ success: true }`.
- Errors: 404 board not found; 403 not the DM.

### New: `GET /api/auth/account/deletion-summary`
- Auth: any logged-in user.
- Returns:
```ts
{
  dmBoards:  { boardId: string; memberCount: number; otherMembers: number; hasOthers: boolean }[];
  memberBoards: { boardId: string; dmName?: string; ownedItems: number }[];
  ownedItemsOnOtherBoards: number;  // informational total
}
```
- Implementation: reuse `my-boards`-style scan (accept the existing full-table scan; it's the same query shape already shipped — improving it is the scalability work item, not this feature).

### New: `DELETE /api/auth/account`
- Auth: logged-in user. Body: `{ confirmed: boolean, deleteBoardIds: string[] }`. **`confirmed` is mandatory** — this is the server-side guard for accidental client deletions.
- Server logic (order matters — do this in a transaction; the `neon` client supports array literals but for v1 sequential statements with an early failure rollback are acceptable since each is idempotent-ish; prefer a single `BEGIN/COMMIT` if `neon` transactions are straightforward in this codebase — verify, otherwise document the window):
  1. Re-read the user's memberships fresh (don't trust client claims).
  2. For every board where `members[user.id].role === 'dm'`:
     - If `memberCount > 1` and board id **not** in `deleteBoardIds` → **abort, 409** with `{ error, blockingBoards: [...] }`. (Client already prevents this; server enforces.)
     - If in `deleteBoardIds` (or `memberCount === 1`) → `DELETE FROM boards`.
  3. For every remaining board where the user is a member:
     - **Reassign ownership:** every item with `ownerId === user.id` → `ownerId/ownerName` = that board's DM (first `role === 'dm'` in `members`; a board always has ≥ 1 DM by construction). This prevents frozen `owner`-visibility fields (nothing is readable by anyone when the owner no longer exists) and keeps the board alive.
     - Remove `members[user.id]`.
  4. `DELETE FROM users WHERE id = $1` (sessions cascade).
- Return `{ success: true }`.

### Client surface after deletion
- Board deleted while other members are viewing: their next poll of `/revision` returns 404. Extend the poller's error handling: 404 → `router.push('/')` + toast "This board was deleted by its DM." (today it only handles 403 — Board.tsx:458).
- Account deleted on another device: any API call → 401 → existing session-loss path (Board.tsx:463 / lobby) shows auth screen. Verified already handled.

## Implementation plan

### Files
| File | Change |
|---|---|
| `app/api/boards/[boardId]/route.ts` | Add `DELETE` handler (same file as existing GET). |
| `app/api/auth/account/route.ts` | **New.** GET summary + DELETE. |
| `lib/accountDeletion.ts` | **New.** Pure helpers: `reassignItemsToDm(tabs, ownerId, dm)` (map over tabs/items, rewrite `ownerId/ownerName`), `summarizeDeletion(userId, boards)` → the summary shape. Unit-testable. |
| `components/DeleteBoardModal.tsx` | **New.** Confirm-by-typed-id modal; export shortcut button (F06, conditional). |
| `components/BoardSettingsModal.tsx` | "Danger zone" section + Delete button (DM only — the modal already checks role). |
| `components/DeleteAccountModal.tsx` | **New.** Two-step summary + confirm modal. |
| `components/UserSettingsModal.tsx` | Danger zone + Delete account button. |
| `app/page.tsx` | Refresh `my-boards` after board deletion; clear session + show auth screen after account deletion. |
| `components/Board.tsx` | Extend poller error handling: 404 → lobby redirect + message. |

### Sequencing note
Board deletion can ship alone (it only needs its own route + modal). Account deletion depends on the deletion-summary route and the reassignment logic. The "transfer DM / leave board" follow-up is a prerequisite for *usable* account deletion by DMs with groups — flag for product decision (Open questions).

## Edge cases & conflicts

- **Board deleted while a member is mid-edit:** their save POST returns 404 (board gone) — the client's save-error path must not retry forever; show "board deleted" and redirect (mirror the poller handling).
- **Reusing a deleted board id:** `id` is the PK; create-board's 409 check (`app/api/boards/route.ts:31`) allows the id after deletion. Fine — document that history (F05) is gone, so a "new" board with an old id has no history.
- **Account deletion with concurrent sessions:** all sessions cascade on `DELETE FROM users`; a mid-flight request on another device 401s → handled.
- **Reassignment when the DM is also being deleted** (the board is in `deleteBoardIds`): skip reassignment — the board is deleted in the same pass (order: handle delete-listed boards before reassigning on survivors).
- **Board with a DM but no owner-items:** reassignment loop is a no-op; fine.
- **`owner`-visibility fields after reassignment:** `canViewField` (lib/fieldVisibility.ts:24) keys off `item.ownerId` — after reassignment the board DM owns the item, so DM-only+owner fields resolve to the DM. Intentional and correct.
- **Blob orphans:** deleting boards/accounts leaves image blobs in Vercel Blob storage. No per-board tagging exists; a GC pass is out of scope (document as follow-up; blob cost is negligible at this scale).
- **Confirm-by-typed-id mismatch:** disable delete until exact match (case-insensitive for board slugs, which are `[a-z0-9-]` anyway).
- **my-boards scan cost:** unchanged by this feature (existing pattern); the full-table scan is a known scalability item, tracked separately.

## Password reset (deferred — documented gap)

- **Blocking constraint:** no email address is collected at register (`username` + password only, lib/auth.ts scrypt); there is no mailer, no OAuth. A self-service reset **requires a verified recovery channel first**.
- Options, in ascending order of work:
  1. **Do nothing** — rely on change-password (already exists); users who forget their password can't recover their account, only re-register (their boards would need a DM with account access to hand off). Bad for a hobby tool with no SLA, but zero work.
  2. **Offline admin reset script** — `scripts/reset-password.ts` (CLI: username → new password, runs against `DATABASE_URL`, mirrors `migrate-embedded-images.ts` pattern). DM-of-the-platform can reset for users. ~40 lines, no schema change.
  3. **Email reset** — add `email` column (nullable) + verification flow (token table or signed URL), `POST /api/auth/request-reset` + `POST /api/auth/reset-password`. Requires an SMTP provider (e.g. Resend) — the app has zero email infra today. Real feature, ~2–3 days.
- **Recommendation:** ship option 2 now (cheap, unblocks support requests), revisit option 3 when OAuth/email is added. This plan stops at documenting the decision.

## Rollout / migration

- No schema change. Board deletion is additive; account deletion is additive. Both are safe to ship without F05/F06 (the cascade and the export-tip degrade gracefully when those features aren't deployed yet — the export-tip button should feature-check or be hidden).

## Acceptance criteria

- [ ] DM can delete their board via Board Settings → Danger zone; delete requires typing the board id; success redirects to lobby.
- [ ] Deleted board returns 404 to all API routes; members' pollers redirect to lobby with a message; no infinite retries on mid-edit saves.
- [ ] Players never see the delete/account-deletion UI surfaces (role checks in the modals + server).
- [ ] Account deletion summary lists DM boards (with member counts) and member boards (with owned-item counts) accurately.
- [ ] Account deletion reassigns owned items to each survivor board's DM (`ownerId/ownerName` rewritten, verified by a `owner`-visibility field being viewable by the DM after deletion).
- [ ] Boards where the user is the only member are deleted; boards with other members require the delete checkbox or are blocked with a clear 409 listing blocking boards.
- [ ] Sessions cascade: other devices 401 → auth screen.
- [ ] Re-registering the deleted username succeeds (UNIQUE released).
- [ ] Unit tests: `summarizeDeletion`, `reassignItemsToDm`, delete-board route (403 non-DM, 404 missing, success).

## Open questions

1. **Transfer DM / leave board** — must this ship in the same change as account deletion, or is "kick everyone or delete the board" acceptable for v1? (Recommend: same change — otherwise account deletion for group DMs is a trap.)
2. Should board deletion require an extra server-side guard beyond auth (e.g. `?confirmBoardId=` in the request body) — defense against a CSRF-ish client bug deleting the wrong board? (Cheap: include `boardId` in the DELETE body and verify it matches the path. Recommend yes.)
3. Password reset: confirm option 2 (offline script) is acceptable for now vs. waiting for email infra?
4. Should account deletion **soft-delete** instead (flag on `users`, hide from lobby) to preserve DM content indefinitely? (Recommend hard delete + reassignment: simpler, matches a hobby tool's expectations; export F06 is the preservation path.)
