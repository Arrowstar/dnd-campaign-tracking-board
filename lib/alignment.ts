import { BoardItem } from './types';

/**
 * Alignment modes for a multi-selection of board items.
 *
 * The vertical group (left / center-x / right) aligns along the horizontal
 * axis — matching left edges, vertical midlines, or right edges. The horizontal
 * group (top / middle-y / bottom) aligns along the vertical axis — matching top
 * edges, horizontal midlines, or bottom edges.
 */
export type AlignMode =
  | 'left'
  | 'center-x'
  | 'right'
  | 'top'
  | 'middle-y'
  | 'bottom';

const DEFAULT_ITEM_HEIGHT = 200;

/**
 * Compute the aligned (x, y) for every item in the selection. All positions
 * are derived from the selection's aggregate bounding box (classic design-tool
 * semantics): left edges collapse to the leftmost edge, centers to the midline,
 * etc. Items keep their stored width/height — measured render sizes depend on
 * the zoom-driven level-of-detail tier (cards shrink to pins when zoomed out),
 * which would make alignment results zoom-dependent. Returns an id→position
 * map so callers can apply updates without re-sorting.
 */
export function alignItemPositions(
  items: BoardItem[],
  mode: AlignMode
): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  if (items.length === 0) return out;

  let minL = Infinity, maxR = -Infinity, minT = Infinity, maxB = -Infinity;
  for (const item of items) {
    const w = item.width;
    const h = item.height || DEFAULT_ITEM_HEIGHT;
    if (item.x < minL) minL = item.x;
    if (item.x + w > maxR) maxR = item.x + w;
    if (item.y < minT) minT = item.y;
    if (item.y + h > maxB) maxB = item.y + h;
  }
  const centerX = (minL + maxR) / 2;
  const centerY = (minT + maxB) / 2;

  for (const item of items) {
    const w = item.width;
    const h = item.height || DEFAULT_ITEM_HEIGHT;
    let nx = item.x;
    let ny = item.y;
    switch (mode) {
      case 'left':
        nx = minL;
        break;
      case 'center-x':
        nx = centerX - w / 2;
        break;
      case 'right':
        nx = maxR - w;
        break;
      case 'top':
        ny = minT;
        break;
      case 'middle-y':
        ny = centerY - h / 2;
        break;
      case 'bottom':
        ny = maxB - h;
        break;
    }
    out[item.id] = {
      x: Math.round(nx),
      y: Math.round(ny),
    };
  }
  return out;
}