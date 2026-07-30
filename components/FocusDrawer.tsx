'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, ChevronRight, Settings, Trash2, MessageSquare, Globe, Eye, Lock,
  User as UserIcon, Send, Edit3, Check, LayoutGrid, GripVertical,
  Upload, Link as LinkIcon, Image as ImageIcon,
} from 'lucide-react';
import { BoardItem as BoardItemType, User } from '@/lib/types';
import { RichTextEditor, RichTextDisplay } from './RichTextEditor';
import NpcBoardItemFields from './NpcBoardItemFields';
import StructuredBoardItemFields, { FieldDef } from './StructuredBoardItemFields';
import ImageDrawer from './ImageDrawer';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { fileToCompressedDataURL } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface FocusDrawerProps {
  item: BoardItemType | null;
  user: User;
  allItems: BoardItemType[];
  fieldDefs: FieldDef[] | null; // null for npc (uses its own component)
  typeLabel: string;
  onUpdate: (item: BoardItemType) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onScrollToItem: (id: string) => void;
  /** Width of the drawer in px */
  width: number;
  onWidthChange: (w: number) => void;
}

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

const VISIBILITY_OPTIONS = [
  { id: 'all' as const, label: 'Public', icon: Globe, iconColor: 'text-green-500' },
  { id: 'dm' as const, label: 'DM Only', icon: Eye, iconColor: 'text-purple-500' },
  { id: 'owner' as const, label: 'Owner Only', icon: Lock, iconColor: 'text-amber-500' },
];

// ─────────────────────────────────────────────────────────────────────────────
// FocusDrawer
// ─────────────────────────────────────────────────────────────────────────────

export default function FocusDrawer({
  item,
  user,
  allItems,
  fieldDefs,
  typeLabel,
  onUpdate,
  onDelete,
  onClose,
  onScrollToItem,
  width,
  onWidthChange,
}: FocusDrawerProps) {
  const [activeTab, setActiveTab] = useState<'content' | 'comments' | 'preview'>('content');
  const [commentText, setCommentText] = useState('');
  const [isWritingComment, setIsWritingComment] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false);

  const canEdit = !item || item.ownerId === user.id || user.role === 'dm';
  const itemColor = item?.color || '#423D38';
  const isLight = isLightColor(itemColor);
  const ownerName = item?.ownerName || item?.ownerId || 'Unknown';
  const currentVisibility = VISIBILITY_OPTIONS.find(o => o.id === item?.visibility) || VISIBILITY_OPTIONS[0];
  const CurrentVisIcon = currentVisibility.icon;

  const [prevItemId, setPrevItemId] = useState<string | null>(null);
  if (item?.id !== prevItemId) {
    setPrevItemId(item?.id || null);
    setActiveTab('content');
    setShowDeleteConfirm(false);
    setIsWritingComment(false);
    setCommentText('');
    setShowVisibilityMenu(false);
  }

  // ── Resize handle ──────────────────────────────────────────────────────────
  const resizeRef = useRef<boolean>(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizeRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = width;

    const onMove = (mv: PointerEvent) => {
      if (!resizeRef.current) return;
      const delta = startXRef.current - mv.clientX; // dragging left = wider
      const newWidth = Math.max(320, Math.min(900, startWidthRef.current + delta));
      onWidthChange(newWidth);
    };
    const onUp = () => {
      resizeRef.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [width, onWidthChange]);

  // ── Comments ───────────────────────────────────────────────────────────────
  const handleAddComment = () => {
    if (!item || !commentText) return;
    const stripped = commentText.replace(/<[^>]*>/g, '').trim();
    if (!stripped && !commentText.includes('<img')) return;
    const newComment = {
      id: uuidv4(),
      userId: user.id,
      userName: user.name,
      text: commentText,
      timestamp: format(new Date(), 'MMM d, yyyy h:mm a'),
    };
    onUpdate({ ...item, comments: [...(item.comments || []), newComment] });
    setCommentText('');
    setIsWritingComment(false);
  };

  // ── Preview field selector ─────────────────────────────────────────────────
  const togglePreviewField = (fieldId: string) => {
    if (!item || !canEdit) return;
    const current = item.previewFields ?? getDefaultPreviewFields(item.type, fieldDefs);
    const next = current.includes(fieldId)
      ? current.filter(f => f !== fieldId)
      : [...current, fieldId];
    onUpdate({ ...item, previewFields: next });
  };

  const effectivePreviewFields = item
    ? (item.previewFields ?? getDefaultPreviewFields(item.type, fieldDefs))
    : [];

  if (!item) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="focus-drawer"
        initial={{ x: width }}
        animate={{ x: 0 }}
        exit={{ x: width }}
        transition={{ type: 'spring', stiffness: 380, damping: 38 }}
        style={{ width, minWidth: 320, maxWidth: 900 }}
        className="h-full bg-[#FDFAF6] border-l-2 border-[#B58D3D]/60 flex flex-col shadow-2xl relative select-none z-40"
      >
        {/* Resize handle — drag left edge to resize */}
        <div
          className="absolute top-0 left-0 w-2 h-full cursor-ew-resize z-50 group"
          onPointerDown={handleResizePointerDown}
        >
          <div className="w-full h-full opacity-0 group-hover:opacity-100 transition-opacity bg-[#B58D3D]/30 flex items-center justify-center">
            <GripVertical size={12} className="text-[#B58D3D]" />
          </div>
        </div>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div
          style={{ borderBottom: '1px solid rgba(0,0,0,0.12)' }}
          className="flex-shrink-0 bg-gradient-to-r from-[#2C2824] to-[#37332F] px-4 py-3 flex flex-col gap-2"
        >
          {/* Row 1: type badge, title, close */}
          <div className="flex items-start gap-2">
            <span
              style={{ backgroundColor: itemColor, color: isLight ? '#1F2937' : '#FFFFFF' }}
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded flex-shrink-0 mt-0.5"
            >
              {typeLabel || item.type}
            </span>
            <h2 className="flex-1 text-[#E0D8D0] font-serif font-bold italic text-lg leading-tight min-w-0 break-words">
              {item.title || 'Untitled'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-white/10 text-[#A89F91] hover:text-white transition-colors flex-shrink-0 cursor-pointer"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Row 2: owner, date, visibility */}
          <div className="flex items-center gap-2 text-[11px] text-[#A89F91]">
            <UserIcon size={11} className="text-[#B58D3D] flex-shrink-0" />
            <span className="font-semibold text-[#C9C0B1]">{ownerName}</span>
            <span className="opacity-60">·</span>
            <span className="opacity-70">{item.date}</span>

            {/* Visibility badge */}
            <div className="relative ml-auto">
              {canEdit ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowVisibilityMenu(!showVisibilityMenu); }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
                  title={`Visibility: ${currentVisibility.label}`}
                >
                  <CurrentVisIcon size={11} className={currentVisibility.iconColor} />
                  <span className="text-[10px] text-[#C9C0B1]">{currentVisibility.label}</span>
                </button>
              ) : (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 text-[10px] text-[#C9C0B1]">
                  <CurrentVisIcon size={11} className={currentVisibility.iconColor} />
                  {currentVisibility.label}
                </span>
              )}
              {showVisibilityMenu && canEdit && (
                <div className="absolute top-full right-0 mt-1 bg-[#2C2824] border border-[#B58D3D]/40 rounded-lg shadow-2xl py-1 z-50 w-40">
                  {VISIBILITY_OPTIONS.filter(opt => !(user.role === 'player' && opt.id === 'dm')).map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => { onUpdate({ ...item, visibility: opt.id }); setShowVisibilityMenu(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/10 transition-colors cursor-pointer ${item.visibility === opt.id ? 'text-[#B58D3D]' : 'text-[#C9C0B1]'}`}
                    >
                      <opt.icon size={12} className={opt.iconColor} />
                      {opt.label}
                      {item.visibility === opt.id && <Check size={11} className="ml-auto" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Row 3: Tab bar */}
          <div className="flex gap-1 mt-1">
            {(['content', ...(canEdit ? ['preview'] : []), 'comments'] as ('content' | 'preview' | 'comments')[]).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1 rounded-t text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                  activeTab === tab
                    ? 'bg-[#FDFAF6] text-[#2C2824]'
                    : 'text-[#A89F91] hover:text-[#E0D8D0] hover:bg-white/10'
                }`}
              >
                {tab === 'comments' ? `Comments (${item.comments?.length || 0})` : tab === 'preview' ? '⚙ Board Card' : 'Content'}
              </button>
            ))}
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">

          {/* CONTENT TAB */}
          {activeTab === 'content' && (
            <div className="p-4 flex flex-col gap-4">
              {/* Inline title editor */}
              {canEdit && (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#8C7B6E]">Title</label>
                  <input
                    type="text"
                    value={item.title}
                    onChange={e => onUpdate({ ...item, title: e.target.value })}
                    className="w-full border border-[#D9D0C1] rounded px-3 py-1.5 text-sm font-bold font-serif italic text-[#2C2824] focus:border-[#B58D3D] outline-none bg-white/80 transition-colors"
                    placeholder="Item title..."
                  />
                </div>
              )}

              {/* Field editors */}
              {item.type === 'npc' ? (
                <NpcBoardItemFields
                  item={item}
                  user={user}
                  canEdit={canEdit}
                  isLight={false}
                  onUpdate={onUpdate}
                  allItems={allItems}
                  onScrollToItem={onScrollToItem}
                />
              ) : fieldDefs ? (
                <StructuredBoardItemFields
                  item={item}
                  user={user}
                  canEdit={canEdit}
                  isLight={false}
                  onUpdate={onUpdate}
                  fieldDefs={fieldDefs}
                  typeLabel={typeLabel}
                  allItems={allItems}
                  onScrollToItem={onScrollToItem}
                />
              ) : item.type === 'image' ? (
                <ImageBoardItemContent item={item} canEdit={canEdit} onUpdate={onUpdate} />
              ) : (
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#8C7B6E]">Content</label>
                  <RichTextEditor
                    value={item.content || ''}
                    onChange={newContent => onUpdate({ ...item, content: newContent })}
                    placeholder={`Enter ${item.type} details...`}
                    isLight={true}
                    className="w-full"
                  />
                </div>
              )}

              {/* Delete action */}
              {canEdit && (
                <div className="mt-4 pt-4 border-t border-[#D9D0C1]">
                  {!showDeleteConfirm ? (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="flex items-center gap-1.5 text-red-500 hover:text-red-700 text-xs font-semibold cursor-pointer transition-colors"
                    >
                      <Trash2 size={13} /> Delete this item
                    </button>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[#423D38] font-semibold">Delete permanently?</span>
                      <button
                        type="button"
                        onClick={() => { onDelete(item.id); onClose(); }}
                        className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded cursor-pointer"
                      >
                        Yes, Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="px-3 py-1 bg-[#D9D0C1] hover:bg-[#C9C0B1] text-[#423D38] text-xs font-bold rounded cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* COMMENTS TAB */}
          {activeTab === 'comments' && (
            <div className="p-4 flex flex-col gap-3">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-[#8C7B6E]">
                Comments ({item.comments?.length || 0})
              </h3>
              <div className="flex flex-col gap-2.5">
                {(!item.comments || item.comments.length === 0) ? (
                  <div className="text-sm italic text-[#8C7B6E] py-4 text-center">
                    No comments yet. Be the first!
                  </div>
                ) : (
                  item.comments.map(c => (
                    <div key={c.id} className="bg-white border border-[#D9D0C1] rounded-lg p-3 text-xs text-[#423D38] relative group">
                      <div className="flex items-center justify-between font-bold text-[#8C7B6E] text-[10px] mb-1.5">
                        <span className="text-[#423D38] font-bold">{c.userName}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-normal opacity-60 italic">{c.timestamp}</span>
                          {(c.userId === user.id || user.role === 'dm' || item.ownerId === user.id) && (
                            <button
                              type="button"
                              onClick={() => onUpdate({ ...item, comments: item.comments.filter(comm => comm.id !== c.id) })}
                              className="text-red-400 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                              title="Delete comment"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-[#2C2824] leading-normal font-sans font-normal">
                        <RichTextDisplay content={c.text} />
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="pt-2 border-t border-[#D9D0C1]">
                {!isWritingComment ? (
                  <button
                    type="button"
                    onClick={() => setIsWritingComment(true)}
                    className="w-full text-left bg-white border border-[#D9D0C1] hover:border-[#B58D3D] rounded-lg px-3 py-2.5 text-sm text-[#8C7B6E] flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span>Write a comment...</span>
                    <Edit3 size={14} className="text-[#B58D3D]" />
                  </button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <RichTextEditor
                      value={commentText}
                      onChange={setCommentText}
                      placeholder="Write a formatted comment..."
                      compact={true}
                      isLight={true}
                      className="w-full"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setIsWritingComment(false); setCommentText(''); }}
                        className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-semibold rounded transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleAddComment}
                        disabled={!commentText || (!commentText.replace(/<[^>]*>/g, '').trim() && !commentText.includes('<img'))}
                        className="px-3 py-1.5 bg-[#2C2824] hover:bg-[#423D38] disabled:bg-[#D9D0C1] disabled:cursor-not-allowed text-white text-xs font-bold rounded flex items-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <Send size={12} /> Post
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* BOARD CARD PREVIEW CONFIG TAB */}
          {activeTab === 'preview' && (
            <div className="p-4 flex flex-col gap-4">
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-[#8C7B6E] mb-1">
                  Board Card Preview Fields
                </h3>
                <p className="text-xs text-[#8C7B6E] leading-relaxed">
                  Choose which fields appear directly on the board card. Everything else is accessible here in this panel.
                </p>
              </div>

              {item.type === 'npc' ? (
                <NpcPreviewFieldSelector item={item} onToggle={togglePreviewField} effectiveFields={effectivePreviewFields} />
              ) : fieldDefs ? (
                <div className="flex flex-col gap-2">
                  {fieldDefs.map(def => {
                    const isOn = effectivePreviewFields.includes(def.id);
                    return (
                      <label
                        key={def.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all select-none ${
                          isOn
                            ? 'bg-[#B58D3D]/10 border-[#B58D3D]/60 text-[#2C2824]'
                            : 'bg-white border-[#D9D0C1] text-[#8C7B6E] hover:border-[#B58D3D]/40'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isOn}
                          onChange={() => togglePreviewField(def.id)}
                          className="w-4 h-4 accent-[#B58D3D]"
                        />
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold">{def.label}</span>
                          <span className="text-[10px] opacity-70 capitalize">{def.type} field</span>
                        </div>
                        {isOn && <LayoutGrid size={13} className="ml-auto text-[#B58D3D]" />}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-[#8C7B6E] italic">
                  This item type does not have configurable preview fields.
                </div>
              )}

              <div className="pt-3 border-t border-[#D9D0C1] text-[10px] text-[#8C7B6E]">
                <span className="font-bold text-[#B58D3D]">Tip:</span> Image fields show as a thumbnail on the card. Structured fields show as compact key-value lines.
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NPC preview field selector
// ─────────────────────────────────────────────────────────────────────────────

const NPC_PREVIEW_FIELD_OPTIONS = [
  { id: 'npc-image', label: 'Character Portrait', type: 'image' },
  { id: 'npc-personality-traits', label: 'Personality & Traits', type: 'structured' },
  { id: 'npc-location', label: 'Where Met / Location', type: 'text' },
  { id: 'npc-history', label: 'History of Interactions', type: 'text' },
  { id: 'npc-other', label: 'Other Notes', type: 'text' },
];

function NpcPreviewFieldSelector({
  item, onToggle, effectiveFields,
}: {
  item: BoardItemType;
  onToggle: (id: string) => void;
  effectiveFields: string[];
}) {
  return (
    <div className="flex flex-col gap-2">
      {NPC_PREVIEW_FIELD_OPTIONS.map(def => {
        const isOn = effectiveFields.includes(def.id);
        return (
          <label
            key={def.id}
            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all select-none ${
              isOn
                ? 'bg-[#B58D3D]/10 border-[#B58D3D]/60 text-[#2C2824]'
                : 'bg-white border-[#D9D0C1] text-[#8C7B6E] hover:border-[#B58D3D]/40'
            }`}
          >
            <input
              type="checkbox"
              checked={isOn}
              onChange={() => onToggle(def.id)}
              className="w-4 h-4 accent-[#B58D3D]"
            />
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold">{def.label}</span>
              <span className="text-[10px] opacity-70 capitalize">{def.type} field</span>
            </div>
            {isOn && <LayoutGrid size={13} className="ml-auto text-[#B58D3D]" />}
          </label>
        );
      })}
    </div>
  );
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Image board item editor content
// ─────────────────────────────────────────────────────────────────────────────

function ImageBoardItemContent({
  item,
  canEdit,
  onUpdate,
}: {
  item: BoardItemType;
  canEdit: boolean;
  onUpdate: (item: BoardItemType) => void;
}) {
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInputText, setUrlInputText] = useState(item.content?.startsWith('data:') ? '' : item.content || '');
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToCompressedDataURL(file);
      onUpdate({ ...item, content: dataUrl });
      setShowUrlInput(false);
    } catch (err) {
      console.error('Error processing uploaded image:', err);
    }
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      try {
        const dataUrl = await fileToCompressedDataURL(file);
        onUpdate({ ...item, content: dataUrl });
        setShowUrlInput(false);
      } catch (err) {
        console.error('Error processing dropped image:', err);
      }
      return;
    }
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('URL');
    if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/'))) {
      onUpdate({ ...item, content: url.trim() });
      setShowUrlInput(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {item.content ? (
        <div className="flex flex-col gap-2">
          <div
            className={`rounded border bg-black/5 p-1 min-h-[250px] flex flex-col relative transition-all duration-200 ${
              isDraggingOver ? 'border-[#B58D3D] shadow-lg ring-2 ring-[#B58D3D]/40' : 'border-[#D9D0C1]'
            }`}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (canEdit) setIsDraggingOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); }}
            onDrop={canEdit ? handleDrop : undefined}
          >
            <ImageDrawer
              imageUrl={item.content}
              lines={item.lines || []}
              onLinesChange={lines => onUpdate({ ...item, lines })}
              canEdit={canEdit}
            />
            {isDraggingOver && (
              <div className="absolute inset-0 bg-[#2C2824]/70 backdrop-blur-xs flex flex-col items-center justify-center gap-2 pointer-events-none z-20 rounded">
                <Upload size={28} className="text-[#B58D3D] animate-bounce" />
                <span className="text-white font-bold text-sm bg-[#B58D3D] px-4 py-2 rounded-full shadow-lg">Drop to replace image</span>
              </div>
            )}
          </div>
          {canEdit && (
            <div className="flex flex-col gap-2 p-3 bg-[#F5F2ED] border border-[#D9D0C1] rounded-lg">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <label className="px-3 py-1.5 bg-[#2C2824] hover:bg-[#423D38] text-white font-bold rounded flex items-center gap-1.5 cursor-pointer transition-colors text-xs">
                    <Upload size={13} />
                    <span>Replace Image File</span>
                    <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setShowUrlInput(!showUrlInput);
                      setUrlInputText(item.content.startsWith('data:') ? '' : item.content);
                    }}
                    className="px-3 py-1.5 bg-white hover:bg-[#F5F2ED] text-[#423D38] border border-[#D9D0C1] font-bold rounded flex items-center gap-1.5 cursor-pointer transition-colors text-xs shadow-xs"
                  >
                    <LinkIcon size={13} />
                    <span>{showUrlInput ? 'Hide URL Input' : 'Edit Image URL'}</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onUpdate({ ...item, content: '' });
                    setShowUrlInput(false);
                  }}
                  className="text-red-600 hover:text-red-700 font-bold hover:underline flex items-center gap-1 cursor-pointer text-xs"
                >
                  <X size={13} />
                  <span>Remove Image</span>
                </button>
              </div>

              {showUrlInput && (
                <div className="flex gap-2 pt-1">
                  <input
                    type="url"
                    value={urlInputText}
                    onChange={e => setUrlInputText(e.target.value)}
                    placeholder="https://example.com/image.jpg"
                    className="flex-1 px-3 py-1.5 text-xs bg-white border border-[#D9D0C1] rounded outline-none text-[#2C2824] focus:border-[#B58D3D]"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && urlInputText.trim()) {
                        onUpdate({ ...item, content: urlInputText.trim() });
                        setShowUrlInput(false);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (urlInputText.trim()) {
                        onUpdate({ ...item, content: urlInputText.trim() });
                        setShowUrlInput(false);
                      }
                    }}
                    className="px-3 py-1.5 bg-[#2C2824] hover:bg-[#423D38] text-white text-xs font-bold rounded cursor-pointer transition-colors"
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (canEdit) setIsDraggingOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingOver(false); }}
          onDrop={canEdit ? handleDrop : undefined}
          className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-8 text-center bg-black/5 gap-4 text-[#8C7B6E] transition-all duration-200 ${
            isDraggingOver ? 'border-[#B58D3D] bg-amber-500/10 scale-[1.01] shadow-lg ring-2 ring-[#B58D3D]/30' : 'border-[#D9D0C1] hover:border-[#B58D3D]'
          }`}
        >
          <ImageIcon size={40} className="text-[#B58D3D] opacity-80" />
          <div className="flex flex-col gap-1 max-w-sm">
            <span className="text-sm font-bold text-[#423D38]">No Image Uploaded</span>
            <span className="text-xs text-[#8C7B6E]">
              Drag & drop an image file here, upload one from your device, or paste a Web URL address.
            </span>
          </div>

          {canEdit && (
            <div className="flex flex-col items-center gap-3 w-full max-w-md">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <label className="px-4 py-2 bg-[#2C2824] hover:bg-[#423D38] text-white text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer transition-colors shadow-md">
                  <Upload size={15} />
                  <span>Upload Image File</span>
                  <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                </label>
                <button
                  type="button"
                  onClick={() => setShowUrlInput(!showUrlInput)}
                  className="px-4 py-2 bg-white hover:bg-[#F5F2ED] text-[#423D38] border border-[#D9D0C1] hover:border-[#B58D3D] text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer transition-colors shadow-xs"
                >
                  <LinkIcon size={15} />
                  <span>Link Image URL</span>
                </button>
              </div>

              {showUrlInput && (
                <div className="w-full p-3 bg-white border border-[#D9D0C1] rounded-lg flex flex-col gap-2 text-left shadow-sm">
                  <label className="text-[10px] font-bold uppercase text-[#8C7B6E]">Image Web Address (URL)</label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={urlInputText}
                      onChange={e => setUrlInputText(e.target.value)}
                      placeholder="https://example.com/map.jpg"
                      className="flex-1 px-3 py-1.5 text-xs bg-white border border-[#D9D0C1] rounded outline-none text-[#2C2824] focus:border-[#B58D3D]"
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter' && urlInputText.trim()) {
                          onUpdate({ ...item, content: urlInputText.trim() });
                          setShowUrlInput(false);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (urlInputText.trim()) {
                          onUpdate({ ...item, content: urlInputText.trim() });
                          setShowUrlInput(false);
                        }
                      }}
                      className="px-3.5 py-1.5 bg-[#2C2824] hover:bg-[#423D38] text-white text-xs font-bold rounded cursor-pointer transition-colors"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
