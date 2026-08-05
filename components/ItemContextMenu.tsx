'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, FolderInput, Tag as TagIcon, Trash2 } from 'lucide-react';
import { BoardTab } from '@/lib/types';

interface ItemContextMenuProps {
  /** Cursor position in screen space — clamped to the viewport. */
  x: number;
  y: number;
  /** Number of cards the menu targets (1 = single-card menu). */
  count: number;
  /** Whether every targeted card is editable by the current user (DM edits
   *  all, others only their own). Edit actions are hidden when false. */
  canEdit: boolean;
  /** Tab list for the "Move to tab ▸" submenu (the active tab is excluded). */
  tabs: BoardTab[];
  activeTabId: string;
  onClose: () => void;
  onOpen: () => void;
  onDuplicate: () => void;
  onMoveToTab: (tabId: string) => void;
  onTag: () => void;
  onDelete: () => void;
}

const MENU_WIDTH = 220;
const MENU_HEIGHT_ESTIMATE = 260;

/**
 * Feature 04 — right-click menu for board cards (single + multi-selection).
 * Rendered fixed at the cursor, outside the canvas transform, so pan/zoom
 * never displaces it. Closes on Escape or click-away.
 */
export default function ItemContextMenu({
  x,
  y,
  count,
  canEdit,
  tabs,
  activeTabId,
  onClose,
  onOpen,
  onDuplicate,
  onMoveToTab,
  onTag,
  onDelete,
}: ItemContextMenuProps) {
  const [moveOpen, setMoveOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Screen-space position clamped to the viewport. The menu only renders in
  // the browser (it opens on a user interaction), so window is always defined.
  const pos = {
    x: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT_ESTIMATE - 8)),
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  // The "Move to tab ▸" submenu opens away from the viewport edge.
  const submenuToLeft = pos.x > window.innerWidth / 2;
  const otherTabs = tabs.filter(t => t.id !== activeTabId);
  const n = count;

  const itemClass =
    'flex items-center gap-2 w-full px-3 py-2 text-left text-xs font-semibold text-[#E0D8D0] hover:bg-[#B58D3D] hover:text-[#1C1814] transition-colors cursor-pointer';

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[220px] rounded-xl overflow-hidden shadow-2xl"
      style={{
        left: pos.x,
        top: pos.y,
        background: 'rgba(44,40,36,0.98)',
        border: '1px solid rgba(181,141,61,0.4)',
        backdropFilter: 'blur(6px)',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {n === 1 && (
        <button type="button" className={itemClass} onClick={onOpen}>
          <ExternalLink size={13} /> Open
        </button>
      )}

      {canEdit ? (
        <>
          <button type="button" className={itemClass} onClick={onDuplicate}>
            <Copy size={13} /> {n > 1 ? `Duplicate (${n})` : 'Duplicate'}
          </button>

          {otherTabs.length > 0 && (
            <div
              className="relative"
              onMouseEnter={() => setMoveOpen(true)}
              onMouseLeave={() => setMoveOpen(false)}
            >
              <div className={`${itemClass} ${moveOpen ? 'bg-[#B58D3D] text-[#1C1814]' : ''}`}>
                <FolderInput size={13} /> Move to tab <span className="ml-auto text-[10px]">▸</span>
              </div>
              {moveOpen && (
                <div
                  className="absolute top-0 w-52 rounded-lg overflow-hidden shadow-2xl"
                  style={{
                    left: submenuToLeft ? 'auto' : '100%',
                    right: submenuToLeft ? '100%' : 'auto',
                    background: 'rgba(44,40,36,0.98)',
                    border: '1px solid rgba(181,141,61,0.4)',
                  }}
                >
                  <div className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-wider text-[#8C7B6E]">
                    Move {n > 1 ? `${n} cards` : 'card'} to…
                  </div>
                  {otherTabs.map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => onMoveToTab(tab.id)}
                      className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs font-semibold text-[#E0D8D0] hover:bg-[#B58D3D] hover:text-[#1C1814] transition-colors cursor-pointer"
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: tab.color || '#3B82F6' }} />
                      <span className="truncate">{tab.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button type="button" className={itemClass} onClick={onTag}>
            <TagIcon size={13} /> Tag…
          </button>

          <div className="h-px bg-[#B58D3D]/25 my-1" />
          <button
            type="button"
            className={`${itemClass} text-red-400 hover:bg-red-600 hover:text-white`}
            onClick={onDelete}
          >
            <Trash2 size={13} /> {n > 1 ? `Delete (${n})` : 'Delete'}
          </button>
        </>
      ) : (
        <div className="px-3 py-2 text-[10px] text-[#8C7B6E] italic">
          {n > 1 ? 'These cards belong to other players.' : 'You can view this card, but only its owner or the DM can edit it.'}
        </div>
      )}
    </div>
  );
}
