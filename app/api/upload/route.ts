import { put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';

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

    // Check if token is available
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.warn('BLOB_READ_WRITE_TOKEN is missing. Returning local fallback.');
      return NextResponse.json({
        url: '',
        warning: 'BLOB_READ_WRITE_TOKEN missing. Connect Vercel Blob on Vercel.'
      });
    }

    const blob = await put(fileName, fileToUpload, {
      access: 'public',
    });

    return NextResponse.json(blob);
  } catch (error: any) {
    console.error('Error uploading to Vercel Blob:', error);
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
}
