'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import Highlight from '@tiptap/extension-highlight';
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
  ChevronDown,
  Heading1,
  Heading2,
  Heading3,
  Heading,
  Quote,
  Code,
  Minus,
  Link as LinkIcon,
  Image as ImageIcon,
  Table as TableIcon,
  Undo2,
  Redo2,
  Highlighter,
  Columns3,
  Rows3,
  Trash2,
  X,
  Merge,
  Grid3x3,
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
} from 'lucide-react';
import { uploadFileToBlob } from '@/lib/utils';
import { sanitizeRichText } from '@/lib/sanitize';
import UploadProgress from './UploadProgress';
import { MentionableMember } from './MentionAutocomplete';
import { createMentionSuggestion } from '@/lib/mentionSuggestion';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  isLight?: boolean;
  compact?: boolean;
  disabled?: boolean;
  /**
   * Feature 08 — when provided, typing `@` in this editor shows a member
   * autocomplete; selecting a member inserts a plain `@username` mention.
   */
  mentions?: MentionableMember[];
  /**
   * Board the editor belongs to. Required for image uploads — the server
   * verifies membership before issuing an upload token
   * (Security-Audit.md medium #5).
   */
  boardId: string;
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

const HEADINGS = [
  { label: 'Normal text', level: 0 },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
];

function stopPropagation(e: React.SyntheticEvent) {
  e.stopPropagation();
  if ('nativeEvent' in e && e.nativeEvent) {
    e.nativeEvent.stopImmediatePropagation?.();
  }
}

function preventDefaultBtn(e: React.MouseEvent) {
  e.preventDefault();
  stopPropagation(e);
}

const toolBtn = (active: boolean) =>
  `p-1 hover:bg-black/10 rounded transition-colors ${active ? 'bg-[#EBE4D8] text-[#B58D3D]' : ''}`;

function ToolbarButton({ onClick, active = false, title, icon }: {
  onClick: () => void;
  active?: boolean;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={preventDefaultBtn}
      onClick={onClick}
      className={toolBtn(active)}
      title={title}
    >
      {icon}
    </button>
  );
}

const divider = <div className="w-[1px] h-3.5 bg-black/15 mx-0.5" />;

function getEditorAttributes(isLight: boolean, compact: boolean) {
  return {
    class: `tiptap rich-text-content flex-1 p-2 outline-none overflow-y-auto cursor-text text-xs leading-relaxed transition-all ${
      compact ? 'min-h-[60px] max-h-[140px]' : 'min-h-[100px]'
    }`,
    style: `color: ${isLight ? '#1F2937' : '#2C2824'}`,
    'data-interactive': 'true',
  };
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write here...',
  className = '',
  isLight = true,
  compact = false,
  disabled = false,
  mentions,
  boardId,
}: RichTextEditorProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFontSizePicker, setShowFontSizePicker] = useState(false);
  const [showHeadingPicker, setShowHeadingPicker] = useState(false);
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [tableHover, setTableHover] = useState({ rows: 3, cols: 3 });
  const [, setTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipNextUpdate = useRef(false);
  // In-flight image upload progress (toolbar "Insert Image").
  const [imageUpload, setImageUpload] = useState<{ percent: number; error: string | null } | null>(null);

  // Feature 08 — @mention autocomplete. The suggestion extension reads the
  // LATEST member list through this getter (the editor/extension is created
  // once, so props captured at first render would go stale). Empty list =
  // plugin stays inert. Defined in lib/mentionSuggestion.ts so the trigger →
  // render pipeline is unit-testable (see lib/mentionSuggestion.test.ts).
  const mentionsRef = useRef<MentionableMember[]>(mentions || []);
  mentionsRef.current = mentions || [];
  const mentionSuggestionExtension = createMentionSuggestion(() => mentionsRef.current);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    content: value || '',
    extensions: [
      StarterKit,
      TextStyleKit.configure({
        color: { types: ['textStyle'] },
        fontSize: { types: ['textStyle'] },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder }),
      Image.configure({ inline: false, allowBase64: false }),
      Highlight.configure({ multicolor: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      mentionSuggestionExtension,
    ],
    editorProps: {
      attributes: getEditorAttributes(isLight, compact),
    },
    onUpdate: ({ editor }) => {
      if (skipNextUpdate.current) {
        skipNextUpdate.current = false;
        return;
      }
      onChange(editor.isEmpty ? '' : editor.getHTML());
    },
    onSelectionUpdate: ({ editor }) => {
      setTick(t => t + 1);
      if (editor.isActive('table')) setShowTableMenu(false);
    },
    onTransaction: () => setTick(t => t + 1),
  });

  // Keep editor in sync with external value changes (undo in drawer, etc.)
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = value || '';
    if (current !== next) {
      const dom = editor.view.dom;
      const hasFocus = document.activeElement === dom || dom.contains(document.activeElement);
      if (!hasFocus) {
        skipNextUpdate.current = true;
        editor.commands.setContent(next, { emitUpdate: false });
      }
    }
  }, [value, editor]);

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (editor) {
      editor.setOptions({ editorProps: { attributes: getEditorAttributes(isLight, compact) } });
    }
  }, [isLight, compact, editor]);

  type Chain = ReturnType<NonNullable<typeof editor>['chain']>;

  const run = useCallback((fn: (chain: Chain) => Chain) => {
    if (!editor || disabled) return;
    fn(editor.chain().focus()).run();
  }, [editor, disabled]);

  const isActive = useCallback((nameOrAttrs: string | Record<string, unknown>, attrs?: Record<string, unknown>) => {
    if (typeof nameOrAttrs === 'string') {
      return editor?.isActive(nameOrAttrs, attrs) ?? false;
    }
    return editor?.isActive(nameOrAttrs) ?? false;
  }, [editor]);

  const applyFontSize = (sizePx: string) => {
    setShowFontSizePicker(false);
    run(c => c.setFontSize(sizePx));
  };

  const applyTextColor = (colorHex: string) => {
    setShowColorPicker(false);
    run(c => c.setColor(colorHex));
  };

  const applyHeading = (level: number) => {
    setShowHeadingPicker(false);
    if (!editor || disabled) return;
    if (level === 0) editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run();
  };

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev || 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    setImageUpload({ percent: 0, error: null });
    try {
      const url = await uploadFileToBlob(file, {
        boardId,
        onProgress: (percent) => setImageUpload(prev => (prev ? { ...prev, percent } : prev)),
      });
      editor.chain().focus().setImage({ src: url }).run();
      setImageUpload(null);
    } catch (err) {
      console.error('Rich text image upload failed:', err);
      setImageUpload(prev => (prev ? { ...prev, percent: 0, error: err instanceof Error ? err.message : 'Upload failed' } : prev));
      setTimeout(() => setImageUpload(null), 6000);
    }
  };

  const selectedFontSize = FONT_SIZES.find(s => isActive('textStyle', { fontSize: s.value }))?.value ?? '14px';
  const selectedHeading = HEADINGS.find(h => h.level !== 0 && isActive('heading', { level: h.level }));

  return (
    <div
      className={`flex flex-col border rounded-md overflow-visible transition-colors relative ${
        isLight ? 'border-[#D9D0C1] bg-white/70' : 'border-black/20 bg-black/10'
      } ${className}`}
      onPointerDown={stopPropagation}
      onPointerDownCapture={stopPropagation}
      onMouseDown={stopPropagation}
      onMouseDownCapture={stopPropagation}
      onClick={stopPropagation}
      onDoubleClick={stopPropagation}
    >
      {/* In-flight image upload progress */}
      {imageUpload && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none">
          <UploadProgress percent={imageUpload.percent} label="Uploading image" error={imageUpload.error} />
        </div>
      )}
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
              setShowHeadingPicker(false);
              setShowTableMenu(false);
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
              setShowHeadingPicker(false);
              setShowTableMenu(false);
            }}
            className="p-1 hover:bg-black/10 rounded flex items-center gap-1 transition-colors"
            title="Font Color"
          >
            <Palette size={compact ? 12 : 13} />
            <div
              className="w-3 h-3 rounded-full border border-black/30 shadow-xs"
              style={{ backgroundColor: (editor?.getAttributes('textStyle').color as string) || '#1F2937' }}
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
                  value={(editor?.getAttributes('textStyle').color as string) || '#1F2937'}
                  onChange={e => applyTextColor(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent p-0"
                  onMouseDown={preventDefaultBtn}
                />
              </div>
            </div>
          )}
        </div>

        {divider}

        {/* Bold, Italic, Underline, Strikethrough */}
        <ToolbarButton onClick={() => run(c => c.toggleBold())} active={isActive('bold')} title="Bold (Ctrl+B)" icon={<Bold size={compact ? 12 : 13} />} />
        <ToolbarButton onClick={() => run(c => c.toggleItalic())} active={isActive('italic')} title="Italic (Ctrl+I)" icon={<Italic size={compact ? 12 : 13} />} />
        <ToolbarButton onClick={() => run(c => c.toggleUnderline())} active={isActive('underline')} title="Underline (Ctrl+U)" icon={<Underline size={compact ? 12 : 13} />} />
        <ToolbarButton onClick={() => run(c => c.toggleStrike())} active={isActive('strike')} title="Strikethrough" icon={<Strikethrough size={compact ? 12 : 13} />} />
        <ToolbarButton onClick={() => run(c => c.toggleHighlight())} active={isActive('highlight')} title="Highlight" icon={<Highlighter size={compact ? 12 : 13} />} />

        {divider}

        {/* Heading Dropdown */}
        <div className="relative">
          <button
            type="button"
            onMouseDown={preventDefaultBtn}
            onClick={() => {
              setShowHeadingPicker(!showHeadingPicker);
              setShowFontSizePicker(false);
              setShowColorPicker(false);
              setShowTableMenu(false);
            }}
            className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-black/10 transition-colors"
            title="Heading"
          >
            {selectedHeading?.level === 1 ? <Heading1 size={compact ? 12 : 13} /> :
             selectedHeading?.level === 2 ? <Heading2 size={compact ? 12 : 13} /> :
             selectedHeading?.level === 3 ? <Heading3 size={compact ? 12 : 13} /> :
             <Heading size={compact ? 12 : 13} />}
            <ChevronDown size={10} />
          </button>

          {showHeadingPicker && (
            <div
              className="absolute top-full left-0 mt-1 w-40 bg-white border border-[#D9D0C1] rounded shadow-xl py-1 z-50 text-left font-sans"
              onMouseDown={preventDefaultBtn}
            >
              {HEADINGS.map(h => (
                <button
                  key={h.label}
                  type="button"
                  onMouseDown={preventDefaultBtn}
                  onClick={() => applyHeading(h.level)}
                  className={`w-full text-left px-2.5 py-1 hover:bg-[#F5F2ED] ${
                    (h.level === 0 ? !editor?.isActive('heading') : isActive('heading', { level: h.level }))
                      ? 'font-bold bg-[#EBE4D8] text-[#B58D3D]'
                      : 'text-[#2C2824]'
                  }`}
                >
                  <span className="text-xs">{h.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {divider}

        {/* Alignments */}
        <ToolbarButton onClick={() => run(c => c.setTextAlign('left'))} active={isActive({ textAlign: 'left' })} title="Align Left" icon={<AlignLeft size={compact ? 12 : 13} />} />
        <ToolbarButton onClick={() => run(c => c.setTextAlign('center'))} active={isActive({ textAlign: 'center' })} title="Align Center" icon={<AlignCenter size={compact ? 12 : 13} />} />
        <ToolbarButton onClick={() => run(c => c.setTextAlign('right'))} active={isActive({ textAlign: 'right' })} title="Align Right" icon={<AlignRight size={compact ? 12 : 13} />} />
        {!compact && (
          <ToolbarButton onClick={() => run(c => c.setTextAlign('justify'))} active={isActive({ textAlign: 'justify' })} title="Justify Text" icon={<AlignJustify size={13} />} />
        )}

        {divider}

        {/* Lists */}
        <ToolbarButton onClick={() => run(c => c.toggleBulletList())} active={isActive('bulletList')} title="Bullet List" icon={<List size={compact ? 12 : 13} />} />
        <ToolbarButton onClick={() => run(c => c.toggleOrderedList())} active={isActive('orderedList')} title="Numbered List" icon={<ListOrdered size={compact ? 12 : 13} />} />
        <ToolbarButton onClick={() => run(c => c.toggleBlockquote())} active={isActive('blockquote')} title="Blockquote" icon={<Quote size={compact ? 12 : 13} />} />
        {!compact && (
          <ToolbarButton onClick={() => run(c => c.toggleCodeBlock())} active={isActive('codeBlock')} title="Code Block" icon={<Code size={13} />} />
        )}
        {!compact && (
          <ToolbarButton onClick={() => run(c => c.setHorizontalRule())} title="Horizontal Rule" icon={<Minus size={13} />} />
        )}

        {!compact && divider}

        {/* Link & Image */}
        <ToolbarButton onClick={setLink} active={isActive('link')} title="Link (Ctrl+K)" icon={<LinkIcon size={13} />} />
        {!compact && (
          <ToolbarButton
            onClick={() => {
              if (!imageUpload) fileInputRef.current?.click();
            }}
            title={imageUpload ? 'Uploading image…' : 'Insert Image'}
            icon={<ImageIcon size={13} className={imageUpload ? 'animate-pulse' : ''} />}
          />
        )}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />

        {/* Table Menu */}
        {!compact && (
          <div className="relative">
            <ToolbarButton
              onClick={() => {
                setShowTableMenu(!showTableMenu);
                setShowFontSizePicker(false);
                setShowColorPicker(false);
                setShowHeadingPicker(false);
              }}
              active={isActive('table')}
              title="Table"
              icon={<TableIcon size={13} />}
            />
            {showTableMenu && !isActive('table') && (
              <div
                className="absolute top-full left-0 mt-1 w-52 bg-white border border-[#D9D0C1] rounded shadow-xl py-1 z-50 text-left font-sans"
                onMouseDown={preventDefaultBtn}
              >
                <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#8C7B6E] border-b border-[#F5F2ED] mb-1">
                  <span className="flex items-center gap-1"><Grid3x3 size={11} /> Insert Table</span>
                  <span className="text-[#B58D3D]">{tableHover.rows} × {tableHover.cols}</span>
                </div>
                <div className="px-2.5 pb-2">
                  <div className="grid grid-cols-6 gap-[3px] w-fit"
                    onMouseLeave={() => setTableHover({ rows: 3, cols: 3 })}
                  >
                    {Array.from({ length: 6 }).map((_, r) => (
                      <React.Fragment key={r}>
                        {Array.from({ length: 6 }).map((_, c) => {
                          const lit = r < tableHover.rows && c < tableHover.cols;
                          return (
                            <button
                              key={c}
                              type="button"
                              onMouseDown={preventDefaultBtn}
                              onMouseEnter={() => setTableHover({ rows: r + 1, cols: c + 1 })}
                              onClick={() => {
                                setShowTableMenu(false);
                                run(ch => ch.insertTable({ rows: tableHover.rows, cols: tableHover.cols, withHeaderRow: true }));
                              }}
                              className={`w-3.5 h-3.5 rounded-[3px] border transition-colors ${
                                lit ? 'bg-[#B58D3D] border-[#B58D3D]' : 'bg-white border-[#D9D0C1] hover:border-[#B58D3D]'
                              }`}
                              title={`${r + 1} rows × ${c + 1} cols`}
                            />
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </div>
                  <div className="text-[9px] text-[#8C7B6E] mt-1.5">Click to insert, drag to resize</div>
                </div>
              </div>
            )}
            {/* In-table controls: appear in the toolbar while the cursor is inside a table */}
            {isActive('table') && (
              <>
                {divider}
                <ToolbarButton onClick={() => run(c => c.mergeOrSplit())} title="Merge selected cells (or split a merged cell)" icon={<Merge size={13} />} />
                <ToolbarButton onClick={() => run(c => c.addRowBefore())} title="Add Row Above" icon={<ArrowUpToLine size={13} />} />
                <ToolbarButton onClick={() => run(c => c.addRowAfter())} title="Add Row Below" icon={<ArrowDownToLine size={13} />} />
                <ToolbarButton onClick={() => run(c => c.deleteRow())} title="Delete Row" icon={<X size={13} />} />
                <ToolbarButton onClick={() => run(c => c.addColumnBefore())} title="Add Column Left" icon={<ArrowLeftToLine size={13} />} />
                <ToolbarButton onClick={() => run(c => c.addColumnAfter())} title="Add Column Right" icon={<ArrowRightToLine size={13} />} />
                <ToolbarButton onClick={() => run(c => c.deleteColumn())} title="Delete Column" icon={<X size={13} />} />
                <ToolbarButton onClick={() => run(c => c.toggleHeaderRow())} title="Toggle Header Row" icon={<Rows3 size={13} />} />
                <ToolbarButton onClick={() => run(c => c.toggleHeaderColumn())} title="Toggle Header Column" icon={<Columns3 size={13} />} />
                <button
                  type="button"
                  onMouseDown={preventDefaultBtn}
                  onClick={() => run(c => c.deleteTable())}
                  className="p-1 hover:bg-black/10 rounded text-red-700/80 hover:text-red-800 transition-colors"
                  title="Delete Table"
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        )}

        {divider}

        {/* Undo / Redo */}
        <ToolbarButton onClick={() => run(c => c.undo())} title="Undo (Ctrl+Z)" icon={<Undo2 size={compact ? 12 : 13} />} />
        <ToolbarButton onClick={() => run(c => c.redo())} title="Redo (Ctrl+Y)" icon={<Redo2 size={compact ? 12 : 13} />} />

        {/* Clear Formatting */}
        <button
          type="button"
          onMouseDown={preventDefaultBtn}
          onClick={() => run(c => c.unsetAllMarks().clearNodes())}
          className="p-1 hover:bg-black/10 rounded text-red-700/80 hover:text-red-800 transition-colors ml-auto"
          title="Clear Formatting"
        >
          <RemoveFormatting size={compact ? 12 : 13} />
        </button>
      </div>

      {/* Content Editable Area */}
      <EditorContent editor={editor} />
    </div>
  );
}

export function RichTextDisplay({ content, className = '' }: { content: string; className?: string }) {
  if (!content) return null;

  // Check if content string contains HTML tags
  const hasHtml = /<[a-z][\s\S]*>/i.test(content);
  const formattedHtml = hasHtml ? content : content.replace(/\n/g, '<br />');
  // Defense-in-depth: DOMPurify allowlist before injecting, even though the
  // server scrubs on write (covers legacy/imported content — Security-Audit.md #2).
  const safeHtml = sanitizeRichText(formattedHtml);

  return (
    <div
      className={`rich-text-content break-words ${className}`}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

/**
 * Extract text alignment from a block tag's attribute string — supports both
 * the modern style="text-align: X" (TipTap) and legacy align="X" (old
 * execCommand editor) forms.
 */
function getTextAlignFromAttrs(attrs: string): string | null {
  const styleMatch = attrs.match(/style\s*=\s*["']([^"']*)["']/i);
  if (styleMatch) {
    const am = styleMatch[1].match(/text-align\s*:\s*(left|center|right|justify)/i);
    if (am) return am[1].toLowerCase();
  }
  const attrMatch = attrs.match(/\balign\s*=\s*["'](left|center|right|justify)["']/i);
  return attrMatch ? attrMatch[1].toLowerCase() : null;
}

/**
 * Flatten editor HTML into a compact inline-HTML string suitable for
 * line-clamped card previews. Inline formatting (bold, italic, underline,
 * colors, font sizes, highlights, links) is preserved, block boundaries
 * become <br />, tables collapse into readable rows, images and horizontal
 * rules are kept inline so they render in the preview.
 */
export function flattenRichTextForPreview(html: string): string {
  if (!html) return '';

  // Allowlist-sanitize first (DOMPurify): strips scripts, event handlers,
  // javascript: URLs, iframes/svg/object before any of the transforms below
  // run (Security-Audit.md #2). The rt-preview-* wrappers are generated AFTER
  // this point, so the sanitizer never sees them.
  let s = sanitizeRichText(html);
  // Normalize <br> variants.
  s = s.replace(/<br\s*\/?>/gi, '\u0000'); // sentinel: survives trimming, replaced below
  // Block boundaries → line breaks (inline content inside is kept), with
  // text alignment preserved via wrapper spans. Single pass so the block
  // open/close stack stays consistent.
  const alignable = (t: string) => t === 'p' || t === 'div' || /^h[1-6]$/.test(t);
  const isHeading = (t: string) => /^h[1-6]$/.test(t);
  const blockStack: { kind: string; align: string | null }[] = [];
  s = s.replace(/<(\/)?(blockquote|pre|hr|h[1-6]|p|div|address|section|article|aside|header|footer|figure|figcaption|details|summary|fieldset|form)([^>]*)>/gi, (match, close, tag, attrs) => {
    const t = tag.toLowerCase();
    if (close) {
      if (t === 'hr') return '';
      const entry = blockStack.pop();
      if (!entry) return '\u0000';
      let out = '';
      if (entry.align) out += '</span>';
      if (entry.kind === 'quote') out += '</span>';
      else if (entry.kind === 'pre') out += '</span>';
      else if (entry.kind === 'heading') out += '</strong>';
      return out + '\u0000';
    }
    if (t === 'hr') return '<hr class="rt-preview-hr" />';
    let out = '';
    let kind = 'other';
    if (t === 'blockquote') { out += '<span class="rt-preview-quote">'; kind = 'quote'; }
    else if (t === 'pre') { out += '<span class="rt-preview-pre">'; kind = 'pre'; }
    else if (isHeading(t)) { out += '<strong>'; kind = 'heading'; }
    const align = alignable(t) ? getTextAlignFromAttrs(attrs) : null;
    if (align) out += `<span style="display:block;text-align:${align}">`;
    blockStack.push({ kind, align });
    return out;
  });

  // Lists: numbered items get 1./2./…, bullets get •; each item ends a line.
  // Done in a single pass so list-state tracking stays consistent.
  let olDepth = 0;
  let liCount = 0;
  s = s.replace(/<(ol|ul|li|\/ol|\/ul|\/li)[^>]*>/gi, (match, tag) => {
    const t = tag.toLowerCase();
    if (t === 'ol') { olDepth += 1; liCount = 0; return ''; }
    if (t === 'ul') { liCount = 0; return ''; }
    if (t === '/ol') { olDepth = Math.max(0, olDepth - 1); return ''; }
    if (t === '/ul') return '';
    if (t === '/li') return '\u0000';
    liCount += 1;
    if (olDepth > 0) return `${liCount}. `;
    return '<span class="rt-preview-bullet">\u2022</span> ';
  });

  // Tables: rebuild as real <table> markup so previews render an actual
  // table instead of text columns. Cell content is collapsed to a single
  // line — TipTap wraps cell content in <p>, which would otherwise put a
  // line break before every cell.
  s = s.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, (tableHtml) => {
    const rows = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
    const htmlRows = rows.map(row => {
      const cells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? [];
      const inner = cells.map(cell => {
        const cellTag = /^<th[\s>]/i.test(cell) ? 'th' : 'td';
        const text = cell
          .replace(/^<t[dh][^>]*>/i, '')
          .replace(/<\/t[dh]>$/i, '')
          .replace(/\u0000+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        // Preserve colspan/rowspan so merged cells keep their span on the
        // canvas preview, matching what the rich text editor shows.
        const openTag = cell.match(/^<t[dh][^>]*>/i)?.[0] ?? '';
        const spans = (openTag.match(/\b(colspan|rowspan)\s*=\s*["']\d+["']/gi) ?? [])
          .filter(attr => Number(attr.match(/\d+/)?.[0]) > 1)
          .join(' ');
        return `<${cellTag}${spans ? ` ${spans}` : ''}>${text}</${cellTag}>`;
      });
      return `<tr>${inner.join('')}</tr>`;
    });
    return `<table class="rt-preview-table">${htmlRows.join('')}</table>`;
  });

  // Drop any leftover unknown block tags by unwrapping them. (Table tags are
  // kept: they were rebuilt as structured markup in the table pass above.)
  s = s.replace(/<\/(pre|p|div|ul|ol|li|h[1-6]|blockquote)>/gi, '');
  s = s.replace(/<(pre|p|div|ul|ol|li|h[1-6]|blockquote)[^>]*>/gi, '');

  // Restore line breaks: trim stray separators, collapse runs, drop blank lines.
  s = s.replace(/[ |\u0000]+(?=\u0000)/g, '\u0000');
  s = s.replace(/\u0000[ |]+/g, '\u0000');
  s = s.replace(/\u0000+/g, '\u0000');
  const parts = s.split('\u0000').map(p => p.trim());
  const joined = parts.filter((p, i) => p !== '' || (i > 0 && parts[i - 1] !== '')).join('\u0000');
  s = joined.replace(/\u0000/g, '<br />');

  return s.replace(/(<br \/>)+$/g, '').trim();
}
