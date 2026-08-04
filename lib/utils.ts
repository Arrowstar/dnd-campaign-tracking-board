import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { upload as uploadFileToBlobStore } from "@vercel/blob/client"
import type { CSSProperties } from 'react'
import type { DrawingLine, CropRect } from './types'

export type { CropRect } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface ImageRenderRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute the rectangle (in container CSS pixels) where an image is actually
 * rendered inside its container for a given object-fit / object-position,
 * so annotations can be mapped onto the visible image area instead of the
 * whole container (which may include letterbox or crop padding).
 */
export function getImageRenderRect(
  containerWidth: number,
  containerHeight: number,
  naturalWidth: number,
  naturalHeight: number,
  fit: 'contain' | 'cover' = 'contain',
  alignY: 'center' | 'top' = 'center',
): ImageRenderRect {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return { x: 0, y: 0, width: containerWidth, height: containerHeight };
  }
  const scale =
    fit === 'contain'
      ? Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight)
      : Math.max(containerWidth / naturalWidth, containerHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: alignY === 'top' ? 0 : (containerHeight - height) / 2,
    width,
    height,
  };
}

export interface CroppedImageGeometry {
  /** CSS for the absolutely positioned <img> (its box keeps the image's aspect). */
  imgStyle: CSSProperties;
  /** Realized rectangle (in container CSS px) where the crop region is displayed. */
  rect: ImageRenderRect;
  /** Aspect ratio (w / h) of the crop region. */
  regionAspect: number;
}

/**
 * Compute exact display geometry for a mask-only crop.
 *
 * The crop region is treated as if it were its own image (aspect
 * `regionAspect`) and fit into the container with the given `fit` semantics —
 * exactly what a real cropped blob displayed with `object-fit` would do. The
 * returned `imgStyle` positions the ORIGINAL image so that only the kept
 * rectangle is visible, clipped with `clip-path` to the realized rect
 * (letterbox margins around the region stay blank). No distortion: the image
 * element's box always has the image's own aspect ratio.
 */
export function getCroppedImageGeometry(
  containerWidth: number,
  containerHeight: number,
  naturalWidth: number,
  naturalHeight: number,
  crop: CropRect,
  fit: 'contain' | 'cover' = 'contain',
  alignY: 'center' | 'top' = 'center',
): CroppedImageGeometry | null {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    crop.width <= 0 ||
    crop.height <= 0
  ) {
    return null;
  }

  const regionWidth = naturalWidth * crop.width;
  const regionHeight = naturalHeight * crop.height;
  const rect = getImageRenderRect(containerWidth, containerHeight, regionWidth, regionHeight, fit, alignY);
  const scale = rect.width / regionWidth;
  const imgWidth = naturalWidth * scale;
  const imgHeight = naturalHeight * scale;
  const left = rect.x - crop.x * imgWidth;
  const top = rect.y - crop.y * imgHeight;

  return {
    imgStyle: {
      position: 'absolute',
      top,
      left,
      width: imgWidth,
      height: imgHeight,
      maxWidth: 'none',
      maxHeight: 'none',
      clipPath: `inset(${Math.max(0, rect.y - top)}px ${Math.max(0, left + imgWidth - (rect.x + rect.width))}px ${
        Math.max(0, top + imgHeight - (rect.y + rect.height))
      }px ${Math.max(0, rect.x - left)}px)`,
    },
    rect,
    regionAspect: regionWidth / regionHeight,
  };
}

/** True when there is no meaningful mask (absent, null, or covering ~everything). */
export function isFullCrop(crop?: CropRect | null): boolean {
  return (
    !crop ||
    (crop.x <= 0.0001 &&
      crop.y <= 0.0001 &&
      crop.width >= 0.9999 &&
      crop.height >= 0.9999)
  );
}

/**
 * Map a point from the ORIGINAL image's normalized space into a normalized
 * crop (mask) space (0..1 within the kept rectangle). Out-of-crop points land
 * outside the 0..1 range and should be dropped by callers.
 */
export function pointToCropSpace(x: number, y: number, crop: CropRect): { x: number; y: number } {
  return {
    x: (x - crop.x) / crop.width,
    y: (y - crop.y) / crop.height,
  };
}

/** Inverse of {@link pointToCropSpace}: crop-space coords back into original space. */
export function pointFromCropSpace(x: number, y: number, crop: CropRect): { x: number; y: number } {
  return {
    x: crop.x + x * crop.width,
    y: crop.y + y * crop.height,
  };
}

/**
 * Remap drawing annotations (normalized to the full image) into a new
 * coordinate space. `cropRect` expresses the desired crop as normalized
 * offsets within the ORIGINAL image (e.g. from ImageCropModal). Points
 * outside the crop region are dropped; surviving lines keep the shorthand
 * [x0,y0,x1,y1,...] format and are re-normalized/clamped to 0..1.
 *
 * When the crop covers the entire image (no-op) the original lines array is
 * returned unchanged so no accidental mutation/rewrites happen.
 */
export function transformLinesForCrop(lines: DrawingLine[] | undefined, cropRect: CropRect): DrawingLine[] | undefined {
  if (!lines || lines.length === 0) return lines;
  const { x, y, width, height } = cropRect;

  const almostFull =
    x <= 0.0001 &&
    y <= 0.0001 &&
    width >= 0.9999 &&
    height >= 0.9999;
  if (almostFull) return lines;

  const out: DrawingLine[] = [];
  for (const line of lines) {
    const pts = line.points;
    if (!pts || pts.length < 2) continue;
    const newPts: number[] = [];
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const px = pts[i];
      const py = pts[i + 1];
      if (px < x || px > x + width || py < y || py > y + height) continue;
      newPts.push(
        Math.min(1, Math.max(0, (px - x) / width)),
        Math.min(1, Math.max(0, (py - y) / height)),
      );
    }
    if (newPts.length >= 2) {
      out.push({ ...line, points: newPts });
    }
  }
  return out;
}

export function fileToCompressedDataURL(file: File, maxWidth = 1920, maxHeight = 1920, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      if (!src) {
        reject(new Error('Failed to read file'));
        return;
      }
      if (file.type === 'image/svg+xml' || file.size < 200 * 1024) {
        resolve(src);
        return;
      }
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(src);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(mimeType, quality));
      };
      img.onerror = () => resolve(src);
      img.src = src;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

export interface UploadFileOptions {
  /**
   * The board the upload belongs to. Required — the server verifies the
   * caller is a member of this board before issuing an upload token
   * (Security-Audit.md medium #5).
   */
  boardId: string;
  /** Called periodically with the upload progress as a percentage (0–100). */
  onProgress?: (percent: number) => void;
}

const MAX_FILE_BYTES = 40 * 1024 * 1024; // must match app/api/upload/route.ts

/**
 * Uploads a file directly from the browser to blob storage (Vercel Blob) and
 * resolves with the public URL.
 *
 * Uses @vercel/blob/client's `upload` with a `handleUploadUrl` pointing at
 * /api/upload. The browser first asks that route for a short-lived client token
 * and then streams the file bytes straight to Blob Storage — the file never
 * passes through the function's request body, so files far larger than the
 * ~4.5 MB platform limit (which caused "Upload failed (HTTP 413)") work fine.
 * Progress is reported through `onProgress`.
 *
 * On success the URL is returned; on any failure this throws — there is
 * deliberately NO base64/data-URL fallback, because embedding raw file bytes
 * (e.g. a large PDF) into board JSON can exceed the safe save size and bloat
 * the database. Callers surface the thrown error to the user instead.
 */
export async function uploadFileToBlob(file: File, options: UploadFileOptions): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum upload size is ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`
    );
  }

  const blob = await uploadFileToBlobStore(file.name || 'upload', file as Blob, {
    access: 'public',
    handleUploadUrl: '/api/upload',
    contentType: file.type || undefined,
    clientPayload: JSON.stringify({ boardId: options.boardId }),
    onUploadProgress: (event) => {
      if (options?.onProgress) {
        options.onProgress(Math.max(0, Math.min(100, Math.round(event.percentage ?? 0))));
      }
    },
  });

  return blob.url;
}
