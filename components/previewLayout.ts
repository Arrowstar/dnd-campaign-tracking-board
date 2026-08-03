import { BoardItem, ItemField, PreviewFieldMode, PreviewFieldSlot, PreviewLayout } from '@/lib/types';
import { FieldDef } from './StructuredBoardItemFields';

// ─────────────────────────────────────────────────────────────────────────────
// Default preview fields per item type
// ─────────────────────────────────────────────────────────────────────────────

export function getDefaultPreviewFields(type: string, fieldDefs: FieldDef[] | null): string[] {
  const defaults: Record<string, string[]> = {
    character: ['char-portrait'],
    npc: ['npc-image'],            // actual ID from getDefaultNpcFields
    faction: ['faction-emblem'],
    location: ['loc-map'],
    quest: ['quest-info'],
    session: ['sess-info'],
    event: ['event-details'],
    loot: ['loot-image'],
    note: ['note-content'],
    rule: ['rule-info'],
    downtime: ['dt-details'],
    image: ['__image_content__'],  // special sentinel: renders item.content as image
  };
  return defaults[type] ?? (fieldDefs ? [fieldDefs[0]?.id].filter(Boolean) as string[] : []);
}

/** Classify a field id into the three renderable field kinds. User-added custom
 *  fields live in item.fields but not in the static FieldDef schema, so consult
 *  the runtime fields for their actual type when no def matches. */
export function classifyPreviewField(
  fieldId: string,
  itemType: string,
  fieldDefs: FieldDef[] | null,
  fields?: ItemField[] | null
): 'image' | 'text' | 'structured' {
  if (itemType === 'npc') {
    if (fieldId === 'npc-image') return 'image';
    if (fieldId === 'npc-personality-traits') return 'structured';
    const runtime = fields?.find(f => f.id === fieldId);
    if (runtime?.type === 'image') return 'image';
    return 'text';
  }
  const def = fieldDefs?.find(d => d.id === fieldId);
  if (def?.type === 'image') return 'image';
  if (def?.type === 'structured') return 'structured';
  const runtime = fields?.find(f => f.id === fieldId);
  if (runtime?.type === 'image') return 'image';
  return 'text';
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout resolution
// ─────────────────────────────────────────────────────────────────────────────

/** Build a layout from legacy previewFields (or per-type defaults). */
export function getDefaultPreviewLayout(
  type: string,
  fieldDefs: FieldDef[] | null,
  legacyPreviewFields?: string[]
): PreviewLayout {
  const ids = legacyPreviewFields ?? getDefaultPreviewFields(type, fieldDefs);
  return { columns: 1, rows: ids.map(id => ({ fieldId: id })) };
}

/** The effective layout for an item: explicit previewLayout wins, otherwise
 *  derived from legacy previewFields (or defaults). */
export function resolvePreviewLayout(
  item: Pick<BoardItem, 'previewLayout' | 'previewFields'>,
  type: string,
  fieldDefs: FieldDef[] | null
): PreviewLayout {
  if (item.previewLayout) return item.previewLayout;
  return getDefaultPreviewLayout(type, fieldDefs, item.previewFields);
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout mutations
// ─────────────────────────────────────────────────────────────────────────────

export function togglePreviewFieldInLayout(layout: PreviewLayout, fieldId: string): PreviewLayout {
  const exists = layout.rows.some(r => r.fieldId === fieldId);
  if (exists) return { ...layout, rows: layout.rows.filter(r => r.fieldId !== fieldId) };
  return { ...layout, rows: [...layout.rows, { fieldId }] };
}

export function movePreviewFieldInLayout(layout: PreviewLayout, fieldId: string, direction: -1 | 1): PreviewLayout {
  const idx = layout.rows.findIndex(r => r.fieldId === fieldId);
  if (idx < 0) return layout;
  const to = idx + direction;
  if (to < 0 || to >= layout.rows.length) return layout;
  const rows = [...layout.rows];
  [rows[idx], rows[to]] = [rows[to], rows[idx]];
  return { ...layout, rows };
}

export function updatePreviewSlot(layout: PreviewLayout, fieldId: string, patch: Partial<PreviewFieldSlot>): PreviewLayout {
  return {
    ...layout,
    rows: layout.rows.map(r => (r.fieldId === fieldId ? { ...r, ...patch } : r)),
  };
}

export function setPreviewColumns(layout: PreviewLayout, columns: PreviewLayout['columns']): PreviewLayout {
  if (columns === layout.columns) return layout;
  return { ...layout, columns, columnWidths: rebalanceColumnWidths(layout, columns) };
}

/** Reset all columns back to equal widths (removes any custom columnWidths). */
export function equalizeColumnWidths(layout: PreviewLayout): PreviewLayout {
  return { ...layout, columnWidths: undefined };
}

/** Minimum relative width of any single column, to keep all columns usable. */
export const MIN_COLUMN_FRACTION = 0.1;

const WIDTH_EPSILON = 1e-3;

/** Effective relative widths for a layout. Falls back to equal 1/N columns
 *  when columnWidths is missing, malformed, or stale (wrong length/sum). */
export function getColumnWidths(layout: Pick<PreviewLayout, 'columns' | 'columnWidths'>): number[] {
  const n = layout.columns;
  const widths = layout.columnWidths;
  if (
    n > 1 &&
    Array.isArray(widths) &&
    widths.length === n &&
    widths.every(w => Number.isFinite(w) && w > 0) &&
    Math.abs(widths.reduce((a, b) => a + b, 0) - 1) < WIDTH_EPSILON
  ) {
    return widths;
  }
  return Array.from({ length: n }, () => 1 / n);
}

/** Round a normalized width array so the values look clean and sum to exactly 1. */
function normalizeWidths(widths: number[]): number[] {
  const rounded = widths.slice(0, -1).map(w => Math.round(w * 1e6) / 1e6);
  const last = 1 - rounded.reduce((a, b) => a + b, 0);
  return [...rounded, Math.round(last * 1e6) / 1e6];
}

/** Move the boundary after column `boundary - 1` (0-based) — i.e. between
 *  columns `boundary - 1` and `boundary` — to a new cumulative fraction.
 *  Only those two adjacent columns change; every column stays at least
 *  MIN_COLUMN_FRACTION wide and the widths still sum to 1. */
export function moveColumnBoundary(layout: PreviewLayout, boundary: number, newPosition: number): PreviewLayout {
  const n = layout.columns;
  if (n < 2 || boundary < 1 || boundary >= n || !Number.isFinite(newPosition)) return layout;
  const widths = [...getColumnWidths(layout)];
  const prefix = widths.slice(0, boundary - 1).reduce((a, b) => a + b, 0);
  const suffix = widths.slice(boundary + 1).reduce((a, b) => a + b, 0);
  const min = prefix + MIN_COLUMN_FRACTION;
  const max = 1 - suffix - MIN_COLUMN_FRACTION;
  if (max <= min) return layout;
  const position = Math.min(max, Math.max(min, newPosition));
  widths[boundary - 1] = position - prefix;
  widths[boundary] = 1 - suffix - position;
  return { ...layout, columnWidths: normalizeWidths(widths) };
}

/** Map existing widths onto a new column count by interpolating the cumulative
 *  boundary positions, so the proportions are preserved as closely as the
 *  minimum-width floor allows. */
function rebalanceColumnWidths(layout: Pick<PreviewLayout, 'columns' | 'columnWidths'>, newColumns: number): number[] | undefined {
  if (newColumns < 2) return undefined;
  const old = getColumnWidths(layout);
  const cum: number[] = [];
  let acc = 0;
  for (const w of old) { acc += w; cum.push(acc); }
  // Sample the old cumulative distribution at each new boundary position.
  const boundaries: number[] = [];
  for (let j = 1; j < newColumns; j++) {
    const t = j / newColumns * acc;
    let idx = 0;
    while (idx < cum.length - 1 && cum[idx] < t) idx++;
    const lower = idx === 0 ? 0 : cum[idx - 1];
    const upper = cum[idx];
    const span = upper - lower;
    const fraction = span === 0 ? 0 : (t - lower) / span;
    const value = lower + fraction * span;
    boundaries.push(Math.min(1 - MIN_COLUMN_FRACTION * (newColumns - j), Math.max(MIN_COLUMN_FRACTION * j, value)));
  }
  // Enforce the minimum floor and renormalize so the widths still sum to 1.
  let widths = Array.from({ length: newColumns }, (_, j) =>
    j === 0 ? boundaries[0] : j === newColumns - 1 ? 1 - boundaries[j - 1] : boundaries[j] - boundaries[j - 1]
  );
  if (widths.some(w => w < MIN_COLUMN_FRACTION)) {
    widths = widths.map(w => Math.max(MIN_COLUMN_FRACTION, w));
    const total = widths.reduce((a, b) => a + b, 0);
    widths = widths.map(w => w / total);
  }
  return normalizeWidths(widths);
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering resolution
// ─────────────────────────────────────────────────────────────────────────────

/** Effective display mode for a slot, resolving 'auto' against field type. */
export function resolveFieldMode(
  slot: PreviewFieldSlot,
  fieldType: 'image' | 'text' | 'structured',
  columns: PreviewLayout['columns']
): Exclude<PreviewFieldMode, 'auto'> {
  if (slot.mode && slot.mode !== 'auto') return slot.mode;
  if (fieldType === 'image') return columns > 1 && slot.span === 1 ? 'thumb' : 'hero';
  return 'compact';
}

/** Effective grid span for a slot (1 = single column, columns = full row). */
export function resolveFieldSpan(
  slot: PreviewFieldSlot,
  fieldType: 'image' | 'text' | 'structured',
  columns: PreviewLayout['columns'],
  mode: Exclude<PreviewFieldMode, 'auto'>
): 1 | 2 | 3 | 4 {
  if (columns === 1) return 1;
  if (slot.span) return slot.span;
  if (fieldType === 'image') return mode === 'thumb' ? 1 : columns;
  if (mode === 'expanded') return columns;
  return 1;
}

/** Effective line clamp for text previews. 'expanded' = no clamp (card edge clips). */
export function resolveClampLines(slot: PreviewFieldSlot, mode: Exclude<PreviewFieldMode, 'auto'>): number | undefined {
  if (mode === 'expanded') return undefined;
  return slot.clampLines ?? 2;
}
