import { describe, it, expect } from 'vitest';
import {
  isTokenUsable,
  expiryForDays,
  validateCreatePayload,
  underShareCap,
  filterTabForShare,
  buildViewPayload,
  MAX_SHARE_LINKS,
  ShareRow,
} from './shareTokens';
import { BoardItem, BoardTab } from './types';

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

function makeShareRow(overrides: Partial<ShareRow> = {}): ShareRow {
  return {
    token: 'abc123',
    board_id: 'board-1',
    label: 'Party map link',
    created_at: '2026-08-01T00:00:00.000Z',
    expires_at: null,
    ...overrides,
  };
}

const NOW = new Date('2026-08-03T12:00:00.000Z');

describe('isTokenUsable', () => {
  it('accepts a row with no expiry (never expires)', () => {
    expect(isTokenUsable(makeShareRow(), NOW)).toBe(true);
  });

  it('accepts a row whose expiry is in the future', () => {
    expect(isTokenUsable(makeShareRow({ expires_at: '2026-09-01T00:00:00.000Z' }), NOW)).toBe(true);
  });

  it('rejects an expired row', () => {
    expect(isTokenUsable(makeShareRow({ expires_at: '2026-08-01T00:00:00.000Z' }), NOW)).toBe(false);
  });

  it('rejects a missing (revoked) row', () => {
    expect(isTokenUsable(null, NOW)).toBe(false);
    expect(isTokenUsable(undefined, NOW)).toBe(false);
  });
});

describe('expiryForDays', () => {
  it('returns null for never', () => {
    expect(expiryForDays(null, NOW)).toBeNull();
  });

  it('adds the requested days to the reference time', () => {
    const d = expiryForDays(7, NOW)!;
    expect(d.getTime()).toBe(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
  });
});

describe('validateCreatePayload', () => {
  it('defaults label to "View link" and expiry to never', () => {
    const r = validateCreatePayload({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.label).toBe('View link');
      expect(r.expiresInDays).toBeNull();
    }
  });

  it('trims labels and falls back to the default when blank', () => {
    const r = validateCreatePayload({ label: '   ' });
    expect(r.ok && r.label).toBe('View link');
  });

  it('accepts labels up to 40 chars and rejects longer ones', () => {
    expect(validateCreatePayload({ label: 'x'.repeat(40) }).ok).toBe(true);
    expect(validateCreatePayload({ label: 'x'.repeat(41) }).ok).toBe(false);
  });

  it('rejects non-string labels', () => {
    expect(validateCreatePayload({ label: 42 }).ok).toBe(false);
  });

  it('accepts only 7/30/90 day expiries or null', () => {
    expect(validateCreatePayload({ expiresInDays: null }).ok).toBe(true);
    expect(validateCreatePayload({ expiresInDays: 7 }).ok).toBe(true);
    expect(validateCreatePayload({ expiresInDays: 30 }).ok).toBe(true);
    expect(validateCreatePayload({ expiresInDays: 90 }).ok).toBe(true);
    expect(validateCreatePayload({ expiresInDays: 14 }).ok).toBe(false);
    expect(validateCreatePayload({ expiresInDays: '7' }).ok).toBe(false);
    expect(validateCreatePayload({ expiresInDays: 7.5 }).ok).toBe(false);
  });
});

describe('underShareCap', () => {
  it('allows creation under the cap and blocks at it', () => {
    expect(underShareCap(MAX_SHARE_LINKS - 1)).toBe(true);
    expect(underShareCap(MAX_SHARE_LINKS)).toBe(false);
    expect(underShareCap(MAX_SHARE_LINKS + 5)).toBe(false);
  });
});

describe('filterTabForShare', () => {
  it('keeps only visibility "all" items (undefined counts as "all")', () => {
    const all = makeItem({ visibility: 'all' });
    const dm = makeItem({ visibility: 'dm' });
    const owner = makeItem({ visibility: 'owner' });
    const legacy = makeItem({ visibility: undefined });
    const tab = makeTab({ items: [all, dm, owner, legacy] });

    const filtered = filterTabForShare(tab);
    expect(filtered.items.map(i => i.id)).toEqual([all.id, legacy.id]);
  });

  it('drops connections whose endpoints were filtered out', () => {
    const kept = makeItem();
    const dm = makeItem({ visibility: 'dm' });
    const tab = makeTab({
      items: [kept, dm],
      connections: [
        { id: 'c1', fromId: kept.id, toId: dm.id, label: 'bad', color: '#000', style: 'solid' },
        { id: 'c2', fromId: kept.id, toId: kept.id, label: 'good', color: '#000', style: 'solid' },
      ],
    });

    const filtered = filterTabForShare(tab);
    expect(filtered.connections.map(c => c.id)).toEqual(['c2']);
  });

  it('nulls annotation pins pointing at filtered items and drops empty pin arrays', () => {
    const kept = makeItem();
    const dm = makeItem({ visibility: 'dm' });
    const tab = makeTab({
      items: [kept, dm],
      annotations: [
        { id: 'a1', type: 'line', x: 0, y: 0, x2: 10, y2: 10, pins: [{ itemId: dm.id, offsetX: 0, offsetY: 0 }, { itemId: kept.id, offsetX: 1, offsetY: 1 }] },
        { id: 'a2', type: 'line', x: 0, y: 0, x2: 10, y2: 10, pins: [{ itemId: dm.id, offsetX: 0, offsetY: 0 }] },
      ],
    });

    const filtered = filterTabForShare(tab);
    const a1 = filtered.annotations!.find(a => a.id === 'a1')!;
    expect(a1.pins).toEqual([null, { itemId: kept.id, offsetX: 1, offsetY: 1 }]);
    const a2 = filtered.annotations!.find(a => a.id === 'a2')!;
    expect(a2.pins).toBeUndefined();
  });

  it('leaves untouched tabs with no filtered content', () => {
    const kept = makeItem();
    const tab = makeTab({
      items: [kept],
      connections: [{ id: 'c1', fromId: kept.id, toId: kept.id, label: 'x', color: '#000', style: 'solid' }],
    });
    expect(filterTabForShare(tab)).toEqual(tab);
  });
});

describe('buildViewPayload', () => {
  it('scrubs hidden field content for the anonymous player (lock shells kept)', () => {
    const item = makeItem({
      fields: [
        { id: 'f1', label: 'Backstory', type: 'text', textValue: 'visible' },
        { id: 'f2', label: 'Secrets', type: 'text', textValue: 'hidden', visibility: 'dm' },
        { id: 'f3', label: 'Owner-only', type: 'text', textValue: 'hidden2', visibility: 'owner' },
      ],
    });
    const payload = buildViewPayload({ id: 'board-1', tabs: [makeTab({ items: [item] })] });

    const outItem = payload.tabs[0].items[0];
    const f1 = outItem.fields!.find(f => f.id === 'f1')!;
    const f2 = outItem.fields!.find(f => f.id === 'f2')!;
    const f3 = outItem.fields!.find(f => f.id === 'f3')!;
    expect(f1.textValue).toBe('visible');
    expect(f2.textValue).toBeUndefined();
    expect(f2.visibility).toBe('dm');
    expect(f3.textValue).toBeUndefined();
  });

  it('filters dm/owner items out of the payload entirely', () => {
    const all = makeItem({ visibility: 'all' });
    const dm = makeItem({ visibility: 'dm' });
    const owner = makeItem({ visibility: 'owner' });
    const payload = buildViewPayload({ id: 'board-1', tabs: [makeTab({ items: [all, dm, owner] })] });
    expect(payload.tabs[0].items.map(i => i.id)).toEqual([all.id]);
  });

  it('uses the board id as title and passes settings/updatedAt through', () => {
    const payload = buildViewPayload({
      id: 'board-1',
      settings: { cardFontScale: 1.2 },
      updated_at: '2026-08-03T12:00:00.000Z',
    });
    expect(payload.boardId).toBe('board-1');
    expect(payload.title).toBe('board-1');
    expect(payload.settings).toEqual({ cardFontScale: 1.2 });
    expect(payload.updatedAt).toBe('2026-08-03T12:00:00.000Z');
  });

  it('never mutates the stored board', () => {
    const item = makeItem({
      fields: [{ id: 'f2', label: 'Secrets', type: 'text', textValue: 'hidden', visibility: 'dm' }],
    });
    const tabs: BoardTab[] = [makeTab({ items: [item] })];
    buildViewPayload({ id: 'board-1', tabs });
    expect(tabs[0].items[0].fields![0].textValue).toBe('hidden');
  });
});
