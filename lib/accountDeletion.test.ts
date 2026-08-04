import { describe, it, expect } from 'vitest';
import {
  reassignItemsToDm,
  findBoardDm,
  summarizeDeletion,
  findBlockingBoards,
  intersectMemberBoards,
  DeletionSummary,
} from './accountDeletion';
import { BoardTab } from './types';

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

function makeTabs(): BoardTab[] {
  return [
    makeTab({
      items: [
        {
          id: 'i-owned', type: 'npc', x: 0, y: 0, width: 200, height: 100,
          title: 'Owned', content: '', date: '', color: '#000', tags: [],
          visibility: 'owner', ownerId: 'u-deleted', ownerName: 'Gone', comments: [],
        },
        {
          id: 'i-other', type: 'character', x: 0, y: 0, width: 200, height: 100,
          title: 'Other', content: '', date: '', color: '#000', tags: [],
          visibility: 'all', ownerId: 'u-dm', ownerName: 'The DM', comments: [],
        },
      ],
      annotations: [
        { id: 'a-owned', type: 'circle', x: 0, y: 0, ownerId: 'u-deleted', ownerName: 'Gone' },
        { id: 'a-other', type: 'line', x: 0, y: 0, ownerId: 'u-dm', ownerName: 'The DM' },
      ],
    }),
  ];
}

// ─── reassignItemsToDm ───────────────────────────────────────────────────────

describe('reassignItemsToDm', () => {
  it('rewrites ownerId/ownerName of items and annotations owned by the deleted user', () => {
    const tabs = makeTabs();
    const out = reassignItemsToDm(tabs, 'u-deleted', { id: 'u-dm', displayName: 'The DM' });

    const item = out[0].items.find((i) => i.id === 'i-owned')!;
    expect(item.ownerId).toBe('u-dm');
    expect(item.ownerName).toBe('The DM');

    const ann = out[0].annotations!.find((a) => a.id === 'a-owned')!;
    expect(ann.ownerId).toBe('u-dm');
    expect(ann.ownerName).toBe('The DM');
  });

  it('leaves other owners untouched', () => {
    const out = reassignItemsToDm(makeTabs(), 'u-deleted', { id: 'u-dm', displayName: 'The DM' });
    const item = out[0].items.find((i) => i.id === 'i-other')!;
    expect(item.ownerId).toBe('u-dm');
    const ann = out[0].annotations!.find((a) => a.id === 'a-other')!;
    expect(ann.ownerId).toBe('u-dm');
  });

  it('is a no-op when the user owns nothing (tab references preserved)', () => {
    const tabs = makeTabs();
    const out = reassignItemsToDm(tabs, 'u-nobody', { id: 'u-dm', displayName: 'The DM' });
    expect(out).toBe(tabs);
    expect(out[0].items).toBe(tabs[0].items);
  });

  it('returns the same tab object when no ownership changed in it', () => {
    const tabs = [makeTab({ items: [{ id: 'x', type: 'note', x: 0, y: 0, width: 1, height: 1, title: 'X', content: '', date: '', color: '', tags: [], visibility: 'all', ownerId: 'someone-else', comments: [] }] })];
    const out = reassignItemsToDm(tabs, 'u-deleted', { id: 'u-dm', displayName: 'The DM' });
    expect(out[0]).toBe(tabs[0]);
  });

  it('handles annotations arrays that are undefined', () => {
    const tabs = [makeTab({
      items: [{
        id: 'y', type: 'note', x: 0, y: 0, width: 1, height: 1, title: 'Y', content: '', date: '', color: '', tags: [], visibility: 'all', ownerId: 'u-deleted', comments: [],
      }],
    })];
    const out = reassignItemsToDm(tabs, 'u-deleted', { id: 'u-dm', displayName: 'The DM' });
    expect(out[0].items[0].ownerId).toBe('u-dm');
  });
});

// ─── findBoardDm ─────────────────────────────────────────────────────────────

describe('findBoardDm', () => {
  it('returns the first dm member id', () => {
    expect(findBoardDm({ a: { role: 'player' }, b: { role: 'dm' } })).toBe('b');
  });

  it('returns undefined for null/empty members', () => {
    expect(findBoardDm(null)).toBeUndefined();
    expect(findBoardDm(undefined)).toBeUndefined();
    expect(findBoardDm({})).toBeUndefined();
  });
});

// ─── summarizeDeletion ───────────────────────────────────────────────────────

function makeBoard(id: string, members: Record<string, { role: 'dm' | 'player'; joinedAt?: string }>, tabs: BoardTab[] = []) {
  return { id, members, tabs };
}

describe('summarizeDeletion', () => {
  const boards = [
    makeBoard('solo-dm', { 'u-me': { role: 'dm' } }),
    makeBoard('group-dm', { 'u-me': { role: 'dm' }, 'u-p1': { role: 'player' }, 'u-p2': { role: 'player' } }),
    makeBoard(
      'member-board',
      { 'u-me': { role: 'player' }, 'u-dm': { role: 'dm' } },
      [
        makeTab({
          items: [
            {
              id: 'mine', type: 'npc', x: 0, y: 0, width: 200, height: 100,
              title: 'Mine', content: '', date: '', color: '#000', tags: [],
              visibility: 'all', ownerId: 'u-me', ownerName: 'Me', comments: [],
            },
          ],
        }),
      ]
    ),
    makeBoard('not-mine', { 'u-other': { role: 'dm' } }),
  ];

  it('classifies DM boards with member counts', () => {
    const s = summarizeDeletion('u-me', boards, () => undefined);
    expect(s.dmBoards).toEqual([
      { boardId: 'solo-dm', memberCount: 1, otherMembers: 0, hasOthers: false },
      { boardId: 'group-dm', memberCount: 3, otherMembers: 2, hasOthers: true },
    ]);
  });

  it('counts owned items on member boards and resolves the DM name', () => {
    const s = summarizeDeletion('u-me', boards, (id) => (id === 'u-dm' ? 'The DM' : undefined));
    expect(s.memberBoards).toEqual([
      { boardId: 'member-board', dmName: 'The DM', ownedItems: 1 },
    ]);
    expect(s.ownedItemsOnOtherBoards).toBe(1);
  });

  it('ignores boards the user is not a member of', () => {
    const s = summarizeDeletion('u-me', boards, () => undefined);
    expect(s.memberBoards.map((b) => b.boardId)).not.toContain('not-mine');
  });

  it('produces an empty summary for a user with no memberships', () => {
    const s: DeletionSummary = summarizeDeletion('u-ghost', boards, () => undefined);
    expect(s).toEqual({ dmBoards: [], memberBoards: [], ownedItemsOnOtherBoards: 0 });
  });

  it('counts owned items across tabs', () => {
    const tabs: BoardTab[] = [
      makeTab({
        items: [
          {
            id: 'mine-1', type: 'note', x: 0, y: 0, width: 1, height: 1, title: 'T', content: '', date: '', color: '', tags: [], visibility: 'all', ownerId: 'u-me', comments: [],
          },
        ],
      }),
      makeTab({
        items: [
          {
            id: 'mine-2', type: 'note', x: 0, y: 0, width: 1, height: 1, title: 'U', content: '', date: '', color: '', tags: [], visibility: 'all', ownerId: 'u-me', comments: [],
          },
        ],
      }),
    ];
    const s = summarizeDeletion('u-me', [makeBoard('m', { 'u-me': { role: 'player' }, 'u-dm': { role: 'dm' } }, tabs)], () => undefined);
    expect(s.memberBoards[0].ownedItems).toBe(2);
    expect(s.ownedItemsOnOtherBoards).toBe(2);
  });
});

// ─── findBlockingBoards ──────────────────────────────────────────────────────

describe('findBlockingBoards', () => {
  const dmBoards = [
    { boardId: 'solo', memberCount: 1, otherMembers: 0, hasOthers: false },
    { boardId: 'group-a', memberCount: 3, otherMembers: 2, hasOthers: true },
    { boardId: 'group-b', memberCount: 2, otherMembers: 1, hasOthers: true },
  ];

  it('flags unchecked boards with other members', () => {
    expect(findBlockingBoards(dmBoards, []).map((b) => b.boardId)).toEqual(['group-a', 'group-b']);
  });

  it('clears boards that are opted into deletion', () => {
    expect(findBlockingBoards(dmBoards, ['group-b']).map((b) => b.boardId)).toEqual(['group-a']);
  });

  it('never blocks solo boards', () => {
    expect(findBlockingBoards(dmBoards, []).map((b) => b.boardId)).not.toContain('solo');
  });
});

// ─── intersectMemberBoards (IDOR guard) ──────────────────────────────────────

describe('intersectMemberBoards', () => {
  const memberships = [
    { id: 'my-board' },
    { id: 'my-solo-board' },
  ];

  it('keeps only ids the caller is a member of', () => {
    expect(intersectMemberBoards(['my-board', 'victim-board', 'my-solo-board'], memberships)).toEqual([
      'my-board',
      'my-solo-board',
    ]);
  });

  it('returns an empty list when nothing is owned', () => {
    expect(intersectMemberBoards(['victim-board', 'other-board'], memberships)).toEqual([]);
    expect(intersectMemberBoards([], memberships)).toEqual([]);
  });

  it('ignores duplicate and malformed ids', () => {
    expect(intersectMemberBoards(['my-board', 'my-board', 'my-solo-board'], memberships)).toEqual([
      'my-board',
      'my-solo-board',
    ]);
  });
});
