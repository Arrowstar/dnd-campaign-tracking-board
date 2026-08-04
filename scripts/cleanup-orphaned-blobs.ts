/**
 * Blob GC: finds blobs in Vercel Blob storage that are no longer referenced by
 * any board and deletes them (with a dry-run default).
 *
 * Uploads only ever happen from board content (the upload route requires board
 * membership), so every blob should be referenced somewhere in a board's tabs.
 * Orphans accumulate when an item/field is deleted or an image is replaced.
 *
 * References are collected from every board's tabs:
 *   - item.content                    (image-card type)
 *   - field.imageUrl                  (portrait/banner/image fields)
 *   - field.files[].url               (attached PDFs/links)
 *   - field.textValue <img src=...>   (rich-text embedded images)
 *   - item.comments[*].text           (defensive — comments are plain text)
 *
 * Usage:
 *   1. Make sure DATABASE_URL (or POSTGRES_URL) and BLOB_READ_WRITE_TOKEN are
 *      set in your environment. Easiest way: `vercel env pull .env.local`
 *      in the project root, then `export $(grep -v '^#' .env.local | xargs)`
 *      (or use a tool like `dotenv-cli`).
 *   2. Dry run first (default — reports orphans, deletes nothing):
 *        npx tsx scripts/cleanup-orphaned-blobs.ts
 *   3. Then delete for real (explicit flag on purpose):
 *        npx tsx scripts/cleanup-orphaned-blobs.ts --delete
 *
 * Safe to re-run. The reference scan is global (all boards), so a blob used
 * by any board — current or in the DB the script points at — is kept.
 * Caveat: the reference set is the DB the script connects to; if preview
 * deployments write to the same blob store but a different database, run this
 * against the production DB only.
 */

import { getSql } from '../lib/db';
import { del, list } from '@vercel/blob';

const DELETE = process.argv.includes('--delete');

interface BlobInfo {
  url: string;
  pathname: string;
  size: number;
}

function normalize(url: string): string {
  return url.split('?')[0];
}

/** Pathname portion of a blob URL, e.g. `https://store.public.blob.vercel-storage.com/abc.png` -> `abc.png`. */
function pathnameOf(url: string): string {
  return normalize(url).split('/').slice(-1)[0];
}

async function listAllBlobs(): Promise<BlobInfo[]> {
  const blobs: BlobInfo[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ cursor, limit: 1000 });
    for (const b of page.blobs) {
      blobs.push({ url: b.url, pathname: b.pathname, size: b.size ?? 0 });
    }
    cursor = page.cursor;
  } while (cursor);
  return blobs;
}

/** Collect every blob URL referenced by any board's tabs. */
function extractReferencedUrls(tabs: any[]): Set<string> {
  const urls = new Set<string>();
  const pathnames = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string' || !/^https?:\/\//.test(value)) return;
    urls.add(normalize(value));
    pathnames.add(pathnameOf(value));
  };

  for (const tab of tabs) {
    if (!Array.isArray(tab?.items)) continue;
    for (const item of tab.items) {
      add(item?.content);
      if (Array.isArray(item?.comments)) {
        for (const comment of item.comments) add(comment?.text);
      }
      if (!Array.isArray(item?.fields)) continue;
      for (const field of item.fields) {
        add(field?.imageUrl);
        if (Array.isArray(field?.files)) {
          for (const file of field.files) add(file?.url);
        }
        if (typeof field?.textValue === 'string') {
          const srcs = field.textValue.match(/src="([^"]*)"/g) || [];
          for (const s of srcs) add(s.slice(5, -1));
        }
      }
    }
  }
  return urls;
}

async function main() {
  const sql = getSql();
  console.log(DELETE ? 'Running for real — orphaned blobs WILL be deleted.\n' : 'Running in DRY-RUN mode — no blobs will be deleted.\n');

  const boards = await sql`SELECT id, tabs FROM boards`;
  console.log(`Scanned reference set: ${boards.length} board(s).\n`);

  const referencedUrls = new Set<string>();
  for (const board of boards as any[]) {
    const urls = extractReferencedUrls(board.tabs || []);
    for (const u of urls) referencedUrls.add(u);
  }
  console.log(`Referenced blob URLs in board data: ${referencedUrls.size}\n`);

  const blobs = await listAllBlobs();
  const totalBytes = blobs.reduce((acc, b) => acc + b.size, 0);
  console.log(`Blob store: ${blobs.length} blob(s), ${(totalBytes / 1024 / 1024).toFixed(2)} MB total.\n`);

  // A blob is orphaned when neither its URL nor its pathname is referenced
  // (pathname matching tolerates host/query differences).
  const orphans = blobs.filter(
    (b) => !referencedUrls.has(normalize(b.url)) && !referencedUrls.has(b.pathname)
  );
  const orphanBytes = orphans.reduce((acc, b) => acc + b.size, 0);
  console.log(`Orphaned: ${orphans.length} blob(s), ${(orphanBytes / 1024 / 1024).toFixed(2)} MB.\n`);

  if (orphans.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  for (const b of orphans) {
    console.log(`  ${DELETE ? '[delete]' : '[orphan]'} ${(b.size / 1024).toFixed(1)} KB  ${b.url}`);
  }

  if (!DELETE) {
    console.log('\nDry run complete. Re-run with --delete to remove the orphaned blobs.');
    return;
  }

  // Batch delete; failures abort so the script can be re-run (delete is
  // idempotent — already-deleted blobs simply won't be listed next time).
  const BATCH = 100;
  let deleted = 0;
  for (let i = 0; i < orphans.length; i += BATCH) {
    const batch = orphans.slice(i, i + BATCH).map((b) => b.url);
    await del(batch);
    deleted += batch.length;
    console.log(`  deleted ${deleted}/${orphans.length}`);
  }
  console.log(`\nDone. ${deleted} orphaned blob(s) deleted.`);
}

main().catch((err) => {
  console.error('Blob GC failed:', err);
  process.exit(1);
});
