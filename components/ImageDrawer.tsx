'use client';

import { useState, useRef, useEffect } from 'react';
import { DrawingLine } from '@/lib/types';

interface ImageDrawerProps {
  imageUrl: string;
  lines: DrawingLine[];
  onLinesChange: (lines: DrawingLine[]) => void;
  canEdit: boolean;
}

export default function ImageDrawer({ imageUrl, lines, onLinesChange, canEdit }: ImageDrawerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [currentLine, setCurrentLine] = useState<DrawingLine | null>(null);
  const [tool, setTool] = useState<'pen'|'eraser'>('pen');
  const [color, setColor] = useState('#ef4444');

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

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

  const syncCanvasSize = () => {
    const img = imgRef.current;
    if (canvasRef.current && img) {
      const w = img.clientWidth || img.width;
      const h = img.clientHeight || img.height;
      if (w > 0 && h > 0) {
        if (canvasRef.current.width !== w || canvasRef.current.height !== h) {
          canvasRef.current.width = w;
          canvasRef.current.height = h;
          setCanvasSize({ width: w, height: h });
        }
      }
    }
  };

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete) {
      syncCanvasSize();
    }
    
    // Also add a resize observer to the image to handle window resizes changing the image size
    if (img) {
      const ro = new ResizeObserver(syncCanvasSize);
      ro.observe(img);
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

  // Calculate the scaled width and height that fills the container up to its bounds while preserving aspect ratio
  const getRenderSize = () => {
    if (naturalSize.width === 0 || naturalSize.height === 0 || containerSize.width === 0 || containerSize.height === 0) {
      return { width: '100%', height: 'auto' };
    }

    const imgRatio = naturalSize.width / naturalSize.height;
    const containerRatio = containerSize.width / containerSize.height;

    let renderWidth, renderHeight;
    if (imgRatio > containerRatio) {
      // Image is wider than container ratio: fit to container width
      renderWidth = containerSize.width;
      renderHeight = containerSize.width / imgRatio;
    } else {
      // Image is taller than container ratio: fit to container height
      renderWidth = containerSize.height * imgRatio;
      renderHeight = containerSize.height;
    }

    return { 
      width: `${renderWidth}px`, 
      height: `${renderHeight}px` 
    };
  };

  const renderSize = getRenderSize();

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
    
    const drawLine = (l: DrawingLine) => {
      if (l.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = l.color;
      
      // Check if points are normalized (usually all points are in range [0..1.05])
      const isLineNormalized = !l.points.some(val => val > 1.05);

      // Scale line width proportionally to canvas size, using 500px as reference
      const referenceWidth = 500;
      const baseWidth = l.tool === 'eraser' ? 20 : 3;
      ctx.lineWidth = Math.max(1, baseWidth * (canvas.width / referenceWidth));
      
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      // Eraser uses destination-out to erase
      ctx.globalCompositeOperation = l.tool === 'eraser' ? 'destination-out' : 'source-over';
      
      const getX = (val: number) => isLineNormalized ? val * canvas.width : val;
      const getY = (val: number) => isLineNormalized ? val * canvas.height : val;

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
    
    lines.forEach(drawLine);
    if (currentLine) drawLine(currentLine);
  }, [lines, currentLine, canvasSize]);

  const getPointerPos = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    // Return relative coordinates normalized between 0 and 1
    return {
      x: rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0,
      y: rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0
    };
  };

  const startDrawing = (e: React.PointerEvent) => {
    if (!canEdit) return;
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation?.();
    setIsDrawing(true);
    const pos = getPointerPos(e);
    setCurrentLine({
      tool,
      color,
      points: [pos.x, pos.y]
    });
  };

  const draw = (e: React.PointerEvent) => {
    if (!isDrawing || !currentLine) return;
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation?.();
    const pos = getPointerPos(e);
    setCurrentLine({
      ...currentLine,
      points: [...currentLine.points, pos.x, pos.y]
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
    <div className="flex flex-col flex-1 min-h-0 relative" ref={containerRef} onPointerDown={e => e.stopPropagation()}>
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
      
      <div className="relative flex-1 min-h-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img 
          ref={imgRef}
          src={imageUrl} 
          alt="Map/Image" 
          onLoad={handleImageLoad}
          className="w-full h-full rounded pointer-events-none select-none object-contain" 
          referrerPolicy="no-referrer"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 cursor-crosshair touch-none no-pan"
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerLeave={stopDrawing}
        />
      </div>
    </div>
  );
}
