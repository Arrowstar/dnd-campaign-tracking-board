/**
 * tags.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Tag helpers for Feature 02. Pure functions: normalization, board-level tag
 * definition merging, and color lookup. Shared by the client editors
 * (TagEditor, FocusDrawer, BoardSettingsModal) and the server settings merge
 * (state/route.ts).
 *
 * Tag shape: lowercase, trimmed, [a-z0-9-]+, max 24 chars, max 8 per card.
 * Definitions are optional decoration stored in BoardSettings.tagDefs — a tag
 * with no def still renders (default gray).
 */

import { BoardItem, TagDef } from './types';

/** Color presets offered when creating a tag definition. */
export const TAG_COLOR_PRESETS = [
  '#E5484D', // red
  '#FF8A00', // orange
  '#F5D90A', // yellow
  '#46A758', // green
  '#3E63DD', // blue
  '#8E4EC6', // purple
  '#E93D82', // pink
  '#6E56CF', // violet
];

const TAG_PATTERN = /^[a-z0-9-]+$/;

export const MAX_TAG_LENGTH = 24;
export const MAX_TAGS_PER_ITEM = 8;

/** Normalizes a raw user-typed tag. Strips leading '#', lowercases, trims,
 *  and rejects anything outside [a-z0-9-] or over the length cap. Returns
 *  null when the input yields no valid tag. */
export function normalizeTag(raw: string): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase().replace(/^#+/, '');
  if (!t || t.length > MAX_TAG_LENGTH) return null;
  if (!TAG_PATTERN.test(t)) return null;
  return t;
}

/** Adds a normalized tag to a tag list (dedupe, cap at 8). No-op when raw is invalid. */
export function addTag(tags: string[] | undefined, raw: string): string[] {
  const t = normalizeTag(raw);
  const current = (tags || []).filter(Boolean).slice(0, MAX_TAGS_PER_ITEM);
  if (!t || current.includes(t) || current.length >= MAX_TAGS_PER_ITEM) return current;
  return [...current, t];
}

/** Merges tag-def records per-key so one client's defs can never wipe another's. */
export function mergeTagDefs(
  ...records: (Record<string, TagDef> | undefined | null)[]
): Record<string, TagDef> {
  const merged: Record<string, TagDef> = {};
  for (const record of records) {
    if (!record) continue;
    for (const [key, def] of Object.entries(record)) {
      merged[key] = { ...merged[key], ...def };
    }
  }
  return merged;
}

/** Color for a tag, or undefined when the tag has no definition. */
export function tagColor(tag: string, defs?: Record<string, TagDef>): string | undefined {
  return defs?.[tag]?.color;
}

/** Sorted union of every tag name in use on the board plus defined def names (for autocomplete). */
export function allTagNames(items: BoardItem[], defs?: Record<string, TagDef>): string[] {
  const names = new Set<string>();
  if (defs) for (const name of Object.keys(defs)) names.add(name);
  for (const item of items) for (const tag of item.tags || []) if (tag) names.add(tag);
  return [...names].sort();
}

/** Luminance-weighted lightness check for choosing dark/light text on a chip. */
export function isLightColor(hexColor: string): boolean {
  if (!hexColor) return false;
  let hex = hexColor.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length !== 6) return false;
  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;
  return (r * 299 + g * 587 + b * 114) / 1000 > 165;
}
