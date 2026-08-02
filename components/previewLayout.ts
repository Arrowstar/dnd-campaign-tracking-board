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
  return { ...layout, columns };
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
