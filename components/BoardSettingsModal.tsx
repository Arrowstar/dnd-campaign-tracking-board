'use client';

import { useState, useRef } from 'react';
import { X, Sliders, RotateCcw, CheckCircle2, AlertCircle, Loader2, LayoutGrid, Tag as TagIcon, Plus } from 'lucide-react';
import { BoardSettings, TagDef } from '@/lib/types';
import { TAG_COLOR_PRESETS, normalizeTag, isLightColor } from '@/lib/tags';

const CARD_FONT_SCALE_MIN = 75;
const CARD_FONT_SCALE_MAX = 150;
const CARD_FONT_SCALE_STEP = 5;

interface BoardSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
  sessionToken: string;
  /** Currently persisted settings (the baseline to revert to on cancel). */
  settings: BoardSettings;
  /** Live-apply a draft so the canvas behind the modal updates immediately. */
  onPreviewChange: (settings: BoardSettings) => void;
  /** Every tag in use across the board (autocomplete for new definitions). */
  allTagNames?: string[];
}

export default function BoardSettingsModal({
  isOpen,
  onClose,
  boardId,
  sessionToken,
  settings,
  onPreviewChange,
  allTagNames = [],
}: BoardSettingsModalProps) {
  // Persisted settings as of opening the modal — the baseline to revert the
  // canvas to if the user cancels. The component mounts fresh on every open.
  const initialSettingsRef = useRef<BoardSettings>(settings);
  const [draft, setDraft] = useState<BoardSettings>(settings);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  if (!isOpen) return null;

  const scalePercent = Math.round((draft.cardFontScale ?? 1) * 100);

  const updateDraft = (next: BoardSettings) => {
    setDraft(next);
    onPreviewChange(next);
  };

  const handleClose = () => {
    if (isSaving) return;
    // Revert the canvas to the persisted settings unless they were saved.
    onPreviewChange(initialSettingsRef.current);
    onClose();
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');
    setIsSaving(true);
    try {
      const res = await fetch(`/api/boards/${boardId}/state`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ settings: draft }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save board settings.');
        return;
      }
      setSuccess('Board settings saved. Everyone will see the new card text size.');
      setTimeout(onClose, 900);
    } catch {
      setError('A network error occurred. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const tagDefs = draft.tagDefs || {};
  const setTagDefs = (next: Record<string, TagDef>) => updateDraft({ ...draft, tagDefs: next });
  const addTagDef = (raw: string) => {
    const t = normalizeTag(raw);
    if (!t) return;
    setTagDefs({ ...tagDefs, [t]: tagDefs[t] ?? {} });
    setNewTagName('');
  };
  const setTagDefColor = (tag: string, color: string) =>
    setTagDefs({ ...tagDefs, [tag]: { color } });
  const removeTagDef = (tag: string) => {
    const next = { ...tagDefs };
    delete next[tag];
    setTagDefs(next);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !isSaving) handleClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl transition-all"
        style={{ background: 'rgba(38,32,26,0.98)', border: '1px solid rgba(181,141,61,0.3)' }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid rgba(181,141,61,0.15)', background: 'rgba(0,0,0,0.2)' }}
        >
          <div className="flex items-center gap-2.5">
            <Sliders size={20} className="text-[#B58D3D]" />
            <div>
              <h2 className="text-[#E0D8D0] font-serif font-bold italic text-lg leading-tight">Board Settings</h2>
              <p className="text-[#8C7B6E] text-xs">Applies to this campaign board for every member</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8C7B6E] hover:text-[#E0D8D0] hover:bg-white/5 transition-colors cursor-pointer"
            title="Close (changes are not saved)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Section: Cards */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <LayoutGrid size={15} className="text-[#B58D3D]" />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#B58D3D]">Cards</span>
              <span className="text-[10px] text-[#8C7B6E]">Board item cards on the canvas</span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#8C7B6E]">
                  Card Text Size
                </label>
                <span className="text-sm font-bold font-mono text-[#B58D3D]">{scalePercent}%</span>
              </div>
              <input
                type="range"
                min={CARD_FONT_SCALE_MIN}
                max={CARD_FONT_SCALE_MAX}
                step={CARD_FONT_SCALE_STEP}
                value={scalePercent}
                onChange={(e) => updateDraft({ ...draft, cardFontScale: Number(e.target.value) / 100 })}
                className="w-full cursor-pointer"
                style={{ accentColor: '#B58D3D' }}
              />
              <div className="flex items-center justify-between text-[10px] text-[#8C7B6E] mt-1">
                <span>75%</span>
                <span className="font-mono text-[#B58D3D]">{CARD_FONT_SCALE_MIN}% – {CARD_FONT_SCALE_MAX}%</span>
                <span>150%</span>
              </div>
              <p className="text-[11px] text-[#8C7B6E] leading-relaxed mt-2">
                Scales the title, badges, preview text, and footer of every board item card (full,
                compact, and pin views) across all tabs.
              </p>
              <button
                type="button"
                onClick={() => updateDraft({ ...draft, cardFontScale: 1 })}
                disabled={scalePercent === 100}
                className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold text-[#8C7B6E] hover:text-[#E0D8D0] hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
              >
                <RotateCcw size={12} />
                Reset to 100%
              </button>
            </div>
          </div>

          {/* Section: Tag colors */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <TagIcon size={15} className="text-[#B58D3D]" />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#B58D3D]">Tag colors</span>
              <span className="text-[10px] text-[#8C7B6E]">Colors for #tags on cards — decoration only, tags still work without one</span>
            </div>

            <div className="flex flex-col gap-3">
              {Object.entries(tagDefs).length === 0 && (
                <p className="text-[11px] text-[#8C7B6E] leading-relaxed">
                  No tag colors defined yet. Add a tag below, then pick a swatch. Cards can also
                  define colors when a tag is added in the focus panel.
                </p>
              )}
              {Object.entries(tagDefs).map(([tag, def]) => {
                const color = def.color ?? '#8C7B6E';
                const light = isLightColor(color);
                return (
                  <div key={tag} className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(181,141,61,0.15)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className="text-[11px] font-bold rounded-full px-2 py-0.5"
                        style={{ backgroundColor: color, color: light ? '#1F2937' : '#FFFFFF' }}
                      >
                        #{tag}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeTagDef(tag)}
                        className="flex items-center gap-1 text-[10px] text-[#8C7B6E] hover:text-red-400 transition-colors cursor-pointer"
                        title="Remove color definition (tags stay on cards)"
                      >
                        <X size={11} /> Remove
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {TAG_COLOR_PRESETS.map(preset => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setTagDefColor(tag, preset)}
                          className="w-5 h-5 rounded-full cursor-pointer transition-transform hover:scale-110"
                          style={{
                            backgroundColor: preset,
                            boxShadow: def.color === preset
                              ? '0 0 0 2px #B58D3D, 0 0 0 4px rgba(181,141,61,0.3)'
                              : 'inset 0 0 0 1px rgba(0,0,0,0.25)',
                          }}
                          title={`Color ${preset}`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="flex items-center gap-1.5">
                <input
                  list="board-settings-tag-defs"
                  value={newTagName}
                  onChange={e => setNewTagName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTagDef(newTagName);
                    }
                  }}
                  placeholder="Tag name (e.g. villains)"
                  className="flex-1 min-w-0 border border-[#D9D0C1] bg-white/10 rounded px-2.5 py-1.5 text-xs text-[#E0D8D0] placeholder-[#8C7B6E] outline-none focus:border-[#B58D3D] transition-colors"
                />
                <datalist id="board-settings-tag-defs">
                  {allTagNames.filter(n => !(n in tagDefs)).map(n => <option key={n} value={n} />)}
                </datalist>
                <button
                  type="button"
                  onClick={() => addTagDef(newTagName)}
                  disabled={!normalizeTag(newTagName)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#B58D3D]/15 text-[#B58D3D] hover:bg-[#B58D3D]/25 text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
                >
                  <Plus size={12} /> Add
                </button>
              </div>
              <p className="text-[10px] text-[#8C7B6E]">
                Removing a definition never removes the tag from cards — it just falls back to gray.
              </p>
            </div>
          </div>

          {/* Feedback */}
          {error && (
            <div
              className="flex items-center gap-2 p-3 rounded-lg text-sm"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#FCA5A5' }}
            >
              <AlertCircle size={15} className="flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div
              className="flex items-center gap-2 p-3 rounded-lg text-sm"
              style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: '#86EFAC' }}
            >
              <CheckCircle2 size={15} className="flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid rgba(181,141,61,0.15)' }}>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSaving}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-[#8C7B6E] hover:text-[#E0D8D0] hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #B58D3D, #96722E)', color: '#1C1814', boxShadow: '0 4px 16px rgba(181,141,61,0.25)' }}
          >
            {isSaving && <Loader2 size={15} className="animate-spin" />}
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
