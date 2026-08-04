'use client';

import { useEffect, useRef } from 'react';
import { CardLinkableItem } from '@/lib/cardLinks';

interface CardLinkAutocompleteProps {
  /** Pre-filtered candidate items (the suggestion plugin owns filtering). */
  items: CardLinkableItem[];
  /** Index of the currently highlighted row (plugin-driven via updateProps). */
  highlighted: number;
  onSelect: (item: CardLinkableItem) => void;
  /** Hover drives the highlight, which lives in the plugin's renderer closure. */
  onHover?: (index: number) => void;
}

/**
 * The `@` card-link dropdown inside rich-text fields (Feature 10). Rendered
 * and positioned by the TipTap suggestion plugin (same popup pipeline as the
 * Feature 08 mention dropdown); this component only displays rows + reports
 * selection. Rows show the item title with a type badge, so the picker reads
 * the same as the structured-field link picker.
 */
export default function CardLinkAutocomplete({
  items,
  highlighted,
  onSelect,
  onHover,
}: CardLinkAutocompleteProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll the highlighted row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-highlighted="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  if (items.length === 0) return null;

  return (
    <div
      data-card-link-autocomplete
      className="z-50 min-w-[220px] max-w-[300px] max-h-56 overflow-y-auto rounded-lg bg-[#2C2824] border border-[#B58D3D]/50 shadow-2xl py-1"
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.preventDefault()}
    >
      <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-[#8C7B6E] border-b border-white/5 mb-0.5">
        Link a card
      </div>
      <div ref={listRef}>
        {items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            data-highlighted={i === highlighted}
            onMouseEnter={() => onHover?.(i)}
            onClick={() => onSelect(item)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors cursor-pointer ${
              i === highlighted ? 'bg-[#B58D3D]/20 text-[#E0D8D0]' : 'text-[#C9C0B1]'
            }`}
          >
            <span className="truncate font-medium flex-shrink min-w-0">{item.title}</span>
            <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-[#5D4037] bg-[#E0D8D0] rounded px-1 py-px flex-shrink-0">
              {item.itemType}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
