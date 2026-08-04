import { put } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { MAX_FILE_BYTES } from '@/lib/utils';

/**
 * Content types the app actually uses for uploads (board images, portraits,
 * attached documents). SVG is deliberately excluded — SVG can carry script
 * content and is not worth the risk (Security-Audit.md medium #5).
 */
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf']);

function mimeFromExtension(filename: string): string | null {
  const ext = filename.toLowerCase().match(/(\.[a-z0-9]+)$/)?.[1];
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) return null;
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.pdf': return 'application/pdf';
    default: return null;
  }
}

/** Whether the caller is a member (player or DM) of the given board. */
async function isBoardMember(userId: string, boardId: string): Promise<boolean> {
  if (!boardId) return false;
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`SELECT members FROM boards WHERE id = ${boardId} LIMIT 1`;
  if (rows.length === 0) return false;
  const members = (rows[0] as { members?: Record<string, unknown> }).members || {};
  return !!members[userId];
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Uploads require a valid session AND board membership — nobody can use this
  // route (and the blob storage behind it) anonymously (Security-Audit.md
  // medium #5). Note: on the client-upload flow this function only sees the
  // token-issuance / completion handshakes; the file bytes stream straight to
  // Blob storage, so auth is enforced here at token issuance, not per byte.
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

      // Token issuance is the real gate: verify board membership + file type
      // before letting the client upload anything.
      if (body.type === 'blob.generate-client-token') {
        let boardId = '';
        try {
          const payload = body.payload.clientPayload ? JSON.parse(body.payload.clientPayload) : null;
          boardId = typeof payload?.boardId === 'string' ? payload.boardId : '';
        } catch {
          boardId = '';
        }
        if (!boardId || !(await isBoardMember(user.id, boardId))) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (!mimeFromExtension(body.payload.pathname)) {
          return NextResponse.json(
            { error: 'File type not allowed. Upload images (PNG/JPEG/WebP/GIF) or PDFs only.' },
            { status: 415 }
          );
        }
      }

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
    let boardId = '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (file) {
        fileToUpload = file;
        fileName = file.name || fileName;
      }
      const boardField = formData.get('boardId');
      if (typeof boardField === 'string') boardId = boardField;
    }

    if (!boardId || !(await isBoardMember(user.id, boardId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!fileToUpload) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // Validate content type — reject anything outside the allowlist even when
    // the browser claims a clean MIME type.
    const declaredType = (fileToUpload.type || '').toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(declaredType)) {
      return NextResponse.json(
        { error: 'File type not allowed. Upload images (PNG/JPEG/WebP/GIF) or PDFs only.' },
        { status: 415 }
      );
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
