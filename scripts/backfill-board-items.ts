/**
 * One-time backfill: populates the `board_items` shadow table (Feature 12,
 * Phase 2) from every board's `tabs` JSONB. The shadow table is a
 * write-optimized mirror of tabs[].items[] — reads keep using boards.tabs, so
 * this changes nothing about the state GET/POST wire protocol.
 *
 * Usage:
 *   1. Make sure DATABASE_URL (or POSTGRES_URL) is set in your environment.
 *      Easiest way: `vercel env pull .env.local` in the project root, then
 *      `export $(grep -v '^#' .env.local | xargs)` (or dotenv-cli).
 *   2. Dry run first (reports what it would write, writes nothing):
 *        npx tsx scripts/backfill-board-items.ts --dry-run
 *   3. Then for real:
 *        npx tsx scripts/backfill-board-items.ts
 *
 * Safe to re-run: every insert is ON CONFLICT (id) DO UPDATE, so it converges
 * to the current tabs regardless of how many times it runs or whether the app
 * write path already populated some rows.
 */

import { getSql } from '../lib/db';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const sql = getSql();
  console.log(DRY_RUN ? 'Running in DRY-RUN mode — no writes will be made.\n' : 'Running for real — the DB will be updated.\n');

  const boards = (await sql`SELECT id, tabs FROM boards`) as { id: string; tabs: any[] }[];
  console.log(`Found ${boards.length} board(s).\n`);

  let totalItems = 0;

  for (const board of boards) {
    const items: { id: string; tabId: string; payload: string }[] = [];
    for (const tab of board.tabs || []) {
      for (const item of tab.items || []) {
        items.push({ id: item.id, tabId: tab.id, payload: JSON.stringify(item) });
      }
    }

    if (items.length === 0) {
      console.log(`Board ${board.id}: no items, skipping.`);
      continue;
    }

    totalItems += items.length;
    console.log(`Board ${board.id}: ${items.length} item(s)`);

    if (!DRY_RUN) {
      await sql.query(
        `INSERT INTO board_items (id, board_id, tab_id, payload)
         SELECT t.id, t.board_id, t.tab_id, t.payload::jsonb
         FROM jsonb_to_recordset($1::jsonb) AS t(id TEXT, board_id TEXT, tab_id TEXT, payload TEXT)
         ON CONFLICT (id) DO UPDATE
           SET payload = EXCLUDED.payload, tab_id = EXCLUDED.tab_id, updated_at = NOW()`,
        [
          JSON.stringify(
            items.map((i) => ({ id: i.id, board_id: board.id, tab_id: i.tabId, payload: i.payload }))
          ),
        ]
      );
    }
  }

  console.log(`\nDone. ${totalItems} item(s) ${DRY_RUN ? 'would be' : 'were'} upserted across ${boards.length} board(s).`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
