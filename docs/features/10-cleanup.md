# Feature 10 — Cleanup (dead code, stale config, misdocumented claims)

**Status:** Proposed · **Priority:** P3 (housekeeping; low risk, do before any large refactor) · **Dependencies:** none

## Summary

The codebase has accreted scaffolding from its AI Studio origins plus leftovers of earlier iterations. None of these break the app, but they confuse newcomers, waste install size, and misrepresent capabilities. This doc is a **verified inventory** of what to remove/consolidate — every item below was checked against the current tree on 2026-08-04, so the work is mostly mechanical deletion + one consolidation.

**Rule of thumb:** anything here is safe to delete only if a grep for its last usage comes back empty. Each item lists the exact verification command.

## Current state — what's already fine (do NOT touch)

- `.gitignore` covers `.next/`, `*.tsbuildinfo`, `node_modules`, `.env*`, `repomix-output.xml` — no changes needed.
- `next-env.d.ts`, `next.config.ts`, `postcss.config.mjs` — all referenced by Next.js.
- `eslint.config.mjs` is the active flat config (ESLint 9) — it's correct; the problem is the *duplicate* legacy file (item 7).

## Items to fix

### 1. Stub routes: `verify-dm` and `verify-board`
- **Files:** `app/api/boards/[boardId]/verify-dm/route.ts`, `app/api/boards/[boardId]/verify-board/route.ts` — both are `POST` handlers returning hardcoded `{ success: true }` (5 lines each).
- **Evidence:** grep for `verify-dm|verify-board` across `*.{ts,tsx}` returns **zero matches** outside the route files themselves. No client calls them.
- **Action:** delete both directories. If a future feature needs DM/board verification, it will implement the real check (member lookup) at that time — the stubs give false confidence if anyone wires them up later.
- **Verify:** `git grep -n "verify-dm\|verify-board" -- ':!app/api'` → empty; `npm run lint` passes; `npm run build` passes.

### 2. Unused hook: `hooks/use-mobile.ts`
- **Evidence:** grep for `use-mobile|useIsMobile` in `components/**` → no matches. The hook exports `useIsMobile()` via `matchMedia`.
- **Action:** delete `hooks/use-mobile.ts` (and the empty-ish `hooks/` directory if nothing else lives there). Re-introduce it if/when mobile responsiveness (review item 15) is actually implemented.
- **Verify:** `git grep -n "useIsMobile\|use-mobile"` → empty.

### 3. Broken script: `dev-server` → missing `server.ts`
- **Evidence:** `package.json:7` has `"dev-server": "npx tsx server.ts"`, but `server.ts` does not exist at the repo root (verified `Test-Path` → false). Any `npm run dev-server` fails immediately.
- **Action:** if no one uses a custom server entrypoint, delete the script. If someone does, restore `server.ts` (documented here for the record: it was a plain `tsx` entry that likely started a dev server with custom env loading — no evidence of what it did).
- **Verify:** `npm run dev-server` → error *before* the fix; after removal the script is gone.

### 4. Unused dependencies in `package.json`
| Package | Evidence | Action |
|---|---|---|
| `react-xarrows` ^2.0.2 | Connections are hand-drawn SVG paths in Board.tsx; grep for `Xarrow\|react-xarrows` → empty | remove |
| `@hookform/resolvers` ^5.2.1 | No react-hook-form usage anywhere (no forms use RHF) | remove |
| `@google/genai` ^2.4.0 | Dep, env var, and metadata claim exist, but **no code imports it** (grep `genai` in `app/`, `components/`, `lib/` → empty) | remove, plus items 5–6 |
| `firebase-tools` ^15.0.0 (devDep) | AI Studio template leftover; grep `firebase` → empty | remove |
| `@tailwindcss/typography` ^0.5.19 (devDep) | Not registered in `postcss.config.mjs` (only `@tailwindcss/postcss` + `autoprefixer`), and no `@plugin "@tailwindcss/typography"` in `app/globals.css` head | remove (verify full globals.css first — see Verify) |

- **Verify:** after removal, `npm run lint && npm run build`; also `git grep -in "xarrow\|hookform\|genai\|typography\|firebase"` → only expected hits (lockfile churn).
- **Note:** `bun.lock` *and* `package-lock.json` are both tracked. After the dep removal, regenerate **both** (or delete one — see item 8).

### 5. `metadata.json` misrepresents capabilities
- **File:** `metadata.json` — `name` and `description` are empty strings, and `majorCapabilities` claims `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` with no Gemini code anywhere.
- **Action:** set real name/description ("Mythos Canvas — collaborative D&D campaign tracking board") and set `majorCapabilities: []` until an actual AI feature ships. This is the file AI Studio surfaces to its platform — an empty, falsely-claiming manifest is the worst of both worlds.

### 6. `.env.example` documents dead/missing things
- **File:** `.env.example` (19 lines).
  - `GEMINI_API_KEY` — no code uses it (see item 4). Remove the block.
  - Missing `DATABASE_URL` — the app's single most important env var (`lib/db.ts:4` reads `DATABASE_URL || POSTGRES_URL || POSTGRES_PRISMA_URL`); it's not documented at all.
  - Comment references `Security-Audit.md` ("Rate-limit tuning (Security-Audit.md medium #6)") — **no `SECURITY-AUDIT.md` exists at the repo root** (verified `Test-Path` → false for both cases). The rate limits themselves ARE implemented (`lib/rateLimit.ts` + tests), so either create the doc the comment references or drop the parenthetical.
  - `APP_URL` and `BLOB_READ_WRITE_TOKEN` blocks are accurate — keep.
- **Action:** rewrite `.env.example` to document `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `APP_URL`, and the rate-limit tunables without the dangling doc reference.

### 7. Legacy `.eslintrc.json`
- **Files:** `.eslintrc.json` (`{ "extends": "next" }`) coexists with `eslint.config.mjs` (the flat config ESLint 9 actually uses — verified it `extends: [...next]` from `eslint-config-next`). ESLint 9 ignores `.eslintrc.json` unless `eslintrc: true` is set.
- **Action:** delete `.eslintrc.json` so there's one obvious lint config. (If eslint.config.mjs ever needs a compat rule, migrate it in — don't resurrect the legacy file.)
- **Verify:** `npm run lint` output identical before/after.

### 8. Dual lockfiles: `bun.lock` + `package-lock.json`
- **Evidence:** both tracked at the root. The project's package manager is ambiguous — `package.json` scripts don't say, and both lockfiles have history.
- **Decision needed:** pick one (npm if the deployment pipeline uses it, bun otherwise) and delete the other from the repo. Having both guarantees drift: `npm ci` and `bun install` can produce different trees.
- **Action:** document the choice in README; delete the loser.

### 9. Duplicate constant: `MAX_FILE_BYTES`
- **Files:** `lib/utils.ts:252` (`const MAX_FILE_BYTES = 40 * 1024 * 1024; // must match app/api/upload/route.ts`) and `app/api/upload/route.ts:7` (same literal). Two copies already drifted once (the comment exists because of it).
- **Action:** export the constant from `lib/utils.ts` (`export const MAX_FILE_BYTES = 40 * 1024 * 1024;`) and import it in the upload route. Delete the local copy. One source of truth.

### 10. Boilerplate README
- **Evidence:** `README.md` is the untouched AI Studio template ("Run and deploy your AI Studio app", with a Google banner image and an AI Studio app URL). The app has grown a real identity (Mythos Canvas) with zero documentation: no run instructions, no env setup, no feature overview, no link to `docs/features/`.
- **Action:** rewrite README with: what it is, stack (Next.js 15 + Neon + Vercel Blob), local setup (`DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `APP_URL`), `npm run dev`, test/lint commands (`npm test` runs vitest — 14 test files exist in `lib/`), and a pointer to `docs/features/` for the design docs.

### 11. Untracked artifacts on disk (optional)
- `repomix-output.xml` — gitignored (`.gitignore:13`) and untracked; it's a stale repomix dump. Delete the file (no git action needed).
- `tsconfig.tsbuildinfo` — gitignored; regenerates on every build. Safe to delete for tidiness.

## Pre-flight checklist (run once before starting)

1. `git status` clean so deletions are reviewable as a single commit.
2. Run `npm run lint` and `npm test` before any change to have a baseline.
3. Do the deletions in this order: deps (4) → scripts (3) → routes (1) → hook (2) → config (5–8) → constants (9) → docs (6, 10, 11). Run lint/tests after each cluster.

## Acceptance criteria

- [ ] `npm run lint` and `npm test` pass with the same warnings as baseline.
- [ ] `npm run build` succeeds after all deletions.
- [ ] No `verify-*` stubs remain; no `@google/genai`, `react-xarrows`, `@hookform/resolvers`, `firebase-tools`, or `@tailwindcss/typography` in `package.json`.
- [ ] `metadata.json` has real name/description and no Gemini capability claim.
- [ ] `.env.example` documents `DATABASE_URL` and contains no dead Gemini section or dangling doc references.
- [ ] One lockfile, one eslint config; `MAX_FILE_BYTES` imported from a single location.
- [ ] README covers setup + feature docs pointer.
- [ ] `useIsMobile` removable is confirmed by empty grep.

## Open questions

1. Which lockfile survives (npm or bun)? — decides item 8.
2. Should `verify-dm`/`verify-board` be replaced by a real implementation instead of deleted? (Proposed: delete — the members route already does the real checks, and nothing calls these.)
3. Is `firebase-tools` used by any deploy script outside the repo (CI, AI Studio panel)? If yes, keep and document instead.
