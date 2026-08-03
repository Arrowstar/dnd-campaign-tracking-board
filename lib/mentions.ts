/**
 * @mention support for comments (Feature 08).
 *
 * Mentions are PLAIN TEXT (`@username` inside the comment HTML) — there is no
 * mention token type. Everything here is either pure (unit-testable) or a thin
 * DB wrapper. Usernames follow the register validation
 * (`[a-zA-Z0-9_\- ]`, stored lowercased + trimmed), so multi-word usernames
 * ("jo smith") are real and extraction must do vocabulary-driven longest-match.
 */

import { BoardTab, Comment } from './types';
import { stripHtml } from './search';

/** Cap on how many members a single comment may notify (spam guard). */
export const MENTIONS_PER_COMMENT_CAP = 5;

const USERNAME_CHAR = /[a-zA-Z0-9_\- ]/;
const MID_WORD_CHAR = /[a-zA-Z0-9_]/;

/** Canonical form, mirroring the register route: trimmed + lowercased. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export interface MentionMatch {
  /** Normalized username (lowercased). */
  username: string;
  start: number;
  end: number;
}

/**
 * Scans plain text for `@username` tokens. An `@` counts only when preceded by
 * a non-word, non-@ character (or start of text) so `email@bob` and the
 * cross-link `@@MULTILINK` tokens are never mentions.
 *
 * When `vocabulary` is provided, each `@` position is matched against the
 * known usernames (case-insensitive), preferring the LONGEST candidate that
 * ends at a space or the run end — so `@jo smith` resolves as one mention for
 * the member "jo smith", while `@jo smith` still pings member "jo" if that is
 * the closest known name (matching the spec's boundary semantics). Non-member
 * tokens are NOT returned when a vocabulary is given.
 *
 * Without a vocabulary, tokens are cut at the first space/end (the spec's
 * lazy-boundary behavior) and returned lowercased.
 */
export function scanMentions(text: string, vocabulary?: string[]): MentionMatch[] {
  const known = (vocabulary || [])
    .map(normalizeUsername)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length); // longest first for first-prefix-wins
  const matches: MentionMatch[] = [];
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf('@', i);
    if (at === -1) break;
    const prev = at > 0 ? text[at - 1] : '';
    if (prev && (MID_WORD_CHAR.test(prev) || prev === '@')) {
      i = at + 1;
      continue;
    }
    let end = at + 1;
    while (end < text.length && USERNAME_CHAR.test(text[end])) end++;
    const run = text.slice(at + 1, end);
    if (!run) {
      i = at + 1;
      continue;
    }
    const lowerRun = run.toLowerCase();

    let matched: string | null = null;
    if (known.length > 0) {
      // Longest vocabulary prefix that ends at a token boundary (space or run
      // end) — a candidate ending mid-word ("jo" inside "joe") is not a match.
      for (const u of known) {
        if (u.length > run.length || !lowerRun.startsWith(u)) continue;
        const rest = run[u.length];
        if (rest && rest !== ' ') continue;
        matched = u;
        break;
      }
    }

    if (matched) {
      matches.push({ username: matched, start: at, end: at + 1 + matched.length });
      i = at + 1 + matched.length;
    } else if (known.length === 0) {
      // Generic token: lazy cut at the first space (doc boundary semantics).
      const token = run.split(' ')[0];
      if (token) matches.push({ username: token.toLowerCase(), start: at, end: at + 1 + token.length });
      i = at + 1 + token.length;
    } else {
      // Vocabulary provided but no member matched — not a mention.
      i = at + 1;
    }
  }
  return matches;
}

/** Unique normalized usernames mentioned in `text` (or empty). */
export function extractMentions(text: string, vocabulary?: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of scanMentions(text, vocabulary)) {
    if (seen.has(m.username)) continue;
    seen.add(m.username);
    out.push(m.username);
  }
  return out;
}

/** Every unique mention across a set of comments (HTML is stripped first). */
export function mentionsInComments(
  comments: Pick<Comment, 'text'>[],
  vocabulary?: string[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of comments) {
    for (const m of extractMentions(stripHtml(c.text || ''), vocabulary)) {
      if (seen.has(m)) continue;
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

/**
 * Wraps mentions of known members in `<span class="mention-pill">@username</span>`
 * so rendered comments highlight them in the board accent color. Works on the
 * comment's raw HTML: text is tokenized around tags so tag attributes are
 * never touched. Non-member `@words` are left as plain text.
 */
export function highlightMentions(html: string, vocabulary?: string[]): string {
  if (!html) return html;
  const known = (vocabulary || []).map(normalizeUsername).filter(Boolean);
  if (known.length === 0) return html;
  return html.replace(/<[^>]*>|[^<]+/g, (segment) => {
    if (!segment || segment.startsWith('<')) return segment;
    let out = '';
    let last = 0;
    for (const m of scanMentions(segment, known)) {
      out += segment.slice(last, m.start) + `<span class="mention-pill">@${m.username}</span>`;
      last = m.end;
    }
    return out + segment.slice(last);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-side diff + insert (used by the board state save route)
// ─────────────────────────────────────────────────────────────────────────────

export interface CommentChange {
  itemId: string;
  comment: Comment;
}

export interface CommentDiff {
  /** Comments present in `merged` but not in `stored` (may need notifications). */
  newComments: CommentChange[];
  /** Comment ids present in `stored` but not in `merged` (notifications must go). */
  removedCommentIds: string[];
}

/** Pure comment diff between stored and merged board state. */
export function diffComments(storedTabs: BoardTab[], mergedTabs: BoardTab[]): CommentDiff {
  const storedIds = new Set<string>();
  for (const tab of storedTabs) {
    for (const item of tab.items || []) {
      for (const c of item.comments || []) storedIds.add(c.id);
    }
  }
  const newComments: CommentChange[] = [];
  for (const tab of mergedTabs) {
    for (const item of tab.items || []) {
      for (const c of item.comments || []) {
        if (!storedIds.has(c.id)) newComments.push({ itemId: item.id, comment: c });
      }
    }
  }
  const mergedIds = new Set<string>();
  for (const tab of mergedTabs) {
    for (const item of tab.items || []) {
      for (const c of item.comments || []) mergedIds.add(c.id);
    }
  }
  const removedCommentIds = [...storedIds].filter(id => !mergedIds.has(id));
  return { newComments, removedCommentIds };
}

export interface MentionNotificationRow {
  userId: string;
  boardId: string;
  itemId: string;
  commentId: string;
}

/**
 * Pure planning step: which notification rows to insert for a set of new
 * comments. Self-mentions are dropped (the author is never pinged by their own
 * comment), each comment notifies at most `cap` distinct members, and rows are
 * deduped across the batch. `memberUsernameToId` keys must be normalized
 * usernames (lowercased).
 */
export function planMentionNotifications(
  boardId: string,
  memberUsernameToId: Record<string, string>,
  newComments: CommentChange[],
  cap = MENTIONS_PER_COMMENT_CAP
): MentionNotificationRow[] {
  const known = Object.keys(memberUsernameToId);
  const rows: MentionNotificationRow[] = [];
  const seen = new Set<string>();
  const perCommentCount = new Map<string, number>();
  for (const { itemId, comment } of newComments) {
    const mentions = extractMentions(stripHtml(comment.text || ''), known);
    for (const username of mentions) {
      const mentioneeId = memberUsernameToId[username];
      if (!mentioneeId) continue;
      if (comment.userId != null && mentioneeId === comment.userId) continue; // self-mention
      const key = `${mentioneeId}|${boardId}|${itemId}|${comment.id}`;
      if (seen.has(key)) continue;
      if ((perCommentCount.get(comment.id) ?? 0) >= cap) break;
      seen.add(key);
      perCommentCount.set(comment.id, (perCommentCount.get(comment.id) ?? 0) + 1);
      rows.push({ userId: mentioneeId, boardId, itemId, commentId: comment.id });
    }
  }
  return rows;
}

export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;

/**
 * Applies the notification plan: deletes rows for removed comments and
 * inserts rows for new mentions. Idempotent via the dedupe unique index
 * (re-saves of an unchanged comment never duplicate).
 */
export async function applyMentionNotifications(
  sql: Sql,
  boardId: string,
  rows: MentionNotificationRow[],
  removedCommentIds: string[]
): Promise<void> {
  if (removedCommentIds.length > 0) {
    await sql`DELETE FROM notifications WHERE board_id = ${boardId} AND comment_id = ANY(${removedCommentIds})`;
  }
  for (const row of rows) {
    await sql`
      INSERT INTO notifications (user_id, board_id, item_id, comment_id)
      VALUES (${row.userId}, ${row.boardId}, ${row.itemId}, ${row.commentId})
      ON CONFLICT (user_id, board_id, item_id, comment_id) DO NOTHING
    `;
  }
}
