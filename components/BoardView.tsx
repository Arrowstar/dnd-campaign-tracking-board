'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { User, BoardTab, BoardViewPayload, Connection, AnnotationFontStyle } from '@/lib/types';
import BoardItem, { ITEM_FIELD_DEFS } from './BoardItem';
import FocusDrawer from './FocusDrawer';
import AnnotationCanvas from './AnnotationCanvas';
import { navigateToItem, flashItemElement, getCanvasViewport, POLL_INTERVAL_MS } from '@/lib/viewNavigation';
import { ZoomIn, ZoomOut, Maximize2, LogIn, Loader2, Link2 } from 'lucide-react';

const BOARD_ITEM_LOD_THRESHOLDS = {
  fullWidth: 130,
  fullHeight: 90,
  fullExpandWidth: 145,
  fullExpandHeight: 100,
  pinSize: 45,
  pinExpandSize: 56,
  pinScreenSize: 36,
};

/** Synthetic viewer for anonymous share viewers: a player who owns nothing. */
const VIEWER: User = {
  id: 'shared-viewer',
  name: 'Viewer',
  role: 'player',
  boardId: '',
  sessionToken: '',
};

type ViewStatus =
  | { kind: 'loading' }
  | { kind: 'loaded' }
  | { kind: 'expired' }
  | { kind: 'invalid' };

function getBoxIntersection(cx: number, cy: number, hw: number, hh: number, targetCx: number, targetCy: number) {
  const dx = targetCx - cx;
  const dy = targetCy - cy;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: cx, y: cy };
  const scaleX = hw / Math.abs(dx);
  const scaleY = hh / Math.abs(dy);
  const t = Math.min(scaleX, scaleY);
  return { x: cx + t * dx, y: cy + t * dy };
}

/** Static connection geometry — mirrors Board.tsx (no drag offsets in view). */
function getConnectionGeometry(conn: Connection, items: { id: string; x: number; y: number; width: number; height: number }[]) {
  const fromItem = items.find(i => i.id === conn.fromId);
  const toItem = items.find(i => i.id === conn.toId);
  if (!fromItem || !toItem) return null;

  const wA = fromItem.width || 300;
  const hA = fromItem.height || 200;
  const wB = toItem.width || 300;
  const hB = toItem.height || 200;

  const cxA = fromItem.x + wA / 2;
  const cyA = fromItem.y + hA / 2;
  const cxB = toItem.x + wB / 2;
  const cyB = toItem.y + hB / 2;

  const startPt = getBoxIntersection(cxA, cyA, wA / 2, hA / 2, cxB, cyB);
  const endPt = getBoxIntersection(cxB, cyB, wB / 2, hB / 2, cxA, cyA);

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
    width: conn.width || 3,
  };
}

/**
 * Feature 09 — read-only board renderer for anonymous share links.
 * Reuses BoardItem / AnnotationCanvas / FocusDrawer in read-only mode with
 * no-op handlers; fetches the scrubbed payload via the public share API and
 * polls the revision endpoint (token-authed) for live updates.
 */
export default function BoardView({ boardId, token }: { boardId: string; token: string }) {
  const [payload, setPayload] = useState<BoardViewPayload | null>(null);
  const [status, setStatus] = useState<ViewStatus>({ kind: 'loading' });
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [zoomScale, setZoomScale] = useState(100);
  const [viewPan, setViewPan] = useState({ positionX: 0, positionY: 0 });
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  const transformRef = useRef({ positionX: 0, positionY: 0, scale: 1 });
  const setTransformRef = useRef<((x: number, y: number, scale: number, duration?: number) => void) | null>(null);
  const appliedRevisionRef = useRef<string | null>(null);
  // Per-tab view memory: fit on first view, last position/zoom on revisits.
  const tabViewsRef = useRef<Record<string, { positionX: number; positionY: number; scale: number }>>({});
  const tabViewedRef = useRef<Set<string>>(new Set());

  const tabs = useMemo<BoardTab[]>(() => payload?.tabs ?? [], [payload?.tabs]);
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0] || null;
  const allBoardItems = useMemo(() => tabs.flatMap(t => t.items || []), [tabs]);

  // ── Payload load + initial tab (hash deep-link support: #tab-<tabId>) ──
  const load = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/boards/${boardId}/share/${token}`);
      if (res.status === 403) { setStatus({ kind: 'expired' }); return false; }
      if (res.status === 404) { setStatus({ kind: 'invalid' }); return false; }
      if (!res.ok) return false;
      const data = (await res.json()) as BoardViewPayload;
      setPayload(data);
      const hashMatch = window.location.hash.match(/^#tab-(.+)$/);
      const fromHash = hashMatch ? hashMatch[1] : null;
      setActiveTabId(prev =>
        prev && data.tabs.some(t => t.id === prev)
          ? prev
          : fromHash && data.tabs.some(t => t.id === fromHash)
          ? fromHash
          : data.tabs[0]?.id ?? null
      );
      setStatus({ kind: 'loaded' });
      return true;
    } catch (err) {
      console.error('Failed to load share view:', err);
      return false;
    }
  }, [boardId, token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Keep the hash in sync so deep links survive tab switches.
  useEffect(() => {
    if (!activeTabId || status.kind !== 'loaded') return;
    const target = `#tab-${activeTabId}`;
    if (window.location.hash !== target) {
      window.history.replaceState(null, '', target);
    }
  }, [activeTabId, status.kind]);

  // Apply the initial tab's fit view once the payload + active tab resolve.
  // (Declared after applyTabView below to keep the closure current.)

  // ── Fit computation (mirrors Board's computeFitForTab, no measured dims) ──
  const computeFit = useCallback((tab: BoardTab, vpW: number, vpH: number) => {
    const items = (tab.items || []).filter(i => {
      if (i.visibility === 'dm' && VIEWER.role !== 'dm' && i.ownerId !== VIEWER.id) return false;
      if (i.visibility === 'owner' && i.ownerId !== VIEWER.id) return false;
      return true;
    });
    if (items.length === 0) {
      return { positionX: vpW / 2 - 2000, positionY: vpH / 2 - 2000, scale: 1 };
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const item of items) {
      const w = item.width || 300;
      const h = item.height || 200;
      if (item.x < minX) minX = item.x;
      if (item.x + w > maxX) maxX = item.x + w;
      if (item.y < minY) minY = item.y;
      if (item.y + h > maxY) maxY = item.y + h;
    }
    const pad = 100;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    const boxW = Math.max(300, maxX - minX);
    const boxH = Math.max(300, maxY - minY);
    const scale = Math.max(0.1, Math.min(1.5, Math.min(vpW / boxW, vpH / boxH)));
    return {
      positionX: vpW / 2 - ((minX + maxX) / 2) * scale,
      positionY: vpH / 2 - ((minY + maxY) / 2) * scale,
      scale,
    };
  }, []);

  const applyTabView = useCallback((tabId: string) => {
    if (!setTransformRef.current) return;
    const stored = tabViewsRef.current[tabId];
    if (stored) {
      setTransformRef.current(stored.positionX, stored.positionY, stored.scale, 0);
      return;
    }
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    const vp = getCanvasViewport(1200, 800);
    const fit = computeFit(tab, vp.width, vp.height);
    tabViewsRef.current[tabId] = fit;
    setTransformRef.current(fit.positionX, fit.positionY, fit.scale, 250);
    tabViewedRef.current.add(tabId);
  }, [tabs, computeFit]);

  // Apply the initial tab's fit view once the payload + active tab resolve.
  useEffect(() => {
    if (!activeTabId || status.kind !== 'loaded') return;
    const t = setTimeout(() => applyTabView(activeTabId), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, status.kind]);

  const handleSelectTab = useCallback((tabId: string) => {
    if (tabId === activeTabId || !activeTabId) return;
    if (activeTab) {
      tabViewsRef.current[activeTabId] = {
        positionX: transformRef.current.positionX,
        positionY: transformRef.current.positionY,
        scale: transformRef.current.scale,
      };
    }
    setActiveTabId(tabId);
    setTimeout(() => applyTabView(tabId), 50);
  }, [activeTabId, activeTab, applyTabView]);

  // ── Cross-link / notification navigation (shared with Board via lib) ──
  const handleScrollToItem = useCallback((targetId: string) => {
    const targetTab = tabs.find(t => t.items.some(i => i.id === targetId));
    if (targetTab && targetTab.id !== activeTabId) {
      setActiveTabId(targetTab.id);
    }
    setTimeout(() => {
      const vp = getCanvasViewport(1200, 800);
      const target = navigateToItem({
        tabs,
        activeTabId,
        targetId,
        itemDimensions: {},
        viewportW: vp.width,
        viewportH: vp.height,
        currentScale: transformRef.current.scale || 1,
      });
      if (!target || !setTransformRef.current) return;
      if (target.tabId) setActiveTabId(target.tabId);
      setTransformRef.current(target.x, target.y, target.scale, target.duration);
      flashItemElement(targetId);
    }, 50);
  }, [tabs, activeTabId]);

  // ── Live updates via token-authed revision polling ──
  useEffect(() => {
    if (status.kind !== 'loaded') return;
    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/boards/${boardId}/revision?shareToken=${encodeURIComponent(token)}`);
        if (res.status === 403) {
          setStatus({ kind: 'expired' });
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        const revision = data.updatedAt ?? null;
        if (revision === null || revision === appliedRevisionRef.current) return;
        appliedRevisionRef.current = revision;
        await load();
      } catch (err) {
        console.error('Failed to check share revision:', err);
      } finally {
        inFlight = false;
      }
    };

    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') poll(); };
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      window.removeEventListener('focus', poll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [status.kind, boardId, token, load]);

  const handleFitView = useCallback(() => {
    if (!activeTab || !setTransformRef.current) return;
    const vp = getCanvasViewport(1200, 800);
    const fit = computeFit(activeTab, vp.width, vp.height);
    setTransformRef.current(fit.positionX, fit.positionY, fit.scale, 400);
    if (activeTabId) {
      tabViewsRef.current[activeTabId] = fit;
      tabViewedRef.current.add(activeTabId);
    }
  }, [activeTab, activeTabId, computeFit]);

  const focusedItem = focusedItemId ? allBoardItems.find(i => i.id === focusedItemId) ?? null : null;
  const typeDef = focusedItem ? ITEM_FIELD_DEFS[focusedItem.type] : null;
  const cardFontScale = payload?.settings.cardFontScale ?? 1;

  // ── Error / loading states ──
  if (status.kind === 'loading') {
    return (
      <div className="min-h-screen bg-[#F5F2ED] flex items-center justify-center gap-2 text-[#423D38]">
        <Loader2 size={18} className="animate-spin text-[#B58D3D]" /> Loading…
      </div>
    );
  }

  if (status.kind === 'expired') {
    return (
      <div className="min-h-screen bg-[#F5F2ED] flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(181,141,61,0.12)', border: '1px solid rgba(181,141,61,0.3)' }}>
            <Link2 size={26} className="text-[#B58D3D]" />
          </div>
          <h1 className="text-xl font-serif font-bold italic text-[#2C2824] mb-2">This link is no longer active</h1>
          <p className="text-sm text-[#8C7B6E] leading-relaxed mb-6">
            The share link was revoked or has expired. Ask the Dungeon Master for a fresh link.
          </p>
          <JoinCta boardId={boardId} />
        </div>
      </div>
    );
  }

  if (status.kind === 'invalid') {
    return (
      <div className="min-h-screen bg-[#F5F2ED] flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(181,141,61,0.12)', border: '1px solid rgba(181,141,61,0.3)' }}>
            <Link2 size={26} className="text-[#B58D3D]" />
          </div>
          <h1 className="text-xl font-serif font-bold italic text-[#2C2824] mb-2">This board doesn&apos;t exist or the link is invalid</h1>
          <p className="text-sm text-[#8C7B6E] leading-relaxed mb-6">
            The board may have been deleted, or the link was mistyped. Check the URL with the person who shared it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-[#F5F2ED] overflow-hidden relative font-sans text-[#423D38] flex flex-col">
      {/* Read-only tab strip (name + color dot) */}
      <div
        className="flex items-center gap-0.5 px-3 pt-2 flex-shrink-0 overflow-x-auto"
        style={{ background: 'rgba(44,40,36,0.06)', borderBottom: '1px solid rgba(44,40,36,0.12)' }}
      >
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleSelectTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
              tab.id === activeTabId ? 'bg-[#FDFAF6] text-[#2C2824]' : 'text-[#8C7B6E] hover:text-[#423D38]'
            }`}
            style={tab.id === activeTabId ? { border: '1px solid rgba(44,40,36,0.15)', borderBottom: 'none' } : undefined}
          >
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tab.color || '#3B82F6' }} />
            {tab.name}
          </button>
        ))}
      </div>

      <div className="flex-1 relative flex overflow-hidden">
        <div className="flex-1 h-full relative overflow-hidden">
          <TransformWrapper
            initialScale={1}
            minScale={0.05}
            maxScale={4}
            limitToBounds={false}
            centerOnInit={true}
            smooth={true}
            wheel={{ step: 0.0008 }}
            doubleClick={{ disabled: true }}
            panning={{ velocityDisabled: true, excluded: ['no-pan'] }}
            onTransform={(ref) => {
              transformRef.current = {
                positionX: ref.state.positionX,
                positionY: ref.state.positionY,
                scale: ref.state.scale,
              };
              setZoomScale(Math.round(ref.state.scale * 100));
              setViewPan({ positionX: ref.state.positionX, positionY: ref.state.positionY });
            }}
          >
            {({ zoomIn, zoomOut, setTransform }) => {
              setTransformRef.current = setTransform;
              return (
                <>
                  <div className="absolute bottom-4 right-4 z-50 flex items-center gap-1.5 bg-[#2C2824] p-1.5 rounded-lg border border-[#B58D3D] shadow-2xl text-[#E0D8D0]">
                    <button
                      onClick={handleFitView}
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
                      onClick={() => setTransform(0, 0, 1, 300)}
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

                  <TransformComponent
                    wrapperStyle={{ width: '100%', height: '100%' }}
                    contentStyle={{ width: '4000px', height: '4000px', overflow: 'visible' }}
                  >
                    <div className="w-[4000px] h-[4000px] relative">
                      {/* Infinite dotted grid */}
                      <div
                        className="absolute pointer-events-none"
                        style={{
                          left: -100000,
                          top: -100000,
                          width: 204000,
                          height: 204000,
                          background: 'radial-gradient(#D9D0C1 1px, transparent 1px)',
                          backgroundSize: '32px 32px',
                        }}
                      />
                      {/* Static connection lines */}
                      {activeTab && (
                        <svg className="absolute inset-0 w-full h-full pointer-events-none z-0 overflow-visible">
                          {(activeTab.connections || []).map(conn => {
                            const geom = getConnectionGeometry(conn, activeTab.items || []);
                            if (!geom) return null;
                            const strokeDash = conn.style === 'dashed' ? '8 8' : conn.style === 'dotted' ? '3 3' : undefined;
                            return (
                              <g key={conn.id}>
                                <path
                                  d={geom.pathD}
                                  fill="none"
                                  stroke={geom.color}
                                  strokeWidth={geom.width}
                                  strokeDasharray={strokeDash}
                                  strokeLinecap="round"
                                />
                                <g transform={`translate(${geom.endPt.x}, ${geom.endPt.y}) rotate(${geom.arrowAngle}) scale(${Math.max(0.7, geom.width / 3)})`}>
                                  <polygon points="-10,-5 0,0 -10,5 -7,0" fill={geom.color} />
                                </g>
                              </g>
                            );
                          })}
                        </svg>
                      )}
                      {/* Connection labels (static) */}
                      {activeTab &&
                        (activeTab.connections || []).map(conn => {
                          const geom = getConnectionGeometry(conn, activeTab.items || []);
                          if (!geom) return null;
                          if (!conn.label || conn.label === 'Connected') return null;
                          return (
                            <div
                              key={`label-${conn.id}`}
                              className="absolute z-10 pointer-events-none select-none bg-[#F5F2ED]/90 border border-[#D9D0C1] rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#423D38]"
                              style={{
                                left: geom.midX,
                                top: geom.midY,
                                transform: 'translate(-50%, -50%)',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                              }}
                            >
                              {conn.label}
                            </div>
                          );
                        })}

                      {/* Read-only board items */}
                      {(activeTab?.items || []).map(item => (
                        <BoardItem
                          key={item.id}
                          item={item}
                          user={VIEWER}
                          onUpdate={() => {}}
                          onDelete={() => {}}
                          onClick={(id) => setFocusedItemId(id)}
                          isSelected={false}
                          isFocused={focusedItemId === item.id}
                          allItems={allBoardItems}
                          onScrollToItem={handleScrollToItem}
                          zoomScale={zoomScale / 100}
                          lodThresholds={BOARD_ITEM_LOD_THRESHOLDS}
                          fontScale={cardFontScale}
                          onOpenFocus={(id) => setFocusedItemId(id)}
                          readOnly
                        />
                      ))}
                    </div>
                  </TransformComponent>

                  {/* View-only annotation layer */}
                  {activeTab && (
                    <AnnotationCanvas
                      user={VIEWER}
                      annotations={activeTab.annotations || []}
                      items={activeTab.items || []}
                      dragOffsets={{}}
                      itemDimensions={{}}
                      activeTool={null}
                      activeColor="#EF4444"
                      activeStrokeWidth={3}
                      activeStrokeStyle="solid"
                      activeFillColor="transparent"
                      activeFontStyle={{ fontFamily: 'sans-serif', fontSize: 18, color: '#1F2937' } as AnnotationFontStyle}
                      onUpdateAnnotation={() => {}}
                      onAddAnnotation={() => {}}
                      onDeleteAnnotation={() => {}}
                      selectedAnnId={null}
                      onSelectAnnotation={() => {}}
                      zoomScale={zoomScale}
                      positionX={viewPan.positionX}
                      positionY={viewPan.positionY}
                      readOnly
                    />
                  )}
                </>
              );
            }}
          </TransformWrapper>

          {/* Request-to-join CTA (Feature 09): upgrades anonymous viewers */}
          <div className="absolute bottom-4 left-4 z-50">
            <JoinCta boardId={boardId} compact />
          </div>
        </div>
      </div>

      {/* Read-only focus drawer */}
      {focusedItem && (
        <FocusDrawer
          item={focusedItem}
          user={VIEWER}
          allItems={allBoardItems}
          fieldDefs={typeDef?.defs ?? null}
          typeLabel={typeDef?.label ?? focusedItem.type}
          onUpdate={() => {}}
          onDelete={() => {}}
          onClose={() => setFocusedItemId(null)}
          onScrollToItem={handleScrollToItem}
          width={480}
          onWidthChange={() => {}}
          readOnly
        />
      )}
    </div>
  );
}

/** Gentle upgrade path: prefill the lobby join flow with this board id. */
function JoinCta({ boardId, compact = false }: { boardId: string; compact?: boolean }) {
  if (compact) {
    return (
      <a
        href={`/?join=${encodeURIComponent(boardId)}`}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer bg-[#2C2824] border border-[#B58D3D] shadow-2xl text-[#E0D8D0] hover:bg-[#423D38]"
      >
        <LogIn size={13} className="text-[#B58D3D]" />
        Request to join
      </a>
    );
  }
  return (
    <a
      href={`/?join=${encodeURIComponent(boardId)}`}
      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer"
      style={{ background: 'linear-gradient(135deg, #B58D3D, #96722E)', color: '#1C1814', boxShadow: '0 4px 16px rgba(181,141,61,0.25)' }}
    >
      <LogIn size={15} />
      Want to edit? Join this board
    </a>
  );
}
