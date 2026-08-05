import { describe, it, expect } from 'vitest';
import { moveItemsToTab, countConnectionsToDrop } from './tabMove';
import { BoardAnnotation, BoardTab, BoardItem, Connection } from './types';

function makeItem(id: string, x = 0, y = 0): BoardItem {
  return {
    id, type: 'note', x, y, width: 100, height: 50,
    title: id, content: '', date: '', color: '#000', tags: [], visibility: 'all',
    ownerId: 'u', comments: [],
  };
}

function makeConn(id: string, fromId: string, toId: string): Connection {
  return { id, fromId, toId, label: '', color: '#000', style: 'solid' };
}

function makeTab(id: string, items: BoardItem[], conns: Connection[] = [], annotations?: BoardAnnotation[]): BoardTab {
  return { id, name: id, color: '#3B82F6', items, connections: conns, annotations };
}

const a = makeItem('a', 10, 10);
const b = makeItem('b', 20, 20);
const c = makeItem('c', 30, 30);

describe('moveItemsToTab', () => {
  it('moves items to the target tab preserving x/y and tab identity', () => {
    const tabs = [makeTab('t1', [a, b, c]), makeTab('t2', [])];
    const { tabs: next, droppedConnections } = moveItemsToTab(tabs, new Set(['a', 'c']), 't2');
    expect(next[0].items.map(i => i.id)).toEqual(['b']);
    expect(next[1].items.map(i => i.id)).toEqual(['a', 'c']);
    expect(next[1].items[0]).toBe(a); // same object — x/y untouched
    expect(next[1].items[0].x).toBe(10);
    expect(next[1].items[1].x).toBe(30);
    expect(droppedConnections).toBe(0);
  });

  it('deletes and counts connections touching either endpoint of moved items', () => {
    const tabs = [
      makeTab('t1', [a, b, c], [
        makeConn('ab', 'a', 'b'),
        makeConn('bc', 'b', 'c'),
        makeConn('bb', 'b', 'b'),
        makeConn('xy', 'x', 'y'),
      ]),
      makeTab('t2', []),
    ];
    const { tabs: next, droppedConnections } = moveItemsToTab(tabs, new Set(['a', 'c']), 't2');
    expect(droppedConnections).toBe(2); // ab, bc — bb stays (b not moved), xy unrelated
    expect(next[0].connections.map(conn => conn.id)).toEqual(['bb', 'xy']);
    // b's own outgoing edge to c is dropped too (c moved)
    expect(next[1].connections).toEqual([]);
  });

  it('appends to the target tab after its existing items', () => {
    const existing = makeItem('existing');
    const tabs = [makeTab('t1', [a]), makeTab('t2', [existing])];
    const { tabs: next } = moveItemsToTab(tabs, new Set(['a']), 't2');
    expect(next[1].items.map(i => i.id)).toEqual(['existing', 'a']);
  });

  it('no-ops when the target tab is missing', () => {
    const tabs = [makeTab('t1', [a])];
    const { tabs: next, droppedConnections } = moveItemsToTab(tabs, new Set(['a']), 'nope');
    expect(next).toBe(tabs);
    expect(droppedConnections).toBe(0);
  });

  it('no-ops on an empty id set', () => {
    const tabs = [makeTab('t1', [a])];
    const { tabs: next } = moveItemsToTab(tabs, new Set(), 't1');
    expect(next).toBe(tabs);
  });

  it('preserves annotations and other tab fields on both source and target', () => {
    const ann = { id: 'ann1' } as unknown as BoardAnnotation;
    const tabs = [makeTab('t1', [a, b], [], [ann]), makeTab('t2', [])];
    const { tabs: next } = moveItemsToTab(tabs, new Set(['a']), 't2');
    expect(next[0].annotations).toEqual([ann]);
    expect(next[0].name).toBe('t1');
    expect(next[0].color).toBe('#3B82F6');
    expect(next[1].name).toBe('t2');
  });

  it('moves the last item leaving an empty (valid) source tab', () => {
    const tabs = [makeTab('t1', [a]), makeTab('t2', [])];
    const { tabs: next } = moveItemsToTab(tabs, new Set(['a']), 't2');
    expect(next[0].items).toEqual([]);
    expect(next[1].items.map(i => i.id)).toEqual(['a']);
  });
});

describe('countConnectionsToDrop', () => {
  it('counts connections touching the given ids without mutating', () => {
    const tabs = [makeTab('t1', [a, b], [
      makeConn('ab', 'a', 'b'),
      makeConn('bc', 'b', 'c'),
      makeConn('xy', 'x', 'y'),
    ])];
    expect(countConnectionsToDrop(tabs, new Set(['a', 'c']))).toBe(2);
    expect(countConnectionsToDrop(tabs, new Set(['x']))).toBe(1);
    expect(countConnectionsToDrop(tabs, new Set())).toBe(0);
    expect(tabs[0].connections.length).toBe(3);
  });
});
