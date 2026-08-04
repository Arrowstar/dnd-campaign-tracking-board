import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeDiff,
  applyPatch,
  serializeHistory,
  deserializeHistory,
  loadHistory,
  saveHistory,
  historyKeyFor,
  clearHistoryForBoard,
  clearHistoryForUser,
  HISTORY_MAX_BYTES,
  HISTORY_MAX_ENTRY_BYTES,
  UndoEntry,
  HistoryPatch,
} from './undoHistory';
import { BoardTab, BoardItem, Connection, BoardAnnotation } from './types';

// ─── Fixture builders ─────────────────────────────────────────────────────────

const makeItem = (id: string, title = 'Item ' + id, x = 0, content = ''): BoardItem => ({
  id,
  type: 'note',
  x,
  y: 0,
  width: 300,
  height: 200,
  title,
  content,
  date: '2026-01-01',
  color: '#FEF08A',
  tags: [],
  visibility: 'all',
  ownerId: 'u1',
  ownerName: 'U1',
  comments: [],
});

const makeConn = (id: string, fromId = 'a', toId = 'b'): Connection => ({
  id,
  fromId,
  toId,
  label: 'Connected',
  color: '#9CA3AF',
  style: 'solid',
  width: 3,
});

const makeAnn = (id: string, x = 10, text = 'hello'): BoardAnnotation => ({
  id,
  type: 'text',
  x,
  y: 10,
  text,
});

const makeTab = (
  id: string,
  name = 'Tab ' + id,
  items: BoardItem[] = [],
  connections: Connection[] = [],
  annotations: BoardAnnotation[] = []
): BoardTab => ({
  id,
  name,
  color: '#3B82F6',
  items,
  connections,
  annotations,
});

const EMPTY_PATCH = (): HistoryPatch => ({
  items: { before: {}, after: {} },
  connections: { before: {}, after: {} },
  annotations: { before: {}, after: {} },
  tabs: { before: {}, after: {} },
  tabOrder: { before: ['t1'], after: ['t1'] },
  tabOf: { items: {}, connections: {}, annotations: {} },
});

const makeEntry = (id: string, patch: HistoryPatch): UndoEntry => ({
  key: `k-${id}`,
  time: id.length,
  patch,
  activeTabIdBefore: 't1',
  activeTabIdAfter: 't1',
});

// ─── computeDiff ──────────────────────────────────────────────────────────────

describe('computeDiff', () => {
  it('produces an empty patch for identical states', () => {
    const tabs = [makeTab('t1', 'Main', [makeItem('a'), makeItem('b')], [makeConn('c1')], [makeAnn('n1')])];
    const patch = computeDiff(tabs, tabs);
    expect(patch).toEqual(EMPTY_PATCH());
  });

  it('captures a single edited item by id only', () => {
    const before = [makeTab('t1', 'Main', [makeItem('a', 'Old'), makeItem('b')])];
    const after = [makeTab('t1', 'Main', [makeItem('a', 'New'), makeItem('b')])];
    const patch = computeDiff(before, after);
    expect(Object.keys(patch.items.before)).toEqual(['a']);
    expect(Object.keys(patch.items.after)).toEqual(['a']);
    expect(patch.items.before.a.title).toBe('Old');
    expect(patch.items.after.a.title).toBe('New');
    expect(patch.items.before.b).toBeUndefined();
    expect(patch.tabOf.items.a).toBe('t1');
  });

  it('captures adds and deletes asymmetrically', () => {
    const before = [makeTab('t1', 'Main', [makeItem('a'), makeItem('b')])];
    const after = [makeTab('t1', 'Main', [makeItem('b'), makeItem('c')])];
    const patch = computeDiff(before, after);
    expect(patch.items.before).toEqual({ a: makeItem('a') });
    expect(patch.items.after).toEqual({ c: makeItem('c') });
    expect(patch.items.before.b).toBeUndefined();
    expect(patch.items.after.b).toBeUndefined();
  });

  it('captures connection and annotation changes', () => {
    const before = [makeTab('t1', 'Main', [], [makeConn('c1', 'a', 'b')], [makeAnn('n1', 1)])];
    const after = [makeTab('t1', 'Main', [], [makeConn('c1', 'a', 'c')], [makeAnn('n1', 50)])];
    const patch = computeDiff(before, after);
    expect(patch.connections.before.c1.toId).toBe('b');
    expect(patch.connections.after.c1.toId).toBe('c');
    expect(patch.annotations.before.n1.x).toBe(1);
    expect(patch.annotations.after.n1.x).toBe(50);
  });

  it('flattens items across tabs', () => {
    const before = [makeTab('t1', 'One', [makeItem('a')]), makeTab('t2', 'Two', [makeItem('b')])];
    const after = [makeTab('t1', 'One', [makeItem('a')]), makeTab('t2', 'Two', [makeItem('b', 'Renamed')])];
    const patch = computeDiff(before, after);
    expect(patch.items.before.b.title).toBe('Item b');
    expect(patch.tabOf.items.b).toBe('t2');
  });

  it('does not treat item content edits as tab changes (shallow tab diff)', () => {
    const before = [makeTab('t1', 'Main', [makeItem('a', 'Old')])];
    const after = [makeTab('t1', 'Main', [makeItem('a', 'New')])];
    const patch = computeDiff(before, after);
    expect(patch.tabs).toEqual({ before: {}, after: {} });
  });

  it('captures tab rename and recolor as tab deltas', () => {
    const before = [makeTab('t1', 'Old')];
    const after = [{ ...before[0], name: 'New', color: '#123456' }];
    const patch = computeDiff(before, after);
    expect(patch.tabs.before.t1.name).toBe('Old');
    expect(patch.tabs.after.t1.name).toBe('New');
  });

  it('captures tab add/delete and order changes in tabOrder', () => {
    const before = [makeTab('t1'), makeTab('t2')];
    const after = [makeTab('t2'), makeTab('t3')];
    const patch = computeDiff(before, after);
    expect(patch.tabs.before.t1).toBeDefined();
    expect(patch.tabs.after.t3).toBeDefined();
    expect(patch.tabOrder.before).toEqual(['t1', 't2']);
    expect(patch.tabOrder.after).toEqual(['t2', 't3']);
  });

  it('a reorder alone produces only a tabOrder change', () => {
    const before = [makeTab('t1'), makeTab('t2'), makeTab('t3')];
    const after = [makeTab('t3'), makeTab('t1'), makeTab('t2')];
    const patch = computeDiff(before, after);
    expect(patch.tabs).toEqual({ before: {}, after: {} });
    expect(patch.tabOrder.before).toEqual(['t1', 't2', 't3']);
    expect(patch.tabOrder.after).toEqual(['t3', 't1', 't2']);
  });
});

// ─── applyPatch ───────────────────────────────────────────────────────────────

describe('applyPatch undo', () => {
  it('cleanly reverts a local edit', () => {
    const before = [makeTab('t1', 'Main', [makeItem('a', 'Old'), makeItem('b')])];
    const after = [makeTab('t1', 'Main', [makeItem('a', 'New'), makeItem('b')])];
    const patch = computeDiff(before, after);
    const result = applyPatch(after, patch, 'undo');
    expect(result.skipped).toEqual([]);
    expect(result.tabs).toEqual(before);
  });

  it('reverts an add by deleting the id', () => {
    const before = [makeTab('t1', 'Main', [makeItem('a')])];
    const after = [makeTab('t1', 'Main', [makeItem('a'), makeItem('c')])];
    const patch = computeDiff(before, after);
    const result = applyPatch(after, patch, 'undo');
    expect(result.tabs[0].items.map((i) => i.id)).toEqual(['a']);
  });

  it('restores a deleted item (undo of my delete)', () => {
    const before = [makeTab('t1', 'Main', [makeItem('a'), makeItem('b')])];
    const after = [makeTab('t1', 'Main', [makeItem('b')])];
    const patch = computeDiff(before, after);
    const result = applyPatch(after, patch, 'undo');
    expect(result.skipped).toEqual([]);
    expect(result.tabs[0].items.map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect(result.tabs[0].items.find((i) => i.id === 'a')).toEqual(makeItem('a'));
  });

  it('skips an id a remote user edited since (never clobbers)', () => {
    const before = [makeTab('t1', 'Main', [makeItem('a', 'Old')])];
    const after = [makeTab('t1', 'Main', [makeItem('a', 'Mine')])];
    const patch = computeDiff(before, after);
    // Remote edit on top of my change.
    const remote = [makeTab('t1', 'Main', [makeItem('a', 'Remote')])];
    const result = applyPatch(remote, patch, 'undo');
    expect(result.skipped).toEqual(['a']);
    expect(result.tabs).toBe(remote); // untouched
    expect(result.tabs[0].items[0].title).toBe('Remote');
  });

  it('does not resurrect an id deleted remotely after my edit', () => {
    const before = [makeTab('t1', 'Main', [makeItem('a', 'Old')])];
    const after = [makeTab('t1', 'Main', [makeItem('a', 'Mine')])];
    const patch = computeDiff(before, after);
    const remoteDeleted = [makeTab('t1', 'Main', [])];
    const result = applyPatch(remoteDeleted, patch, 'undo');
    expect(result.skipped).toEqual([]); // silent skip, no toast-worthy conflict
    expect(result.tabs[0].items).toEqual([]);
  });

  it('leaves remote-only ids untouched', () => {
    const before = [makeTab('t1', 'Main', [makeItem('a', 'Old'), makeItem('b')])];
    const after = [makeTab('t1', 'Main', [makeItem('a', 'New'), makeItem('b')])];
    const patch = computeDiff(before, after);
    const current = [makeTab('t1', 'Main', [makeItem('a', 'New'), makeItem('b'), makeItem('remote')])];
    const result = applyPatch(current, patch, 'undo');
    expect(result.tabs[0].items.map((i) => i.id).sort()).toEqual(['a', 'b', 'remote']);
    expect(result.tabs[0].items.find((i) => i.id === 'remote')).toBeDefined();
  });

  it('restores connections that went away with a deleted item', () => {
    const before = [makeTab('t1', 'Main', [makeItem('a'), makeItem('b')], [makeConn('c1', 'a', 'b')])];
    const after = [makeTab('t1', 'Main', [makeItem('b')], [])];
    const patch = computeDiff(before, after);
    const result = applyPatch(after, patch, 'undo');
    expect(result.tabs[0].items.map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect(result.tabs[0].connections.map((c) => c.id)).toEqual(['c1']);
  });

  it('reverts an annotation edit', () => {
    const before = [makeTab('t1', 'Main', [], [], [makeAnn('n1', 1)])];
    const after = [makeTab('t1', 'Main', [], [], [makeAnn('n1', 100)])];
    const patch = computeDiff(before, after);
    const result = applyPatch(after, patch, 'undo');
    expect(result.tabs[0].annotations?.[0].x).toBe(1);
  });
});

describe('applyPatch redo', () => {
  it('mirrors undo symmetrically for an edit', () => {
    const before = [makeTab('t1', 'Main', [makeItem('a', 'Old')])];
    const after = [makeTab('t1', 'Main', [makeItem('a', 'New')])];
    const patch = computeDiff(before, after);
    const undone = applyPatch(after, patch, 'undo');
    const redone = applyPatch(undone.tabs, patch, 'redo');
    expect(redone.skipped).toEqual([]);
    expect(redone.tabs).toEqual(after);
  });

  it('re-applies a reverted add (redo of add)', () => {
    const before = [makeTab('t1', 'Main', [makeItem('a')])];
    const after = [makeTab('t1', 'Main', [makeItem('a'), makeItem('c')])];
    const patch = computeDiff(before, after);
    const undone = applyPatch(after, patch, 'undo');
    const redone = applyPatch(undone.tabs, patch, 'redo');
    expect(redone.tabs).toEqual(after);
  });

  it('re-deletes a restored item (redo of delete)', () => {
    const before = [makeTab('t1', 'Main', [makeItem('a'), makeItem('b')])];
    const after = [makeTab('t1', 'Main', [makeItem('b')])];
    const patch = computeDiff(before, after);
    const undone = applyPatch(after, patch, 'undo');
    const redone = applyPatch(undone.tabs, patch, 'redo');
    expect(redone.tabs[0].items.map((i) => i.id)).toEqual(['b']);
  });

  it('skips an id edited remotely in the redo direction too', () => {
    const before = [makeTab('t1', 'Main', [makeItem('a', 'Old')])];
    const after = [makeTab('t1', 'Main', [makeItem('a', 'New')])];
    const patch = computeDiff(before, after);
    const current = [makeTab('t1', 'Main', [makeItem('a', 'Remote')])];
    const result = applyPatch(current, patch, 'redo');
    expect(result.skipped).toEqual(['a']);
    expect(result.tabs[0].items[0].title).toBe('Remote');
  });
});

describe('applyPatch tabs', () => {
  it('undoes a tab rename without touching item content', () => {
    const before = [makeTab('t1', 'Old', [makeItem('a', 'Keep')])];
    const after = [{ ...before[0], name: 'New' }];
    const patch = computeDiff(before, after);
    const result = applyPatch(after, patch, 'undo');
    expect(result.tabs[0].name).toBe('Old');
    expect(result.tabs[0].items[0].title).toBe('Keep');
  });

  it('undoes a tab add (deletes the tab)', () => {
    const before = [makeTab('t1')];
    const after = [makeTab('t1'), makeTab('t2')];
    const patch = computeDiff(before, after);
    const result = applyPatch(after, patch, 'undo');
    expect(result.tabs.map((t) => t.id)).toEqual(['t1']);
  });

  it('undoes a tab delete (restores the full tab at its original position)', () => {
    const before = [makeTab('t1'), makeTab('t2'), makeTab('t3')];
    const after = [makeTab('t1'), makeTab('t3')];
    const patch = computeDiff(before, after);
    const result = applyPatch(after, patch, 'undo');
    expect(result.tabs.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    expect(result.tabs[1]).toEqual(before[1]);
  });

  it('undoes a tab reorder', () => {
    const before = [makeTab('t1'), makeTab('t2'), makeTab('t3')];
    const after = [makeTab('t3'), makeTab('t1'), makeTab('t2')];
    const patch = computeDiff(before, after);
    const result = applyPatch(after, patch, 'undo');
    expect(result.tabs.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('keeps remote-added tabs when reordering, appended after known ids', () => {
    const before = [makeTab('t1'), makeTab('t2')];
    const after = [makeTab('t2'), makeTab('t1')];
    const patch = computeDiff(before, after);
    const current = [makeTab('t2'), makeTab('t1'), makeTab('remote')];
    const result = applyPatch(current, patch, 'undo');
    expect(result.tabs.map((t) => t.id)).toEqual(['t1', 't2', 'remote']);
  });

  it('a tab + items deleted in one entry undo back to the full original state', () => {
    const before = [makeTab('t1'), makeTab('t2', 'Two', [makeItem('x', 'X')], [makeConn('c1', 'x', 'x')])];
    const after = [makeTab('t1')];
    const patch = computeDiff(before, after);
    const result = applyPatch(after, patch, 'undo');
    expect(result.tabs).toEqual(before);
  });
});

// ─── Coalescing merge ─────────────────────────────────────────────────────────

describe('coalesced entry merge', () => {
  it('recomputing the diff from the first before to the latest after merges keystrokes', () => {
    const t0 = [makeTab('t1', 'Main', [makeItem('a', '')])];
    const t1 = [makeTab('t1', 'Main', [makeItem('a', 'H')])];
    const t2 = [makeTab('t1', 'Main', [makeItem('a', 'He')])];
    const t3 = [makeTab('t1', 'Main', [makeItem('a', 'Hello')])];
    const merged = computeDiff(t0, t3);
    expect(merged.items.after.a.title).toBe('Hello');
    expect(merged.items.before.a.title).toBe('');
    const result = applyPatch(t3, merged, 'undo');
    expect(result.tabs).toEqual(t0);
  });

  it('a merged entry over a diverged intermediate state skips conservatively', () => {
    const t0 = [makeTab('t1', 'Main', [makeItem('a', '')])];
    const t1 = [makeTab('t1', 'Main', [makeItem('a', 'H')])];
    const t2 = [makeTab('t1', 'Main', [makeItem('a', 'He')])];
    // The intermediate state is NOT the accumulated "after" — applying the
    // merged patch onto it must not clobber (current value ≠ after[id]).
    const merged = computeDiff(t0, t2);
    const result = applyPatch(t1, merged, 'undo');
    expect(result.skipped).toEqual(['a']);
    expect(result.tabs).toBe(t1);
  });
});

// ─── Serialization / persistence ──────────────────────────────────────────────

describe('serializeHistory / deserializeHistory', () => {
  const tabs = [makeTab('t1', 'Main', [makeItem('a', 'Old')])];

  it('round-trips entries', () => {
    const entry = makeEntry('e1', computeDiff(tabs, [makeTab('t1', 'Main', [makeItem('a', 'New')])]));
    const out = deserializeHistory(serializeHistory([entry]));
    expect(out).toEqual([entry]);
  });

  it('returns [] for an empty list', () => {
    expect(deserializeHistory(serializeHistory([]))).toEqual([]);
  });

  it('discards a version-mismatched payload', () => {
    const entry = makeEntry('e1', computeDiff(tabs, tabs));
    const raw = JSON.stringify({ v: 999, entries: [entry] });
    expect(deserializeHistory(raw)).toEqual([]);
  });

  it('discards malformed entries but keeps valid ones', () => {
    const entry = makeEntry('e1', computeDiff(tabs, [makeTab('t1', 'Main', [makeItem('a', 'New')])]));
    const raw = JSON.stringify({ v: 1, entries: [{ key: 'bad', time: 1, patch: 'nope' }, entry] });
    const out = deserializeHistory(raw);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('k-e1');
  });

  it('drops an entry larger than the per-entry cap', () => {
    const huge = makeEntry(
      'huge',
      computeDiff(tabs, [makeTab('t1', 'Main', [makeItem('a', 'x'.repeat(HISTORY_MAX_ENTRY_BYTES))])])
    );
    const small = makeEntry('small', computeDiff(tabs, [makeTab('t1', 'Main', [makeItem('a', 'tiny')])]));
    const out = deserializeHistory(serializeHistory([small, huge]));
    expect(out.map((e) => e.key)).toEqual(['k-small']);
  });

  it('drops oldest entries first when the key cap is exceeded', () => {
    const big = (n: number) =>
      makeEntry(
        'big-' + n,
        computeDiff(tabs, [makeTab('t1', 'Main', [makeItem('a', 'y'.repeat(120 * 1024))])])
      );
    // 12 × ~120 KB ≈ 1.4 MB > 1 MB cap → newest kept, oldest dropped.
    const entries = Array.from({ length: 12 }, (_, i) => big(i));
    const out = deserializeHistory(serializeHistory(entries));
    expect(out.length).toBeLessThan(12);
    expect(out.length).toBeGreaterThan(0);
    expect(out[out.length - 1].key).toBe('k-big-11'); // newest retained
    expect(out[0].key).not.toBe('k-big-0'); // oldest dropped
  });
});

describe('localStorage helpers', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves and loads history under the user+board key', () => {
    const entry = makeEntry('e1', computeDiff([makeTab('t1')], [makeTab('t1'), makeTab('t2')]));
    const key = historyKeyFor('user-1', 'board-1', 'undo');
    saveHistory(key, [entry]);
    expect(loadHistory(key)).toEqual([entry]);
    expect(loadHistory(historyKeyFor('user-2', 'board-1', 'undo'))).toEqual([]);
  });

  it('returns [] when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadHistory('dnd_undo_u_b')).toEqual([]);
    expect(() => saveHistory('dnd_undo_u_b', [])).not.toThrow();
  });

  it('clears history for a board across users', () => {
    saveHistory(historyKeyFor('u1', 'board-1', 'undo'), [makeEntry('a', EMPTY_PATCH())]);
    saveHistory(historyKeyFor('u2', 'board-1', 'redo'), [makeEntry('b', EMPTY_PATCH())]);
    saveHistory(historyKeyFor('u1', 'board-2', 'undo'), [makeEntry('c', EMPTY_PATCH())]);
    clearHistoryForBoard('board-1');
    expect(loadHistory(historyKeyFor('u1', 'board-1', 'undo'))).toEqual([]);
    expect(loadHistory(historyKeyFor('u2', 'board-1', 'redo'))).toEqual([]);
    expect(loadHistory(historyKeyFor('u1', 'board-2', 'undo'))).toHaveLength(1);
  });

  it('clears history for a user across boards', () => {
    saveHistory(historyKeyFor('u1', 'board-1', 'undo'), [makeEntry('a', EMPTY_PATCH())]);
    saveHistory(historyKeyFor('u1', 'board-2', 'redo'), [makeEntry('b', EMPTY_PATCH())]);
    saveHistory(historyKeyFor('u2', 'board-1', 'undo'), [makeEntry('c', EMPTY_PATCH())]);
    clearHistoryForUser('u1');
    expect(loadHistory(historyKeyFor('u1', 'board-1', 'undo'))).toEqual([]);
    expect(loadHistory(historyKeyFor('u1', 'board-2', 'redo'))).toEqual([]);
    expect(loadHistory(historyKeyFor('u2', 'board-1', 'undo'))).toHaveLength(1);
  });

  it('does not clear unrelated dnd_ prefixed keys', () => {
    store.set('dnd_search:recents:u1:board-1', '[1]');
    clearHistoryForUser('u1');
    clearHistoryForBoard('board-1');
    expect(store.get('dnd_search:recents:u1:board-1')).toBe('[1]');
  });
});
