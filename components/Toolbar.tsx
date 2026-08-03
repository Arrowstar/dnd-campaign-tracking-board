'use client';

import { useState } from 'react';
import { User as UserType, ItemType, AnnotationFontStyle } from '@/lib/types';
import {
  Users, User, Map, Scroll, BookOpen, Clock,
  Swords, Flag, Shield, Activity, Image as ImageIcon,
  MoveRight, X, Palette, Sliders, Minus, MoveHorizontal,
  Circle, Square, Type, Pencil, MousePointer, LogOut,
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Check, KeyRound, Keyboard,
  Undo2, Redo2, Search
} from 'lucide-react';
import { 
  ANNOTATION_COLOR_PRESETS, 
  ANNOTATION_STROKE_WIDTHS, 
  ANNOTATION_FONT_FAMILIES, 
  ANNOTATION_FONT_SIZES 
} from '@/lib/annotationUtils';

export const ARROW_COLOR_PRESETS = [
  { name: 'Slate Grey', hex: '#9CA3AF' },
  { name: 'Charcoal', hex: '#374151' },
  { name: 'Crimson', hex: '#EF4444' },
  { name: 'Amber Gold', hex: '#F59E0B' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Royal Blue', hex: '#3B82F6' },
  { name: 'Deep Violet', hex: '#8B5CF6' },
  { name: 'Rose', hex: '#EC4899' },
  { name: 'Leather Brown', hex: '#92400E' },
  { name: 'Dark Forest', hex: '#065F46' },
];

export const ARROW_LINE_STYLES = [
  { id: 'solid' as const, label: 'Solid', dash: undefined },
  { id: 'dashed' as const, label: 'Dashed', dash: '5 3' },
  { id: 'dotted' as const, label: 'Dotted', dash: '2 3' },
];

export const ARROW_LINE_WIDTHS = [
  { id: 1.5, label: 'Thin', px: 1.5 },
  { id: 3, label: 'Normal', px: 3 },
  { id: 5, label: 'Thick', px: 5 },
  { id: 8, label: 'Heavy', px: 8 },
];

interface ToolbarProps {
  user: UserType;
  isAddingConnection: boolean;
  onToggleConnection: () => void;
  connectionColor: string;
  setConnectionColor: (color: string) => void;
  connectionStyle: 'solid' | 'dashed' | 'dotted';
  setConnectionStyle: (style: 'solid' | 'dashed' | 'dotted') => void;
  connectionWidth: number;
  setConnectionWidth: (width: number) => void;
  connectionStartItemTitle?: string | null;

  // Annotations Tool Props
  activeTool: string | null;
  setActiveTool: (tool: string | null) => void;
  activeAnnColor: string;
  setActiveAnnColor: (color: string) => void;
  activeAnnStrokeWidth: number;
  setActiveAnnStrokeWidth: (width: number) => void;
  activeAnnStrokeStyle: 'solid' | 'dashed' | 'dotted';
  setActiveAnnStrokeStyle: (style: 'solid' | 'dashed' | 'dotted') => void;
  activeAnnFillColor: string;
  setActiveAnnFillColor: (color: string) => void;
  activeAnnFontStyle: AnnotationFontStyle;
  setActiveAnnFontStyle: (fontStyle: AnnotationFontStyle) => void;

  onOpenMembersModal?: () => void;
  onOpenSettingsModal?: () => void;
  onOpenBoardSettings?: () => void;
  onOpenShortcutsHelp?: () => void;
  onOpenSearch?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  /** Feature 08 — rendered as-is in the toolbar's right cluster. */
  notificationBell?: React.ReactNode;
}

export default function Toolbar({ 
  user, 
  isAddingConnection, 
  onToggleConnection,
  connectionColor,
  setConnectionColor,
  connectionStyle,
  setConnectionStyle,
  connectionWidth,
  setConnectionWidth,
  connectionStartItemTitle,

  activeTool,
  setActiveTool,
  activeAnnColor,
  setActiveAnnColor,
  activeAnnStrokeWidth,
  setActiveAnnStrokeWidth,
  activeAnnStrokeStyle,
  setActiveAnnStrokeStyle,
  activeAnnFillColor,
  setActiveAnnFillColor,
  activeAnnFontStyle,
  setActiveAnnFontStyle,

  onOpenMembersModal,
  onOpenSettingsModal,
  onOpenBoardSettings,
  onOpenShortcutsHelp,
  onOpenSearch,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  notificationBell,
}: ToolbarProps) {
  const [showConnectSettings, setShowConnectSettings] = useState(false);
  const [showAnnSettings, setShowAnnSettings] = useState(false);
  const [activeTabSetting, setActiveTabSetting] = useState<'stroke' | 'fill' | 'font'>('stroke');

  const annTools = [
    { id: null, label: 'Select / Pointer', Icon: MousePointer },
    { id: 'ann_line', label: 'Draw Line', Icon: Minus },
    { id: 'ann_arrow', label: 'Draw Arrow', Icon: MoveRight },
    { id: 'ann_double_arrow', label: 'Draw 2-Way Arrow', Icon: MoveHorizontal },
    { id: 'ann_rectangle', label: 'Draw Rectangle', Icon: Square },
    { id: 'ann_circle', label: 'Draw Circle', Icon: Circle },
    { id: 'ann_text', label: 'Draw Text', Icon: Type },
  ];

  const handleLeaveBoard = () => {
    // Return to the lobby — keep the session intact, don't log the user out.
    window.location.href = '/';
  };

  return (
    <div className="relative">
      <div className="h-16 bg-[#2C2824] border-b border-[#B58D3D] flex items-center justify-between px-4 z-50 flex-shrink-0 relative">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleLeaveBoard}
            className="w-10 h-10 bg-[#B58D3D] hover:bg-[#96722E] rounded-lg flex items-center justify-center font-serif text-2xl font-bold italic shadow-inner text-[#E0D8D0] transition-colors cursor-pointer"
            title="Return to Main Menu"
          >
            M
          </button>
          <div>
            <h1 className="text-lg font-bold text-[#E0D8D0] font-serif italic leading-tight">Board: {user.boardId}</h1>
          </div>
          <div className="h-6 w-px bg-[#B58D3D] opacity-30" />
          <div className="flex items-center gap-2">
            <span className="text-sm text-[#E0D8D0]">{user.name}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${user.role === 'dm' ? 'bg-[#5D4037] text-white border border-[#B58D3D]' : 'bg-[#4E6E5D] text-white border border-[#4E6E5D]'}`}>
              {user.role.toUpperCase()}
            </span>
          </div>

          {onOpenMembersModal && (
            <button
              type="button"
              onClick={onOpenMembersModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#37332F] hover:bg-[#423D38] border border-[#423D38] hover:border-[#B58D3D] text-[#E0D8D0] text-xs font-bold transition-all cursor-pointer shadow-xs ml-1"
              title="View and manage campaign members"
            >
              <Users size={14} className="text-[#B58D3D]" />
              <span>Members</span>
            </button>
          )}

          {onOpenSettingsModal && (
            <button
              type="button"
              onClick={onOpenSettingsModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#37332F] hover:bg-[#423D38] border border-[#423D38] hover:border-[#B58D3D] text-[#E0D8D0] text-xs font-bold transition-all cursor-pointer shadow-xs"
              title="Account settings & change password"
            >
              <KeyRound size={14} className="text-[#B58D3D]" />
              <span>Settings</span>
            </button>
          )}

          {user.role === 'dm' && onOpenBoardSettings && (
            <button
              type="button"
              onClick={onOpenBoardSettings}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#37332F] hover:bg-[#423D38] border border-[#423D38] hover:border-[#B58D3D] text-[#E0D8D0] text-xs font-bold transition-all cursor-pointer shadow-xs"
              title="Board-wide settings (card appearance, and more)"
            >
              <Sliders size={14} className="text-[#B58D3D]" />
              <span>Board</span>
            </button>
          )}

          {onOpenShortcutsHelp && (
            <button
              type="button"
              onClick={onOpenShortcutsHelp}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#37332F] hover:bg-[#423D38] border border-[#423D38] hover:border-[#B58D3D] text-[#E0D8D0] text-xs font-bold transition-all cursor-pointer shadow-xs"
              title="Keyboard shortcuts (?)"
            >
              <Keyboard size={14} className="text-[#B58D3D]" />
              <span>Shortcuts</span>
            </button>
          )}

          <div className="h-6 w-px bg-[#B58D3D] opacity-30" />

          {onUndo && (
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#37332F] hover:bg-[#423D38] border border-[#423D38] hover:border-[#B58D3D] text-[#E0D8D0] text-xs font-bold transition-all cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#37332F] disabled:hover:border-[#423D38]"
              title="Undo last change (Ctrl+Z)"
            >
              <Undo2 size={14} className="text-[#B58D3D]" />
              <span>Undo</span>
            </button>
          )}

          {onRedo && (
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#37332F] hover:bg-[#423D38] border border-[#423D38] hover:border-[#B58D3D] text-[#E0D8D0] text-xs font-bold transition-all cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#37332F] disabled:hover:border-[#423D38]"
              title="Redo last change (Ctrl+Shift+Z / Ctrl+Y)"
            >
              <Redo2 size={14} className="text-[#B58D3D]" />
              <span>Redo</span>
            </button>
          )}

          {onOpenSearch && (
            <button
              type="button"
              onClick={onOpenSearch}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#37332F] hover:bg-[#423D38] border border-[#423D38] hover:border-[#B58D3D] text-[#E0D8D0] text-xs font-bold transition-all cursor-pointer shadow-xs"
              title="Search every card on the board (Ctrl+K)"
            >
              <Search size={14} className="text-[#B58D3D]" />
              <span>Search</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleLeaveBoard}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#37332F] hover:bg-[#423D38] border border-[#423D38] hover:border-[#B58D3D] text-[#E0D8D0] text-xs font-bold transition-all cursor-pointer shadow-xs"
            title="Return to Main Menu"
          >
            <LogOut size={14} className="text-[#B58D3D]" />
            <span>Leave Board</span>
          </button>
        </div>

        <div className="flex items-center gap-3 px-2">
          {notificationBell}

          {/* Annotation Tools Selector */}
          <div className="flex items-center gap-1 bg-[#37332F] p-1 rounded-lg border border-[#423D38]">
            <span className="text-[10px] font-bold text-[#A89F91] uppercase tracking-wider px-1.5 hidden md:inline">
              Annotations:
            </span>
            <div className="flex items-center gap-0.5">
              {annTools.map((t) => {
                const isSelected = activeTool === t.id;
                const IconComponent = t.Icon;
                return (
                  <button
                    key={t.id ?? 'select'}
                    type="button"
                    onClick={() => {
                      if (isAddingConnection) onToggleConnection();
                      setActiveTool(t.id);
                    }}
                    className={`p-1.5 rounded transition-all flex items-center gap-1 cursor-pointer ${
                      isSelected
                        ? 'bg-[#B58D3D] text-white font-bold shadow-sm'
                        : 'text-[#E0D8D0] hover:bg-[#423D38]'
                    }`}
                    title={t.label}
                  >
                    <IconComponent size={15} />
                  </button>
                );
              })}
            </div>

            {/* Quick Defaults Customizer for Annotations */}
            <div className="relative border-l border-[#423D38] pl-1 ml-0.5">
              <button
                type="button"
                onClick={() => setShowAnnSettings(!showAnnSettings)}
                className={`p-1.5 rounded transition-colors flex items-center gap-1.5 cursor-pointer text-xs font-bold ${
                  showAnnSettings
                    ? 'bg-[#423D38] text-[#B58D3D]'
                    : 'text-[#A89F91] hover:text-[#E0D8D0] hover:bg-[#423D38]'
                }`}
                title="Next Annotation Appearance & Defaults"
              >
                <div className="flex items-center gap-1">
                  <div
                    className="w-3.5 h-3.5 rounded-full border border-white/40 shadow-xs"
                    style={{ backgroundColor: activeAnnColor }}
                  />
                  {activeAnnFillColor !== 'transparent' && (
                    <div
                      className="w-3.5 h-3.5 rounded-sm border border-white/40 shadow-xs -ml-1.5"
                      style={{ backgroundColor: activeAnnFillColor }}
                    />
                  )}
                </div>
                <Sliders size={13} />
                <span className="hidden lg:inline text-[11px] font-medium text-[#E0D8D0]">Defaults</span>
              </button>
            </div>
          </div>

          <div className="h-6 w-px bg-[#B58D3D] opacity-30" />

          {/* Connection Trigger & Inline Style Controls */}
          <div className="flex items-center gap-1 relative">
            <button
              onClick={() => {
                if (activeTool) setActiveTool(null);
                onToggleConnection();
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-all border shadow-sm cursor-pointer ${
                isAddingConnection 
                  ? 'bg-[#B58D3D] text-white border-[#827717] ring-2 ring-[#B58D3D]/50' 
                  : 'bg-white text-[#423D38] border-[#C9C0B1] hover:bg-[#D9D0C1]'
              }`}
            >
              {isAddingConnection ? <X size={16} /> : <MoveRight size={16} />}
              <span className="font-bold">{isAddingConnection ? 'Cancel Connect' : 'Connect'}</span>
            </button>

            {/* Quick Connection Customizer Button in Toolbar */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowConnectSettings(!showConnectSettings)}
                className={`p-1.5 rounded border transition-colors flex items-center gap-1.5 cursor-pointer ${
                  showConnectSettings || isAddingConnection
                    ? 'bg-[#423D38] border-[#B58D3D] text-[#E0D8D0]'
                    : 'bg-[#37332F] border-transparent text-[#A89F91] hover:text-[#E0D8D0] hover:bg-[#423D38]'
                }`}
                title="Configure Arrow Style & Color"
              >
                {/* Visual Line Style & Color Indicator */}
                <div className="flex items-center gap-1">
                  <div 
                    className="w-3.5 h-3.5 rounded-full border border-white/40 shadow-xs" 
                    style={{ backgroundColor: connectionColor }}
                  />
                  <svg width="18" height="10" className="text-[#E0D8D0]">
                    <line 
                      x1="0" 
                      y1="5" 
                      x2="18" 
                      y2="5" 
                      stroke={connectionColor} 
                      strokeWidth={connectionWidth} 
                      strokeDasharray={connectionStyle === 'dashed' ? '4 2' : connectionStyle === 'dotted' ? '2 2' : undefined}
                    />
                  </svg>
                </div>
                <Sliders size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Backdrop & Popover Dialog Box for Annotation Appearance Defaults */}
      {showAnnSettings && (
        <>
          <div 
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" 
            onClick={() => setShowAnnSettings(false)} 
          />
          <div
            className="fixed top-16 right-4 sm:right-16 z-50 w-96 max-h-[85vh] overflow-y-auto bg-[#2C2824] border border-[#B58D3D] rounded-xl shadow-2xl p-4 text-[#E0D8D0] font-sans text-xs animate-in fade-in zoom-in-95 duration-150"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Popover Header */}
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#B58D3D]/30">
              <div>
                <span className="text-sm font-bold font-serif italic text-[#B58D3D] flex items-center gap-1.5">
                  <Pencil size={15} /> Next Annotation Appearance
                </span>
                <p className="text-[10px] text-[#A89F91] mt-0.5">
                  Defaults for new lines, arrows, shapes, and text
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAnnSettings(false)}
                className="text-[#A89F91] hover:text-white p-1 rounded hover:bg-[#37332F] cursor-pointer"
                title="Close settings"
              >
                <X size={16} />
              </button>
            </div>

            {/* Live Visual Preview Box */}
            <div className="mb-4 p-3 bg-[#1F1C19] border border-[#423D38] rounded-lg text-center">
              <span className="text-[10px] font-bold text-[#A89F91] uppercase tracking-wider block mb-2">
                Live Preview
              </span>
              <div className="h-20 flex items-center justify-center bg-[#282420] rounded border border-dashed border-[#423D38] p-2 relative overflow-hidden">
                {/* Sample shape / line preview */}
                <svg className="w-full h-full overflow-visible">
                  {/* Rectangle/Circle shape preview */}
                  <rect
                    x="20"
                    y="10"
                    width="80"
                    height="40"
                    rx="4"
                    fill={activeAnnFillColor === 'transparent' ? 'none' : activeAnnFillColor}
                    stroke={activeAnnStrokeWidth > 0 ? activeAnnColor : 'none'}
                    strokeWidth={activeAnnStrokeWidth}
                    strokeDasharray={
                      activeAnnStrokeStyle === 'dashed'
                        ? '6 3'
                        : activeAnnStrokeStyle === 'dotted'
                        ? '2 3'
                        : undefined
                    }
                  />
                  {/* Arrow preview */}
                  <path
                    d="M 120 30 L 220 30"
                    fill="none"
                    stroke={activeAnnColor}
                    strokeWidth={activeAnnStrokeWidth || 2}
                    strokeDasharray={
                      activeAnnStrokeStyle === 'dashed'
                        ? '6 3'
                        : activeAnnStrokeStyle === 'dotted'
                        ? '2 3'
                        : undefined
                    }
                  />
                  <polygon
                    points="220,25 230,30 220,35"
                    fill={activeAnnColor}
                  />
                  {/* Text preview */}
                  <text
                    x="250"
                    y="35"
                    fill={activeAnnFontStyle.color || activeAnnColor}
                    fontFamily={activeAnnFontStyle.fontFamily || 'sans-serif'}
                    fontSize={Math.min(18, activeAnnFontStyle.fontSize || 16)}
                    fontWeight={activeAnnFontStyle.bold ? 'bold' : 'normal'}
                    fontStyle={activeAnnFontStyle.italic ? 'italic' : 'normal'}
                    textDecoration={activeAnnFontStyle.underline ? 'underline' : 'none'}
                  >
                    Aa Text
                  </text>
                </svg>
              </div>
            </div>

            {/* Category Navigation Tabs */}
            <div className="grid grid-cols-3 gap-1 bg-[#1F1C19] p-1 rounded-lg border border-[#423D38] mb-4">
              <button
                type="button"
                onClick={() => setActiveTabSetting('stroke')}
                className={`py-1.5 text-[11px] font-bold rounded transition-all cursor-pointer ${
                  activeTabSetting === 'stroke'
                    ? 'bg-[#B58D3D] text-white shadow-xs'
                    : 'text-[#A89F91] hover:text-[#E0D8D0]'
                }`}
              >
                Stroke / Line
              </button>
              <button
                type="button"
                onClick={() => setActiveTabSetting('fill')}
                className={`py-1.5 text-[11px] font-bold rounded transition-all cursor-pointer ${
                  activeTabSetting === 'fill'
                    ? 'bg-[#B58D3D] text-white shadow-xs'
                    : 'text-[#A89F91] hover:text-[#E0D8D0]'
                }`}
              >
                Fill / Background
              </button>
              <button
                type="button"
                onClick={() => setActiveTabSetting('font')}
                className={`py-1.5 text-[11px] font-bold rounded transition-all cursor-pointer ${
                  activeTabSetting === 'font'
                    ? 'bg-[#B58D3D] text-white shadow-xs'
                    : 'text-[#A89F91] hover:text-[#E0D8D0]'
                }`}
              >
                Text & Font
              </button>
            </div>

            {/* TAB 1: STROKE & LINE */}
            {activeTabSetting === 'stroke' && (
              <div className="space-y-4">
                {/* Stroke Thickness */}
                <div>
                  <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1.5">
                    Stroke Thickness
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {ANNOTATION_STROKE_WIDTHS.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => setActiveAnnStrokeWidth(w.id)}
                        className={`p-2 rounded border flex flex-col items-center justify-center text-xs font-bold transition-all cursor-pointer ${
                          activeAnnStrokeWidth === w.id
                            ? 'bg-[#B58D3D] text-white border-[#B58D3D] shadow-sm'
                            : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                        }`}
                      >
                        <svg width="32" height="10" className="mb-1">
                          <line
                            x1="2"
                            y1="5"
                            x2="30"
                            y2="5"
                            stroke={activeAnnStrokeWidth === w.id ? '#FFFFFF' : activeAnnColor}
                            strokeWidth={Math.max(1, w.id)}
                          />
                        </svg>
                        <span className="text-[10px]">{w.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stroke Style */}
                <div>
                  <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1.5">
                    Stroke Style
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['solid', 'dashed', 'dotted'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setActiveAnnStrokeStyle(st)}
                        className={`p-2 rounded border text-xs font-bold capitalize transition-all cursor-pointer flex flex-col items-center justify-center ${
                          activeAnnStrokeStyle === st
                            ? 'bg-[#B58D3D] text-white border-[#B58D3D] shadow-sm'
                            : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                        }`}
                      >
                        <svg width="32" height="10" className="mb-1">
                          <line
                            x1="2"
                            y1="5"
                            x2="30"
                            y2="5"
                            stroke={activeAnnStrokeStyle === st ? '#FFFFFF' : activeAnnColor}
                            strokeWidth={activeAnnStrokeWidth || 2}
                            strokeDasharray={
                              st === 'dashed' ? '5 3' : st === 'dotted' ? '2 3' : undefined
                            }
                          />
                        </svg>
                        <span className="text-[10px]">{st}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stroke Color */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] font-bold text-[#A89F91] uppercase tracking-wider">
                      Stroke Color
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono opacity-80">{activeAnnColor}</span>
                      <div className="w-4 h-4 rounded border border-white/50" style={{ backgroundColor: activeAnnColor }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 mb-2">
                    {ANNOTATION_COLOR_PRESETS.map((preset) => (
                      <button
                        key={preset.hex}
                        type="button"
                        style={{ backgroundColor: preset.hex }}
                        onClick={() => setActiveAnnColor(preset.hex)}
                        className={`h-7 rounded border border-black/20 shadow-xs hover:scale-105 transition-transform cursor-pointer ${
                          activeAnnColor.toLowerCase() === preset.hex.toLowerCase()
                            ? 'ring-2 ring-white ring-offset-1 ring-offset-[#2C2824]'
                            : ''
                        }`}
                        title={preset.name}
                      />
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-[#423D38]">
                    <span className="text-[10px] text-[#A89F91]">Custom Color Picker:</span>
                    <input
                      type="color"
                      value={activeAnnColor}
                      onChange={(e) => setActiveAnnColor(e.target.value)}
                      className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer p-0"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: FILL & BACKGROUND */}
            {activeTabSetting === 'fill' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1.5">
                    Quick Fill Presets
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 mb-3">
                    <button
                      type="button"
                      onClick={() => setActiveAnnFillColor('transparent')}
                      className={`py-2 px-3 rounded border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                        activeAnnFillColor === 'transparent'
                          ? 'bg-[#B58D3D] text-white border-[#B58D3D] shadow-sm'
                          : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                      }`}
                    >
                      <div className="w-3.5 h-3.5 rounded border border-white/40 bg-transparent flex items-center justify-center text-[10px] font-bold">∅</div>
                      <span>Transparent (No Fill)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveAnnFillColor('rgba(239, 68, 68, 0.2)')}
                      className={`py-2 px-3 rounded border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                        activeAnnFillColor === 'rgba(239, 68, 68, 0.2)'
                          ? 'bg-[#B58D3D] text-white border-[#B58D3D] shadow-sm'
                          : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                      }`}
                    >
                      <div className="w-3.5 h-3.5 rounded border border-white/40 bg-red-500/20" />
                      <span>Red Tint (20%)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveAnnFillColor('rgba(245, 158, 11, 0.2)')}
                      className={`py-2 px-3 rounded border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                        activeAnnFillColor === 'rgba(245, 158, 11, 0.2)'
                          ? 'bg-[#B58D3D] text-white border-[#B58D3D] shadow-sm'
                          : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                      }`}
                    >
                      <div className="w-3.5 h-3.5 rounded border border-white/40 bg-amber-500/20" />
                      <span>Amber Tint (20%)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveAnnFillColor('rgba(59, 130, 246, 0.2)')}
                      className={`py-2 px-3 rounded border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                        activeAnnFillColor === 'rgba(59, 130, 246, 0.2)'
                          ? 'bg-[#B58D3D] text-white border-[#B58D3D] shadow-sm'
                          : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                      }`}
                    >
                      <div className="w-3.5 h-3.5 rounded border border-white/40 bg-blue-500/20" />
                      <span>Blue Tint (20%)</span>
                    </button>
                  </div>
                </div>

                {/* Fill Palette */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] font-bold text-[#A89F91] uppercase tracking-wider">
                      Solid Fill Colors
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono opacity-80">
                        {activeAnnFillColor === 'transparent' ? 'None' : activeAnnFillColor}
                      </span>
                      <div className="w-4 h-4 rounded border border-white/50" style={{ backgroundColor: activeAnnFillColor }} />
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5 mb-2">
                    {ANNOTATION_COLOR_PRESETS.map((preset) => (
                      <button
                        key={preset.hex}
                        type="button"
                        style={{ backgroundColor: preset.hex }}
                        onClick={() => setActiveAnnFillColor(preset.hex)}
                        className={`h-7 rounded border border-black/20 shadow-xs hover:scale-105 transition-transform cursor-pointer ${
                          activeAnnFillColor.toLowerCase() === preset.hex.toLowerCase()
                            ? 'ring-2 ring-white ring-offset-1 ring-offset-[#2C2824]'
                            : ''
                        }`}
                        title={preset.name}
                      />
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-[#423D38]">
                    <span className="text-[10px] text-[#A89F91]">Custom Fill Color:</span>
                    <input
                      type="color"
                      value={activeAnnFillColor === 'transparent' ? '#ffffff' : activeAnnFillColor}
                      onChange={(e) => setActiveAnnFillColor(e.target.value)}
                      className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer p-0"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: TEXT & FONT */}
            {activeTabSetting === 'font' && (
              <div className="space-y-3.5">
                {/* Font Family */}
                <div>
                  <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1">
                    Font Family
                  </label>
                  <select
                    value={activeAnnFontStyle.fontFamily || 'sans-serif'}
                    onChange={(e) =>
                      setActiveAnnFontStyle({ ...activeAnnFontStyle, fontFamily: e.target.value })
                    }
                    className="w-full bg-[#37332F] border border-[#423D38] text-[#E0D8D0] px-2.5 py-1.5 rounded text-xs outline-none focus:border-[#B58D3D] font-medium"
                  >
                    {ANNOTATION_FONT_FAMILIES.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Font Size */}
                <div>
                  <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1">
                    Font Size ({activeAnnFontStyle.fontSize || 18}px)
                  </label>
                  <div className="grid grid-cols-5 gap-1">
                    {ANNOTATION_FONT_SIZES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          setActiveAnnFontStyle({ ...activeAnnFontStyle, fontSize: s })
                        }
                        className={`p-1 rounded border text-[11px] font-mono cursor-pointer ${
                          (activeAnnFontStyle.fontSize || 18) === s
                            ? 'bg-[#B58D3D] text-white border-[#B58D3D] font-bold'
                            : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Formatting Toggles */}
                <div>
                  <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1">
                    Text Formatting
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setActiveAnnFontStyle({
                          ...activeAnnFontStyle,
                          bold: !activeAnnFontStyle.bold,
                        })
                      }
                      className={`p-2 rounded border flex-1 flex items-center justify-center cursor-pointer ${
                        activeAnnFontStyle.bold
                          ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                          : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                      }`}
                      title="Toggle Bold"
                    >
                      <Bold size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setActiveAnnFontStyle({
                          ...activeAnnFontStyle,
                          italic: !activeAnnFontStyle.italic,
                        })
                      }
                      className={`p-2 rounded border flex-1 flex items-center justify-center cursor-pointer ${
                        activeAnnFontStyle.italic
                          ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                          : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                      }`}
                      title="Toggle Italic"
                    >
                      <Italic size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setActiveAnnFontStyle({
                          ...activeAnnFontStyle,
                          underline: !activeAnnFontStyle.underline,
                        })
                      }
                      className={`p-2 rounded border flex-1 flex items-center justify-center cursor-pointer ${
                        activeAnnFontStyle.underline
                          ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                          : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                      }`}
                      title="Toggle Underline"
                    >
                      <Underline size={14} />
                    </button>
                  </div>
                </div>

                {/* Text Alignment */}
                <div>
                  <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1">
                    Text Alignment
                  </label>
                  <div className="grid grid-cols-3 gap-1">
                    {(['left', 'center', 'right'] as const).map((align) => (
                      <button
                        key={align}
                        type="button"
                        onClick={() =>
                          setActiveAnnFontStyle({ ...activeAnnFontStyle, align })
                        }
                        className={`p-1.5 rounded border flex items-center justify-center cursor-pointer capitalize text-xs ${
                          (activeAnnFontStyle.align || 'left') === align
                            ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                            : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                        }`}
                      >
                        {align === 'left' && <AlignLeft size={14} />}
                        {align === 'center' && <AlignCenter size={14} />}
                        {align === 'right' && <AlignRight size={14} />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Text Color */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-bold text-[#A89F91] uppercase tracking-wider">
                      Text Color
                    </label>
                    <div
                      className="w-4 h-4 rounded border border-white/50"
                      style={{ backgroundColor: activeAnnFontStyle.color || activeAnnColor }}
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-[#423D38]">
                    <span className="text-[10px] text-[#A89F91]">Pick Text Color:</span>
                    <input
                      type="color"
                      value={activeAnnFontStyle.color || activeAnnColor}
                      onChange={(e) =>
                        setActiveAnnFontStyle({ ...activeAnnFontStyle, color: e.target.value })
                      }
                      className="w-7 h-7 rounded border-0 bg-transparent cursor-pointer p-0"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Popover Footer Button */}
            <div className="mt-5 pt-3 border-t border-[#B58D3D]/30 flex justify-end">
              <button
                type="button"
                onClick={() => setShowAnnSettings(false)}
                className="px-4 py-1.5 rounded bg-[#B58D3D] text-white font-bold hover:bg-[#8F6E2E] transition-colors cursor-pointer text-xs shadow-sm flex items-center gap-1.5"
              >
                <Check size={14} /> Done
              </button>
            </div>
          </div>
        </>
      )}

      {/* Backdrop & Popover for Arrow / Connection Style */}
      {showConnectSettings && (
        <>
          <div 
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" 
            onClick={() => setShowConnectSettings(false)} 
          />
          <div 
            className="fixed top-16 right-4 sm:right-16 z-50 w-80 bg-[#2C2824] border border-[#B58D3D] rounded-xl shadow-2xl p-4 text-[#E0D8D0] font-sans text-xs animate-in fade-in zoom-in-95 duration-150"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#B58D3D]/30">
              <span className="text-xs font-bold font-serif italic text-[#B58D3D] flex items-center gap-1.5">
                <MoveRight size={14} /> Arrow Customization
              </span>
              <button 
                type="button"
                onClick={() => setShowConnectSettings(false)}
                className="text-[#A89F91] hover:text-white p-1 rounded hover:bg-[#37332F] cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            {/* Line Style Selector */}
            <div className="mb-3">
              <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1.5">
                Arrow Line Style
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {ARROW_LINE_STYLES.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setConnectionStyle(s.id)}
                    className={`flex flex-col items-center justify-center p-2 rounded border text-xs font-bold transition-all cursor-pointer ${
                      connectionStyle === s.id
                        ? 'bg-[#B58D3D] text-white border-[#B58D3D] shadow-md'
                        : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                    }`}
                  >
                    <svg width="32" height="12" className="mb-1">
                      <line
                        x1="2"
                        y1="6"
                        x2="30"
                        y2="6"
                        stroke={connectionStyle === s.id ? '#FFFFFF' : connectionColor}
                        strokeWidth={connectionWidth}
                        strokeDasharray={s.dash}
                      />
                    </svg>
                    <span className="text-[10px]">{s.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Line Width Selector */}
            <div className="mb-3">
              <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1.5">
                Line Thickness
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {ARROW_LINE_WIDTHS.map(w => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setConnectionWidth(w.px)}
                    className={`flex flex-col items-center justify-center p-2 rounded border text-xs font-bold transition-all cursor-pointer ${
                      connectionWidth === w.px
                        ? 'bg-[#B58D3D] text-white border-[#B58D3D] shadow-md'
                        : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                    }`}
                  >
                    <svg width="28" height="12" className="mb-1">
                      <line
                        x1="2"
                        y1="6"
                        x2="26"
                        y2="6"
                        stroke={connectionWidth === w.px ? '#FFFFFF' : connectionColor}
                        strokeWidth={w.px}
                        strokeDasharray={connectionStyle === 'dashed' ? '4 2' : connectionStyle === 'dotted' ? '2 2' : undefined}
                      />
                    </svg>
                    <span className="text-[10px]">{w.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Line Color Selector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-bold text-[#A89F91] uppercase tracking-wider">
                  Arrow Color
                </label>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-[10px] font-mono opacity-80">{connectionColor}</span>
                  <div className="w-3.5 h-3.5 rounded border border-white/50" style={{ backgroundColor: connectionColor }} />
                </div>
              </div>
              <div className="grid grid-cols-5 gap-1.5 mb-2.5">
                {ARROW_COLOR_PRESETS.map(preset => (
                  <button
                    key={preset.hex}
                    type="button"
                    style={{ backgroundColor: preset.hex }}
                    onClick={() => setConnectionColor(preset.hex)}
                    className={`w-7 h-7 rounded-md border border-black/20 shadow-xs hover:scale-110 transition-transform cursor-pointer ${
                      connectionColor.toLowerCase() === preset.hex.toLowerCase() 
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-[#2C2824]' 
                        : ''
                    }`}
                    title={preset.name}
                  />
                ))}
              </div>

              {/* Native Custom Color Picker Option */}
              <div className="flex items-center justify-between pt-2 border-t border-[#B58D3D]/20 text-xs">
                <span className="text-[11px] text-[#A89F91] flex items-center gap-1">
                  <Palette size={12} className="text-[#B58D3D]" /> Custom Color Picker
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={connectionColor}
                    onChange={e => setConnectionColor(e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent p-0"
                    title="Click to pick any custom color"
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Active Connect Mode Guidance Sub-Bar */}
      {isAddingConnection && (
        <div className="bg-[#B58D3D] text-[#2C2824] px-4 py-1.5 flex items-center justify-between shadow-md text-xs font-bold font-sans animate-in slide-in-from-top-2 duration-150 z-40 relative">
          <div className="flex items-center gap-2">
            <MoveRight size={14} className="animate-pulse" />
            <span>
              {connectionStartItemTitle 
                ? `Connecting from "${connectionStartItemTitle}" ➔ Click a second card to connect.`
                : 'Connection Mode: Click any card on the board to start arrow, then click target card.'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-[#2C2824]/10 px-2 py-0.5 rounded border border-[#2C2824]/20">
              <span className="text-[10px] uppercase tracking-wider opacity-80">Style:</span>
              <span className="capitalize">{connectionStyle}</span>
              <div className="w-2.5 h-2.5 rounded-full border border-[#2C2824]/30" style={{ backgroundColor: connectionColor }} />
            </div>
            <button
              onClick={onToggleConnection}
              className="px-2 py-0.5 bg-[#2C2824] text-white hover:bg-[#423D38] rounded text-[11px] font-bold cursor-pointer transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
