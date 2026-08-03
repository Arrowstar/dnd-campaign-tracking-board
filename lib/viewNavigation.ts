import { BoardTab } from './types';

/**
 * Cross-link / search / notification navigation core (Feature 09).
 *
 * Extracted from Board.tsx's handleScrollToItem so the read-only BoardView
 * shares exactly the same tab-switch + center + flash behavior. Pure math
 * (navigateToItem) is split from DOM side effects (flash, viewport measure)
 * so it's unit-testable.
 */

export const POLL_INTERVAL_MS = 3000;

export type NavigationTarget = {
  /** Tab to switch to (null when the item is already on the active tab). */
  tabId: string | null;
  /** New transform positionX (centers the item horizontally). */
  x: number;
  /** New transform positionY (centers the item vertically). */
  y: number;
  /** Zoom scale to land on (clamped to [0.6, 1.5] of the current scale). */
  scale: number;
  /** Pan/zoom animation duration in ms. */
  duration: number;
};

export type NavigationInput = {
  tabs: BoardTab[];
  activeTabId: string;
  targetId: string;
  itemDimensions: Record<string, { width: number; height: number }>;
  viewportW: number;
  viewportH: number;
  currentScale: number;
};

/**
 * Computes the tab switch + transform needed to center `targetId` in the
 * viewport. Returns null when the item doesn't exist on any tab.
 */
export function navigateToItem(input: NavigationInput): NavigationTarget | null {
  const { tabs, activeTabId, targetId, itemDimensions, viewportW, viewportH, currentScale } = input;
  const targetTab = tabs.find((t) => t.items.some((i) => i.id === targetId));
  if (!targetTab) return null;
  const targetItem = targetTab.items.find((i) => i.id === targetId)!;

  const itemW = itemDimensions[targetId]?.width || targetItem.width || 300;
  const itemH = itemDimensions[targetId]?.height || targetItem.height || 200;

  const itemCenterX = targetItem.x + itemW / 2;
  const itemCenterY = targetItem.y + itemH / 2;

  const scale = Math.min(Math.max(currentScale, 0.6), 1.5);

  return {
    tabId: targetTab.id !== activeTabId ? targetTab.id : null,
    x: viewportW / 2 - itemCenterX * scale,
    y: viewportH / 2 - itemCenterY * scale,
    scale,
    duration: 400,
  };
}

/** Flash-highlight a rendered board item (DOM side effect; no-op server-side). */
export function flashItemElement(targetId: string): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(targetId);
  if (!el) return;
  el.style.transition = 'box-shadow 0.2s, ring 0.2s';
  el.style.boxShadow = '0 0 0 4px #B58D3D, 0 0 32px 8px #B58D3D88';
  setTimeout(() => {
    el.style.boxShadow = '';
  }, 1600);
}

/** Canvas viewport size, measured from the react-zoom-pan-pinch wrapper. */
export function getCanvasViewport(
  fallbackW: number,
  fallbackH: number
): { width: number; height: number } {
  if (typeof document === 'undefined') return { width: fallbackW, height: fallbackH };
  const wrapperEl =
    document.querySelector('.react-transform-component') ||
    (document.querySelector('.react-transform-wrapper') as HTMLElement | null);
  if (wrapperEl) {
    return { width: wrapperEl.clientWidth, height: wrapperEl.clientHeight };
  }
  return {
    width: typeof window !== 'undefined' ? window.innerWidth - 240 : fallbackW,
    height: typeof window !== 'undefined' ? window.innerHeight - 64 : fallbackH,
  };
}
