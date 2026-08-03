/**
 * Offline admin password reset (Feature 07 — account management).
 *
 * The app has username+password auth with no email infrastructure, so there is
 * no self-service password reset. This script lets the person who runs the
 * platform reset a user's password directly against the database, mirroring
 * the scripts/migrate-embedded-images.ts pattern.
 *
 * Usage:
 *   npx tsx scripts/reset-password.ts <username> <new-password>
 *
 * Requirements:
 *   - DATABASE_URL (or POSTGRES_URL) set in the environment. Easiest way:
 *     `vercel env pull .env.local` in the project root, then
 *     `export $(grep -v '^#' .env.local | xargs)` (or use dotenv-cli).
 *
 * Side effects:
 *   - Replaces the password hash/salt (scrypt, same as register/change-password).
 *   - Deletes all of the user's sessions, forcing re-login on every device.
 *   - Soft-deleted accounts (Feature 07) can never be matched by their old
 *     username — they are renamed to `deleted_<id>` and cannot be reset.
 */

import { getSql } from '../lib/db';
import { hashPassword } from '../lib/auth';

async function main() {
  const [usernameArg, password] = process.argv.slice(2);
  if (!usernameArg || !password) {
    console.error('Usage: npx tsx scripts/reset-password.ts <username> <new-password>');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('Error: new password must be at least 6 characters.');
    process.exit(1);
  }

  const username = usernameArg.trim().toLowerCase();
  const sql = getSql();

  const rows = await sql`SELECT id FROM users WHERE username = ${username} LIMIT 1`;
  if (rows.length === 0) {
    console.error(`Error: no user named "${username}".`);
    process.exit(1);
  }
  // Soft-deleted accounts are renamed to `deleted_<id>` (Feature 07), so a
  // deleted account can never be found by its original username above.

  const { hash, salt } = await hashPassword(password);
  const userId = rows[0].id;

  await sql.transaction((tx) => [
    tx`UPDATE users SET password_hash = ${hash}, salt = ${salt} WHERE id = ${userId}`,
    tx`DELETE FROM sessions WHERE user_id = ${userId}`,
  ]);

  console.log(`Password reset for "${username}". All sessions were invalidated — re-login required.`);
}

main().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
