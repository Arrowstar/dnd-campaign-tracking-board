import { describe, it, expect } from 'vitest';
import { itemTitlesById, sameItemTitles } from './crossref';
import { BoardItem, BoardTab } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeItem(id: string, title: string): BoardItem {
  return {
    id,
    type: 'npc',
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    title,
    content: '',
    date: '',
    color: '#000',
    tags: [],
    visibility: 'all',
    ownerId: 'u-owner',
    comments: [],
  };
}

function makeTab(id: string, items: BoardItem[] = []): BoardTab {
  return { id, name: `Tab ${id}`, color: '#3B82F6', items, connections: [] };
}

// ─── itemTitlesById / sameItemTitles ─────────────────────────────────────────

describe('sameItemTitles', () => {
  it('returns true for identical title sets', () => {
    const a = [makeTab('t1', [makeItem('x', 'X'), makeItem('y', 'Y')])];
    const b = [makeTab('t1', [makeItem('x', 'X'), makeItem('y', 'Y')])];
    expect(sameItemTitles(a, b)).toBe(true);
  });

  it('returns false when an item title changed', () => {
    const a = [makeTab('t1', [makeItem('x', 'Old')])];
    const b = [makeTab('t1', [makeItem('x', 'New')])];
    expect(sameItemTitles(a, b)).toBe(false);
  });

  it('returns false when the item set differs (add/remove)', () => {
    const a = [makeTab('t1', [makeItem('x', 'X')])];
    const b = [makeTab('t1', [makeItem('x', 'X'), makeItem('z', 'Z')])];
    expect(sameItemTitles(a, b)).toBe(false);
    expect(sameItemTitles(b, a)).toBe(false);
  });

  it('ignores non-title content changes', () => {
    const a = [makeTab('t1', [makeItem('x', 'X')])];
    const b = [makeTab('t1', [{ ...makeItem('x', 'X'), content: '<p>edited</p>' }])];
    expect(sameItemTitles(a, b)).toBe(true);
  });

  it('indexes by id across all tabs', () => {
    const tabs = [makeTab('t1', [makeItem('x', 'X')]), makeTab('t2', [makeItem('y', 'Y')])];
    const byId = itemTitlesById(tabs);
    expect(byId.get('x')).toBe('X');
    expect(byId.get('y')).toBe('Y');
    expect(byId.size).toBe(2);
  });
});
