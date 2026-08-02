'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { DrawingLine, CropRect } from '@/lib/types';
import { getImageRenderRect, getCroppedImageGeometry, isFullCrop, transformLinesForCrop } from '@/lib/utils';

interface AnnotatedImagePreviewProps {
  imageUrl: string;
  lines?: DrawingLine[];
  crop?: CropRect | null;
  alt?: string;
  className?: string;
  imgClassName?: string;
  /** How the image is fitted inside the container (must match the imgClassName object-fit). */
  objectFit?: 'contain' | 'cover';
  /** Vertical alignment of the fitted image (object-position). */
  objectPosition?: 'center' | 'top';
}

export default function AnnotatedImagePreview({
  imageUrl,
  lines,
  crop,
  alt = 'Image',
  className = 'w-full h-full flex-1 min-h-0 overflow-hidden rounded flex items-center justify-center relative',
  imgClassName = 'w-full h-full object-contain pointer-events-none select-none',
  objectFit = 'contain',
  objectPosition = 'center',
}: AnnotatedImagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Track the container size so the masked image geometry can be computed at
  // render time (the image itself is absolutely positioned in mask mode).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

    // Lines are stored normalized to the ORIGINAL image. When a mask is
    // active, remap them into the crop's coordinate space for display (points
    // outside the mask are dropped). Crop-space lines map across the realized
    // rect of the crop region within the container.
    const isMasked = !!crop && !isFullCrop(crop);
    const rect = isMasked
      ? (getCroppedImageGeometry(w, h, naturalSize.width, naturalSize.height, crop!, objectFit, objectPosition)?.rect ?? {
          x: 0,
          y: 0,
          width: w,
          height: h,
        })
      : getImageRenderRect(w, h, naturalSize.width, naturalSize.height, objectFit, objectPosition);
    const renderW = rect.width || w;
    const renderH = rect.height || h;
    const drawLinesArr = isMasked ? transformLinesForCrop(lines, crop) ?? [] : lines;

    const referenceWidth = 500;
    drawLinesArr.forEach((l) => {
      if (!l.points || l.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = l.color;

      const isLineNormalized = !l.points.some((val) => val > 1.05);
      const baseWidth = l.tool === 'eraser' ? 20 : 3;
      ctx.lineWidth = Math.max(1, baseWidth * (renderW / referenceWidth));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = l.tool === 'eraser' ? 'destination-out' : 'source-over';

      const getX = (val: number) => (isLineNormalized ? rect.x + val * renderW : val);
      const getY = (val: number) => (isLineNormalized ? rect.y + val * renderH : val);

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
  }, [lines, crop, naturalSize, objectFit, objectPosition]);

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete) {
      setNaturalSize({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    }
    drawLines();

    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      drawLines();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [drawLines, imageUrl, lines]);

  const isMasked = !!crop && !isFullCrop(crop);
  const geometry = isMasked
    ? getCroppedImageGeometry(
        containerSize.width,
        containerSize.height,
        naturalSize.width,
        naturalSize.height,
        crop!,
        objectFit,
        objectPosition,
      )
    : null;

  return (
    <div
      ref={containerRef}
      className={className}
      // In mask mode the image is out of flow, so give the container the crop
      // region's aspect ratio — this preserves the height that the image used
      // to provide (grid rows / auto-height parents keep their size). When a
      // parent constrains the height, the explicit height wins over this.
      style={geometry ? { aspectRatio: `${geometry.regionAspect} / 1` } : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={imageUrl}
        alt={alt}
        style={geometry?.imgStyle}
        onLoad={() => {
          const img = imgRef.current;
          if (img) {
            setNaturalSize({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
          }
          drawLines();
        }}
        className={geometry ? 'pointer-events-none select-none' : imgClassName}
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
