'use client';

import { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { DrawingLine, CropRect } from '@/lib/types';
import { getImageRenderRect, getCroppedImageGeometry, isFullCrop, transformLinesForCrop, pointFromCropSpace } from '@/lib/utils';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface ImageDrawerProps {
  imageUrl: string;
  lines: DrawingLine[];
  crop?: CropRect | null;
  onLinesChange: (lines: DrawingLine[]) => void;
  canEdit: boolean;
}

export default function ImageDrawer({ imageUrl, lines, crop, onLinesChange, canEdit }: ImageDrawerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageWrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [currentLine, setCurrentLine] = useState<DrawingLine | null>(null);
  const [tool, setTool] = useState<'pen'|'eraser'>('pen');
  const [color, setColor] = useState('#ef4444');

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [maskedContainerSize, setMaskedContainerSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  const isMasked = !!crop && !isFullCrop(crop);

  // Track the container size dynamically using a ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // In mask mode the image is absolutely positioned, so track the image wrap's
  // own size for the geometry instead (it differs from the outer container by
  // the toolbar height).
  useEffect(() => {
    const el = imageWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setMaskedContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Make sure the container/wrap sizes are known the instant the mask becomes
  // active. The ResizeObservers deliver asynchronously, so without this the
  // first masked render can fall back to zero-size geometry — the image toggles
  // between the unmasked and masked layout (flash) and the drawing rect
  // collapses to the canvas origin (strokes bunch up in the top-left corner).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container) {
      const r = container.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setContainerSize({ width: r.width, height: r.height });
      }
    }
    const wrap = imageWrapRef.current;
    if (wrap) {
      const r = wrap.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setMaskedContainerSize({ width: r.width, height: r.height });
      }
    }
  }, [isMasked, crop]);

  const syncCanvasSize = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The canvas overlays the image wrap (inset-0), so its buffer should match
    // the wrap's CSS size. Measure the WRAP, not the canvas: a canvas's CSS
    // size is driven by its width/height attributes once they've been set, so
    // reading canvas.clientWidth is self-referential — a sync that runs before
    // the layout settles locks the canvas to a stale size and it can never
    // recover, squishing every stroke into the top-left corner. (The masked
    // image element itself is blown up, so it must not drive the canvas size.)
    const wrap = imageWrapRef.current;
    const w = wrap ? wrap.clientWidth : 0;
    const h = wrap ? wrap.clientHeight : 0;
    if (w > 0 && h > 0) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        setCanvasSize({ width: w, height: h });
      }
    }
  };

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete) {
      syncCanvasSize();
    }
    
    // Re-sync the canvas whenever the image wrap resizes (image load, window
    // or drawer resizes, mask layout changes). The wrap is what the canvas
    // overlays, so it's the correct reference for the buffer size.
    const wrap = imageWrapRef.current;
    if (wrap) {
      const ro = new ResizeObserver(syncCanvasSize);
      ro.observe(wrap);
      return () => ro.disconnect();
    }
  }, [imageUrl]);

  // Track the original/natural size of the loaded image
  useEffect(() => {
    const img = imgRef.current;
    if (img) {
      if (img.complete) {
        setNaturalSize({
          width: img.naturalWidth || img.width || 300,
          height: img.naturalHeight || img.height || 200
        });
      } else {
        setNaturalSize({ width: 0, height: 0 });
      }
    }
  }, [imageUrl]);

  const handleImageLoad = () => {
    const img = imgRef.current;
    if (img) {
      setNaturalSize({
        width: img.naturalWidth || img.width || 300,
        height: img.naturalHeight || img.height || 200
      });
    }
    setTimeout(syncCanvasSize, 0);
  };

  // The visible image may be letterboxed inside the container — this is the
  // rectangle (in container CSS pixels) the image actually occupies.
  const imageRect = getImageRenderRect(
    containerSize.width,
    containerSize.height,
    naturalSize.width,
    naturalSize.height,
    'contain',
  );

  // Masked mode: compute the exact geometry of the crop region inside the
  // image wrap. Crop-space coordinates map onto `geometry.rect`.
  const geometry = useMemo(
    () =>
      isMasked
        ? getCroppedImageGeometry(
            maskedContainerSize.width,
            maskedContainerSize.height,
            naturalSize.width,
            naturalSize.height,
            crop!,
            'contain',
            'center',
          )
        : null,
    [isMasked, crop, maskedContainerSize.width, maskedContainerSize.height, naturalSize.width, naturalSize.height],
  );

  const drawRect = useMemo(
    () => (geometry?.rect ? geometry.rect : imageRect),
    [geometry, imageRect],
  );

  // Draw all lines whenever lines change, current line updates, or canvas resizes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const renderW = drawRect.width || canvas.width;
    const renderH = drawRect.height || canvas.height;

    const drawLine = (l: DrawingLine) => {
      if (l.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = l.color;
      
      // Check if points are normalized (usually all points are in range [0..1.05])
      const isLineNormalized = !l.points.some(val => val > 1.05);

      // Scale line width proportionally to the rendered image size, using 500px as reference
      const referenceWidth = 500;
      const baseWidth = l.tool === 'eraser' ? 20 : 3;
      ctx.lineWidth = Math.max(1, baseWidth * (renderW / referenceWidth));
      
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      // Eraser uses destination-out to erase
      ctx.globalCompositeOperation = l.tool === 'eraser' ? 'destination-out' : 'source-over';
      
      const getX = (val: number) => isLineNormalized ? drawRect.x + val * renderW : val;
      const getY = (val: number) => isLineNormalized ? drawRect.y + val * renderH : val;

      ctx.moveTo(getX(l.points[0]), getY(l.points[1]));
      if (l.points.length === 2) {
        ctx.lineTo(getX(l.points[0]), getY(l.points[1]));
      } else {
        for (let i = 2; i < l.points.length; i += 2) {
          ctx.lineTo(getX(l.points[i]), getY(l.points[i+1]));
        }
      }
      ctx.stroke();
    };
    
    // Lines are stored in ORIGINAL image space; remap them into crop space so
    // they line up with the masked display.
    const displayLines = isMasked ? transformLinesForCrop(lines, crop!) ?? [] : lines;
    displayLines.forEach(drawLine);
    if (currentLine) {
      const displayCurrent = isMasked ? (transformLinesForCrop([currentLine], crop!) ?? [])[0] : currentLine;
      if (displayCurrent) drawLine(displayCurrent);
    }
  }, [lines, crop, currentLine, canvasSize, containerSize, naturalSize, isMasked, drawRect]);

  const getPointerPos = (e: React.PointerEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const cRect = canvas.getBoundingClientRect();
    if (cRect.width <= 0 || cRect.height <= 0) return null;
    // While a mask is active the drawing space is the crop region. If the
    // mask geometry isn't ready yet, the mapping is undefined — refuse the
    // stroke instead of collapsing it onto the canvas origin.
    if (isMasked && !geometry) return null;
    const d = drawRect;
    if (!d || d.width <= 0 || d.height <= 0) return null;
    // Return relative coordinates normalized to the drawing rect (the visible
    // image or the crop window), not the whole container, so stored lines stay
    // aligned with what the user sees.
    const px = e.clientX - cRect.left;
    const py = e.clientY - cRect.top;
    return {
      x: (px - d.x) / d.width,
      y: (py - d.y) / d.height,
    };
  };

  // Convert a pointer position from display space into the ORIGINAL image space
  // used for storage (unmasked == identity, masked == crop-space → original).
  const toStoredPoint = (pos: { x: number; y: number }) => {
    if (isMasked && crop) {
      const o = pointFromCropSpace(pos.x, pos.y, crop);
      return { x: clamp01(o.x), y: clamp01(o.y) };
    }
    return { x: clamp01(pos.x), y: clamp01(pos.y) };
  };

  const startDrawing = (e: React.PointerEvent) => {
    if (!canEdit) return;
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation?.();
    const pos = getPointerPos(e);
    if (!pos) return;
    // Ignore strokes that start outside the visible image (letterbox area)
    if (pos.x < 0 || pos.x > 1 || pos.y < 0 || pos.y > 1) return;
    const p = toStoredPoint(pos);
    setIsDrawing(true);
    setCurrentLine({
      tool,
      color,
      points: [p.x, p.y]
    });
  };

  const draw = (e: React.PointerEvent) => {
    if (!isDrawing || !currentLine) return;
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation?.();
    const pos = getPointerPos(e);
    if (!pos) return;
    const p = toStoredPoint(pos);
    setCurrentLine({
      ...currentLine,
      points: [...currentLine.points, p.x, p.y]
    });
  };

  const stopDrawing = (e: React.PointerEvent) => {
    if (!isDrawing || !currentLine) return;
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation?.();
    setIsDrawing(false);
    onLinesChange([...lines, currentLine]);
    setCurrentLine(null);
  };

  return (
    <div
      className="flex flex-col flex-1 min-h-0 relative"
      ref={containerRef}
      // When masked the image is out of flow, so give the drawer a stable
      // height from the crop region's aspect ratio. Without this, auto-height
      // parents (e.g. image fields in the NPC/structured sheets) collapse the
      // wrap to zero when the mask activates; the ResizeObserver then reports
      // 0, geometry goes null, the image renders in-flow again, and the cycle
      // repeats — the whole area flickers.
      style={isMasked && geometry ? { aspectRatio: `${geometry.regionAspect} / 1` } : undefined}
      onPointerDown={e => e.stopPropagation()}
    >
      {canEdit && (
        <div className="flex gap-2 p-2 bg-neutral-900 rounded border border-neutral-700 absolute top-2 right-2 z-10 shadow">
          <button 
            onClick={() => setTool('pen')}
            className={`px-2 py-1 text-xs rounded ${tool === 'pen' ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-400'}`}
          >
            Pen
          </button>
          <button 
            onClick={() => setTool('eraser')}
            className={`px-2 py-1 text-xs rounded ${tool === 'eraser' ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-400'}`}
          >
            Eraser
          </button>
          <input 
            type="color" 
            value={color}
            onChange={e => setColor(e.target.value)}
            className="w-6 h-6 rounded"
            disabled={tool === 'eraser'}
          />
          <button 
            onClick={() => onLinesChange([])}
            className="px-2 py-1 text-xs rounded bg-neutral-800 text-red-400"
          >
            Clear
          </button>
        </div>
      )}
      
      <div className="relative flex-1 min-h-0" ref={imageWrapRef}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img 
          ref={imgRef}
          src={imageUrl} 
          alt="Map/Image" 
          onLoad={handleImageLoad}
          style={geometry?.imgStyle}
          className={geometry ? 'pointer-events-none select-none' : 'w-full h-full rounded pointer-events-none select-none object-contain'} 
          referrerPolicy="no-referrer"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full cursor-crosshair touch-none no-pan"
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerLeave={stopDrawing}
        />
      </div>
    </div>
  );
}
