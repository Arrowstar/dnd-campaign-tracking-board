'use client';

import { useEffect, useRef } from 'react';

export interface MentionableMember {
  id: string;
  username: string;
  displayName: string;
  role?: 'dm' | 'player';
}

interface MentionAutocompleteProps {
  /** Pre-filtered candidate members (the suggestion plugin owns filtering). */
  items: MentionableMember[];
  /** Index of the currently highlighted row (plugin-driven via updateProps). */
  highlighted: number;
  onSelect: (member: MentionableMember) => void;
  /** Hover drives the highlight, which lives in the plugin's renderer closure. */
  onHover?: (index: number) => void;
}

/** Case-insensitive prefix match on username + display name. */
export function filterMembers(members: MentionableMember[], query: string): MentionableMember[] {
  const q = query.trim().toLowerCase();
  if (!q) return members;
  return members.filter(
    m => m.username.toLowerCase().startsWith(q) || m.displayName.toLowerCase().startsWith(q)
  );
}

/**
 * The `@` mention dropdown inside the comment editor (Feature 08). Rendered
 * and positioned by the TipTap suggestion plugin (Floating UI), which appends
 * it to the document body; this component only displays rows + reports
 * selection. Keyboard navigation is handled by the plugin via updateProps.
 */
export default function MentionAutocomplete({
  items,
  highlighted,
  onSelect,
  onHover,
}: MentionAutocompleteProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll the highlighted row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-highlighted="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  if (items.length === 0) return null;

  return (
    <div
      className="min-w-[200px] max-w-[260px] max-h-56 overflow-y-auto rounded-lg bg-[#2C2824] border border-[#B58D3D]/50 shadow-2xl py-1"
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.preventDefault()}
    >
      <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-[#8C7B6E] border-b border-white/5 mb-0.5">
        Mention a member
      </div>
      <div ref={listRef}>
        {items.map((m, i) => (
          <button
            key={m.id}
            type="button"
            data-highlighted={i === highlighted}
            onMouseEnter={() => onHover?.(i)}
            onClick={() => onSelect(m)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors cursor-pointer ${
              i === highlighted ? 'bg-[#B58D3D]/20 text-[#E0D8D0]' : 'text-[#C9C0B1]'
            }`}
          >
            <span className="font-bold text-[#B58D3D] flex-shrink-0">@{m.username}</span>
            {m.displayName !== m.username && (
              <span className="truncate opacity-70 flex-shrink min-w-0">{m.displayName}</span>
            )}
            {m.role === 'dm' && (
              <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-[#5D4037] bg-[#E0D8D0] rounded px-1 py-px flex-shrink-0">
                DM
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
