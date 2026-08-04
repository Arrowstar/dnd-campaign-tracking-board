# Mythos Canvas

A collaborative campaign tracking board for tabletop role-playing games. Create boards of cards with rich-text notes, images, annotations, connections, tags, quest/session tracking, mentions, and more — share them with your table via read-only share links.

## Stack

- **Next.js 15** (App Router, React 19, TypeScript)
- **Neon** (PostgreSQL) via `@neondatabase/serverless`
- **Vercel Blob** for image/document uploads
- **TipTap** rich-text editor (ProseMirror under the hood)

## Local setup

**Prerequisites:** Node.js 20+ and npm (the package manager of record — `package-lock.json` is the single lockfile).

1. Install dependencies: `npm install`
2. Create `.env.local` from `.env.example` and fill in:
   - `DATABASE_URL` — Neon Postgres connection string (required)
   - `BLOB_READ_WRITE_TOKEN` — Vercel Blob token (required for uploads)
   - `APP_URL` — e.g. `http://localhost:3000`
3. Run the dev server: `npm run dev`
   The schema is created automatically on first request (`ensureSchema`).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint (flat config, `eslint.config.mjs`) |
| `npm test` | Vitest unit tests (14 suites in `lib/`) |

## Project layout

- `app/` — routes and API handlers (boards, auth, uploads, shares)
- `components/` — React UI (board canvas, editors, modals)
- `lib/` — domain logic and server utilities, each with unit tests

## Design docs

Feature specifications live in [docs/features/](docs/features/) — search, tags, quest sessions, history, export/import, share links, mentions, account management, and more. A security audit is in [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md).
