'use client';

import { useId, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { TagDef } from '@/lib/types';
import { TAG_COLOR_PRESETS, normalizeTag, tagColor, isLightColor } from '@/lib/tags';

/**
 * Shared tag chip editor (Feature 02): current-tag chips with remove buttons,
 * an add input with datalist autocomplete, and (DM-only) an inline 8-swatch
 * color row offered when adding a tag that has no definition yet.
 *
 * Used by the FocusDrawer CONTENT tab and the bulk-tag popover on the board.
 */
export default function TagEditor({
  tags,
  onChange,
  suggestions,
  tagDefs,
  canDefineColors,
  onCreateTagDef,
  placeholder = 'Add tag...',
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  /** Autocomplete candidates: every tag in use across the board + defined defs. */
  suggestions: string[];
  tagDefs?: Record<string, TagDef>;
  /** DM-only: offered a color row when adding a tag without a definition. */
  canDefineColors: boolean;
  onCreateTagDef?: (tag: string, color: string) => void;
  placeholder?: string;
}) {
  const listId = useId();
  const [input, setInput] = useState('');
  // Tag typed with no definition, awaiting a color choice (DM) or skip.
  const [pendingTag, setPendingTag] = useState<string | null>(null);

  const commitTag = (tag: string) => {
    if (tags.includes(tag) || tags.length >= 8) return;
    onChange([...tags, tag]);
  };

  const submitInput = () => {
    const t = normalizeTag(input);
    setInput('');
    if (!t) return;
    if (canDefineColors && !tagColor(t, tagDefs) && !tags.includes(t)) {
      setPendingTag(t);
      return;
    }
    commitTag(t);
  };

  const filteredSuggestions = suggestions.filter(s => !tags.includes(s));

  return (
    <div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {tags.map(tag => {
            const color = tagColor(tag, tagDefs) ?? '#8C7B6E';
            const light = isLightColor(color);
            return (
              <span
                key={tag}
                className="flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{ backgroundColor: color, color: light ? '#1F2937' : '#FFFFFF' }}
              >
                #{tag}
                <button
                  type="button"
                  onClick={() => onChange(tags.filter(t => t !== tag))}
                  className="cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
                  title={`Remove #${tag}`}
                >
                  <X size={10} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-1">
        <input
          list={listId}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submitInput();
            }
          }}
          placeholder={placeholder}
          className="flex-1 min-w-[110px] border border-[#D9D0C1] bg-white/80 rounded px-2.5 py-1.5 text-xs text-[#2C2824] placeholder-[#8C7B6E] outline-none focus:border-[#B58D3D] transition-colors"
        />
        <datalist id={listId}>
          {filteredSuggestions.map(s => <option key={s} value={s} />)}
        </datalist>
        <button
          type="button"
          onClick={submitInput}
          disabled={!normalizeTag(input) || tags.length >= 8}
          className="flex items-center gap-1 px-2 py-1.5 rounded bg-[#B58D3D]/15 text-[#8C621E] hover:bg-[#B58D3D]/25 text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
          title="Add tag"
        >
          <Plus size={12} />
          Add
        </button>
      </div>

      {pendingTag && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <span className="text-[10px] font-bold text-[#8C7B6E] uppercase tracking-wider flex-shrink-0">
            #{pendingTag} color:
          </span>
          {TAG_COLOR_PRESETS.map(color => (
            <button
              key={color}
              type="button"
              onClick={() => {
                onCreateTagDef?.(pendingTag, color);
                commitTag(pendingTag);
                setPendingTag(null);
              }}
              className="w-4 h-4 rounded-full cursor-pointer hover:scale-110 transition-transform"
              style={{ backgroundColor: color, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.2)' }}
              title={color}
            />
          ))}
          <button
            type="button"
            onClick={() => {
              commitTag(pendingTag);
              setPendingTag(null);
            }}
            className="text-[10px] text-[#8C7B6E] hover:text-[#423D38] underline cursor-pointer"
          >
            Skip (gray)
          </button>
        </div>
      )}
    </div>
  );
}
