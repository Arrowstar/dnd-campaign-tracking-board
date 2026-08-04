# Security Audit — Database Injection & Unauthorized Manipulation

Audit date: 2026-08-03

Scope: Can malicious actors inject "bad" things into the database or manipulate
the database without authorization?

**Verdict: Yes — two critical vectors allow unauthorized database manipulation,
plus several significant issues.** No raw SQL injection exists (all queries use
parameterized neon template tags), but the app has an authorization flaw and a
stored-XSS path that defeats the auth system entirely.

## CRITICAL

### 1. Account-deletion API lets any user delete ANY board (IDOR)

- Location: `app/api/auth/account/route.ts:91` and `:122`
- `const toDelete = new Set<string>(deleteBoardIds)` takes board IDs straight
  from the request body with **no membership/ownership check**, then
  `DELETE FROM boards WHERE id = ANY(...)` executes unconditionally.
- `findBlockingBoards` (`lib/accountDeletion.ts:140`) only guards the caller's
  own DM boards.
- Impact: any authenticated user can wipe any board. Board IDs are short
  user-chosen slugs, and `GET /api/boards/[boardId]` is public (confirms
  existence), so IDs are discoverable. This is complete unauthorized DB
  destruction.
- Fix: intersect `deleteBoardIds` with the caller's memberships (boards where
  `members[user.id]` exists) before adding them to `toDelete`.

### 2. Stored XSS → session-token theft → full account takeover → arbitrary DB writes

- `components/RichTextEditor.tsx:625` — `RichTextDisplay` renders user-controlled
  board content (`item.content`, field `textValue`, comments) via
  `dangerouslySetInnerHTML` with **zero sanitization** (no DOMPurify /
  sanitize-html in `package.json`). Used in FocusDrawer, NpcBoardItemFields,
  StructuredBoardItemFields, and comment rendering.
- `components/BoardItem.tsx:600` — canvas preview path
  (`flattenRichTextForPreview`, `components/RichTextEditor.tsx:662`) strips
  `<script>`/`<style>` but **keeps event handlers, `javascript:` URLs,
  iframes/svg/object** — still XSS.
- Session tokens live in `localStorage` (`dnd_session`, `app/page.tsx:143`),
  trivially exfiltratable by injected script.
- Impact: any board member can execute script in every other viewer's browser
  (including the DM). A stolen DM token grants full DB manipulation: board
  password changes, member removal, share-link creation, DM-only data exports,
  and critical issue #1.
- Fixes:
  1. Sanitize rich text server-side before it reaches the DB (e.g. allowlist
     of tags/attributes via DOMPurify or sanitize-html), and/or escape on
     render instead of `dangerouslySetInnerHTML`.
  2. Move the session token out of `localStorage` into `httpOnly` cookies so
     XSS cannot steal it.

## HIGH

### 3. Players can forge/delete other users' comments

- Location: `lib/fieldVisibility.ts:81`
- For non-owner items, only `comments` pass through: the incoming array
  **replaces** the stored array wholesale.
- Impact: a player can wipe all comments on any visible item, or insert fake
  comments with arbitrary `userId`/`userName` (impersonating the DM).
- Note: comments also render unsanitized (amplifies critical issue #2).
- Fix: merge comments by id; only the comment author (or DM) may delete; stamp
  `userId`/`userName` server-side from the authenticated session, never trust
  the client.

### 4. Players can claim other users' ownership on new items

- Location: `lib/fieldVisibility.ts:76-77`
- New items (no stored match) are accepted as-is, so any member can set
  `ownerId` to another member's id.
- Impact: owner-scoped (`visibility: 'owner'`) fields on that item then bind to
  the victim user. Content-integrity issue.
- Fix: for non-DM users, force `ownerId`/`ownerName` of new items to the
  authenticated user.

## MEDIUM

### 5. Unauthenticated upload endpoint

- Location: `app/api/upload/route.ts`
- No auth check: anyone can upload up to 40 MB of arbitrary content to public
  Vercel Blob storage. Cost/quota abuse; no content-type checks on the legacy
  FormData path.
- Fix: require a valid session (and ideally board membership) for uploads;
  validate content types.

### 6. Weak authentication hardening

- No rate limiting on login/register/join-password endpoints → brute-force /
  credential stuffing feasible.
- Password minimum is 6 characters (`app/api/auth/register/route.ts:24`).
- `verifyPassword` uses non-constant-time comparison (`lib/auth.ts:23`).
- Session tokens never expire; password changes don't invalidate existing
  sessions.
- Fix: rate limiting (e.g. IP + username), stronger password policy, timing-safe
  compare, session expiry/rotation, revoke sessions on password change.

## Verified OK

- SQL injection: all ~72 query sites use parameterized neon template tags; no
  string-concatenated SQL found.
- Board state writes: membership + role checks server-side; players cannot write
  DM-only settings or hidden fields (`lib/fieldVisibility.ts` merge); DM export,
  delete, and share-link management are role-gated.
- Share links: high-entropy bearer tokens (32-byte hex), expiry support,
  anonymous-viewer scrubbing (`lib/shareTokens.ts`).
- Import (`app/api/boards/[boardId]/import/route.ts`): always creates a new
  board, remaps ids, ignores file memberships, size-capped.
- Prototype pollution via `members[user.id]`: not exploitable — user ids are
  server-generated UUIDs (`crypto.randomUUID()`).

## Suggested fix order

1. Critical #1 — one-line intersection fix, prevents arbitrary board deletion.
2. Critical #2 — sanitize rich text + move token to `httpOnly` cookie
   (largest blast radius).
3. High #3 — server-side comment attribution/merging.
4. High #4 — force owner on new items.
5. Medium #5, #6 — auth hardening.
