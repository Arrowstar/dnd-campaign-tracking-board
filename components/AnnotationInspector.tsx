'use client';

import { useState } from 'react';
import { BoardAnnotation, BoardItem, AnnotationFontStyle } from '@/lib/types';
import { 
  ANNOTATION_COLOR_PRESETS, 
  ANNOTATION_FONT_FAMILIES, 
  ANNOTATION_FONT_SIZES, 
  ANNOTATION_STROKE_WIDTHS, 
  getMaxPinsForType,
  getResolvedControlPoints,
} from '@/lib/annotationUtils';
import { 
  X, Trash2, Check, Sliders, Palette, Type, Pin, Unlink,
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Minimize2
} from 'lucide-react';

interface AnnotationInspectorProps {
  annotation: BoardAnnotation;
  items: BoardItem[];
  onUpdate: (updated: BoardAnnotation) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onStartDragPinHandle?: (annId: string, pinIndex: number, e: React.PointerEvent) => void;
  onMinimize?: () => void;
}

export default function AnnotationInspector({
  annotation,
  items,
  onUpdate,
  onDelete,
  onClose,
  onStartDragPinHandle,
  onMinimize,
}: AnnotationInspectorProps) {
  const [activeTab, setActiveTab] = useState<'style' | 'text' | 'pins'>(
    annotation.type === 'text' ? 'text' : 'style'
  );

  const strokeColor = annotation.strokeColor || '#EF4444';
  const strokeWidth = annotation.strokeWidth !== undefined ? annotation.strokeWidth : 3;
  const strokeStyle = annotation.strokeStyle || 'solid';
  const fillColor = annotation.fillColor || 'transparent';

  const fontStyle: AnnotationFontStyle = annotation.fontStyle || {
    fontFamily: 'sans-serif',
    fontSize: 18,
    color: '#1F2937',
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
  };

  const maxPins = getMaxPinsForType(annotation.type);
  const pins = annotation.pins || [];

  const handleUpdateFont = (updates: Partial<AnnotationFontStyle>) => {
    onUpdate({
      ...annotation,
      fontStyle: {
        ...fontStyle,
        ...updates,
      },
    });
  };

  const handlePinToItem = (pinIndex: number, itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;

    let targetX = annotation.x;
    let targetY = annotation.y;

    if (pinIndex === 1) {
      targetX = annotation.x2 ?? annotation.x + (annotation.width || 100);
      targetY = annotation.y2 ?? annotation.y + (annotation.height || 100);
    }

    const newPins = [...pins];
    while (newPins.length <= pinIndex) newPins.push(null);

    newPins[pinIndex] = {
      itemId: item.id,
      offsetX: targetX - item.x,
      offsetY: targetY - item.y,
    };

    onUpdate({
      ...annotation,
      pins: newPins,
    });
  };

  const handleUnpin = (pinIndex: number) => {
    const geom = getResolvedControlPoints(annotation, items);
    const newPins = [...pins];
    newPins[pinIndex] = null;
    const hasRemainingPins = newPins.some(Boolean);

    onUpdate({
      ...annotation,
      x: geom.x1 ?? geom.x ?? annotation.x,
      y: geom.y1 ?? geom.y ?? annotation.y,
      x2: geom.x2 ?? annotation.x2,
      y2: geom.y2 ?? annotation.y2,
      width: geom.width ?? annotation.width,
      height: geom.height ?? annotation.height,
      pins: hasRemainingPins ? newPins : undefined,
    });
  };

  const handleUnpinAll = () => {
    const geom = getResolvedControlPoints(annotation, items);
    onUpdate({
      ...annotation,
      x: geom.x1 ?? geom.x ?? annotation.x,
      y: geom.y1 ?? geom.y ?? annotation.y,
      x2: geom.x2 ?? annotation.x2,
      y2: geom.y2 ?? annotation.y2,
      width: geom.width ?? annotation.width,
      height: geom.height ?? annotation.height,
      pins: undefined,
    });
  };

  return (
    <div
      className="bg-[#2C2824] border border-[#B58D3D] rounded-xl shadow-2xl p-3.5 text-[#E0D8D0] font-sans text-xs w-80 z-50 animate-in fade-in zoom-in-95 duration-150"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#B58D3D]/30">
        <div className="flex items-center gap-1.5 font-bold font-serif italic text-[#B58D3D]">
          <Sliders size={14} />
          <span className="capitalize">{annotation.type.replace('_', ' ')} Annotation</span>
        </div>
        <div className="flex items-center gap-1">
          {onMinimize && (
            <button
              onClick={onMinimize}
              className="text-[#A89F91] hover:text-[#B58D3D] p-1 rounded cursor-pointer transition-colors"
              title="Minimize to Quick Bar"
            >
              <Minimize2 size={13} />
            </button>
          )}
          <button
            onClick={onClose}
            className="text-[#A89F91] hover:text-white p-1 rounded cursor-pointer transition-colors"
            title="Close Inspector"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#423D38] mb-3">
        <button
          type="button"
          onClick={() => setActiveTab('style')}
          className={`px-3 py-1.5 font-bold text-[11px] border-b-2 transition-colors cursor-pointer flex items-center gap-1 ${
            activeTab === 'style'
              ? 'border-[#B58D3D] text-[#B58D3D]'
              : 'border-transparent text-[#A89F91] hover:text-[#E0D8D0]'
          }`}
        >
          <Palette size={12} />
          <span>Style</span>
        </button>

        {annotation.type === 'text' && (
          <button
            type="button"
            onClick={() => setActiveTab('text')}
            className={`px-3 py-1.5 font-bold text-[11px] border-b-2 transition-colors cursor-pointer flex items-center gap-1 ${
              activeTab === 'text'
                ? 'border-[#B58D3D] text-[#B58D3D]'
                : 'border-transparent text-[#A89F91] hover:text-[#E0D8D0]'
            }`}
          >
            <Type size={12} />
            <span>Text & Font</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab('pins')}
          className={`px-3 py-1.5 font-bold text-[11px] border-b-2 transition-colors cursor-pointer flex items-center gap-1 ${
            activeTab === 'pins'
              ? 'border-[#B58D3D] text-[#B58D3D]'
              : 'border-transparent text-[#A89F91] hover:text-[#E0D8D0]'
          }`}
        >
          <Pin size={12} />
          <span>Pins ({pins.filter(Boolean).length}/{maxPins})</span>
        </button>
      </div>

      {/* STYLE TAB */}
      {activeTab === 'style' && (
        <div className="space-y-3">
          {/* Stroke Line Width */}
          <div>
            <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1">
              Line Thickness
            </label>
            <div className="grid grid-cols-6 gap-1">
              {ANNOTATION_STROKE_WIDTHS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => onUpdate({ ...annotation, strokeWidth: w.id })}
                  className={`p-1.5 rounded border flex flex-col items-center justify-center transition-all cursor-pointer ${
                    strokeWidth === w.id
                      ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                      : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                  }`}
                  title={w.label}
                >
                  <svg width="24" height="8">
                    {w.id === 0 ? (
                      <text x="12" y="7" textAnchor="middle" fontSize="7" fill={strokeWidth === 0 ? '#FFFFFF' : '#A89F91'} fontWeight="bold">OFF</text>
                    ) : (
                      <line
                        x1="0"
                        y1="4"
                        x2="24"
                        y2="4"
                        stroke={strokeWidth === w.id ? '#FFFFFF' : strokeColor}
                        strokeWidth={w.id}
                      />
                    )}
                  </svg>
                  <span className="text-[9px] font-mono mt-0.5">{w.id === 0 ? 'None' : `${w.id}px`}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Stroke Style */}
          <div>
            <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1">
              Line Style
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: 'solid', label: 'Solid', dash: undefined },
                { id: 'dashed', label: 'Dashed', dash: '5 3' },
                { id: 'dotted', label: 'Dotted', dash: '2 3' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onUpdate({ ...annotation, strokeStyle: s.id as 'solid' | 'dashed' | 'dotted' })}
                  className={`p-1.5 rounded border flex flex-col items-center justify-center text-[10px] font-bold transition-all cursor-pointer ${
                    strokeStyle === s.id
                      ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                      : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                  }`}
                >
                  <svg width="32" height="8" className="mb-0.5">
                    <line
                      x1="0"
                      y1="4"
                      x2="32"
                      y2="4"
                      stroke={strokeStyle === s.id ? '#FFFFFF' : strokeColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray={s.dash}
                    />
                  </svg>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Stroke Color */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-bold text-[#A89F91] uppercase tracking-wider">
                Line Color
              </label>
              <div className="flex items-center gap-1.5 text-[10px] font-mono">
                <span>{strokeColor}</span>
                <div className="w-3 h-3 rounded border border-white/50" style={{ backgroundColor: strokeColor }} />
              </div>
            </div>
            <div className="grid grid-cols-5 gap-1 mb-1.5">
              {ANNOTATION_COLOR_PRESETS.map((p) => (
                <button
                  key={p.hex}
                  type="button"
                  style={{ backgroundColor: p.hex }}
                  onClick={() => onUpdate({ ...annotation, strokeColor: p.hex })}
                  className={`h-6 rounded border border-black/30 cursor-pointer transition-transform hover:scale-105 ${
                    strokeColor.toLowerCase() === p.hex.toLowerCase()
                      ? 'ring-2 ring-white ring-offset-1 ring-offset-[#2C2824]'
                      : ''
                  }`}
                  title={p.name}
                />
              ))}
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-[#423D38]">
              <span className="text-[10px] text-[#A89F91]">Custom Color:</span>
              <input
                type="color"
                value={strokeColor}
                onChange={(e) => onUpdate({ ...annotation, strokeColor: e.target.value })}
                className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer p-0"
              />
            </div>
          </div>

          {/* Fill Color for shapes and text */}
          {(annotation.type === 'rectangle' || annotation.type === 'circle' || annotation.type === 'text') && (
            <div className="pt-2 border-t border-[#423D38]">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-bold text-[#A89F91] uppercase tracking-wider">
                  Fill / Background Color
                </label>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span>{fillColor === 'transparent' ? 'None' : fillColor}</span>
                  <div className="w-3 h-3 rounded border border-white/50" style={{ backgroundColor: fillColor === 'transparent' ? '#00000000' : fillColor }} />
                </div>
              </div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <button
                  type="button"
                  onClick={() => onUpdate({ ...annotation, fillColor: 'transparent' })}
                  className={`px-2 py-1 rounded border text-[10px] font-bold cursor-pointer ${
                    fillColor === 'transparent'
                      ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                      : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38]'
                  }`}
                >
                  Transparent
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate({ ...annotation, fillColor: `${strokeColor}22` })}
                  className="px-2 py-1 rounded border bg-[#37332F] text-[#E0D8D0] border-[#423D38] text-[10px] font-bold cursor-pointer hover:bg-[#423D38]"
                >
                  Light Tint (15%)
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#A89F91]">Solid Custom Fill:</span>
                <input
                  type="color"
                  value={fillColor === 'transparent' ? '#ffffff' : fillColor}
                  onChange={(e) => onUpdate({ ...annotation, fillColor: e.target.value })}
                  className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer p-0"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* TEXT TAB */}
      {activeTab === 'text' && annotation.type === 'text' && (
        <div className="space-y-3">
          {/* Text Input Content */}
          <div>
            <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1">
              Text Content
            </label>
            <textarea
              value={annotation.text || ''}
              onChange={(e) => onUpdate({ ...annotation, text: e.target.value })}
              className="w-full h-20 bg-[#37332F] border border-[#423D38] focus:border-[#B58D3D] text-white rounded p-2 text-xs outline-none resize-none font-sans"
              placeholder="Enter annotation text..."
            />
          </div>

          {/* Font Family Selector */}
          <div>
            <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1">
              Font Family
            </label>
            <select
              value={fontStyle.fontFamily || 'sans-serif'}
              onChange={(e) => handleUpdateFont({ fontFamily: e.target.value })}
              className="w-full bg-[#37332F] border border-[#423D38] text-white rounded p-1.5 text-xs outline-none cursor-pointer"
            >
              {ANNOTATION_FONT_FAMILIES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          {/* Font Size & Color */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1">
                Font Size
              </label>
              <select
                value={fontStyle.fontSize || 18}
                onChange={(e) => handleUpdateFont({ fontSize: Number(e.target.value) })}
                className="w-full bg-[#37332F] border border-[#423D38] text-white rounded p-1.5 text-xs outline-none cursor-pointer"
              >
                {ANNOTATION_FONT_SIZES.map((sz) => (
                  <option key={sz} value={sz}>
                    {sz} px
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1">
                Text Color
              </label>
              <div className="flex items-center gap-2 bg-[#37332F] border border-[#423D38] rounded p-1">
                <input
                  type="color"
                  value={fontStyle.color || '#1F2937'}
                  onChange={(e) => handleUpdateFont({ color: e.target.value })}
                  className="w-5 h-5 rounded border-0 bg-transparent cursor-pointer p-0"
                />
                <span className="text-[10px] font-mono">{fontStyle.color || '#1F2937'}</span>
              </div>
            </div>
          </div>

          {/* Font Styling Controls: Bold, Italic, Underline, Alignment */}
          <div>
            <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1">
              Text Formatting
            </label>
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleUpdateFont({ bold: !fontStyle.bold })}
                  className={`p-1.5 rounded border transition-colors cursor-pointer ${
                    fontStyle.bold
                      ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                      : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                  }`}
                  title="Bold"
                >
                  <Bold size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateFont({ italic: !fontStyle.italic })}
                  className={`p-1.5 rounded border transition-colors cursor-pointer ${
                    fontStyle.italic
                      ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                      : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                  }`}
                  title="Italic"
                >
                  <Italic size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateFont({ underline: !fontStyle.underline })}
                  className={`p-1.5 rounded border transition-colors cursor-pointer ${
                    fontStyle.underline
                      ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                      : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                  }`}
                  title="Underline"
                >
                  <Underline size={14} />
                </button>
              </div>

              <div className="flex items-center gap-1">
                {[
                  { id: 'left', Icon: AlignLeft },
                  { id: 'center', Icon: AlignCenter },
                  { id: 'right', Icon: AlignRight },
                ].map(({ id, Icon }) => {
                  const currentAlign = fontStyle.align || 'left';
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleUpdateFont({ align: id as 'left' | 'center' | 'right' })}
                      className={`p-1.5 rounded border transition-colors cursor-pointer ${
                        currentAlign === id
                          ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                          : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                      }`}
                      title={`Align ${id}`}
                    >
                      <Icon size={14} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Text Box Border Toggle */}
          <div>
            <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1">
              Text Box Border
            </label>
            <button
              type="button"
              onClick={() => onUpdate({ ...annotation, strokeWidth: strokeWidth === 0 ? 1.5 : 0 })}
              className={`w-full py-1.5 px-3 rounded border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                strokeWidth === 0
                  ? 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                  : 'bg-[#B58D3D] text-white border-[#B58D3D]'
              }`}
            >
              <span>{strokeWidth === 0 ? '🚫 Border Removed (Clean Text)' : '✏️ Border Visible (Click to Remove)'}</span>
            </button>
          </div>
        </div>
      )}

      {/* PINS TAB */}
      {activeTab === 'pins' && (
        <div className="space-y-3">
          <p className="text-[11px] text-[#A89F91] leading-relaxed">
            Pins attach control points of this annotation to specific board items. When pinned items are moved, the annotation automatically tracks them!
          </p>

          {pins.some((p) => p && items.some((i) => i.id === p.itemId)) && (
            <button
              type="button"
              onClick={handleUnpinAll}
              className="w-full py-1.5 px-3 bg-red-900/40 hover:bg-red-800/80 border border-red-700/50 text-red-200 rounded text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Unlink size={13} />
              <span>Unpin All Points</span>
            </button>
          )}

          <div className="space-y-2">
            {Array.from({ length: maxPins }).map((_, idx) => {
              const currentPin = pins[idx];
              const pinnedItem = currentPin ? items.find((i) => i.id === currentPin.itemId) : null;
              const pointLabel =
                annotation.type === 'text'
                  ? 'Anchor Point'
                  : annotation.type === 'line' || annotation.type === 'arrow' || annotation.type === 'double_arrow'
                  ? idx === 0
                    ? 'Start Point'
                    : 'End Point'
                  : idx === 0
                  ? 'Top-Left / Center'
                  : 'Bottom-Right / Radius';

              return (
                <div key={idx} className="bg-[#37332F] border border-[#423D38] p-2 rounded-lg">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-[11px] text-[#B58D3D] flex items-center gap-1">
                      <Pin size={12} />
                      {pointLabel}
                    </span>
                    {pinnedItem && (
                      <button
                        type="button"
                        onClick={() => handleUnpin(idx)}
                        className="text-red-400 hover:text-red-300 flex items-center gap-1 text-[10px] font-bold cursor-pointer"
                      >
                        <Unlink size={10} />
                        Unpin
                      </button>
                    )}
                  </div>

                  {pinnedItem ? (
                    <div className="bg-[#2C2824] px-2.5 py-1.5 rounded border border-[#B58D3D]/50 flex items-center justify-between text-white">
                      <span className="font-bold truncate max-w-[180px]">{pinnedItem.title}</span>
                      <span className="text-[9px] bg-[#B58D3D] text-white px-1.5 py-0.5 rounded uppercase font-bold">
                        Pinned
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {onStartDragPinHandle && (
                        <button
                          type="button"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onStartDragPinHandle(annotation.id, idx, e);
                          }}
                          className="w-full py-1.5 px-2 bg-[#B58D3D]/25 hover:bg-[#B58D3D]/40 border border-[#B58D3D] text-[#E0D8D0] hover:text-white rounded text-[11px] font-bold transition-all cursor-grab active:cursor-grabbing flex items-center justify-center gap-1.5 shadow-xs"
                        >
                          <Pin size={12} className="text-[#B58D3D]" />
                          <span>Drag {pointLabel} to Card</span>
                        </button>
                      )}
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            handlePinToItem(idx, e.target.value);
                          }
                        }}
                        defaultValue=""
                        className="w-full bg-[#2C2824] border border-[#423D38] text-[#E0D8D0] rounded p-1.5 text-xs outline-none cursor-pointer"
                      >
                        <option value="" disabled>
                          -- Or select board card from list... --
                        </option>
                        {items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.title} ({i.type})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex items-center justify-between pt-3 mt-3 border-t border-[#B58D3D]/30">
        <button
          type="button"
          onClick={() => onDelete(annotation.id)}
          className="px-2.5 py-1.5 bg-red-900/40 hover:bg-red-800/80 text-red-200 border border-red-700/50 text-[11px] font-bold rounded flex items-center gap-1 transition-colors cursor-pointer"
        >
          <Trash2 size={12} />
          <span>Delete</span>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 bg-[#B58D3D] hover:bg-[#827717] text-white text-[11px] font-bold rounded flex items-center gap-1 transition-colors cursor-pointer"
        >
          <Check size={12} />
          <span>Done</span>
        </button>
      </div>
    </div>
  );
}
