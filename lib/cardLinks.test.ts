import { describe, it, expect } from 'vitest';
import {
  filterCards,
  decorateCardLinks,
  unwrapMissingCardLinks,
  retitleCardLinksInHtml,
  remapCardLinksInHtml,
  remapCardLinksInValue,
  syncRichTextCardLinks,
  CardLinkableItem,
} from './cardLinks';
import { BoardTab } from './types';

const SPAN = (id: string, itemType = 'npc', title = 'Zog') =>
  `<span data-card-id="${id}" data-card-type="${itemType}" data-card-title="${title}">${title}</span>`;

const CARDS: CardLinkableItem[] = [
  { id: 'c1', title: 'Lord Nezznar', itemType: 'npc' },
  { id: 'c2', title: 'Wave Echo Cave', itemType: 'location' },
  { id: 'c3', title: 'Klarg', itemType: 'npc' },
];

// ─── filterCards ─────────────────────────────────────────────────────────────

describe('filterCards', () => {
  it('returns everything for an empty query', () => {
    expect(filterCards(CARDS, '')).toHaveLength(3);
    expect(filterCards(CARDS, '   ')).toHaveLength(3);
  });

  it('matches substrings on title or type, case-insensitively', () => {
    expect(filterCards(CARDS, 'nez')).toHaveLength(1);
    expect(filterCards(CARDS, 'npc')).toHaveLength(2);
    expect(filterCards(CARDS, 'CAVE')).toHaveLength(1);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterCards(CARDS, 'dragon')).toHaveLength(0);
  });
});

// ─── decorateCardLinks ───────────────────────────────────────────────────────

describe('decorateCardLinks', () => {
  it('adds the card-link class + tooltip to live links and keeps inner text', () => {
    const out = decorateCardLinks(`<p>Meet ${SPAN('c1')} soon</p>`, new Set(['c1']));
    expect(out).toBe(
      '<p>Meet <span data-card-id="c1" data-card-type="npc" data-card-title="Zog" class="card-link" title="Zog">Zog</span> soon</p>'
    );
  });

  it('unwraps links to missing items to the text they were showing', () => {
    const out = decorateCardLinks(`<p>${SPAN('ghost')} is gone</p>`, new Set(['c1']));
    expect(out).toBe('<p>Zog is gone</p>');
  });

  it('unwraps every link when the live set is empty (no item context)', () => {
    const out = decorateCardLinks(`<p>${SPAN('c1')} and ${SPAN('c2', 'location', 'Cave')}</p>`, new Set());
    expect(out).toBe('<p>Zog and Cave</p>');
  });

  it('is idempotent — re-decoration of an already-decorated span stays stable', () => {
    const once = decorateCardLinks(`<p>${SPAN('c1')}</p>`, new Set(['c1']));
    expect(decorateCardLinks(once, new Set(['c1']))).toBe(once);
  });

  it('handles nested (hand-crafted) spans innermost-first', () => {
    const nested = `<span data-card-id="outer" data-card-title="O">Outer <span data-card-id="inner" data-card-title="I">Inner</span></span>`;
    const out = decorateCardLinks(`<p>${nested}</p>`, new Set(['outer']));
    // inner is missing → unwrapped to text; outer stays a live chip
    expect(out).toBe(
      '<p><span data-card-id="outer" data-card-title="O" class="card-link" title="O">Outer Inner</span></p>'
    );
  });
});

// ─── unwrapMissingCardLinks ──────────────────────────────────────────────────

describe('unwrapMissingCardLinks', () => {
  it('leaves live links untouched and unwraps deleted targets', () => {
    const html = `<p>${SPAN('live')} / ${SPAN('dead')}</p>`;
    expect(unwrapMissingCardLinks(html, new Set(['live']))).toBe(
      '<p><span data-card-id="live" data-card-type="npc" data-card-title="Zog">Zog</span> / Zog</p>'
    );
  });

  it('returns the input unchanged when every link is live', () => {
    const html = `<p>${SPAN('a')}${SPAN('b')}</p>`;
    expect(unwrapMissingCardLinks(html, new Set(['a', 'b']))).toBe(html);
  });

  it('returns the input unchanged when there are no card links', () => {
    const html = '<p>plain <strong>text</strong></p>';
    expect(unwrapMissingCardLinks(html, new Set())).toBe(html);
  });
});

// ─── retitleCardLinksInHtml ──────────────────────────────────────────────────

describe('retitleCardLinksInHtml', () => {
  it('updates the inner text and data-card-title snapshot on rename', () => {
    const html = `<p>${SPAN('c1', 'npc', 'Old Name')}</p>`;
    const out = retitleCardLinksInHtml(html, new Map([['c1', 'New Name']]));
    expect(out).toBe('<p><span data-card-id="c1" data-card-type="npc" data-card-title="New Name">New Name</span></p>');
  });

  it('escapes HTML in renamed titles', () => {
    const html = `<p>${SPAN('c1')}</p>`;
    const out = retitleCardLinksInHtml(html, new Map([['c1', 'A <B> & "C"']]));
    expect(out).toContain('data-card-title="A &lt;B&gt; &amp; &quot;C&quot;"');
    expect(out).toContain('>A &lt;B&gt; &amp; &quot;C&quot;</span>');
  });

  it('keeps spans whose target was not renamed or is unknown', () => {
    const html = `<p>${SPAN('c1', 'npc', 'Same')}${SPAN('unknown')}</p>`;
    expect(retitleCardLinksInHtml(html, new Map([['c1', 'Same']]))).toBe(html);
  });

  it('preserves formatting marks inside the span when only the title changes elsewhere', () => {
    const html = `<p>${SPAN('c1', 'npc', 'Old')}</p>`;
    expect(retitleCardLinksInHtml(html, new Map())).toBe(html);
  });
});

// ─── remapCardLinksInHtml ────────────────────────────────────────────────────

describe('remapCardLinksInHtml', () => {
  it('points links at the remapped ids', () => {
    const html = `<p>${SPAN('old-1')}</p>`;
    const out = remapCardLinksInHtml(html, new Map([['old-1', 'new-1']]));
    expect(out).toBe('<p><span data-card-id="new-1" data-card-type="npc" data-card-title="Zog">Zog</span></p>');
  });

  it('unwraps links whose id has no mapping, keeping the text', () => {
    const html = `<p>${SPAN('orphan')}</p>`;
    expect(remapCardLinksInHtml(html, new Map([['other', 'x']]))).toBe('<p>Zog</p>');
  });

  it('leaves already-mapped links untouched', () => {
    const html = `<p>${SPAN('c1')}</p>`;
    expect(remapCardLinksInHtml(html, new Map([['c1', 'c1']]))).toBe(html);
  });
});

// ─── remapCardLinksInValue (import-time, value-level) ────────────────────────

describe('remapCardLinksInValue', () => {
  it('remaps links in direct HTML and unwraps orphans', () => {
    const value = `<p>${SPAN('old-1')} ${SPAN('orphan')}</p>`;
    const out = remapCardLinksInValue(value, new Map([['old-1', 'new-1']]));
    expect(out).toBe(
      '<p><span data-card-id="new-1" data-card-type="npc" data-card-title="Zog">Zog</span> Zog</p>'
    );
  });

  it('remaps links inside structured-JSON sub-values', () => {
    const value = JSON.stringify({ traits: `<p>${SPAN('old-1')}</p>`, plain: 'x' });
    const out = remapCardLinksInValue(value, new Map([['old-1', 'new-1']]));
    expect(out).toBe(
      JSON.stringify({
        traits: '<p><span data-card-id="new-1" data-card-type="npc" data-card-title="Zog">Zog</span></p>',
        plain: 'x',
      })
    );
  });

  it('leaves values without card links untouched (fast path)', () => {
    expect(remapCardLinksInValue('@@LINK:{"id":"item-a"}', new Map())).toBe('@@LINK:{"id":"item-a"}');
    expect(remapCardLinksInValue('', new Map())).toBe('');
  });
});

// ─── syncRichTextCardLinks ───────────────────────────────────────────────────

const makeTab = (items: BoardTab['items']): BoardTab => ({
  id: 't1',
  name: 'Tab',
  color: '#000',
  connections: [],
  items,
});

const makeItem = (partial: Partial<BoardTab['items'][number]> & { id: string; title: string }): BoardTab['items'][number] => ({
  type: 'note',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  content: '',
  date: '',
  color: '',
  tags: [],
  visibility: 'all',
  ownerId: 'u1',
  comments: [],
  ...partial,
});

describe('syncRichTextCardLinks', () => {
  it('unwraps links to deleted items and retitles links to renamed ones', () => {
    const tabs = makeTab([
      makeItem({ id: 'alive', title: 'Alive', content: `<p>${SPAN('alive', 'npc', 'Old Name')} ${SPAN('gone')}</p>` }),
    ]);
    const [out] = syncRichTextCardLinks([tabs]);
    expect(out.items[0].content).toBe(
      '<p><span data-card-id="alive" data-card-type="npc" data-card-title="Alive">Alive</span> Zog</p>'
    );
  });

  it('walks field text values, including structured-JSON sub-values', () => {
    const tabs = makeTab([
      makeItem({
        id: 'i1',
        title: 'I1',
        fields: [
          { id: 'f1', label: 'Notes', type: 'text', textValue: `<p>${SPAN('renamed', 'location', 'Old')}</p>` },
          {
            id: 'f2',
            label: 'Structured',
            type: 'text',
            textValue: JSON.stringify({ traits: `<p>${SPAN('renamed', 'location', 'Old')}</p>`, plain: 'x' }),
          },
        ],
      }),
      makeItem({ id: 'renamed', title: 'Cragmaw Castle' }),
    ]);
    const [out] = syncRichTextCardLinks([tabs]);
    const expected = `<p><span data-card-id="renamed" data-card-type="location" data-card-title="Cragmaw Castle">Cragmaw Castle</span></p>`;
    expect(out.items[0].fields![0].textValue).toBe(expected);
    expect(out.items[0].fields![1].textValue).toBe(JSON.stringify({ traits: expected, plain: 'x' }));
  });

  it('returns the same tab reference when nothing changed', () => {
    const tabs = makeTab([
      makeItem({ id: 'i1', title: 'I1', content: `<p>${SPAN('i1', 'npc', 'I1')}</p>` }),
      makeItem({ id: 'i2', title: 'I2' }),
    ]);
    const out = syncRichTextCardLinks([tabs]);
    expect(out[0]).toBe(tabs);
  });

  it('skips values without card links (fast path, no churn)', () => {
    const tabs = makeTab([makeItem({ id: 'i1', title: 'I1', content: '<p>plain text</p>' })]);
    const out = syncRichTextCardLinks([tabs]);
    expect(out[0]).toBe(tabs);
  });
});
