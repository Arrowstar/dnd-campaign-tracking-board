import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildSearchIndex,
  searchIndex,
  stripHtml,
  canViewItem,
  getRecentItemIds,
  recordRecentItem,
  SEARCH_RESULT_CAP,
  SearchEntry,
} from './search';
import { BoardItem, ItemType } from './types';
import { Viewer } from './fieldVisibility';

let idCounter = 0;
function makeItem(overrides: Partial<BoardItem> = {}): BoardItem {
  idCounter += 1;
  return {
    id: `item-${idCounter}`,
    type: 'npc',
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    title: 'Test Item',
    content: '',
    date: '2026-01-01',
    color: '#000',
    tags: [],
    visibility: 'all',
    ownerId: 'user-owner',
    ownerName: 'Owner',
    comments: [],
    ...overrides,
  };
}

function build(
  items: BoardItem[],
  viewer: Viewer = { id: 'user-owner', role: 'dm' },
  opts: Omit<Parameters<typeof buildSearchIndex>[1], 'viewer'> = {}
) {
  return buildSearchIndex(
    items.map((item) => ({ item, tabId: 'tab-main' })),
    { viewer, ...opts }
  );
}

function search(index: SearchEntry[], query: string, filters: Parameters<typeof searchIndex>[2] = {}) {
  return searchIndex(index, query, filters);
}

describe('stripHtml', () => {
  it('strips tags and entities to plain text', () => {
    expect(stripHtml('<p>Secret <strong>cave</strong> under the <em>hill</em></p>')).toBe(
      'Secret cave under the hill'
    );
    expect(stripHtml('A &amp; B &nbsp; with &quot;quotes&quot;')).toBe('A & B with "quotes"');
  });
});

describe('canViewItem', () => {
  const dm = { id: 'dm', role: 'dm' as const };
  const player = { id: 'player', role: 'player' as const };

  it('dm items are visible to DM and the owning player, not others', () => {
    const dmItem = makeItem({ visibility: 'dm', ownerId: 'player' });
    expect(canViewItem(dmItem, dm)).toBe(true);
    expect(canViewItem(dmItem, player)).toBe(true); // owner
    expect(canViewItem(dmItem, { id: 'other', role: 'player' as const })).toBe(false);
  });

  it('owner items are visible only to the owner', () => {
    const ownerItem = makeItem({ visibility: 'owner', ownerId: 'player' });
    expect(canViewItem(ownerItem, dm)).toBe(false); // no DM override
    expect(canViewItem(ownerItem, player)).toBe(true);
    expect(canViewItem(ownerItem, { id: 'other', role: 'player' as const })).toBe(false);
  });
});

describe('buildSearchIndex', () => {
  it('filters dm-visibility items for non-owner players', () => {
    const hidden = makeItem({ title: 'Nezznar Lair', visibility: 'dm', ownerId: 'dm-user' });
    const index = build([hidden], { id: 'player', role: 'player' });
    expect(search(index, 'nezznar')).toHaveLength(0);
  });

  it('skips field content the viewer cannot see, but keeps the label', () => {
    const item = makeItem({
      title: 'Tavern',
      fields: [
        { id: 'f1', label: 'Secret Backstory', type: 'text', textValue: 'Betrayed the king', visibility: 'dm' },
        { id: 'f2', label: 'Menu', type: 'text', textValue: 'Roast boar' },
      ],
    });
    const playerIndex = build([item], { id: 'player', role: 'player' });
    // Content is not indexed for the player…
    expect(search(playerIndex, 'betrayed')).toHaveLength(0);
    expect(search(playerIndex, 'boar')).toHaveLength(1);
    // …but the dm-only field label is still findable.
    const labelHit = search(playerIndex, 'backstory');
    expect(labelHit).toHaveLength(1);
    expect(labelHit[0].fieldLabel).toBe('Secret Backstory');
  });

  it('owner-visibility field content is only indexed for the item owner', () => {
    const item = makeItem({
      ownerId: 'owner',
      fields: [{ id: 'f1', label: 'Weakness', type: 'text', textValue: 'Afraid of fire', visibility: 'owner' }],
    });
    const ownerIndex = build([item], { id: 'owner', role: 'player' });
    expect(search(ownerIndex, 'fire')).toHaveLength(1);
    const otherIndex = build([item], { id: 'player', role: 'player' });
    expect(search(otherIndex, 'fire')).toHaveLength(0);
    expect(search(otherIndex, 'weakness')).toHaveLength(1); // label still visible
  });

  it('excludes hidden segments when includeHidden is false (DM toggle off)', () => {
    const item = makeItem({
      title: 'Safehouse',
      fields: [{ id: 'f1', label: 'Secret Rendezvous', type: 'text', textValue: 'Under the docks', visibility: 'dm' }],
    });
    const index = build([item], { id: 'dm', role: 'dm' }, { includeHidden: false });
    expect(search(index, 'docks')).toHaveLength(0);
    expect(search(index, 'rendezvous')).toHaveLength(0); // label is dm-scoped too
    expect(search(index, 'safehouse')).toHaveLength(1);
  });

  it('excludes comments from the index unless includeComments is set', () => {
    const item = makeItem({
      title: 'Warehouse',
      comments: [{ id: 'c1', userId: 'u1', userName: 'Alice', text: 'The password is ember', timestamp: '' }],
    });
    const without = build([item], { id: 'dm', role: 'dm' }, { includeComments: false });
    expect(search(without, 'ember')).toHaveLength(0);
    const withComments = build([item], { id: 'dm', role: 'dm' }, { includeComments: true });
    const hits = search(withComments, 'ember');
    expect(hits).toHaveLength(1);
    expect(hits[0].commentMatch).toBe(true);
  });
});

describe('searchIndex', () => {
  it('matches titles case-insensitively across tabs', () => {
    const a = makeItem({ id: 'a', title: 'Lord Nezznar', type: 'npc' });
    const b = makeItem({ id: 'b', title: 'Tavern Keeper', type: 'npc' });
    const index = build([a, b], { id: 'dm', role: 'dm' });
    const hits = search(index, 'NEZZNAR');
    expect(hits).toHaveLength(1);
    expect(hits[0].itemId).toBe('a');
    expect(hits[0].tabId).toBe('tab-main');
  });

  it('matches tags as #tag and bare token', () => {
    const item = makeItem({ id: 't', title: 'Master of Ceremonies', tags: ['guild', 'secret'] });
    const index = build([item], { id: 'dm', role: 'dm' });
    expect(search(index, '#guild')).toHaveLength(1);
    const hits = search(index, 'guild');
    expect(hits).toHaveLength(1);
    expect(hits[0].tagMatch).toBe(true);
    expect(hits[0].snippet).toBe('#guild');
  });

  it('flattens @@MULTILINK field values so linked titles are findable', () => {
    const item = makeItem({
      id: 'link',
      title: 'Quest Board',
      fields: [
        {
          id: 'f1',
          label: 'Associates',
          type: 'text',
          textValue: '@@MULTILINK:[{"type":"text","value":"Knows "},{"type":"link","id":"x","title":"Drow Ranger","itemType":"character"}]',
        },
      ],
    });
    const index = build([item], { id: 'dm', role: 'dm' });
    const hits = search(index, 'drow ranger');
    expect(hits).toHaveLength(1);
    expect(hits[0].fieldLabel).toBe('Associates');
  });

  it('flattens structured JSON field values with nested token lists', () => {
    const item = makeItem({
      id: 'struct',
      title: 'Court Record',
      fields: [
        {
          id: 'f1',
          label: 'Appearances',
          type: 'text',
          textValue: JSON.stringify({
            recent: '@@MULTILINK:[{"type":"link","id":"x","title":"Crown Witness","itemType":"npc"}]',
            note: 'Fled to the north',
          }),
        },
      ],
    });
    const index = build([item], { id: 'dm', role: 'dm' });
    expect(search(index, 'crown witness')).toHaveLength(1);
    expect(search(index, 'north')).toHaveLength(1);
  });

  it('matches HTML-rich content after stripping tags', () => {
    const item = makeItem({ id: 'rich', title: 'Cave', content: '<p>Hidden <strong>treasure</strong> chamber</p>' });
    const index = build([item], { id: 'dm', role: 'dm' });
    expect(search(index, 'treasure')).toHaveLength(1);
  });

  it('ranks title matches above tag, field, and comment matches', () => {
    const byTitle = makeItem({ id: 'r1', title: 'Guild Hall', tags: [] });
    const byTag = makeItem({ id: 'r2', title: 'Warehouse', tags: ['guild'] });
    const byField = makeItem({
      id: 'r3',
      title: 'Storefront',
      fields: [{ id: 'f1', label: 'Guild Registry', type: 'text', textValue: '' }],
    });
    const byComment = makeItem({
      id: 'r4',
      title: 'Office',
      comments: [{ id: 'c1', userId: 'u', userName: 'Bob', text: 'Guild dues are overdue', timestamp: '' }],
    });
    const index = build([byTitle, byTag, byField, byComment], { id: 'dm', role: 'dm' }, { includeComments: true });
    const hits = search(index, 'guild');
    expect(hits.map((h) => h.itemId)).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('breaks ties by type order then title', () => {
    const a = makeItem({ id: 't1', title: 'Aardvark', type: 'character' });
    const b = makeItem({ id: 't2', title: 'Alpaca', type: 'character' });
    const c = makeItem({ id: 't3', title: 'Ant', type: 'npc' });
    const index = build([a, b, c], { id: 'dm', role: 'dm' });
    const hits = search(index, 'a');
    // All title matches with the prefix bonus (score 12): characters sort
    // before npcs, and within a type titles sort ascending.
    expect(hits.map((h) => h.itemId)).toEqual(['t1', 't2', 't3']);
  });

  it('filters by item type', () => {
    const npc = makeItem({ id: 'n', title: 'Captain', type: 'npc' });
    const location = makeItem({ id: 'l', title: 'Captain\'s Quarters', type: 'location' });
    const index = build([npc, location], { id: 'dm', role: 'dm' });
    const hits = search(index, 'captain', { types: ['location'] });
    expect(hits.map((h) => h.itemId)).toEqual(['l']);
  });

  it('re-applies comment and hidden filters at query time', () => {
    const item = makeItem({
      id: 'x',
      title: 'Keep',
      comments: [{ id: 'c1', userId: 'u', userName: 'Sam', text: 'Meet at the keep', timestamp: '' }],
    });
    const index = build([item], { id: 'dm', role: 'dm' }, { includeComments: true });
    expect(search(index, 'sam', { includeComments: false })).toHaveLength(0);
    expect(search(index, 'sam')).toHaveLength(1);
  });

  it('caps results at SEARCH_RESULT_CAP', () => {
    const items = Array.from({ length: SEARCH_RESULT_CAP + 20 }, (_, i) =>
      makeItem({ id: `cap-${i}`, title: 'Needle', type: 'note' })
    );
    const index = build(items, { id: 'dm', role: 'dm' });
    expect(search(index, 'needle')).toHaveLength(SEARCH_RESULT_CAP);
  });

  it('returns no results for an empty query', () => {
    const index = build([makeItem({ title: 'Anything' })], { id: 'dm', role: 'dm' });
    expect(search(index, '  ')).toHaveLength(0);
  });
});

describe('recent items', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records recent items most-recent-first and dedupes', () => {
    recordRecentItem('b1', 'u1', 'a');
    recordRecentItem('b1', 'u1', 'b');
    recordRecentItem('b1', 'u1', 'a');
    expect(getRecentItemIds('b1', 'u1')).toEqual(['a', 'b']);
  });

  it('caps the list at 8 and keeps boards/users separate', () => {
    for (let i = 0; i < 10; i++) recordRecentItem('b1', 'u1', `id-${i}`);
    expect(getRecentItemIds('b1', 'u1')).toHaveLength(8);
    expect(getRecentItemIds('b1', 'u1')[0]).toBe('id-9');
    expect(getRecentItemIds('b2', 'u1')).toEqual([]);
    expect(getRecentItemIds('b1', 'u2')).toEqual([]);
  });
});

describe('image items', () => {
  it('does not index the image URL in content', () => {
    const item = makeItem({ id: 'img', title: 'Battle Map', type: 'image' as ItemType, content: 'https://blob.example/x.png' });
    const index = build([item], { id: 'dm', role: 'dm' });
    expect(search(index, 'blob.example')).toHaveLength(0);
    expect(search(index, 'battle map')).toHaveLength(1);
  });
});
