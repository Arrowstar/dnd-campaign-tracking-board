'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { BoardItem as BoardItemType, Connection, User, BoardTab, BoardAnnotation, AnnotationFontStyle } from '@/lib/types';
import BoardItem, { ITEM_FIELD_DEFS } from './BoardItem';
import Toolbar, { ARROW_COLOR_PRESETS, ARROW_LINE_STYLES, ARROW_LINE_WIDTHS } from './Toolbar';
import TabBar, { TAB_COLOR_PRESETS } from './TabBar';
import ItemSidebar from './ItemSidebar';
import FocusDrawer from './FocusDrawer';
import AnnotationCanvas from './AnnotationCanvas';
import { getResolvedControlPoints } from '@/lib/annotationUtils';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { getDefaultNpcFields } from './NpcBoardItemFields';
import { ZoomIn, ZoomOut, Maximize2, X, Sliders, Palette, Check, Trash2, Upload } from 'lucide-react';
import { uploadFileToBlob } from '@/lib/utils';
import { syncLinkTitles } from '@/lib/crossref';
import UserSettingsModal from './UserSettingsModal';
import MemberManagementModal from './MemberManagementModal';
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp';

const BOARD_ITEM_LOD_THRESHOLDS = {
  fullWidth: 130,
  fullHeight: 90,
  fullExpandWidth: 145,
  fullExpandHeight: 100,
  pinSize: 45,
  pinExpandSize: 56,
  pinScreenSize: 36,
};

function getBoxIntersection(cx: number, cy: number, hw: number, hh: number, targetCx: number, targetCy: number) {
  const dx = targetCx - cx;
  const dy = targetCy - cy;

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return { x: cx, y: cy };
  }

  const scaleX = hw / Math.abs(dx);
  const scaleY = hh / Math.abs(dy);
  const t = Math.min(scaleX, scaleY);

  return {
    x: cx + t * dx,
    y: cy + t * dy,
  };
}

export default function Board({ boardId }: { boardId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [tabs, setTabs] = useState<BoardTab[]>([
    { id: 'default-tab', name: 'Main Board', color: '#3B82F6', items: [], connections: [] }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('default-tab');

  // Modals
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showUserSettingsModal, setShowUserSettingsModal] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Persistence status — surfaced in the UI instead of silently swallowed
  const [saveError, setSaveError] = useState<string | null>(null);

  // Board member display names (for member-select field widgets)
  const [memberNames, setMemberNames] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    fetch(`/api/boards/${boardId}/members`, {
      headers: { Authorization: `Bearer ${user.sessionToken}` },
    })
      .then(res => res.json())
      .then(data => {
        if (data.members) setMemberNames((data.members as { displayName: string }[]).map(m => m.displayName));
      })
      .catch(() => { /* member options are non-critical; field widgets fall back to Custom */ });
  }, [boardId, user]);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0] || {
    id: 'default-tab',
    name: 'Main Board',
    color: '#3B82F6',
    items: [],
    connections: []
  };
  const items = activeTab.items || [];
  const connections = activeTab.connections || [];
  const annotations = activeTab.annotations || [];
  const allBoardItems = useMemo(() => tabs.flatMap(t => t.items || []), [tabs]);
  
  // Real-time tracking for drag offsets and actual DOM dimensions
  const [dragOffsets, setDragOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [itemDimensions, setItemDimensions] = useState<Record<string, { width: number; height: number }>>({});

  // Annotation Tool State
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [activeAnnColor, setActiveAnnColor] = useState<string>('#EF4444');
  const [activeAnnStrokeWidth, setActiveAnnStrokeWidth] = useState<number>(3);
  const [activeAnnStrokeStyle, setActiveAnnStrokeStyle] = useState<'solid' | 'dashed' | 'dotted'>('solid');
  const [activeAnnFillColor, setActiveAnnFillColor] = useState<string>('transparent');
  const [activeAnnFontStyle, setActiveAnnFontStyle] = useState<AnnotationFontStyle>({
    fontFamily: 'sans-serif',
    fontSize: 18,
    color: '#1F2937',
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
  });

  // Interactions state
  const [isAddingConnection, setIsAddingConnection] = useState(false);
  const [connectionStart, setConnectionStart] = useState<string | null>(null);
  const [connectionColor, setConnectionColor] = useState<string>('#9CA3AF');
  const [connectionStyle, setConnectionStyle] = useState<'solid' | 'dashed' | 'dotted'>('solid');
  const [connectionWidth, setConnectionWidth] = useState<number>(3);
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);
  const [isDraggingItem, setIsDraggingItem] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [editingConnectionLabel, setEditingConnectionLabel] = useState("");

  // Focus drawer state
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [drawerWidth, setDrawerWidth] = useState(520);

  // Keyboard-driven selection (Delete/Enter/arrow-key shortcuts operate on this)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  
  // Transform state ref & zoom percentage display
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<{ positionX: number; positionY: number; scale: number }>({
    positionX: 0,
    positionY: 0,
    scale: 1
  });
  const setTransformRef = useRef<((x: number, y: number, scale: number, animTime?: number) => void) | null>(null);
  const zoomInRef = useRef<(() => void) | null>(null);
  const zoomOutRef = useRef<(() => void) | null>(null);
  const resetTransformRef = useRef<(() => void) | null>(null);
  const [zoomScale, setZoomScale] = useState<number>(100);
  // Viewport-level pan offset (canvas coordinates -> screen coordinates),
  // mirrored from the TransformWrapper so the annotation layer can match it.
  const [viewPan, setViewPan] = useState<{ positionX: number; positionY: number }>({ positionX: 0, positionY: 0 });

  // Revision of the board state whose full payload we last applied locally.
  // The realtime poller only downloads the full board when this changes.
  const appliedRevisionRef = useRef<string | null>(null);

  const getItemRectInContainer = useCallback((itemId: string, fallbackItem: BoardItemType) => {
    const drag = dragOffsets[itemId];
    return {
      x: fallbackItem.x + (drag?.x || 0),
      y: fallbackItem.y + (drag?.y || 0),
      width: itemDimensions[itemId]?.width || fallbackItem.width || 300,
      height: itemDimensions[itemId]?.height || fallbackItem.height || 200,
    };
  }, [dragOffsets, itemDimensions]);

  const getConnectionGeometry = useCallback((conn: Connection) => {
    const fromItem = items.find(i => i.id === conn.fromId);
    const toItem = items.find(i => i.id === conn.toId);
    if (!fromItem || !toItem) return null;

    if (!user) return null;
    const fromVisible = (fromItem.visibility !== 'dm' || user.role === 'dm' || fromItem.ownerId === user.id) && (fromItem.visibility !== 'owner' || fromItem.ownerId === user.id);
    const toVisible = (toItem.visibility !== 'dm' || user.role === 'dm' || toItem.ownerId === user.id) && (toItem.visibility !== 'owner' || toItem.ownerId === user.id);
    if (!fromVisible || !toVisible) return null;

    const rectFrom = getItemRectInContainer(conn.fromId, fromItem);
    const rectTo = getItemRectInContainer(conn.toId, toItem);

    const cxA = rectFrom.x + rectFrom.width / 2;
    const cyA = rectFrom.y + rectFrom.height / 2;
    const hwA = rectFrom.width / 2;
    const hhA = rectFrom.height / 2;

    const cxB = rectTo.x + rectTo.width / 2;
    const cyB = rectTo.y + rectTo.height / 2;
    const hwB = rectTo.width / 2;
    const hhB = rectTo.height / 2;

    const startPt = getBoxIntersection(cxA, cyA, hwA, hhA, cxB, cyB);
    const endPt = getBoxIntersection(cxB, cyB, hwB, hhB, cxA, cyA);

    const dx = endPt.x - startPt.x;
    const dy = endPt.y - startPt.y;
    const dist = Math.hypot(dx, dy);
    const offset = Math.min(120, Math.max(30, dist * 0.3));

    let cpx1 = startPt.x, cpy1 = startPt.y, cpx2 = endPt.x, cpy2 = endPt.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const sign = dx >= 0 ? 1 : -1;
      cpx1 = startPt.x + offset * sign;
      cpx2 = endPt.x - offset * sign;
    } else {
      const sign = dy >= 0 ? 1 : -1;
      cpy1 = startPt.y + offset * sign;
      cpy2 = endPt.y - offset * sign;
    }

    const pathD = `M ${startPt.x} ${startPt.y} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${endPt.x} ${endPt.y}`;
    const tangentX = endPt.x - cpx2;
    const tangentY = endPt.y - cpy2;
    const arrowAngle = Math.atan2(tangentY, tangentX) * (180 / Math.PI);

    const midX = 0.125 * startPt.x + 0.375 * cpx1 + 0.375 * cpx2 + 0.125 * endPt.x;
    const midY = 0.125 * startPt.y + 0.375 * cpy1 + 0.375 * cpy2 + 0.125 * endPt.y;

    return {
      startPt,
      endPt,
      pathD,
      arrowAngle,
      midX,
      midY,
      color: conn.color || '#9ca3af',
      style: conn.style,
    };
  }, [items, user, getItemRectInContainer]);

  useEffect(() => {
    // Read the session token written by the lobby on login
    let sessionToken: string | null = null;
    try {
      const raw = localStorage.getItem('dnd_session');
      if (raw) sessionToken = JSON.parse(raw).sessionToken ?? null;
    } catch { /* ignore */ }

    if (!sessionToken) {
      window.location.href = '/';
      return;
    }

    // Single call: validates session + membership + returns board state
    fetch(`/api/boards/${boardId}/state`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then(res => {
        if (res.status === 401 || res.status === 403) {
          window.location.href = '/';
          return null;
        }
        return res.json();
      })
      .then((data: { userId: string; username: string; role: 'dm' | 'player'; tabs: any[]; updatedAt?: string | null } | null) => {
        if (!data) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setUser({
          id: data.userId,
          name: data.username,
          role: data.role,
          boardId,
          sessionToken: sessionToken!,
        });
        if (typeof data.updatedAt === 'string' && data.updatedAt) {
          appliedRevisionRef.current = data.updatedAt;
        }
        let parsedTabs: BoardTab[] = [];
        if (data.tabs && Array.isArray(data.tabs) && data.tabs.length > 0) {
          parsedTabs = data.tabs;
        } else {
          parsedTabs = [{
            id: 'default-tab', name: 'Main Board', color: '#3B82F6', items: [], connections: []
          }];
        }
        setTabs(parsedTabs);
        setActiveTabId(prev => {
          if (parsedTabs.some(t => t.id === prev)) return prev;
          return parsedTabs[0]?.id || 'default-tab';
        });
      })
      .catch(err => console.error('Failed to load board:', err));
  }, [boardId]);

  // Real-time sync via revision polling: a cheap revision request every few
  // seconds tells us if the board changed elsewhere; the full (per-user
  // scrubbed) state is only downloaded when it did. Also covers kick
  // detection — a 403 on the revision endpoint means we're no longer a member.
  useEffect(() => {
    if (!user || !user.sessionToken) return;

    const POLL_INTERVAL_MS = 3000;
    let cancelled = false;
    let inFlight = false;

    const isActivelyEditing = () => {
      const el = document.activeElement;
      return !!el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
    };

    const handleMembershipLost = () => {
      alert('You have been removed from this campaign by the Dungeon Master.');
      window.location.href = '/';
    };

    const handleSessionLost = () => {
      window.location.href = '/';
    };

    const applyFullState = async (): Promise<boolean> => {
      try {
        const res = await fetch(`/api/boards/${boardId}/state`, {
          headers: { Authorization: `Bearer ${user.sessionToken}` },
        });
        if (res.status === 401) {
          handleSessionLost();
          return false;
        }
        if (res.status === 403) {
          handleMembershipLost();
          return false;
        }
        if (!res.ok) return false;
        const data = (await res.json()) as { tabs: BoardTab[] | undefined };
        if (cancelled || !data.tabs || !Array.isArray(data.tabs)) return false;
        const freshTabs: BoardTab[] = data.tabs;
        setTabs(freshTabs);
        setActiveTabId(prev => {
          if (freshTabs.some(t => t.id === prev)) return prev;
          return freshTabs[0]?.id || 'default-tab';
        });
        return true;
      } catch (err) {
        console.error('Failed to refresh board state:', err);
        return false;
      }
    };

    const poll = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/boards/${boardId}/revision`, {
          headers: { Authorization: `Bearer ${user.sessionToken}` },
        });
        if (res.status === 401) {
          handleSessionLost();
          return;
        }
        if (res.status === 403) {
          handleMembershipLost();
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        const revision = data.updatedAt ?? null;
        if (revision === null || revision === appliedRevisionRef.current) return;
        // Never yank state mid-edit; the revision is only marked as applied
        // once the full state actually landed, so we retry after typing stops.
        if (isActivelyEditing()) return;
        if (await applyFullState()) {
          appliedRevisionRef.current = revision;
        }
      } catch (err) {
        console.error('Failed to check board revision:', err);
      } finally {
        inFlight = false;
      }
    };

    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') poll();
    };
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      window.removeEventListener('focus', poll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [boardId, user]);

  // All saves are chained onto this promise so requests hit the server strictly
  // in order — otherwise two concurrent saves can resolve out of order and an
  // older snapshot can silently overwrite a newer one.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const persistBoardState = useCallback(
    (updatedTabs: BoardTab[]) => {
      if (!user?.sessionToken) return;
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        const body = JSON.stringify({ tabs: updatedTabs });
        const approxMb = body.length / (1024 * 1024);
        if (approxMb > 4) {
          console.error(`Board payload is ${approxMb.toFixed(2)} MB — too large to save.`);
          setSaveError(
            'This board is too large to save (likely an old image stored directly in the board instead of as a link). Contact the DM about running the image migration.'
          );
          return;
        }
        try {
          const res = await fetch(`/api/boards/${boardId}/state`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${user.sessionToken}`,
            },
            body,
          });
          if (!res.ok) {
            const detail = await res.text().catch(() => '');
            console.error('Board save failed:', res.status, detail);
            setSaveError(
              res.status === 413
                ? 'This board is too large to save. Contact the DM about running the image migration.'
                : "Your last change couldn't be saved. Retrying automatically."
            );
            return;
          }
          // The save echo includes the new revision, so the realtime poller
          // knows this board state is already applied locally and skips it.
          const saved = await res.json().catch(() => null);
          if (saved && typeof saved.updatedAt === 'string' && saved.updatedAt) {
            appliedRevisionRef.current = saved.updatedAt;
          }
          setSaveError(null);
        } catch (err) {
          console.error('Error saving board state:', err);
          setSaveError("Your last change couldn't be saved. Retrying automatically.");
        }
      });
    },
    [boardId, user?.sessionToken]
  );

  const saveState = useCallback(
    (newItems: BoardItemType[], newConns: Connection[], newAnnotations?: BoardAnnotation[]) => {
      setTabs((prevTabs) => {
        const targetId = activeTabId || (prevTabs[0]?.id ?? 'default-tab');
        const updatedTabs = prevTabs.map((t) => {
          if (t.id === targetId) {
            return {
              ...t,
              items: newItems,
              connections: newConns,
              annotations: newAnnotations !== undefined ? newAnnotations : t.annotations || [],
            };
          }
          return t;
        });

        // Keep link-token title snapshots in sync with item titles so the UI
        // (and the persisted copy) reflect renames immediately.
        const syncedTabs = syncLinkTitles(updatedTabs);

        // Trigger asynchronous persistence
        persistBoardState(syncedTabs);
        return syncedTabs;
      });
    },
    [activeTabId, persistBoardState]
  );

  const handleUpdateAnnotation = useCallback(
    (updated: BoardAnnotation) => {
      const currentAnns = activeTab.annotations || [];
      const existingAnn = currentAnns.find((a) => a.id === updated.id);
      if (existingAnn && user && user.role !== 'dm' && existingAnn.ownerId && existingAnn.ownerId !== user.id) {
        return; // not allowed to edit
      }
      const newAnns = currentAnns.map((a) => (a.id === updated.id ? updated : a));
      saveState(items, connections, newAnns);
    },
    [activeTab.annotations, items, connections, saveState, user]
  );

  const handleAddAnnotation = useCallback(
    (newAnn: BoardAnnotation) => {
      const currentAnns = activeTab.annotations || [];
      const augmentedAnn = { ...newAnn, ownerId: user?.id, ownerName: user?.name };
      const newAnns = [...currentAnns, augmentedAnn];
      saveState(items, connections, newAnns);
    },
    [activeTab.annotations, items, connections, saveState, user]
  );

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      const currentAnns = activeTab.annotations || [];
      const existingAnn = currentAnns.find((a) => a.id === id);
      if (existingAnn && user && user.role !== 'dm' && existingAnn.ownerId && existingAnn.ownerId !== user.id) {
        return; // not allowed to delete
      }
      const newAnns = currentAnns.filter((a) => a.id !== id);
      saveState(items, connections, newAnns);
    },
    [activeTab.annotations, items, connections, saveState, user]
  );

  const saveFullTabsState = useCallback(
    (updatedTabs: BoardTab[]) => {
      setTabs(updatedTabs);
      persistBoardState(updatedTabs);
    },
    [persistBoardState]
  );

  const handleAddTab = useCallback(() => {
    const newTab: BoardTab = {
      id: uuidv4(),
      name: `Tab ${tabs.length + 1}`,
      color: TAB_COLOR_PRESETS[tabs.length % TAB_COLOR_PRESETS.length].hex,
      items: [],
      connections: []
    };
    const updatedTabs = [...tabs, newTab];
    setActiveTabId(newTab.id);
    saveFullTabsState(updatedTabs);
  }, [tabs, saveFullTabsState]);

  const handleRenameTab = useCallback((tabId: string, newName: string) => {
    const updatedTabs = tabs.map(t => t.id === tabId ? { ...t, name: newName } : t);
    saveFullTabsState(updatedTabs);
  }, [tabs, saveFullTabsState]);

  const handleChangeTabColor = useCallback((tabId: string, newColor: string) => {
    const updatedTabs = tabs.map(t => t.id === tabId ? { ...t, color: newColor } : t);
    saveFullTabsState(updatedTabs);
  }, [tabs, saveFullTabsState]);

  const handleReorderTabs = useCallback((reorderedTabs: BoardTab[]) => {
    saveFullTabsState(reorderedTabs);
  }, [saveFullTabsState]);

  const handleDeleteTab = useCallback((tabId: string) => {
    if (tabs.length <= 1) return;
    const updatedTabs = tabs.filter(t => t.id !== tabId);
    if (activeTabId === tabId) {
      const deletedIndex = tabs.findIndex(t => t.id === tabId);
      const newActiveIndex = Math.max(0, deletedIndex - 1);
      setActiveTabId(updatedTabs[newActiveIndex].id);
    }
    saveFullTabsState(updatedTabs);
  }, [tabs, activeTabId, saveFullTabsState]);

  const handleDragMove = useCallback((id: string, dx: number, dy: number) => {
    setDragOffsets(prev => ({ ...prev, [id]: { x: dx, y: dy } }));
  }, []);

  const handleDragEndItem = useCallback((id: string) => {
    setDragOffsets(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setIsDraggingItem(false);
  }, []);

  const handleReportDimensions = useCallback((id: string, width: number, height: number) => {
    setItemDimensions(prev => {
      if (prev[id]?.width === width && prev[id]?.height === height) return prev;
      return { ...prev, [id]: { width, height } };
    });
  }, []);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent | PointerEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable)
      ) {
        const target = e.target as Node | null;
        if (target && activeEl !== target && !activeEl.contains(target)) {
          (activeEl as HTMLElement).blur();
        }
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('mousedown', handlePointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('mousedown', handlePointerDown, true);
    };
  }, []);

  const getDefaultColor = (type: BoardItemType['type']): string => {
    switch (type) {
      case 'note': return '#FEF08A'; // Sticky Yellow
      case 'quest': return '#991B1B'; // Crimson
      case 'location': return '#065F46'; // Forest Green
      case 'character': return '#1E3A8A'; // Royal Blue
      case 'npc': return '#5B21B6'; // Deep Violet
      case 'session': return '#92400E'; // Leather Brown
      default: return '#423D38';
    }
  };

  const handleAddItem = (type: BoardItemType['type']) => {
    if (!user) return;
    const isNpc = type === 'npc';
    const { positionX, positionY, scale } = transformRef.current;
    
    // Viewport dimensions of the board canvas container (below 64px header)
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const viewportH = typeof window !== 'undefined' ? (window.innerHeight - 64) : 800;

    const screenCenterX = viewportW / 2;
    const screenCenterY = viewportH / 2;

    // Translate screen center to current canvas coordinates
    const canvasCenterX = (screenCenterX - positionX) / scale;
    const canvasCenterY = (screenCenterY - positionY) / scale;

    const newItem: BoardItemType = {
      id: uuidv4(),
      type,
      x: Math.round(canvasCenterX - (isNpc ? 180 : 150) + (Math.random() * 40 - 20)),
      y: Math.round(canvasCenterY - (isNpc ? 240 : 100) + (Math.random() * 40 - 20)),
      width: isNpc ? 360 : 300,
      height: isNpc ? 480 : 200,
      title: isNpc ? 'New NPC' : 'New ' + type,
      content: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      color: getDefaultColor(type),
      tags: [],
      visibility: 'all',
      ownerId: user.id,
      ownerName: user.name,
      comments: [],
      fields: isNpc ? getDefaultNpcFields() : undefined
    };
    saveState([...items, newItem], connections);
  };

  // ── Canvas-level image drop (creates a new Image board item) ──────────────
  const [isCanvasDragging, setIsCanvasDragging] = useState(false);
  const canvasDragCounter = useRef(0);

  const handleCanvasDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    canvasDragCounter.current = 0;
    setIsCanvasDragging(false);
    if (!user) return;

    const { positionX, positionY, scale } = transformRef.current;
    const canvasEl = e.currentTarget.getBoundingClientRect();
    // Convert drop position from screen coords → canvas coords
    const dropCanvasX = (e.clientX - canvasEl.left - positionX) / scale;
    const dropCanvasY = (e.clientY - canvasEl.top - positionY) / scale;

    const newItemBase = {
      id: uuidv4(),
      type: 'image' as const,
      x: Math.round(dropCanvasX - 150),
      y: Math.round(dropCanvasY - 100),
      width: 300,
      height: 300,
      title: 'Dropped Image',
      content: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      color: '#423D38',
      tags: [],
      visibility: 'all' as const,
      ownerId: user.id,
      ownerName: user.name,
      comments: [],
    };

    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      try {
        const imageUrl = await uploadFileToBlob(file);
        saveState([...items, { ...newItemBase, content: imageUrl }], connections);
      } catch (err) {
        console.error('Error processing canvas-dropped image:', err);
      }
      return;
    }
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('URL');
    if (url && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/'))) {
      saveState([...items, { ...newItemBase, content: url.trim() }], connections);
    }
  };

  const handleFitView = useCallback((setTransform: (x: number, y: number, scale: number, animTime?: number) => void) => {
    if (!user) return;
    const visibleItems = items.filter(i => {
      if (i.visibility === 'dm' && user.role !== 'dm' && i.ownerId !== user.id) return false;
      if (i.visibility === 'owner' && i.ownerId !== user.id) return false;
      return true;
    });

    const boardContainer = document.querySelector('.absolute.inset-0.top-16') as HTMLElement | null;
    const viewportW = boardContainer ? boardContainer.clientWidth : (typeof window !== 'undefined' ? window.innerWidth : 1200);
    const viewportH = boardContainer ? boardContainer.clientHeight : (typeof window !== 'undefined' ? (window.innerHeight - 64) : 800);

    if (visibleItems.length === 0) {
      const targetScale = 1;
      const targetX = viewportW / 2 - 2000 * targetScale;
      const targetY = viewportH / 2 - 2000 * targetScale;
      setTransform(targetX, targetY, targetScale, 300);
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    visibleItems.forEach(item => {
      const el = document.getElementById(item.id);
      let itemW = itemDimensions[item.id]?.width || item.width || 300;
      let itemH = itemDimensions[item.id]?.height || item.height || 200;

      if (el) {
        itemW = Math.max(itemW, el.offsetWidth || 0);
        itemH = Math.max(itemH, el.offsetHeight || 0);

        // Include any open absolute dropdown/popover children (e.g. comments drawer below card)
        const absoluteChildren = el.querySelectorAll('.absolute.top-full');
        absoluteChildren.forEach(child => {
          const childEl = child as HTMLElement;
          if (childEl.offsetHeight) {
            itemH = Math.max(itemH, el.offsetHeight + childEl.offsetHeight + 12);
          }
        });
      }

      if (item.x < minX) minX = item.x;
      if (item.x + itemW > maxX) maxX = item.x + itemW;
      if (item.y < minY) minY = item.y;
      if (item.y + itemH > maxY) maxY = item.y + itemH;
    });

    const padding = 100; // px
    minX -= padding;
    maxX += padding;
    minY -= padding;
    maxY += padding;

    const boxW = Math.max(300, maxX - minX);
    const boxH = Math.max(300, maxY - minY);

    const scaleX = viewportW / boxW;
    const scaleY = viewportH / boxH;
    let targetScale = Math.min(scaleX, scaleY);

    targetScale = Math.max(0.1, Math.min(1.5, targetScale));

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const targetX = viewportW / 2 - centerX * targetScale;
    const targetY = viewportH / 2 - centerY * targetScale;

    setTransform(targetX, targetY, targetScale, 300);
  }, [user, items, itemDimensions]);

  const handleUpdateItem = useCallback((updatedItem: BoardItemType) => {
    const existing = items.find(i => i.id === updatedItem.id);

    // Permission guard: only the owner or DM may edit an item's own
    // content/position/etc. Everyone should still be able to comment on
    // an item that's visible to them, even if they don't own it — so
    // for non-owners we don't reject the update outright, we down-scope
    // it to just the comments field and discard anything else they may
    // have tried to change.
    let itemToApply = updatedItem;
    if (existing && user && user.role !== 'dm' && existing.ownerId !== user.id) {
      const isVisibleToUser =
        existing.visibility !== 'dm' && existing.visibility !== 'owner';
      if (!isVisibleToUser) return;
      itemToApply = { ...existing, comments: updatedItem.comments };
    }

    const newItems = items.map(i => i.id === itemToApply.id ? itemToApply : i);
    const currentAnns = activeTab.annotations || [];
    let annChanged = false;
    const newAnns = currentAnns.map(ann => {
      if (!ann.pins || !ann.pins.some(p => p?.itemId === itemToApply.id)) return ann;
      annChanged = true;
      const geom = getResolvedControlPoints(ann, newItems, dragOffsets, itemDimensions);
      return {
        ...ann,
        x: geom.x1 ?? geom.x ?? ann.x,
        y: geom.y1 ?? geom.y ?? ann.y,
        x2: geom.x2 ?? ann.x2,
        y2: geom.y2 ?? ann.y2,
        width: geom.width ?? ann.width,
        height: geom.height ?? ann.height,
      };
    });
    saveState(newItems, connections, annChanged ? newAnns : undefined);
  }, [items, user, activeTab.annotations, dragOffsets, itemDimensions, connections, saveState]);

  const handleDeleteItem = useCallback((id: string) => {
    // Permission guard: only the owner or DM may delete an item.
    const existing = items.find(i => i.id === id);
    if (existing && user && user.role !== 'dm' && existing.ownerId !== user.id) return;

    const newItems = items.filter(i => i.id !== id);
    const newConns = connections.filter(c => c.fromId !== id && c.toId !== id);
    const currentAnns = activeTab.annotations || [];
    let annChanged = false;
    const newAnns = currentAnns.map(ann => {
      if (!ann.pins || !ann.pins.some(p => p?.itemId === id)) return ann;
      annChanged = true;
      const geom = getResolvedControlPoints(ann, items, dragOffsets, itemDimensions);
      const updatedPins = ann.pins.map(p => p?.itemId === id ? null : p);
      const hasRemainingPins = updatedPins.some(Boolean);
      return {
        ...ann,
        x: geom.x1 ?? geom.x ?? ann.x,
        y: geom.y1 ?? geom.y ?? ann.y,
        x2: geom.x2 ?? ann.x2,
        y2: geom.y2 ?? ann.y2,
        width: geom.width ?? ann.width,
        height: geom.height ?? ann.height,
        pins: hasRemainingPins ? updatedPins : undefined,
      };
    });
    saveState(newItems, newConns, annChanged ? newAnns : undefined);
  }, [items, user, connections, activeTab.annotations, dragOffsets, itemDimensions, saveState]);

  const handleItemClick = useCallback((id: string) => {
    if (isAddingConnection) {
      if (!connectionStart) {
        setConnectionStart(id);
      } else if (connectionStart !== id) {
        const newConn: Connection = {
          id: uuidv4(),
          fromId: connectionStart,
          toId: id,
          label: 'Connected',
          color: connectionColor,
          style: connectionStyle,
          width: connectionWidth
        };
        const newConnsList = [...connections, newConn];
        saveState(items, newConnsList);
        setIsAddingConnection(false);
        setConnectionStart(null);
      }
      return;
    }
    // When NOT in connection mode, clicking selects — keyboard shortcuts
    // (Delete, Enter, arrows) operate on the selection. Open focus via
    // double-click, the ExternalLink button, or pressing Enter.
    setSelectedItemId(id);
  }, [isAddingConnection, connectionStart, connectionColor, connectionStyle, connectionWidth, items, connections, saveState]);

  const handleOpenFocus = useCallback((id: string) => {
    setFocusedItemId(id);
  }, []);

  const handleCloseFocus = useCallback(() => {
    setFocusedItemId(null);
  }, []);

  // ── Global keyboard shortcuts ───────────────────────────────────────────────
  // Operate on the selected board item (click a card to select it). Keys are
  // ignored while typing in inputs/editors or when a modal is open.
  useEffect(() => {
    const isTypingTarget = (el: Element | null) =>
      !!el &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
       el.tagName === 'BUTTON' || el.tagName === 'A' || (el as HTMLElement).isContentEditable);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(document.activeElement)) return;
      if (showMembersModal || showUserSettingsModal) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          if (selectedItemId) {
            e.preventDefault();
            handleDeleteItem(selectedItemId);
            setSelectedItemId(null);
          }
          break;
        case 'Escape':
          setSelectedItemId(null);
          setIsAddingConnection(false);
          setConnectionStart(null);
          setActiveTool(null);
          setShowShortcutsHelp(false);
          handleCloseFocus();
          break;
        case 'Enter':
          if (selectedItemId) {
            e.preventDefault();
            handleOpenFocus(selectedItemId);
          }
          break;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          const selected = items.find(i => i.id === selectedItemId);
          if (selected) {
            e.preventDefault();
            const step = e.shiftKey ? 10 : 1;
            const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
            const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
            handleUpdateItem({ ...selected, x: selected.x + dx, y: selected.y + dy });
          }
          break;
        }
        case 'f':
        case 'F':
          if (setTransformRef.current) handleFitView(setTransformRef.current);
          break;
        case '+':
        case '=':
          zoomInRef.current?.();
          break;
        case '-':
          zoomOutRef.current?.();
          break;
        case '0':
          resetTransformRef.current?.();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItemId, items, showMembersModal, showUserSettingsModal, handleDeleteItem, handleUpdateItem, handleOpenFocus, handleCloseFocus, handleFitView]);

  const handleDragStartItem = useCallback(() => setIsDraggingItem(true), []);

  /**
   * Pan & zoom the canvas so the given board item is centered in view.
   * Called when a user clicks a linked-item chip inside a board card.
   */
  const handleScrollToItem = useCallback((targetId: string) => {
    // Check if item belongs to another tab
    const targetTab = tabs.find(t => t.items.some(i => i.id === targetId));
    if (targetTab && targetTab.id !== activeTabId) {
      setActiveTabId(targetTab.id);
    }

    setTimeout(() => {
      const targetItem = allBoardItems.find(i => i.id === targetId);
      if (!targetItem || !setTransformRef.current) return;

      const wrapperEl = (document.querySelector('.react-transform-component') || document.querySelector('.react-transform-wrapper')) as HTMLElement | null;
      const viewportW = wrapperEl ? wrapperEl.clientWidth : (typeof window !== 'undefined' ? window.innerWidth - 240 : 1200);
      const viewportH = wrapperEl ? wrapperEl.clientHeight : (typeof window !== 'undefined' ? (window.innerHeight - 64) : 800);

      const el = document.getElementById(targetId);
      const itemW = el?.offsetWidth || itemDimensions[targetId]?.width || targetItem.width || 300;
      const itemH = el?.offsetHeight || itemDimensions[targetId]?.height || targetItem.height || 200;

      const itemCenterX = targetItem.x + itemW / 2;
      const itemCenterY = targetItem.y + itemH / 2;

      const currentScale = transformRef.current.scale || 1;
      const targetScale = Math.min(Math.max(currentScale, 0.6), 1.5);

      const newX = viewportW / 2 - itemCenterX * targetScale;
      const newY = viewportH / 2 - itemCenterY * targetScale;

      setTransformRef.current(newX, newY, targetScale, 400);

      // Flash-highlight the item briefly
      if (el) {
        el.style.transition = 'box-shadow 0.2s, ring 0.2s';
        el.style.boxShadow = '0 0 0 4px #B58D3D, 0 0 32px 8px #B58D3D88';
        setTimeout(() => {
          el.style.boxShadow = '';
        }, 1600);
      }
    }, 50);
  }, [tabs, activeTabId, allBoardItems, itemDimensions]);

  if (!user) return <div className="min-h-screen bg-[#F5F2ED] flex items-center justify-center text-[#423D38]">Loading...</div>;

  const startItem = connectionStart ? items.find(i => i.id === connectionStart) : null;

  return (
    <div className="w-screen h-screen bg-[#F5F2ED] overflow-hidden relative font-sans text-[#423D38] flex flex-col">
      {saveError && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-red-600 text-white text-sm text-center py-1.5 px-4">
          {saveError}
        </div>
      )}
      <Toolbar 
        user={user} 
        isAddingConnection={isAddingConnection}
        onToggleConnection={() => {
          setIsAddingConnection(!isAddingConnection);
          setConnectionStart(null);
        }}
        connectionColor={connectionColor}
        setConnectionColor={setConnectionColor}
        connectionStyle={connectionStyle}
        setConnectionStyle={setConnectionStyle}
        connectionWidth={connectionWidth}
        setConnectionWidth={setConnectionWidth}
        connectionStartItemTitle={startItem?.title}

        activeTool={activeTool}
        setActiveTool={setActiveTool}
        activeAnnColor={activeAnnColor}
        setActiveAnnColor={setActiveAnnColor}
        activeAnnStrokeWidth={activeAnnStrokeWidth}
        setActiveAnnStrokeWidth={setActiveAnnStrokeWidth}
        activeAnnStrokeStyle={activeAnnStrokeStyle}
        setActiveAnnStrokeStyle={setActiveAnnStrokeStyle}
        activeAnnFillColor={activeAnnFillColor}
        setActiveAnnFillColor={setActiveAnnFillColor}
        activeAnnFontStyle={activeAnnFontStyle}
        setActiveAnnFontStyle={setActiveAnnFontStyle}
        onOpenMembersModal={() => setShowMembersModal(true)}
        onOpenSettingsModal={() => setShowUserSettingsModal(true)}
        onOpenShortcutsHelp={() => setShowShortcutsHelp(true)}
      />
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={(tabId) => {
          setSelectedItemId(null);
          setActiveTabId(tabId);
        }}
        onAddTab={handleAddTab}
        onRenameTab={handleRenameTab}
        onChangeTabColor={handleChangeTabColor}
        onReorderTabs={handleReorderTabs}
        onDeleteTab={handleDeleteTab}
      />
      
      <div className="flex-1 relative flex overflow-hidden">
        <ItemSidebar onAddItem={handleAddItem} />
        <div
          className="flex-1 h-full relative overflow-hidden flex"
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            // Only show canvas overlay when dragging over the background, not over a card
            canvasDragCounter.current += 1;
            if (canvasDragCounter.current === 1) setIsCanvasDragging(true);
          }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            canvasDragCounter.current -= 1;
            if (canvasDragCounter.current <= 0) {
              canvasDragCounter.current = 0;
              setIsCanvasDragging(false);
            }
          }}
          onDrop={handleCanvasDrop}
        >
          {/* Canvas drag-and-drop overlay */}
          {isCanvasDragging && (
            <div className="absolute inset-0 z-50 pointer-events-none flex items-end justify-center pb-8">
              <div className="flex items-center gap-2.5 bg-[#2C2824]/90 backdrop-blur-sm border border-[#B58D3D] text-[#E0D8D0] px-5 py-3 rounded-2xl shadow-2xl font-bold text-sm animate-pulse">
                <Upload size={18} className="text-[#B58D3D]" />
                <span>Drop image to create a new board card</span>
              </div>
            </div>
          )}
        <TransformWrapper
          initialScale={1}
          minScale={0.05}
          maxScale={4}
          limitToBounds={false}
          centerOnInit={true}
          smooth={true}
          wheel={{ step: 0.0008 }} // Step is multiplied by event.deltaY (~100 per mouse wheel tick), giving ~8% zoom per notch
          doubleClick={{ disabled: true }}
          panning={{ disabled: isAddingConnection || isDraggingItem || !!(activeTool && activeTool.startsWith('ann_')), velocityDisabled: true, excluded: ['no-pan'] }}
          onTransform={(ref) => {
            transformRef.current = {
              positionX: ref.state.positionX,
              positionY: ref.state.positionY,
              scale: ref.state.scale
            };
            setZoomScale(Math.round(ref.state.scale * 100));
            setViewPan({ positionX: ref.state.positionX, positionY: ref.state.positionY });
          }}
        >
          {({ zoomIn, zoomOut, resetTransform, setTransform }) => {
            // Capture transform/zoom actions for use in keyboard shortcuts & scroll-to-item handler
            setTransformRef.current = setTransform;
            zoomInRef.current = zoomIn;
            zoomOutRef.current = zoomOut;
            resetTransformRef.current = resetTransform;
            return (
            <>
              <div className="absolute bottom-4 right-4 z-50 flex items-center gap-1.5 bg-[#2C2824] p-1.5 rounded-lg border border-[#B58D3D] shadow-2xl text-[#E0D8D0]">
                <button 
                  onClick={() => handleFitView(setTransform)} 
                  className="px-2.5 py-1.5 rounded bg-[#423D38] hover:bg-[#5D554E] transition-colors flex items-center gap-1.5 text-xs font-bold text-white shadow-xs cursor-pointer"
                  title="Fit all board items in view"
                >
                  <Maximize2 size={13} className="text-[#B58D3D]" />
                  <span>Fit View</span>
                </button>
                <div className="h-4 w-px bg-[#B58D3D]/40 my-auto mx-0.5" />
                <button 
                  onClick={() => zoomOut()} 
                  className="p-1.5 rounded bg-[#423D38] hover:bg-[#5D554E] transition-colors text-white cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut size={15} />
                </button>
                <button 
                  onClick={() => resetTransform()} 
                  className="px-2 py-1 rounded bg-[#423D38] hover:bg-[#5D554E] transition-colors text-xs font-mono font-bold min-w-[50px] text-center text-[#B58D3D] cursor-pointer"
                  title="Reset to 100% Zoom"
                >
                  {zoomScale}%
                </button>
                <button 
                  onClick={() => zoomIn()} 
                  className="p-1.5 rounded bg-[#423D38] hover:bg-[#5D554E] transition-colors text-white cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn size={15} />
                </button>
              </div>
              <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '4000px', height: '4000px', overflow: 'visible' }}>
                <div ref={boardContainerRef} className="w-[4000px] h-[4000px] relative" onClick={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest('[data-item-root]')) return;
                  setSelectedItemId(null);
                }}>
                  {/* Infinite Grid Background */}
                  <div 
                    className="absolute pointer-events-none" 
                    style={{
                      left: -100000, 
                      top: -100000, 
                      width: 204000, 
                      height: 204000, 
                      background: 'radial-gradient(#D9D0C1 1px, transparent 1px)', 
                      backgroundSize: '32px 32px'
                    }} 
                  />
                  {/* SVG Connection Lines Overlay */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none z-0 overflow-visible">
                    {connections.map(conn => {
                      const geom = getConnectionGeometry(conn);
                      if (!geom) return null;
                      const strokeDash = conn.style === 'dashed' ? '8 8' : conn.style === 'dotted' ? '3 3' : undefined;
                      const isHovered = hoveredConnectionId === conn.id;
                      const isEditing = editingConnectionId === conn.id;
                      const lineWidth = conn.width || 3;

                      return (
                        <g key={conn.id} className="group">
                          {/* Invisible wide hit path for easy hovering & clicking */}
                          <path
                            d={geom.pathD}
                            fill="none"
                            stroke="transparent"
                            strokeWidth={Math.max(16, lineWidth + 10)}
                            style={{ pointerEvents: 'stroke' }}
                            className="cursor-pointer"
                            onMouseEnter={() => setHoveredConnectionId(conn.id)}
                            onMouseLeave={() => setHoveredConnectionId(null)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingConnectionId(conn.id);
                              setEditingConnectionLabel(conn.label);
                            }}
                          />

                          {/* Hover / Selection Gold Ring (ONLY when active/hovered) */}
                          {(isHovered || isEditing) && (
                            <path
                              d={geom.pathD}
                              fill="none"
                              stroke="#B58D3D"
                              strokeWidth={lineWidth + 3}
                              strokeOpacity={0.6}
                              strokeDasharray={strokeDash}
                              strokeLinecap="round"
                            />
                          )}

                          {/* Primary Connection Curve Line */}
                          <path
                            d={geom.pathD}
                            fill="none"
                            stroke={geom.color}
                            strokeWidth={isHovered || isEditing ? lineWidth + 0.5 : lineWidth}
                            strokeDasharray={strokeDash}
                            strokeLinecap="round"
                            style={{ pointerEvents: 'stroke' }}
                            className="transition-all duration-150 cursor-pointer"
                            onMouseEnter={() => setHoveredConnectionId(conn.id)}
                            onMouseLeave={() => setHoveredConnectionId(null)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingConnectionId(conn.id);
                              setEditingConnectionLabel(conn.label);
                            }}
                          />

                          {/* Arrowhead Marker */}
                          <g transform={`translate(${geom.endPt.x}, ${geom.endPt.y}) rotate(${geom.arrowAngle}) scale(${Math.max(0.7, lineWidth / 3)})`}>
                            <polygon
                              points="-10,-5 0,0 -10,5 -7,0"
                              fill={geom.color}
                            />
                          </g>
                        </g>
                      );
                    })}
                  </svg>

                  {/* Connection Labels & Customizer Popovers Overlay */}
                  {connections.map(conn => {
                    const geom = getConnectionGeometry(conn);
                    if (!geom) return null;
                    const isEditingThis = editingConnectionId === conn.id;

                    if (isEditingThis) {
                      return (
                        <div
                          key={`popover-${conn.id}`}
                          style={{
                            position: 'absolute',
                            left: `${geom.midX}px`,
                            top: `${geom.midY}px`,
                            transform: 'translate(-50%, -50%)',
                            zIndex: 60,
                            pointerEvents: 'auto'
                          }}
                          className="bg-[#2C2824] border border-[#B58D3D] rounded-lg shadow-2xl p-3 text-[#E0D8D0] font-sans text-xs w-72 cursor-default"
                          onPointerDownCapture={e => {
                            e.stopPropagation();
                            e.nativeEvent.stopPropagation();
                          }}
                          onClick={e => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#B58D3D]/30">
                            <div className="flex items-center gap-1.5 font-bold font-serif italic text-[#B58D3D]">
                              <Sliders size={13} />
                              <span>Connection Inspector</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setEditingConnectionId(null)}
                              className="text-[#A89F91] hover:text-white p-0.5 rounded cursor-pointer"
                              title="Close inspector"
                            >
                              <X size={14} />
                            </button>
                          </div>

                          {/* Label Text Input */}
                          <div className="mb-3">
                            <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1">
                              Connection Label
                            </label>
                            <input
                              autoFocus
                              type="text"
                              value={editingConnectionLabel}
                              onChange={e => {
                                const newLabel = e.target.value;
                                setEditingConnectionLabel(newLabel);
                                const newConns = connections.map(c => c.id === conn.id ? { ...c, label: newLabel } : c);
                                saveState(items, newConns);
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                                  setEditingConnectionId(null);
                                }
                              }}
                              onKeyDownCapture={e => e.stopPropagation()}
                              onPointerDownCapture={e => {
                                e.stopPropagation();
                                e.nativeEvent.stopPropagation();
                              }}
                              className="w-full bg-[#37332F] border border-[#423D38] focus:border-[#B58D3D] text-white px-2.5 py-1.5 rounded text-xs outline-none font-semibold"
                              placeholder="e.g. Connected, Enemy, Allied..."
                            />
                          </div>

                          {/* Line Style Toggles */}
                          <div className="mb-3">
                            <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1">
                              Line Style
                            </label>
                            <div className="grid grid-cols-3 gap-1.5">
                              {ARROW_LINE_STYLES.map(s => (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => {
                                    const newConns = connections.map(c => c.id === conn.id ? { ...c, style: s.id } : c);
                                    saveState(items, newConns);
                                  }}
                                  className={`flex flex-col items-center justify-center p-1.5 rounded border text-xs font-bold transition-all cursor-pointer ${
                                    conn.style === s.id
                                      ? 'bg-[#B58D3D] text-white border-[#B58D3D] shadow-md'
                                      : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                                  }`}
                                >
                                  <svg width="28" height="10" className="mb-0.5">
                                    <line
                                      x1="2"
                                      y1="5"
                                      x2="26"
                                      y2="5"
                                      stroke={conn.style === s.id ? '#FFFFFF' : (conn.color || '#9ca3af')}
                                      strokeWidth={conn.width || 3}
                                      strokeDasharray={s.dash}
                                    />
                                  </svg>
                                  <span className="text-[10px]">{s.label}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Line Thickness Toggles */}
                          <div className="mb-3">
                            <label className="block text-[10px] font-bold text-[#A89F91] uppercase tracking-wider mb-1">
                              Line Thickness
                            </label>
                            <div className="grid grid-cols-4 gap-1.5">
                              {ARROW_LINE_WIDTHS.map(w => (
                                <button
                                  key={w.id}
                                  type="button"
                                  onClick={() => {
                                    const newConns = connections.map(c => c.id === conn.id ? { ...c, width: w.px } : c);
                                    saveState(items, newConns);
                                  }}
                                  className={`flex flex-col items-center justify-center p-1.5 rounded border text-xs font-bold transition-all cursor-pointer ${
                                    (conn.width || 3) === w.px
                                      ? 'bg-[#B58D3D] text-white border-[#B58D3D] shadow-md'
                                      : 'bg-[#37332F] text-[#E0D8D0] border-[#423D38] hover:bg-[#423D38]'
                                  }`}
                                >
                                  <svg width="24" height="10" className="mb-0.5">
                                    <line
                                      x1="2"
                                      y1="5"
                                      x2="22"
                                      y2="5"
                                      stroke={(conn.width || 3) === w.px ? '#FFFFFF' : (conn.color || '#9ca3af')}
                                      strokeWidth={w.px}
                                      strokeDasharray={conn.style === 'dashed' ? '4 2' : conn.style === 'dotted' ? '2 2' : undefined}
                                    />
                                  </svg>
                                  <span className="text-[10px]">{w.label}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Color Palette & Custom Picker */}
                          <div className="mb-3">
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[10px] font-bold text-[#A89F91] uppercase tracking-wider">
                                Arrow Color
                              </label>
                              <div className="flex items-center gap-1.5 text-xs">
                                <span className="text-[10px] font-mono opacity-80">{conn.color || '#9ca3af'}</span>
                                <div className="w-3.5 h-3.5 rounded border border-white/50 shadow-xs" style={{ backgroundColor: conn.color || '#9ca3af' }} />
                              </div>
                            </div>
                            <div className="grid grid-cols-5 gap-1.5 mb-2">
                              {ARROW_COLOR_PRESETS.map(preset => (
                                <button
                                  key={preset.hex}
                                  type="button"
                                  style={{ backgroundColor: preset.hex }}
                                  onClick={() => {
                                    const newConns = connections.map(c => c.id === conn.id ? { ...c, color: preset.hex } : c);
                                    saveState(items, newConns);
                                  }}
                                  className={`w-6 h-6 rounded border border-black/20 shadow-xs hover:scale-110 transition-transform cursor-pointer ${
                                    (conn.color || '#9ca3af').toLowerCase() === preset.hex.toLowerCase()
                                      ? 'ring-2 ring-white ring-offset-2 ring-offset-[#2C2824]'
                                      : ''
                                  }`}
                                  title={preset.name}
                                />
                              ))}
                            </div>

                            {/* Custom Color Picker input */}
                            <div className="flex items-center justify-between pt-1.5 border-t border-[#B58D3D]/20">
                              <span className="text-[11px] text-[#A89F91] flex items-center gap-1">
                                <Palette size={11} className="text-[#B58D3D]" /> Custom Color Picker
                              </span>
                              <input
                                type="color"
                                value={conn.color || '#9ca3af'}
                                onChange={e => {
                                  const newConns = connections.map(c => c.id === conn.id ? { ...c, color: e.target.value } : c);
                                  saveState(items, newConns);
                                }}
                                className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                                title="Custom color picker"
                              />
                            </div>
                          </div>

                          {/* Quick Actions */}
                          <div className="flex items-center justify-between pt-2 border-t border-[#B58D3D]/30">
                            <button
                              type="button"
                              onClick={() => {
                                const newConns = connections.filter(c => c.id !== conn.id);
                                saveState(items, newConns);
                                setEditingConnectionId(null);
                              }}
                              className="px-2.5 py-1 bg-red-900/40 hover:bg-red-800/80 text-red-200 border border-red-700/50 text-[11px] font-bold rounded flex items-center gap-1 transition-colors cursor-pointer"
                            >
                              <Trash2 size={12} />
                              <span>Delete</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingConnectionId(null)}
                              className="px-3 py-1 bg-[#B58D3D] hover:bg-[#827717] text-white text-[11px] font-bold rounded flex items-center gap-1 transition-colors cursor-pointer"
                            >
                              <Check size={12} />
                              <span>Done</span>
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={`label-${conn.id}`}
                        style={{
                          position: 'absolute',
                          left: `${geom.midX}px`,
                          top: `${geom.midY}px`,
                          transform: 'translate(-50%, -50%)',
                          zIndex: 5,
                          pointerEvents: 'auto'
                        }}
                        className="group"
                      >
                        <div 
                          className="bg-white border border-[#D9D0C1] text-[#423D38] font-bold text-[10px] px-2 py-1 rounded shadow-md cursor-pointer flex items-center gap-1.5 hover:border-[#B58D3D] transition-all hover:scale-105"
                          onPointerDownCapture={e => {
                            e.stopPropagation();
                            e.nativeEvent.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingConnectionId(conn.id);
                            setEditingConnectionLabel(conn.label);
                          }}
                          title="Click to customize connection arrow style & color"
                        >
                          {/* Color Dot Swatch */}
                          <div 
                            className="w-2.5 h-2.5 rounded-full border border-black/20 shadow-xs flex-shrink-0"
                            style={{ backgroundColor: conn.color || '#9ca3af' }}
                          />

                          {/* Line Style Icon preview */}
                          <svg width="14" height="8" className="flex-shrink-0">
                            <line 
                              x1="0" 
                              y1="4" 
                              x2="14" 
                              y2="4" 
                              stroke={conn.color || '#423D38'} 
                              strokeWidth="2" 
                              strokeDasharray={conn.style === 'dashed' ? '3 2' : conn.style === 'dotted' ? '1.5 1.5' : undefined}
                            />
                          </svg>

                          <span>{conn.label || "Connected"}</span>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingConnectionId(conn.id);
                              setEditingConnectionLabel(conn.label);
                            }}
                            className="opacity-40 group-hover:opacity-100 hover:text-[#B58D3D] transition-opacity p-0.5 cursor-pointer ml-0.5"
                            title="Customize arrow"
                          >
                            <Sliders size={11} />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const newConns = connections.filter(c => c.id !== conn.id);
                              saveState(items, newConns);
                            }}
                            className="opacity-0 group-hover:opacity-100 hover:text-red-600 transition-opacity p-0.5 cursor-pointer"
                            title="Delete connection"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* Board Items */}
                  {items.map(item => {
                    if (item.visibility === 'dm' && user.role !== 'dm' && item.ownerId !== user.id) return null;
                    if (item.visibility === 'owner' && item.ownerId !== user.id) return null;

                    return (
                      <BoardItem 
                        key={item.id} 
                        item={item} 
                        user={user}
                        onUpdate={handleUpdateItem}
                        onDelete={handleDeleteItem}
                        onClick={handleItemClick}
                        isSelected={connectionStart === item.id || selectedItemId === item.id}
                        isFocused={focusedItemId === item.id}
                        onDragStart={handleDragStartItem}
                        onDragMove={handleDragMove}
                        onDragEnd={handleDragEndItem}
                        dragOffset={dragOffsets[item.id]}
                        onReportDimensions={handleReportDimensions}
                        allItems={allBoardItems}
                        onScrollToItem={handleScrollToItem}
                        zoomScale={zoomScale / 100}
                        lodThresholds={BOARD_ITEM_LOD_THRESHOLDS}
                        onOpenFocus={handleOpenFocus}
                      />
                    );
                  })}
                </div>
              </TransformComponent>

              {/* Interactive Annotation Overlay
                  Rendered at viewport level (outside the transformed content) so
                  pointer events reach it across the whole canvas, even when the
                  content is panned/zoomed. Coordinates are mapped with viewPan. */}
              <AnnotationCanvas
                user={user}
                annotations={annotations}
                items={items}
                dragOffsets={dragOffsets}
                itemDimensions={itemDimensions}
                activeTool={activeTool}
                setActiveTool={setActiveTool}
                activeColor={activeAnnColor}
                activeStrokeWidth={activeAnnStrokeWidth}
                activeStrokeStyle={activeAnnStrokeStyle}
                activeFillColor={activeAnnFillColor}
                activeFontStyle={activeAnnFontStyle}
                onUpdateAnnotation={handleUpdateAnnotation}
                onAddAnnotation={handleAddAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                zoomScale={zoomScale}
                positionX={viewPan.positionX}
                positionY={viewPan.positionY}
              />
            </>
            );
          }}
        </TransformWrapper>
        </div>{/* end canvas drag-drop wrapper */}


        {/* ── Focus Drawer ── */}
        {focusedItemId && (() => {
          const focusedItem = items.find(i => i.id === focusedItemId) ?? null;
          const typeDef = focusedItem ? ITEM_FIELD_DEFS[focusedItem.type] : null;
          return (
            <FocusDrawer
              item={focusedItem}
              user={user}
              allItems={allBoardItems}
              fieldDefs={typeDef?.defs ?? null}
              typeLabel={typeDef?.label ?? focusedItem?.type ?? ''}
              onUpdate={handleUpdateItem}
              onDelete={handleDeleteItem}
              onClose={handleCloseFocus}
              onScrollToItem={handleScrollToItem}
              memberNames={memberNames}
              width={drawerWidth}
              onWidthChange={setDrawerWidth}
            />
          );
        })()}

        {/* ── Account Settings & Member Management Modals ── */}
        {user && (
          <>
            <UserSettingsModal
              isOpen={showUserSettingsModal}
              onClose={() => setShowUserSettingsModal(false)}
              sessionToken={user.sessionToken}
              username={user.name}
            />
            <MemberManagementModal
              isOpen={showMembersModal}
              onClose={() => setShowMembersModal(false)}
              boardId={boardId}
              sessionToken={user.sessionToken}
              currentUserId={user.id}
              currentUserRole={user.role}
            />
            <KeyboardShortcutsHelp
              isOpen={showShortcutsHelp}
              onClose={() => setShowShortcutsHelp(false)}
            />
          </>
        )}
      </div>
    </div>
  );
}