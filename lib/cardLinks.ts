/**
 * cardLinks.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Rich-text card links (Feature 10): an inline reference to another board item
 * stored inside rich-text HTML as a decorated span:
 *
 *   <span data-card-id="<uuid>" data-card-type="npc" data-card-title="Zog">Zog</span>
 *
 * The span's TEXT CONTENT is the referenced item's title snapshot, so a link
 * degrades gracefully: when the target item is deleted the span is unwrapped
 * and only the text remains (the server rewrite in the state-save route is the
 * authoritative pass; the client mirrors it locally for instant UI feedback).
 *
 * All functions here are pure (unit-testable) string transformers. They are
 * regex-based on purpose — matching the highlightMentions / preview-flatten
 * conventions — and safe because card-link spans can only contain plain text
 * (the TipTap node's content spec is `text*`, so links can never nest).
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { BoardTab, ItemType } from './types';

/** A board item as shown in the `@` card-link autocomplete. */
export interface CardLinkableItem {
  id: string;
  title: string;
  itemType: ItemType;
}

/**
 * Case-insensitive substring match on title or type — the same semantics as
 * the structured-field link picker (StructuredBoardItemFields.tsx).
 */
export function filterCards(cards: CardLinkableItem[], query: string): CardLinkableItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return cards;
  return cards.filter(
    (c) => c.title.toLowerCase().includes(q) || c.itemType.toLowerCase().includes(q)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Span parsing/rewriting
// ─────────────────────────────────────────────────────────────────────────────

function getAttr(attrString: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = attrString.match(re);
  return m ? m[1] : null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Matches a single card-link span whose inner content contains NO nested
 * `<span` tag. Rewriting innermost-first and iterating keeps the transform
 * correct even for (hand-crafted) nested spans; the editor itself can never
 * produce them (`text*` content).
 */
const CARD_LINK_SPAN_SOURCE = '<span\\b([^>]*?\\bdata-card-id\\s*=\\s*["\'][^"\']*["\'][^>]*)>((?:(?!<span\\b)[\\s\\S])*?)<\\/span>';

/**
 * Applies `fn(id, itemType, title, inner, attrs)` to every card-link span in
 * the HTML. Each pass rewrites every innermost matchable span in one sweep;
 * outer spans whose inner link was rewritten become matchable in the next
 * pass (bounded by nesting depth). `fn` returns the replacement markup for
 * the whole span, or `null` to leave it untouched.
 */
function rewriteCardLinkSpans(
  html: string,
  fn: (id: string, itemType: string | null, title: string | null, inner: string, attrs: string) => string | null
): string {
  let current = html;
  for (let pass = 0; pass < 20; pass++) {
    const re = new RegExp(CARD_LINK_SPAN_SOURCE, 'gi');
    let out = '';
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(current)) !== null) {
      const id = getAttr(m[1], 'data-card-id');
      if (!id) continue;
      const replacement = fn(id, getAttr(m[1], 'data-card-type'), getAttr(m[1], 'data-card-title'), m[2], m[1]);
      if (replacement === null) continue;
      out += current.slice(last, m.index) + replacement;
      last = m.index + m[0].length;
    }
    out += current.slice(last);
    // No span was rewritten (or rewrites were no-ops) → stable.
    if (out === current) return current;
    current = out;
  }
  return current;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public transforms
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render-time pass for RichTextDisplay / BoardItem previews:
 *  - Links whose target id is in `liveIds` get the `card-link` class (the
 *    chip is styled in globals.css and clickable via event delegation on the
 *    data-card-id attribute).
 *  - Links whose target is gone are unwrapped to their plain text — the text
 *    the link was showing (deletion → text).
 * Runs AFTER sanitization, so `class`/`title` can't be stored server-side.
 */
export function decorateCardLinks(html: string, liveIds: Set<string>): string {
  return rewriteCardLinkSpans(html, (id, itemType, title, inner) => {
    if (!liveIds.has(id)) return inner;
    const typeAttr = itemType ? ` data-card-type="${escapeAttr(itemType)}"` : '';
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
    return `<span data-card-id="${escapeAttr(id)}"${typeAttr} data-card-title="${escapeAttr(title ?? '')}" class="card-link"${titleAttr}>${inner}</span>`;
  });
}

/**
 * Deletion cleanup: unwrap every card-link span whose target id is not in
 * `liveIds`, replacing the link with the text it was showing. Live links pass
 * through untouched. This is the server-side rewrite (state-save route) and is
 * also applied client-side for instant UI feedback.
 */
export function unwrapMissingCardLinks(html: string, liveIds: Set<string>): string {
  return rewriteCardLinkSpans(html, (id, _itemType, _title, inner) =>
    liveIds.has(id) ? null : inner
  );
}

/**
 * Title-snapshot sync: updates the displayed text (and data-card-title) of
 * every card-link span whose target has been renamed. `titleById` maps target
 * ids to their CURRENT titles.
 */
export function retitleCardLinksInHtml(html: string, titleById: Map<string, string>): string {
  return rewriteCardLinkSpans(html, (id, itemType, title, _inner, attrs) => {
    const current = titleById.get(id);
    if (current === undefined || current === title) return null;
    const typeAttr = itemType ? ` data-card-type="${escapeAttr(itemType)}"` : '';
    return `<span data-card-id="${escapeAttr(id)}"${typeAttr} data-card-title="${escapeAttr(current)}">${escapeHtml(current)}</span>`;
  });
}

/**
 * Export/import id remapping: points card links at the newly created items.
 * A link whose id has no mapping keeps its title but is unwrapped to plain
 * text (mirrors `remapLinksInValue`).
 */
export function remapCardLinksInHtml(html: string, idMap: Map<string, string>): string {
  const targets = new Set(idMap.values());
  return rewriteCardLinkSpans(html, (id, itemType, title, _inner) => {
    const mapped = idMap.get(id);
    if (mapped === undefined) {
      // A span we already remapped this sweep (its id is now a map VALUE)
      // would otherwise be re-matched next pass and unwrapped — leave it.
      if (targets.has(id)) return null;
      return title ?? '';
    }
    if (mapped === id) return null;
    const typeAttr = itemType ? ` data-card-type="${escapeAttr(itemType)}"` : '';
    return `<span data-card-id="${escapeAttr(mapped)}"${typeAttr} data-card-title="${escapeAttr(title ?? '')}">${escapeHtml(title ?? '')}</span>`;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Value-level transforms (direct HTML + structured-JSON shapes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies an HTML transform to a single stored value, handling both storage
 * shapes used by rich-text slots:
 *  - Direct: the whole value is rich-text HTML.
 *  - Structured: the value is a JSON object whose string sub-values are
 *    rich-text HTML (one entry per structured sub-field key) — mirroring
 *    `retitleLinksInFieldValue` in crossref.ts.
 * Values that don't contain `data-card-id` pass through untouched (fast path).
 */
function rewriteCardLinksInValue(value: string, fn: (html: string) => string): string {
  if (!value || !value.includes('data-card-id')) return value;
  try {
    const obj = JSON.parse(value) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      let changed = false;
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        next[k] = typeof v === 'string' ? fn(v) : v;
        if (next[k] !== v) changed = true;
      }
      return changed ? JSON.stringify(next) : value;
    }
  } catch {
    // Not structured — fall through to the direct-HTML path.
  }
  return fn(value);
}

function syncCardLinksInValue(value: string, liveIds: Set<string>, titleById: Map<string, string>): string {
  return rewriteCardLinksInValue(value, (html) => retitleCardLinksInHtml(unwrapMissingCardLinks(html, liveIds), titleById));
}

/**
 * Import-time id remap for a single stored rich-text slot (direct HTML or
 * structured-JSON sub-values): points card links at the newly created items,
 * unwraps links whose target has no mapping. Mirrors `remapLinksInValue`.
 */
export function remapCardLinksInValue(value: string, idMap: Map<string, string>): string {
  return rewriteCardLinksInValue(value, (html) => remapCardLinksInHtml(html, idMap));
}

/**
 * Rewrites card links across the whole board so every rich-text reference
 * reflects the board's current item set:
 *  - Deleted targets are unwrapped to the text they were showing.
 *  - Renamed targets get their title snapshot (text + data-card-title) updated.
 * Walks every rich-text slot: item.content and field text values (including
 * structured-JSON sub-values). Returns new tab objects only when something
 * changed; otherwise the same references.
 */
export function syncRichTextCardLinks(tabs: BoardTab[]): BoardTab[] {
  const liveIds = new Set<string>();
  const titleById = new Map<string, string>();
  for (const tab of tabs) {
    for (const item of tab.items || []) {
      liveIds.add(item.id);
      titleById.set(item.id, item.title);
    }
  }

  const syncItem = (item: BoardTab['items'][number]) => {
    const content = syncCardLinksInValue(item.content || '', liveIds, titleById);
    let fields = item.fields;
    let fieldsChanged = false;
    if (fields && fields.length > 0) {
      const mapped = fields.map((f) => {
        const textValue = typeof f.textValue === 'string'
          ? syncCardLinksInValue(f.textValue, liveIds, titleById)
          : f.textValue;
        if (textValue === f.textValue) return f;
        fieldsChanged = true;
        return { ...f, textValue };
      });
      if (fieldsChanged) fields = mapped;
    }
    if (content === (item.content || '') && !fieldsChanged) return item;
    return { ...item, content, fields };
  };

  return tabs.map((tab) => {
    if (!tab.items || tab.items.length === 0) return tab;
    let changed = false;
    const items = tab.items.map((item) => {
      const next = syncItem(item);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? { ...tab, items } : tab;
  });
}
