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

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;

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
}

// Old name, kept so nothing else in the app has to change.
export const ensureBoardsTable = ensureSchema;
