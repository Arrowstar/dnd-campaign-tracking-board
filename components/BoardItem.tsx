
'use client';

import { useState, useRef, useEffect, memo } from 'react';
import { motion } from 'motion/react';
import { BoardItem as BoardItemType, User, ItemField } from '@/lib/types';
import {
  Trash2, MessageSquare, Lock, Globe, Eye,
  User as UserIcon, Minimize2, Maximize2, ExternalLink, Upload,
} from 'lucide-react';
import { uploadFileToBlob } from '@/lib/utils';

import { RichTextDisplay } from './RichTextEditor';
import { parseStructured, buildDefaultFields } from './StructuredBoardItemFields';
import { FieldDef } from './StructuredBoardItemFields';
import { getDefaultPreviewFields } from './FocusDrawer';
import { getPlainText } from '@/lib/crossref';
import AnnotatedImagePreview from './AnnotatedImagePreview';

// ─────────────────────────────────────────────────────────────────────────────
// Per-type field definitions (re-exported so Board/Drawer can import them)
// ─────────────────────────────────────────────────────────────────────────────

export const CHARACTER_FIELDS: FieldDef[] = [
  { id: 'char-portrait', label: 'Character Portrait', type: 'image' },
  {
    id: 'char-stats', label: 'Stats & Info', type: 'structured',
    structuredKeys: [
      { key: 'class', label: 'Class', placeholder: 'e.g. Fighter, Wizard, Rogue...' },
      { key: 'race', label: 'Race', placeholder: 'e.g. Human, Elf, Dwarf...' },
      { key: 'level', label: 'Level', placeholder: 'e.g. 5' },
      { key: 'ac', label: 'AC', placeholder: 'e.g. 16' },
      { key: 'hp', label: 'HP (Max)', placeholder: 'e.g. 52' },
      { key: 'player', label: 'Player', placeholder: 'e.g. Adam' },
    ],
  },
  { id: 'char-backstory', label: 'Backstory', type: 'text' },
  { id: 'char-goals', label: 'Goals & Motivations', type: 'text' },
  { id: 'char-notes', label: 'Session Notes', type: 'text', isContentField: true },
  { id: 'char-files', label: 'Associated Files & Links', type: 'file' },
];

export const FACTION_FIELDS: FieldDef[] = [
  { id: 'faction-emblem', label: 'Faction Emblem / Banner', type: 'image' },
  {
    id: 'faction-overview', label: 'Overview', type: 'structured',
    structuredKeys: [
      { key: 'leader', label: 'Leader', placeholder: 'e.g. Lord Nezznar...' },
      { key: 'alignment', label: 'Alignment', placeholder: 'e.g. Lawful Evil...' },
      { key: 'base', label: 'Base of Operations', placeholder: 'e.g. Wave Echo Cave...' },
      { key: 'size', label: 'Size / Strength', placeholder: 'e.g. Large, feared across the region...' },
      { key: 'attitude', label: 'Attitude toward Party', placeholder: 'e.g. Hostile, Neutral, Friendly...' },
    ],
  },
  { id: 'faction-history', label: 'History & Lore', type: 'text' },
  {
    id: 'faction-members', label: 'Known Members', type: 'structured',
    structuredKeys: [
      { key: 'members', label: 'Members & Associates', placeholder: 'Link characters, NPCs, or type names...' },
    ],
  },
  { id: 'faction-activities', label: 'Current Activities', type: 'text', isContentField: true },
  { id: 'faction-files', label: 'Associated Files & Links', type: 'file' },
];

export const EVENT_FIELDS: FieldDef[] = [
  { id: 'event-image', label: 'Event Image', type: 'image' },
  {
    id: 'event-details', label: 'Event Details', type: 'structured',
    structuredKeys: [
      { key: 'date', label: 'Date / Time (In-Game)', placeholder: 'e.g. 3rd Mirtul, Year 1492...' },
      { key: 'location', label: 'Location', placeholder: 'e.g. Phandalin Town Square...' },
      { key: 'npcs', label: 'Key NPCs Involved', placeholder: 'e.g. Glasstaff, Sister Garaele...' },
      { key: 'outcome', label: 'Outcome', placeholder: 'e.g. Party defeated the Redbrands...' },
    ],
  },
  { id: 'event-description', label: 'Description', type: 'text', isContentField: true },
  { id: 'event-consequences', label: 'Consequences & Follow-ups', type: 'text' },
  { id: 'event-files', label: 'Associated Files & Links', type: 'file' },
];

export const LOCATION_FIELDS: FieldDef[] = [
  { id: 'loc-map', label: 'Location Map / Image', type: 'image' },
  {
    id: 'loc-glance', label: 'At a Glance', type: 'structured',
    structuredKeys: [
      { key: 'region', label: 'Region / Continent', placeholder: 'e.g. Sword Coast, Faerûn...' },
      { key: 'type', label: 'Type', placeholder: 'e.g. City, Dungeon, Wilderness...' },
      { key: 'population', label: 'Population', placeholder: 'e.g. ~500 residents...' },
      { key: 'government', label: 'Government', placeholder: 'e.g. Town Master...' },
      { key: 'feature', label: 'Notable Feature', placeholder: 'e.g. The Sleeping Giant tavern...' },
    ],
  },
  { id: 'loc-description', label: 'Description', type: 'text', isContentField: true },
  {
    id: 'loc-npcs', label: 'Key NPCs & Shops', type: 'structured',
    structuredKeys: [
      { key: 'npcs', label: 'NPCs & Merchants', placeholder: 'Link NPCs, Characters, or type names...' },
    ],
  },
  { id: 'loc-secrets', label: 'Secrets & DM Notes', type: 'text' },
  { id: 'loc-files', label: 'Associated Files & Links', type: 'file' },
];

export const SESSION_FIELDS: FieldDef[] = [
  { id: 'sess-banner', label: 'Session Banner', type: 'image' },
  {
    id: 'sess-info', label: 'Session Info', type: 'structured',
    structuredKeys: [
      { key: 'number', label: 'Session Number', placeholder: 'e.g. Session 7...' },
      { key: 'played', label: 'Date Played (Real-World)', placeholder: 'e.g. July 29, 2026...' },
      { key: 'ingame', label: 'In-Game Date', placeholder: 'e.g. 4th Mirtul, 1492 DR...' },
      { key: 'locations', label: 'Location(s)', placeholder: 'e.g. Phandalin, Tresendar Manor...' },
      { key: 'players', label: 'Players Present', placeholder: 'e.g. Adam, Beth, Carlos...' },
    ],
  },
  { id: 'sess-summary', label: 'Summary', type: 'text', isContentField: true },
  { id: 'sess-moments', label: 'Key Decisions & Turning Points', type: 'text' },
  { id: 'sess-threads', label: 'Open Threads', type: 'text' },
  { id: 'sess-files', label: 'Associated Files & Links', type: 'file' },
];

export const QUEST_FIELDS: FieldDef[] = [
  { id: 'quest-image', label: 'Quest Image', type: 'image' },
  {
    id: 'quest-info', label: 'Quest Info', type: 'structured',
    structuredKeys: [
      { key: 'giver', label: 'Quest Giver', placeholder: 'e.g. Sildar Hallwinter...' },
      { key: 'status', label: 'Status', placeholder: 'e.g. Active, Completed, Failed, On Hold...' },
      { key: 'reward', label: 'Reward', placeholder: 'e.g. 200gp, a magic item...' },
      { key: 'deadline', label: 'Deadline (In-Game)', placeholder: 'e.g. Before the next full moon...' },
      { key: 'difficulty', label: 'Difficulty', placeholder: 'e.g. CR 5 encounters, deadly...' },
    ],
  },
  { id: 'quest-objective', label: 'Objective', type: 'text', isContentField: true },
  { id: 'quest-progress', label: 'Progress & Milestones', type: 'text' },
  { id: 'quest-dm', label: 'DM Notes', type: 'text' },
  { id: 'quest-files', label: 'Associated Files & Links', type: 'file' },
];

export const NOTE_FIELDS: FieldDef[] = [
  { id: 'note-image', label: 'Note Image', type: 'image' },
  { id: 'note-content', label: 'Note Content', type: 'text', isContentField: true },
  { id: 'note-files', label: 'Associated Files & Links', type: 'file' },
];

export const RULE_FIELDS: FieldDef[] = [
  {
    id: 'rule-info', label: 'Rule Info', type: 'structured',
    structuredKeys: [
      { key: 'source', label: 'Source', placeholder: 'e.g. PHB p.195, DMG, Homebrew...' },
      { key: 'page', label: 'Page / Section', placeholder: 'e.g. Chapter 9: Combat...' },
      { key: 'category', label: 'Category', placeholder: 'e.g. Combat, Magic, Social...' },
    ],
  },
  { id: 'rule-text', label: 'Rule Text', type: 'text', isContentField: true },
  { id: 'rule-rulings', label: 'DM Interpretation & Rulings', type: 'text' },
  { id: 'rule-files', label: 'Associated Files & Links', type: 'file' },
];

export const LOOT_FIELDS: FieldDef[] = [
  { id: 'loot-image', label: 'Item Image', type: 'image' },
  {
    id: 'loot-details', label: 'Item Details', type: 'structured',
    structuredKeys: [
      { key: 'rarity', label: 'Rarity', placeholder: 'e.g. Uncommon, Rare, Legendary...' },
      { key: 'type', label: 'Type', placeholder: 'e.g. Weapon, Armor, Wondrous, Gold...' },
      { key: 'value', label: 'Value', placeholder: 'e.g. 500gp, priceless...' },
      { key: 'attunement', label: 'Attunement Required', placeholder: 'e.g. Yes (Wizard), No...' },
      { key: 'heldBy', label: 'Held By', placeholder: 'e.g. Thorin, Party Treasury...' },
    ],
  },
  { id: 'loot-description', label: 'Description & Properties', type: 'text', isContentField: true },
  { id: 'loot-history', label: 'History & Provenance', type: 'text' },
  { id: 'loot-files', label: 'Associated Files & Links', type: 'file' },
];

export const DOWNTIME_FIELDS: FieldDef[] = [
  { id: 'dt-image', label: 'Activity Image', type: 'image' },
  {
    id: 'dt-details', label: 'Activity Details', type: 'structured',
    structuredKeys: [
      { key: 'character', label: 'Character', placeholder: 'e.g. Thorin...' },
      { key: 'activityType', label: 'Activity Type', placeholder: 'e.g. Crafting, Training, Carousing...' },
      { key: 'duration', label: 'Duration', placeholder: 'e.g. 10 days...' },
      { key: 'cost', label: 'Cost', placeholder: 'e.g. 50gp...' },
      { key: 'outcome', label: 'Outcome / Roll Result', placeholder: 'e.g. Rolled 18, success...' },
    ],
  },
  { id: 'dt-description', label: 'Description', type: 'text', isContentField: true },
  { id: 'dt-dm', label: 'DM Notes', type: 'text' },
  { id: 'dt-files', label: 'Associated Files & Links', type: 'file' },
];

export const ITEM_FIELD_DEFS: Partial<Record<string, { defs: FieldDef[]; label: string }>> = {
  character: { defs: CHARACTER_FIELDS, label: 'Character' },
  faction:   { defs: FACTION_FIELDS,   label: 'Faction'   },
  event:     { defs: EVENT_FIELDS,     label: 'Event'     },
  location:  { defs: LOCATION_FIELDS,  label: 'Location'  },
  session:   { defs: SESSION_FIELDS,   label: 'Session Log' },
  quest:     { defs: QUEST_FIELDS,     label: 'Quest'     },
  note:      { defs: NOTE_FIELDS,      label: 'Note'      },
  rule:      { defs: RULE_FIELDS,      label: 'Rule'      },
  loot:      { defs: LOOT_FIELDS,      label: 'Loot'      },
  downtime:  { defs: DOWNTIME_FIELDS,  label: 'Downtime'  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isLightColor(hexColor: string): boolean {
  if (!hexColor) return false;
  let hex = hexColor.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (hex.length !== 6) return false;
  const r = parseInt(hex.substring(0, 2), 16) || 0;
  const g = parseInt(hex.substring(2, 4), 16) || 0;
  const b = parseInt(hex.substring(4, 6), 16) || 0;
  return (r * 299 + g * 587 + b * 114) / 1000 > 165;
}

/** Decode common HTML entities (the rich text editor's contentEditable HTML
 *  uses these — &nbsp; especially, for repeated spaces — so plain-text
 *  previews need to decode them or they show up as literal "&nbsp;" text). */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&nbsp;/gi, '\u00A0')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Strip HTML tags (and decode entities) for plain text preview */
function stripHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, '')).trim();
}

// Minimum card width. The header row packs a visibility icon, the title,
// a type badge, and (when editable) three control buttons — at the old
// 160px floor there often wasn't enough left-over space for the title to
// render legibly (it would get crushed to a sliver or clipped). 200px
// keeps cards compact while giving the title reliable room to breathe.
const MIN_ITEM_WIDTH = 200;

// ── Level-of-Detail thresholds (with hysteresis gaps) ────────────────────────
const TIER0_THRESHOLD = 130;  // full card
const TIER0_HYSTERESIS = 145; // expand back up only above this
const TIER1_THRESHOLD = 45;  // image-forward compact / pin boundary
const TIER1_HYSTERESIS = 55; // expand back to tier 1 only above this

function getTier(
  effW: number,
  hasImage: boolean,
  prevTier?: number
): number {
  if (prevTier === 2) {
    if (effW >= TIER0_HYSTERESIS) return 0;
    if (effW >= TIER1_HYSTERESIS) return 1;
    return 2;
  }
  if (prevTier === 1) {
    if (effW >= TIER0_THRESHOLD) return 0;
    if (effW < TIER1_THRESHOLD) return 2;
    return 1;
  }
  if (effW >= TIER0_THRESHOLD) return 0;
  if (hasImage && effW >= TIER1_THRESHOLD) return 1;
  return 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface BoardItemProps {
  item: BoardItemType;
  user: User;
  onUpdate: (item: BoardItemType) => void;
  onDelete: (id: string) => void;
  onClick: (id: string) => void;
  isSelected: boolean;
  isFocused?: boolean;
  onDragStart?: () => void;
  onDragMove?: (id: string, dx: number, dy: number) => void;
  onDragEnd?: (id: string) => void;
  dragOffset?: { x: number; y: number };
  onReportDimensions?: (id: string, width: number, height: number) => void;
  allItems?: BoardItemType[];
  onScrollToItem?: (id: string) => void;
  /** Current canvas zoom scale (decimal, e.g. 1.0 = 100%) */
  zoomScale?: number;
  /** Called when user wants to open the focus drawer for this item */
  onOpenFocus?: (id: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview renderer — renders one FieldDef visually in the compact card
// ─────────────────────────────────────────────────────────────────────────────

function PreviewField({ fieldId, item, fieldDefs, resolvedFields }: {
  fieldId: string;
  item: BoardItemType;
  fieldDefs: FieldDef[] | null;
  /** Pre-resolved fields array (may include defaults merged in) */
  resolvedFields: ItemField[];
}) {
  // ── image-type board items store their content in item.content ──
  if (item.type === 'image' && fieldId === '__image_content__') {
    if (!item.content) return null;
    return (
      <AnnotatedImagePreview
        imageUrl={item.content}
        lines={item.lines}
        alt="Image"
        imgClassName="w-full h-full object-contain pointer-events-none select-none"
      />
    );
  }

  // ── NPC: portrait is stored in field id 'npc-image' ──
  if (item.type === 'npc') {
    if (fieldId === 'npc-image') {
      const portraitField = resolvedFields.find(f => f.id === 'npc-image');
      const imageUrl = portraitField?.imageUrl;
      if (!imageUrl) return null;
      return (
        <AnnotatedImagePreview
          imageUrl={imageUrl}
          lines={portraitField?.lines}
          alt="NPC portrait"
          imgClassName="w-full h-full object-cover object-top pointer-events-none select-none"
        />
      );
    }
    // NPC personality traits (stored as JSON in npc-personality-traits field)
    if (fieldId === 'npc-personality-traits') {
      const f = resolvedFields.find(f => f.id === 'npc-personality-traits');
      if (!f?.textValue) return null;
      let entries: [string, string][] = [];
      try {
        const data = JSON.parse(f.textValue) as Record<string, string>;
        entries = Object.entries(data).filter(([, v]) => v).slice(0, 3);
      } catch {
        return null;
      }
      if (entries.length === 0) return null;
      return (
        <div className="flex flex-col gap-0.5">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-1 text-[10px] leading-tight">
              <span className="font-bold uppercase text-[#8C7B6E] opacity-80 flex-shrink-0 truncate max-w-[65%]" title={k}>{k}</span>
              <span className="truncate opacity-90 flex-1 min-w-0">{getPlainText(v)}</span>
            </div>
          ))}
        </div>
      );
    }
    // Any other NPC text field
    const npcField = resolvedFields.find(f => f.id === fieldId);
    if (npcField?.textValue) {
      const plain = stripHtml(getPlainText(npcField.textValue));
      if (!plain) return null;
      return (
        <div className="flex flex-col gap-0.5">
          <span className="font-bold uppercase text-[#8C7B6E] opacity-80 text-[9px] tracking-wide truncate" title={npcField.label}>
            {npcField.label}
          </span>
          <p className="text-[10px] leading-snug text-[#423D38]/80 line-clamp-2 italic">{plain}</p>
        </div>
      );
    }
    return null;
  }

  if (!fieldDefs) return null;
  const def = fieldDefs.find(d => d.id === fieldId);
  if (!def) return null;

  // ── Image field — show thumbnail ──
  if (def.type === 'image') {
    const field = resolvedFields.find(f => f.id === fieldId);
    const imageUrl = field?.imageUrl;
    if (!imageUrl) return null;
    return (
      <AnnotatedImagePreview
        imageUrl={imageUrl}
        lines={field?.lines}
        alt={def.label}
        imgClassName="w-full h-full object-cover object-top pointer-events-none select-none"
      />
    );
  }

  // ── Structured field — show key-value pairs ──
  if (def.type === 'structured' && def.structuredKeys) {
    const field = resolvedFields.find(f => f.id === fieldId);
    const data = parseStructured(field?.textValue);
    const entries = def.structuredKeys
      .map(sk => ({ label: sk.label, value: data[sk.key] }))
      .filter(e => e.value)
      .slice(0, 4);
    if (entries.length === 0) return null;
    return (
      <div className="flex flex-col gap-0.5">
        {entries.map(e => (
          <div key={e.label} className="flex items-baseline gap-1 text-[10px] leading-tight">
            <span className="font-bold uppercase text-[#8C7B6E] opacity-80 flex-shrink-0 truncate max-w-[65%]" title={e.label}>{e.label}</span>
            <span className="truncate opacity-90 flex-1 min-w-0">{getPlainText(e.value)}</span>
          </div>
        ))}
      </div>
    );
  }

  // ── Text field — show a label plus first 2 lines of plain text ──
  if (def.type === 'text') {
    // Always read the live value from resolvedFields — it already merges
    // saved item.fields over the item.content-seeded default, so this
    // works correctly both before and after the field has been edited.
    // (Reading item.content directly here was stale once a field existed,
    // which is why long-form/rich-text content failed to show on the canvas.)
    const rawValue = resolvedFields.find(f => f.id === fieldId)?.textValue;
    const plain = rawValue ? stripHtml(getPlainText(rawValue || '')) : '';
    if (!plain) return null;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-bold uppercase text-[#8C7B6E] opacity-80 text-[9px] tracking-wide truncate" title={def.label}>
          {def.label}
        </span>
        <p className="text-[10px] leading-snug text-[#423D38]/80 line-clamp-2 italic">
          {plain}
        </p>
      </div>
    );
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BoardItem
// ─────────────────────────────────────────────────────────────────────────────

export default memo(function BoardItem({
  item,
  user,
  onUpdate,
  onDelete,
  onClick,
  isSelected,
  isFocused,
  onDragStart,
  onDragMove,
  onDragEnd,
  dragOffset,
  onReportDimensions,
  allItems = [],
  onScrollToItem,
  zoomScale = 1,
  onOpenFocus,
}: BoardItemProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef(onReportDimensions);

  useEffect(() => { reportRef.current = onReportDimensions; }, [onReportDimensions]);
  useEffect(() => {
    if (!nodeRef.current || !reportRef.current) return;
    const el = nodeRef.current;
    const report = () => { if (el && reportRef.current) reportRef.current(item.id, el.offsetWidth, el.offsetHeight); };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [item.id, item.width, item.height, item.minimized]);

  const canEdit = item.ownerId === user.id || user.role === 'dm';
  const itemColor = item.color || '#423D38';
  const isLight = isLightColor(itemColor);
  const ownerName = item.ownerName || item.ownerId || 'Unknown';

  // Visibility icon
  const visibilityOpts = [
    { id: 'all' as const, icon: Globe, iconColor: 'text-green-500' },
    { id: 'dm' as const, icon: Eye, iconColor: 'text-purple-500' },
    { id: 'owner' as const, icon: Lock, iconColor: 'text-amber-500' },
  ];
  const currentVisOpt = visibilityOpts.find(o => o.id === item.visibility) || visibilityOpts[0];
  const CurrentIcon = currentVisOpt.icon;

  // Zoom-scaled title font: larger when zoomed out so text stays legible
  // At 100% zoom → 13px. At 50% zoom → 16px (cap). At 200% → ~10px (floor).
  // Capped at 16 (was 20) so the title text can't grow large enough to
  // starve the rest of the header row (badge/controls) of space.
  const titleFontSize = Math.min(16, Math.max(10, 13 / zoomScale));

  // Per-item LOD tier based on rendered pixel size (computed after resolvedFields)
  const prevTierRef = useRef<number>(0);
  const effW = item.width * zoomScale;
  const hasImage = item.type === 'image' || resolvedFields.some(f => f.type === 'image' && !!f.imageUrl);
  const tier = getTier(effW, hasImage, prevTierRef.current);
  prevTierRef.current = tier;

  const fieldDefs = ITEM_FIELD_DEFS[item.type]?.defs ?? null;
  const previewFieldIds = item.previewFields ?? getDefaultPreviewFields(item.type, fieldDefs);

  // Merge saved fields with defaults so images always resolve even before drawer is opened
  const resolvedFields: ItemField[] = (() => {
    if (item.type === 'npc') return item.fields || [];
    if (!fieldDefs) return item.fields || [];
    const defaults = buildDefaultFields(fieldDefs, item.content);
    const saved = item.fields || [];
    return defaults.map(def => saved.find(s => s.id === def.id) ?? def);
  })();

  // ── Drag-and-drop image onto this card ──────────────────────────────────────
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const handleCardDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (!canEdit) return;

    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      try {
        const imageUrl = await uploadFileToBlob(file);
        if (item.type === 'image') {
          onUpdate({ ...item, content: imageUrl });
        } else {
          // Update the first image-type field
          const currentFields = resolvedFields;
          const imgField = currentFields.find(f => f.type === 'image');
          if (imgField) {
            const updatedFields = currentFields.map(f =>
              f.id === imgField.id ? { ...f, imageUrl } : f
            );
            onUpdate({ ...item, fields: updatedFields });
          } else {
            // Fallback: set content for non-image typed items that have no image field
            onUpdate({ ...item, content: imageUrl });
          }
        }
      } catch (err) {
        console.error('Error dropping image onto card:', err);
      }
      return;
    }
    // Handle URL drops
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('URL');
    if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/'))) {
      if (item.type === 'image') {
        onUpdate({ ...item, content: url.trim() });
      } else {
        const currentFields = resolvedFields;
        const imgField = currentFields.find(f => f.type === 'image');
        if (imgField) {
          const updatedFields = currentFields.map(f =>
            f.id === imgField.id ? { ...f, imageUrl: url.trim() } : f
          );
          onUpdate({ ...item, fields: updatedFields });
        }
      }
    }
  };

  // Determine if this item can accept an image drop (image type or has at least one image field)
  const canAcceptImageDrop = canEdit && (
    item.type === 'image' ||
    resolvedFields.some(f => f.type === 'image')
  );

  // Resize handler
  const handleResize = (e: React.PointerEvent, direction: string) => {
    if (!canEdit) return;
    e.stopPropagation();
    if (onDragStart) onDragStart();
    const startX = e.clientX;
    const startY = e.clientY;
    const startItemX = item.x;
    const startItemY = item.y;
    const startWidth = item.width;
    const startHeight = item.height || 200;

    const onMove = (moveEvent: PointerEvent) => {
      const wrapper = document.querySelector('.react-transform-component');
      let scale = 1;
      if (wrapper) {
        const match = wrapper.getAttribute('style')?.match(/scale\(([^)]+)\)/);
        if (match && match[1]) scale = parseFloat(match[1]);
      }
      const dx = (moveEvent.clientX - startX) / scale;
      const dy = (moveEvent.clientY - startY) / scale;
      let newWidth = startWidth;
      let newHeight = startHeight;
      let newX = startItemX;
      let newY = startItemY;

      if (direction.includes('right')) newWidth = Math.max(MIN_ITEM_WIDTH, startWidth + dx);
      if (direction.includes('left')) {
        newWidth = Math.max(MIN_ITEM_WIDTH, startWidth - dx);
        if (newWidth > MIN_ITEM_WIDTH) newX = startItemX + dx;
        else newX = startItemX + startWidth - MIN_ITEM_WIDTH;
      }
      if (direction.includes('bottom')) newHeight = Math.max(80, startHeight + dy);
      if (direction.includes('top')) {
        newHeight = Math.max(80, startHeight - dy);
        if (newHeight > 80) newY = startItemY + dy;
        else newY = startItemY + startHeight - 80;
      }
      onUpdate({ ...item, x: newX, y: newY, width: newWidth, height: newHeight });
    };

    const onUp = () => {
      if (onDragEnd) onDragEnd(item.id);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  return (
    <motion.div
      id={item.id}
      ref={nodeRef}
      style={{
        position: 'absolute',
        left: `${item.x + (dragOffset?.x || 0)}px`,
        top: `${item.y + (dragOffset?.y || 0)}px`,
        width: item.width,
        height: item.minimized ? undefined : item.height,
        minHeight: item.minimized ? undefined : item.height,
        backgroundColor: isLight ? itemColor : '#FFFFFF',
        borderLeft: isFocused
          ? '2px solid #B58D3D'
          : isSelected
          ? '2px solid #B58D3D'
          : isDraggingOver
          ? '2px solid #B58D3D'
          : isLight
          ? '1px solid rgba(0,0,0,0.18)'
          : `1.5px solid ${itemColor}80`,
        borderRight: isFocused
          ? '2px solid #B58D3D'
          : isSelected
          ? '2px solid #B58D3D'
          : isDraggingOver
          ? '2px solid #B58D3D'
          : isLight
          ? '1px solid rgba(0,0,0,0.18)'
          : `1.5px solid ${itemColor}80`,
        borderBottom: isFocused
          ? '2px solid #B58D3D'
          : isSelected
          ? '2px solid #B58D3D'
          : isDraggingOver
          ? '2px solid #B58D3D'
          : isLight
          ? '1px solid rgba(0,0,0,0.18)'
          : `1.5px solid ${itemColor}80`,
        borderTop: isFocused
          ? '4px solid #B58D3D'
          : isSelected
          ? '4px solid #B58D3D'
          : isDraggingOver
          ? '4px solid #B58D3D'
          : isLight
          ? '4px solid rgba(0,0,0,0.2)'
          : `4px solid ${itemColor}`,
        borderRadius: '6px',
        color: isLight ? '#1F2937' : '#2C2824',
        zIndex: isFocused ? 15 : isSelected ? 10 : isDraggingOver ? 12 : 1,
        overflow: item.minimized ? 'hidden' : 'visible',
        boxShadow: isDraggingOver
          ? '0 0 0 3px #B58D3D66, 0 8px 32px rgba(181,141,61,0.25)'
          : isFocused
          ? '0 0 0 2px #B58D3D55, 0 8px 32px rgba(0,0,0,0.18)'
          : '0 4px 16px rgba(0,0,0,0.12)',
      }}
      className="flex flex-col nodrag transition-shadow duration-200"
      onClick={() => onClick(item.id)}
      onDragOver={(e) => {
        if (!canAcceptImageDrop) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingOver(true);
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        setIsDraggingOver(false);
      }}
      onDrop={canAcceptImageDrop ? handleCardDrop : undefined}
    >
      {/* Tier 2 — Pin / Badge */}
      {tier === 2 && (
        <div
          className="w-full h-full rounded-full flex flex-col items-center justify-center overflow-hidden shadow-lg relative"
          style={{ backgroundColor: itemColor }}
          title={`${item.title} (${item.type})`}
        >
          <span className="text-white text-[9px] font-bold uppercase tracking-wide opacity-90">{item.type}</span>
          <span className="text-white text-[7px] font-serif italic truncate px-1 text-center leading-tight">{item.title}</span>
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#F5F2ED] border border-[#B58D3D] flex items-center justify-center">
            <span className="text-[5px] font-black text-[#B58D3D]">{item.type[0]?.toUpperCase()}</span>
          </div>
        </div>
      )}

      {/* Tier 1 — Image-forward compact */}
      {tier === 1 && (
        <>
          <div className="flex-1 overflow-hidden relative">
            {(() => {
              const imgField = resolvedFields.find(f => f.type === 'image' && f.imageUrl);
              const url = imgField?.imageUrl || (item.type === 'image' ? item.content : null);
              if (url) {
                return (
                  <img src={url} alt={item.title} className="w-full h-full object-cover object-top pointer-events-none select-none" />
                );
              }
              return <div className="w-full h-full flex items-center justify-center bg-[#F5F2ED] text-[8px] font-bold text-[#8C7B6E]">{item.title}</div>;
            })()}
          </div>
          <div className="px-1.5 py-1 bg-black/10 border-t border-black/5">
            <span className="block text-[9px] font-bold font-serif italic truncate text-center" style={{ color: itemColor }}>{item.title}</span>
          </div>
        </>
      )}

      {/* Tier 0 — Full card */}
      {tier === 0 && (
        <>
      {/* ── Header / Drag Handle ── */}
      <div
        style={{
          backgroundColor: isLight ? 'rgba(0,0,0,0.04)' : `${itemColor}12`,
          borderBottom: item.minimized ? 'none' : isLight ? '1px solid rgba(0,0,0,0.1)' : `1px solid ${itemColor}30`,
        }}
        className={`flex items-center justify-between px-2 py-1.5 rounded-t-[5px] select-none gap-1 overflow-hidden ${canEdit ? 'cursor-move' : ''}`}
        onPointerDown={(e) => {
          if (!canEdit) return;
          const target = e.target as HTMLElement;
          if (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.tagName === 'TEXTAREA' ||
            target.closest('input, button, textarea, a, select, [data-no-drag]')) return;
          e.stopPropagation();
          const handleEl = e.currentTarget;
          try { handleEl.setPointerCapture(e.pointerId); } catch { /* noop */ }

          const startPointerX = e.clientX;
          const startPointerY = e.clientY;
          const scale = (() => {
            const w = document.querySelector('.react-transform-component');
            if (w) {
              const m = w.getAttribute('style')?.match(/scale\(([^)]+)\)/);
              if (m && m[1]) return parseFloat(m[1]);
            }
            return 1;
          })();
          let currentDx = 0, currentDy = 0;
          onDragStart?.();

          const handlePointerMove = (mv: PointerEvent) => {
            currentDx = (mv.clientX - startPointerX) / scale;
            currentDy = (mv.clientY - startPointerY) / scale;
            onDragMove?.(item.id, currentDx, currentDy);
          };
          const handlePointerUp = (up: PointerEvent) => {
            try { handleEl.releasePointerCapture(up.pointerId); } catch { /* noop */ }
            handleEl.removeEventListener('pointermove', handlePointerMove);
            handleEl.removeEventListener('pointerup', handlePointerUp);
            handleEl.removeEventListener('pointercancel', handlePointerUp);
            if (currentDx !== 0 || currentDy !== 0) {
              onUpdate({ ...item, x: item.x + currentDx, y: item.y + currentDy });
            }
            onDragEnd?.(item.id);
          };
          handleEl.addEventListener('pointermove', handlePointerMove);
          handleEl.addEventListener('pointerup', handlePointerUp);
          handleEl.addEventListener('pointercancel', handlePointerUp);
        }}
      >
        {/* Visibility icon */}
        <CurrentIcon size={12} className={`flex-shrink-0 ${currentVisOpt.iconColor} opacity-80`} />

        {/* Title — zoom-scaled */}
        <span
          style={{
            fontSize: titleFontSize,
            color: isLight ? '#1F2937' : itemColor,
            lineHeight: 1.2,
          }}
          className="font-bold font-serif italic truncate flex-1 min-w-0 mx-1 select-none"
          title={item.title}
        >
          {item.title || 'Untitled'}
        </span>

        {/* Type badge */}
        <span
          style={isLight ? { backgroundColor: 'rgba(0,0,0,0.1)', color: '#374151' } : { backgroundColor: itemColor, color: '#FFFFFF' }}
          className="text-[9px] font-bold uppercase tracking-wider flex-shrink-0 px-1 py-0.5 rounded truncate max-w-[64px]"
          title={item.type}
        >
          {item.type}
        </span>

        {/* Controls */}
        {canEdit && (
          <div
            className="flex items-center gap-0.5 flex-shrink-0"
            onPointerDown={e => e.stopPropagation()}
            onPointerDownCapture={e => e.stopPropagation()}
          >
            {/* Minimize toggle: show/hide preview fields */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onUpdate({ ...item, minimized: !item.minimized }); }}
              className={`p-0.5 rounded transition-colors cursor-pointer ${
                item.minimized
                  ? 'bg-[#B58D3D]/20 text-[#8C621E] hover:bg-[#B58D3D]/30'
                  : 'hover:bg-black/10 text-[#8C7B6E] hover:text-[#423D38]'
              }`}
              title={item.minimized ? 'Expand card (show preview)' : 'Minimize card (hide preview)'}
            >
              {item.minimized ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
            </button>

            {/* Open in focus drawer */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenFocus?.(item.id); }}
              className="p-0.5 rounded hover:bg-black/10 text-[#8C7B6E] hover:text-[#B58D3D] transition-colors cursor-pointer"
              title="Open in focus panel"
            >
              <ExternalLink size={12} />
            </button>

            {/* Delete */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
              className="p-0.5 rounded hover:bg-red-500/10 text-[#8C7B6E] hover:text-red-600 transition-colors cursor-pointer"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      {/* ── Preview Body — hidden when minimized ── */}
      {!item.minimized && (
        <div
          className="flex flex-col gap-1.5 p-2 flex-1 overflow-hidden cursor-pointer group relative min-h-0"
          onClick={(e) => { e.stopPropagation(); onOpenFocus?.(item.id); }}
          title="Click to open in focus panel"
          onPointerDownCapture={e => e.stopPropagation()}
        >
          {previewFieldIds.map(fid => (
            <PreviewField key={fid} fieldId={fid} item={item} fieldDefs={fieldDefs} resolvedFields={resolvedFields} />
          ))}
          {/* Subtle hover gradient */}
          <div className="absolute inset-0 rounded-[5px] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{ background: 'linear-gradient(to bottom, transparent 60%, rgba(181,141,61,0.08) 100%)' }}
          />
          {/* Drag-over overlay */}
          {isDraggingOver && (
            <div className="absolute inset-0 rounded-[5px] flex flex-col items-center justify-center gap-1 pointer-events-none z-20"
              style={{ background: 'rgba(181,141,61,0.18)', backdropFilter: 'blur(1px)' }}
            >
              <Upload size={18} className="text-[#B58D3D] drop-shadow" />
              <span className="text-[10px] font-bold text-[#6B4E17] bg-[#F5E9C8]/90 px-2 py-0.5 rounded-full shadow-sm">
                Drop image here
              </span>
            </div>
          )}
        </div>
      )}

      {/* Minimized drag-over hint strip */}
      {item.minimized && isDraggingOver && (
        <div className="flex items-center justify-center gap-1 py-1 pointer-events-none" style={{ background: 'rgba(181,141,61,0.15)' }}>
          <Upload size={11} className="text-[#B58D3D]" />
          <span className="text-[9px] font-bold text-[#6B4E17]">Drop image</span>
        </div>
      )}




      {/* ── Resize handles (only when not minimized) ── */}
      {canEdit && !item.minimized && (
        <>
          <div className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize z-20" onPointerDownCapture={(e) => handleResize(e, 'top')} />
          <div className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize z-20" onPointerDownCapture={(e) => handleResize(e, 'bottom')} />
          <div className="absolute top-0 bottom-0 left-0 w-1.5 cursor-ew-resize z-20" onPointerDownCapture={(e) => handleResize(e, 'left')} />
          <div className="absolute top-0 bottom-0 right-0 w-1.5 cursor-ew-resize z-20" onPointerDownCapture={(e) => handleResize(e, 'right')} />
          <div className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize z-30" onPointerDownCapture={(e) => handleResize(e, 'top-left')} />
          <div className="absolute top-0 right-0 w-3 h-3 cursor-nesw-resize z-30" onPointerDownCapture={(e) => handleResize(e, 'top-right')} />
          <div className="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize z-30" onPointerDownCapture={(e) => handleResize(e, 'bottom-left')} />
          <div className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end p-1 opacity-50 hover:opacity-100 z-30" onPointerDownCapture={(e) => handleResize(e, 'bottom-right')}>
            <div className="w-2 h-2 border-r-2 border-b-2 border-black/30 pointer-events-none" />
          </div>
        </>
      )}

      {/* ── Footer: owner + comments ── */}
      <div
        style={{
          backgroundColor: isLight ? 'rgba(0,0,0,0.06)' : '#F5F2ED',
          borderTop: isLight ? '1px solid rgba(0,0,0,0.1)' : '1px solid #D9D0C1',
        }}
        className="px-2 py-1 flex justify-between items-center text-[9px] text-[#8C7B6E] rounded-b-[5px] gap-1 flex-shrink-0"
      >
        <div className="flex items-center gap-1 min-w-0">
          <UserIcon size={9} className="text-[#8C7B6E] flex-shrink-0" />
          <span className="truncate max-w-[90px] font-semibold">{ownerName}</span>
        </div>
        <button
          type="button"
          className="flex items-center gap-0.5 hover:text-[#423D38] font-bold flex-shrink-0 cursor-pointer"
          onPointerDown={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation?.(); }}
          onPointerDownCapture={e => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation?.(); }}
          onClick={(e) => { e.stopPropagation(); onOpenFocus?.(item.id); }}
          title="View comments"
        >
          <MessageSquare size={10} />
          <span>{item.comments?.length || 0}</span>
        </button>
      </div>
        </>
      )}
    </motion.div>
  );
});
