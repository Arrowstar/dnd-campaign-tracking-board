import { put } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server';

const MAX_FILE_BYTES = 40 * 1024 * 1024; // 40 MB

export async function POST(request: NextRequest): Promise<NextResponse> {
  const contentType = request.headers.get('content-type') || '';

  // Client-side upload ("handle upload") flow. The browser asks this route for
  // a short-lived client token, then streams the file bytes DIRECTLY to Blob
  // storage — the payload never passes through this function's request body, so
  // it is not subject to the platform's per-request body limit (~4.5 MB) that
  // otherwise rejects uploads with a bare "HTTP 413".
  if (contentType.includes('application/json')) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.warn('BLOB_READ_WRITE_TOKEN is missing. Returning error.');
      return NextResponse.json(
        {
          error: 'Blob storage is not configured (BLOB_READ_WRITE_TOKEN is missing). Uploads are disabled until it is set.',
        },
        { status: 500 }
      );
    }

    try {
      const body = (await request.json()) as HandleUploadBody;
      const jsonResponse = await handleUpload({
        token: process.env.BLOB_READ_WRITE_TOKEN,
        request,
        body,
        onBeforeGenerateToken: async () => ({
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: true,
        }),
      });
      return NextResponse.json(jsonResponse);
    } catch (error: any) {
      console.error('Error handling client upload:', error);
      const message = error?.message || 'Upload failed';
      if (String(message).includes('too large') || String(message).includes('413')) {
        return NextResponse.json(
          { error: `File is too large. Maximum upload size is ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.` },
          { status: 413 }
        );
      }
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  // ── Legacy direct (server) upload ─────────────────────────────────────────
  // Kept for backward compatibility / callers that POST FormData. Because the
  // bytes traverse this function's request body, this path is capped at sizes
  // the platform will accept; large files should go through the client flow.
  try {
    let fileToUpload: File | null = null;
    let fileName = 'upload-' + Date.now();

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (file) {
        fileToUpload = file;
        fileName = file.name || fileName;
      }
    }

    if (!fileToUpload) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (fileToUpload.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `File is too large (${(fileToUpload.size / (1024 * 1024)).toFixed(1)} MB). Maximum upload size is ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`,
        },
        { status: 413 }
      );
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.warn('BLOB_READ_WRITE_TOKEN is missing. Returning error.');
      return NextResponse.json(
        {
          error: 'Blob storage is not configured (BLOB_READ_WRITE_TOKEN is missing). Uploads are disabled until it is set.',
        },
        { status: 500 }
      );
    }

    const blob = await put(fileName, fileToUpload, {
      access: 'public',
      addRandomSuffix: true,
    });

    return NextResponse.json(blob);
  } catch (error: any) {
    console.error('Error uploading to Vercel Blob:', error);

    const message = error?.message || 'Upload to blob storage failed';
    if (String(message).includes('too large') || String(message).includes('413')) {
      return NextResponse.json(
        { error: 'File is too large to upload to blob storage.' },
        { status: 413 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}