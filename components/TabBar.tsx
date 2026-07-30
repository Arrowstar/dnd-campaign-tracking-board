'use client';

import { useState, useRef, useEffect } from 'react';
import { BoardTab } from '@/lib/types';
import { 
  Plus, MoreVertical, Edit2, Palette, Trash2, 
  ChevronLeft, ChevronRight, GripVertical, Check, X 
} from 'lucide-react';

export const TAB_COLOR_PRESETS = [
  { name: 'Royal Blue', hex: '#3B82F6' },
  { name: 'Crimson', hex: '#EF4444' },
  { name: 'Amber Gold', hex: '#F59E0B' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Deep Violet', hex: '#8B5CF6' },
  { name: 'Rose', hex: '#EC4899' },
  { name: 'Leather Brown', hex: '#92400E' },
  { name: 'Dark Forest', hex: '#065F46' },
  { name: 'Slate Grey', hex: '#6B7280' },
  { name: 'Teal', hex: '#14B8A6' },
];

interface TabBarProps {
  tabs: BoardTab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onAddTab: () => void;
  onRenameTab: (tabId: string, newName: string) => void;
  onChangeTabColor: (tabId: string, newColor: string) => void;
  onReorderTabs: (reorderedTabs: BoardTab[]) => void;
  onDeleteTab: (tabId: string) => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onAddTab,
  onRenameTab,
  onChangeTabColor,
  onReorderTabs,
  onDeleteTab,
}: TabBarProps) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [openMenuTabId, setOpenMenuTabId] = useState<string | null>(null);
  const [openColorTabId, setOpenColorTabId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 40, left: 0 });

  const [draggedTabIndex, setDraggedTabIndex] = useState<number | null>(null);
  const [dragOverTabIndex, setDragOverTabIndex] = useState<number | null>(null);

  const tabBarRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Close menus when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuTabId(null);
        setOpenColorTabId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus inline edit input when entering edit mode
  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTabId]);

  const handleStartRename = (tab: BoardTab) => {
    setEditingTabId(tab.id);
    setEditingName(tab.name);
    setOpenMenuTabId(null);
    setOpenColorTabId(null);
  };

  const handleSaveRename = (tabId: string) => {
    const trimmed = editingName.trim();
    if (trimmed) {
      onRenameTab(tabId, trimmed);
    }
    setEditingTabId(null);
  };

  const handleMoveTab = (index: number, direction: 'left' | 'right') => {
    const newIndex = direction === 'left' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= tabs.length) return;

    const newTabs = [...tabs];
    const [movedTab] = newTabs.splice(index, 1);
    newTabs.splice(newIndex, 0, movedTab);
    onReorderTabs(newTabs);
    setOpenMenuTabId(null);
  };

  const handleToggleMenu = (e: React.MouseEvent, tab: BoardTab) => {
    e.stopPropagation();
    if (openMenuTabId === tab.id) {
      setOpenMenuTabId(null);
      setOpenColorTabId(null);
    } else {
      const btnRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const barRect = tabBarRef.current?.getBoundingClientRect();
      if (barRect) {
        setMenuPos({
          left: Math.min(window.innerWidth - 210, Math.max(8, btnRect.left - barRect.left - 80)),
          top: btnRect.bottom - barRect.top + 4
        });
      }
      setOpenMenuTabId(tab.id);
      setOpenColorTabId(null);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedTabIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedTabIndex === null || draggedTabIndex === index) return;
    setDragOverTabIndex(index);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedTabIndex === null || draggedTabIndex === dropIndex) return;

    const newTabs = [...tabs];
    const [draggedTab] = newTabs.splice(draggedTabIndex, 1);
    newTabs.splice(dropIndex, 0, draggedTab);

    onReorderTabs(newTabs);
    setDraggedTabIndex(null);
    setDragOverTabIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedTabIndex(null);
    setDragOverTabIndex(null);
  };

  const targetTab = openMenuTabId ? tabs.find(t => t.id === openMenuTabId) : null;
  const targetTabIndex = targetTab ? tabs.findIndex(t => t.id === targetTab.id) : -1;

  return (
    <div 
      ref={tabBarRef} 
      className="bg-[#24201C] border-b border-[#B58D3D]/40 px-3 pt-1.5 flex items-center justify-between gap-2 relative z-40 shadow-md select-none flex-shrink-0 overflow-visible"
    >
      <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 scrollbar-none flex-1">
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isEditing = tab.id === editingTabId;
          const isMenuOpen = tab.id === openMenuTabId;
          const isBeingDragged = draggedTabIndex === index;
          const isDragOver = dragOverTabIndex === index;

          return (
            <div
              key={tab.id}
              draggable={!isEditing}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={`group relative flex items-center gap-1.5 px-3 py-1.5 rounded-t-md border-t-2 border-x border-b-0 text-xs font-bold transition-all cursor-pointer ${
                isActive
                  ? 'bg-[#322C27] text-[#F3EFE0] shadow-md border-b-0'
                  : 'bg-[#1C1916] text-[#A89F91] hover:bg-[#28231E] hover:text-[#E0D8D0] border-transparent opacity-85 hover:opacity-100'
              } ${
                isBeingDragged ? 'opacity-40 border-dashed border-[#B58D3D]' : ''
              } ${
                isDragOver ? 'ring-2 ring-[#B58D3D] ring-offset-1 ring-offset-[#24201C]' : ''
              }`}
              style={{
                borderTopColor: tab.color || '#3B82F6',
                borderLeftColor: isActive ? 'rgba(181, 141, 61, 0.4)' : 'transparent',
                borderRightColor: isActive ? 'rgba(181, 141, 61, 0.4)' : 'transparent',
              }}
              onClick={() => {
                if (!isEditing) onSelectTab(tab.id);
              }}
            >
              {/* Drag Handle Indicator */}
              <GripVertical 
                size={12} 
                className="opacity-0 group-hover:opacity-60 text-[#A89F91] cursor-grab active:cursor-grabbing -ml-1 transition-opacity" 
              />

              {/* Tab Color Indicator Badge */}
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-black/30 shadow-sm"
                style={{ backgroundColor: tab.color || '#3B82F6' }}
              />

              {/* Tab Label or Inline Editor */}
              {isEditing ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(tab.id);
                      if (e.key === 'Escape') setEditingTabId(null);
                    }}
                    className="bg-[#1C1916] text-[#E0D8D0] border border-[#B58D3D] rounded px-1.5 py-0.5 text-xs outline-none w-28 font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveRename(tab.id)}
                    className="text-emerald-400 hover:text-emerald-300 p-0.5 cursor-pointer"
                    title="Save"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingTabId(null)}
                    className="text-red-400 hover:text-red-300 p-0.5 cursor-pointer"
                    title="Cancel"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <span 
                  className="truncate max-w-[130px] font-serif tracking-wide"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleStartRename(tab);
                  }}
                  title={tab.name}
                >
                  {tab.name}
                </span>
              )}

              {/* Tab Actions Button (Three Dots) */}
              {!isEditing && (
                <button
                  type="button"
                  onClick={(e) => handleToggleMenu(e, tab)}
                  className={`p-1 rounded hover:bg-[#423C35] text-[#A89F91] hover:text-[#E0D8D0] transition-colors ml-1 cursor-pointer ${
                    isMenuOpen ? 'bg-[#423C35] text-white opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  title="Tab Options"
                >
                  <MoreVertical size={14} />
                </button>
              )}
            </div>
          );
        })}

        {/* Add Tab Button */}
        <button
          type="button"
          onClick={onAddTab}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-t-md text-xs font-bold bg-[#1C1916]/60 text-[#B58D3D] hover:bg-[#2C2824] hover:text-[#D4AF37] border border-dashed border-[#B58D3D]/40 transition-all cursor-pointer flex-shrink-0"
          title="Add New Board Tab"
        >
          <Plus size={14} />
          <span>New Tab</span>
        </button>
      </div>

      {/* Global Tab Options Dropdown Menu (Positioned safely outside overflow clipping) */}
      {openMenuTabId && targetTab && (
        <div
          ref={menuRef}
          style={{ position: 'absolute', top: `${menuPos.top}px`, left: `${menuPos.left}px` }}
          onClick={(e) => e.stopPropagation()}
          className="w-48 bg-[#2C2824] border border-[#B58D3D]/80 rounded-md shadow-2xl py-1 z-50 text-xs font-normal text-[#E0D8D0] animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Rename Action */}
          <button
            type="button"
            onClick={() => handleStartRename(targetTab)}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-[#37332F] text-left transition-colors cursor-pointer"
          >
            <Edit2 size={13} className="text-[#B58D3D]" />
            <span>Rename Tab</span>
          </button>

          {/* Color Action & Inline Submenu */}
          <button
            type="button"
            onClick={() => {
              setOpenColorTabId(openColorTabId === targetTab.id ? null : targetTab.id);
            }}
            className={`w-full px-3 py-1.5 flex items-center justify-between hover:bg-[#37332F] text-left transition-colors cursor-pointer ${
              openColorTabId === targetTab.id ? 'bg-[#37332F] text-white font-bold' : ''
            }`}
          >
            <div className="flex items-center gap-2">
              <Palette size={13} className="text-[#B58D3D]" />
              <span>Tab Color</span>
            </div>
            <span className="w-2.5 h-2.5 rounded-full border border-black/40 shadow-xs" style={{ backgroundColor: targetTab.color || '#3B82F6' }} />
          </button>

          {/* Color Palette Popover inside menu */}
          {openColorTabId === targetTab.id && (
            <div className="px-3 py-2 bg-[#1F1B18] border-y border-[#B58D3D]/30 my-1">
              <div className="text-[10px] uppercase font-bold text-[#B58D3D] mb-1.5">Select Color</div>
              <div className="grid grid-cols-5 gap-1.5 mb-2">
                {TAB_COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.hex}
                    type="button"
                    onClick={() => {
                      onChangeTabColor(targetTab.id, preset.hex);
                      setOpenColorTabId(null);
                      setOpenMenuTabId(null);
                    }}
                    className={`w-6 h-6 rounded-full border border-black/40 hover:scale-110 transition-transform cursor-pointer ${
                      targetTab.color === preset.hex ? 'ring-2 ring-white ring-offset-1 ring-offset-[#1F1B18]' : ''
                    }`}
                    style={{ backgroundColor: preset.hex }}
                    title={preset.name}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-[#B58D3D]/20 text-[10px]">
                <span className="text-[#A89F91]">Custom:</span>
                <div className="flex items-center gap-1">
                  <input
                    type="color"
                    value={targetTab.color || '#3B82F6'}
                    onChange={(e) => onChangeTabColor(targetTab.id, e.target.value)}
                    className="w-5 h-5 bg-transparent border-0 cursor-pointer rounded"
                  />
                  <span className="font-mono text-[#E0D8D0]">{targetTab.color || '#3B82F6'}</span>
                </div>
              </div>
            </div>
          )}

          {/* Move Left / Right Controls */}
          <div className="border-t border-[#B58D3D]/20 my-1 pt-1">
            <button
              type="button"
              disabled={targetTabIndex === 0}
              onClick={() => handleMoveTab(targetTabIndex, 'left')}
              className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-[#37332F] text-left transition-colors cursor-pointer ${
                targetTabIndex === 0 ? 'opacity-40 cursor-not-allowed' : ''
              }`}
            >
              <ChevronLeft size={13} />
              <span>Move Left</span>
            </button>
            <button
              type="button"
              disabled={targetTabIndex === tabs.length - 1}
              onClick={() => handleMoveTab(targetTabIndex, 'right')}
              className={`w-full px-3 py-1.5 flex items-center gap-2 hover:bg-[#37332F] text-left transition-colors cursor-pointer ${
                targetTabIndex === tabs.length - 1 ? 'opacity-40 cursor-not-allowed' : ''
              }`}
            >
              <ChevronRight size={13} />
              <span>Move Right</span>
            </button>
          </div>

          {/* Delete Tab */}
          {tabs.length > 1 && (
            <div className="border-t border-[#B58D3D]/20 my-1 pt-1">
              <button
                type="button"
                onClick={() => {
                  const confirmMsg = targetTab.items.length > 0 
                    ? `Are you sure you want to delete tab "${targetTab.name}"? It contains ${targetTab.items.length} item(s).`
                    : `Delete tab "${targetTab.name}"?`;
                  if (window.confirm(confirmMsg)) {
                    onDeleteTab(targetTab.id);
                  }
                  setOpenMenuTabId(null);
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-red-900/40 text-red-400 text-left transition-colors cursor-pointer font-bold"
              >
                <Trash2 size={13} />
                <span>Delete Tab</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
