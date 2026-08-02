import { put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';

const MAX_FILE_BYTES = 40 * 1024 * 1024; // 40 MB

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const contentType = request.headers.get('content-type') || '';

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

    // Check if token is available
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

    // Prefer a concise, user-facing message over a raw stack/status leak.
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
