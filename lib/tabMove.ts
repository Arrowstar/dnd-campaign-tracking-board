import { BoardTab, Connection } from './types';

export type MoveItemsToTabResult = {
  /** New tabs array (same reference when nothing changed). */
  tabs: BoardTab[];
  /** Number of connections deleted because they touched a moved item. */
  droppedConnections: number;
};

/**
 * Move items to another tab. Tabs share one world space, so x/y are preserved
 * verbatim. Connections are per-tab arrays — a cross-tab edge would dangle, so
 * every connection with either endpoint among the moved ids is deleted and
 * counted (the caller surfaces the count in the move popover). Annotation pins
 * and `@@MULTILINK` cross-links are id-based and tab-agnostic — untouched.
 *
 * Rules:
 *  - Target tab missing → no-op.
 *  - Items are removed from whatever tab currently holds them (in practice the
 *    active tab) and appended to the target tab's items.
 *  - All other tab fields (annotations, name, color) are preserved.
 *  - Empty source tabs are valid.
 */
export function moveItemsToTab(
  tabs: BoardTab[],
  ids: Set<string>,
  targetTabId: string
): MoveItemsToTabResult {
  if (ids.size === 0) return { tabs, droppedConnections: 0 };
  const target = tabs.find(t => t.id === targetTabId);
  if (!target) return { tabs, droppedConnections: 0 };

  let droppedConnections = 0;
  const moved: BoardTab['items'] = [];
  let changed = false;

  const next = tabs.map(tab => {
    const tabItems = tab.items || [];
    const tabConns = tab.connections || [];

    const keepItems = tabItems.filter(item => {
      if (ids.has(item.id)) {
        moved.push(item);
        changed = true;
        return false;
      }
      return true;
    });

    let conns = tabConns;
    const touchesMoved = tabConns.filter(c => ids.has(c.fromId) || ids.has(c.toId));
    if (touchesMoved.length > 0) {
      conns = tabConns.filter(c => !ids.has(c.fromId) && !ids.has(c.toId));
      droppedConnections += touchesMoved.length;
      changed = true;
    }

    if (keepItems === tabItems && conns === tabConns) return tab;
    return { ...tab, items: keepItems, connections: conns };
  });

  if (!changed) return { tabs, droppedConnections };

  return {
    tabs: next.map(tab =>
      tab.id === targetTabId
        ? { ...tab, items: [...(tab.items || []), ...moved] }
        : tab
    ),
    droppedConnections,
  };
}

/**
 * Count the connections that a move would drop, without mutating anything —
 * used by the move popover's "N connections will be removed" footer.
 */
export function countConnectionsToDrop(tabs: BoardTab[], ids: Set<string>): number {
  if (ids.size === 0) return 0;
  let count = 0;
  for (const tab of tabs) {
    for (const c of tab.connections || []) {
      if (ids.has(c.fromId) || ids.has(c.toId)) count++;
    }
  }
  return count;
}
