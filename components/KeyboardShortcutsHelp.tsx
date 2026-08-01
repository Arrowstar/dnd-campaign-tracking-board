'use client';

import { X, Keyboard, MousePointerClick, Trash2, Move, ZoomIn, ZoomOut, RotateCcw, Maximize2, CornerDownLeft, CornerUpLeft, ExternalLink, Undo2, Redo2 } from 'lucide-react';

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutRow {
  keys: string[];
  action: string;
  detail?: string;
}

const SHORTCUT_GROUPS: { title: string; icon: React.ReactNode; rows: ShortcutRow[] }[] = [
  {
    title: 'Selection',
    icon: <MousePointerClick size={14} className="text-[#B58D3D]" />,
    rows: [
      { keys: ['Click a card'], action: 'Select a board item', detail: 'Selected cards get a gold ring' },
      { keys: ['Click an annotation'], action: 'Select an annotation', detail: 'Lines, arrows, shapes & text' },
      { keys: ['Click empty space'], action: 'Deselect' },
      { keys: ['Enter'], action: 'Open selected item in focus drawer', detail: 'Same as double-clicking a card' },
    ],
  },
  {
    title: 'Editing',
    icon: <Trash2 size={14} className="text-[#B58D3D]" />,
    rows: [
      { keys: ['Delete', 'Backspace'], action: 'Delete the selected item or annotation', detail: 'Instant — no confirmation' },
      { keys: ['↑ ↓ ← →'], action: 'Nudge selected item or annotation 1px' },
      { keys: ['Shift + ↑ ↓ ← →'], action: 'Nudge selected item or annotation 10px' },
    ],
  },
  {
    title: 'History',
    icon: <Undo2 size={14} className="text-[#B58D3D]" />,
    rows: [
      { keys: ['Ctrl', 'Z'], action: 'Undo the last change', detail: 'Works while editing cards and tabs' },
      { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo the last change' },
      { keys: ['Ctrl', 'Y'], action: 'Redo (Windows)' },
      { keys: ['Toolbar buttons'], action: 'Undo / Redo with one click', detail: 'Available in the top bar' },
    ],
  },
  {
    title: 'View',
    icon: <Maximize2 size={14} className="text-[#B58D3D]" />,
    rows: [
      { keys: ['F'], action: 'Fit all items in view' },
      { keys: ['+'], action: 'Zoom in' },
      { keys: ['−'], action: 'Zoom out' },
      { keys: ['0'], action: 'Reset zoom to 100%' },
    ],
  },
  {
    title: 'Cancel & Close',
    icon: <CornerUpLeft size={14} className="text-[#B58D3D]" />,
    rows: [
      { keys: ['Esc'], action: 'Close drawer / deselect / cancel connection drawing' },
    ],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[26px] px-1.5 h-6 rounded-md bg-[#37332F] border border-[#5D554E] border-b-2 text-[#E0D8D0] text-[11px] font-bold font-mono">
      {children}
    </kbd>
  );
}

export default function KeyboardShortcutsHelp({ isOpen, onClose }: KeyboardShortcutsHelpProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl transition-all"
        style={{ background: 'rgba(38,32,26,0.98)', border: '1px solid rgba(181,141,61,0.3)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(181,141,61,0.15)', background: 'rgba(0,0,0,0.2)' }}>
          <div className="flex items-center gap-2.5">
            <Keyboard size={20} className="text-[#B58D3D]" />
            <div>
              <h2 className="text-[#E0D8D0] font-serif font-bold italic text-lg leading-tight">Keyboard Shortcuts</h2>
              <p className="text-[#8C7B6E] text-xs">Shortcuts are ignored while typing in text fields</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8C7B6E] hover:text-[#E0D8D0] hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {SHORTCUT_GROUPS.map(group => (
            <div key={group.title}>
              <div className="flex items-center gap-1.5 mb-2">
                {group.icon}
                <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#B58D3D]">{group.title}</h3>
              </div>
              <div className="space-y-1.5">
                {group.rows.map(row => (
                  <div key={row.action} className="flex items-center justify-between gap-3 py-1">
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {row.keys.map(k => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </div>
                    <div className="text-right min-w-0">
                      <div className="text-[#E0D8D0] text-xs font-semibold leading-tight">{row.action}</div>
                      {row.detail && <div className="text-[#8C7B6E] text-[10px] leading-tight">{row.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="flex items-start gap-2 p-3 rounded-lg text-xs" style={{ background: 'rgba(181,141,61,0.08)', border: '1px solid rgba(181,141,61,0.25)' }}>
            <ExternalLink size={14} className="text-[#B58D3D] flex-shrink-0 mt-0.5" />
            <span className="text-[#C9C0B1]">
              Tip: click a card or annotation to select it, then use <Kbd>Delete</Kbd> to remove it or <Kbd>↑ ↓ ← →</Kbd> to nudge it around the board.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
