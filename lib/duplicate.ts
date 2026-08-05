import { v4 as uuidv4 } from 'uuid';
import { BoardItem } from './types';

/** World bounds — the board canvas is a fixed 4000x4000 space (Board.tsx). */
export const WORLD_SIZE = 4000;

/** Per-copy offset applied by `duplicateItem` (canvas px). */
export const DUPLICATE_OFFSET = 24;

/** Max fan offset before wrapping (bulk duplicates stay on-canvas and readable). */
export const FAN_WRAP = 96;

/**
 * Duplicate a single board item.
 *
 * Everything is copied except:
 *  - `id` → fresh uuid (no shared state with the original)
 *  - `comments` → fresh `[]` (history/context is not a template)
 *  - `ownerId`/`ownerName` → the duplicator (so players duplicating their own
 *    card keep ownership; a DM duplicating a player card takes it over)
 *  - `x`/`y` → original + offset, clamped to the 4000x4000 world
 *
 * `fields`, `lines`, `crop`, `previewLayout` are replaced wholesale by
 * `handleUpdateItem` — shared references after the spread are safe because
 * nothing mutates them in place. Connections are NOT copied: the copy starts
 * unconnected (documented behavior).
 */
export function duplicateItem(
  item: BoardItem,
  newOwner: { id: string; name: string },
  offset = DUPLICATE_OFFSET
): BoardItem {
  const title = /^New .+$/.test(item.title) ? `${item.title} (copy)` : item.title;
  return {
    ...item,
    id: uuidv4(),
    title,
    x: clampPosition(item.x + offset, item.width),
    y: clampPosition(item.y + offset, item.height),
    ownerId: newOwner.id,
    ownerName: newOwner.name,
    comments: [],
  };
}

/**
 * Duplicate a batch of items, arranging the copies in a fan.
 *
 * Copy i lands at `(24 + i*12) % 96` canvas px from its original, so a large
 * batch wraps after 8 copies per axis instead of marching off-canvas. Each
 * copy keeps the original's width/height and is clamped to the world.
 */
export function duplicateItems(
  items: BoardItem[],
  newOwner: { id: string; name: string }
): BoardItem[] {
  return items.map((item, i) => {
    const offset = (DUPLICATE_OFFSET + i * 12) % FAN_WRAP;
    return duplicateItem(item, newOwner, offset);
  });
}

function clampPosition(pos: number, size: number): number {
  return Math.max(0, Math.min(pos, WORLD_SIZE - size));
}
