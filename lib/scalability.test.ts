import { describe, it, expect } from 'vitest';
import {
  applyItemOpsToTabs,
  buildJsonbSetChain,
  buildSaveOps,
  buildUpsertRows,
  diffBoardItems,
  ItemSaveOp,
} from './scalability';
import { HistoryPatch } from './undoHistory';
import { BoardItem, BoardTab } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

let idCounter = 0;
function makeTab(overrides: Partial<BoardTab> = {}): BoardTab {
  idCounter += 1;
  return {
    id: `tab-${idCounter}`,
    name: `Tab ${idCounter}`,
    color: '#3B82F6',
    items: [],
    connections: [],
    annotations: [],
    ...overrides,
  };
}

function makeItem(id: string, overrides: Partial<BoardItem> = {}): BoardItem {
  return {
    id,
    type: 'npc',
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    title: id,
    content: '',
    date: '',
    color: '#000',
    tags: [],
    visibility: 'all',
    ownerId: 'u-owner',
    ownerName: 'Owner',
    comments: [],
    ...overrides,
  };
}

function emptyDelta() {
  return { before: {}, after: {} };
}

function makePatch(overrides: Partial<HistoryPatch> = {}): HistoryPatch {
  return {
    items: emptyDelta(),
    connections: emptyDelta(),
    annotations: emptyDelta(),
    tabs: emptyDelta(),
    tabOrder: { before: ['tab-1'], after: ['tab-1'] },
    tabOf: { items: {}, connections: {}, annotations: {} },
    moves: [],
    ...overrides,
  };
}

// ─── diffBoardItems ──────────────────────────────────────────────────────────

describe('diffBoardItems', () => {
  const a = makeItem('a');
  const b = makeItem('b');
  const stored = [makeTab({ id: 't1', items: [a, b] })];

  it('reports no changes for identical states', () => {
    const { upserts, deletes } = diffBoardItems(stored, stored);
    expect(upserts).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it('upserts added and changed items, deletes removed ids', () => {
    const changedB = { ...b, title: 'B2' };
    const c = makeItem('c');
    const merged = [makeTab({ id: 't1', items: [changedB, c] })];

    const { upserts, deletes } = diffBoardItems(stored, merged);
    expect(upserts.map((u) => u.id).sort()).toEqual(['b', 'c']);
    expect(upserts.find((u) => u.id === 'b')?.item).toBe(changedB);
    expect(upserts.find((u) => u.id === 'c')?.tabId).toBe('t1');
    expect(deletes).toEqual(['a']);
  });

  it('upserts an item moved between tabs', () => {
    const moved = [makeTab({ id: 't1', items: [] }), makeTab({ id: 't2', items: [b] })];
    const { upserts, deletes } = diffBoardItems(stored, moved);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].id).toBe('b');
    expect(upserts[0].tabId).toBe('t2');
    expect(deletes).toEqual(['a']);
  });
});

// ─── buildUpsertRows ─────────────────────────────────────────────────────────

describe('buildUpsertRows', () => {
  it('produces id/board/tab/payload tuples', () => {
    const item = makeItem('a');
    const rows = buildUpsertRows([{ id: 'a', tabId: 't1', item }], 'board-1');
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe('a');
    expect(rows[0][1]).toBe('board-1');
    expect(rows[0][2]).toBe('t1');
    expect(rows[0][3]).toBe(JSON.stringify(item));
  });
});

// ─── buildSaveOps ────────────────────────────────────────────────────────────

describe('buildSaveOps', () => {
  it('returns ops for a pure item upsert', () => {
    const item = makeItem('a');
    const patch = makePatch({
      items: { before: {}, after: { a: item } },
      tabOf: { items: { a: 't1' }, connections: {}, annotations: {} },
    });
    const ops = buildSaveOps(patch);
    expect(ops).toEqual([{ type: 'upsert', tabId: 't1', item }]);
  });

  it('returns null when connections changed', () => {
    const patch = makePatch({
      items: { before: {}, after: { a: makeItem('a') } },
      connections: { before: {}, after: { c1: { id: 'c1', fromId: 'a', toId: 'b', label: '', color: '#000', style: 'solid' } } },
    });
    expect(buildSaveOps(patch)).toBeNull();
  });

  it('returns null when annotations changed', () => {
    const patch = makePatch({
      items: { before: {}, after: { a: makeItem('a') } },
      annotations: { before: {}, after: { n1: { id: 'n1', type: 'line', x: 0, y: 0 } } },
    });
    expect(buildSaveOps(patch)).toBeNull();
  });

  it('returns null when tabs changed (rename/recolor/order/identity)', () => {
    const patch = makePatch({
      items: { before: {}, after: { a: makeItem('a') } },
      tabs: { before: { 'tab-1': makeTab({ id: 'tab-1' }) }, after: {} },
    });
    expect(buildSaveOps(patch)).toBeNull();
  });

  it('returns null when the tab order changed', () => {
    const patch = makePatch({
      items: { before: {}, after: { a: makeItem('a') } },
      tabOrder: { before: ['t1', 't2'], after: ['t2', 't1'] },
    });
    expect(buildSaveOps(patch)).toBeNull();
  });

  it('returns null when an item was deleted', () => {
    const item = makeItem('a');
    const patch = makePatch({ items: { before: { a: item }, after: {} } });
    expect(buildSaveOps(patch)).toBeNull();
  });

  it('returns null when a changed item was renamed (link-title sync needs the full path)', () => {
    const patch = makePatch({
      items: { before: { a: makeItem('a', { title: 'Old' }) }, after: { a: makeItem('a', { title: 'New' }) } },
    });
    expect(buildSaveOps(patch)).toBeNull();
  });

  it('allows a non-title content change on an existing item', () => {
    const before = makeItem('a', { title: 'Same' });
    const after = makeItem('a', { title: 'Same', content: '<p>edited</p>' });
    const patch = makePatch({
      items: { before: { a: before }, after: { a: after } },
      tabOf: { items: { a: 't1' }, connections: {}, annotations: {} },
    });
    const ops = buildSaveOps(patch);
    expect(ops).toHaveLength(1);
    expect(ops![0].item).toBe(after);
  });
});

// ─── applyItemOpsToTabs ──────────────────────────────────────────────────────

describe('applyItemOpsToTabs', () => {
  it('replaces existing items in place and appends new ones', () => {
    const a = makeItem('a');
    const b = makeItem('b');
    const tabs = [makeTab({ id: 't1', items: [a, b] })];
    const updatedA = { ...a, title: 'A2' };
    const c = makeItem('c');
    const ops: ItemSaveOp[] = [
      { type: 'upsert', tabId: 't1', item: updatedA },
      { type: 'upsert', tabId: 't1', item: c },
    ];
    const result = applyItemOpsToTabs(tabs, ops);
    expect(result[0].items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(result[0].items[0]).toBe(updatedA);
  });

  it('ignores ops targeting a tab that does not exist', () => {
    const tabs = [makeTab({ id: 't1', items: [] })];
    const result = applyItemOpsToTabs(tabs, [{ type: 'upsert', tabId: 'ghost', item: makeItem('x') }]);
    expect(result).toEqual(tabs);
  });
});

// ─── buildJsonbSetChain ──────────────────────────────────────────────────────

describe('buildJsonbSetChain', () => {
  it('targets stored indices for replacements and appends for new ids', () => {
    const a = makeItem('a');
    const b = makeItem('b');
    const stored = [makeTab({ id: 't1', items: [a, b] })];
    const updatedA = { ...a, title: 'A2' };
    const c = makeItem('c');
    const final = [makeTab({ id: 't1', items: [updatedA, b, c] })];
    const ops: ItemSaveOp[] = [
      { type: 'upsert', tabId: 't1', item: updatedA },
      { type: 'upsert', tabId: 't1', item: c },
    ];
    const chain = buildJsonbSetChain(stored, final, ops);
    expect(chain).toHaveLength(2);
    expect(chain[0].path).toEqual(['0', 'items', '0']);
    expect(chain[0].item).toBe(updatedA);
    // First append lands at the stored length...
    expect(chain[1].path).toEqual(['0', 'items', '2']);
    expect(chain[1].item).toBe(c);
  });

  it('handles multiple appends to the same tab sequentially', () => {
    const stored = [makeTab({ id: 't1', items: [makeItem('a')] })];
    const c = makeItem('c');
    const d = makeItem('d');
    const final = [makeTab({ id: 't1', items: [makeItem('a'), c, d] })];
    const ops: ItemSaveOp[] = [
      { type: 'upsert', tabId: 't1', item: c },
      { type: 'upsert', tabId: 't1', item: d },
    ];
    const chain = buildJsonbSetChain(stored, final, ops);
    expect(chain.map((x) => x.path)).toEqual([['0', 'items', '1'], ['0', 'items', '2']]);
  });

  it('skips ops for tabs absent from the stored state', () => {
    const stored = [makeTab({ id: 't1', items: [] })];
    const chain = buildJsonbSetChain(stored, stored, [
      { type: 'upsert', tabId: 'ghost', item: makeItem('x') },
    ]);
    expect(chain).toEqual([]);
  });
});
