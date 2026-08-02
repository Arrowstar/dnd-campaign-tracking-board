/**
 * One-time migration: finds board items/fields that still have files or images
 * embedded as base64 data URLs (from before files were routed through Vercel
 * Blob) and replaces them with uploaded Blob URLs, then writes the shrunk tabs
 * back to the DB.
 *
 * This covers data URLs of ANY type (image/png, image/jpeg, application/pdf,
 * text/plain, ...) found in an item's `content`, in an image field's `imageUrl`,
 * or in an attached file's `url`.
 *
 * This runs as a plain Node script against Postgres + Blob directly — it does
 * NOT go through the /api/boards/[boardId]/state route, so it isn't subject
 * to the 4.5MB Vercel Function request-body limit that's blocking saves in
 * the app itself.
 *
 * Usage:
 *   1. Make sure DATABASE_URL (or POSTGRES_URL) and BLOB_READ_WRITE_TOKEN are
 *      set in your environment. Easiest way: `vercel env pull .env.local`
 *      in the project root, then `export $(grep -v '^#' .env.local | xargs)`
 *      (or use a tool like `dotenv-cli`).
 *   2. Dry run first (reports what it would change, writes nothing):
 *        npx tsx scripts/migrate-embedded-images.ts --dry-run
 *   3. Then for real:
 *        npx tsx scripts/migrate-embedded-images.ts
 *
 * Safe to re-run — anything already a URL (not a data: URI) is left alone.
 */

import { getSql } from '../lib/db';
import { put } from '@vercel/blob';

const DRY_RUN = process.argv.includes('--dry-run');

function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:');
}

function extFromMime(mimeType: string): string {
  const sub = mimeType.split('/')[1]?.toLowerCase() || '';
  const clean = sub.split(';')[0].split('+')[0];
  if (/^[a-z0-9]{1,5}$/.test(clean)) return clean;
  return 'bin';
}

function parseDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string; ext: string } {
  const match = /^data:([a-zA-Z0-9+./-]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error('Unrecognized data URL format');
  const mimeType = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const ext = extFromMime(mimeType);
  return { buffer, mimeType, ext };
}

async function uploadDataUrl(dataUrl: string, label: string): Promise<string> {
  const { buffer, mimeType, ext } = parseDataUrl(dataUrl);
  const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);
  console.log(`  uploading ${label} (${sizeMb} MB, ${mimeType})`);
  const blob = await put(`migrated-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`, buffer, {
    access: 'public',
    contentType: mimeType,
  });
  return blob.url;
}

async function migrateBoard(boardId: string, tabs: any[]): Promise<{ tabs: any[]; changed: boolean }> {
  let changed = false;

  for (const tab of tabs) {
    if (!Array.isArray(tab.items)) continue;
    for (const item of tab.items) {
      if (isDataUrl(item.content)) {
        item.content = DRY_RUN
          ? item.content
          : await uploadDataUrl(item.content, `board ${boardId} / item ${item.id} (content)`);
        if (DRY_RUN) console.log(`  [dry-run] would migrate board ${boardId} / item ${item.id} (content)`);
        changed = true;
      }
      if (Array.isArray(item.fields)) {
        for (const field of item.fields) {
          if (isDataUrl(field.imageUrl)) {
            field.imageUrl = DRY_RUN
              ? field.imageUrl
              : await uploadDataUrl(field.imageUrl, `board ${boardId} / item ${item.id} / field ${field.id} (image)`);
            if (DRY_RUN) console.log(`  [dry-run] would migrate board ${boardId} / item ${item.id} / field ${field.id} (image)`);
            changed = true;
          }
          if (Array.isArray(field.files)) {
            for (const file of field.files) {
              if (file && isDataUrl(file.url)) {
                file.url = DRY_RUN
                  ? file.url
                  : await uploadDataUrl(file.url, `board ${boardId} / item ${item.id} / field ${field.id} / file ${file.id || '?'}`);
                if (DRY_RUN) console.log(`  [dry-run] would migrate board ${boardId} / item ${item.id} / field ${field.id} / file ${file.id || '?'}`);
                changed = true;
              }
            }
          }
        }
      }
    }
  }

  return { tabs, changed };
}

async function main() {
  const sql = getSql();
  console.log(DRY_RUN ? 'Running in DRY-RUN mode — no writes will be made.\n' : 'Running for real — the DB will be updated.\n');

  const boards = await sql`SELECT id, tabs FROM boards`;
  console.log(`Found ${boards.length} board(s).\n`);

  let totalMigrated = 0;

  for (const board of boards as any[]) {
    const before = JSON.stringify(board.tabs).length;
    const { tabs, changed } = await migrateBoard(board.id, board.tabs || []);

    if (!changed) {
      console.log(`Board ${board.id}: no embedded images found, skipping.`);
      continue;
    }

    totalMigrated++;
    const after = JSON.stringify(tabs).length;
    console.log(
      `Board ${board.id}: payload ${(before / 1024 / 1024).toFixed(2)} MB -> ${(after / 1024 / 1024).toFixed(2)} MB`
    );

    if (!DRY_RUN) {
      await sql`UPDATE boards SET tabs = ${JSON.stringify(tabs)}::jsonb, updated_at = NOW() WHERE id = ${board.id}`;
      console.log(`  saved.`);
    }
  }

  console.log(`\nDone. ${totalMigrated} board(s) ${DRY_RUN ? 'would be' : 'were'} updated.`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
