'use client';

import { useState } from 'react';
import { BoardAnnotation, BoardItem, AnnotationFontStyle } from '@/lib/types';
import { ANNOTATION_COLOR_PRESETS, ANNOTATION_STROKE_WIDTHS } from '@/lib/annotationUtils';
import { 
  X, Trash2, Sliders, Pin, Palette, Type, Bold, Italic, Underline,
  Minus, MoveRight, MoveHorizontal, Square, Circle, ChevronDown, Check, Unlink, Paintbrush
} from 'lucide-react';

interface AnnotationQuickBarProps {
  annotation: BoardAnnotation;
  items: BoardItem[];
  onUpdate: (updated: BoardAnnotation) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onOpenFullInspector: () => void;
}

export default function AnnotationQuickBar({
  annotation,
  items,
  onUpdate,
  onDelete,
  onClose,
  onOpenFullInspector,
}: AnnotationQuickBarProps) {
  const [showStylePopover, setShowStylePopover] = useState(false);
  const [showTextPopover, setShowTextPopover] = useState(false);

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

  const pins = annotation.pins || [];
  const pinnedItem0 = pins[0] ? items.find((i) => i.id === pins[0]?.itemId) : null;
  const pinnedItem1 = pins[1] ? items.find((i) => i.id === pins[1]?.itemId) : null;
  const hasPins = Boolean(pinnedItem0 || pinnedItem1);

  const handleUpdateFont = (updates: Partial<AnnotationFontStyle>) => {
    onUpdate({
      ...annotation,
      fontStyle: {
        ...fontStyle,
        ...updates,
      },
    });
  };

  const handleUnpinAll = () => {
    onUpdate({
      ...annotation,
      pins: undefined,
    });
  };

  // Icon for annotation type
  const renderTypeIcon = (type: string) => {
    switch (type) {
      case 'line': return <Minus size={13} className="text-[#B58D3D]" />;
      case 'arrow': return <MoveRight size={13} className="text-[#B58D3D]" />;
      case 'double_arrow': return <MoveHorizontal size={13} className="text-[#B58D3D]" />;
      case 'rectangle': return <Square size={13} className="text-[#B58D3D]" />;
      case 'circle': return <Circle size={13} className="text-[#B58D3D]" />;
      case 'text': return <Type size={13} className="text-[#B58D3D]" />;
      default: return <Paintbrush size={13} className="text-[#B58D3D]" />;
    }
  };

  return (
    <div
      className="bg-[#2C2824]/95 backdrop-blur-md border border-[#B58D3D] rounded-full shadow-2xl px-3 py-1.5 text-[#E0D8D0] font-sans text-xs flex items-center gap-2.5 z-50 animate-in fade-in zoom-in-95 duration-150 select-none"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 1. Type Label */}
      <div className="flex items-center gap-1.5 pr-1.5 border-r border-[#423D38]">
        {renderTypeIcon(annotation.type)}
        <span className="font-bold font-serif italic capitalize text-[11px] text-[#B58D3D] hidden sm:inline">
          {annotation.type.replace('_', ' ')}
        </span>
      </div>

      {/* 2. Direct Quick Stroke Color Swatches */}
      <div className="flex items-center gap-1">
        {ANNOTATION_COLOR_PRESETS.slice(0, 5).map((preset) => (
          <button
            key={preset.hex}
            type="button"
            onClick={() => onUpdate({ ...annotation, strokeColor: preset.hex })}
            className={`w-4 h-4 rounded-full border border-black/30 transition-transform cursor-pointer hover:scale-125 ${
              strokeColor.toLowerCase() === preset.hex.toLowerCase()
                ? 'ring-2 ring-white ring-offset-1 ring-offset-[#2C2824]'
                : ''
            }`}
            style={{ backgroundColor: preset.hex }}
            title={`Set color: ${preset.name}`}
          />
        ))}

        {/* Custom Color Picker Button */}
        <label
          className="w-4 h-4 rounded-full border border-white/40 cursor-pointer flex items-center justify-center relative hover:scale-110 transition-transform overflow-hidden shadow-xs ml-0.5"
          style={{ backgroundColor: strokeColor }}
          title="Pick custom stroke color"
        >
          <input
            type="color"
            value={strokeColor}
            onChange={(e) => onUpdate({ ...annotation, strokeColor: e.target.value })}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          />
        </label>
      </div>

      <div className="h-4 w-px bg-[#423D38]" />

      {/* 3. Line Thickness & Style Toggle Button */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setShowStylePopover(!showStylePopover);
            setShowTextPopover(false);
          }}
          className={`px-2 py-1 rounded-md border text-[10px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
            showStylePopover
              ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
              : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
          }`}
          title="Line Thickness & Style"
        >
          <svg width="18" height="6" className="flex-shrink-0">
            <line
              x1="0"
              y1="3"
              x2="18"
              y2="3"
              stroke={strokeColor}
              strokeWidth={Math.max(1, strokeWidth)}
              strokeDasharray={strokeStyle === 'dashed' ? '3 2' : strokeStyle === 'dotted' ? '1.5 1.5' : undefined}
            />
          </svg>
          <span>{strokeWidth === 0 ? 'No Border' : `${strokeWidth}px`}</span>
          <ChevronDown size={10} className="opacity-70" />
        </button>

        {/* Style Dropdown Popover */}
        {showStylePopover && (
          <div className="absolute left-0 top-full mt-2 w-52 bg-[#2C2824] border border-[#B58D3D] rounded-xl shadow-2xl p-2.5 text-xs z-50 animate-in fade-in zoom-in-95 duration-100">
            <div className="text-[10px] font-bold text-[#A89F91] uppercase mb-1">Thickness</div>
            <div className="grid grid-cols-5 gap-1 mb-2.5">
              {ANNOTATION_STROKE_WIDTHS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => {
                    onUpdate({ ...annotation, strokeWidth: w.id });
                    setShowStylePopover(false);
                  }}
                  className={`py-1 rounded text-[10px] font-mono cursor-pointer border ${
                    strokeWidth === w.id
                      ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                      : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                  }`}
                >
                  {w.id === 0 ? 'None' : `${w.id}p`}
                </button>
              ))}
            </div>

            <div className="text-[10px] font-bold text-[#A89F91] uppercase mb-1">Style</div>
            <div className="grid grid-cols-3 gap-1 mb-2">
              {[
                { id: 'solid', label: 'Solid' },
                { id: 'dashed', label: 'Dashed' },
                { id: 'dotted', label: 'Dotted' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    onUpdate({ ...annotation, strokeStyle: s.id as 'solid' | 'dashed' | 'dotted' });
                    setShowStylePopover(false);
                  }}
                  className={`py-1 text-[10px] font-bold rounded border cursor-pointer ${
                    strokeStyle === s.id
                      ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                      : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Fill toggle for shapes/text */}
            {(annotation.type === 'rectangle' || annotation.type === 'circle' || annotation.type === 'text') && (
              <div className="pt-2 border-t border-[#423D38]">
                <div className="text-[10px] font-bold text-[#A89F91] uppercase mb-1">Fill / Background</div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onUpdate({ ...annotation, fillColor: 'transparent' });
                      setShowStylePopover(false);
                    }}
                    className={`px-2 py-1 rounded border text-[10px] font-bold cursor-pointer ${
                      fillColor === 'transparent'
                        ? 'bg-[#B58D3D] text-white border-[#B58D3D]'
                        : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38]'
                    }`}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onUpdate({ ...annotation, fillColor: `${strokeColor}22` });
                      setShowStylePopover(false);
                    }}
                    className="px-2 py-1 rounded border bg-[#37332F] text-[#E0D8D0] border-[#423D38] text-[10px] font-bold cursor-pointer hover:bg-[#423D38]"
                  >
                    Tint
                  </button>
                  <label
                    className="w-5 h-5 rounded border border-white/40 cursor-pointer flex items-center justify-center relative overflow-hidden ml-auto"
                    style={{ backgroundColor: fillColor === 'transparent' ? '#ffffff' : fillColor }}
                    title="Solid Fill Color"
                  >
                    <input
                      type="color"
                      value={fillColor === 'transparent' ? '#ffffff' : fillColor}
                      onChange={(e) => onUpdate({ ...annotation, fillColor: e.target.value })}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Text Quick Controls (if Text Annotation) */}
      {annotation.type === 'text' && (
        <>
          <div className="h-4 w-px bg-[#423D38]" />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleUpdateFont({ bold: !fontStyle.bold })}
              className={`p-1 rounded cursor-pointer transition-colors ${
                fontStyle.bold ? 'bg-[#B58D3D] text-white' : 'text-[#A89F91] hover:text-[#E0D8D0]'
              }`}
              title="Toggle Bold"
            >
              <Bold size={12} />
            </button>
            <button
              type="button"
              onClick={() => handleUpdateFont({ italic: !fontStyle.italic })}
              className={`p-1 rounded cursor-pointer transition-colors ${
                fontStyle.italic ? 'bg-[#B58D3D] text-white' : 'text-[#A89F91] hover:text-[#E0D8D0]'
              }`}
              title="Toggle Italic"
            >
              <Italic size={12} />
            </button>

            {/* Quick Size selector */}
            <select
              value={fontStyle.fontSize || 18}
              onChange={(e) => handleUpdateFont({ fontSize: Number(e.target.value) })}
              className="bg-[#37332F] border border-[#423D38] text-[#E0D8D0] rounded px-1 py-0.5 text-[10px] font-mono outline-none cursor-pointer"
            >
              {[12, 14, 18, 24, 32, 48].map((sz) => (
                <option key={sz} value={sz}>
                  {sz}px
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="h-4 w-px bg-[#423D38]" />

      {/* 5. Pin Indicator / Unpin */}
      {hasPins ? (
        <div className="flex items-center gap-1 bg-[#37332F] text-[#B58D3D] px-2 py-0.5 rounded-full border border-[#B58D3D]/50 text-[10px] font-bold">
          <Pin size={10} className="text-[#B58D3D]" />
          <span className="max-w-[70px] truncate">{pinnedItem0?.title || pinnedItem1?.title || 'Pinned'}</span>
          <button
            type="button"
            onClick={handleUnpinAll}
            className="text-red-400 hover:text-red-200 ml-0.5 p-0.5 cursor-pointer rounded-full hover:bg-red-950/50"
            title="Unpin All"
          >
            <X size={10} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpenFullInspector}
          className="text-[#A89F91] hover:text-[#E0D8D0] flex items-center gap-1 text-[10px] font-bold p-1 rounded hover:bg-[#37332F] cursor-pointer"
          title="Pin to card via Inspector"
        >
          <Pin size={11} />
          <span className="hidden md:inline">Pin</span>
        </button>
      )}

      <div className="h-4 w-px bg-[#423D38]" />

      {/* 6. Expand Full Inspector Button */}
      <button
        type="button"
        onClick={onOpenFullInspector}
        className="p-1 text-[#A89F91] hover:text-[#B58D3D] rounded hover:bg-[#37332F] transition-colors cursor-pointer flex items-center gap-1 text-[10px] font-bold"
        title="Open Full Detailed Inspector"
      >
        <Sliders size={13} />
        <span className="hidden sm:inline">Details</span>
      </button>

      {/* 7. Delete Button */}
      <button
        type="button"
        onClick={() => onDelete(annotation.id)}
        className="p-1 text-red-400 hover:text-red-200 hover:bg-red-950/50 rounded transition-colors cursor-pointer"
        title="Delete Annotation"
      >
        <Trash2 size={13} />
      </button>

      {/* 8. Close Selection */}
      <button
        type="button"
        onClick={onClose}
        className="p-1 text-[#A89F91] hover:text-white rounded hover:bg-[#37332F] transition-colors cursor-pointer"
        title="Deselect"
      >
        <X size={13} />
      </button>
    </div>
  );
}
