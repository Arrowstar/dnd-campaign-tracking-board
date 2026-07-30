import { BoardAnnotation, BoardItem, BoardAnnotationPin } from './types';

export function getResolvedControlPoints(
  ann: BoardAnnotation,
  items: BoardItem[],
  dragOffsets: Record<string, { x: number; y: number }> = {},
  itemDimensions: Record<string, { width: number; height: number }> = {}
) {
  const pins = ann.pins || [];

  const resolvePin = (index: number, fallbackX: number, fallbackY: number) => {
    const pin = pins[index];
    if (!pin) return { x: fallbackX, y: fallbackY, isPinned: false, pinnedItem: null, pinIndex: index };
    const item = items.find(i => i.id === pin.itemId);
    if (!item) return { x: fallbackX, y: fallbackY, isPinned: false, pinnedItem: null, pinIndex: index };

    const drag = dragOffsets[item.id] || { x: 0, y: 0 };
    return {
      x: item.x + drag.x + pin.offsetX,
      y: item.y + drag.y + pin.offsetY,
      isPinned: true,
      pinnedItem: item,
      pinIndex: index
    };
  };

  if (ann.type === 'line' || ann.type === 'arrow' || ann.type === 'double_arrow') {
    const pt0 = resolvePin(0, ann.x, ann.y);
    const pt1 = resolvePin(1, ann.x2 ?? (ann.x + 120), ann.y2 ?? (ann.y + 80));
    return {
      x1: pt0.x,
      y1: pt0.y,
      x2: pt1.x,
      y2: pt1.y,
      pin0: pt0,
      pin1: pt1
    };
  } else if (ann.type === 'text') {
    const pt0 = resolvePin(0, ann.x, ann.y);
    const w = ann.width || 160;
    const h = ann.height || 50;
    return {
      x: pt0.x - w / 2,
      y: pt0.y - h / 2,
      width: w,
      height: h,
      pin0: pt0
    };
  } else if (ann.type === 'rectangle') {
    const pt0 = resolvePin(0, ann.x, ann.y);
    const fallbackX2 = ann.x + (ann.width || 160);
    const fallbackY2 = ann.y + (ann.height || 100);
    const pt1 = resolvePin(1, fallbackX2, fallbackY2);

    const minX = Math.min(pt0.x, pt1.x);
    const minY = Math.min(pt0.y, pt1.y);
    const maxX = Math.max(pt0.x, pt1.x);
    const maxY = Math.max(pt0.y, pt1.y);

    return {
      x: minX,
      y: minY,
      width: Math.max(20, maxX - minX),
      height: Math.max(20, maxY - minY),
      x2: maxX,
      y2: maxY,
      pin0: pt0,
      pin1: pt1
    };
  } else if (ann.type === 'circle') {
    const pt0 = resolvePin(0, ann.x, ann.y);
    const fallbackX2 = ann.x + (ann.width || 140);
    const fallbackY2 = ann.y + (ann.height || 140);
    const pt1 = resolvePin(1, fallbackX2, fallbackY2);

    const minX = Math.min(pt0.x, pt1.x);
    const minY = Math.min(pt0.y, pt1.y);
    const maxX = Math.max(pt0.x, pt1.x);
    const maxY = Math.max(pt0.y, pt1.y);

    return {
      x: minX,
      y: minY,
      width: Math.max(20, maxX - minX),
      height: Math.max(20, maxY - minY),
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      rx: Math.max(10, (maxX - minX) / 2),
      ry: Math.max(10, (maxY - minY) / 2),
      pin0: pt0,
      pin1: pt1
    };
  }

  return { x: ann.x, y: ann.y };
}

/**
 * Finds if a canvas coordinate (x, y) falls within or near a BoardItem to attach a pin.
 */
export function findPinTargetItem(
  x: number,
  y: number,
  items: BoardItem[],
  dragOffsets: Record<string, { x: number; y: number }> = {},
  itemDimensions: Record<string, { width: number; height: number }> = {},
  padding = 30
): { item: BoardItem; offsetX: number; offsetY: number } | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const drag = dragOffsets[item.id] || { x: 0, y: 0 };
    const itemX = item.x + drag.x;
    const itemY = item.y + drag.y;
    const itemW = itemDimensions[item.id]?.width || item.width || 300;
    const itemH = itemDimensions[item.id]?.height || item.height || 200;

    if (
      x >= itemX - padding &&
      x <= itemX + itemW + padding &&
      y >= itemY - padding &&
      y <= itemY + itemH + padding
    ) {
      return {
        item,
        offsetX: x - itemX,
        offsetY: y - itemY
      };
    }
  }
  return null;
}

export function getMaxPinsForType(type: string): number {
  switch (type) {
    case 'line':
    case 'arrow':
    case 'double_arrow':
    case 'circle':
      return 2;
    case 'text':
      return 1;
    case 'rectangle':
      return 4;
    default:
      return 2;
  }
}

export const ANNOTATION_COLOR_PRESETS = [
  { name: 'Crimson Red', hex: '#EF4444' },
  { name: 'Amber Gold', hex: '#F59E0B' },
  { name: 'Emerald Green', hex: '#10B981' },
  { name: 'Royal Blue', hex: '#3B82F6' },
  { name: 'Deep Violet', hex: '#8B5CF6' },
  { name: 'Rose Pink', hex: '#EC4899' },
  { name: 'Charcoal Black', hex: '#1F2937' },
  { name: 'Parchment Dark', hex: '#423D38' },
  { name: 'Pure White', hex: '#FFFFFF' },
];

export const ANNOTATION_FONT_FAMILIES = [
  { id: 'sans-serif', name: 'Clean Sans' },
  { id: 'serif', name: 'Classic Serif' },
  { id: 'monospace', name: 'Code / Mono' },
  { id: 'cursive', name: 'Handwritten' },
  { id: 'Cinzel, serif', name: 'Fantasy / Ancient (Cinzel)' },
  { id: 'Playfair Display, serif', name: 'Elegant Serif' },
];

export const ANNOTATION_FONT_SIZES = [12, 14, 16, 18, 24, 32, 40, 48, 64];

export const ANNOTATION_STROKE_WIDTHS = [
  { id: 0, label: 'None (0px)' },
  { id: 1.5, label: 'Thin (1.5px)' },
  { id: 3, label: 'Normal (3px)' },
  { id: 5, label: 'Thick (5px)' },
  { id: 8, label: 'Heavy (8px)' },
  { id: 12, label: 'Bold (12px)' },
];
