import { describe, it, expect } from 'vitest';
import { navigateToItem } from './viewNavigation';
import { BoardTab } from './types';

function makeTab(overrides: Partial<BoardTab> = {}): BoardTab {
  return {
    id: 'tab-1',
    name: 'Main Board',
    color: '#3B82F6',
    items: [],
    connections: [],
    ...overrides,
  };
}

const baseTabs: BoardTab[] = [
  makeTab({
    id: 'tab-a',
    name: 'Alpha',
    items: [
      { id: 'a1', type: 'npc', x: 100, y: 100, width: 200, height: 100, title: 'A1', content: '', date: '', color: '#000', tags: [], visibility: 'all', ownerId: 'u', comments: [] },
    ],
  }),
  makeTab({
    id: 'tab-b',
    name: 'Beta',
    items: [
      { id: 'b1', type: 'npc', x: 1000, y: 2000, width: 300, height: 150, title: 'B1', content: '', date: '', color: '#000', tags: [], visibility: 'all', ownerId: 'u', comments: [] },
    ],
  }),
];

const input = {
  tabs: baseTabs,
  activeTabId: 'tab-a',
  targetId: 'b1',
  itemDimensions: {},
  viewportW: 1200,
  viewportH: 800,
  currentScale: 1,
};

describe('navigateToItem', () => {
  it('returns null when the item does not exist on any tab', () => {
    expect(navigateToItem({ ...input, targetId: 'missing' })).toBeNull();
  });

  it('switches tab when the item lives on another tab', () => {
    const target = navigateToItem(input);
    expect(target).not.toBeNull();
    expect(target!.tabId).toBe('tab-b');
  });

  it('does not request a tab switch when already on the item\'s tab', () => {
    const target = navigateToItem({ ...input, targetId: 'a1' });
    expect(target).not.toBeNull();
    expect(target!.tabId).toBeNull();
  });

  it('centers the item in the viewport using measured dimensions when available', () => {
    const target = navigateToItem({
      ...input,
      targetId: 'b1',
      itemDimensions: { b1: { width: 400, height: 200 } },
    });
    // Measured center of b1 at (1000 + 200, 2000 + 100); viewport center (600, 400).
    expect(target!.x).toBe(600 - (1000 + 400 / 2));
    expect(target!.y).toBe(400 - (2000 + 200 / 2));
    expect(target!.scale).toBe(1);
  });

  it('falls back to item.width/height when no measured dimensions exist', () => {
    const target = navigateToItem(input);
    // Center of b1 at (1150, 2075).
    expect(target!.x).toBe(600 - 1150);
    expect(target!.y).toBe(400 - 2075);
  });

  it('clamps the scale to [0.6, 1.5] of the current scale', () => {
    const t1 = navigateToItem({ ...input, currentScale: 0.1 });
    expect(t1!.scale).toBe(0.6);
    const t2 = navigateToItem({ ...input, currentScale: 4 });
    expect(t2!.scale).toBe(1.5);
  });

  it('keeps the current scale when already in range', () => {
    const target = navigateToItem({ ...input, currentScale: 1.25 });
    expect(target!.scale).toBe(1.25);
  });
});
