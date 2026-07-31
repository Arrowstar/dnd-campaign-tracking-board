'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { DrawingLine } from '@/lib/types';
import { Pen, Eraser, Trash2 } from 'lucide-react';

interface AnnotatedImagePreviewProps {
  imageUrl: string;
  lines?: DrawingLine[];
  alt?: string;
  className?: string;
  imgClassName?: string;
  /** When true (and onLinesChange provided) the image becomes an interactive
   *  annotation surface — pointer drags draw lines that are committed via
   *  onLinesChange (same coordinate model as ImageDrawer). */
  canEdit?: boolean;
  onLinesChange?: (lines: DrawingLine[]) => void;
}

export default function AnnotatedImagePreview({
  imageUrl,
  lines,
  alt = 'Image',
  className = 'w-full h-full flex-1 min-h-0 overflow-hidden rounded flex items-center justify-center relative',
  imgClassName = 'w-full h-full object-contain pointer-events-none select-none',
  canEdit = false,
  onLinesChange,
}: AnnotatedImagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState('#ef4444');
  const [currentLine, setCurrentLine] = useState<DrawingLine | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const interactive = canEdit && !!onLinesChange;

  const drawLines = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    if (w === 0 || h === 0) return;

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.clearRect(0, 0, w, h);

    const drawLine = (l: DrawingLine) => {
      if (!l.points || l.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = l.color;

      const isLineNormalized = !l.points.some((val) => val > 1.05);
      const baseWidth = l.tool === 'eraser' ? 20 : 3;
      const referenceWidth = 500;
      ctx.lineWidth = Math.max(1, baseWidth * (w / referenceWidth));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = l.tool === 'eraser' ? 'destination-out' : 'source-over';

      const getX = (val: number) => (isLineNormalized ? val * w : val);
      const getY = (val: number) => (isLineNormalized ? val * h : val);

      ctx.moveTo(getX(l.points[0]), getY(l.points[1]));
      if (l.points.length === 2) {
        ctx.lineTo(getX(l.points[0]), getY(l.points[1]));
      } else {
        for (let i = 2; i < l.points.length; i += 2) {
          ctx.lineTo(getX(l.points[i]), getY(l.points[i + 1]));
        }
      }
      ctx.stroke();
    };

    (lines ?? []).forEach(drawLine);
    if (currentLine) drawLine(currentLine);
  }, [lines, currentLine]);

  useEffect(() => {
    drawLines();

    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      drawLines();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [drawLines, imageUrl]);

  const getPointerPos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0,
      y: rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0,
    };
  };

  const startDrawing = (e: React.PointerEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation?.();
    setIsDrawing(true);
    const pos = getPointerPos(e);
    setCurrentLine({
      tool,
      color,
      points: [pos.x, pos.y],
    });
  };

  const draw = (e: React.PointerEvent) => {
    if (!isDrawing || !currentLine) return;
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation?.();
    const pos = getPointerPos(e);
    setCurrentLine({
      ...currentLine,
      points: [...currentLine.points, pos.x, pos.y],
    });
  };

  const stopDrawing = (e: React.PointerEvent) => {
    if (!isDrawing || !currentLine) return;
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation?.();
    setIsDrawing(false);
    if (onLinesChange) onLinesChange([...(lines ?? []), currentLine]);
    setCurrentLine(null);
  };

  return (
    <div ref={containerRef} className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={alt}
        onLoad={drawLines}
        className={imgClassName}
        draggable={false}
      />
      {interactive && (
        <div
          className="absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded-md bg-[#2C2824]/90 border border-[#D9D0C1]/40 px-1 py-0.5 shadow-md"
          data-no-drag
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => setTool('pen')}
            title="Draw"
            className={`p-0.5 rounded cursor-pointer transition-colors ${tool === 'pen' ? 'bg-white/25 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
          >
            <Pen size={10} />
          </button>
          <button
            type="button"
            onClick={() => setTool('eraser')}
            title="Erase"
            className={`p-0.5 rounded cursor-pointer transition-colors ${tool === 'eraser' ? 'bg-white/25 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
          >
            <Eraser size={10} />
          </button>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            title="Line color"
            disabled={tool === 'eraser'}
            className="w-3.5 h-3.5 rounded cursor-pointer disabled:opacity-40"
          />
          <button
            type="button"
            onClick={() => onLinesChange?.([])}
            title="Clear annotations"
            className="p-0.5 rounded cursor-pointer text-red-400 hover:bg-red-500/20 transition-colors"
          >
            <Trash2 size={10} />
          </button>
        </div>
      )}
      {(interactive || (lines && lines.length > 0)) && (
        <canvas
          ref={canvasRef}
          className={interactive ? 'absolute inset-0 w-full h-full cursor-crosshair touch-none' : 'absolute inset-0 w-full h-full pointer-events-none'}
          onPointerDown={interactive ? startDrawing : undefined}
          onPointerMove={interactive ? draw : undefined}
          onPointerUp={interactive ? stopDrawing : undefined}
          onPointerLeave={interactive ? stopDrawing : undefined}
          onClick={interactive ? (e) => e.stopPropagation() : undefined}
          data-no-drag={interactive ? true : undefined}
        />
      )}
    </div>
  );
}
