/**
 * sanitize.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Allowlist-based rich-text sanitization (Security-Audit.md critical #2).
 *
 * This module is CLIENT-only (uses DOMPurify). Server routes must use
 * `lib/sanitize.server.ts`, which shares the allowlists defined here through
 * `sanitize-html`. The tag/attribute/style whitelists live here so both sides
 * stay in sync — server never stores anything the client would strip, and the
 * client re-sanitizes render-time HTML (mention pills, previews, legacy data).
 *
 * The allowlist is tuned to what the TipTap editor (RichTextEditor.tsx)
 * emits: starter-kit marks, headings, lists, blockquote, code, tables, links,
 * images, highlight, text-style color/size, and text alignment.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import DOMPurify from 'dompurify';

// The browser build exports the DOMPurify instance directly (its types also
// describe an instance). In Node the same import is a factory — this module
// must never be invoked server-side (guard below).

export const RICH_TEXT_ALLOWED_TAGS = [
  'p', 'div', 'br', 'hr',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'mark', 'sub', 'sup',
  'span', 'code', 'pre',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote',
  'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
];

export const RICH_TEXT_ALLOWED_ATTRS = [
  'style',
  // class is render-time only (mention-pill, card-link, rt-preview-*): harmless
  // cosmetics, kept so highlightMentions() / decorateCardLinks() /
  // flattenRichTextForPreview() survive.
  'class',
  'href', 'target', 'rel', 'title',
  'src', 'alt', 'width', 'height',
  'colspan', 'rowspan', 'align',
  // Feature 10 — card-link spans: the referenced item id (UUID), its type
  // (npc/location/quest/…) and the title snapshot the link displays.
  'data-card-id', 'data-card-type', 'data-card-title',
];

/**
 * URI schemes allowed in href/src. `blob:` for Vercel Blob uploads. Everything
 * else — including ALL `data:` URIs (even data:image/*, which used to bloat
 * boards with embedded base64) — is rejected by this regex.
 */
export const RICH_TEXT_ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto|tel|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/** CSS properties rich text may carry, with the values each accepts. */
export const STYLE_PROP_WHITELIST: Record<string, RegExp[]> = {
  'text-align': [/^(left|right|center|justify)$/i],
  color: [
    /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
    /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i,
    /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)$/i,
  ],
  'background-color': [
    /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
    /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i,
    /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)$/i,
  ],
  'font-size': [/^\d+(?:px|em|rem|%)$/i],
  'font-weight': [/^\d{1,4}$/, /^(bold|bolder|lighter|normal)$/i],
  'font-style': [/^(normal|italic|oblique)$/i],
  'text-decoration': [/^(?:underline|line-through|overline|none)(?:\s+(?:underline|line-through|overline|none))*$/i],
  'vertical-align': [/^(top|middle|bottom|baseline|sub|super)$/i],
  float: [/^(left|right|none)$/i],
};

/**
 * Filters a raw `style` attribute value down to the allowlisted properties
 * (used by both sanitizers — DOMPurify hook client-side, sanitize-html
 * `allowedStyles` server-side).
 */
export function filterStyleAttr(style: string): string {
  const kept: string[] = [];
  for (const part of style.split(';')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    const allowed = STYLE_PROP_WHITELIST[prop];
    if (!allowed || !allowed.some((re) => re.test(value))) continue;
    kept.push(`${prop}: ${value}`);
  }
  return kept.join('; ');
}

/** DOMPurify hook: rewrite `style` through the shared whitelist. */
export function applyAttributeWhitelist(node: Element): void {
  const style = node.getAttribute('style');
  if (style != null) {
    const filtered = filterStyleAttr(style);
    if (filtered) node.setAttribute('style', filtered);
    else node.removeAttribute('style');
  }
  // DOMPurify's DATA_URI_TAGS bypass lets ANY data: URI through on img/audio/
  // video src — strip them all; images must come from http(s)/blob URLs.
  const src = node.getAttribute('src');
  if (src != null && /^data:/i.test(src)) {
    node.removeAttribute('src');
  }
}

export const RICH_TEXT_SANITIZE_CONFIG = {
  ALLOWED_TAGS: RICH_TEXT_ALLOWED_TAGS,
  ALLOWED_ATTR: RICH_TEXT_ALLOWED_ATTRS,
  ALLOWED_URI_REGEXP: RICH_TEXT_ALLOWED_URI_REGEXP,
};

if (typeof window !== 'undefined') {
  DOMPurify.addHook('afterSanitizeAttributes', applyAttributeWhitelist);
}

/** Sanitizes rich-text HTML on the client. Server code: lib/sanitize.server.ts. */
export function sanitizeRichText(html: string): string {
  if (!html) return '';
  if (typeof window === 'undefined') {
    throw new Error('lib/sanitize.ts is client-only — use lib/sanitize.server.ts on the server.');
  }
  return DOMPurify.sanitize(html, RICH_TEXT_SANITIZE_CONFIG);
}

/**
 * Validates a user-supplied image/attachment URL. Anything that is not
 * http(s)/blob (Vercel Blob) is rejected — `data:` URIs are never accepted,
 * so embedded base64 can't be persisted into a board.
 */
export function sanitizeImageUrl(url: string): string {
  return /^(?:https?:|blob:)/i.test(url) ? url : '';
}
