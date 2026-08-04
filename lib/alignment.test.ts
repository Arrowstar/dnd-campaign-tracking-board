import { describe, it, expect } from 'vitest';
import { alignItemPositions, AlignMode } from './alignment';
import { BoardItem } from './types';

function makeItem(id: string, x: number, y: number, width = 100, height = 50): BoardItem {
  return {
    id, type: 'note', x, y, width, height,
    title: id, content: '', date: '', color: '#000', tags: [], visibility: 'all',
    ownerId: 'u', comments: [],
  };
}

// Three different-sized items whose bounding box is x ∈ [100, 420] at y=100..200
// and y ∈ [100, 320] at x=100..300.
const fixture: BoardItem[] = [
  makeItem('a', 100, 100, 200, 100), // left-top, 200x100
  makeItem('b', 300, 180, 120, 140), // right-mid, 120x140
  makeItem('c', 120, 240, 300, 80),  // bottom, 300x80
];

describe('alignItemPositions', () => {
  it('returns an empty map for an empty selection', () => {
    expect(alignItemPositions([], 'left')).toEqual({});
  });

  it('left: collapses every left edge to the leftmost x', () => {
    const r = alignItemPositions(fixture, 'left');
    expect(r.a.x).toBe(100);
    expect(r.b.x).toBe(100);
    expect(r.c.x).toBe(100);
    expect(r.a.y).toBe(100);
    expect(r.b.y).toBe(180);
    expect(r.c.y).toBe(240);
  });

  it('right: collapses every right edge (x + width) to the max right edge', () => {
    const r = alignItemPositions(fixture, 'right');
    // maxR = 420 (item a: 100 + 200)
    expect(r.a.x).toBe(420 - 200);
    expect(r.b.x).toBe(420 - 120);
    expect(r.c.x).toBe(420 - 300);
  });

  it('center-x: centers every item on the selection midline', () => {
    const r = alignItemPositions(fixture, 'center-x');
    // midline = (100 + 420) / 2 = 260
    expect(r.a.x).toBe(260 - 200 / 2);
    expect(r.b.x).toBe(260 - 120 / 2);
    expect(r.c.x).toBe(260 - 300 / 2);
  });

  it('top: collapses every top edge to the min y', () => {
    const r = alignItemPositions(fixture, 'top');
    expect(r.a.y).toBe(100);
    expect(r.b.y).toBe(100);
    expect(r.c.y).toBe(100);
  });

  it('bottom: collapses every bottom edge (y + height) to the max bottom', () => {
    const r = alignItemPositions(fixture, 'bottom');
    // maxB = 320 (item b: 180 + 140)
    expect(r.a.y).toBe(320 - 100);
    expect(r.b.y).toBe(320 - 140);
    expect(r.c.y).toBe(320 - 80);
  });

  it('middle-y: centers every item on the selection midline', () => {
    const r = alignItemPositions(fixture, 'middle-y');
    // midline = (100 + 320) / 2 = 210
    expect(r.a.y).toBe(210 - 100 / 2);
    expect(r.b.y).toBe(210 - 140 / 2);
    expect(r.c.y).toBe(210 - 80 / 2);
  });

  it('single item is a no-op (its own bounding box)', () => {
    const solo = [makeItem('s', 55, 66, 120, 90)];
    for (const mode of ['left', 'center-x', 'right', 'top', 'middle-y', 'bottom'] as AlignMode[]) {
      const r = alignItemPositions(solo, mode);
      expect(r.s).toEqual({ x: 55, y: 66 });
    }
  });

  it('rounds results to integers', () => {
    const odd = [
      makeItem('a', 101, 100, 200, 100),
      makeItem('b', 300, 180, 120, 140),
    ];
    const r = alignItemPositions(odd, 'center-x');
    expect(Number.isInteger(r.a.x)).toBe(true);
    expect(Number.isInteger(r.b.x)).toBe(true);
  });

  it('falls back to DEFAULT_ITEM_HEIGHT when height is missing', () => {
    const noH = [makeItem('n', 0, 0, 100, 0)];
    delete noH[0].height;
    const r = alignItemPositions(noH, 'bottom');
    expect(r.n.y).toBe(200 - 200);
  });

  it('leaves the perpendicular coordinate untouched per mode', () => {
    const rL = alignItemPositions(fixture, 'left');
    expect(rL.b.y).toBe(180);
    const rT = alignItemPositions(fixture, 'top');
    expect(rT.b.x).toBe(300);
  });
});