/**
 * search.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Client-side search index for Global Search (Feature 01). Pure functions:
 * build an index once per board state, then query it.
 *
 * Visibility rules mirror the render path (Board.tsx item filter) and the
 * server-side scrub (fieldVisibility.ts), so search can never surface content
 * the viewer could not see by browsing the board normally. Field content the
 * viewer cannot view is never indexed — only the field label remains findable.
 */

import { BoardItem, Comment, ItemType, User } from './types';
import { canViewField, Viewer } from './fieldVisibility';
import { getPlainText } from './crossref';

export const SEARCH_RESULT_CAP = 50;

/** Deterministic tiebreak order for equal scores. */
export const TYPE_ORDER: ItemType[] = [
  'character',
  'npc',
  'faction',
  'event',
  'location',
  'session',
  'quest',
  'note',
  'rule',
  'loot',
  'downtime',
  'image',
];

export type MatchKind = 'title' | 'tag' | 'fieldLabel' | 'fieldContent' | 'comment' | 'owner';

export interface SearchSegment {
  kind: MatchKind;
  text: string;
  /** True when the segment came from dm-scoped content (field visibility 'dm'
   *  or a dm-visibility item) — surfaced as a lock/diamond marker. */
  hidden: boolean;
  /** Field label for field segments (snippet prefix). */
  label?: string;
  /** Field id for field segments (viewer-content gating in the build step). */
  fieldId?: string;
}

export interface SearchEntry {
  item: BoardItem;
  tabId: string;
  segments: SearchSegment[];
}

export interface SearchFilters {
  /** Item types to include; empty = all. */
  types: ItemType[];
  /** Include comment text/author segments. */
  includeComments: boolean;
  /** Include dm-scoped segments (DM toggle; players never pass hidden content). */
  includeHidden: boolean;
}

export interface SearchResult {
  itemId: string;
  tabId: string;
  title: string;
  type: ItemType;
  score: number;
  kind: MatchKind;
  /** Best-matching field label (snippet prefix) when the match is a field. */
  fieldLabel?: string;
  /** One-line preview of the best-matching segment. */
  snippet: string;
  /** Best match came from dm-scoped content. */
  hidden: boolean;
  /** Best match came from a tag. */
  tagMatch: boolean;
  /** Best match came from a comment. */
  commentMatch: boolean;
}

const KIND_SCORES: Record<MatchKind, number> = {
  title: 10,
  tag: 6,
  fieldLabel: 4,
  fieldContent: 3,
  owner: 3,
  comment: 1,
};

const FIELD_KINDS: MatchKind[] = ['fieldLabel', 'fieldContent'];

/** Strip HTML tags/entities to plain text (rich text is stored as Tiptap HTML). */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function flattenFieldText(value: string): string {
  if (!value) return '';
  // Direct token lists (or plain text) — getPlainText already flattens them.
  if (value.startsWith('@@MULTILINK:') || value.startsWith('@@LINK:')) {
    return getPlainText(value);
  }
  // Structured fields store a JSON object whose string sub-values are token
  // lists (see syncLinkTitles in crossref.ts).
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.values(parsed)
        .filter((v): v is string => typeof v === 'string')
        .map((v) => getPlainText(v))
        .filter(Boolean)
        .join(' ');
    }
  } catch {
    // Not structured — fall through to plain-text handling.
  }
  return getPlainText(value);
}

function commentSegments(comments: Comment[], hidden: boolean): SearchSegment[] {
  return comments.flatMap((c) => {
    const segs: SearchSegment[] = [];
    if (c.text && c.text.trim()) segs.push({ kind: 'comment', text: c.text, hidden });
    if (c.userName && c.userName.trim()) segs.push({ kind: 'comment', text: c.userName, hidden });
    return segs;
  });
}

/** Item-level visibility filter — mirrors the Board.tsx render path. */
export function canViewItem(item: BoardItem, viewer: Viewer): boolean {
  if (item.visibility === 'dm' && viewer.role !== 'dm' && item.ownerId !== viewer.id) return false;
  if (item.visibility === 'owner' && item.ownerId !== viewer.id) return false;
  return true;
}

/**
 * Build the searchable segments for one item, applying visibility rules.
 * Item content is never indexed for image-type items (it holds a URL).
 */
export function extractSegments(item: BoardItem, includeComments: boolean): SearchSegment[] {
  const hidden = item.visibility === 'dm';
  const segments: SearchSegment[] = [];

  if (item.title) segments.push({ kind: 'title', text: item.title, hidden });

  for (const tag of item.tags || []) {
    if (!tag) continue;
    // Index both the bare token and the #tag form.
    segments.push({ kind: 'tag', text: tag, hidden });
    segments.push({ kind: 'tag', text: `#${tag}`, hidden });
  }

  if (item.content && item.type !== 'image') {
    const text = stripHtml(item.content);
    if (text) segments.push({ kind: 'fieldContent', text, hidden });
  }

  for (const field of item.fields || []) {
    const fieldHidden = field.visibility === 'dm';
    if (field.label) {
      segments.push({ kind: 'fieldLabel', text: field.label, hidden: fieldHidden, label: field.label, fieldId: field.id });
    }
    if (field.textValue !== undefined) {
      const text = stripHtml(flattenFieldText(field.textValue));
      if (text) {
        segments.push({ kind: 'fieldContent', text, hidden: fieldHidden, label: field.label, fieldId: field.id });
      }
    }
  }

  if (includeComments) {
    segments.push(...commentSegments(item.comments || [], hidden));
  }

  if (item.ownerName) segments.push({ kind: 'owner', text: item.ownerName, hidden });

  return segments;
}

export interface IndexItem {
  item: BoardItem;
  tabId: string;
}

export interface BuildIndexOptions {
  viewer: Viewer;
  includeComments?: boolean;
  includeHidden?: boolean;
}

/**
 * Build a search index over all tabs. Applies the same visibility rules the
 * render path uses: item-level dm/owner filtering, and per-field content
 * gating via canViewField (labels are always indexed; content only when
 * viewable). Segments behind dm-visibility are flagged `hidden` and only
 * included when `includeHidden` is true (the DM toggle — default on).
 */
export function buildSearchIndex(
  indexItems: IndexItem[],
  options: BuildIndexOptions
): SearchEntry[] {
  const { viewer } = options;
  const includeComments = options.includeComments ?? false;
  const includeHidden = options.includeHidden ?? true;

  const entries: SearchEntry[] = [];
  for (const { item, tabId } of indexItems) {
    if (!canViewItem(item, viewer)) continue;

    const segments: SearchSegment[] = [];
    for (const seg of extractSegments(item, includeComments)) {
      if (seg.hidden && !includeHidden) continue;
      // Content is only indexed when the viewer could see it (the server also
      // scrubs it, but this keeps search honest even on unscrubbed state).
      if (seg.kind === 'fieldContent' && seg.fieldId !== undefined) {
        const field = (item.fields || []).find((f) => f.id === seg.fieldId);
        if (field && !canViewField(field, item, viewer)) continue;
      }
      segments.push(seg);
    }
    if (segments.length > 0) {
      entries.push({ item, tabId, segments });
    }
  }
  return entries;
}

function scoreSegments(segments: SearchSegment[], query: string): { score: number; best: SearchSegment } | null {
  let best: SearchSegment | null = null;
  let bestScore = 0;
  for (const seg of segments) {
    const text = seg.text;
    if (!text) continue;
    const lower = text.toLowerCase();
    if (!lower.includes(query)) continue;
    let score = KIND_SCORES[seg.kind];
    // Token-prefix bonus: any word in the segment starts with the query.
    if (lower.split(/\s+/).some((token) => token.startsWith(query))) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = seg;
    }
  }
  return best ? { score: bestScore, best } : null;
}

function truncate(text: string, max = 60): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Rank results: score desc, then type order, then title asc. One result per
 * card, snippet from the best-matching segment. Capped at SEARCH_RESULT_CAP.
 */
export function searchIndex(index: SearchEntry[], rawQuery: string, filters?: Partial<SearchFilters>): SearchResult[] {
  const query = (rawQuery || '').trim().toLowerCase();
  if (!query) return [];
  const types = filters?.types?.length ? new Set(filters.types) : null;
  const includeComments = filters?.includeComments ?? true;
  const includeHidden = filters?.includeHidden ?? true;

  const results: SearchResult[] = [];
  for (const entry of index) {
    const { item, tabId } = entry;
    if (types && !types.has(item.type)) continue;

    const segments = entry.segments.filter((seg) => {
      if (seg.kind === 'comment' && !includeComments) return false;
      if (seg.hidden && !includeHidden) return false;
      return true;
    });
    if (segments.length === 0) continue;

    const scored = scoreSegments(segments, query);
    if (!scored) continue;
    const { score, best } = scored;

    results.push({
      itemId: item.id,
      tabId,
      title: item.title || 'Untitled',
      type: item.type,
      score,
      kind: best.kind,
      fieldLabel: FIELD_KINDS.includes(best.kind) ? best.label : undefined,
      snippet: best.kind === 'tag' ? `#${best.text.replace(/^#/, '')}` : truncate(best.text),
      hidden: best.hidden,
      tagMatch: best.kind === 'tag',
      commentMatch: best.kind === 'comment',
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const typeDiff = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
    if (typeDiff !== 0) return typeDiff;
    return a.title.localeCompare(b.title);
  });

  return results.slice(0, SEARCH_RESULT_CAP);
}

// ─────────────────────────────────────────────────────────────────────────────
// Recent items (localStorage, keyed by board + user)
// ─────────────────────────────────────────────────────────────────────────────

const RECENTS_KEY_PREFIX = 'dnd_search:recents:';
const RECENTS_MAX = 8;

export function getRecentItemIds(boardId: string, userId: string): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY_PREFIX + userId + ':' + boardId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function recordRecentItem(boardId: string, userId: string, itemId: string): void {
  try {
    const prev = getRecentItemIds(boardId, userId).filter((id) => id !== itemId);
    const next = [itemId, ...prev].slice(0, RECENTS_MAX);
    localStorage.setItem(RECENTS_KEY_PREFIX + userId + ':' + boardId, JSON.stringify(next));
  } catch {
    // Storage unavailable — recents are best-effort.
  }
}
