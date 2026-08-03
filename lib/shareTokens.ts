import { BoardSettings, BoardTab, BoardViewPayload } from './types';
import { scrubTabsForUser } from './fieldVisibility';

/**
 * Read-only share links (Feature 09).
 *
 * Token/expiry constants and pure helpers live here so the routes stay thin
 * and the scrub/filter rules are unit-testable without a database. The only
 * SQL here is none — routes query `board_shares` directly and pass rows in.
 */

export const MAX_SHARE_LINKS = 20;
export const LABEL_MAX_CHARS = 40;
export const EXPIRY_DAYS_OPTIONS = [7, 30, 90] as const;

/** Synthetic viewer for anonymous share viewers: a player who owns nothing. */
export const SHARE_VIEWER = { id: 'shared-viewer', role: 'player' } as const;

export type ShareViewer = { id: string; role: 'player' };

/** A row from the `board_shares` table (as the neon driver returns it). */
export type ShareRow = {
  token: string;
  board_id: string;
  label: string;
  created_by?: string | null;
  created_at?: string | Date | null;
  expires_at?: string | Date | null;
};

/** Whether a share row may be used right now: exists and not expired. */
export function isTokenUsable(row: ShareRow | null | undefined, now: Date = new Date()): boolean {
  if (!row) return false;
  if (!row.expires_at) return true; // NULL = never expires
  return new Date(row.expires_at).getTime() > now.getTime();
}

/** Resolve `expiresInDays` (null = never) to a timestamp, relative to `now`. */
export function expiryForDays(
  expiresInDays: number | null,
  now: Date = new Date()
): Date | null {
  if (expiresInDays === null) return null;
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() + expiresInDays);
  return d;
}

export type CreateShareInput =
  | { ok: true; label: string; expiresInDays: number | null }
  | { ok: false; error: string };

/** Validate the POST /shares body: label ≤ 40 chars, expiry in {7,30,90} or null. */
export function validateCreatePayload(body: unknown): CreateShareInput {
  const b = (body ?? {}) as { label?: unknown; expiresInDays?: unknown };

  let label = 'View link';
  if (b.label !== undefined && b.label !== null) {
    if (typeof b.label !== 'string') {
      return { ok: false, error: 'Label must be a string.' };
    }
    label = b.label.trim();
    if (label === '') label = 'View link';
    if (label.length > LABEL_MAX_CHARS) {
      return { ok: false, error: `Label must be ${LABEL_MAX_CHARS} characters or fewer.` };
    }
  }

  let expiresInDays: number | null = null;
  if (b.expiresInDays !== undefined && b.expiresInDays !== null) {
    if (typeof b.expiresInDays !== 'number' || !Number.isInteger(b.expiresInDays)) {
      return { ok: false, error: 'Expiry must be 7, 30, or 90 days, or never.' };
    }
    if (!(EXPIRY_DAYS_OPTIONS as readonly number[]).includes(b.expiresInDays)) {
      return { ok: false, error: 'Expiry must be 7, 30, or 90 days, or never.' };
    }
    expiresInDays = b.expiresInDays;
  }

  return { ok: true, label, expiresInDays };
}

/** Whether a board is under the active-link cap (enforced server-side). */
export function underShareCap(count: number): boolean {
  return count < MAX_SHARE_LINKS;
}

/**
 * Server-side item filter for the share payload: only `visibility === 'all'`
 * items pass (undefined = 'all', matching the client-side rule). Connections
 * whose endpoints were filtered out are dropped and annotation pins pointing
 * at hidden items are nulled (mirroring the delete behavior in Board.tsx) so
 * the payload never references content it doesn't ship.
 */
export function filterTabForShare(tab: BoardTab): BoardTab {
  const keptIds = new Set<string>();
  const items = (tab.items || []).filter((i) => {
    const keep = (i.visibility ?? 'all') === 'all';
    if (keep) keptIds.add(i.id);
    return keep;
  });

  const connections = (tab.connections || []).filter(
    (c) => keptIds.has(c.fromId) && keptIds.has(c.toId)
  );

  const result: BoardTab = { ...tab, items, connections };
  if (tab.annotations) {
    result.annotations = tab.annotations.map((ann) => {
      if (!ann.pins || !ann.pins.some((p) => p?.itemId && !keptIds.has(p.itemId))) return ann;
      const pins = ann.pins.map((p) => (p?.itemId && !keptIds.has(p.itemId) ? null : p));
      const remaining = pins.some(Boolean);
      return { ...ann, pins: remaining ? pins : undefined };
    });
  }
  return result;
}

/** A board row (as the neon driver returns it) suitable for buildViewPayload. */
export type ShareBoardRow = {
  id: string;
  tabs?: BoardTab[];
  settings?: BoardSettings;
  updated_at?: string | Date | null;
};

/**
 * Least-privilege payload for share viewers: items filtered to 'all' and
 * per-field content scrubbed for an anonymous player (lock shells kept).
 * Never mutates stored data.
 */
export function buildViewPayload(
  board: ShareBoardRow,
  viewer: ShareViewer = SHARE_VIEWER
): BoardViewPayload {
  const filteredTabs = (board.tabs || []).map(filterTabForShare);
  return {
    boardId: board.id,
    title: board.id, // no board-name field exists today
    updatedAt: board.updated_at ? new Date(board.updated_at).toISOString() : null,
    settings: board.settings ?? {},
    tabs: scrubTabsForUser(filteredTabs, viewer),
  };
}
