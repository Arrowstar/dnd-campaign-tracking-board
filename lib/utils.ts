import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { upload as uploadFileToBlobStore } from "@vercel/blob/client"

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
export async function uploadFileToBlob(file: File, options?: UploadFileOptions): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum upload size is ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`
    );
  }

  const blob = await uploadFileToBlobStore(file.name || 'upload', file as Blob, {
    access: 'public',
    handleUploadUrl: '/api/upload',
    contentType: file.type || undefined,
    onUploadProgress: (event) => {
      if (options?.onProgress) {
        options.onProgress(Math.max(0, Math.min(100, Math.round(event.percentage ?? 0))));
      }
    },
  });

  return blob.url;
}
