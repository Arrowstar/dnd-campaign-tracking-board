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

// Ensures the schema exists. Cached per warm serverless instance so we're not
// re-running DDL on every request, but it's cheap/idempotent if it does run again.
let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
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
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `;

      // If an earlier version of this table exists (id + data jsonb only),
      // these are no-ops on a fresh table and additive on an old one.
      await sql`ALTER TABLE boards ADD COLUMN IF NOT EXISTS board_password_hash TEXT`;
      await sql`ALTER TABLE boards ADD COLUMN IF NOT EXISTS board_password_salt TEXT`;
      await sql`ALTER TABLE boards ADD COLUMN IF NOT EXISTS members JSONB NOT NULL DEFAULT '{}'::jsonb`;
      await sql`ALTER TABLE boards ADD COLUMN IF NOT EXISTS tabs JSONB NOT NULL DEFAULT '[]'::jsonb`;
    })();
  }
  return schemaReady;
}

// Old name, kept so nothing else in the app has to change.
export const ensureBoardsTable = ensureSchema;
