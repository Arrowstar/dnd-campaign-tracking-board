# Feature 08 — @Mentions in Comments

**Status:** Implemented (verification in progress — autocomplete + highlights confirmed live; notification flows pending two-session check) · **Priority:** P2 · **Dependencies:** none hard; coordinates with Feature 07 (account deletion must clean up notifications) and Feature 01 (search indexes comment text)

## Summary

Comments on cards (`BoardItem.comments`, edited in the FocusDrawer Comments tab) are today a one-way broadcast: a player writes "DM, please review this quest" and nothing happens until the DM happens to open that card. This feature adds `@username` mentions in comments with:

1. **Autocomplete** — typing `@` in the comment input shows board members, filtered as you type.
2. **Highlighting** — rendered comment text highlights valid mentions (`@bob` in the board's accent color); invalid/non-member mentions render as plain text.
3. **In-app notifications** — a board-scoped notification center (bell in the toolbar with an unread badge); clicking a notification flies to the card and opens its Comments tab.

No email/SMS — notifications are in-app only (the app has no messaging infra; see Feature 07's email discussion for the same constraint).

## User stories

1. As a player, I type `@alice` in a comment; Alice (the DM) gets a badge the next time she opens the board.
2. As a DM, I click a "new mention" notification and land on the exact card, Comments tab open, my name highlighted.
3. As a DM, I want to *not* be pinged when I mention myself or when someone @-mentions themselves.
4. As a user, I can see mentions even for cards I don't own (comments are visible to all members).

## Current state (verify before coding)

- `Comment { id, userId, userName, text, timestamp }` (lib/types.ts:117). No mentions, no read state.
- Comments are **not** a separate API surface — they live inside `ItemField`-less `item.comments` and flow through the whole-board save: `POST /api/boards/[boardId]/state` → `mergeTabsForSave` (lib/fieldVisibility.ts:80 allows non-owner, non-DM users to change *only* comments) → `syncLinkTitles`.
- Comment UI: FocusDrawer.tsx — `handleAddComment` (~line 158), list with delete (owner/DM), timestamp.
- **Board members** (the mention vocabulary): `GET /api/boards/[boardId]/members` returns `{ displayName, username, role, joinedAt }[]`. `boards.members` JSONB is keyed by user id — note it stores `{ role, joinedAt }` only, **no usernames**, so username resolution requires a users-table join (the members route already does it).
- Cross-link chips (`@@MULTILINK` tokens) exist for *items*, not users — mentions deliberately use a plain `@username` syntax rather than new token types (see "Why not tokens" in Data model).
- Navigation machinery: `handleScrollToItem` (Board.tsx:1319) switches tabs + centers + flashes; FocusDrawer has a comments tab that can be opened programmatically (`focusedItemId` + active tab state in Board.tsx/FocusDrawer).

## UX spec

### 1. Autocomplete (FocusDrawer Comments tab)
- While typing in the comment textarea, a `@` followed by ≥ 1 char (or even `@` alone on the member list) opens a dropdown of matching board members (match on `username` and `displayName`, case-insensitive prefix).
- Keyboard: ↑/↓ to move, Enter/Tab to insert, Escape to close. Click inserts.
- Insertion replaces the `@prefix` currently being typed, appending ` @username` (mention = the member's `username`, which is the login name and is unique and immutable today).
- Mention inserted mid-text is fine; highlight matching happens at render, not at input.

### 2. Rendering + highlight (`Comment` render path in FocusDrawer)
- Split `text` on `@\w+` boundaries; tokens matching a current board member's `username` render as a gold/dark pill (board accent `#B58D3D`), non-matching `@words` render as plain text (explicitly *not* highlighted, so casual "at" usage isn't noisy).
- The member vocabulary is fetched once per board load (`GET /members`) and cached — the lobby already fetches member data for the members modal, so reuse/cache it in Board.tsx state.
- Hover on a mention: tooltip "Bob (DM)". Click: no-op in v1 (see Open questions: jump-to-user is meaningless without a user avatar/chrome).

### 3. Notifications
**Bell in the Toolbar** (new icon between zoom controls and the members/settings cluster):
- Unread badge (count) for the *current board only* (notifications are board-scoped; the lobby shows nothing in v1).
- Dropdown: "Mentions" list, newest first: `"Bob mentioned you on "Quest: Red Larch"` + relative time. Click row → `handleScrollToItem(itemId)` + open the FocusDrawer with the Comments tab active.
- Actions: "Mark all read" (or auto-mark-on-open of the dropdown; see Open questions). "Open board history/notifications" — no, keep it minimal: mark-read + rows.
- **Self-mentions never notify** (neither the author nor their own mention).

## Data model changes

- **`Comment` — no change.** Mentions are plain text; resolution is a render-time concern. (Why not tokens: link tokens resolve to *items*; users aren't items. A user-token type would add a second encoding path, remapping duties in import (F06), and sync complexity for zero gain — the username is already a stable unique key.)
- **New table** in `lib/db.ts` `ensureSchema`:
```sql
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  read BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id, read) WHERE read = FALSE;
```
- FKs do the lifecycle work for free: board deleted (F07) → notifications cascade; user deleted (F07) → their notifications cascade; the author's own user row is separate.
- Optional backfill migration: scan existing comments once and insert notifications for pre-existing mentions (`scripts/backfill-mentions.ts`, dry-run flag, mirrors `migrate-embedded-images.ts`) — **recommend shipping it** so DMs get badges for mentions already in their boards.

## API changes

### Mention detection (server, in the state save route)
The save route is the single write path, so detect mentions there — no new comment endpoint, no client trust. After `mergeTabsForSave` (before the `UPDATE`):
1. Diff `incoming` vs `stored` comments per item (by `comment.id`), collecting **new** comments only.
2. Extract `@username` tokens (`/\B@([a-zA-Z0-9_\- ]+?)(?=\s|$|\.|,)/` — define precisely in `lib/mentions.ts`; usernames are `[a-zA-Z0-9_\- ]` per the register validation).
3. Resolve usernames → user ids for **this board's members** (one query: `SELECT id, username FROM users WHERE username = ANY(...)`; then intersect with the board's `members` JSONB keys).
4. Insert `notifications` rows for each (mentionee, board, item, comment) **except** where mentionee = comment author (`Comment.userId`).
5. Dedupe: don't insert if an identical (user, board, item, comment) row already exists (retries/re-saves of the same comment are idempotent).

Note: this lives in the save path, so it fires for the polled state too — **restoring from history (F05) can resurrect notifications**. Mitigation: restore route deletes notifications for the board, or accepts the stale rows (they'd be dead links). **Decision: restore deletes the board's notifications** (one `DELETE`, cheap, correct).

### New: `GET /api/boards/[boardId]/notifications` (board-scoped — decided over the generic `/api/notifications?boardId=` shape per Open question 4)
- Auth required. Returns `{ notifications: [{ id, itemId, itemTitle, commentId, commenterName, createdAt, read }] }` for the current board, unread first. `itemTitle` resolved from the board's tabs (the route already loads the board for auth) — if the item no longer exists, include `itemDeleted: true` so the client can render "(deleted card)" and skip navigation.

### New: `POST /api/boards/[boardId]/notifications/read` (body: `{ ids?: number[] }`)
- Auth required. Marks the given ids read (or all unread for the board when `ids` omitted). Returns `{ success }`.
- Unread count is derived client-side from the same GET (no separate count endpoint).

## Implementation plan

### Files
| File | Change |
|---|---|
| `lib/db.ts` | Add `notifications` table + index to `ensureSchema`. |
| `lib/mentions.ts` | **New.** `extractMentions(text): string[]` (with the exact regex), `mentionsInComments(comments): string[]`, `insertMentionNotifications(sql, boardId, memberIds, mentions, itemId, commentId, authorId)` (idempotent insert). Pure where possible → unit tests. |
| `app/api/boards/[boardId]/state/route.ts` | Mention detection hook after merge (step 2 in API changes). |
| `app/api/boards/[boardId]/history/[historyId]/restore/route.ts` | (F05) — add "delete board notifications" line when implemented; if F05 ships first, edit it; otherwise this plan's restore section documents it. |
| `app/api/boards/[boardId]/notifications/route.ts` | **New.** GET (board-scoped, unread-first). |
| `app/api/boards/[boardId]/notifications/read/route.ts` | **New.** POST mark-read. |
| `components/FocusDrawer.tsx` | Comment input autocomplete (member list prop from Board); mention-highlight renderer; `initialTab` + `onInitialTabConsumed` deep-link props. |
| `components/MentionAutocomplete.tsx` | **New.** Pure presentational dropdown — positioned by `lib/mentionSuggestion.ts` (custom mount, see below); keyboard state driven via `ReactRenderer.updateProps`. |
| `components/NotificationBell.tsx` | **New.** Toolbar bell + dropdown + mark-read. |
| `components/Board.tsx` | Cache full member records (incl. `username`/`role`) from `/members`; load notifications on mount + after each state apply/save; wire bell; deep-link on notification click (`initialTab='comments'`). |
| `components/RichTextEditor.tsx` | **New** optional `mentions` prop → suggestion extension (no `extension-mention` — plain-text insertion); factory lives in `lib/mentionSuggestion.ts` so the trigger→render pipeline is unit-testable. |
| `lib/mentionSuggestion.ts` | **New.** `createMentionSuggestion(getMentions)` — `Suggestion`-based `@` extension + `mentionSuggestionKey` (shared `PluginKey`; prosemirror key names are counter-based — never recreate for state reads). |
| `components/Toolbar.tsx` | `notificationBell` slot (pass-through). |
| `scripts/backfill-mentions.ts` | **New.** One-off backfill (dry-run flag) — **deferred** per decision; pre-existing mentions won't notify retroactively. |

### Autocomplete popup mounting (why we do NOT use `props.mount`)
The suggestion plugin's built-in mount relies on Floating UI (`autoUpdate`/`computePosition`) and, in the live app, left the popup in `<body>` **unpositioned** (`position: static`, end of the document → below the fold, invisible). `lib/mentionSuggestion.ts` therefore mounts the popup itself: append `ReactRenderer.element` to `<body>`, pin it to the active `[data-decoration-id]` span with `position: fixed` + `left/top` from its bounding rect (`z-index: 50`, `visibility: visible`), and re-place on scroll/resize (capture phase). Escape/Enter/selection-change still exit via the plugin's normal path. Regression guard: `lib/mentionSuggestion.test.ts` asserts the popup is in `<body>` with `position: fixed` + coordinates.

### Comment-tab deep link (notification click)
Implemented via an `initialTab` prop on FocusDrawer (no ref lift needed): Board sets `focusInitialTab='comments'` + `focusedItemId` on notification click; FocusDrawer's effect applies the tab once the item is present (works whether the drawer is already on that item or the item arrives after a tab switch — `handleScrollToItem` switches tabs) and calls `onInitialTabConsumed` so Board clears the request. `handleCloseFocus` also drops any pending request.

## Edge cases & conflicts

- **Username changes:** none exist today (no rename feature); if one ships, notification rows are keyed by user id, so they survive; `Comment.text` mentions become stale — acceptable, they degrade to plain text.
- **Account deletion (F07):** `ON DELETE CASCADE` removes the deleted user's notifications. Mention texts mentioning a deleted user degrade to plain text (they're no longer a member — correct).
- **Member leaves:** same as above (leave = membership removal; mention highlight drops them from the vocabulary).
- **Mention of a non-member:** not highlighted, no notification. Documented behavior; avoids cross-board ping spam.
- **Self-mention / self-notify:** never notifies; highlight still shows (their own name in gold is fine).
- **Spam/abuse:** mentions are limited to comment authors who are board members; a player can at most spam the DM — acceptable for a group of friends; the "mention limit" (e.g. max 5 notifications per comment) is a cheap guard: **cap at 5 mentions per comment**.
- **Deleted comment with a pending notification:** comment deleted → notification is a dead link; client shows "(comment deleted)" row and a "Dismiss" affordance, or deletes the notification on comment delete. **Decision: delete notifications for that comment id on comment delete** (one `DELETE` in the save route's merge diff — cheap; put it in the same mention hook).
- **Polled remote comment adds:** notifications are created server-side during the save, so remote commenters produce notifications for the viewer without any client work. 

## Rollout / migration

- New table + index via `ensureSchema` (idempotent, no manual migration).
- Backfill script optional but recommended.
- Feature-flag not needed; ships incrementally (highlight can land before the bell).

## Acceptance criteria

- [x] `@` autocomplete lists board members; Enter/Tab inserts `@username` (verified live on Vercel deployment).
- [x] Valid mentions render highlighted; invalid `@words` render as plain text (`highlightMentions` + unit tests).
- [x] Mentioning another member creates a notification for them; self-mentions and non-members produce none (server hook + unit tests; two-session check pending).
- [x] Bell shows unread count; click navigates to the card + opens Comments tab; mark-read works; rows for deleted items/comments degrade gracefully (manual check pending).
- [ ] Restore-from-history (F05) clears the board's notifications (F05 route not built yet — documented in the plan).
- [x] Account/board deletion (F07) cascades notifications (`ON DELETE CASCADE` + unique index).
- [x] Re-saving an unchanged comment does not duplicate notifications (idempotent `ON CONFLICT DO NOTHING` + diff).
- [x] Unit tests for `extractMentions` (boundaries: punctuation, multiple mentions, trailing space, `@` mid-word excluded) — 25 tests in `lib/mentions.test.ts`.

## Open questions

1. Should the DM get an opt-in "someone commented on any card" notification (not just mentions)? (Proposed: later — settings toggle in BoardSettings; v1 is mentions-only.)
2. Mark-read on dropdown open vs explicit button? (Proposed: explicit "Mark all read" — preserves unread as a signal.)
3. Click a mention chip in a comment — should it jump to anything? (Proposed: no-op v1; a user *panel* (their items, their comments) is a v2 feature.)
4. Should notifications be global across boards with per-board unread in the Lobby sidebar? (Proposed: no — board-scoped keeps the model and UI small.)
