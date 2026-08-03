'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Lock, MessageCircle } from 'lucide-react';
import { BoardItem, BoardTab, ItemType, User } from '@/lib/types';
import { buildSearchIndex, searchIndex, getRecentItemIds, SearchResult } from '@/lib/search';

// Same type colour coding used by the cross-link picker (StructuredBoardItemFields).
const TYPE_BADGE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  character: { bg: '#EFF6FF', text: '#1E3A8A', border: '#BFDBFE' },
  npc:       { bg: '#F5F3FF', text: '#5B21B6', border: '#DDD6FE' },
  faction:   { bg: '#FFF7ED', text: '#92400E', border: '#FED7AA' },
  event:     { bg: '#ECFDF5', text: '#065F46', border: '#A7F3D0' },
  location:  { bg: '#F0FDF4', text: '#166534', border: '#BBF7D0' },
  session:   { bg: '#FEF9C3', text: '#713F12', border: '#FDE68A' },
  quest:     { bg: '#FFF1F2', text: '#9F1239', border: '#FECDD3' },
  note:      { bg: '#F8FAFC', text: '#334155', border: '#CBD5E1' },
  rule:      { bg: '#F9FAFB', text: '#374151', border: '#D1D5DB' },
  loot:      { bg: '#FFFBEB', text: '#78350F', border: '#FDE68A' },
  downtime:  { bg: '#F0F9FF', text: '#0C4A6E', border: '#BAE6FD' },
  image:     { bg: '#F9FAFB', text: '#374151', border: '#D1D5DB' },
};

const ALL_TYPES: ItemType[] = [
  'character', 'npc', 'faction', 'event', 'location', 'session',
  'quest', 'note', 'rule', 'loot', 'downtime', 'image',
];

const TYPE_LABELS: Record<ItemType, string> = {
  character: 'Character',
  npc: 'NPC',
  faction: 'Faction',
  event: 'Event',
  location: 'Location',
  session: 'Session',
  quest: 'Quest',
  note: 'Note',
  rule: 'Rule',
  loot: 'Loot',
  downtime: 'Downtime',
  image: 'Image',
};

const MIN_QUERY_LENGTH = 3;

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Cross-tab board items, already per-user scrubbed by the server. */
  items: { item: BoardItem; tabId: string }[];
  tabs: BoardTab[];
  user: User;
  onNavigate: (itemId: string, openFocus: boolean) => void;
}

interface Row {
  itemId: string;
  type: ItemType;
  title: string;
  tabId: string;
  hidden: boolean;
  snippet: string | null;
  tagChip: string | null;
  commentMatch: boolean;
}

export default function GlobalSearchModal({ isOpen, onClose, items, tabs, user, onNavigate }: GlobalSearchModalProps) {
  const [query, setQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<Set<ItemType>>(new Set());
  const [includeHidden, setIncludeHidden] = useState(true);
  const [includeComments, setIncludeComments] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const viewer = useMemo(() => ({ id: user.id, role: user.role }), [user]);
  const tabNameById = useMemo(() => new Map(tabs.map((t) => [t.id, t.name])), [tabs]);

  // The modal mounts fresh on every open (Board renders it conditionally), so
  // the initial state is the per-open state and no reset effect is needed.
  const index = useMemo(
    () => buildSearchIndex(items, { viewer, includeComments, includeHidden }),
    [items, viewer, includeComments, includeHidden]
  );

  const results = useMemo<SearchResult[]>(() => {
    if (query.trim().length < MIN_QUERY_LENGTH) return [];
    return searchIndex(index, query, {
      types: [...selectedTypes],
      includeComments,
      includeHidden,
    });
  }, [index, query, selectedTypes, includeComments, includeHidden]);

  // Recent opened cards (FocusDrawer) — shown when the query is empty.
  const recentItems = useMemo(() => {
    if (query.trim()) return [];
    const ids = getRecentItemIds(user.boardId, user.id);
    const byId = new Map(items.map(({ item }) => [item.id, item]));
    const tabById = new Map(items.map(({ item, tabId }) => [item.id, tabId]));
    const rows: Row[] = [];
    for (const id of ids) {
      const item = byId.get(id);
      if (!item) continue; // deleted since it was opened
      rows.push({
        itemId: item.id,
        type: item.type,
        title: item.title || 'Untitled',
        tabId: tabById.get(item.id) || '',
        hidden: item.visibility === 'dm',
        snippet: null,
        tagChip: null,
        commentMatch: false,
      });
    }
    return rows;
  }, [query, items, user.boardId, user.id]);

  const rows: Row[] = useMemo(() => {
    if (query.trim().length >= MIN_QUERY_LENGTH) {
      return results.map((r) => ({
        itemId: r.itemId,
        type: r.type,
        title: r.title,
        tabId: r.tabId,
        hidden: r.hidden,
        snippet: r.fieldLabel ? `${r.fieldLabel}: ${r.snippet}` : r.snippet,
        tagChip: r.tagMatch ? r.snippet : null,
        commentMatch: r.commentMatch,
      }));
    }
    return recentItems;
  }, [query, results, recentItems]);

  // Focus the input when the overlay mounts.
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  // Escape closes the overlay from anywhere while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Keep the highlighted row visible during keyboard navigation.
  useEffect(() => {
    const el = listRef.current?.querySelectorAll('[data-row]')[activeIndex];
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const toggleType = (type: ItemType) => {
    setActiveIndex(0);
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (rows.length === 0 ? 0 : Math.min(i + 1, rows.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && rows[activeIndex]) {
      e.preventDefault();
      onNavigate(rows[activeIndex].itemId, e.shiftKey);
    }
  };

  if (!isOpen) return null;

  const searching = query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div className="fixed inset-0 z-[80] flex justify-center pt-10 sm:pt-16 px-2 sm:px-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="relative w-full max-w-[560px] h-fit max-h-[80vh] flex flex-col bg-[#2C2824] border border-[#B58D3D] rounded-xl shadow-2xl text-[#E0D8D0] font-sans animate-in fade-in zoom-in-95 duration-150"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#B58D3D]/25">
          <Search size={16} className="text-[#B58D3D] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setActiveIndex(0);
              setQuery(e.target.value);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Search every card on the board…"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-[#E0D8D0] placeholder:text-[#A89F91]/70"
            spellCheck={false}
          />
          <span className="hidden sm:inline text-[10px] text-[#A89F91]/80 whitespace-nowrap">
            ↑↓ navigate · Enter open · Esc close
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-[#A89F91] hover:text-white p-1 rounded hover:bg-[#37332F] cursor-pointer flex-shrink-0"
            title="Close search"
          >
            <X size={15} />
          </button>
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-1.5 flex-wrap px-4 py-2 border-b border-[#B58D3D]/15">
          {ALL_TYPES.map((type) => {
            const badge = TYPE_BADGE_STYLES[type] || TYPE_BADGE_STYLES.note;
            const isOn = selectedTypes.size === 0 || selectedTypes.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                onPointerUp={() => inputRef.current?.focus()}
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border cursor-pointer transition-all ${
                  isOn
                    ? 'bg-[#37332F] text-[#E0D8D0] border-[#5D554E] hover:border-[#B58D3D]'
                    : 'bg-transparent text-[#6B6358] border-transparent hover:border-[#5D554E]'
                }`}
                style={isOn ? { backgroundColor: badge.bg, color: badge.text, borderColor: badge.border } : undefined}
                title={`Filter by ${TYPE_LABELS[type]}`}
              >
                {TYPE_LABELS[type]}
              </button>
            );
          })}
          <div className="h-4 w-px bg-[#B58D3D]/30 mx-0.5" />
          {user.role === 'dm' && (
            <button
              type="button"
              onClick={() => {
                setActiveIndex(0);
                setIncludeHidden((v) => !v);
              }}
              onPointerUp={() => inputRef.current?.focus()}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border cursor-pointer transition-all ${
                includeHidden
                  ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                  : 'bg-transparent text-[#A89F91] border-[#5D554E] hover:border-[#B58D3D]'
              }`}
              title="Include DM-hidden content in search"
            >
              <Lock size={10} />
              <span>DM</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setActiveIndex(0);
              setIncludeComments((v) => !v);
            }}
            onPointerUp={() => inputRef.current?.focus()}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border cursor-pointer transition-all ${
              includeComments
                ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                : 'bg-transparent text-[#A89F91] border-[#5D554E] hover:border-[#B58D3D]'
            }`}
            title="Search comments too"
          >
            <MessageCircle size={10} />
            <span>Comments</span>
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto py-1.5 min-h-[80px] max-h-[50vh]">
          {!searching && recentItems.length > 0 && (
            <div className="px-3.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#A89F91]/70">
              Recent
            </div>
          )}
          {rows.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs italic text-[#A89F91]">
              {searching
                ? `No cards match '${query.trim()}'`
                : recentItems.length === 0
                  ? 'Start typing to search every card on the board.'
                  : 'No recently opened cards yet.'}
            </div>
          ) : (
            rows.map((row, i) => {
              const badge = TYPE_BADGE_STYLES[row.type] || TYPE_BADGE_STYLES.note;
              const isActive = i === activeIndex;
              return (
                <button
                  key={row.itemId}
                  data-row
                  type="button"
                  onClick={() => onNavigate(row.itemId, false)}
                  onMouseMove={() => setActiveIndex(i)}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left transition-colors cursor-pointer ${
                    isActive ? 'bg-[#37332F]' : 'hover:bg-[#37332F]/60'
                  }`}
                  title="Click to open (Shift+Enter from the keyboard opens the focus drawer)"
                >
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider flex-shrink-0 border"
                    style={{ backgroundColor: badge.bg, color: badge.text, borderColor: badge.border }}
                  >
                    {row.type}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-[#E0D8D0]">{row.title}</span>
                      {row.hidden && (
                        <span title="Contains DM-hidden content" className="flex-shrink-0">
                          <Lock size={10} className="text-[#B58D3D]" />
                        </span>
                      )}
                      {row.tagChip && (
                        <span className="inline-flex items-center px-1 rounded bg-[#B58D3D]/15 text-[#B58D3D] border border-[#B58D3D]/40 text-[9px] font-bold flex-shrink-0">
                          {row.tagChip}
                        </span>
                      )}
                      {row.commentMatch && (
                        <span title="Matched a comment" className="flex-shrink-0">
                          <MessageCircle size={10} className="text-[#A89F91]" />
                        </span>
                      )}
                    </span>
                    {row.snippet && (
                      <span className="block truncate text-[10px] text-[#A89F91] mt-0.5">{row.snippet}</span>
                    )}
                  </span>
                  <span className="text-[10px] text-[#A89F91]/80 whitespace-nowrap flex-shrink-0">
                    {tabNameById.get(row.tabId) || 'Main Board'}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
