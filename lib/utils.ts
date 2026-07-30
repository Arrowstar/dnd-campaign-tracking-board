import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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

export async function uploadFileToBlob(file: File): Promise<string> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });
    if (res.ok) {
      const data = await res.json();
      if (data.url) return data.url;
      // Server responded 200 but gave no URL — this is the
      // BLOB_READ_WRITE_TOKEN-missing case from app/api/upload/route.ts.
      console.error(
        '[uploadFileToBlob] /api/upload returned no URL — falling back to embedding this image as base64, ' +
          'which will bloat the saved board. Check that BLOB_READ_WRITE_TOKEN is set on Vercel and redeploy. ' +
          'Server said:',
        data.warning || data
      );
    } else {
      const detail = await res.text().catch(() => '');
      console.error(
        `[uploadFileToBlob] /api/upload failed (${res.status}) — falling back to embedding this image as base64, ` +
          'which will bloat the saved board:',
        detail
      );
    }
  } catch (err) {
    console.error(
      '[uploadFileToBlob] Request to /api/upload threw — falling back to embedding this image as base64, ' +
        'which will bloat the saved board:',
      err
    );
  }
  return fileToCompressedDataURL(file);
}
