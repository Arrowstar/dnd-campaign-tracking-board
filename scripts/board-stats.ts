/**
 * Ad-hoc scalability stats (Feature 12, Phase 0) — run against the database
 * directly, no HTTP endpoint needed:
 *
 *   npx tsx scripts/board-stats.ts
 *
 * Reports board count, session count, per-board member counts, and the
 * largest boards by stored tabs bytes — the baseline for the Phase 0 targets
 * (max board size, p95 save latency from Vercel function logs).
 */

import { getSql } from '../lib/db';

async function main() {
  const sql = getSql();

  const [boardCount, sessionCount] = await Promise.all([
    sql`SELECT COUNT(*)::int AS count FROM boards`,
    sql`SELECT COUNT(*)::int AS count FROM sessions`,
  ]);
  console.log(`Boards: ${boardCount[0].count}  ·  Sessions: ${sessionCount[0].count}\n`);

  const boards = await sql`
    SELECT id, octet_length(tabs::text) AS bytes,
      (SELECT count(*) FROM jsonb_object_keys(COALESCE(members, '{}'::jsonb))) AS member_count
    FROM boards ORDER BY bytes DESC LIMIT 20
  `;

  console.log('Largest boards by stored tabs bytes:');
  console.log('  bytes        members  board id');
  for (const b of boards as { id: string; bytes: number; member_count: number }[]) {
    const mb = (b.bytes / (1024 * 1024)).toFixed(2).padStart(8);
    const members = String(b.member_count).padStart(7);
    console.log(`  ${mb} MB    ${members}  ${b.id}`);
  }

  const total = (await sql`SELECT COALESCE(SUM(octet_length(tabs::text)), 0)::bigint AS bytes FROM boards`)[0]
    ?.bytes as number;
  console.log(`\nTotal tabs bytes across all boards: ${(total / (1024 * 1024)).toFixed(2)} MB`);
}

main().catch((err) => {
  console.error('Stats failed:', err);
  process.exit(1);
});
