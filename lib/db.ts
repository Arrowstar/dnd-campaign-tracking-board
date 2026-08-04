import { neon } from '@neondatabase/serverless';

export function getConnectionString(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
}

export function getSql() {
  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error('DATABASE_URL or POSTGRES_URL environment variable is not defined.');
  }
  return neon(connectionString);
}

// Ensures the schema exists. Deliberately NOT cached across calls/instances:
// every statement here is idempotent (IF NOT EXISTS) and cheap, and caching a
// "success" promise made the app blind to tables being dropped or altered
// out-of-band (e.g. manually in the Neon console) for the lifetime of a warm
// serverless instance.
export async function ensureSchema(): Promise<void> {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;

  // Feature 07 — soft-deleted accounts keep their row (audit trail, comment
  // authorship stays resolvable) but are renamed + locked out. Login and
  // register filter on deleted_at IS NULL.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE`;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;

  // Security-Audit.md medium #6 — sessions expire (30 days, sliding). Rows
  // created before this column existed keep working; `getAuthUser` backfills
  // their expiry on first use, and login/register prune the expired ones.
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE`;
  await sql`CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      board_password_hash TEXT,
      board_password_salt TEXT,
      members JSONB NOT NULL DEFAULT '{}'::jsonb,
      tabs JSONB NOT NULL DEFAULT '[]'::jsonb,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;

  // If an earlier version of this table exists (id + data jsonb only),
  // these are no-ops on a fresh table and additive on an old one.
  await sql`ALTER TABLE boards ADD COLUMN IF NOT EXISTS board_password_hash TEXT`;
  await sql`ALTER TABLE boards ADD COLUMN IF NOT EXISTS board_password_salt TEXT`;
  await sql`ALTER TABLE boards ADD COLUMN IF NOT EXISTS members JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE boards ADD COLUMN IF NOT EXISTS tabs JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`ALTER TABLE boards ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb`;

  // Feature 08 — @mention notifications. FKs do the lifecycle work: deleting a
  // board or user (Feature 07) cascades their notifications.
  await sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      comment_id TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      read BOOLEAN NOT NULL DEFAULT FALSE
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
      ON notifications (user_id, read) WHERE read = FALSE;
  `;
  // Makes mention insertion idempotent: re-saving the same comment (retries,
  // undo/redo) can never create a duplicate notification row.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
      ON notifications (user_id, board_id, item_id, comment_id);
  `;

  // Feature 09 — read-only share links. Tokens are high-entropy bearer
  // secrets (generateToken(), 32 random bytes hex) stored raw, same as
  // session tokens. Board deletion (F07) cascades links; links are board
  // resources, not user resources, so account deletion leaves them intact.
  await sql`
    CREATE TABLE IF NOT EXISTS board_shares (
      token TEXT PRIMARY KEY,
      board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT 'View link',
      created_by UUID,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      expires_at TIMESTAMP WITH TIME ZONE
    );
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS board_shares_board_idx
      ON board_shares (board_id);
  `;
}

// Old name, kept so nothing else in the app has to change.
export const ensureBoardsTable = ensureSchema;
