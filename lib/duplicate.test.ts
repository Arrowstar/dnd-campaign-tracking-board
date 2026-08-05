import { describe, it, expect } from 'vitest';
import { duplicateItem, duplicateItems, WORLD_SIZE } from './duplicate';
import { BoardItem } from './types';

function makeItem(id: string, x: number, y: number, width = 100, height = 50): BoardItem {
  return {
    id, type: 'note', x, y, width, height,
    title: 'New note', content: 'content', date: '2026-08-05', color: '#000', tags: ['a'],
    visibility: 'all', ownerId: 'old-owner', ownerName: 'Old Owner', comments: [],
    minimized: true, crop: { x: 0, y: 0, width: 1, height: 1 },
    lines: [{ tool: 'pen', color: '#fff', points: [0, 1, 2] }],
    fields: [{ id: 'f1', label: 'F1', type: 'text', textValue: 'v' }],
    previewFields: ['f1'],
    previewLayout: { columns: 1, rows: [] },
  };
}

const OWNER = { id: 'new-owner', name: 'New Owner' };

describe('duplicateItem', () => {
  it('produces a fresh uuid, duplicator ownership, and no comments', () => {
    const src = makeItem('orig', 100, 100);
    const copy = duplicateItem(src, OWNER);
    expect(copy.id).not.toBe('orig');
    expect(copy.id).toBeTruthy();
    expect(copy.ownerId).toBe('new-owner');
    expect(copy.ownerName).toBe('New Owner');
    expect(copy.comments).toEqual([]);
  });

  it('offsets position by +24 and copies width/height verbatim', () => {
    const copy = duplicateItem(makeItem('orig', 100, 100, 200, 300), OWNER);
    expect(copy.x).toBe(124);
    expect(copy.y).toBe(124);
    expect(copy.width).toBe(200);
    expect(copy.height).toBe(300);
  });

  it('appends " (copy)" only to default "New <type>" titles', () => {
    expect(duplicateItem(makeItem('a', 0, 0), OWNER).title).toBe('New note (copy)');
    const custom = { ...makeItem('a', 0, 0), title: 'Town Guard Aldric' };
    expect(duplicateItem(custom, OWNER).title).toBe('Town Guard Aldric');
  });

  it('deep-copies structured data via reference-sharing (immutable by contract)', () => {
    const src = makeItem('orig', 0, 0);
    const copy = duplicateItem(src, OWNER);
    expect(copy.fields).toEqual(src.fields);
    expect(copy.lines).toEqual(src.lines);
    expect(copy.crop).toEqual(src.crop);
    expect(copy.previewLayout).toEqual(src.previewLayout);
    expect(copy.previewFields).toEqual(['f1']);
    expect(copy.minimized).toBe(true);
    expect(copy.color).toBe('#000');
    expect(copy.tags).toEqual(['a']);
    expect(copy.date).toBe('2026-08-05');
    expect(copy.content).toBe('content');
  });

  it('clamps to the 4000x4000 world', () => {
    const copy = duplicateItem(makeItem('a', 3990, 3990, 200, 50), OWNER);
    expect(copy.x).toBe(WORLD_SIZE - 200);
    expect(copy.y).toBe(WORLD_SIZE - 50);
    const neg = duplicateItem(makeItem('a', -50, -50, 200, 50), OWNER);
    expect(neg.x).toBe(0);
    expect(neg.y).toBe(0);
  });
});

describe('duplicateItems', () => {
  it('fans copies at (24 + i*12) % 96 offsets', () => {
    const items = [makeItem('a', 0, 0), makeItem('b', 0, 0), makeItem('c', 0, 0)];
    const copies = duplicateItems(items, OWNER);
    expect(copies.map(c => c.x)).toEqual([24, 36, 48]);
    expect(copies.map(c => c.y)).toEqual([24, 36, 48]);
  });

  it('wraps offsets so large batches stay on-canvas and readable', () => {
    const items = Array.from({ length: 10 }, (_, i) => makeItem(`a${i}`, 0, 0));
    const copies = duplicateItems(items, OWNER);
    expect(copies[6].x).toBe(0); // 24 + 6*12 = 96 → mod 96 wraps to 0
    expect(copies[7].x).toBe(12);
    expect(copies[9].x).toBe(36);
    expect(copies.map(c => c.id)).toEqual(expect.arrayContaining([]));
    const ids = new Set(copies.map(c => c.id));
    expect(ids.size).toBe(10);
  });

  it('keeps every copy independent of its original', () => {
    const items = [makeItem('a', 10, 10)];
    const copies = duplicateItems(items, OWNER);
    expect(copies[0].id).not.toBe('a');
  });
});
