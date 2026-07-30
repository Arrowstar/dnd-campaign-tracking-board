'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { 
  Bold, 
  Italic, 
  Underline, 
  Strikethrough, 
  AlignLeft, 
  AlignCenter, 
  AlignRight, 
  AlignJustify, 
  List, 
  ListOrdered, 
  Palette, 
  Type, 
  RemoveFormatting,
  ChevronDown
} from 'lucide-react';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  isLight?: boolean;
  compact?: boolean;
  disabled?: boolean;
}

const FONT_SIZES = [
  { label: 'Tiny (10px)', value: '10px' },
  { label: 'Small (12px)', value: '12px' },
  { label: 'Normal (14px)', value: '14px' },
  { label: 'Medium (16px)', value: '16px' },
  { label: 'Large (18px)', value: '18px' },
  { label: 'X-Large (22px)', value: '22px' },
  { label: 'Huge (28px)', value: '28px' },
];

const TEXT_COLORS = [
  { label: 'Dark Charcoal', hex: '#1F2937' },
  { label: 'Warm Brown', hex: '#78350F' },
  { label: 'Crimson Red', hex: '#DC2626' },
  { label: 'Amber Gold', hex: '#D97706' },
  { label: 'Forest Green', hex: '#059669' },
  { label: 'Royal Blue', hex: '#2563EB' },
  { label: 'Deep Violet', hex: '#7C3AED' },
  { label: 'Rose Pink', hex: '#DB2777' },
  { label: 'Muted Gray', hex: '#6B7280' },
  { label: 'Pure White', hex: '#FFFFFF' },
];

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write here...',
  className = '',
  isLight = true,
  compact = false,
  disabled = false,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFontSizePicker, setShowFontSizePicker] = useState(false);
  const [selectedColor, setSelectedColor] = useState('#1F2937');
  const [selectedFontSize, setSelectedFontSize] = useState('14px');

  // Sync value from props to editor HTML when not actively typing
  useEffect(() => {
    if (editorRef.current) {
      const currentHTML = editorRef.current.innerHTML;
      if (value !== currentHTML) {
        // If the editor is not focused, update innerHTML
        if (document.activeElement !== editorRef.current) {
          editorRef.current.innerHTML = value || '';
        }
      }
    }
  }, [value]);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      // If it's just <br> or empty tag, treat as empty string
      if (html === '<br>' || html === '<div><br></div>' || html.trim() === '') {
        onChange('');
      } else {
        onChange(html);
      }
    }
  }, [onChange]);

  const execCommand = (command: string, arg: string | undefined = undefined) => {
    if (disabled) return;
    document.execCommand(command, false, arg);
    handleInput();
  };

  const applyFontSize = (sizePx: string) => {
    if (disabled) return;
    setSelectedFontSize(sizePx);
    setShowFontSizePicker(false);

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      // If nothing selected, execute fontSize command then update span
      document.execCommand('fontSize', false, '7');
    } else {
      // Wrap selection in a span with style font-size
      try {
        const span = document.createElement('span');
        span.style.fontSize = sizePx;
        range.surroundContents(span);
      } catch (e) {
        // Fallback for selection crossing nodes
        document.execCommand('fontSize', false, '7');
        if (editorRef.current) {
          const fontEls = editorRef.current.querySelectorAll('font[size="7"]');
          fontEls.forEach(el => {
            const span = document.createElement('span');
            span.style.fontSize = sizePx;
            span.innerHTML = el.innerHTML;
            el.parentNode?.replaceChild(span, el);
          });
        }
      }
    }
    handleInput();
  };

  const applyTextColor = (colorHex: string) => {
    if (disabled) return;
    setSelectedColor(colorHex);
    setShowColorPicker(false);
    document.execCommand('foreColor', false, colorHex);
    handleInput();
  };

  const stopPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    if ('nativeEvent' in e && e.nativeEvent) {
      e.nativeEvent.stopImmediatePropagation?.();
    }
  };

  const preventDefaultBtn = (e: React.MouseEvent) => {
    e.preventDefault();
    stopPropagation(e);
  };

  return (
    <div 
      className={`flex flex-col border rounded-md overflow-visible transition-colors ${
        isLight ? 'border-[#D9D0C1] bg-white/70' : 'border-black/20 bg-black/10'
      } ${className}`}
      onPointerDown={stopPropagation}
      onPointerDownCapture={stopPropagation}
      onPointerUp={stopPropagation}
      onMouseDown={stopPropagation}
      onMouseDownCapture={stopPropagation}
      onMouseUp={stopPropagation}
      onClick={stopPropagation}
      onDoubleClick={stopPropagation}
      onTouchStart={stopPropagation}
      onTouchEnd={stopPropagation}
    >
      {/* Rich Text Toolbar */}
      <div 
        className={`flex flex-wrap items-center gap-0.5 p-1 border-b select-none ${
          isLight ? 'bg-[#F5F2ED] border-[#D9D0C1] text-[#423D38]' : 'bg-black/10 border-black/10 text-gray-800'
        }`}
        onMouseDown={preventDefaultBtn}
      >
        {/* Font Size Dropdown */}
        <div className="relative">
          <button
            type="button"
            onMouseDown={preventDefaultBtn}
            onClick={() => {
              setShowFontSizePicker(!showFontSizePicker);
              setShowColorPicker(false);
            }}
            className="flex items-center gap-1 px-1.5 py-1 text-[11px] font-bold rounded hover:bg-black/10 transition-colors"
            title="Font Size"
          >
            <Type size={compact ? 12 : 13} />
            <span className="hidden sm:inline text-[10px]">{selectedFontSize}</span>
            <ChevronDown size={10} />
          </button>

          {showFontSizePicker && (
            <div 
              className="absolute top-full left-0 mt-1 w-36 bg-white border border-[#D9D0C1] rounded shadow-xl py-1 z-50 text-left font-sans"
              onMouseDown={preventDefaultBtn}
            >
              {FONT_SIZES.map(s => (
                <button
                  key={s.value}
                  type="button"
                  onMouseDown={preventDefaultBtn}
                  onClick={() => applyFontSize(s.value)}
                  className={`w-full text-left px-2.5 py-1 text-xs hover:bg-[#F5F2ED] flex items-center justify-between ${
                    selectedFontSize === s.value ? 'font-bold bg-[#EBE4D8] text-[#B58D3D]' : 'text-[#2C2824]'
                  }`}
                >
                  <span style={{ fontSize: s.value }}>{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Text Color Picker */}
        <div className="relative">
          <button
            type="button"
            onMouseDown={preventDefaultBtn}
            onClick={() => {
              setShowColorPicker(!showColorPicker);
              setShowFontSizePicker(false);
            }}
            className="p-1 hover:bg-black/10 rounded flex items-center gap-1 transition-colors"
            title="Font Color"
          >
            <Palette size={compact ? 12 : 13} />
            <div 
              className="w-3 h-3 rounded-full border border-black/30 shadow-xs" 
              style={{ backgroundColor: selectedColor }}
            />
          </button>

          {showColorPicker && (
            <div 
              className="absolute top-full left-0 mt-1 w-48 bg-white border border-[#D9D0C1] rounded shadow-xl p-2 z-50 font-sans"
              onMouseDown={preventDefaultBtn}
            >
              <div className="text-[10px] font-bold text-[#8C7B6E] uppercase mb-1.5 border-b pb-1 border-[#F5F2ED]">
                Text Color
              </div>
              <div className="grid grid-cols-5 gap-1.5 mb-2">
                {TEXT_COLORS.map(c => (
                  <button
                    key={c.hex}
                    type="button"
                    onMouseDown={preventDefaultBtn}
                    onClick={() => applyTextColor(c.hex)}
                    style={{ backgroundColor: c.hex }}
                    className="w-6 h-6 rounded border border-black/20 hover:scale-110 transition-transform shadow-xs"
                    title={c.label}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-[#F5F2ED] text-[10px] font-bold text-[#8C7B6E]">
                <span>Custom Color</span>
                <input 
                  type="color" 
                  value={selectedColor}
                  onChange={e => applyTextColor(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent p-0"
                  onMouseDown={preventDefaultBtn}
                />
              </div>
            </div>
          )}
        </div>

        <div className="w-[1px] h-3.5 bg-black/15 mx-0.5" />

        {/* Bold, Italic, Underline, Strikethrough */}
        <button
          type="button"
          onMouseDown={preventDefaultBtn}
          onClick={() => execCommand('bold')}
          className="p-1 hover:bg-black/10 rounded transition-colors"
          title="Bold (Ctrl+B)"
        >
          <Bold size={compact ? 12 : 13} />
        </button>
        <button
          type="button"
          onMouseDown={preventDefaultBtn}
          onClick={() => execCommand('italic')}
          className="p-1 hover:bg-black/10 rounded transition-colors"
          title="Italic (Ctrl+I)"
        >
          <Italic size={compact ? 12 : 13} />
        </button>
        <button
          type="button"
          onMouseDown={preventDefaultBtn}
          onClick={() => execCommand('underline')}
          className="p-1 hover:bg-black/10 rounded transition-colors"
          title="Underline (Ctrl+U)"
        >
          <Underline size={compact ? 12 : 13} />
        </button>
        <button
          type="button"
          onMouseDown={preventDefaultBtn}
          onClick={() => execCommand('strikeThrough')}
          className="p-1 hover:bg-black/10 rounded transition-colors"
          title="Strikethrough"
        >
          <Strikethrough size={compact ? 12 : 13} />
        </button>

        <div className="w-[1px] h-3.5 bg-black/15 mx-0.5" />

        {/* Alignments */}
        <button
          type="button"
          onMouseDown={preventDefaultBtn}
          onClick={() => execCommand('justifyLeft')}
          className="p-1 hover:bg-black/10 rounded transition-colors"
          title="Align Left"
        >
          <AlignLeft size={compact ? 12 : 13} />
        </button>
        <button
          type="button"
          onMouseDown={preventDefaultBtn}
          onClick={() => execCommand('justifyCenter')}
          className="p-1 hover:bg-black/10 rounded transition-colors"
          title="Align Center"
        >
          <AlignCenter size={compact ? 12 : 13} />
        </button>
        <button
          type="button"
          onMouseDown={preventDefaultBtn}
          onClick={() => execCommand('justifyRight')}
          className="p-1 hover:bg-black/10 rounded transition-colors"
          title="Align Right"
        >
          <AlignRight size={compact ? 12 : 13} />
        </button>
        {!compact && (
          <button
            type="button"
            onMouseDown={preventDefaultBtn}
            onClick={() => execCommand('justifyFull')}
            className="p-1 hover:bg-black/10 rounded transition-colors"
            title="Justify Text"
          >
            <AlignJustify size={13} />
          </button>
        )}

        <div className="w-[1px] h-3.5 bg-black/15 mx-0.5" />

        {/* Lists & Format Clear */}
        <button
          type="button"
          onMouseDown={preventDefaultBtn}
          onClick={() => execCommand('insertUnorderedList')}
          className="p-1 hover:bg-black/10 rounded transition-colors"
          title="Bullet List"
        >
          <List size={compact ? 12 : 13} />
        </button>
        <button
          type="button"
          onMouseDown={preventDefaultBtn}
          onClick={() => execCommand('insertOrderedList')}
          className="p-1 hover:bg-black/10 rounded transition-colors"
          title="Numbered List"
        >
          <ListOrdered size={compact ? 12 : 13} />
        </button>
        <button
          type="button"
          onMouseDown={preventDefaultBtn}
          onClick={() => execCommand('removeFormat')}
          className="p-1 hover:bg-black/10 rounded text-red-700/80 hover:text-red-800 transition-colors ml-auto"
          title="Clear Formatting"
        >
          <RemoveFormatting size={compact ? 12 : 13} />
        </button>
      </div>

      {/* Content Editable Area */}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        onInput={handleInput}
        onBlur={handleInput}
        onKeyDown={(e) => {
          e.stopPropagation();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation?.();
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation?.();
        }}
        data-interactive="true"
        data-placeholder={placeholder}
        className={`rich-text-content flex-1 p-2 outline-none overflow-y-auto cursor-text text-xs leading-relaxed transition-all ${
          compact ? 'min-h-[60px] max-h-[140px]' : 'min-h-[100px]'
        }`}
        style={{
          color: isLight ? '#1F2937' : '#2C2824',
        }}
      />
    </div>
  );
}

export function RichTextDisplay({ content, className = '' }: { content: string; className?: string }) {
  if (!content) return null;

  // Check if content string contains HTML tags
  const hasHtml = /<[a-z][\s\S]*>/i.test(content);
  const formattedHtml = hasHtml ? content : content.replace(/\n/g, '<br />');

  return (
    <div 
      className={`rich-text-content break-words ${className}`}
      dangerouslySetInnerHTML={{ __html: formattedHtml }}
    />
  );
}
