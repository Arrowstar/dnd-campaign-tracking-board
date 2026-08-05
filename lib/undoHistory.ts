/**
 * undoHistory.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Feature 11 — Global undo across syncs. Id-keyed delta patches replace the old
 * full-board snapshot history:
 *
 *  - `computeDiff` records ONLY what changed (per item / connection /
 *    annotation / tab / item-move), so an undo step is a handful of ids
 *    instead of a whole board copy.
 *  - `applyPatch` reconciles the patch ON TOP of the current state: ids the
 *    local user didn't mutate are never touched, ids that have since changed
 *    remotely are skipped (never clobbered), and deleted-then-recreated ids
 *    (new uuid) are treated as absent.
 *  - `serializeHistory` / `deserializeHistory` persist the stacks to user-
 *    scoped localStorage keys (`dnd_undo_<userId>_<boardId>`), versioned and
 *    size-capped so history survives reloads without leaking across accounts.
 *
 * All functions here are pure (unit-testable). localStorage access is
 * try/catch'd — private-mode storage throws, and history silently degrades to
 * in-memory.
 *
 * Reference-safety note: stored values are the ORIGINAL object references from
 * the state at record time. The codebase updates state immutably (every
 * mutation produces new objects), so these references never change under us —
 * the `structuredClone` the old snapshot code needed is gone from the hot path.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { BoardAnnotation, BoardItem, BoardTab, Connection } from './types';

/** id → value before the mutation (for changed/removed ids). */
export type DeltaEntry<T extends { id: string }> = {
  before: Record<string, T>;
  after: Record<string, T>;
};

/**
 * An item whose TAB MEMBERSHIP changed without its content changing (Feature 04
 * move-to-tab). `computeDiff` can't express this through the content deltas —
 * the item value is identical in both tabs — so moves are recorded explicitly
 * so one undo step can revert them.
 */
export type ItemMove = {
  id: string;
  fromTabId: string;
  toTabId: string;
};

export type HistoryPatch = {
  items: DeltaEntry<BoardItem>;
  connections: DeltaEntry<Connection>;
  annotations: DeltaEntry<BoardAnnotation>;
  tabs: DeltaEntry<BoardTab>;
  /** Tab id order before/after the mutation — a reorder changes no tab's identity. */
  tabOrder: { before: string[]; after: string[] };
  /** Owning tab id per changed item/connection/annotation — needed to re-insert ids a mutation removed. */
  tabOf: {
    items: Record<string, string>;
    connections: Record<string, string>;
    annotations: Record<string, string>;
  };
  /** Items moved between tabs with unchanged content (may be empty). */
  moves: ItemMove[];
};

/** One undo step. The in-memory stack also keeps before/after tab REFERENCES for the coalescing guard (Board.tsx); only this shape is serialized. */
export type UndoEntry = {
  key: string;
  time: number;
  patch: HistoryPatch;
  activeTabIdBefore: string;
  activeTabIdAfter: string;
};

export const HISTORY_LIMIT = 50;
/** Size cap per persisted key (1 MB) — oldest entries are dropped first. */
export const HISTORY_MAX_BYTES = 1024 * 1024;
/** Size cap per entry (256 KB) — a single entry that exceeds this is dropped. */
export const HISTORY_MAX_ENTRY_BYTES = 256 * 1024;

const STORAGE_VERSION = 1;

/** Reference-preserving deep equality (values are JSON-shaped by construction). */
export function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─────────────────────────────────────────────────────────────────────────────
// Diffing
// ─────────────────────────────────────────────────────────────────────────────

type IndexedCollection<T> = { id: string; tabId: string; value: T };

function indexCollection<T extends { id: string }>(
  tabs: BoardTab[],
  extract: (tab: BoardTab) => T[] | undefined
): Map<string, IndexedCollection<T>> {
  const map = new Map<string, IndexedCollection<T>>();
  for (const tab of tabs) {
    for (const value of extract(tab) || []) {
      map.set(value.id, { id: value.id, tabId: tab.id, value });
    }
  }
  return map;
}

function computeDelta<T extends { id: string }>(
  before: Map<string, IndexedCollection<T>>,
  after: Map<string, IndexedCollection<T>>
): { delta: DeltaEntry<T>; tabOf: Record<string, string> } {
  const delta: DeltaEntry<T> = { before: {}, after: {} };
  const tabOf: Record<string, string> = {};
  for (const [id, entry] of before) {
    const next = after.get(id);
    if (!next || !isEqual(entry.value, next.value)) {
      delta.before[id] = entry.value;
      tabOf[id] = entry.tabId;
    }
  }
  for (const [id, entry] of after) {
    const prev = before.get(id);
    if (!prev || !isEqual(prev.value, entry.value)) {
      delta.after[id] = entry.value;
      tabOf[id] = entry.tabId;
    }
  }
  return { delta, tabOf };
}

/**
 * Tab-level changes are only name/color/order/identity — item content lives in
 * its own delta. Shallow comparison keeps a typing edit from producing a
 * whole-tab entry that would then fail (or clobber) on reconcile.
 */
function shallowTabEqual(a: BoardTab, b: BoardTab): boolean {
  return a.name === b.name && a.color === b.color;
}

function computeTabDelta(
  before: Map<string, IndexedCollection<BoardTab>>,
  after: Map<string, IndexedCollection<BoardTab>>
): DeltaEntry<BoardTab> {
  const delta: DeltaEntry<BoardTab> = { before: {}, after: {} };
  for (const [id, entry] of before) {
    const next = after.get(id);
    if (!next || !shallowTabEqual(entry.value, next.value)) {
      delta.before[id] = entry.value;
    }
  }
  for (const [id, entry] of after) {
    const prev = before.get(id);
    if (!prev || !shallowTabEqual(prev.value, entry.value)) {
      delta.after[id] = entry.value;
    }
  }
  return delta;
}

/**
 * Diff two board states into a HistoryPatch. Items/connections/annotations are
 * flattened across all tabs (ids are globally unique uuids); tabs are diffed
 * shallowly (name/color) with their order captured in `tabOrder`. Items whose
 * content is identical but whose owning tab changed are captured in `moves`
 * (Feature 04 move-to-tab) — the content deltas cannot express a tab change.
 */
export function computeDiff(beforeTabs: BoardTab[], afterTabs: BoardTab[]): HistoryPatch {
  const beforeItems = indexCollection(beforeTabs, (t) => t.items);
  const afterItems = indexCollection(afterTabs, (t) => t.items);
  const beforeConns = indexCollection(beforeTabs, (t) => t.connections);
  const afterConns = indexCollection(afterTabs, (t) => t.connections);
  const beforeAnns = indexCollection(beforeTabs, (t) => t.annotations);
  const afterAnns = indexCollection(afterTabs, (t) => t.annotations);
  const beforeTabsIdx = indexCollection(beforeTabs, (t) => [t]);
  const afterTabsIdx = indexCollection(afterTabs, (t) => [t]);

  const items = computeDelta(beforeItems, afterItems);
  const connections = computeDelta(beforeConns, afterConns);
  const annotations = computeDelta(beforeAnns, afterAnns);

  // Items present in both states with identical content but a different owning
  // tab are invisible to computeDelta — record them as moves. Ids already in
  // the content delta (changed value AND tab) stay in the delta only.
  const moves: ItemMove[] = [];
  for (const [id, entry] of beforeItems) {
    const next = afterItems.get(id);
    if (next && next.tabId !== entry.tabId && isEqual(entry.value, next.value)) {
      moves.push({ id, fromTabId: entry.tabId, toTabId: next.tabId });
    }
  }

  return {
    items: items.delta,
    connections: connections.delta,
    annotations: annotations.delta,
    tabs: computeTabDelta(beforeTabsIdx, afterTabsIdx),
    tabOrder: {
      before: beforeTabs.map((t) => t.id),
      after: afterTabs.map((t) => t.id),
    },
    tabOf: {
      items: items.tabOf,
      connections: connections.tabOf,
      annotations: annotations.tabOf,
    },
    moves,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Applying a patch on top of the CURRENT state
// ─────────────────────────────────────────────────────────────────────────────

type CollectionName = 'items' | 'connections' | 'annotations';

function getCollectionValues(
  tab: BoardTab,
  collection: CollectionName
): (BoardItem | Connection | BoardAnnotation)[] {
  if (collection === 'items') return tab.items || [];
  if (collection === 'connections') return tab.connections || [];
  return tab.annotations || [];
}

function setCollectionValues(tab: BoardTab, collection: CollectionName, values: unknown[]): BoardTab {
  if (collection === 'items') return { ...tab, items: values as BoardItem[] };
  if (collection === 'connections') return { ...tab, connections: values as Connection[] };
  return { ...tab, annotations: values as BoardAnnotation[] };
}

/**
 * Reconcile one collection's delta against the current state. Undo restores
 * the `before` map; redo restores the `after` map. Rules (undo):
 *  - id modified by us and still matching `after[id]` → replaced with `before[id]`.
 *  - id modified by us but changed since (remote edit) → skipped (never clobber).
 *  - id we deleted (in `before` only) and absent → re-inserted from `before`.
 *  - id we added (in `after` only) → deleted from current.
 *  - ids in neither map → untouched (remote-only content is never touched).
 * Redo mirrors this against the `after` map.
 */
function applyCollectionDelta<T extends { id: string }>(
  currentTabs: BoardTab[],
  delta: DeltaEntry<T>,
  tabOf: Record<string, string>,
  dir: 'undo' | 'redo',
  collection: CollectionName,
  skipped: string[]
): BoardTab[] {
  if (Object.keys(delta.before).length === 0 && Object.keys(delta.after).length === 0) {
    return currentTabs;
  }

  const restoreMap = dir === 'undo' ? delta.before : delta.after;
  const expectedMap = dir === 'undo' ? delta.after : delta.before;
  // Ids this mutation removed (added by the undo direction) get deleted from current.
  const deleteIds = new Set(Object.keys(expectedMap).filter((id) => !(id in restoreMap)));

  const currentMap = new Map<string, { tabIndex: number; value: T }>();
  currentTabs.forEach((tab, tabIndex) => {
    for (const value of getCollectionValues(tab, collection) as unknown as T[]) {
      currentMap.set(value.id, { tabIndex, value });
    }
  });

  type Mutation =
    | { kind: 'replace'; id: string; value: T; tabIndex: number }
    | { kind: 'delete'; id: string; tabIndex: number }
    | { kind: 'insert'; id: string; value: T; tabId: string };
  const mutations: Mutation[] = [];

  for (const id of Object.keys(restoreMap)) {
    const expected = expectedMap[id];
    const current = currentMap.get(id);
    if (current) {
      if (expected === undefined) continue; // re-applying an add that is still present — no-op
      if (!isEqual(current.value, expected)) {
        // Someone (possibly us, later) changed it since the snapshot — never clobber.
        skipped.push(id);
        continue;
      }
      if (isEqual(current.value, restoreMap[id])) continue; // already in target state
      mutations.push({ kind: 'replace', id, value: restoreMap[id], tabIndex: current.tabIndex });
    } else if (expected === undefined) {
      // Deleted by this mutation — undo/redo re-creates it from our own snapshot.
      mutations.push({ kind: 'insert', id, value: restoreMap[id], tabId: tabOf[id] });
    }
    // else: modified by us, then removed remotely — skip silently, don't resurrect.
  }

  for (const id of deleteIds) {
    const current = currentMap.get(id);
    if (current) mutations.push({ kind: 'delete', id, tabIndex: current.tabIndex });
  }

  if (mutations.length === 0) return currentTabs;

  const newTabs = currentTabs.slice();
  for (const m of mutations) {
    if (m.kind === 'insert') {
      const tabIndex = newTabs.findIndex((t) => t.id === m.tabId);
      // Owning tab gone (deleted in the same entry): the tab restore brings the
      // full tab — and its contents — back, so the per-id insert is skipped.
      if (tabIndex === -1) continue;
      const values = getCollectionValues(newTabs[tabIndex], collection);
      newTabs[tabIndex] = setCollectionValues(newTabs[tabIndex], collection, [
        ...values,
        m.value as unknown as BoardItem | Connection | BoardAnnotation,
      ]);
    } else {
      const tab = newTabs[m.tabIndex];
      const values = getCollectionValues(tab, collection);
      if (m.kind === 'replace') {
        // Replace in place so array order (and therefore tab/item order) is preserved.
        const index = values.findIndex((v) => v.id === m.id);
        const next = values.slice();
        next[index === -1 ? next.length : index] = m.value as unknown as BoardItem | Connection | BoardAnnotation;
        newTabs[m.tabIndex] = setCollectionValues(tab, collection, next);
      } else {
        newTabs[m.tabIndex] = setCollectionValues(
          tab,
          collection,
          values.filter((v) => v.id !== m.id)
        );
      }
    }
  }
  return newTabs;
}

/**
 * Tab-level reconcile: rename/recolor restore only name/color (never item
 * content); deleted tabs are restored wholesale with their position fixed by
 * the reorder pass; reorder restores the target id order with remote-added
 * tabs keeping their relative position, appended after known ids.
 */
function applyTabDelta(currentTabs: BoardTab[], patch: HistoryPatch, dir: 'undo' | 'redo', skipped: string[]): BoardTab[] {
  const delta = patch.tabs;
  const restoreMap = dir === 'undo' ? delta.before : delta.after;
  const expectedMap = dir === 'undo' ? delta.after : delta.before;
  const targetOrder = dir === 'undo' ? patch.tabOrder.before : patch.tabOrder.after;
  const deleteIds = new Set(Object.keys(expectedMap).filter((id) => !(id in restoreMap)));

  const currentById = new Map(currentTabs.map((t) => [t.id, t]));
  const newTabs: BoardTab[] = currentTabs.slice();
  let changed = false;

  for (const id of Object.keys(restoreMap)) {
    const expected = expectedMap[id];
    const current = currentById.get(id);
    if (current) {
      if (expected === undefined) continue; // re-applying an add that is still present — no-op
      if (!shallowTabEqual(current, expected)) {
        skipped.push(id);
        continue;
      }
      const target = restoreMap[id];
      if (current.name === target.name && current.color === target.color) continue;
      const index = newTabs.findIndex((t) => t.id === id);
      newTabs[index] = { ...current, name: target.name, color: target.color };
      changed = true;
    } else if (expected === undefined) {
      // Deleted by this mutation — restore the full tab; position is fixed below.
      newTabs.push(restoreMap[id]);
      changed = true;
    }
  }

  for (const id of deleteIds) {
    const index = newTabs.findIndex((t) => t.id === id);
    if (index !== -1) {
      newTabs.splice(index, 1);
      changed = true;
    }
  }

  if (targetOrder.length > 0) {
    const orderSet = new Set(targetOrder);
    const known: BoardTab[] = [];
    const unknown: BoardTab[] = [];
    for (const tab of newTabs) {
      if (orderSet.has(tab.id)) known.push(tab);
      else unknown.push(tab);
    }
    const byId = new Map(known.map((t) => [t.id, t]));
    const ordered = targetOrder
      .map((id) => byId.get(id))
      .filter((t): t is BoardTab => t !== undefined);
    const reordered = [...ordered, ...unknown];
    if (reordered.length !== newTabs.length || reordered.some((t, i) => t !== newTabs[i])) {
      newTabs.length = 0;
      newTabs.push(...reordered);
      changed = true;
    }
  }

  return changed ? newTabs : currentTabs;
}

/**
 * Reconcile item tab moves against the current state. Undo moves the item back
 * to `fromTabId`; redo moves it to `toTabId`. Rules:
 *  - item still in the expected tab → moved to the destination tab (appended).
 *  - item already elsewhere (someone else moved it) → silent no-op, never
 *    clobber another client's move.
 *  - item gone (deleted remotely) → silent no-op, never resurrect.
 *  - expected or destination tab gone remotely → skipped (with notice) — the
 *    tab delta restores tabs deleted by this very entry.
 * Content is never touched — only membership.
 */
function applyItemMoves(
  currentTabs: BoardTab[],
  patch: HistoryPatch,
  dir: 'undo' | 'redo',
  skipped: string[]
): BoardTab[] {
  const moves = patch.moves ?? [];
  if (moves.length === 0) return currentTabs;

  const currentById = new Map(currentTabs.map((t) => [t.id, t]));
  let work: BoardTab[] | null = null;

  for (const move of moves) {
    const expectedTabId = dir === 'undo' ? move.toTabId : move.fromTabId;
    const destTabId = dir === 'undo' ? move.fromTabId : move.toTabId;
    if (!currentById.has(expectedTabId) || !currentById.has(destTabId)) {
      skipped.push(move.id);
      continue;
    }
    const srcItems = work
      ? work.find((t) => t.id === expectedTabId)!.items
      : currentById.get(expectedTabId)!.items || [];
    const index = srcItems.findIndex((i) => i.id === move.id);
    if (index === -1) continue;
    if (!work) {
      work = currentTabs.map((t) => ({ ...t, items: [...(t.items || [])] }));
    }
    const src = work.find((t) => t.id === expectedTabId)!;
    const dst = work.find((t) => t.id === destTabId)!;
    const [item] = src.items.splice(index, 1);
    dst.items.push(item);
  }

  return work ?? currentTabs;
}

/**
 * Apply a patch on top of the current state. Returns the reconciled tabs (the
 * SAME reference when nothing changed) plus the ids that were skipped because
 * the board moved on (for the "N step skipped" notice).
 */
export function applyPatch(
  currentTabs: BoardTab[],
  patch: HistoryPatch,
  dir: 'undo' | 'redo'
): { tabs: BoardTab[]; skipped: string[] } {
  const skipped: string[] = [];
  let tabs = currentTabs;
  tabs = applyCollectionDelta(tabs, patch.items, patch.tabOf.items, dir, 'items', skipped);
  tabs = applyCollectionDelta(tabs, patch.connections, patch.tabOf.connections, dir, 'connections', skipped);
  tabs = applyCollectionDelta(tabs, patch.annotations, patch.tabOf.annotations, dir, 'annotations', skipped);
  tabs = applyItemMoves(tabs, patch, dir, skipped);
  tabs = applyTabDelta(tabs, patch, dir, skipped);
  return { tabs, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence (localStorage, user-scoped)
// ─────────────────────────────────────────────────────────────────────────────

export function historyKeyFor(userId: string, boardId: string, dir: 'undo' | 'redo'): string {
  return `dnd_${dir}_${userId}_${boardId}`;
}

/**
 * Serialize with size caps: entries whose own serialized size exceeds the
 * per-entry cap are dropped; remaining entries are kept newest-first until the
 * per-key cap is reached (oldest dropped first).
 */
export function serializeHistory(entries: UndoEntry[]): string {
  const measured = entries.map((entry) => ({ entry, json: JSON.stringify(entry) }));
  const kept: UndoEntry[] = [];
  let total = 0;
  for (let i = measured.length - 1; i >= 0; i--) {
    const { entry, json } = measured[i];
    if (json.length > HISTORY_MAX_ENTRY_BYTES) continue;
    if (total + json.length > HISTORY_MAX_BYTES) break;
    kept.push(entry);
    total += json.length;
  }
  kept.reverse();
  return JSON.stringify({ v: STORAGE_VERSION, entries: kept });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isIdRecord(value: unknown): value is Record<string, { id: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const val of Object.values(value as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') return false;
    if (typeof (val as { id?: unknown }).id !== 'string') return false;
  }
  return true;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string');
}

function isDeltaEntry(value: unknown): value is DeltaEntry<{ id: string }> {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return isIdRecord(v.before) && isIdRecord(v.after);
}

function isItemMove(value: unknown): value is ItemMove {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.fromTabId === 'string' &&
    typeof v.toTabId === 'string'
  );
}

function isHistoryPatch(value: unknown): value is HistoryPatch {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const tabOrder = v.tabOrder as Record<string, unknown> | undefined;
  const tabOf = v.tabOf as Record<string, unknown> | undefined;
  return (
    isDeltaEntry(v.items) &&
    isDeltaEntry(v.connections) &&
    isDeltaEntry(v.annotations) &&
    isDeltaEntry(v.tabs) &&
    !!tabOrder &&
    isStringArray(tabOrder.before) &&
    isStringArray(tabOrder.after) &&
    !!tabOf &&
    isStringRecord(tabOf.items) &&
    isStringRecord(tabOf.connections) &&
    isStringRecord(tabOf.annotations) &&
    // `moves` is optional for backward compatibility with entries persisted
    // before Feature 04 (a missing field validates as an empty list).
    (v.moves === undefined || (Array.isArray(v.moves) && v.moves.every(isItemMove)))
  );
}

function isUndoEntry(value: unknown): value is UndoEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.key === 'string' &&
    typeof v.time === 'number' &&
    typeof v.activeTabIdBefore === 'string' &&
    typeof v.activeTabIdAfter === 'string' &&
    isHistoryPatch(v.patch)
  );
}

/**
 * Parse a persisted payload; discards anything not matching the current
 * version/shape. Entries persisted before Feature 04 (no `moves` field) are
 * normalized to `moves: []` so consumers can rely on the field.
 */
export function deserializeHistory(raw: string): UndoEntry[] {
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; entries?: unknown };
    if (!parsed || typeof parsed !== 'object' || parsed.v !== STORAGE_VERSION || !Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries
      .filter(isUndoEntry)
      .map(entry => ({
        ...entry,
        patch: {
          ...entry.patch,
          moves: entry.patch.moves ?? [],
        },
      }));
  } catch {
    return [];
  }
}

export function loadHistory(key: string): UndoEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return deserializeHistory(raw);
  } catch {
    return [];
  }
}

export function saveHistory(key: string, entries: UndoEntry[]): void {
  try {
    localStorage.setItem(key, serializeHistory(entries));
  } catch {
    // Storage unavailable (private mode, quota) — history stays in-memory only.
  }
}

/** Remove every undo/redo key for a board (board ids are `[a-z0-9-]` slugs, so the suffix match is exact). */
export function clearHistoryForBoard(boardId: string): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith('dnd_undo_') || key.startsWith('dnd_redo_')) {
        if (key.endsWith('_' + boardId)) toRemove.push(key);
      }
    }
    for (const key of toRemove) localStorage.removeItem(key);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

/** Remove every undo/redo key for a user (user ids are uuids — cannot appear as a substring of another id). */
export function clearHistoryForUser(userId: string): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith('dnd_undo_') || key.startsWith('dnd_redo_')) {
        if (key.includes('_' + userId + '_')) toRemove.push(key);
      }
    }
    for (const key of toRemove) localStorage.removeItem(key);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
