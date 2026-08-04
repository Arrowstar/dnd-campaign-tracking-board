/**
 * scalability.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Feature 12 — pure helpers for the per-item storage layer (Phase 2) and the
 * client item-delta save path (Phase 2.5):
 *
 *  - `diffBoardItems` — id-keyed diff of the item sets in two board states,
 *    producing upsert/delete sets for the `board_items` shadow table.
 *  - `buildUpsertRows` — row tuples for the batched ON CONFLICT insert.
 *  - `ItemSaveOp` / `applyItemOpsToTabs` / `buildSaveOps` — the client's
 *    items-only save body, derived from the Feature 11 HistoryPatch.
 *  - `buildJsonbSetChain` — per-item jsonb_set paths so the server can patch
 *    `boards.tabs` with an O(diff) UPDATE payload instead of re-serializing the
 *    whole board in the Node runtime.
 *
 * All functions are pure and unit-tested (lib/scalability.test.ts). Nothing
 * here imports server-only modules — the client save path shares it.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { BoardItem, BoardTab } from './types';
import { HistoryPatch, isEqual } from './undoHistory';

/** One client-side item mutation (Phase 2.5). Deletes intentionally have no op form. */
export type ItemSaveOp = {
  type: 'upsert';
  tabId: string;
  item: BoardItem;
};

/** A row-level upsert for the `board_items` shadow table. */
export type ItemUpsert = { id: string; tabId: string; item: BoardItem };

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — board_items shadow diff
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Diff the item sets of two board states by id (item uuids are unique
 * board-wide). `upserts` covers added and changed items (and items moved
 * between tabs); `deletes` covers ids absent from `mergedTabs`.
 */
export function diffBoardItems(
  storedTabs: BoardTab[],
  mergedTabs: BoardTab[]
): { upserts: ItemUpsert[]; deletes: string[] } {
  const index = (tabs: BoardTab[]) => {
    const map = new Map<string, { tabId: string; item: BoardItem }>();
    for (const tab of tabs) {
      for (const item of tab.items || []) map.set(item.id, { tabId: tab.id, item });
    }
    return map;
  };

  const stored = index(storedTabs);
  const merged = index(mergedTabs);
  const upserts: ItemUpsert[] = [];
  const deletes: string[] = [];

  for (const [id, entry] of stored) {
    const next = merged.get(id);
    if (!next) {
      deletes.push(id);
    } else if (next.tabId !== entry.tabId || !isEqual(next.item, entry.item)) {
      upserts.push({ id, tabId: next.tabId, item: next.item });
    }
  }
  for (const [id, entry] of merged) {
    if (!stored.has(id)) upserts.push({ id, tabId: entry.tabId, item: entry.item });
  }

  return { upserts, deletes };
}

/** Row tuples for `INSERT INTO board_items (id, board_id, tab_id, payload) VALUES ...`. */
export function buildUpsertRows(upserts: ItemUpsert[], boardId: string): unknown[][] {
  return upserts.map((u) => [u.id, boardId, u.tabId, JSON.stringify(u.item)]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2.5 — client item-delta save body
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether a HistoryPatch is expressible as item-upsert ops. The ops fast path
 * is only safe when:
 *  - nothing but items changed (no connections/annotations/tab deltas);
 *  - no item was deleted (deletes have no op form; jsonb array removal via
 *    `#-` with shifting indices is fragile — the full-tabs path handles them);
 *  - no changed item was RENAMED (a title change forces syncLinkTitles across
 *    the board, which the ops path would otherwise skip).
 *
 * Returns the ops array when the patch qualifies, else null (caller falls back
 * to the full-tabs POST).
 */
export function buildSaveOps(patch: HistoryPatch): ItemSaveOp[] | null {
  const hasChanges = (d: { before: Record<string, unknown>; after: Record<string, unknown> }) =>
    Object.keys(d.before).length > 0 || Object.keys(d.after).length > 0;

  if (hasChanges(patch.connections) || hasChanges(patch.annotations) || hasChanges(patch.tabs)) {
    return null;
  }
  if (!isEqual(patch.tabOrder.before, patch.tabOrder.after)) return null;

  const { before, after } = patch.items;
  for (const id of Object.keys(after)) {
    const prev = before[id];
    if (prev && prev.title !== after[id].title) return null; // rename → full path
  }
  for (const id of Object.keys(before)) {
    if (!(id in after)) return null; // delete → full path
  }

  return Object.keys(after).map((id) => ({
    type: 'upsert' as const,
    tabId: patch.tabOf.items[id],
    item: after[id],
  }));
}

/**
 * Apply upsert ops onto a board state: existing ids are replaced in place
 * (array order preserved), new ids are appended to their tab. Tabs referenced
 * by an op but absent from the state are skipped (defensive — a client whose
 * state predates a remote tab deletion cannot recreate the tab through ops).
 */
export function applyItemOpsToTabs(tabs: BoardTab[], ops: ItemSaveOp[]): BoardTab[] {
  const opsByTab = new Map<string, Map<string, BoardItem>>();
  for (const op of ops) {
    let byId = opsByTab.get(op.tabId);
    if (!byId) {
      byId = new Map();
      opsByTab.set(op.tabId, byId);
    }
    byId.set(op.item.id, op.item);
  }

  return tabs.map((tab) => {
    const byId = opsByTab.get(tab.id);
    if (!byId) return tab;
    const existingIds = new Set((tab.items || []).map((i) => i.id));
    const items = (tab.items || []).map((item) => byId.get(item.id) ?? item);
    for (const [id, item] of byId) {
      if (!existingIds.has(id)) items.push(item);
    }
    return { ...tab, items };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2.5 — per-item jsonb_set chain for the boards.tabs UPDATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the jsonb_set path chain that patches STORED tabs in place. Existing
 * ids keep their stored array index (positions never shift — mergeTabsForSave
 * maps arrays in place); new ids append at `storedLength + appendCount` for
 * their tab, so chained jsonb_set calls evaluate against the growing array
 * correctly. The final item values come from `finalTabs` (post-merge,
 * post-sanitize), not from the raw ops.
 */
export function buildJsonbSetChain(
  storedTabs: BoardTab[],
  finalTabs: BoardTab[],
  ops: ItemSaveOp[]
): { path: string[]; item: unknown }[] {
  const tabIndexById = new Map(storedTabs.map((t, i) => [t.id, i]));
  const finalById = new Map<string, unknown>();
  for (const tab of finalTabs) {
    for (const item of tab.items || []) finalById.set(item.id, item);
  }

  const appendCount = new Map<string, number>();
  const chain: { path: string[]; item: unknown }[] = [];

  for (const op of ops) {
    const tabIndex = tabIndexById.get(op.tabId);
    if (tabIndex === undefined) continue; // tab gone remotely — drop the op
    const stored = storedTabs[tabIndex];
    const storedItems = stored.items || [];
    const itemIndex = storedItems.findIndex((i) => i.id === op.item.id);
    if (itemIndex === -1) {
      const count = appendCount.get(op.tabId) ?? 0;
      appendCount.set(op.tabId, count + 1);
      chain.push({
        path: [String(tabIndex), 'items', String(storedItems.length + count)],
        item: finalById.get(op.item.id) ?? op.item,
      });
    } else {
      chain.push({
        path: [String(tabIndex), 'items', String(itemIndex)],
        item: finalById.get(op.item.id) ?? op.item,
      });
    }
  }

  return chain;
}
