/**
 * crossref.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Utilities for encoding/decoding cross-reference links in structured
 * sub-field values.
 *
 * A field value is a JSON-encoded array of "tokens", where each token is either:
 *   - A plain text string: "Lord Nezznar"
 *   - A link object:       { id: "...", title: "...", type: "npc" }
 *
 * The whole array is stored as:
 *   @@MULTILINK:[{"type":"text","value":"Some text"},{"type":"link","id":"...","title":"...","itemType":"npc"}]
 *
 * Legacy values (plain strings, old @@LINK: format) are handled gracefully.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { BoardTab, ItemType } from './types';

export const MULTILINK_PREFIX = '@@MULTILINK:';
export const LEGACY_LINK_PREFIX = '@@LINK:';

// ─────────────────────────────────────────────────────────────────────────────
// Token types
// ─────────────────────────────────────────────────────────────────────────────

export interface TextToken {
  type: 'text';
  value: string;
}

export interface LinkToken {
  type: 'link';
  id: string;
  title: string;
  itemType: ItemType;
}

export type FieldToken = TextToken | LinkToken;

// ─────────────────────────────────────────────────────────────────────────────
// Detect
// ─────────────────────────────────────────────────────────────────────────────

export function isMultiLinkValue(value: string): boolean {
  return typeof value === 'string' && value.startsWith(MULTILINK_PREFIX);
}

export function isLegacyLinkValue(value: string): boolean {
  return typeof value === 'string' && value.startsWith(LEGACY_LINK_PREFIX);
}

export function hasAnyLinks(value: string): boolean {
  if (isMultiLinkValue(value)) {
    const tokens = parseTokens(value);
    return tokens.some((t) => t.type === 'link');
  }
  return isLegacyLinkValue(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a stored field value into an array of tokens.
 * Handles:
 *  - New multi-link format (@@MULTILINK:[...])
 *  - Legacy single-link format (@@LINK:{...})
 *  - Plain text (single text token)
 */
export function parseTokens(value: string): FieldToken[] {
  if (!value) return [{ type: 'text', value: '' }];

  if (isMultiLinkValue(value)) {
    try {
      const raw = value.slice(MULTILINK_PREFIX.length);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as FieldToken[];
      }
    } catch {
      // fall through to plain text
    }
    return [{ type: 'text', value }];
  }

  if (isLegacyLinkValue(value)) {
    try {
      const raw = value.slice(LEGACY_LINK_PREFIX.length);
      const ref = JSON.parse(raw) as { id: string; title: string; type: ItemType };
      return [{ type: 'link', id: ref.id, title: ref.title, itemType: ref.type }];
    } catch {
      return [{ type: 'text', value }];
    }
  }

  return [{ type: 'text', value }];
}

// ─────────────────────────────────────────────────────────────────────────────
// Encode
// ─────────────────────────────────────────────────────────────────────────────

export function encodeTokens(tokens: FieldToken[]): string {
  // If there's only a single text token and no links, store as plain string
  if (tokens.length === 0) return '';
  if (tokens.length === 1 && tokens[0].type === 'text') {
    return tokens[0].value;
  }
  return MULTILINK_PREFIX + JSON.stringify(tokens);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a plain-text display string for a stored value (for titles, placeholders etc.)
 */
export function getPlainText(value: string): string {
  if (!value) return '';
  const tokens = parseTokens(value);
  return tokens
    .map((t) => (t.type === 'text' ? t.value : t.title))
    .filter((s) => Boolean(s && s.trim()))
    .join(', ');
}

/**
 * Returns true if the tokens have meaningful content (non-empty text or any links).
 */
export function hasContent(tokens: FieldToken[]): boolean {
  return tokens.some((t) => {
    if (t.type === 'text') return t.value.trim().length > 0;
    return true; // links always count
  });
}

/**
 * Add a link token to an existing value, returning a new encoded string.
 */
export function addLinkToValue(
  existing: string,
  ref: { id: string; title: string; itemType: ItemType }
): string {
  const tokens = parseTokens(existing);
  // Remove empty trailing text token if present
  const cleaned = tokens.filter(
    (t) => !(t.type === 'text' && t.value.trim() === '')
  );
  const newToken: LinkToken = { type: 'link', id: ref.id, title: ref.title, itemType: ref.itemType };
  return encodeTokens([...cleaned, newToken]);
}

/**
 * Remove a link token (by id) from an existing value.
 */
export function removeLinkFromValue(existing: string, id: string): string {
  const tokens = parseTokens(existing);
  const filtered = tokens.filter((t) => !(t.type === 'link' && t.id === id));
  // If now empty, return empty string
  if (filtered.length === 0) return '';
  // If the only remaining token is an empty text token, return ''
  if (filtered.length === 1 && filtered[0].type === 'text' && filtered[0].value.trim() === '') return '';
  return encodeTokens(filtered);
}

/**
 * Update the text portion of a value (preserves existing link tokens, replaces/sets text token).
 * Puts the text token at the start.
 */
export function setTextInValue(existing: string, text: string): string {
  const tokens = parseTokens(existing);
  // Separate existing links from text tokens
  const links = tokens.filter((t) => t.type === 'link') as LinkToken[];
  if (links.length === 0) {
    // No links — just return plain text
    return text;
  }
  const newTokens: FieldToken[] = text.trim()
    ? [{ type: 'text', value: text }, ...links]
    : [...links];
  return encodeTokens(newTokens);
}

// ─────────────────────────────────────────────────────────────────────────────
// Title sync
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update the stored title snapshot of every link token whose id appears in
 * `titleById` so the link reflects the referenced item's current title.
 * Returns the value unchanged when it holds no links or nothing changed.
 */
export function retitleLinksInValue(value: string, titleById: Map<string, string>): string {
  if (!value || (!isMultiLinkValue(value) && !isLegacyLinkValue(value))) return value;
  const tokens = parseTokens(value);
  let changed = false;
  const updated = tokens.map((t) => {
    if (t.type !== 'link') return t;
    const current = titleById.get(t.id);
    if (current === undefined || current === t.title) return t;
    changed = true;
    return { ...t, title: current };
  });
  return changed ? encodeTokens(updated) : value;
}

/**
 * Rewrites link-token title snapshots across the whole board so every
 * cross-reference reflects the linked item's current title.
 */
export function syncLinkTitles(tabs: BoardTab[]): BoardTab[] {
  const titleById = new Map<string, string>();
  for (const tab of tabs) {
    for (const item of tab.items || []) titleById.set(item.id, item.title);
  }
  return tabs.map((tab) => ({
    ...tab,
    items: (tab.items || []).map((item) => {
      const fields = (item.fields || []).map((f) =>
        f.textValue !== undefined
          ? { ...f, textValue: retitleLinksInValue(f.textValue, titleById) }
          : f
      );
      return { ...item, fields };
    }),
  }));
}
