import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { isTokenUsable, ShareRow } from '@/lib/shareTokens';
import {
  buildSseEventFrame,
  buildSseHeartbeat,
  serializeRevision,
  SSE_HEARTBEAT_MS,
  SSE_POLL_MS,
  SSE_CLOSE_GRACE_S,
  SSE_REVISION_EVENT,
  SSE_RECYCLE_EVENT,
} from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Function duration cap. 60 s is the Hobby-plan maximum (Vercel rejects higher
// values on Hobby); Pro can raise this to 300 for fewer reconnects — the
// client handles the `recycle` close transparently either way. The value must
// be a literal here: route segment config has to be statically analyzable.
export const maxDuration = 60;

/**
 * Feature 12 / Phase 3 — push board updates over Server-Sent Events.
 *
 * The stream stays open for (maxDuration - grace) and re-checks
 * `boards.updated_at` every second; when it changes it emits a `revision`
 * event carrying the new revision, and the client refetches full state through
 * the existing `GET /state?since=` path. Every connect emits the current
 * revision first, so reconnects catch up instantly without Last-Event-ID. The
 * stream ends with a `recycle` event just before the duration cap, which the
 * client treats as a graceful close.
 *
 * Auth branches mirror the revision endpoint: session cookie for members, or a
 * share token in the query string (EventSource can't set headers). Failures
 * are plain JSON — EventSource never sees status codes, so the client's
 * fallback revision poller carries the kick/expiry detection instead.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const { boardId } = await params;
    await ensureSchema();
    const sql = getSql();

    const shareToken = request.nextUrl.searchParams.get('shareToken');
    if (shareToken) {
      const shareRows = (await sql`
        SELECT token, board_id, label, created_at, expires_at
        FROM board_shares WHERE token = ${shareToken} AND board_id = ${boardId} LIMIT 1
      `) as ShareRow[];
      const share = shareRows[0];
      if (!share || !isTokenUsable(share)) {
        return NextResponse.json({ error: 'This link is no longer active.' }, { status: 403 });
      }
    } else {
      const user = await getAuthUser(request);
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const rows = await sql`SELECT members FROM boards WHERE id = ${boardId} LIMIT 1`;
      if (rows.length === 0) return NextResponse.json({ error: 'Board not found.' }, { status: 404 });
      const member = rows[0].members?.[user.id];
      if (!member) {
        return NextResponse.json({ error: 'You are not a member of this board.' }, { status: 403 });
      }
    }

    const rows = await sql`SELECT updated_at FROM boards WHERE id = ${boardId} LIMIT 1`;
    if (rows.length === 0) return NextResponse.json({ error: 'Board not found.' }, { status: 404 });
    const initialRevision = serializeRevision(rows[0].updated_at);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        let lastSent = initialRevision;
        let pollTimer: ReturnType<typeof setInterval> | null = null;
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

        const teardown = () => {
          if (pollTimer) clearInterval(pollTimer);
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          pollTimer = null;
          heartbeatTimer = null;
        };
        const send = (frame: string) => {
          if (closed) return;
          try {
            controller.enqueue(new TextEncoder().encode(frame));
          } catch {
            // Client went away — the abort listener below runs the cleanup.
          }
        };
        const close = () => {
          if (closed) return;
          closed = true;
          teardown();
          try {
            controller.close();
          } catch {
            // Stream already terminated by the client disconnect.
          }
        };
        request.signal.addEventListener('abort', close);

        // Always emit the current revision on connect: the client ignores it
        // when it already has it, and it catches the stream up after any gap.
        if (initialRevision) {
          send(buildSseEventFrame(SSE_REVISION_EVENT, initialRevision));
        }
        console.log(
          `[scalability] events connect boardId=${boardId} share=${!!shareToken} revision=${initialRevision ?? 'null'}`
        );

        const deadline = Date.now() + (maxDuration - SSE_CLOSE_GRACE_S) * 1000;

        pollTimer = setInterval(async () => {
          if (closed) return;
          // End the stream just before the function duration cap; the client
          // reconnects immediately on `recycle`.
          if (Date.now() >= deadline) {
            send(buildSseEventFrame(SSE_RECYCLE_EVENT, '1'));
            close();
            return;
          }
          try {
            const polled = await sql`SELECT updated_at FROM boards WHERE id = ${boardId} LIMIT 1`;
            const revision = serializeRevision(polled[0]?.updated_at);
            if (revision && revision !== lastSent) {
              lastSent = revision;
              send(buildSseEventFrame(SSE_REVISION_EVENT, revision));
              console.log(`[scalability] events emit boardId=${boardId} revision=${revision}`);
            }
          } catch (err) {
            console.error('SSE revision poll error:', err);
          }
        }, SSE_POLL_MS);

        heartbeatTimer = setInterval(() => send(buildSseHeartbeat()), SSE_HEARTBEAT_MS);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('Board events error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
