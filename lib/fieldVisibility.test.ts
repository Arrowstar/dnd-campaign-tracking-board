import { describe, it, expect } from 'vitest';
import { mergeTabsForSave, mergeCommentsForSave } from './fieldVisibility';
import { BoardItem, BoardTab, Comment } from './types';

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

function makeComment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    userId: 'u-owner',
    userName: 'Owner',
    text: `comment ${id}`,
    timestamp: 'Aug 3, 2026 1:00 pm',
    ...overrides,
  };
}

const player: { id: string; role: 'dm' | 'player'; displayName: string } = {
  id: 'u-player',
  role: 'player',
  displayName: 'Player One',
};
const dm: { id: string; role: 'dm' | 'player'; displayName: string } = {
  id: 'u-dm',
  role: 'dm',
  displayName: 'The DM',
};

function oneTab(items: BoardItem[]): BoardTab[] {
  return [makeTab({ id: 'tab-1', items })];
}

// ─── mergeCommentsForSave (HIGH #3) ─────────────────────────────────────────

describe('mergeCommentsForSave', () => {
  it('stamps the authenticated user on new comments, ignoring client attribution', () => {
    const stored = [makeComment('c1')];
    const incoming = [
      { ...makeComment('c1'), id: 'c1' },
      {
        id: 'c2',
        userId: 'u-dm', // forged: claims to be the DM
        userName: 'The DM',
        text: '<b>hi</b>',
        timestamp: 'Aug 3, 2026 2:00 pm',
      },
    ];
    const merged = mergeCommentsForSave(stored, incoming, player, 'u-owner');
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual(stored[0]);
    expect(merged[1]).toEqual({
      id: 'c2',
      userId: 'u-player',
      userName: 'Player One',
      text: '<b>hi</b>',
      timestamp: 'Aug 3, 2026 2:00 pm',
    });
  });

  it('keeps stored comments verbatim when the client rewrites them', () => {
    const stored = [makeComment('c1')];
    const incoming = [{ ...makeComment('c1'), userId: 'u-dm', userName: 'The DM', text: 'rewritten' }];
    const merged = mergeCommentsForSave(stored, incoming, player, 'u-owner');
    expect(merged).toEqual(stored);
  });

  it('allows the author to delete their own comment', () => {
    const stored = [makeComment('c1', { userId: 'u-player', userName: 'Player One' }), makeComment('c2')];
    const merged = mergeCommentsForSave(stored, [], player, 'u-owner');
    expect(merged).toEqual([stored[1]]);
  });

  it('allows the item owner to delete any comment', () => {
    const stored = [makeComment('c1', { userId: 'u-player' })];
    const merged = mergeCommentsForSave(stored, [], { ...player, id: 'u-owner' }, 'u-owner');
    expect(merged).toEqual([]);
  });

  it('allows the DM to delete any comment', () => {
    const stored = [makeComment('c1', { userId: 'u-player' })];
    const merged = mergeCommentsForSave(stored, [], dm, 'u-owner');
    expect(merged).toEqual([]);
  });

  it('restores comments deleted by someone without permission', () => {
    const stored = [makeComment('c1', { userId: 'u-dm', userName: 'The DM' }), makeComment('c2')];
    // Player tries to wipe the DM's comment (and their own is kept too).
    const merged = mergeCommentsForSave(stored, [], player, 'u-owner');
    expect(merged).toEqual(stored);
  });

  it('preserves stored order and appends new comments after them', () => {
    const stored = [makeComment('c1'), makeComment('c2')];
    const incoming = [
      { ...makeComment('c1') },
      makeComment('c3', { userId: 'u-x', userName: 'X' }),
      { ...makeComment('c2') },
    ];
    const merged = mergeCommentsForSave(stored, incoming, player, 'u-owner');
    expect(merged.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(merged[2].userId).toBe('u-player');
  });

  it('is a no-op when incoming is undefined', () => {
    const stored = [makeComment('c1')];
    expect(mergeCommentsForSave(stored, undefined, player, 'u-owner')).toEqual(stored);
  });
});

// ─── mergeTabsForSave comment path (HIGH #3) ─────────────────────────────────

describe('mergeTabsForSave — comments', () => {
  it('merges comments on non-owned items instead of replacing them', () => {
    const stored = oneTab([makeItem('i1', { comments: [makeComment('c1', { userId: 'u-dm' })] })]);
    const incoming = oneTab([
      {
        ...makeItem('i1'),
        comments: [makeComment('c2', { userId: 'u-dm', userName: 'The DM' })], // forged delete of c1 + forged add
      },
    ]);
    const merged = mergeTabsForSave(stored, incoming, player, new Set(['u-owner', 'u-player']));
    const comments = merged[0].items[0].comments;
    expect(comments.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(comments[1].userId).toBe('u-player');
    expect(comments[1].userName).toBe('Player One');
  });

  it('lets the owner delete any comment through the item save path', () => {
    const stored = oneTab([makeItem('i1', { ownerId: 'u-owner', comments: [makeComment('c1')] })]);
    const incoming = oneTab([{ ...makeItem('i1', { ownerId: 'u-owner' }), comments: [] }]);
    const merged = mergeTabsForSave(
      stored,
      incoming,
      { id: 'u-owner', role: 'player', displayName: 'Owner' },
      new Set(['u-owner'])
    );
    expect(merged[0].items[0].comments).toEqual([]);
  });

  it('keeps the DM comment when a non-owner player edits the item', () => {
    const stored = oneTab([
      makeItem('i1', {
        comments: [makeComment('c1', { userId: 'u-dm', userName: 'The DM', text: '<b>secret</b>' })],
      }),
    ]);
    const incoming = oneTab([makeItem('i1', { comments: [] })]);
    const merged = mergeTabsForSave(stored, incoming, player, new Set(['u-owner']));
    expect(merged[0].items[0].comments).toEqual(stored[0].items[0].comments);
  });

  it('merges comments on owned items too (owner edits keep others\' comments)', () => {
    const stored = oneTab([
      makeItem('i1', { ownerId: 'u-owner', comments: [makeComment('c1', { userId: 'u-player' })] }),
    ]);
    const incoming = oneTab([
      {
        ...makeItem('i1', { ownerId: 'u-owner' }),
        title: 'edited',
        comments: [makeComment('c1', { userId: 'u-player' }), makeComment('c2')],
      },
    ]);
    const merged = mergeTabsForSave(
      stored,
      incoming,
      { id: 'u-owner', role: 'player', displayName: 'Owner' },
      new Set(['u-owner', 'u-player'])
    );
    const item = merged[0].items[0];
    expect(item.title).toBe('edited');
    expect(item.comments.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(item.comments[1].userId).toBe('u-owner');
  });

  it('lets a DM delete any comment and keeps attribution', () => {
    const stored = oneTab([
      makeItem('i1', { ownerId: 'u-owner', comments: [makeComment('c1', { userId: 'u-player' })] }),
    ]);
    const incoming = oneTab([makeItem('i1', { comments: [] })]);
    const merged = mergeTabsForSave(stored, incoming, dm, new Set(['u-owner']));
    expect(merged[0].items[0].comments).toEqual([]);
  });
});

// ─── mergeTabsForSave ownership (HIGH #4) ────────────────────────────────────

describe('mergeTabsForSave — new item ownership', () => {
  it('forces player-created items to be owned by the player', () => {
    const stored = oneTab([]);
    const incoming = oneTab([
      makeItem('new-1', { ownerId: 'u-owner', ownerName: 'Owner', comments: [] }),
    ]);
    const merged = mergeTabsForSave(stored, incoming, player, new Set(['u-owner', 'u-player']));
    expect(merged[0].items[0].ownerId).toBe('u-player');
    expect(merged[0].items[0].ownerName).toBe('Player One');
  });

  it('lets a DM assign a new item to an existing member', () => {
    const stored = oneTab([]);
    const incoming = oneTab([makeItem('new-1', { ownerId: 'u-owner', ownerName: 'Owner' })]);
    const merged = mergeTabsForSave(stored, incoming, dm, new Set(['u-owner', 'u-dm']));
    expect(merged[0].items[0].ownerId).toBe('u-owner');
  });

  it('falls back to the DM when a DM claims a non-member owner on a new item', () => {
    const stored = oneTab([]);
    const incoming = oneTab([
      makeItem('new-1', { ownerId: 'u-outsider', ownerName: 'Outsider' }),
    ]);
    const merged = mergeTabsForSave(stored, incoming, dm, new Set(['u-owner', 'u-dm']));
    expect(merged[0].items[0].ownerId).toBe('u-dm');
  });

  it('forces ownership on items inside brand-new tabs', () => {
    const stored: BoardTab[] = [];
    const incoming = [
      makeTab({
        id: 'tab-new',
        items: [
          makeItem('new-1', { ownerId: 'u-owner', ownerName: 'Owner' }),
          makeItem('new-2', { ownerId: 'u-other', ownerName: 'Other' }),
        ],
      }),
    ];
    const merged = mergeTabsForSave(stored, incoming, player, new Set(['u-owner', 'u-player']));
    expect(merged[0].items.map((i) => i.ownerId)).toEqual(['u-player', 'u-player']);
    expect(merged[0].items.map((i) => i.ownerName)).toEqual(['Player One', 'Player One']);
  });

  it('keeps existing item behavior: players cannot reassign ownership of stored items', () => {
    const stored = oneTab([makeItem('i1', { ownerId: 'u-owner', ownerName: 'Owner' })]);
    const incoming = oneTab([
      makeItem('i1', { ownerId: 'u-player', ownerName: 'Player One' }),
    ]);
    const merged = mergeTabsForSave(stored, incoming, player, new Set(['u-owner', 'u-player']));
    expect(merged[0].items[0].ownerId).toBe('u-owner');
  });
});

// ─── mergeTabsForSave unchanged-item fast path (Feature 12) ──────────────────

describe('mergeTabsForSave — unchanged-item fast path (Feature 12)', () => {
  it('returns the stored item when the incoming item is identical', () => {
    const item = makeItem('i1', { ownerId: 'u-owner', comments: [makeComment('c1')] });
    const stored = oneTab([item]);
    // Deep-equal copy (a DM's client re-sends untouched items byte-identically).
    const incoming = oneTab([{ ...item, comments: [makeComment('c1')] }]);
    const merged = mergeTabsForSave(stored, incoming, dm, new Set(['u-owner']));
    expect(merged[0].items[0]).toBe(item);
  });

  it('still restores hidden fields when a player sends a scrubbed item back', () => {
    const hidden = {
      id: 'f-hidden',
      label: 'Secrets',
      type: 'text' as const,
      textValue: 'DM-only',
      visibility: 'dm' as const,
    };
    const stored = oneTab([
      makeItem('i1', { ownerId: 'u-player', ownerName: 'Player One', fields: [hidden] }),
    ]);
    // The player's client only ever SAW a scrubbed copy — no hidden fields.
    const incoming = oneTab([
      makeItem('i1', { ownerId: 'u-player', ownerName: 'Player One', fields: [] }),
    ]);
    const merged = mergeTabsForSave(stored, incoming, player, new Set(['u-player']));
    expect(merged[0].items[0].fields).toEqual([hidden]);
  });

  it('still applies comment merging when the incoming item differs', () => {
    const stored = oneTab([
      makeItem('i1', { ownerId: 'u-player', comments: [makeComment('c1')] }),
    ]);
    const incoming = oneTab([
      {
        ...makeItem('i1', { ownerId: 'u-player' }),
        title: 'edited',
        comments: [makeComment('c1'), makeComment('c2')],
      },
    ]);
    const merged = mergeTabsForSave(stored, incoming, player, new Set(['u-player']));
    expect(merged[0].items[0].title).toBe('edited');
    expect(merged[0].items[0].comments.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(merged[0].items[0].comments[1].userId).toBe('u-player');
  });
});
