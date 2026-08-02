'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { CropRect } from '@/lib/utils';

interface ImageCropModalProps {
  open: boolean;
  imageUrl: string;
  /** Optional normalized crop rect to preload the frame with (0..1). */
  initialCrop?: CropRect | null;
  onCancel: () => void;
  onApply: (result: { cropRect: CropRect }) => void | Promise<void>;
}

type AspectId = 'free' | '1:1' | '4:3' | '16:9';

const ASPECTS: { id: AspectId; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

const MIN_SIZE = 16;

type DragEdge = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface DragState {
  mode: DragEdge;
  startX: number;
  startY: number;
  startCrop: Frame;
}

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clampPx = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Returns the rect within the preview (CSS px) that the image occupies. */
function imageRectInPreview(w: number, h: number, nw: number, nh: number): Frame {
  if (w <= 0 || h <= 0 || nw <= 0 || nh <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.min(w / nw, h / nh);
  const rw = nw * scale;
  const rh = nh * scale;
  return { x: (w - rw) / 2, y: (h - rh) / 2, w: rw, h: rh };
}

function aspectRatioOf(id: AspectId): number | null {
  return ASPECTS.find((a) => a.id === id)?.ratio ?? null;
}

/**
 * Compute the new crop frame during a drag.
 *
 * `bounds` is the image rect (in preview CSS px). Ratio-locked resizing keeps
 * the corner opposite the moving handle anchored; the frame grows until it hits
 * whichever of the pointer / bounds limits comes first.
 */
function resizedFrame(
  mode: DragEdge,
  start: Frame,
  ddx: number,
  ddy: number,
  ratio: number | null,
  bounds: Frame,
): Frame {
  const s = start;
  const b = bounds;

  const movesLeft = mode.includes('w');
  const movesRight = mode.includes('e');
  const movesTop = mode.includes('n');
  const movesBottom = mode.includes('s');

  const movedLeft = movesLeft ? s.x + ddx : s.x;
  const movedTop = movesTop ? s.y + ddy : s.y;
  const movedRight = movesRight ? s.x + s.w + ddx : s.x + s.w;
  const movedBottom = movesBottom ? s.y + s.h + ddy : s.y + s.h;

  const clampFrame = (f: Frame): Frame => {
    const w = Math.min(Math.max(MIN_SIZE, f.w), b.w);
    const h = Math.min(Math.max(MIN_SIZE, f.h), b.h);
    return {
      x: clampPx(f.x, b.x, b.x + b.w - w),
      y: clampPx(f.y, b.y, b.y + b.h - h),
      w,
      h,
    };
  };

  if (!ratio) {
    return clampFrame({
      x: Math.min(movedLeft, movedRight),
      y: Math.min(movedTop, movedBottom),
      w: Math.abs(movedRight - movedLeft),
      h: Math.abs(movedBottom - movedTop),
    });
  }

  // Ratio locked: the corner diagonal to the dragged one is the anchor.
  const anchorX = movesRight ? s.x : s.x + s.w;
  const anchorY = movesBottom ? s.y : s.y + s.h;

  const pointerW = Math.abs((movesRight ? movedRight : movedLeft) - anchorX);
  const pointerH = Math.abs((movesBottom ? movedBottom : movedTop) - anchorY);

  const isCorner = movesLeft !== movesRight && movesTop !== movesBottom;

  let w: number;
  let h: number;
  if (isCorner) {
    // Extend along whichever driver reaches the pointer first (keeps ratio).
    // Derive the "power" measure: how far the pointer is from the anchor along
    // each axis, then start from the axis that is proportionally over the
    // ratio (i.e. the pointer is past the diagonal).
    if (pointerW / pointerH >= ratio) {
      w = pointerW;
      h = w / ratio;
    } else {
      h = pointerH;
      w = h * ratio;
    }
  } else if (movesLeft || movesRight) {
    // Horizontal edge: width drives, height follows ratio.
    w = pointerW;
    h = w / ratio;
  } else {
    // Vertical edge: height drives, width follows ratio.
    h = pointerH;
    w = h * ratio;
  }

  // Never grow past the anchor's opposing edges.
  const maxW = movesRight ? b.x + b.w - anchorX : anchorX - b.x;
  const maxH = movesBottom ? b.y + b.h - anchorY : anchorY - b.y;
  w = Math.min(w, maxW);
  h = Math.min(h, maxH);
  if (ratio > 0) {
    if (w / ratio > h) {
      w = h * ratio;
    } else {
      h = w / ratio;
    }
    if (w > maxW) {
      w = maxW;
      h = w / ratio;
    }
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
  }

  return clampFrame({
    x: anchorX - (movesRight ? 0 : w),
    y: anchorY - (movesBottom ? 0 : h),
    w: Math.max(MIN_SIZE, w),
    h: Math.max(MIN_SIZE, h),
  });
}

/** Snap a frame to exactly match `ratio` (w/h) while staying within bounds. */
function snapToRatioRef(f: Frame, ratio: number, bounds: Frame): Frame {
  let w = f.w;
  let h = f.h;
  if (ratio > 0) {
    const wMax = Math.min(f.w, bounds.w);
    const hMax = Math.min(f.h, bounds.h);
    if (wMax / ratio <= hMax) {
      w = wMax;
      h = w / ratio;
    } else {
      h = hMax;
      w = h * ratio;
    }
  }
  return {
    x: f.x + (f.w - w) / 2,
    y: f.y + (f.h - h) / 2,
    w,
    h,
  };
}

export default function ImageCropModal({ open, imageUrl, initialCrop, onCancel, onApply }: ImageCropModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [crop, setCrop] = useState<Frame>({ x: 0, y: 0, w: 0, h: 0 });
  const [aspect, setAspect] = useState<AspectId>('free');
  const dragRef = useRef<DragState | null>(null);
  const [error, setError] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const initedFor = useRef<string | null>(null);

  const rect = imageRectInPreview(containerSize.w, containerSize.h, naturalSize.w, naturalSize.h);

  // Track the preview container size (handles window/drawer resizing).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const handleImageLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    setNaturalSize({ w: img.naturalWidth || img.width || 1, h: img.naturalHeight || img.height || 1 });
    setError('');
  };

  // Reset meta-state whenever the modal/image changes.
  const prevOpen = useRef(open);
  const prevUrl = useRef(imageUrl);
  useEffect(() => {
    const opened = open && (prevOpen.current === false || prevUrl.current !== imageUrl);
    prevOpen.current = open;
    prevUrl.current = imageUrl;
    if (!opened) return;
    // Reset session-local state for the new crop.
    const raf = requestAnimationFrame(() => {
      setError('');
      setIsApplying(false);
      setAspect('free');
    });
    return () => cancelAnimationFrame(raf);
  }, [open, imageUrl]);

  const normalize = useCallback((f: Frame): CropRect => {
    if (rect.w <= 0 || rect.h <= 0) return { x: 0, y: 0, width: 1, height: 1 };
    return {
      x: clampPx((f.x - rect.x) / rect.w, 0, 1),
      y: clampPx((f.y - rect.y) / rect.h, 0, 1),
      width: clampPx(f.w / rect.w, 0, 1),
      height: clampPx(f.h / rect.h, 0, 1),
    };
  }, [rect]);

  const denormalize = useCallback((cr: CropRect): Frame => {
    if (rect.w <= 0 || rect.h <= 0) return { x: 0, y: 0, w: 0, h: 0 };
    const w = Math.min(Math.max(MIN_SIZE, cr.width * rect.w), rect.w);
    const h = Math.min(Math.max(MIN_SIZE, cr.height * rect.h), rect.h);
    return {
      x: clampPx(rect.x + cr.x * rect.w, rect.x, rect.x + rect.w - w),
      y: clampPx(rect.y + cr.y * rect.h, rect.y, rect.y + rect.h - h),
      w,
      h,
    };
  }, [rect]);

  // Initialize the frame once the image size is known.
  useEffect(() => {
    if (!open) return;
    if (rect.w <= 0 || rect.h <= 0 || naturalSize.w <= 0) return;
    if (initedFor.current === imageUrl) return;
    initedFor.current = imageUrl;
    const raf = requestAnimationFrame(() => {
      if (initialCrop && initialCrop.width > 0 && initialCrop.height > 0) {
        setCrop(denormalize(initialCrop));
      } else {
        setCrop({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [open, imageUrl, naturalSize, rect.w, rect.h, rect.x, rect.y, initialCrop, denormalize, rect]);

  const handlePointerDown = (e: React.PointerEvent, mode: DragEdge) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, startCrop: { ...crop } };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.stopPropagation();
    e.preventDefault();
    const ddx = e.clientX - drag.startX;
    const ddy = e.clientY - drag.startY;

    if (drag.mode === 'move') {
      setCrop({
        x: clampPx(drag.startCrop.x + ddx, rect.x, rect.x + rect.w - drag.startCrop.w),
        y: clampPx(drag.startCrop.y + ddy, rect.y, rect.y + rect.h - drag.startCrop.h),
        w: drag.startCrop.w,
        h: drag.startCrop.h,
      });
      return;
    }

    setCrop(
      resizedFrame(drag.mode, drag.startCrop, ddx, ddy, aspectRatioOf(aspect), rect),
    );
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = null;
  };

  const selectAspect = (id: AspectId) => {
    setAspect(id);
    const ratio = aspectRatioOf(id);
    if (ratio && rect.w > 0 && rect.h > 0) {
      setCrop((prev) => snapToRatioRef(prev, ratio, rect));
    }
  };

  const resetCrop = () => {
    if (rect.w <= 0 || rect.h <= 0) return;
    setCrop({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
  };

  const apply = async () => {
    if (rect.w <= 0 || rect.h <= 0) return;
    if (crop.w < MIN_SIZE || crop.h < MIN_SIZE) {
      setError('Crop region is too small.');
      return;
    }
    setError('');
    try {
      setIsApplying(true);
      // Mask-only crop: no file is baked or uploaded. The rectangle is stored
      // as data on the item and the original image is shown through it.
      await onApply({ cropRect: normalize(crop) });
    } catch (err) {
      console.error('Crop apply failed:', err);
      setError(err instanceof Error ? `Unable to crop this image (${err.message})` : 'Unable to crop this image.');
    } finally {
      setIsApplying(false);
    }
  };

  if (!open) return null;

  const handleClass = 'block w-3 h-3 bg-white border border-[#B58D3D] rounded-[2px] shadow';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1A1712]/80 backdrop-blur-sm p-4"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className="bg-[#2C2824] border border-[#B58D3D] rounded-2xl shadow-2xl flex flex-col w-full max-w-3xl h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#423D38]">
          <span className="text-sm font-bold text-[#E0D8D0]">Crop Image</span>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded hover:bg-[#423D38] text-[#8C7B6E] hover:text-[#E0D8D0] transition-colors"
            title="Cancel"
          >
            <X size={16} />
          </button>
        </div>

        {/* Stage */}
        <div
          ref={containerRef}
          className="relative m-4 bg-black/40 border border-[#423D38] rounded-lg flex-1 min-h-[320px] overflow-hidden touch-none select-none"
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Crop preview"
            onLoad={handleImageLoad}
            className="w-full h-full object-contain pointer-events-none select-none"
            referrerPolicy="no-referrer"
            draggable={false}
          />
          {rect.w > 0 && rect.h > 0 && crop.w >= MIN_SIZE && crop.h >= MIN_SIZE && (
            <>
              {/* Masks */}
              <div
                className="absolute bg-[#1A1712]/60 pointer-events-none"
                style={{ left: rect.x, top: rect.y, width: crop.x - rect.x, height: rect.h }}
              />
              <div
                className="absolute bg-[#1A1712]/60 pointer-events-none"
                style={{ left: crop.x, top: rect.y, width: crop.w, height: crop.y - rect.y }}
              />
              <div
                className="absolute bg-[#1A1712]/60 pointer-events-none"
                style={{ left: crop.x, top: crop.y + crop.h, width: crop.w, height: rect.y + rect.h - (crop.y + crop.h) }}
              />
              <div
                className="absolute bg-[#1A1712]/60 pointer-events-none"
                style={{ left: crop.x + crop.w, top: rect.y, width: rect.x + rect.w - (crop.x + crop.w), height: rect.h }}
              />

              {/* Crop frame + handles */}
              <div
                className="absolute cursor-move"
                style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h, touchAction: 'none' }}
                onPointerDown={(e) => handlePointerDown(e, 'move')}
              >
                <div className="absolute inset-0 border-2 border-[#B58D3D] pointer-events-none" />
                <div className="absolute -top-1.5 -left-1.5 cursor-nwse-resize" style={{ touchAction: 'none' }} onPointerDown={(e) => handlePointerDown(e, 'nw')}>
                  <span className={handleClass} />
                </div>
                <div className="absolute -top-1.5 -right-1.5 cursor-nesw-resize" style={{ touchAction: 'none' }} onPointerDown={(e) => handlePointerDown(e, 'ne')}>
                  <span className={handleClass} />
                </div>
                <div className="absolute -bottom-1.5 -left-1.5 cursor-nesw-resize" style={{ touchAction: 'none' }} onPointerDown={(e) => handlePointerDown(e, 'sw')}>
                  <span className={handleClass} />
                </div>
                <div className="absolute -bottom-1.5 -right-1.5 cursor-nwse-resize" style={{ touchAction: 'none' }} onPointerDown={(e) => handlePointerDown(e, 'se')}>
                  <span className={handleClass} />
                </div>
                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize" style={{ touchAction: 'none' }} onPointerDown={(e) => handlePointerDown(e, 'n')}>
                  <span className={handleClass} />
                </div>
                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize" style={{ touchAction: 'none' }} onPointerDown={(e) => handlePointerDown(e, 's')}>
                  <span className={handleClass} />
                </div>
                <div className="absolute top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize" style={{ touchAction: 'none' }} onPointerDown={(e) => handlePointerDown(e, 'w')}>
                  <span className={handleClass} />
                </div>
                <div className="absolute top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize" style={{ touchAction: 'none' }} onPointerDown={(e) => handlePointerDown(e, 'e')}>
                  <span className={handleClass} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer controls */}
        <div className="flex flex-col gap-3 p-4 border-t border-[#423D38]">
          {error && <div className="text-xs font-bold text-red-400">{error}</div>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {ASPECTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAspect(a.id)}
                  className={`px-2.5 py-1 text-xs font-bold rounded transition-colors ${
                    aspect === a.id ? 'bg-[#B58D3D] text-white' : 'bg-[#423D38] text-[#B8AFA7] hover:bg-[#4a443e]'
                  }`}
                >
                  {a.label}
                </button>
              ))}
              <button
                type="button"
                onClick={resetCrop}
                className="px-2.5 py-1 text-xs font-bold rounded bg-[#423D38] text-[#B9AFA7] hover:bg-[#4a443e] flex items-center gap-1 transition-colors"
                title="Reset to full image"
              >
                <RotateCcw size={12} /> Reset
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-1.5 text-xs font-bold rounded bg-[#423D38] text-[#B9AFA7] hover:bg-[#4a443e] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={isApplying}
                className="px-4 py-1.5 text-xs font-bold rounded bg-[#B58D3D] text-white hover:bg-[#c69c3f] flex items-center gap-1.5 transition-colors disabled:opacity-60"
              >
                {isApplying ? 'Applying…' : 'Apply Crop'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}