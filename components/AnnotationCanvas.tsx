'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { BoardAnnotation, BoardItem, AnnotationType, AnnotationFontStyle, User } from '@/lib/types';
import { 
  getResolvedControlPoints, 
  findPinTargetItem, 
  getMaxPinsForType 
} from '@/lib/annotationUtils';
import AnnotationInspector from './AnnotationInspector';
import AnnotationQuickBar from './AnnotationQuickBar';
import { Pin, Type, Move, RotateCcw, X } from 'lucide-react';

interface AnnotationCanvasProps {
  user: User | null;
  annotations: BoardAnnotation[];
  items: BoardItem[];
  dragOffsets: Record<string, { x: number; y: number }>;
  itemDimensions: Record<string, { width: number; height: number }>;
  activeTool: string | null;
  setActiveTool?: (tool: string | null) => void;
  activeColor: string;
  activeStrokeWidth: number;
  activeStrokeStyle: 'solid' | 'dashed' | 'dotted';
  activeFillColor: string;
  activeFontStyle: AnnotationFontStyle;
  onUpdateAnnotation: (updated: BoardAnnotation) => void;
  onAddAnnotation: (newAnn: BoardAnnotation) => void;
  onDeleteAnnotation: (id: string) => void;
  /** Currently selected annotation (owned by Board so keyboard shortcuts can act on it) */
  selectedAnnId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  zoomScale: number;
  positionX: number;
  positionY: number;
}

export default function AnnotationCanvas({
  user,
  annotations,
  items,
  dragOffsets,
  itemDimensions,
  activeTool,
  setActiveTool,
  activeColor,
  activeStrokeWidth,
  activeStrokeStyle,
  activeFillColor,
  activeFontStyle,
  onUpdateAnnotation,
  onAddAnnotation,
  onDeleteAnnotation,
  selectedAnnId,
  onSelectAnnotation,
  zoomScale,
  positionX,
  positionY,
}: AnnotationCanvasProps) {
  const [showFullInspector, setShowFullInspector] = useState<boolean>(false);
  const [editingTextAnnId, setEditingTextAnnId] = useState<string | null>(null);

  // Drawing state
  const [drawingStart, setDrawingStart] = useState<{ x: number; y: number } | null>(null);
  const [drawingCurrent, setDrawingCurrent] = useState<{ x: number; y: number } | null>(null);

  // Control handle dragging state
  const [draggingHandle, setDraggingHandle] = useState<{
    annId: string;
    handleIndex: number; // 0 or 1
  } | null>(null);

  // Active target board item highlight during pin drag
  const [activePinHover, setActivePinHover] = useState<{
    item: BoardItem;
    offsetX: number;
    offsetY: number;
    pinIndex: number;
  } | null>(null);

  // Moving entire annotation state
  const [movingAnn, setMovingAnn] = useState<{
    annId: string;
    startPointX: number;
    startPointY: number;
    initialX: number;
    initialY: number;
    initialX2?: number;
    initialY2?: number;
  } | null>(null);

  const canEdit = useCallback((annId: string) => {
    if (!user) return false;
    if (user.role === 'dm') return true;
    const ann = annotations.find(a => a.id === annId);
    if (!ann) return false;
    return !ann.ownerId || ann.ownerId === user.id;
  }, [user, annotations]);

  const selectedAnn = annotations.find((a) => a.id === selectedAnnId);

  // Callback to unpin a specific pin point
  const handleUnpinPoint = useCallback((ann: BoardAnnotation, pinIndex: number) => {
    const geom = getResolvedControlPoints(ann, items, dragOffsets, itemDimensions);
    const newPins = [...(ann.pins || [])];
    newPins[pinIndex] = null;
    const hasRemainingPins = newPins.some(Boolean);

    onUpdateAnnotation({
      ...ann,
      x: geom.x1 ?? geom.x ?? ann.x,
      y: geom.y1 ?? geom.y ?? ann.y,
      x2: geom.x2 ?? ann.x2,
      y2: geom.y2 ?? ann.y2,
      width: geom.width ?? ann.width,
      height: geom.height ?? ann.height,
      pins: hasRemainingPins ? newPins : undefined,
    });
  }, [items, dragOffsets, itemDimensions, onUpdateAnnotation]);

  // Callback to initiate dragging a pin handle (e.g. from Inspector)
  const handleStartDragPinHandle = useCallback((annId: string, handleIndex: number, e: React.PointerEvent) => {
    onSelectAnnotation(annId);
    setDraggingHandle({ annId, handleIndex });
  }, [onSelectAnnotation]);

  // Global pointer listeners while dragging a pin handle or moving an annotation
  useEffect(() => {
    if (!draggingHandle && !movingAnn) return;

    const handleWindowPointerMove = (e: PointerEvent) => {
      const svgEl = document.querySelector('svg[data-annotation-layer]') as SVGElement;
      if (!svgEl) return;
      const rect = svgEl.getBoundingClientRect();
      const scaleFactor = zoomScale > 0 ? zoomScale / 100 : 1;
      const coords = {
        x: (e.clientX - rect.left - positionX) / scaleFactor,
        y: (e.clientY - rect.top - positionY) / scaleFactor,
      };

      if (draggingHandle) {
        const pinTarget = findPinTargetItem(coords.x, coords.y, items, dragOffsets, itemDimensions);
        if (pinTarget) {
          setActivePinHover({
            item: pinTarget.item,
            offsetX: pinTarget.offsetX,
            offsetY: pinTarget.offsetY,
            pinIndex: draggingHandle.handleIndex,
          });
        } else {
          setActivePinHover(null);
        }
      }
    };

    const handleWindowPointerUp = () => {
      setMovingAnn(null);
      setDraggingHandle(null);
      setActivePinHover(null);
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
    };
  }, [draggingHandle, movingAnn, items, dragOffsets, itemDimensions, zoomScale, positionX, positionY]);

  // ── Helper to convert Mouse Event -> Board Canvas Coords (4000x4000) ──────────
  const getCanvasCoords = useCallback((e: React.PointerEvent<SVGElement | HTMLDivElement>) => {
    const svgEl = e.currentTarget.closest('svg') || (e.currentTarget as HTMLElement);
    const rect = svgEl.getBoundingClientRect();

    // Accounts for CSS transform zoom/pan inside TransformWrapper (zoomScale is
    // percentage like 100; positionX/positionY are the viewport-space pan offset)
    const scaleFactor = zoomScale > 0 ? zoomScale / 100 : 1;
    const x = (e.clientX - rect.left - positionX) / scaleFactor;
    const y = (e.clientY - rect.top - positionY) / scaleFactor;

    return { x, y };
  }, [zoomScale, positionX, positionY]);

  // ── Canvas Pointer Down (Drawing or Selecting) ──────────────────────────────
  const handlePointerDownCanvas = (e: React.PointerEvent<SVGElement>) => {
    // Only trigger drawing if an annotation tool is active
    if (!activeTool || !activeTool.startsWith('ann_')) {
      if (selectedAnnId) onSelectAnnotation(null);
      return;
    }

    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    const coords = getCanvasCoords(e);
    setDrawingStart(coords);
    setDrawingCurrent(coords);
  };

  // ── Canvas Pointer Move (Drawing or Dragging Handle/Whole Annotation) ─────
  const handlePointerMoveCanvas = (e: React.PointerEvent<SVGElement>) => {
    const coords = getCanvasCoords(e);

    // 1. Drawing new annotation
    if (drawingStart) {
      setDrawingCurrent(coords);
      return;
    }

    // 2. Dragging control handle
    if (draggingHandle) {
      const targetAnn = annotations.find((a) => a.id === draggingHandle.annId);
      if (!targetAnn) return;

      const pinTarget = findPinTargetItem(coords.x, coords.y, items, dragOffsets, itemDimensions);
      const newPins = [...(targetAnn.pins || [])];

      if (targetAnn.type === 'text') {
        if (draggingHandle.handleIndex === 0) {
          // Center Pin Handle
          if (pinTarget) {
            newPins[0] = {
              itemId: pinTarget.item.id,
              offsetX: pinTarget.offsetX,
              offsetY: pinTarget.offsetY,
            };
          } else {
            newPins[0] = null;
          }

          onUpdateAnnotation({
            ...targetAnn,
            x: coords.x,
            y: coords.y,
            pins: newPins,
          });
        } else {
          // Corner Resize Handles (1: SE, 2: NW, 3: NE, 4: SW)
          const resolved = getResolvedControlPoints(targetAnn, items, dragOffsets, itemDimensions);
          const boxX = resolved.x ?? targetAnn.x ?? 0;
          const boxY = resolved.y ?? targetAnn.y ?? 0;
          const curW = resolved.width || 160;
          const curH = resolved.height || 50;
          const boxRight = boxX + curW;
          const boxBottom = boxY + curH;

          let newBoxX = boxX;
          let newBoxY = boxY;
          let newWidth = curW;
          let newHeight = curH;

          if (draggingHandle.handleIndex === 1) {
            // Bottom-Right
            newWidth = Math.max(80, coords.x - boxX);
            newHeight = Math.max(36, coords.y - boxY);
          } else if (draggingHandle.handleIndex === 2) {
            // Top-Left
            newWidth = Math.max(80, boxRight - coords.x);
            newHeight = Math.max(36, boxBottom - coords.y);
            newBoxX = boxRight - newWidth;
            newBoxY = boxBottom - newHeight;
          } else if (draggingHandle.handleIndex === 3) {
            // Top-Right
            newWidth = Math.max(80, coords.x - boxX);
            newHeight = Math.max(36, boxBottom - coords.y);
            newBoxY = boxBottom - newHeight;
          } else if (draggingHandle.handleIndex === 4) {
            // Bottom-Left
            newWidth = Math.max(80, boxRight - coords.x);
            newHeight = Math.max(36, coords.y - boxY);
            newBoxX = boxRight - newWidth;
          }

          const newCenterX = newBoxX + newWidth / 2;
          const newCenterY = newBoxY + newHeight / 2;

          if (newPins[0]) {
            const item = items.find((i) => i.id === newPins[0]?.itemId);
            if (item) {
              const drag = dragOffsets[item.id] || { x: 0, y: 0 };
              newPins[0] = {
                itemId: item.id,
                offsetX: newCenterX - (item.x + drag.x),
                offsetY: newCenterY - (item.y + drag.y),
              };
            }
          }

          onUpdateAnnotation({
            ...targetAnn,
            x: newCenterX,
            y: newCenterY,
            width: newWidth,
            height: newHeight,
            pins: newPins,
          });
        }
        return;
      }

      if (draggingHandle.handleIndex === 0) {
        if (pinTarget) {
          newPins[0] = {
            itemId: pinTarget.item.id,
            offsetX: pinTarget.offsetX,
            offsetY: pinTarget.offsetY,
          };
        } else {
          newPins[0] = null;
        }

        onUpdateAnnotation({
          ...targetAnn,
          x: coords.x,
          y: coords.y,
          pins: newPins,
        });
      } else if (draggingHandle.handleIndex === 1) {
        if (pinTarget) {
          newPins[1] = {
            itemId: pinTarget.item.id,
            offsetX: pinTarget.offsetX,
            offsetY: pinTarget.offsetY,
          };
        } else {
          newPins[1] = null;
        }

        if (targetAnn.type === 'rectangle' || targetAnn.type === 'circle') {
          onUpdateAnnotation({
            ...targetAnn,
            width: Math.max(20, coords.x - targetAnn.x),
            height: Math.max(20, coords.y - targetAnn.y),
            x2: coords.x,
            y2: coords.y,
            pins: newPins,
          });
        } else {
          onUpdateAnnotation({
            ...targetAnn,
            x2: coords.x,
            y2: coords.y,
            pins: newPins,
          });
        }
      }
      return;
    }

    // 3. Moving whole annotation
    if (movingAnn) {
      const targetAnn = annotations.find((a) => a.id === movingAnn.annId);
      if (!targetAnn) return;

      const dx = coords.x - movingAnn.startPointX;
      const dy = coords.y - movingAnn.startPointY;

      // If moved, unpin pins or shift offset if pinned
      onUpdateAnnotation({
        ...targetAnn,
        x: movingAnn.initialX + dx,
        y: movingAnn.initialY + dy,
        x2: movingAnn.initialX2 !== undefined ? movingAnn.initialX2 + dx : undefined,
        y2: movingAnn.initialY2 !== undefined ? movingAnn.initialY2 + dy : undefined,
        pins: undefined, // reset pins when manually translated
      });
    }
  };

  // ── Canvas Pointer Up (Finish Drawing or Dragging) ─────────────────────────
  const handlePointerUpCanvas = (e: React.PointerEvent<SVGElement>) => {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }

    if (drawingStart && drawingCurrent && activeTool && activeTool.startsWith('ann_')) {
      const type = activeTool.replace('ann_', '') as AnnotationType;

      const dx = drawingCurrent.x - drawingStart.x;
      const dy = drawingCurrent.y - drawingStart.y;
      const dist = Math.hypot(dx, dy);

      let startX = drawingStart.x;
      let startY = drawingStart.y;
      let endX = drawingCurrent.x;
      let endY = drawingCurrent.y;
      let width = Math.max(30, Math.abs(dx));
      let height = Math.max(30, Math.abs(dy));

      // If dist < 8, user single clicked. Create default sized shape.
      if (dist < 8) {
        if (type === 'line' || type === 'arrow' || type === 'double_arrow') {
          endX = startX + 120;
          endY = startY;
        } else if (type === 'rectangle') {
          width = 120;
          height = 80;
          endX = startX + width;
          endY = startY + height;
        } else if (type === 'circle') {
          width = 100;
          height = 100;
          endX = startX + width;
          endY = startY + height;
        } else if (type === 'text') {
          width = 160;
          height = 50;
          endX = startX + width;
          endY = startY + height;
        }
      } else {
        // Dragged to draw
        if (type === 'rectangle' || type === 'circle' || type === 'text') {
          startX = Math.min(drawingStart.x, drawingCurrent.x);
          startY = Math.min(drawingStart.y, drawingCurrent.y);
          endX = Math.max(drawingStart.x, drawingCurrent.x);
          endY = Math.max(drawingStart.y, drawingCurrent.y);
        }
      }

      let annX = startX;
      let annY = startY;

      if (type === 'text') {
        const minX = dist < 8 ? startX : Math.min(drawingStart.x, drawingCurrent.x);
        const minY = dist < 8 ? startY : Math.min(drawingStart.y, drawingCurrent.y);
        const w = dist < 8 ? 160 : Math.max(80, Math.abs(dx));
        const h = dist < 8 ? 50 : Math.max(36, Math.abs(dy));
        annX = minX + w / 2;
        annY = minY + h / 2;
        width = w;
        height = h;
      }

      const pin0 = findPinTargetItem(type === 'text' ? annX : startX, type === 'text' ? annY : startY, items, dragOffsets, itemDimensions);
      const pin1 = type === 'text' ? null : findPinTargetItem(endX, endY, items, dragOffsets, itemDimensions);

      const pins = [
        pin0 ? { itemId: pin0.item.id, offsetX: pin0.offsetX, offsetY: pin0.offsetY } : null,
        pin1 ? { itemId: pin1.item.id, offsetX: pin1.offsetX, offsetY: pin1.offsetY } : null,
      ];

      const newAnn: BoardAnnotation = {
        id: `ann-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        type,
        x: annX,
        y: annY,
        x2: endX,
        y2: endY,
        width,
        height,
        strokeColor: activeColor,
        strokeWidth: activeStrokeWidth,
        strokeStyle: activeStrokeStyle,
        fillColor: activeFillColor,
        text: type === 'text' ? 'Double click or use inspector to edit text' : undefined,
        fontStyle: activeFontStyle,
        pins: pins.filter(Boolean).length > 0 ? pins : undefined,
      };

      onAddAnnotation(newAnn);
      onSelectAnnotation(newAnn.id);
      if (setActiveTool) setActiveTool(null);

      setDrawingStart(null);
      setDrawingCurrent(null);
      return;
    }

    setDrawingStart(null);
    setDrawingCurrent(null);
    setDraggingHandle(null);
    setMovingAnn(null);
    setActivePinHover(null);
  };

  return (
    <>
      <svg
        data-annotation-layer
        className={`absolute inset-0 w-full h-full z-10 overflow-visible select-none ${
          (activeTool && activeTool.startsWith('ann_')) || draggingHandle || movingAnn ? 'no-pan' : ''
        }`}
        style={{
          pointerEvents: activeTool && activeTool.startsWith('ann_') ? 'auto' : 'none',
          cursor: activeTool && activeTool.startsWith('ann_') ? 'crosshair' : 'default',
        }}
        onPointerDown={handlePointerDownCanvas}
        onPointerMove={handlePointerMoveCanvas}
        onPointerUp={handlePointerUpCanvas}
      >
        {/* Content is rendered in board canvas coordinates; the group applies the
            same pan/zoom transform as the board content below it. */}
        <g transform={`translate(${positionX}, ${positionY}) scale(${zoomScale / 100})`}>
        {/* Render Saved Annotations */}
        {annotations.map((ann) => {
          const geom = getResolvedControlPoints(ann, items, dragOffsets, itemDimensions);
          const isSelected = selectedAnnId === ann.id;
          const strokeDash =
            ann.strokeStyle === 'dashed' ? '8 6' : ann.strokeStyle === 'dotted' ? '3 3' : undefined;
          const sw = ann.strokeWidth !== undefined ? ann.strokeWidth : (ann.type === 'text' ? 1.5 : 3);
          const sc = ann.strokeColor || '#EF4444';
          const fc = ann.fillColor || 'transparent';

          return (
            <g key={ann.id} className="group no-pan">
              {/* Invisible wide hit target for easy clicking */}
              {(ann.type === 'line' || ann.type === 'arrow' || ann.type === 'double_arrow') && (
                <line
                  x1={geom.x1 ?? 0}
                  y1={geom.y1 ?? 0}
                  x2={geom.x2 ?? geom.x1 ?? 0}
                  y2={geom.y2 ?? geom.y1 ?? 0}
                  stroke="transparent"
                  strokeWidth={Math.max(20, sw + 12)}
                  style={{ pointerEvents: 'stroke' }}
                  className="cursor-pointer no-pan"
                  onPointerDown={(e) => {
                    if (!canEdit(ann.id)) return;
                    e.stopPropagation();
                    if (e.nativeEvent) {
                      e.nativeEvent.stopPropagation();
                      e.nativeEvent.stopImmediatePropagation();
                    }
                    onSelectAnnotation(ann.id);
                    const coords = getCanvasCoords(e);
                    setMovingAnn({
                      annId: ann.id,
                      startPointX: coords.x,
                      startPointY: coords.y,
                      initialX: ann.x,
                      initialY: ann.y,
                      initialX2: ann.x2,
                      initialY2: ann.y2,
                    });
                  }}
                  onPointerUp={(e) => {
                    if (!canEdit(ann.id)) return;
                    e.stopPropagation();
                    setMovingAnn(null);
                  }}
                  onClick={(e) => {
                    if (!canEdit(ann.id)) return;
                    e.stopPropagation();
                    onSelectAnnotation(ann.id);
                  }}
                />
              )}

              {/* LINES / ARROWS */}
              {(ann.type === 'line' || ann.type === 'arrow' || ann.type === 'double_arrow') && (() => {
                const x1 = geom.x1 ?? 0;
                const y1 = geom.y1 ?? 0;
                const x2 = geom.x2 ?? x1;
                const y2 = geom.y2 ?? y1;
                const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
                const scale = Math.max(0.7, sw / 3);

                return (
                  <g className="no-pan">
                    {isSelected && (
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke="#B58D3D"
                        strokeWidth={sw + 4}
                        strokeOpacity={0.6}
                        className="no-pan"
                      />
                    )}
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={sc}
                      strokeWidth={sw}
                      strokeDasharray={strokeDash}
                      strokeLinecap="round"
                      style={{ pointerEvents: 'stroke' }}
                      className="cursor-pointer no-pan"
                      onPointerDown={(e) => {
                        if (!canEdit(ann.id)) return;
                        e.stopPropagation();
                        if (e.nativeEvent) {
                          e.nativeEvent.stopPropagation();
                          e.nativeEvent.stopImmediatePropagation();
                        }
                        onSelectAnnotation(ann.id);
                        const coords = getCanvasCoords(e);
                        setMovingAnn({
                          annId: ann.id,
                          startPointX: coords.x,
                          startPointY: coords.y,
                          initialX: geom.x1 ?? geom.x ?? ann.x,
                          initialY: geom.y1 ?? geom.y ?? ann.y,
                          initialX2: geom.x2 ?? ann.x2,
                          initialY2: geom.y2 ?? ann.y2,
                        });
                      }}
                      onPointerUp={(e) => {
                        if (!canEdit(ann.id)) return;
                        e.stopPropagation();
                        setMovingAnn(null);
                      }}
                      onClick={(e) => {
                        if (!canEdit(ann.id)) return;
                        e.stopPropagation();
                        onSelectAnnotation(ann.id);
                      }}
                    />

                    {/* Arrowhead at End (Pin 1) */}
                    {(ann.type === 'arrow' || ann.type === 'double_arrow') && (
                      <g transform={`translate(${x2}, ${y2}) rotate(${angle}) scale(${scale})`} className="no-pan">
                        <polygon points="-12,-6 0,0 -12,6 -8,0" fill={sc} />
                      </g>
                    )}

                    {/* Arrowhead at Start (Pin 0 for Double Arrow) */}
                    {ann.type === 'double_arrow' && (
                      <g transform={`translate(${x1}, ${y1}) rotate(${angle + 180}) scale(${scale})`} className="no-pan">
                        <polygon points="-12,-6 0,0 -12,6 -8,0" fill={sc} />
                      </g>
                    )}
                  </g>
                );
              })()}

              {/* RECTANGLE */}
              {ann.type === 'rectangle' && (() => {
                const rx = geom.x ?? 0;
                const ry = geom.y ?? 0;
                const rw = geom.width ?? 100;
                const rh = geom.height ?? 100;

                return (
                  <g className="no-pan">
                    {isSelected && (
                      <rect
                        x={rx - 2}
                        y={ry - 2}
                        width={rw + 4}
                        height={rh + 4}
                        fill="none"
                        stroke="#B58D3D"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        className="no-pan"
                      />
                    )}
                    <rect
                      x={rx}
                      y={ry}
                      width={rw}
                      height={rh}
                      fill={fc}
                      stroke={sc}
                      strokeWidth={sw}
                      strokeDasharray={strokeDash}
                      rx={6}
                      style={{ pointerEvents: 'all' }}
                      className="cursor-pointer no-pan"
                      onPointerDown={(e) => {
                        if (!canEdit(ann.id)) return;
                        e.stopPropagation();
                        if (e.nativeEvent) {
                          e.nativeEvent.stopPropagation();
                          e.nativeEvent.stopImmediatePropagation();
                        }
                        onSelectAnnotation(ann.id);
                        const coords = getCanvasCoords(e);
                        setMovingAnn({
                          annId: ann.id,
                          startPointX: coords.x,
                          startPointY: coords.y,
                          initialX: geom.x1 ?? geom.x ?? ann.x,
                          initialY: geom.y1 ?? geom.y ?? ann.y,
                          initialX2: geom.x2 ?? ann.x2,
                          initialY2: geom.y2 ?? ann.y2,
                        });
                      }}
                      onPointerUp={(e) => {
                        if (!canEdit(ann.id)) return;
                        e.stopPropagation();
                        setMovingAnn(null);
                      }}
                      onClick={(e) => {
                        if (!canEdit(ann.id)) return;
                        e.stopPropagation();
                        onSelectAnnotation(ann.id);
                      }}
                    />
                  </g>
                );
              })()}

              {/* CIRCLE / ELLIPSE */}
              {ann.type === 'circle' && (() => {
                const cx = geom.cx ?? 0;
                const cy = geom.cy ?? 0;
                const crx = geom.rx ?? 50;
                const cry = geom.ry ?? 50;

                return (
                  <g className="no-pan">
                    {isSelected && (
                      <ellipse
                        cx={cx}
                        cy={cy}
                        rx={crx + 2}
                        ry={cry + 2}
                        fill="none"
                        stroke="#B58D3D"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        className="no-pan"
                      />
                    )}
                    <ellipse
                      cx={cx}
                      cy={cy}
                      rx={crx}
                      ry={cry}
                      fill={fc}
                      stroke={sc}
                      strokeWidth={sw}
                      strokeDasharray={strokeDash}
                      style={{ pointerEvents: 'all' }}
                      className="cursor-pointer no-pan"
                      onPointerDown={(e) => {
                        if (!canEdit(ann.id)) return;
                        e.stopPropagation();
                        if (e.nativeEvent) {
                          e.nativeEvent.stopPropagation();
                          e.nativeEvent.stopImmediatePropagation();
                        }
                        onSelectAnnotation(ann.id);
                        const coords = getCanvasCoords(e);
                        setMovingAnn({
                          annId: ann.id,
                          startPointX: coords.x,
                          startPointY: coords.y,
                          initialX: geom.x1 ?? geom.x ?? ann.x,
                          initialY: geom.y1 ?? geom.y ?? ann.y,
                          initialX2: geom.x2 ?? ann.x2,
                          initialY2: geom.y2 ?? ann.y2,
                        });
                      }}
                      onPointerUp={(e) => {
                        if (!canEdit(ann.id)) return;
                        e.stopPropagation();
                        setMovingAnn(null);
                      }}
                      onClick={(e) => {
                        if (!canEdit(ann.id)) return;
                        e.stopPropagation();
                        onSelectAnnotation(ann.id);
                      }}
                    />
                  </g>
                );
              })()}

              {/* TEXT ANNOTATION */}
              {ann.type === 'text' && (() => {
                const tx = geom.x ?? 0;
                const ty = geom.y ?? 0;
                const tw = geom.width ?? 160;
                const th = geom.height ?? 50;

                return (
                  <foreignObject
                    x={tx}
                    y={ty}
                    width={tw}
                    height={th}
                    style={{ pointerEvents: 'all' }}
                    className="overflow-visible cursor-pointer no-pan"
                    onPointerDown={(e) => {
                      if (!canEdit(ann.id)) return;
                      if (editingTextAnnId === ann.id) return;
                      e.stopPropagation();
                      if (e.nativeEvent) {
                        e.nativeEvent.stopPropagation();
                        e.nativeEvent.stopImmediatePropagation();
                      }
                      onSelectAnnotation(ann.id);
                      const coords = getCanvasCoords(e);
                      setMovingAnn({
                        annId: ann.id,
                        startPointX: coords.x,
                        startPointY: coords.y,
                        initialX: geom.x1 ?? geom.x ?? ann.x,
                        initialY: geom.y1 ?? geom.y ?? ann.y,
                        initialX2: geom.x2 ?? ann.x2,
                        initialY2: geom.y2 ?? ann.y2,
                      });
                    }}
                    onPointerUp={(e) => {
                      if (!canEdit(ann.id)) return;
                      e.stopPropagation();
                      setMovingAnn(null);
                    }}
                    onClick={(e) => {
                      if (!canEdit(ann.id)) return;
                      e.stopPropagation();
                      onSelectAnnotation(ann.id);
                    }}
                    onDoubleClick={(e) => {
                      if (!canEdit(ann.id)) return;
                      e.stopPropagation();
                      setEditingTextAnnId(ann.id);
                    }}
                  >
                    <div
                      style={{
                        fontFamily: ann.fontStyle?.fontFamily || 'sans-serif',
                        fontSize: `${ann.fontStyle?.fontSize || 18}px`,
                        color: ann.fontStyle?.color || '#1F2937',
                        fontWeight: ann.fontStyle?.bold ? 'bold' : 'normal',
                        fontStyle: ann.fontStyle?.italic ? 'italic' : 'normal',
                        textDecoration: ann.fontStyle?.underline ? 'underline' : 'none',
                        textAlign: ann.fontStyle?.align || 'left',
                        backgroundColor: fc,
                        borderColor: isSelected ? '#B58D3D' : (sw === 0 ? 'transparent' : sc),
                        borderWidth: isSelected ? '2px' : `${sw}px`,
                        borderStyle: isSelected ? 'dashed' : (sw === 0 ? 'none' : 'solid'),
                        justifyContent:
                          (ann.fontStyle?.align || 'left') === 'center'
                            ? 'center'
                            : (ann.fontStyle?.align || 'left') === 'right'
                            ? 'flex-end'
                            : 'flex-start',
                      }}
                      className={`p-2 rounded-lg leading-snug w-full h-full min-w-[120px] min-h-[40px] flex items-center no-pan ${sw > 0 || fc !== 'transparent' ? 'shadow-xs' : ''}`}
                    >
                      {editingTextAnnId === ann.id ? (
                        <textarea
                          autoFocus
                          value={ann.text || ''}
                          onChange={(e) => onUpdateAnnotation({ ...ann, text: e.target.value })}
                          onBlur={() => setEditingTextAnnId(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              setEditingTextAnnId(null);
                            }
                          }}
                          style={{
                            textAlign: ann.fontStyle?.align || 'left',
                          }}
                          className="w-full h-full bg-transparent outline-none resize-none no-pan"
                        />
                      ) : (
                        <span
                          style={{
                            textAlign: ann.fontStyle?.align || 'left',
                          }}
                          className="w-full block whitespace-pre-wrap break-words"
                        >
                          {ann.text || 'Double click to edit text'}
                        </span>
                      )}
                    </div>
                  </foreignObject>
                );
              })()}

              {/* CONTROL HANDLES & PIN BADGES FOR SELECTED ANNOTATION */}
              {isSelected && (
                <g style={{ pointerEvents: 'all' }} className="no-pan">
                  {/* Point 0 Control Handle */}
                  {geom.pin0 && (
                    <g className="no-pan">
                      {/* Invisible wider hit target */}
                      <circle
                        cx={geom.pin0.x}
                        cy={geom.pin0.y}
                        r={20}
                        fill="transparent"
                        className="no-pan cursor-grab active:cursor-grabbing"
                        onPointerDown={(e) => {
                          if (!canEdit(ann.id)) return;
                          e.stopPropagation();
                          if (e.nativeEvent) {
                            e.nativeEvent.stopPropagation();
                            e.nativeEvent.stopImmediatePropagation();
                          }
                          try {
                            (e.currentTarget as Element).setPointerCapture(e.pointerId);
                          } catch {}
                          setDraggingHandle({ annId: ann.id, handleIndex: 0 });
                        }}
                      />
                      <circle
                        cx={geom.pin0.x}
                        cy={geom.pin0.y}
                        r={8}
                        fill="#B58D3D"
                        stroke="#FFFFFF"
                        strokeWidth={2}
                        className="no-pan cursor-grab active:cursor-grabbing hover:fill-[#D4AF37] hover:stroke-amber-100 transition-colors pointer-events-none"
                      />
                      {geom.pin0.isPinned && geom.pin0.pinnedItem ? (
                        <foreignObject
                          x={geom.pin0.x - 70}
                          y={geom.pin0.y - 32}
                          width={140}
                          height={28}
                          className="overflow-visible pointer-events-auto no-pan"
                        >
                          <div className="bg-[#2C2824] text-white border border-[#B58D3D] text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg flex items-center justify-between gap-1 group">
                            <div className="flex items-center gap-1 truncate max-w-[100px]">
                              <Pin size={10} className="text-[#B58D3D] flex-shrink-0" />
                              <span className="truncate">{geom.pin0.pinnedItem.title}</span>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUnpinPoint(ann, 0);
                              }}
                              className="text-red-300 hover:text-red-100 p-0.5 rounded-full hover:bg-red-900/50 cursor-pointer transition-colors"
                              title="Unpin Point 1"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        </foreignObject>
                      ) : (
                        <foreignObject
                          x={geom.pin0.x - 50}
                          y={geom.pin0.y - 28}
                          width={100}
                          height={22}
                          className="overflow-visible pointer-events-none no-pan"
                        >
                          <div className="bg-[#2C2824]/90 text-[#E0D8D0] border border-[#B58D3D]/60 text-[9px] font-semibold px-1.5 py-0.5 rounded shadow flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100">
                            <Pin size={8} className="text-[#B58D3D]" />
                            <span>Drag Pin 1</span>
                          </div>
                        </foreignObject>
                      )}
                    </g>
                  )}

                  {/* Point 1 Control Handle */}
                  {geom.pin1 && (
                    <g className="no-pan">
                      {/* Invisible wider hit target */}
                      <circle
                        cx={geom.pin1.x}
                        cy={geom.pin1.y}
                        r={20}
                        fill="transparent"
                        className="no-pan cursor-grab active:cursor-grabbing"
                        onPointerDown={(e) => {
                          if (!canEdit(ann.id)) return;
                          e.stopPropagation();
                          if (e.nativeEvent) {
                            e.nativeEvent.stopPropagation();
                            e.nativeEvent.stopImmediatePropagation();
                          }
                          try {
                            (e.currentTarget as Element).setPointerCapture(e.pointerId);
                          } catch {}
                          setDraggingHandle({ annId: ann.id, handleIndex: 1 });
                        }}
                      />
                      <circle
                        cx={geom.pin1.x}
                        cy={geom.pin1.y}
                        r={8}
                        fill="#B58D3D"
                        stroke="#FFFFFF"
                        strokeWidth={2}
                        className="no-pan cursor-grab active:cursor-grabbing hover:fill-[#D4AF37] hover:stroke-amber-100 transition-colors pointer-events-none"
                      />
                      {geom.pin1.isPinned && geom.pin1.pinnedItem ? (
                        <foreignObject
                          x={geom.pin1.x - 70}
                          y={geom.pin1.y - 32}
                          width={140}
                          height={28}
                          className="overflow-visible pointer-events-auto no-pan"
                        >
                          <div className="bg-[#2C2824] text-white border border-[#B58D3D] text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg flex items-center justify-between gap-1 group">
                            <div className="flex items-center gap-1 truncate max-w-[100px]">
                              <Pin size={10} className="text-[#B58D3D] flex-shrink-0" />
                              <span className="truncate">{geom.pin1.pinnedItem.title}</span>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUnpinPoint(ann, 1);
                              }}
                              className="text-red-300 hover:text-red-100 p-0.5 rounded-full hover:bg-red-900/50 cursor-pointer transition-colors"
                              title="Unpin Point 2"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        </foreignObject>
                      ) : (
                        <foreignObject
                          x={geom.pin1.x - 50}
                          y={geom.pin1.y - 28}
                          width={100}
                          height={22}
                          className="overflow-visible pointer-events-none no-pan"
                        >
                          <div className="bg-[#2C2824]/90 text-[#E0D8D0] border border-[#B58D3D]/60 text-[9px] font-semibold px-1.5 py-0.5 rounded shadow flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100">
                            <Pin size={8} className="text-[#B58D3D]" />
                            <span>Drag Pin 2</span>
                          </div>
                        </foreignObject>
                      )}
                    </g>
                  )}
                  {/* Corner Resize Handles for Text Annotation */}
                  {ann.type === 'text' && (
                    <g className="no-pan">
                      {[
                        { index: 1, x: (geom.x ?? 0) + (geom.width ?? 160), y: (geom.y ?? 0) + (geom.height ?? 50), cursor: 'cursor-nwse-resize' },
                        { index: 2, x: (geom.x ?? 0), y: (geom.y ?? 0), cursor: 'cursor-nwse-resize' },
                        { index: 3, x: (geom.x ?? 0) + (geom.width ?? 160), y: (geom.y ?? 0), cursor: 'cursor-nesw-resize' },
                        { index: 4, x: (geom.x ?? 0), y: (geom.y ?? 0) + (geom.height ?? 50), cursor: 'cursor-nesw-resize' },
                      ].map((corner) => (
                        <g key={corner.index} className="no-pan">
                          {/* Invisible wider hit area */}
                          <circle
                            cx={corner.x}
                            cy={corner.y}
                            r={14}
                            fill="transparent"
                            className={`no-pan ${corner.cursor}`}
                            onPointerDown={(e) => {
                              if (!canEdit(ann.id)) return;
                              e.stopPropagation();
                              if (e.nativeEvent) {
                                e.nativeEvent.stopPropagation();
                                e.nativeEvent.stopImmediatePropagation();
                              }
                              try {
                                (e.currentTarget as Element).setPointerCapture(e.pointerId);
                              } catch {}
                              setDraggingHandle({ annId: ann.id, handleIndex: corner.index });
                            }}
                          />
                          <rect
                            x={corner.x - 5}
                            y={corner.y - 5}
                            width={10}
                            height={10}
                            rx={2}
                            fill="#FFFFFF"
                            stroke="#B58D3D"
                            strokeWidth={2}
                            className={`no-pan ${corner.cursor} hover:fill-amber-100 transition-colors pointer-events-none`}
                          />
                        </g>
                      ))}
                    </g>
                  )}
                </g>
              )}
            </g>
          );
        })}

        {/* ACTIVE DROP TARGET HIGHLIGHT RING & SNAP INDICATOR WHEN DRAGGING PIN HANDLE */}
        {activePinHover && (() => {
          const baseItem = activePinHover.item;
          const item = items.find(i => i.id === baseItem.id) || baseItem;
          const drag = dragOffsets[item.id] || { x: 0, y: 0 };
          const ix = item.x + drag.x;
          const iy = item.y + drag.y;
          const iw = itemDimensions[item.id]?.width || item.width || 300;
          const ih = itemDimensions[item.id]?.height || item.height || 200;
          const snapX = ix + activePinHover.offsetX;
          const snapY = iy + activePinHover.offsetY;

          return (
            <g className="pointer-events-none no-pan z-50">
              {/* Card Bounding Glow Ring */}
              <rect
                x={ix - 6}
                y={iy - 6}
                width={iw + 12}
                height={ih + 12}
                rx={14}
                fill="none"
                stroke="#B58D3D"
                strokeWidth={3}
                strokeDasharray="8 6"
                className="animate-pulse"
              />
              {/* Drop Banner above card */}
              <foreignObject
                x={ix - 40}
                y={iy - 38}
                width={iw + 80}
                height={34}
                className="overflow-visible pointer-events-none no-pan"
              >
                <div className="flex items-center justify-center w-full">
                  <div className="bg-[#2C2824] text-[#E0D8D0] border-2 border-[#B58D3D] text-xs font-bold px-3 py-1 rounded-full shadow-2xl flex items-center gap-1.5 animate-bounce">
                    <Pin size={13} className="text-[#B58D3D] flex-shrink-0" />
                    <span>Snap Pin {activePinHover.pinIndex + 1} to <strong className="text-white">{item.title}</strong></span>
                  </div>
                </div>
              </foreignObject>

              {/* Snap Target Crosshair on Card */}
              <circle
                cx={snapX}
                cy={snapY}
                r={14}
                fill="#B58D3D33"
                stroke="#B58D3D"
                strokeWidth={2}
              />
              <circle
                cx={snapX}
                cy={snapY}
                r={5}
                fill="#B58D3D"
              />
              <line x1={snapX - 10} y1={snapY} x2={snapX + 10} y2={snapY} stroke="#B58D3D" strokeWidth={1.5} />
              <line x1={snapX} y1={snapY - 10} x2={snapX} y2={snapY + 10} stroke="#B58D3D" strokeWidth={1.5} />
            </g>
          );
        })()}

        {/* LIVE RUBBERBAND DRAWING PREVIEW */}
        {drawingStart && drawingCurrent && activeTool && activeTool.startsWith('ann_') && (() => {
          const type = activeTool.replace('ann_', '');
          const sw = activeStrokeWidth;
          const sc = activeColor;
          const strokeDash = activeStrokeStyle === 'dashed' ? '8 6' : activeStrokeStyle === 'dotted' ? '3 3' : undefined;

          if (type === 'line' || type === 'arrow' || type === 'double_arrow') {
            return (
              <line
                x1={drawingStart.x}
                y1={drawingStart.y}
                x2={drawingCurrent.x}
                y2={drawingCurrent.y}
                stroke={sc}
                strokeWidth={sw}
                strokeDasharray={strokeDash}
                opacity={0.8}
              />
            );
          } else if (type === 'rectangle') {
            const minX = Math.min(drawingStart.x, drawingCurrent.x);
            const minY = Math.min(drawingStart.y, drawingCurrent.y);
            const w = Math.abs(drawingCurrent.x - drawingStart.x);
            const h = Math.abs(drawingCurrent.y - drawingStart.y);
            return (
              <rect
                x={minX}
                y={minY}
                width={w}
                height={h}
                fill={activeFillColor}
                stroke={sc}
                strokeWidth={sw}
                strokeDasharray={strokeDash}
                opacity={0.8}
                rx={6}
              />
            );
          } else if (type === 'circle') {
            const minX = Math.min(drawingStart.x, drawingCurrent.x);
            const minY = Math.min(drawingStart.y, drawingCurrent.y);
            const w = Math.abs(drawingCurrent.x - drawingStart.x);
            const h = Math.abs(drawingCurrent.y - drawingStart.y);
            return (
              <ellipse
                cx={minX + w / 2}
                cy={minY + h / 2}
                rx={w / 2}
                ry={h / 2}
                fill={activeFillColor}
                stroke={sc}
                strokeWidth={sw}
                strokeDasharray={strokeDash}
                opacity={0.8}
              />
            );
          } else if (type === 'text') {
            const minX = Math.min(drawingStart.x, drawingCurrent.x);
            const minY = Math.min(drawingStart.y, drawingCurrent.y);
            const w = Math.max(120, Math.abs(drawingCurrent.x - drawingStart.x));
            const h = Math.max(40, Math.abs(drawingCurrent.y - drawingStart.y));
            return (
              <rect
                x={minX}
                y={minY}
                width={w}
                height={h}
                fill={activeFillColor}
                stroke={sc}
                strokeWidth={2}
                strokeDasharray="4 4"
                opacity={0.8}
              />
            );
          }
          return null;
        })()}
        </g>
      </svg>

      {/* FLOATING ANNOTATION QUICK BAR / INSPECTOR OVERLAY */}
      {selectedAnn && (() => {
        const geom = getResolvedControlPoints(selectedAnn, items, dragOffsets, itemDimensions);
        let left = selectedAnn.x;
        let top = selectedAnn.y - 12;

        if (selectedAnn.type === 'line' || selectedAnn.type === 'arrow' || selectedAnn.type === 'double_arrow') {
          const x1 = geom.x1 ?? selectedAnn.x;
          const y1 = geom.y1 ?? selectedAnn.y;
          const x2 = geom.x2 ?? (selectedAnn.x2 ?? selectedAnn.x + 120);
          const y2 = geom.y2 ?? (selectedAnn.y2 ?? selectedAnn.y + 80);
          left = (x1 + x2) / 2;
          top = Math.min(y1, y2) - 12;
        } else if (selectedAnn.type === 'rectangle' || selectedAnn.type === 'circle') {
          const x = geom.x ?? selectedAnn.x;
          const y = geom.y ?? selectedAnn.y;
          const w = geom.width ?? selectedAnn.width ?? 100;
          left = x + w / 2;
          top = y - 12;
        } else if (selectedAnn.type === 'text') {
          const x = geom.x ?? selectedAnn.x;
          const y = geom.y ?? selectedAnn.y;
          const w = geom.width ?? selectedAnn.width ?? 160;
          left = x + w / 2;
          top = y - 12;
        }

        return (
          <div
            style={{
              position: 'absolute',
              left: `${left * (zoomScale / 100) + positionX}px`,
              top: `${top * (zoomScale / 100) + positionY}px`,
              transform: 'translate(-50%, -100%)',
              zIndex: 60,
              pointerEvents: 'auto',
            }}
            className="cursor-default no-pan"
          >
            {showFullInspector ? (
              <AnnotationInspector
                annotation={selectedAnn}
                items={items}
                onUpdate={onUpdateAnnotation}
                onStartDragPinHandle={handleStartDragPinHandle}
                onMinimize={() => setShowFullInspector(false)}
                onDelete={(id) => {
                  onDeleteAnnotation(id);
                  onSelectAnnotation(null);
                  setMovingAnn(null);
                  setDraggingHandle(null);
                  setShowFullInspector(false);
                }}
                onClose={() => {
                  onSelectAnnotation(null);
                  setMovingAnn(null);
                  setDraggingHandle(null);
                  setShowFullInspector(false);
                }}
              />
            ) : (
              <AnnotationQuickBar
                annotation={selectedAnn}
                items={items}
                onUpdate={onUpdateAnnotation}
                onOpenFullInspector={() => setShowFullInspector(true)}
                onDelete={(id) => {
                  onDeleteAnnotation(id);
                  onSelectAnnotation(null);
                  setMovingAnn(null);
                  setDraggingHandle(null);
                }}
                onClose={() => {
                  onSelectAnnotation(null);
                  setMovingAnn(null);
                  setDraggingHandle(null);
                }}
              />
            )}
          </div>
        );
      })()}
    </>
  );
}
