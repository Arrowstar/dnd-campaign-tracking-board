'use client';

import React, { useState, useEffect, useRef } from 'react';
import { BoardItem, ItemField, AttachedFile, FieldType, User } from '@/lib/types';
import {
  FileText,
  Image as ImageIcon,
  Paperclip,
  Plus,
  Trash2,
  Upload,
  Link as LinkIcon,
  Edit3,
  Check,
  ExternalLink,
  File,
  X,
  Tag,
  LayoutGrid,
  Search,
  Unlink,
  ArrowUpRight as JumpIcon,
} from 'lucide-react';
import ImageDrawer from './ImageDrawer';
import { RichTextEditor, RichTextDisplay } from './RichTextEditor';
import { fileToCompressedDataURL, uploadFileToBlob } from '@/lib/utils';
import {
  parseTokens,
  addLinkToValue,
  removeLinkFromValue,
  setTextInValue,
  hasContent,
  FieldToken,
  LinkToken,
} from '@/lib/crossref';


// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface StructuredBoxKey {
  /** Unique key stored in the JSON object */
  key: string;
  label: string;
  placeholder: string;
}

export interface FieldDef {
  id: string;
  label: string;
  /** 'structured' renders the quick-info box with short one-liner sub-fields */
  type: FieldType | 'structured';
  structuredKeys?: StructuredBoxKey[];
  /** Only for text fields: initial value (e.g. migrate from item.content) */
  isContentField?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function parseStructured(textValue?: string, fallbackKey?: string): Record<string, string> {
  if (!textValue) return {};
  try {
    const parsed = JSON.parse(textValue);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
  } catch {
    if (fallbackKey) return { [fallbackKey]: textValue };
  }
  return {};
}

export function stringifyStructured(data: Record<string, string>): string {
  return JSON.stringify(data);
}

/** Build default ItemField[] from a FieldDef[] config. */
export function buildDefaultFields(defs: FieldDef[], existingContent?: string): ItemField[] {
  return defs.map((def) => {
    if (def.type === 'structured') {
      const init: Record<string, string> = {};
      (def.structuredKeys || []).forEach((k) => { init[k.key] = ''; });
      return { id: def.id, label: def.label, type: 'text' as FieldType, textValue: stringifyStructured(init) };
    }
    if (def.type === 'image') {
      return { id: def.id, label: def.label, type: 'image', imageUrl: '', lines: [] };
    }
    if (def.type === 'file') {
      return { id: def.id, label: def.label, type: 'file', files: [] };
    }
    // text
    return {
      id: def.id,
      label: def.label,
      type: 'text',
      textValue: def.isContentField ? (existingContent || '') : '',
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface StructuredBoardItemFieldsProps {
  item: BoardItem;
  user: User;
  canEdit: boolean;
  isLight: boolean;
  onUpdate: (item: BoardItem) => void;
  fieldDefs: FieldDef[];
  typeLabel: string;
  /** All board items available for cross-reference linking. */
  allItems?: BoardItem[];
  /** Called when user clicks a linked chip to jump to that item on the canvas. */
  onScrollToItem?: (id: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Item type colour coding
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_BADGE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  character:  { bg: '#EFF6FF', text: '#1E3A8A', border: '#BFDBFE' },
  npc:        { bg: '#F5F3FF', text: '#5B21B6', border: '#DDD6FE' },
  faction:    { bg: '#FFF7ED', text: '#92400E', border: '#FED7AA' },
  event:      { bg: '#ECFDF5', text: '#065F46', border: '#A7F3D0' },
  location:   { bg: '#F0FDF4', text: '#166534', border: '#BBF7D0' },
  session:    { bg: '#FEF9C3', text: '#713F12', border: '#FDE68A' },
  quest:      { bg: '#FFF1F2', text: '#9F1239', border: '#FECDD3' },
  note:       { bg: '#F8FAFC', text: '#334155', border: '#CBD5E1' },
  rule:       { bg: '#F9FAFB', text: '#374151', border: '#D1D5DB' },
  loot:       { bg: '#FFFBEB', text: '#78350F', border: '#FDE68A' },
  downtime:   { bg: '#F0F9FF', text: '#0C4A6E', border: '#BAE6FD' },
  image:      { bg: '#F9FAFB', text: '#374151', border: '#D1D5DB' },
};

export default function StructuredBoardItemFields({
  item,
  canEdit,
  isLight,
  onUpdate,
  fieldDefs,
  typeLabel,
  allItems = [],
  onScrollToItem,
}: StructuredBoardItemFieldsProps) {

  // ── Migration / initialisation ────────────────────────────────────────────
  useEffect(() => {
    if (!item.fields || item.fields.length === 0) {
      onUpdate({ ...item, fields: buildDefaultFields(fieldDefs, item.content) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fields: ItemField[] =
    item.fields && item.fields.length > 0
      ? item.fields
      : buildDefaultFields(fieldDefs, item.content);

  // ── State ─────────────────────────────────────────────────────────────────
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editingStructuredKey, setEditingStructuredKey] = useState<{ fieldId: string; key: string } | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState('');
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState<FieldType>('text');
  const [activeUrlInput, setActiveUrlInput] = useState<{
    fieldId: string;
    type: 'image' | 'file';
    text: string;
    fileName?: string;
  } | null>(null);
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);

  // Link picker state: tracks which sub-field picker is open
  const [linkPicker, setLinkPicker] = useState<{ fieldId: string; key: string } | null>(null);
  const [linkSearch, setLinkSearch] = useState('');
  const linkPickerRef = useRef<HTMLDivElement>(null);

  // Close link picker on outside click
  useEffect(() => {
    if (!linkPicker) return;
    const handleOutside = (e: MouseEvent) => {
      if (linkPickerRef.current && !linkPickerRef.current.contains(e.target as Node)) {
        setLinkPicker(null);
        setLinkSearch('');
      }
    };
    document.addEventListener('mousedown', handleOutside, true);
    return () => document.removeEventListener('mousedown', handleOutside, true);
  }, [linkPicker]);

  // ── Field update helpers ──────────────────────────────────────────────────
  const updateFields = (newFields: ItemField[]) => {
    onUpdate({ ...item, fields: newFields });
  };

  const handleUpdateField = (fieldId: string, updates: Partial<ItemField>) => {
    updateFields(fields.map((f) => (f.id === fieldId ? { ...f, ...updates } : f)));
  };

  const handleDeleteField = (fieldId: string) => {
    updateFields(fields.filter((f) => f.id !== fieldId));
  };

  const handleAddField = () => {
    if (!newFieldLabel.trim()) return;
    const newField: ItemField = {
      id: 'field-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      label: newFieldLabel.trim(),
      type: newFieldType,
      textValue: newFieldType === 'text' ? '' : undefined,
      imageUrl: newFieldType === 'image' ? '' : undefined,
      files: newFieldType === 'file' ? [] : undefined,
      lines: newFieldType === 'image' ? [] : undefined,
    };
    updateFields([...fields, newField]);
    setNewFieldLabel('');
    setShowAddField(false);
  };

  const handleImageFileUpload = async (fieldId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadFileToBlob(file);
      handleUpdateField(fieldId, { imageUrl: url });
    } catch (err) {
      console.error('Error uploading image field:', err);
    }
    e.target.value = '';
  };

  const handleImageDrop = async (fieldId: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingFieldId(null);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      try {
        const url = await uploadFileToBlob(file);
        handleUpdateField(fieldId, { imageUrl: url });
      } catch (err) {
        console.error('Error uploading dropped image field:', err);
      }
      return;
    }
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('URL');
    if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/'))) {
      handleUpdateField(fieldId, { imageUrl: url.trim() });
    }
  };

  const handleDocumentFileUpload = async (fieldId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const uploaded = e.target.files;
    if (!uploaded || uploaded.length === 0) return;
    const currentField = fields.find((f) => f.id === fieldId);
    const existing = currentField?.files || [];
    
    for (const file of Array.from(uploaded)) {
      try {
        const url = await uploadFileToBlob(file);
        const newFile: AttachedFile = {
          id: 'file-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          name: file.name,
          url,
          size: file.size,
          mimeType: file.type,
        };
        handleUpdateField(fieldId, { files: [...existing, newFile] });
      } catch (err) {
        console.error('Error uploading document file:', err);
      }
    }
    e.target.value = '';
  };

  const handleAddFileUrl = (fieldId: string, url: string, customName?: string) => {
    if (!url.trim()) return;
    const currentField = fields.find((f) => f.id === fieldId);
    const existing = currentField?.files || [];
    let derivedName = customName?.trim() || '';
    if (!derivedName) {
      try {
        const parsed = new URL(url);
        derivedName = parsed.pathname.split('/').pop() || parsed.hostname;
      } catch {
        derivedName = url.length > 30 ? url.slice(0, 30) + '...' : url;
      }
    }
    handleUpdateField(fieldId, {
      files: [...existing, {
        id: 'file-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        name: derivedName,
        url: url.trim(),
      }],
    });
    setActiveUrlInput(null);
  };

  const handleRemoveFile = (fieldId: string, fileId: string) => {
    const currentField = fields.find((f) => f.id === fieldId);
    if (!currentField) return;
    handleUpdateField(fieldId, { files: (currentField.files || []).filter((f) => f.id !== fileId) });
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // ── Detect whether a field is a structured box ────────────────────────────
  const getFieldDef = (field: ItemField): FieldDef | undefined =>
    fieldDefs.find((d) => d.id === field.id);

  const isStructuredBox = (field: ItemField): boolean =>
    getFieldDef(field)?.type === 'structured';

  const getStructuredKeys = (field: ItemField): StructuredBoxKey[] =>
    getFieldDef(field)?.structuredKeys || [];

  const getFieldIcon = (field: ItemField) => {
    if (isStructuredBox(field)) return <LayoutGrid size={13} className="text-amber-600 flex-shrink-0" />;
    switch (field.type) {
      case 'image': return <ImageIcon size={13} className="text-amber-600 flex-shrink-0" />;
      case 'text': return <FileText size={13} className="text-blue-600 flex-shrink-0" />;
      case 'file': return <Paperclip size={13} className="text-emerald-600 flex-shrink-0" />;
    }
  };

  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if ('nativeEvent' in e && e.nativeEvent) {
      (e.nativeEvent as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render: Link Chip(s) for a structured sub-field value
  // ─────────────────────────────────────────────────────────────────────────
  const renderTokenChips = (tokens: FieldToken[], fieldId: string, key: string) => {
    return tokens.map((token, i) => {
      if (token.type === 'text') return null;
      const link = token as LinkToken;
      const exists = allItems.some(it => it.id === link.id);
      const badge = TYPE_BADGE_STYLES[link.itemType] || TYPE_BADGE_STYLES.note;
      return (
        <span
          key={`link-${link.id}-${i}`}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold border select-none group/chip ${
            exists && onScrollToItem ? 'cursor-pointer hover:shadow-md transition-all hover:scale-105' : ''
          }`}
          style={{ backgroundColor: badge.bg, color: badge.text, borderColor: badge.border }}
          onClick={(e) => {
            e.stopPropagation();
            if (exists && onScrollToItem) onScrollToItem(link.id);
          }}
          title={exists ? `Click to jump to: ${link.title} (${link.itemType})` : `Linked item not found: ${link.title}`}
        >
          {!exists && <Unlink size={10} className="opacity-60 flex-shrink-0" />}
          <span>
            <span className="opacity-60 text-[9px] uppercase tracking-wider mr-0.5">{link.itemType}</span>
            {link.title}
          </span>
          {exists && onScrollToItem && (
            <JumpIcon
              size={9}
              className="opacity-60 group-hover/chip:opacity-100 flex-shrink-0"
            />
          )}
          {canEdit && (
            <button
              type="button"
              onPointerDown={stop}
              onClick={(e) => {
                e.stopPropagation();
                const field = fields.find(f => f.id === fieldId);
                if (!field) return;
                const keys = getStructuredKeys(field);
                const data = parseStructured(field.textValue, keys[0]?.key);
                const newVal = removeLinkFromValue(data[key] || '', link.id);
                handleUpdateField(fieldId, { textValue: stringifyStructured({ ...data, [key]: newVal }) });
              }}
              className="ml-0.5 rounded-full hover:bg-black/15 p-0.5 transition-colors cursor-pointer flex-shrink-0"
              title="Remove link"
            >
              <X size={9} />
            </button>
          )}
        </span>
      );
    });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render: Link Picker Dropdown
  // ─────────────────────────────────────────────────────────────────────────
  const renderLinkPicker = (fieldId: string, key: string) => {
    const lowerSearch = linkSearch.toLowerCase();
    const field = fields.find(f => f.id === fieldId);
    const keys = field ? getStructuredKeys(field) : [];
    const data = parseStructured(field?.textValue, keys[0]?.key);
    const currentVal = data[key] || '';
    const currentTokens = parseTokens(currentVal);
    const linkedIds = new Set(
      currentTokens.filter(t => t.type === 'link').map(t => (t as LinkToken).id)
    );

    const filtered = allItems
      .filter(it => it.id !== item.id) // don't link to self
      .filter(it =>
        it.title.toLowerCase().includes(lowerSearch) ||
        it.type.toLowerCase().includes(lowerSearch)
      );

    // Group by type
    const grouped = filtered.reduce<Record<string, BoardItem[]>>((acc, it) => {
      if (!acc[it.type]) acc[it.type] = [];
      acc[it.type].push(it);
      return acc;
    }, {});

    return (
      <div
        ref={linkPickerRef}
        className="absolute z-[200] top-full left-0 mt-1 w-64 bg-white border border-[#D9D0C1] rounded-lg shadow-2xl flex flex-col overflow-hidden"
        onPointerDown={stop}
        onMouseDown={stop}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search */}
        <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-[#F0EDE6]">
          <Search size={12} className="text-[#8C7B6E] flex-shrink-0" />
          <input
            autoFocus
            type="text"
            value={linkSearch}
            onChange={e => setLinkSearch(e.target.value)}
            placeholder="Search board items..."
            className="flex-1 text-xs outline-none bg-transparent text-[#2C2824] placeholder:text-[#8C7B6E]"
            onPointerDown={stop}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Escape') { setLinkPicker(null); setLinkSearch(''); }
            }}
          />
          <button type="button" onPointerDown={stop} onClick={(e) => { e.stopPropagation(); setLinkPicker(null); setLinkSearch(''); }} className="text-[#8C7B6E] hover:text-[#2C2824] transition-colors cursor-pointer">
            <X size={12} />
          </button>
        </div>

        {/* Items list */}
        <div className="max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-center py-4 text-[11px] text-[#8C7B6E] italic">No items match your search</div>
          ) : (
            Object.entries(grouped).map(([type, groupItems]) => {
              const badge = TYPE_BADGE_STYLES[type] || TYPE_BADGE_STYLES.note;
              return (
                <div key={type}>
                  <div className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-[#8C7B6E] bg-[#FAFAF8] border-b border-[#F0EDE6]">
                    {type}s
                  </div>
                  {groupItems.map(boardItem => {
                    const alreadyLinked = linkedIds.has(boardItem.id);
                    return (
                      <button
                        key={boardItem.id}
                        type="button"
                        onPointerDown={stop}
                        onClick={(e) => {
                          e.stopPropagation();
                          const fld = fields.find(f => f.id === fieldId);
                          if (!fld) return;
                          const d = parseStructured(fld.textValue);
                          let newVal: string;
                          if (alreadyLinked) {
                            newVal = removeLinkFromValue(d[key] || '', boardItem.id);
                          } else {
                            newVal = addLinkToValue(d[key] || '', { id: boardItem.id, title: boardItem.title, itemType: boardItem.type });
                          }
                          handleUpdateField(fieldId, { textValue: stringifyStructured({ ...d, [key]: newVal }) });
                          // Keep picker open for multi-select; close on single escape
                        }}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer hover:bg-[#F5F2ED] ${
                          alreadyLinked ? 'bg-[#F0EDE6]' : ''
                        }`}
                      >
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider flex-shrink-0 border"
                          style={{ backgroundColor: badge.bg, color: badge.text, borderColor: badge.border }}
                        >
                          {type}
                        </span>
                        <span className="flex-1 truncate font-medium text-[#2C2824]">{boardItem.title || 'Untitled'}</span>
                        {alreadyLinked && <Check size={11} className="text-[#B58D3D] flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="px-2.5 py-1.5 border-t border-[#F0EDE6] text-[10px] text-[#8C7B6E] bg-[#FAFAF8]">
          Click items to link/unlink. Multiple selections allowed.
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render: Structured Box
  // ─────────────────────────────────────────────────────────────────────────
  const renderStructuredBox = (field: ItemField) => {
    const keys = getStructuredKeys(field);
    const data = parseStructured(field.textValue, keys[0]?.key);

    const handleTextChange = (key: string, rawText: string) => {
      const existingVal = data[key] || '';
      const newVal = setTextInValue(existingVal, rawText);
      handleUpdateField(field.id, { textValue: stringifyStructured({ ...data, [key]: newVal }) });
    };

    return (
      <div className="flex flex-col gap-2.5 p-2.5" onPointerDown={stop} onPointerDownCapture={stop} onMouseDown={stop} onMouseDownCapture={stop}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {keys.map(({ key, label, placeholder }) => {
            const val = data[key] || '';
            const tokens = parseTokens(val);
            const textToken = tokens.find(t => t.type === 'text') as { type: 'text'; value: string } | undefined;
            const hasLinks = tokens.some(t => t.type === 'link');
            const hasMeaningfulContent = hasContent(tokens);
            const isEditingKey = editingStructuredKey?.fieldId === field.id && editingStructuredKey?.key === key;
            const isLinkPickerOpen = linkPicker?.fieldId === field.id && linkPicker?.key === key;

            return (
              <div
                key={key}
                className={`flex flex-col rounded p-2 border transition-all relative ${keys.length === 1 ? 'sm:col-span-2' : ''} ${isLight ? 'bg-[#F9F7F3] border-[#E2D9CB]' : 'bg-black/20 border-white/10'}`}
                data-interactive="true"
                onPointerDown={stop}
                onPointerDownCapture={stop}
                onMouseDown={stop}
                onMouseDownCapture={stop}
              >
                {/* Label row */}
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-[11px] font-bold text-[#423D38] uppercase tracking-wider font-sans">{label}</span>
                  {canEdit && allItems.length > 0 && (
                    <button
                      type="button"
                      onPointerDown={stop}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isLinkPickerOpen) {
                          setLinkPicker(null);
                          setLinkSearch('');
                        } else {
                          setLinkPicker({ fieldId: field.id, key });
                          setLinkSearch('');
                          setEditingStructuredKey(null);
                        }
                      }}
                      className={`p-0.5 rounded transition-colors cursor-pointer flex-shrink-0 ${
                        isLinkPickerOpen
                          ? 'bg-[#B58D3D] text-white'
                          : 'text-[#8C7B6E] hover:text-[#B58D3D] hover:bg-[#F5EDD8]'
                      }`}
                      title="Link to a board item"
                    >
                      <LinkIcon size={10} />
                    </button>
                  )}
                </div>

                {/* Link chips (display and edit mode) */}
                {hasLinks && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {renderTokenChips(tokens, field.id, key)}
                  </div>
                )}

                {/* Text sub-field (only shows the text portion) */}
                {isEditingKey && canEdit ? (
                  <input
                    type="text"
                    autoFocus
                    value={textToken?.value || ''}
                    onChange={(e) => handleTextChange(key, e.target.value)}
                    onBlur={() => setEditingStructuredKey(null)}
                    placeholder={placeholder}
                    className="w-full text-xs py-1 px-2 bg-white border border-[#B58D3D] rounded outline-none text-[#2C2824] font-sans transition-colors"
                    onPointerDown={stop}
                    onPointerDownCapture={stop}
                    onMouseDown={stop}
                    onMouseDownCapture={stop}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter' || e.key === 'Escape') setEditingStructuredKey(null);
                    }}
                  />
                ) : (
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canEdit && !isLinkPickerOpen) setEditingStructuredKey({ fieldId: field.id, key });
                    }}
                    className={`text-xs text-[#2C2824] min-h-[22px] py-0.5 px-1.5 rounded transition-colors font-sans flex items-center justify-between gap-1 ${
                      canEdit ? 'cursor-pointer hover:bg-black/5 group/struct' : ''
                    }`}
                    title={canEdit ? `Click to edit ${label.toLowerCase()} text` : undefined}
                  >
                    {textToken?.value ? (
                      <span className="font-medium text-[#2C2824]">{textToken.value}</span>
                    ) : !hasMeaningfulContent ? (
                      <span className="text-[#8C7B6E]/60 italic text-[11px]">
                        {canEdit ? `Click to add ${label.toLowerCase()}...` : 'Not recorded'}
                      </span>
                    ) : null}
                    {canEdit && !hasLinks && <Edit3 size={10} className="opacity-0 group-hover/struct:opacity-60 text-[#8C7B6E] flex-shrink-0" />}
                  </div>
                )}

                {/* Link picker dropdown */}
                {isLinkPickerOpen && renderLinkPicker(field.id, key)}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderImageField = (field: ItemField) => {
    const isDragging = draggingFieldId === field.id;
    return (
      <div
        className={`flex flex-col gap-2 p-2.5 transition-all duration-200 rounded-lg ${
          isDragging ? 'bg-amber-500/10 ring-2 ring-[#B58D3D] border-[#B58D3D]' : ''
        }`}
        data-interactive="true"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (canEdit && draggingFieldId !== field.id) setDraggingFieldId(field.id);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (draggingFieldId === field.id) setDraggingFieldId(null);
        }}
        onDrop={(e) => {
          if (canEdit) handleImageDrop(field.id, e);
        }}
      >
        {field.imageUrl ? (
          <div className="flex flex-col gap-2 relative">
            <div className={`rounded border border-[#D9D0C1] overflow-hidden bg-black/5 relative transition-all ${
              isDragging ? 'border-[#B58D3D] shadow-md' : ''
            }`}>
              <ImageDrawer imageUrl={field.imageUrl} lines={field.lines || []} onLinesChange={(lines) => handleUpdateField(field.id, { lines })} canEdit={canEdit} />
              {isDragging && (
                <div className="absolute inset-0 bg-[#2C2824]/75 backdrop-blur-xs flex items-center justify-center pointer-events-none z-20">
                  <span className="text-white font-bold text-xs bg-[#B58D3D] px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5 animate-pulse">
                    <Upload size={14} /> Drop image to replace
                  </span>
                </div>
              )}
            </div>
            {canEdit && (
              <div className="flex items-center justify-between gap-1 text-[10px] text-[#8C7B6E]">
                <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleUpdateField(field.id, { imageUrl: '' }); }} className="text-red-600 hover:text-red-700 font-bold hover:underline flex items-center gap-1 cursor-pointer">
                  <X size={10} /><span>Remove Image</span>
                </button>
                <label onPointerDown={(e) => e.stopPropagation()} className="text-[#2C2824] hover:text-[#B58D3D] font-bold cursor-pointer flex items-center gap-1">
                  <Upload size={10} /><span>Replace File</span>
                  <input type="file" accept="image/*" onChange={(e) => handleImageFileUpload(field.id, e)} className="hidden" />
                </label>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className={`border-2 border-dashed rounded-md p-3 text-center bg-black/5 flex flex-col items-center justify-center gap-2 text-[#8C7B6E] transition-all ${
              isDragging ? 'border-[#B58D3D] bg-amber-500/10 scale-[1.01]' : 'border-[#D9D0C1]'
            }`}>
              <ImageIcon size={24} className={`opacity-50 transition-colors ${isDragging ? 'text-[#B58D3D] scale-110' : 'text-[#B58D3D]'}`} />
              <span className="text-xs font-semibold">
                {isDragging ? 'Drop image file here' : 'No image added yet'}
              </span>
              {canEdit && (
                <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                  <label onPointerDown={(e) => e.stopPropagation()} className="px-3 py-1 bg-[#2C2824] hover:bg-[#423D38] text-white text-xs font-bold rounded flex items-center gap-1 cursor-pointer transition-colors shadow-sm">
                    <Upload size={12} /><span>Upload Image</span>
                    <input type="file" accept="image/*" onChange={(e) => handleImageFileUpload(field.id, e)} className="hidden" />
                  </label>
                  <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setActiveUrlInput({ fieldId: field.id, type: 'image', text: '' }); }} className="px-3 py-1 bg-white hover:bg-[#F5F2ED] text-[#423D38] border border-[#D9D0C1] text-xs font-bold rounded flex items-center gap-1 cursor-pointer transition-colors shadow-sm">
                    <LinkIcon size={12} /><span>Link Image URL</span>
                  </button>
                </div>
              )}
            </div>
            {activeUrlInput?.fieldId === field.id && activeUrlInput.type === 'image' && (
              <div className="p-2 bg-[#F5F2ED] border border-[#D9D0C1] rounded flex flex-col gap-2 mt-1" data-interactive="true">
                <span className="text-[10px] font-bold uppercase text-[#8C7B6E]">Paste Image Web Address</span>
                <input
                  type="url"
                  value={activeUrlInput.text}
                  onChange={(e) => setActiveUrlInput({ ...activeUrlInput, text: e.target.value })}
                  placeholder="https://example.com/image.jpg"
                  className="px-2 py-1 text-xs bg-white border border-[#D9D0C1] rounded outline-none"
                  autoFocus
                  onPointerDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (activeUrlInput.text.trim()) handleUpdateField(field.id, { imageUrl: activeUrlInput.text.trim() });
                      setActiveUrlInput(null);
                    }
                  }}
                />
                <div className="flex justify-end gap-1.5">
                  <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setActiveUrlInput(null); }} className="px-2 py-0.5 text-xs text-[#8C7B6E] hover:text-[#2C2824]">Cancel</button>
                  <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); if (activeUrlInput.text.trim()) handleUpdateField(field.id, { imageUrl: activeUrlInput.text.trim() }); setActiveUrlInput(null); }} className="px-2.5 py-1 bg-[#2C2824] text-white text-xs font-bold rounded cursor-pointer">Apply Image</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render: Text Field (rich text)
  // ─────────────────────────────────────────────────────────────────────────
  const renderTextField = (field: ItemField) => (
    <div className="p-2.5">
      {editingFieldId === field.id && canEdit ? (
        <div className="flex flex-col gap-1.5" data-interactive="true">
          <RichTextEditor
            value={field.textValue || ''}
            onChange={(val) => handleUpdateField(field.id, { textValue: val })}
            placeholder={`Enter ${field.label.toLowerCase()}...`}
            isLight={isLight}
            compact={false}
            className="w-full"
          />
          <div className="flex justify-end pt-1">
            <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setEditingFieldId(null); }} className="px-2.5 py-1 bg-[#2C2824] hover:bg-[#423D38] text-white text-[11px] font-bold rounded flex items-center gap-1 cursor-pointer transition-colors shadow-sm">
              <Check size={11} /><span>Done Editing</span>
            </button>
          </div>
        </div>
      ) : (
        <div
          data-interactive="true"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); if (canEdit) setEditingFieldId(field.id); }}
          className="min-h-[36px] p-2 rounded border border-transparent hover:border-[#D9D0C1] hover:bg-black/5 transition-all cursor-text group relative font-sans text-xs"
          title={canEdit ? `Click to edit ${field.label.toLowerCase()}` : undefined}
        >
          {field.textValue ? (
            <RichTextDisplay content={field.textValue} />
          ) : (
            <span className="text-[#8C7B6E]/60 italic flex items-center gap-1 py-1">
              <Edit3 size={11} className="opacity-70" /><span>Add {field.label.toLowerCase()}...</span>
            </span>
          )}
          {canEdit && (
            <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/95 border border-[#D9D0C1] rounded px-1.5 py-0.5 text-[10px] text-[#423D38] flex items-center gap-1 shadow-sm pointer-events-none">
              <Edit3 size={10} /><span>Edit</span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Render: File Field
  // ─────────────────────────────────────────────────────────────────────────
  const renderFileField = (field: ItemField) => (
    <div className="flex flex-col gap-2 p-2.5" data-interactive="true">
      {(!field.files || field.files.length === 0) ? (
        <div className="text-center py-2 px-3 border border-dashed border-[#D9D0C1] rounded bg-black/5 text-[#8C7B6E] text-xs">No files or links attached yet.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {field.files.map((file) => (
            <div key={file.id} className="flex items-center justify-between p-2 bg-white border border-[#D9D0C1] rounded hover:border-[#B58D3D] transition-colors gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <File size={14} className="text-[#B58D3D] flex-shrink-0" />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-bold text-[#2C2824] truncate" title={file.name}>{file.name}</span>
                  {file.size && <span className="text-[10px] text-[#8C7B6E]">{formatFileSize(file.size)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <a href={file.url} target="_blank" rel="noopener noreferrer" download={file.name} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} className="p-1 text-[#423D38] hover:text-[#B58D3D] hover:bg-[#F5F2ED] rounded transition-colors" title="Open or Download">
                  <ExternalLink size={13} />
                </a>
                {canEdit && (
                  <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleRemoveFile(field.id, file.id); }} className="p-1 text-[#8C7B6E] hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer" title="Delete File">
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#F5F2ED]">
          <label onPointerDown={(e) => e.stopPropagation()} className="px-2.5 py-1 bg-[#2C2824] hover:bg-[#423D38] text-white text-[11px] font-bold rounded flex items-center gap-1 cursor-pointer transition-colors shadow-sm">
            <Upload size={11} /><span>Upload Local File</span>
            <input type="file" multiple onChange={(e) => handleDocumentFileUpload(field.id, e)} className="hidden" />
          </label>
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setActiveUrlInput({ fieldId: field.id, type: 'file', text: '', fileName: '' }); }} className="px-2.5 py-1 bg-white hover:bg-[#F5F2ED] text-[#423D38] border border-[#D9D0C1] text-[11px] font-bold rounded flex items-center gap-1 cursor-pointer transition-colors shadow-sm">
            <LinkIcon size={11} /><span>Add Web File Link</span>
          </button>
        </div>
      )}

      {activeUrlInput?.fieldId === field.id && activeUrlInput.type === 'file' && (
        <div className="p-2.5 bg-[#F5F2ED] border border-[#D9D0C1] rounded flex flex-col gap-2 mt-1" data-interactive="true">
          <span className="text-[10px] font-bold uppercase text-[#8C7B6E]">Link External Document or Web Resource</span>
          <input type="text" value={activeUrlInput.fileName || ''} onChange={(e) => setActiveUrlInput({ ...activeUrlInput, fileName: e.target.value })} placeholder="Display Name (e.g., Character Sheet PDF)" className="px-2 py-1 text-xs bg-white border border-[#D9D0C1] rounded outline-none" onPointerDown={(e) => e.stopPropagation()} />
          <input type="url" value={activeUrlInput.text} onChange={(e) => setActiveUrlInput({ ...activeUrlInput, text: e.target.value })} placeholder="URL (e.g., https://example.com/sheet.pdf)" className="px-2 py-1 text-xs bg-white border border-[#D9D0C1] rounded outline-none" onPointerDown={(e) => e.stopPropagation()} />
          <div className="flex justify-end gap-1.5 pt-1">
            <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setActiveUrlInput(null); }} className="px-2 py-0.5 text-xs text-[#8C7B6E] hover:text-[#2C2824]">Cancel</button>
            <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleAddFileUrl(field.id, activeUrlInput.text, activeUrlInput.fileName); }} className="px-2.5 py-1 bg-[#2C2824] text-white text-xs font-bold rounded cursor-pointer">Add Link</button>
          </div>
        </div>
      )}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Main render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3 font-sans w-full" onPointerDown={(e) => e.stopPropagation()}>
      {fields.map((field) => {
        const structured = isStructuredBox(field);
        return (
          <div key={field.id} className={`flex flex-col rounded-md border transition-all ${isLight ? 'bg-white/80 border-[#D9D0C1] shadow-sm' : 'bg-black/10 border-black/20'}`}>
            {/* Field Label Header */}
            <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#F5F2ED] border-b border-[#D9D0C1]/70 rounded-t-md text-xs font-bold text-[#423D38]">
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {getFieldIcon(field)}
                {editingLabelId === field.id ? (
                  <div className="flex items-center gap-1 flex-1 min-w-0" data-interactive="true">
                    <input
                      type="text"
                      value={labelInput}
                      onChange={(e) => setLabelInput(e.target.value)}
                      className="px-1 py-0.5 text-xs font-bold text-[#2C2824] bg-white border border-[#B58D3D] rounded outline-none w-full"
                      autoFocus
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { handleUpdateField(field.id, { label: labelInput.trim() || field.label }); setEditingLabelId(null); }
                        else if (e.key === 'Escape') setEditingLabelId(null);
                      }}
                    />
                    <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleUpdateField(field.id, { label: labelInput.trim() || field.label }); setEditingLabelId(null); }} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded cursor-pointer"><Check size={12} /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate font-serif italic text-sm text-[#2C2824]">{field.label}</span>
                    {structured && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-[#B58D3D]/15 text-[#8C621E] border border-[#B58D3D]/30 rounded font-sans font-semibold flex-shrink-0">
                        Quick Info
                      </span>
                    )}
                  </div>
                )}
              </div>

              {canEdit && (
                <div className="flex items-center gap-1 flex-shrink-0 ml-1" data-interactive="true">
                  {field.type === 'text' && !structured && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); setEditingFieldId(editingFieldId === field.id ? null : field.id); }}
                      className={`px-2 py-0.5 text-[10px] font-bold rounded flex items-center gap-1 cursor-pointer transition-colors ${editingFieldId === field.id ? 'bg-[#2C2824] text-white shadow-sm' : 'bg-white hover:bg-[#EBE4D8] text-[#423D38] border border-[#D9D0C1]'}`}
                    >
                      <Edit3 size={11} /><span>{editingFieldId === field.id ? 'Done' : 'Edit'}</span>
                    </button>
                  )}
                  {editingLabelId !== field.id && (
                    <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setEditingLabelId(field.id); setLabelInput(field.label); }} className="p-1 text-[#8C7B6E] hover:text-[#2C2824] hover:bg-black/5 rounded transition-colors cursor-pointer" title="Rename Field Label">
                      <Tag size={11} />
                    </button>
                  )}
                  <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); if (confirm(`Delete the "${field.label}" field?`)) handleDeleteField(field.id); }} className="p-1 text-[#8C7B6E] hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer" title="Delete Field">
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>

            {/* Field Body */}
            {structured && renderStructuredBox(field)}
            {!structured && field.type === 'text' && renderTextField(field)}
            {!structured && field.type === 'image' && renderImageField(field)}
            {!structured && field.type === 'file' && renderFileField(field)}
          </div>
        );
      })}

      {/* Add Custom Field */}
      {canEdit && (
        <div className="pt-1" data-interactive="true">
          {!showAddField ? (
            <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setShowAddField(true); }} className="w-full py-1.5 px-3 bg-[#F5F2ED] hover:bg-[#EBE4D8] border border-dashed border-[#B58D3D]/60 hover:border-[#B58D3D] text-[#B58D3D] text-xs font-bold rounded flex items-center justify-center gap-1.5 transition-colors cursor-pointer">
              <Plus size={13} /><span>Add Custom Field to {typeLabel}</span>
            </button>
          ) : (
            <div className="p-3 bg-white border border-[#B58D3D] rounded-md shadow-md flex flex-col gap-2.5" data-interactive="true">
              <div className="flex items-center justify-between border-b pb-1 border-[#F5F2ED]">
                <span className="text-xs font-bold text-[#2C2824] uppercase tracking-wider">Create New Field</span>
                <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setShowAddField(false); }} className="text-[#8C7B6E] hover:text-[#2C2824] cursor-pointer"><X size={12} /></button>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#8C7B6E] uppercase">Field Name</label>
                <input type="text" placeholder="e.g. Secret Motivation, Stat Block..." value={newFieldLabel} onChange={(e) => setNewFieldLabel(e.target.value)} className="px-2 py-1 text-xs bg-[#F5F2ED] border border-[#D9D0C1] rounded outline-none text-[#2C2824]" autoFocus onPointerDown={(e) => e.stopPropagation()} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-[#8C7B6E] uppercase">Field Type</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['text', 'image', 'file'] as FieldType[]).map((ft) => (
                    <button key={ft} type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setNewFieldType(ft); }} className={`p-2 rounded border text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${newFieldType === ft ? 'bg-[#2C2824] text-white border-[#2C2824]' : 'bg-[#F5F2ED] text-[#423D38] border-[#D9D0C1]'}`}>
                      {ft === 'text' && <FileText size={14} className={newFieldType === 'text' ? 'text-blue-400' : 'text-blue-600'} />}
                      {ft === 'image' && <ImageIcon size={14} className={newFieldType === 'image' ? 'text-amber-400' : 'text-amber-600'} />}
                      {ft === 'file' && <Paperclip size={14} className={newFieldType === 'file' ? 'text-emerald-400' : 'text-emerald-600'} />}
                      <span>{ft === 'text' ? 'Formatted Text' : ft === 'image' ? 'Image' : 'File / Links'}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-1.5 pt-1">
                <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setShowAddField(false); }} className="px-3 py-1 text-xs text-[#8C7B6E] hover:text-[#2C2824] cursor-pointer">Cancel</button>
                <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleAddField(); }} disabled={!newFieldLabel.trim()} className="px-3 py-1 bg-[#2C2824] hover:bg-[#423D38] disabled:bg-[#D9D0C1] text-white text-xs font-bold rounded transition-colors cursor-pointer">Add Field</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
