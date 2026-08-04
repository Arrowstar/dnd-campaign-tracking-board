'use client';

import { useState, useRef, useEffect, memo, useMemo } from 'react';
import { motion } from 'motion/react';
import { BoardItem as BoardItemType, User, ItemField, Visibility, PreviewFieldSlot, PreviewLayout, PreviewFieldMode, TagDef } from '@/lib/types';
import { canViewField } from '@/lib/fieldVisibility';
import { tagColor } from '@/lib/tags';
import {
  Trash2, MessageSquare, Lock, Globe, Eye,
  User as UserIcon, Minimize2, Maximize2, ExternalLink, Upload,
  Image as ImageIcon, MapPin, Users, CalendarDays, FileText,
  BookOpen, Package, Clock, Crown, ScrollText, File,
} from 'lucide-react';
import { uploadFileToBlob, isFullCrop } from '@/lib/utils';
import type { CropRect } from '@/lib/types';
import UploadProgress from './UploadProgress';

import { RichTextDisplay, flattenRichTextForPreview } from './RichTextEditor';
import { parseStructured, buildDefaultFields } from './StructuredBoardItemFields';
import { FieldDef } from './StructuredBoardItemFields';
import {
  resolvePreviewLayout,
  classifyPreviewField,
  resolveFieldMode,
  resolveFieldSpan,
  resolveClampLines,
  getColumnWidths,
} from './previewLayout';
import { getPlainText } from '@/lib/crossref';
import { decorateCardLinks } from '@/lib/cardLinks';
import AnnotatedImagePreview from './AnnotatedImagePreview';

// ─────────────────────────────────────────────────────────────────────────────
// Per-type field definitions (re-exported so Board/Drawer can import them)
// ─────────────────────────────────────────────────────────────────────────────

// Preset option lists for select widgets (each also allows a custom value).
const CLASS_OPTIONS = [
  'Artificer', 'Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk',
  'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard',
];
const RACE_OPTIONS = [
  'Aasimar', 'Dragonborn', 'Dwarf', 'Elf', 'Gnome', 'Goliath', 'Half-Elf',
  'Halfling', 'Half-Orc', 'Human', 'Orc', 'Tiefling', 'Warforged',
];
const ALIGNMENT_OPTIONS = [
  'Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral',
  'True Neutral', 'Chaotic Neutral', 'Lawful Evil', 'Neutral Evil',
  'Chaotic Evil', 'Unaligned',
];
const ATTITUDE_OPTIONS = ['Hostile', 'Unfriendly', 'Neutral', 'Friendly', 'Helpful'];
const FACTION_SIZE_OPTIONS = [
  'Small Band / Clique', 'Local Organization', 'Regional Power',
  'Nationwide Influence', 'Massive Empire',
];
const LOCATION_TYPE_OPTIONS = [
  'City', 'Town', 'Village', 'Hamlet', 'Dungeon', 'Cave', 'Ruin',
  'Wilderness', 'Forest', 'Mountain', 'Coastline', 'Waterway',
  'Tavern / Inn', 'Castle / Fort', 'Temple', 'Shop / Business', 'Other Structure',
];
const QUEST_STATUS_OPTIONS = ['Active', 'On Hold', 'Completed', 'Failed', 'Abandoned'];
const QUEST_DIFFICULTY_OPTIONS = ['Trivial', 'Easy', 'Moderate', 'Hard', 'Deadly'];
const RULE_SOURCE_OPTIONS = [
  "Player's Handbook", "Dungeon Master's Guide", "Monster Manual",
  "Xanathar's Guide to Everything", "Tasha's Cauldron of Everything",
  "Mordenkainen's Tome of Foes", "Sword Coast Adventurer's Guide", 'Homebrew',
];
const RULE_CATEGORY_OPTIONS = [
  'Combat', 'Magic', 'Social', 'Exploration', 'Movement', 'Rest & Recovery',
  'Downtime', 'Equipment', 'Other',
];
const LOOT_RARITY_OPTIONS = [
  'Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact', 'Varies / None',
];
const LOOT_TYPE_OPTIONS = [
  'Weapon', 'Armor', 'Shield', 'Ring', 'Staff', 'Wand', 'Rod', 'Scroll',
  'Potion', 'Wondrous Item', 'Ammunition', 'Coins / Treasure', 'Gem / Jewelry', 'Other',
];
const ATTUNEMENT_OPTIONS = ['No', 'Yes', 'Yes (restricted)'];
const DOWNTIME_ACTIVITY_OPTIONS = [
  'Crafting', 'Training', 'Carousing', 'Scribing', 'Research', 'Gambling',
  'Practicing a Profession', 'Pit Fighting', 'Recuperating', 'Relaxing',
  'Running a Business', 'Other',
];

export const CHARACTER_FIELDS: FieldDef[] = [
  { id: 'char-portrait', label: 'Character Portrait', type: 'image' },
  {
    id: 'char-stats', label: 'Stats & Info', type: 'structured',
    structuredKeys: [
      { key: 'class', label: 'Class', placeholder: 'e.g. Fighter, Wizard, Rogue...', widget: 'select', options: CLASS_OPTIONS },
      { key: 'race', label: 'Race', placeholder: 'e.g. Human, Elf, Dwarf...', widget: 'select', options: RACE_OPTIONS },
      { key: 'level', label: 'Level', placeholder: 'e.g. 5', widget: 'number', min: 1, max: 20 },
      { key: 'ac', label: 'AC', placeholder: 'e.g. 16', widget: 'number', min: 1, max: 30 },
      { key: 'hp', label: 'HP (Max)', placeholder: 'e.g. 52', widget: 'number', min: 1 },
      { key: 'player', label: 'Player', placeholder: 'e.g. Adam', widget: 'member' },
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
      { key: 'alignment', label: 'Alignment', placeholder: 'e.g. Lawful Evil...', widget: 'select', options: ALIGNMENT_OPTIONS },
      { key: 'base', label: 'Base of Operations', placeholder: 'e.g. Wave Echo Cave...' },
      { key: 'size', label: 'Size / Strength', placeholder: 'e.g. Large, feared across the region...', widget: 'select', options: FACTION_SIZE_OPTIONS },
      { key: 'attitude', label: 'Attitude toward Party', placeholder: 'e.g. Hostile, Neutral, Friendly...', widget: 'select', options: ATTITUDE_OPTIONS },
    ],
  },
  { id: 'faction-history', label: 'History & Lore', type: 'text' },
  {
    id: 'faction-members', label: 'Known Members', type: 'structured',
    structuredKeys: [
      { key: 'members', label: 'Members & Associates', placeholder: 'Link characters, NPCs, or type names...', widget: 'link' },
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
      { key: 'location', label: 'Location', placeholder: 'e.g. Phandalin Town Square...', widget: 'link', multiple: false },
      { key: 'npcs', label: 'Key NPCs Involved', placeholder: 'e.g. Glasstaff, Sister Garaele...', widget: 'link' },
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
      { key: 'type', label: 'Type', placeholder: 'e.g. City, Dungeon, Wilderness...', widget: 'select', options: LOCATION_TYPE_OPTIONS },
      { key: 'population', label: 'Population', placeholder: 'e.g. ~500 residents...', widget: 'number', min: 0 },
      { key: 'government', label: 'Government', placeholder: 'e.g. Town Master...' },
      { key: 'feature', label: 'Notable Feature', placeholder: 'e.g. The Sleeping Giant tavern...' },
    ],
  },
  { id: 'loc-description', label: 'Description', type: 'text', isContentField: true },
  {
    id: 'loc-npcs', label: 'Key NPCs & Shops', type: 'structured',
    structuredKeys: [
      { key: 'npcs', label: 'NPCs & Merchants', placeholder: 'Link NPCs, Characters, or type names...', widget: 'link' },
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
      { key: 'number', label: 'Session Number', placeholder: 'e.g. Session 7...', widget: 'number', min: 1 },
      { key: 'played', label: 'Date Played (Real-World)', placeholder: 'e.g. July 29, 2026...', widget: 'date' },
      { key: 'ingame', label: 'In-Game Date', placeholder: 'e.g. 4th Mirtul, 1492 DR...' },
      { key: 'locations', label: 'Location(s)', placeholder: 'e.g. Phandalin, Tresendar Manor...', widget: 'link' },
      { key: 'players', label: 'Players Present', placeholder: 'e.g. Adam, Beth, Carlos...', widget: 'members' },
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
      { key: 'giver', label: 'Quest Giver', placeholder: 'e.g. Sildar Hallwinter...', widget: 'link', multiple: false },
      { key: 'status', label: 'Status', placeholder: 'e.g. Active, Completed, Failed, On Hold...', widget: 'select', options: QUEST_STATUS_OPTIONS },
      { key: 'reward', label: 'Reward', placeholder: 'e.g. 200gp, a magic item...' },
      { key: 'deadline', label: 'Deadline (In-Game)', placeholder: 'e.g. Before the next full moon...' },
      { key: 'difficulty', label: 'Difficulty', placeholder: 'e.g. CR 5 encounters, deadly...', widget: 'select', options: QUEST_DIFFICULTY_OPTIONS },
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
      { key: 'source', label: 'Source', placeholder: 'e.g. PHB p.195, DMG, Homebrew...', widget: 'select', options: RULE_SOURCE_OPTIONS },
      { key: 'page', label: 'Page / Section', placeholder: 'e.g. Chapter 9: Combat...' },
      { key: 'category', label: 'Category', placeholder: 'e.g. Combat, Magic, Social...', widget: 'select', options: RULE_CATEGORY_OPTIONS },
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
      { key: 'rarity', label: 'Rarity', placeholder: 'e.g. Uncommon, Rare, Legendary...', widget: 'select', options: LOOT_RARITY_OPTIONS },
      { key: 'type', label: 'Type', placeholder: 'e.g. Weapon, Armor, Wondrous, Gold...', widget: 'select', options: LOOT_TYPE_OPTIONS },
      { key: 'value', label: 'Value (gp)', placeholder: 'e.g. 500', widget: 'number', min: 0 },
      { key: 'attunement', label: 'Attunement Required', placeholder: 'e.g. Yes (Wizard), No...', widget: 'select', options: ATTUNEMENT_OPTIONS },
      { key: 'heldBy', label: 'Held By', placeholder: 'e.g. Thorin, Party Treasury...', widget: 'link', multiple: false },
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
      { key: 'character', label: 'Character', placeholder: 'e.g. Thorin...', widget: 'link', multiple: false },
      { key: 'activityType', label: 'Activity Type', placeholder: 'e.g. Crafting, Training, Carousing...', widget: 'select', options: DOWNTIME_ACTIVITY_OPTIONS },
      { key: 'duration', label: 'Duration (days)', placeholder: 'e.g. 10', widget: 'number', min: 0 },
      { key: 'cost', label: 'Cost (gp)', placeholder: 'e.g. 50', widget: 'number', min: 0 },
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

// Minimum card width. The header row packs a visibility icon, the title,
// a type badge, and (when editable) three control buttons — at the old
// 160px floor there often wasn't enough left-over space for the title to
// render legibly (it would get crushed to a sliver or clipped). 200px
// keeps cards compact while giving the title reliable room to breathe.
const MIN_ITEM_WIDTH = 200;

type BoardItemLodTier = 'full' | 'image' | 'pin';

export interface BoardItemLodThresholds {
  /** Collapse text-heavy/full cards once their rendered width falls below this many screen pixels. */
  fullWidth: number;
  /** Collapse full cards once their rendered height falls below this many screen pixels. Ignored for manually minimized cards. */
  fullHeight: number;
  /** Expand back to full only after this wider rendered width is reached. Prevents flicker near the boundary. */
  fullExpandWidth: number;
  /** Expand back to full only after this taller rendered height is reached. Prevents flicker near the boundary. */
  fullExpandHeight: number;
  /** Collapse image-forward compact cards to pins once either rendered dimension falls below this many screen pixels. */
  pinSize: number;
  /** Expand pins back to image-forward compact cards only after both rendered dimensions exceed this many screen pixels. */
  pinExpandSize: number;
  /** Visual pin diameter in screen pixels. It is inversely scaled so pins stay usable while zoomed out. */
  pinScreenSize: number;
}

export const BOARD_ITEM_DEFAULT_LOD_THRESHOLDS: BoardItemLodThresholds = {
  fullWidth: 130,
  fullHeight: 90,
  fullExpandWidth: 145,
  fullExpandHeight: 100,
  pinSize: 45,
  pinExpandSize: 56,
  pinScreenSize: 36,
};

interface PrimaryImagePreview {
  imageUrl: string;
  alt: string;
  objectClassName: string;
  crop?: CropRect | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface BoardItemProps {
  item: BoardItemType;
  user: User;
  onUpdate: (item: BoardItemType) => void;
  onDelete: (id: string) => void;
  onClick: (id: string, e: React.MouseEvent) => void;
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
  /** Per-item level-of-detail thresholds, expressed in rendered screen pixels. */
  lodThresholds?: BoardItemLodThresholds;
  /** Board-wide card text scale multiplier (1 = default 100%), set by the DM. */
  fontScale?: number;
  /** Called when user wants to open the focus drawer for this item */
  onOpenFocus?: (id: string) => void;
  /** Tag click → board-wide tag filter toggle (per Feature 02). */
  onToggleTagFilter?: (tag: string) => void;
  /** Board-wide tag definitions (colors). */
  tagDefs?: Record<string, TagDef>;
  /** Tags currently active in the board-wide filter. */
  activeTagFilter?: string[];
  /** True when the card is filtered out (dimmed, not hidden). */
  dimmed?: boolean;
  /** Feature 09 — read-only share view: disables all edit affordances (drag,
   *  resize, controls, image drop) regardless of `user`. Clicking still opens
   *  the focus drawer and cross-link navigation still works. */
  readOnly?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview renderer — renders one PreviewFieldSlot visually in the compact card
// ─────────────────────────────────────────────────────────────────────────────

// Hero (full-width) image previews render at 140px tall; thumbnail previews
// are 72px-tall strips that fill the column width. 'natural' renders the image
// at its intrinsic aspect ratio (no height cap) and 'fill' stretches it to
// cover the whole card body. (Hardcoded in the class names below — Tailwind
// needs static classes.)

function imagePreviewClasses(mode: Exclude<PreviewFieldMode, 'auto'>): {
  imgClassName: string;
  objectFit: 'contain' | 'cover';
  objectPosition: 'center' | 'top';
} {
  if (mode === 'thumb') {
    return {
      imgClassName: 'w-full h-[72px] object-cover object-top rounded pointer-events-none select-none',
      objectFit: 'cover',
      objectPosition: 'top',
    };
  }
  if (mode === 'natural') {
    return {
      imgClassName: 'w-full h-auto object-contain pointer-events-none select-none',
      objectFit: 'contain',
      objectPosition: 'center',
    };
  }
  if (mode === 'fill') {
    return {
      imgClassName: 'w-full h-full object-cover pointer-events-none select-none',
      objectFit: 'cover',
      objectPosition: 'center',
    };
  }
  return {
    imgClassName: 'w-full h-[140px] object-cover object-top pointer-events-none select-none',
    objectFit: 'cover',
    objectPosition: 'top',
  };
}

function PreviewField({ slot, item, user, fieldDefs, resolvedFields, columns, fontScale, allItems, onScrollToItem }: {
  slot: PreviewFieldSlot;
  item: BoardItemType;
  user: User;
  fieldDefs: FieldDef[] | null;
  /** Pre-resolved fields array (may include defaults merged in) */
  resolvedFields: ItemField[];
  /** Number of columns in the preview grid (from the item's preview layout) */
  columns: PreviewLayout['columns'];
  /** Board-wide card text scale multiplier */
  fontScale: number;
  /** Feature 10 — all board items (chip decoration + click-to-jump). */
  allItems?: BoardItemType[];
  /** Called when a card-link chip is clicked (pan/zoom to the target). */
  onScrollToItem?: (id: string) => void;
}) {
  const { fieldId } = slot;
  const fontScalePx = (px: number) => px * fontScale;
  // Feature 10 — chip decoration for card-link spans in text previews
  // (render-time only; clicks jump to the target instead of opening the
  // drawer). Hoisted above the early returns — hooks must be unconditional.
  const liveIds = useMemo(() => new Set((allItems || []).map(i => i.id)), [allItems]);

  // ── image-type board items store their content in item.content ──
  if (item.type === 'image' && fieldId === '__image_content__') {
    if (!item.content) return null;
    return (
      <div className="h-full min-h-0 overflow-hidden">
        <AnnotatedImagePreview
          imageUrl={item.content}
          lines={item.lines}
          crop={item.crop ?? null}
          alt="Image"
          imgClassName="w-full h-full object-contain pointer-events-none select-none"
        />
      </div>
    );
  }

  // ── Per-field visibility: hidden fields render as a lock chip ──
  const field = resolvedFields.find(f => f.id === fieldId);
  if (field?.visibility && field.visibility !== 'all' && !canViewField(field, item, user)) {
    return <HiddenFieldChip label={field.label} visibility={field.visibility} fontScale={fontScale} />;
  }

  const fieldType = classifyPreviewField(fieldId, item.type, fieldDefs, resolvedFields);
  const def = fieldDefs?.find(d => d.id === fieldId) ?? null;
  const fieldLabel = def?.label ?? field?.label ?? fieldId;
  const mode = resolveFieldMode(slot, fieldType, columns);
  const span = resolveFieldSpan(slot, fieldType, columns, mode);
  const spanStyle = columns === 1 ? undefined : { gridColumn: `span ${span}` };

  // ── NPC: portrait ──
  if (item.type === 'npc' && fieldId === 'npc-image') {
    const imageUrl = field?.imageUrl;
    if (!imageUrl) return null;
    const img = imagePreviewClasses(mode);
    return (
      <div style={spanStyle} className="min-h-0">
        <AnnotatedImagePreview
          imageUrl={imageUrl}
          lines={field?.lines}
          crop={field?.crop ?? null}
          alt="NPC portrait"
          imgClassName={img.imgClassName}
          objectFit={img.objectFit}
          objectPosition={img.objectPosition}
        />
      </div>
    );
  }

  // ── Image field — hero banner, small thumbnail, natural height, or fill ──
  if (fieldType === 'image') {
    const imageUrl = field?.imageUrl;
    if (!imageUrl) return null;
    const img = imagePreviewClasses(mode);
    return (
      <div style={spanStyle} className="min-h-0">
        <AnnotatedImagePreview
          imageUrl={imageUrl}
          lines={field?.lines}
          crop={field?.crop ?? null}
          alt={fieldLabel}
          imgClassName={img.imgClassName}
          objectFit={img.objectFit}
          objectPosition={img.objectPosition}
        />
      </div>
    );
  }

  // ── Structured field — show key-value pairs ──
  if (fieldType === 'structured') {
    // NPC personality traits (stored as JSON in npc-personality-traits field)
    if (item.type === 'npc' && fieldId === 'npc-personality-traits') {
      if (!field?.textValue) return null;
      let entries: [string, string][] = [];
      try {
        const data = JSON.parse(field.textValue) as Record<string, string>;
        entries = Object.entries(data).filter(([, v]) => v);
      } catch {
        return null;
      }
      if (mode !== 'expanded') entries = entries.slice(0, 3);
      if (entries.length === 0) return null;
      return (
        <div
          style={spanStyle}
          className={`min-h-0 ${span === columns && entries.length >= 2 ? 'grid grid-cols-2 gap-x-2 gap-y-0.5' : 'flex flex-col gap-0.5'}`}
        >
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-1 leading-tight" style={{ fontSize: fontScalePx(10) }}>
              <span className="font-bold uppercase text-[#8C7B6E] opacity-80 flex-shrink-0 truncate max-w-[65%]" title={k}>{k}</span>
              <span className="truncate opacity-90 flex-1 min-w-0">{getPlainText(v)}</span>
            </div>
          ))}
        </div>
      );
    }

    const data = parseStructured(field?.textValue);
    const entries = (def?.structuredKeys ?? [])
      .map(sk => ({ label: sk.label, value: data[sk.key] }))
      .filter(e => e.value);
    const shown = mode === 'expanded' ? entries : entries.slice(0, 4);
    if (shown.length === 0) return null;
    return (
      <div
        style={spanStyle}
        className={`min-h-0 ${span === columns && shown.length >= 2 ? 'grid grid-cols-2 gap-x-2 gap-y-0.5' : 'flex flex-col gap-0.5'}`}
      >
        {shown.map(e => (
          <div key={e.label} className="flex items-baseline gap-1 leading-tight" style={{ fontSize: fontScalePx(10) }}>
            <span className="font-bold uppercase text-[#8C7B6E] opacity-80 flex-shrink-0 truncate max-w-[65%]" title={e.label}>{e.label}</span>
            <span className="truncate opacity-90 flex-1 min-w-0">{getPlainText(e.value)}</span>
          </div>
        ))}
      </div>
    );
  }

  // ── File field — list attached files & links ──
  // File fields store data in `field.files` (not textValue/imageUrl), so they
  // need their own branch. Otherwise they fall through the text branch below,
  // which reads textValue and renders nothing.
  if (def?.type === 'file' || field?.type === 'file') {
    const files = field?.files;
    if (!files || files.length === 0) return null;
    const shown = mode === 'expanded' ? files : files.slice(0, 3);
    return (
      <div style={spanStyle} className="flex flex-col gap-0.5 min-h-0">
        <span className="font-bold uppercase text-[#8C7B6E] opacity-80 tracking-wide truncate" style={{ fontSize: fontScalePx(9) }} title={fieldLabel}>
          {fieldLabel}
        </span>
        <div className="flex flex-col gap-0.5 min-h-0">
          {shown.map(file => (
            <div key={file.id} className="flex items-center gap-1 min-w-0">
              <File size={fontScalePx(9)} className="text-[#B58D3D] flex-shrink-0" />
              <span className="truncate leading-snug opacity-90 flex-1 min-w-0" style={{ fontSize: fontScalePx(10) }} title={file.name}>
                {file.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Text field — show a label plus clamped rich text preview ──
  // Always read the live value from resolvedFields — it already merges
  // saved item.fields over the item.content-seeded default, so this
  // works correctly both before and after the field has been edited.
  // (Reading item.content directly here was stale once a field existed,
  // which is why long-form/rich-text content failed to show on the canvas.)
  const rawValue = field?.textValue;
  const plain = rawValue ? getPlainText(rawValue || '') : '';
  const previewHtml = plain ? flattenRichTextForPreview(plain) : '';
  if (!previewHtml.replace(/<[^>]*>/g, '').trim()) return null;
  // Feature 10 — decorate card-link spans as chips (render-time only).
  const decoratedHtml = previewHtml.includes('data-card-id')
    ? decorateCardLinks(previewHtml, liveIds)
    : previewHtml;
  const clamp = resolveClampLines(slot, mode);
  return (
    <div style={spanStyle} className="flex flex-col gap-0.5 justify-between min-h-0">
      <span className="font-bold uppercase text-[#8C7B6E] opacity-80 tracking-wide truncate" style={{ fontSize: fontScalePx(9) }} title={fieldLabel}>
        {fieldLabel}
      </span>
      <p
        className="rich-text-preview leading-snug text-[#423D38]/80 min-h-0"
        style={{
          fontSize: fontScalePx(10),
          ...(clamp ? {
            display: '-webkit-box',
            WebkitLineClamp: clamp,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          } : undefined),
        }}
        onClick={(e) => {
          const el = (e.target as HTMLElement).closest('[data-card-id]');
          if (el && onScrollToItem) {
            e.stopPropagation();
            onScrollToItem(el.getAttribute('data-card-id') || '');
          }
        }}
      >
        <span dangerouslySetInnerHTML={{ __html: decoratedHtml }} />
      </p>
    </div>
  );
}

function HiddenFieldChip({ label, visibility, fontScale }: { label: string; visibility: Visibility; fontScale: number }) {
  const isDm = visibility === 'dm';
  const fs = (px: number) => px * fontScale;
  return (
    <div className="flex items-center gap-1 leading-tight min-w-0" style={{ fontSize: fs(9) }}>
      <Lock size={fs(9)} className={`flex-shrink-0 ${isDm ? 'text-purple-500/80' : 'text-amber-500/80'}`} />
      <span className="font-bold uppercase text-[#8C7B6E] opacity-80 truncate" title={label}>
        {label}
      </span>
      <span
        className={`font-bold uppercase flex-shrink-0 px-1 py-px rounded ${
          isDm ? 'bg-purple-500/10 text-purple-700' : 'bg-amber-500/10 text-amber-700'
        }`}
        style={{ fontSize: fs(8) }}
      >
        {isDm ? 'DM only' : 'Owner only'}
      </span>
    </div>
  );
}

function getPrimaryImagePreview(item: BoardItemType, resolvedFields: ItemField[], user: User): PrimaryImagePreview | null {
  if (item.type === 'image' && item.content) {
    return {
      imageUrl: item.content,
      alt: item.title || 'Image',
      objectClassName: 'object-contain object-center',
      crop: item.crop,
    };
  }

  const imageField = resolvedFields.find(f => f.type === 'image' && !!f.imageUrl && canViewField(f, item, user));
  if (!imageField?.imageUrl) return null;

  const imageFieldId = imageField.id.toLowerCase();
  const shouldContain =
    item.type === 'location' ||
    item.type === 'faction' ||
    imageFieldId.includes('map') ||
    imageFieldId.includes('emblem') ||
    imageFieldId.includes('banner');

  return {
    imageUrl: imageField.imageUrl,
    alt: imageField.label || item.title || 'Image',
    objectClassName: shouldContain ? 'object-contain object-center' : 'object-cover object-top',
    crop: imageField.crop,
  };
}

function resolveBoardItemLodTier({
  previousTier,
  hasImage,
  isMinimized,
  effectiveWidth,
  effectiveHeight,
  thresholds,
}: {
  previousTier?: BoardItemLodTier;
  hasImage: boolean;
  isMinimized: boolean;
  effectiveWidth: number;
  effectiveHeight: number;
  thresholds: BoardItemLodThresholds;
}): BoardItemLodTier {
  // Manually minimized cards intentionally only need enough width for their
  // header/title. Height thresholds would otherwise turn every minimized card
  // into a pin even at normal zoom because the visible header is short.
  const fullCollapseOk =
    effectiveWidth >= thresholds.fullWidth &&
    (isMinimized || effectiveHeight >= thresholds.fullHeight);
  const fullExpandOk =
    effectiveWidth >= thresholds.fullExpandWidth &&
    (isMinimized || effectiveHeight >= thresholds.fullExpandHeight);

  const pinCollapse =
    effectiveWidth < thresholds.pinSize ||
    (!isMinimized && effectiveHeight < thresholds.pinSize);
  const pinExpand =
    effectiveWidth >= thresholds.pinExpandSize &&
    (isMinimized || effectiveHeight >= thresholds.pinExpandSize);

  if (!previousTier) {
    if (fullCollapseOk) return 'full';
    if (hasImage && !pinCollapse) return 'image';
    return 'pin';
  }

  if (previousTier === 'full') {
    if (fullCollapseOk) return 'full';
    if (hasImage && !pinCollapse) return 'image';
    return 'pin';
  }

  if (previousTier === 'image') {
    if (fullExpandOk) return 'full';
    if (!hasImage || pinCollapse) return 'pin';
    return 'image';
  }

  // previousTier === 'pin'
  if (fullExpandOk) return 'full';
  if (hasImage && pinExpand) return 'image';
  return 'pin';
}

function BoardItemTypeIcon({ type, size, className }: { type: BoardItemType['type']; size: number; className?: string }) {
  switch (type) {
    case 'character':
      return <UserIcon size={size} className={className} strokeWidth={2.4} />;
    case 'npc':
      return <Users size={size} className={className} strokeWidth={2.4} />;
    case 'faction':
      return <Crown size={size} className={className} strokeWidth={2.4} />;
    case 'event':
      return <CalendarDays size={size} className={className} strokeWidth={2.4} />;
    case 'location':
      return <MapPin size={size} className={className} strokeWidth={2.4} />;
    case 'session':
      return <BookOpen size={size} className={className} strokeWidth={2.4} />;
    case 'quest':
      return <ScrollText size={size} className={className} strokeWidth={2.4} />;
    case 'note':
      return <FileText size={size} className={className} strokeWidth={2.4} />;
    case 'rule':
      return <BookOpen size={size} className={className} strokeWidth={2.4} />;
    case 'loot':
      return <Package size={size} className={className} strokeWidth={2.4} />;
    case 'downtime':
      return <Clock size={size} className={className} strokeWidth={2.4} />;
    case 'image':
      return <ImageIcon size={size} className={className} strokeWidth={2.4} />;
    default:
      return <FileText size={size} className={className} strokeWidth={2.4} />;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BoardItem
// ─────────────────────────────────────────────────────────────────────────────

/** #tag pills on a card. Chip click toggles the board-wide tag filter; chips
 *  are buttons with data-no-drag + pointer-stop so they never drag or pan. */
function TagChips({
  tags,
  tagDefs,
  activeTags = [],
  onToggle,
  fontPx,
  padPx = 1,
  maxChips = 4,
  moreColor = '#6B7280',
}: {
  tags?: string[];
  tagDefs?: Record<string, TagDef>;
  activeTags?: string[];
  onToggle?: (tag: string) => void;
  fontPx: number;
  padPx?: number;
  maxChips?: number;
  moreColor?: string;
}) {
  const list = (tags || []).filter(Boolean);
  if (list.length === 0) return null;
  const visible = list.slice(0, maxChips);
  const extra = list.length - visible.length;
  return (
    <div className="flex items-center gap-1 flex-shrink-0 flex-wrap">
      {visible.map((tag) => {
        const color = tagColor(tag, tagDefs) ?? '#8C7B6E';
        const light = isLightColor(color);
        const active = activeTags.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            data-no-drag
            onPointerDown={(e) => { e.stopPropagation(); }}
            onPointerDownCapture={(e) => { e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); onToggle?.(tag); }}
            title={`${active ? 'Stop filtering by' : 'Filter by'} #${tag}`}
            className="cursor-pointer select-none"
            style={{
              fontSize: fontPx,
              lineHeight: 1.2,
              padding: `${1.5 * padPx}px ${5 * padPx}px`,
              borderRadius: 999,
              backgroundColor: color,
              color: light ? '#1F2937' : '#FFFFFF',
              boxShadow: active
                ? `0 0 0 1.5px ${light ? '#1F2937' : '#FFFFFF'}, 0 0 0 3px #B58D3D`
                : 'inset 0 0 0 1px rgba(0,0,0,0.15)',
            }}
          >
            #{tag}
          </button>
        );
      })}
      {extra > 0 && (
        <span className="font-bold" style={{ fontSize: fontPx, color: moreColor }}>+{extra}</span>
      )}
    </div>
  );
}

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
  lodThresholds,
  fontScale = 1,
  onOpenFocus,
  onToggleTagFilter,
  tagDefs,
  activeTagFilter = [],
  dimmed,
  readOnly = false,
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

  const canEdit = !readOnly && (item.ownerId === user.id || user.role === 'dm');
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

  const safeZoomScale = Math.max(0.05, zoomScale || 1);

  // Board-wide DM setting: scales every piece of card text by fontScale.
  const fontScalePx = (px: number) => px * fontScale;

  // Zoom-scaled title font: larger when zoomed out so text stays legible
  // At 100% zoom → 13px. At 50% zoom → 16px (cap). At 200% → ~10px (floor).
  // Capped at 16 (was 20) so the title text can't grow large enough to
  // starve the rest of the header row (badge/controls) of space.
  const titleFontSize = Math.min(16, Math.max(10, 13 / safeZoomScale)) * fontScale;

  const fieldDefs = ITEM_FIELD_DEFS[item.type]?.defs ?? null;
  const previewLayout = resolvePreviewLayout(item, item.type, fieldDefs);
  const columnWidths = getColumnWidths(previewLayout);

  // 'fill' images expand to cover the whole card body — the preview grid must
  // stretch its rows to fill the available height for that to work.
  const hasFillPreview = previewLayout.rows.some(slot =>
    slot.fieldId !== '__image_content__' &&
    resolveFieldMode(slot, classifyPreviewField(slot.fieldId, item.type, fieldDefs, item.fields), previewLayout.columns) === 'fill'
  );

  // Merge saved fields with defaults so images always resolve even before drawer is opened.
  // Saved user-added custom fields (which have no FieldDef) are kept alongside the defaults.
  const resolvedFields: ItemField[] = (() => {
    if (item.type === 'npc') return item.fields || [];
    if (!fieldDefs) return item.fields || [];
    const defaults = buildDefaultFields(fieldDefs, item.content);
    const saved = item.fields || [];
    return [
      ...defaults.map(def => saved.find(s => s.id === def.id) ?? def),
      ...saved.filter(s => !defaults.some(d => d.id === s.id)),
    ];
  })();

  const thresholds = lodThresholds ?? BOARD_ITEM_DEFAULT_LOD_THRESHOLDS;
  const primaryImage = getPrimaryImagePreview(item, resolvedFields, user);
  // A manually minimized card should stay header-only until it gets truly
  // tiny; don't unexpectedly expand it into the image-forward tier.
  const hasImageForLod = !item.minimized && !!primaryImage;
  const effectiveWidth = item.width * safeZoomScale;
  const effectiveHeight = (item.height || 200) * safeZoomScale;
  const [lodTier, setLodTier] = useState<BoardItemLodTier>(() => resolveBoardItemLodTier({
    hasImage: hasImageForLod,
    isMinimized: !!item.minimized,
    effectiveWidth,
    effectiveHeight,
    thresholds,
  }));

  useEffect(() => {
    setLodTier(prev => resolveBoardItemLodTier({
      previousTier: prev,
      hasImage: hasImageForLod,
      isMinimized: !!item.minimized,
      effectiveWidth,
      effectiveHeight,
      thresholds,
    }));
  }, [
    hasImageForLod,
    item.minimized,
    effectiveWidth,
    effectiveHeight,
    thresholds.fullWidth,
    thresholds.fullHeight,
    thresholds.fullExpandWidth,
    thresholds.fullExpandHeight,
    thresholds.pinSize,
    thresholds.pinExpandSize,
  ]);

  // ── Drag-and-drop image onto this card ──────────────────────────────────────
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  // In-flight blob upload for a dropped image, shown over the card.
  const [cardUpload, setCardUpload] = useState<{
    label: string;
    percent: number;
    error: string | null;
  } | null>(null);

  const handleCardDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (!canEdit) return;

    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setCardUpload({ label: file.name || 'Image', percent: 0, error: null });
      try {
        const imageUrl = await uploadFileToBlob(file, {
          boardId: user.boardId,
          onProgress: (percent) => setCardUpload(prev => (prev ? { ...prev, percent } : prev)),
        });
        if (item.type === 'image') {
          onUpdate({ ...item, content: imageUrl });
        } else {
          // Update the first image-type field the user is allowed to see
          const currentFields = resolvedFields;
          const imgField = currentFields.find(f => f.type === 'image' && canViewField(f, item, user));
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
        setCardUpload(null);
      } catch (err) {
        console.error('Error dropping image onto card:', err);
        setCardUpload(prev => (prev ? { ...prev, error: err instanceof Error ? err.message : 'Upload failed' } : prev));
        setTimeout(() => setCardUpload(null), 6000);
      }
      return;
    }
    // Handle URL drops (http/https only — data: URLs are never persisted).
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('URL');
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      if (item.type === 'image') {
        onUpdate({ ...item, content: url.trim() });
      } else {
        const currentFields = resolvedFields;
        const imgField = currentFields.find(f => f.type === 'image' && canViewField(f, item, user));
        if (imgField) {
          const updatedFields = currentFields.map(f =>
            f.id === imgField.id ? { ...f, imageUrl: url.trim() } : f
          );
          onUpdate({ ...item, fields: updatedFields });
        }
      }
    }
  };

  // Determine if this item can accept an image drop (image type or has at least one visible image field)
  const canAcceptImageDrop = canEdit && (
    item.type === 'image' ||
    resolvedFields.some(f => f.type === 'image' && canViewField(f, item, user))
  );

  const handleItemPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!canEdit) return;
    // Modifier-clicks select/deselect (multi-select), never drag.
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
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
  };

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

  const renderFullCard = lodTier === 'full';
  const renderImageCompactCard = lodTier === 'image' && !!primaryImage;
  const renderPinCard = lodTier === 'pin';
  const pinDiameter = thresholds.pinScreenSize / safeZoomScale;
  const pinIconSize = 18 / safeZoomScale;
  const pinLabelWidth = 150 / safeZoomScale;
  const pinFontSize = (11 / safeZoomScale) * fontScale;
  const pinLineHeight = (14 / safeZoomScale) * fontScale;
  const compactCaptionFontSize = (11 / safeZoomScale) * fontScale;
  const compactCaptionPaddingY = 4 / safeZoomScale;
  const compactCaptionPaddingX = 6 / safeZoomScale;
  const compactTypeFontSize = (8 / safeZoomScale) * fontScale;
  const lodShellHeight = renderFullCard && item.minimized
    ? undefined
    : renderPinCard && item.minimized
    ? 32
    : item.height;

  return (
    <motion.div
      id={item.id}
      ref={nodeRef}
      style={{
        position: 'absolute',
        left: `${item.x + (dragOffset?.x || 0)}px`,
        top: `${item.y + (dragOffset?.y || 0)}px`,
        width: item.width,
        height: lodShellHeight,
        minHeight: lodShellHeight,
        backgroundColor: renderPinCard ? 'transparent' : isLight ? itemColor : '#FFFFFF',
        borderLeft: renderPinCard
          ? 'none'
          : isFocused
          ? '2px solid #B58D3D'
          : isSelected
          ? '2px solid #B58D3D'
          : isDraggingOver
          ? '2px solid #B58D3D'
          : isLight
          ? '1px solid rgba(0,0,0,0.18)'
          : `1.5px solid ${itemColor}80`,
        borderRight: renderPinCard
          ? 'none'
          : isFocused
          ? '2px solid #B58D3D'
          : isSelected
          ? '2px solid #B58D3D'
          : isDraggingOver
          ? '2px solid #B58D3D'
          : isLight
          ? '1px solid rgba(0,0,0,0.18)'
          : `1.5px solid ${itemColor}80`,
        borderBottom: renderPinCard
          ? 'none'
          : isFocused
          ? '2px solid #B58D3D'
          : isSelected
          ? '2px solid #B58D3D'
          : isDraggingOver
          ? '2px solid #B58D3D'
          : isLight
          ? '1px solid rgba(0,0,0,0.18)'
          : `1.5px solid ${itemColor}80`,
        borderTop: renderPinCard
          ? 'none'
          : isFocused
          ? '4px solid #B58D3D'
          : isSelected
          ? '4px solid #B58D3D'
          : isDraggingOver
          ? '4px solid #B58D3D'
          : isLight
          ? '4px solid rgba(0,0,0,0.2)'
          : `4px solid ${itemColor}`,
        borderRadius: renderPinCard ? 0 : '6px',
        color: isLight ? '#1F2937' : '#2C2824',
        zIndex: isFocused ? 15 : isSelected ? 10 : isDraggingOver ? 12 : 1,
        overflow: renderPinCard ? 'visible' : renderImageCompactCard ? 'hidden' : item.minimized ? 'hidden' : 'visible',
        boxShadow: renderPinCard
          ? 'none'
          : isDraggingOver
          ? '0 0 0 3px #B58D3D66, 0 8px 32px rgba(181,141,61,0.25)'
          : isFocused
          ? '0 0 0 2px #B58D3D55, 0 8px 32px rgba(0,0,0,0.18)'
          : isSelected
          ? '0 0 0 2px #B58D3D, 0 8px 32px rgba(0,0,0,0.15)'
          : '0 4px 16px rgba(0,0,0,0.12)',
        opacity: dimmed ? 0.25 : undefined,
        transition: dimmed ? 'opacity 0.15s ease' : undefined,
      }}
      className={`${renderPinCard ? '' : 'flex flex-col'} nodrag transition-shadow duration-200`}
      data-item-root
      onClick={(e) => onClick(item.id, e)}
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
      {renderPinCard && (
        <div
          className={`absolute flex flex-col items-center gap-1 select-none ${canEdit ? 'cursor-move' : 'cursor-pointer'}`}
          style={{
            left: '50%',
            top: '50%',
            width: pinLabelWidth,
            transform: 'translate(-50%, -50%)',
          }}
          onPointerDown={handleItemPointerDown}
          onDoubleClick={(e) => { e.stopPropagation(); onOpenFocus?.(item.id); }}
          title={`${item.title || 'Untitled'} (${item.type})`}
        >
          <div
            className="flex items-center justify-center rounded-full text-white"
            style={{
              width: pinDiameter,
              height: pinDiameter,
              backgroundColor: itemColor,
              color: isLight ? '#1F2937' : '#FFFFFF',
              border: `${Math.max(1, 1.5 / safeZoomScale)}px solid ${isFocused || isSelected ? '#B58D3D' : 'rgba(255,255,255,0.75)'}`,
              boxShadow: isFocused || isSelected
                ? `0 0 0 ${2 / safeZoomScale}px #B58D3D66, 0 ${5 / safeZoomScale}px ${16 / safeZoomScale}px rgba(0,0,0,0.28)`
                : `0 ${4 / safeZoomScale}px ${12 / safeZoomScale}px rgba(0,0,0,0.22)`,
            }}
          >
            <BoardItemTypeIcon type={item.type} size={pinIconSize} className="drop-shadow-sm" />
          </div>
          <span
            className="block truncate rounded-full bg-[#F5F2ED]/95 font-bold text-[#2C2824] shadow-sm ring-1 ring-black/10"
            style={{
              maxWidth: pinLabelWidth,
              fontSize: pinFontSize,
              lineHeight: `${pinLineHeight}px`,
              padding: `${1.5 / safeZoomScale}px ${6 / safeZoomScale}px`,
            }}
          >
            {item.title || 'Untitled'}
          </span>
          {isDraggingOver && (
            <div
              className="absolute rounded-full pointer-events-none"
              style={{
                inset: `${-6 / safeZoomScale}px`,
                border: `${2 / safeZoomScale}px dashed #B58D3D`,
                background: 'rgba(181,141,61,0.12)',
              }}
            />
          )}
        </div>
      )}

      {renderImageCompactCard && primaryImage && (
        <div
          className={`relative w-full h-full overflow-hidden rounded-[5px] select-none group ${canEdit ? 'cursor-move' : 'cursor-pointer'}`}
          onPointerDown={handleItemPointerDown}
          onDoubleClick={(e) => { e.stopPropagation(); onOpenFocus?.(item.id); }}
          title={`${item.title || 'Untitled'} (${item.type})`}
        >
          {(() => {
            const crop = primaryImage.crop;
            const masked = !!crop && !isFullCrop(crop);
            return (
              <img
                src={primaryImage.imageUrl}
                alt={primaryImage.alt}
                draggable={false}
                className={`w-full h-full pointer-events-none select-none ${masked ? '' : primaryImage.objectClassName}`}
                style={
                  masked
                    ? {
                        objectFit: 'cover',
                        objectPosition: `${(crop.x + crop.width / 2) * 100}% ${(crop.y + crop.height / 2) * 100}%`,
                      }
                    : undefined
                }
              />
            );
          })()}
          <div
            className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/75 via-black/45 to-transparent text-white"
            style={{
              padding: `${compactCaptionPaddingY}px ${compactCaptionPaddingX}px`,
              minHeight: 24 / safeZoomScale,
            }}
          >
            <span
              className="font-bold font-serif italic truncate flex-1 min-w-0 drop-shadow"
              style={{ fontSize: compactCaptionFontSize, lineHeight: 1.15 }}
            >
              {item.title || 'Untitled'}
            </span>
            <span
              className="uppercase font-black tracking-wider rounded bg-white/20 text-white/90 flex-shrink-0"
              style={{
                fontSize: compactTypeFontSize,
                lineHeight: 1,
                padding: `${2 / safeZoomScale}px ${3 / safeZoomScale}px`,
              }}
            >
              {item.type}
            </span>
            <TagChips
              tags={item.tags}
              tagDefs={tagDefs}
              activeTags={activeTagFilter}
              onToggle={onToggleTagFilter}
              fontPx={compactCaptionFontSize}
              padPx={1 / safeZoomScale}
              maxChips={2}
              moreColor="#E5E7EB"
            />
          </div>
          {isDraggingOver && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 pointer-events-none z-20"
              style={{ background: 'rgba(181,141,61,0.18)', backdropFilter: 'blur(1px)' }}
            >
              <Upload size={18 / safeZoomScale} className="text-[#F5E9C8] drop-shadow" />
              <span
                className="font-bold text-[#6B4E17] bg-[#F5E9C8]/95 rounded-full shadow-sm"
                style={{ fontSize: 10 / safeZoomScale, padding: `${2 / safeZoomScale}px ${7 / safeZoomScale}px` }}
              >
                Drop image here
              </span>
            </div>
          )}
        </div>
      )}

      {renderFullCard && (<>
      {/* ── Header / Drag Handle ── */}
      <div
        style={{
          backgroundColor: isLight ? 'rgba(0,0,0,0.04)' : `${itemColor}12`,
          borderBottom: item.minimized ? 'none' : isLight ? '1px solid rgba(0,0,0,0.1)' : `1px solid ${itemColor}30`,
        }}
        className={`flex items-center justify-between px-2 py-1.5 rounded-t-[5px] select-none gap-1 overflow-hidden ${canEdit ? 'cursor-move' : ''}`}
        onPointerDown={handleItemPointerDown}
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
          style={{
            ...(isLight ? { backgroundColor: 'rgba(0,0,0,0.1)', color: '#374151' } : { backgroundColor: itemColor, color: '#FFFFFF' }),
            fontSize: fontScalePx(9),
          }}
          className="font-bold uppercase tracking-wider flex-shrink-0 px-1 py-0.5 rounded truncate max-w-[64px]"
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

      {/* ── Tag chips (also on minimized cards) ── */}
      {(item.tags || []).length > 0 && (
        <div
          className="px-2 pt-1 pb-1 flex items-center gap-1 flex-shrink-0"
          style={{
            borderBottom: item.minimized ? 'none' : isLight ? '1px solid rgba(0,0,0,0.1)' : `1px solid ${itemColor}30`,
            backgroundColor: isLight ? 'rgba(0,0,0,0.02)' : `${itemColor}08`,
          }}
          onPointerDown={(e) => { e.stopPropagation(); }}
          onPointerDownCapture={(e) => { e.stopPropagation(); }}
        >
          <TagChips
            tags={item.tags}
            tagDefs={tagDefs}
            activeTags={activeTagFilter}
            onToggle={onToggleTagFilter}
            fontPx={fontScalePx(9)}
            maxChips={4}
            moreColor={isLight ? '#6B7280' : '#D1D5DB'}
          />
        </div>
      )}

      {/* ── Preview Body — hidden when minimized ── */}
      {!item.minimized && (
        <div
          className="grid content-start gap-1.5 p-2 flex-1 overflow-hidden cursor-pointer group relative min-h-0"
          style={{
            gridTemplateColumns: columnWidths.map(w => `minmax(0, ${w}fr)`).join(' '),
            gridAutoRows: hasFillPreview ? 'minmax(auto, 1fr)' : undefined,
          }}
          onClick={(e) => { e.stopPropagation(); onOpenFocus?.(item.id); }}
          title="Click to open in focus panel"
          onPointerDownCapture={e => e.stopPropagation()}
        >
          {previewLayout.rows.map(slot => (
            <PreviewField key={slot.fieldId} slot={slot} item={item} user={user} fieldDefs={fieldDefs} resolvedFields={resolvedFields} columns={previewLayout.columns} fontScale={fontScale} allItems={allItems} onScrollToItem={onScrollToItem} />
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
        className="px-2 py-1 flex justify-between items-center text-[#8C7B6E] rounded-b-[5px] gap-1 flex-shrink-0"
        style={{
          fontSize: fontScalePx(9),
          backgroundColor: isLight ? 'rgba(0,0,0,0.06)' : '#F5F2ED',
          borderTop: isLight ? '1px solid rgba(0,0,0,0.1)' : '1px solid #D9D0C1',
        }}
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
      </>)}
      {/* In-flight blob upload progress / error, centered over the card */}
      {cardUpload && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none"
        >
          <UploadProgress
            percent={cardUpload.percent}
            label={`Uploading ${cardUpload.label}`}
            error={cardUpload.error}
          />
        </div>
      )}
    </motion.div>
  );
});