'use client';

import { useRef, useEffect, useCallback } from 'react';
import { DrawingLine } from '@/lib/types';

interface AnnotatedImagePreviewProps {
  imageUrl: string;
  lines?: DrawingLine[];
  alt?: string;
  className?: string;
  imgClassName?: string;
}

export default function AnnotatedImagePreview({
  imageUrl,
  lines,
  alt = 'Image',
  className = 'w-full h-full flex-1 min-h-0 overflow-hidden rounded flex items-center justify-center relative',
  imgClassName = 'w-full h-full object-contain pointer-events-none select-none',
}: AnnotatedImagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

    if (!lines || lines.length === 0) return;

    const referenceWidth = 500;
    lines.forEach((l) => {
      if (!l.points || l.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = l.color;

      const isLineNormalized = !l.points.some((val) => val > 1.05);
      const baseWidth = l.tool === 'eraser' ? 20 : 3;
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
    });
  }, [lines]);

  useEffect(() => {
    drawLines();

    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      drawLines();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [drawLines, imageUrl, lines]);

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
      {lines && lines.length > 0 && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
      )}
    </div>
  );
}
