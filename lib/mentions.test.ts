import { describe, it, expect } from 'vitest';
import {
  extractMentions,
  mentionsInComments,
  highlightMentions,
  diffComments,
  planMentionNotifications,
  normalizeUsername,
} from './mentions';
import { BoardTab, Comment } from './types';

const V = ['bob', 'alice', 'jo smith', 'dnd_dm-1'];

describe('extractMentions', () => {
  it('extracts a plain mention at start, middle, and end of text', () => {
    expect(extractMentions('@bob please review this', V)).toEqual(['bob']);
    expect(extractMentions('hey @alice', V)).toEqual(['alice']);
    expect(extractMentions('thanks @bob', V)).toEqual(['bob']);
  });

  it('matches case-insensitively and returns the canonical username', () => {
    expect(extractMentions('Go see @BOB and @Alice', V)).toEqual(['bob', 'alice']);
  });

  it('handles punctuation boundaries', () => {
    expect(extractMentions('@bob, check this. @alice!', V)).toEqual(['bob', 'alice']);
    expect(extractMentions('(@bob) [@alice]', V)).toEqual(['bob', 'alice']);
    expect(extractMentions('“@bob” said', V)).toEqual(['bob']);
  });

  it('extracts multiple mentions in one comment', () => {
    expect(extractMentions('@bob and @alice are both mentioned', V)).toEqual(['bob', 'alice']);
  });

  it('ignores trailing space and empty mentions', () => {
    expect(extractMentions('@ bob', V)).toEqual([]);
    expect(extractMentions('@', V)).toEqual([]);
  });

  it('excludes @ mid-word (email addresses)', () => {
    expect(extractMentions('mail me at bob@example.com', V)).toEqual([]);
    expect(extractMentions('x@y @bob', V)).toEqual(['bob']);
  });

  it('excludes @@ link tokens', () => {
    expect(extractMentions('see @@MULTILINK:quest-1', V)).toEqual([]);
  });

  it('matches multi-word usernames as a single mention', () => {
    expect(extractMentions('ask @jo smith about the map', V)).toEqual(['jo smith']);
  });

  it('falls back to the shortest member when a multi-word name is not exact', () => {
    // "@jo smith" with only "jo" in the vocabulary pings "jo" (boundary semantics).
    expect(extractMentions('ask @jo smith about it', ['jo'])).toEqual(['jo']);
  });

  it('does not match a member name that is only a prefix of a longer word', () => {
    expect(extractMentions('see @joe over there', V)).toEqual([]);
  });

  it('returns nothing for non-member mentions when vocabulary is given', () => {
    expect(extractMentions('ping @stranger', V)).toEqual([]);
  });

  it('dedupes repeated mentions of the same user', () => {
    expect(extractMentions('@bob @bob @bob', V)).toEqual(['bob']);
  });

  it('without a vocabulary, extracts generic tokens cut at the first space', () => {
    expect(extractMentions('@bob and @stranger here')).toEqual(['bob', 'stranger']);
    expect(extractMentions('@jo smith')).toEqual(['jo']);
  });

  it('skips mentions that touch letters (mid-word @ only excluded, not trailing)', () => {
    expect(extractMentions('@bob,', V)).toEqual(['bob']);
  });
});

describe('normalizeUsername', () => {
  it('trims and lowercases, mirroring the register route', () => {
    expect(normalizeUsername('  Jo Smith ')).toBe('jo smith');
    expect(normalizeUsername('ALICE')).toBe('alice');
  });
});

describe('mentionsInComments', () => {
  const comments: Pick<Comment, 'text'>[] = [
    { text: '<p>Hey <strong>@alice</strong>, look</p>' },
    { text: 'no mentions here' },
    { text: '@bob also' },
  ];
  it('strips HTML and unions mentions across comments', () => {
    expect(mentionsInComments(comments, V)).toEqual(['alice', 'bob']);
  });
});

describe('highlightMentions', () => {
  it('wraps valid mentions in a pill span, leaves non-members plain', () => {
    const html = '<p>Hi @bob and @stranger, check @alice out</p>';
    expect(highlightMentions(html, V)).toBe(
      '<p>Hi <span class="mention-pill">@bob</span> and @stranger, check <span class="mention-pill">@alice</span> out</p>'
    );
  });

  it('never touches tag attributes or URLs', () => {
    const html = '<a href="http://x.test/@bob?q=@alice">@bob</a>';
    expect(highlightMentions(html, V)).toBe(
      '<a href="http://x.test/@bob?q=@alice"><span class="mention-pill">@bob</span></a>'
    );
  });

  it('returns the input unchanged for empty html or empty vocabulary', () => {
    expect(highlightMentions('', V)).toBe('');
    expect(highlightMentions('<p>@bob</p>', [])).toBe('<p>@bob</p>');
  });
});

function makeTab(items: { id: string; comments?: Comment[] }[]): BoardTab {
  return {
    id: 'tab-1',
    name: 'T',
    color: '#000',
    items: items.map(i => ({
      id: i.id,
      type: 'note' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      title: '',
      content: '',
      date: '',
      color: '#fff',
      tags: [],
      visibility: 'all' as const,
      ownerId: 'o',
      comments: i.comments || [],
    })),
    connections: [],
  };
}

describe('diffComments', () => {
  const c1: Comment = { id: 'c1', userId: 'u1', userName: 'A', text: '', timestamp: '' };
  const c2: Comment = { id: 'c2', userId: 'u2', userName: 'B', text: '', timestamp: '' };
  const c3: Comment = { id: 'c3', userId: 'u1', userName: 'A', text: '', timestamp: '' };

  it('finds new and removed comments across tabs', () => {
    const stored = makeTab([{ id: 'i1', comments: [c1] }, { id: 'i2', comments: [c2] }]);
    const merged = makeTab([{ id: 'i1', comments: [c1, c3] }, { id: 'i2', comments: [] }]);
    const { newComments, removedCommentIds } = diffComments([stored], [merged]);
    expect(newComments).toEqual([{ itemId: 'i1', comment: c3 }]);
    expect(removedCommentIds).toEqual(['c2']);
  });

  it('is a no-op for identical state', () => {
    const stored = makeTab([{ id: 'i1', comments: [c1] }]);
    const { newComments, removedCommentIds } = diffComments([stored], [stored]);
    expect(newComments).toEqual([]);
    expect(removedCommentIds).toEqual([]);
  });
});

describe('planMentionNotifications', () => {
  const members = { bob: 'u-bob', alice: 'u-alice', 'jo smith': 'u-jo' };

  it('creates one row per (mentionee, comment), skipping the author', () => {
    const comment: Comment = { id: 'c1', userId: 'u-alice', userName: 'A', text: '@bob and @alice and @jo smith', timestamp: '' };
    const rows = planMentionNotifications('board', members, [{ itemId: 'i1', comment }]);
    expect(rows).toEqual([
      { userId: 'u-bob', boardId: 'board', itemId: 'i1', commentId: 'c1' },
      { userId: 'u-jo', boardId: 'board', itemId: 'i1', commentId: 'c1' },
    ]);
  });

  it('skips comments with no member mentions', () => {
    const comment: Comment = { id: 'c1', userId: 'u-bob', userName: 'B', text: '@stranger hi', timestamp: '' };
    expect(planMentionNotifications('board', members, [{ itemId: 'i1', comment }])).toEqual([]);
  });

  it('caps notifications at 5 per comment', () => {
    const many = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map(u => [u, `u-${u}`]));
    const comment: Comment = { id: 'c1', userId: 'u-z', userName: 'Z', text: '@a @b @c @d @e @f', timestamp: '' };
    const rows = planMentionNotifications('board', many, [{ itemId: 'i1', comment }]);
    expect(rows).toHaveLength(5);
  });

  it('treats null-author (imported) comments as mentionable', () => {
    const comment: Comment = { id: 'c1', userId: null, userName: 'A', text: '@bob', timestamp: '' };
    expect(planMentionNotifications('board', members, [{ itemId: 'i1', comment }])).toHaveLength(1);
  });
});
