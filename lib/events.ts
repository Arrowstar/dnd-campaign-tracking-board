/**
 * events.ts — Server-Sent Events protocol for board live updates (Feature 12,
 * Phase 3). Replaces the 3 s revision poller with a push stream; the poller
 * stays as a slow fallback (kick detection, recovery after auth failures).
 *
 * The stream is a "push-ish" design that survives serverless: the route holds
 * the response open and re-checks `boards.updated_at` every SSE_POLL_MS; when
 * it changes it emits a `revision` event carrying the new revision. The client
 * then refetches full state through the existing `GET /state?since=` path, so
 * the state-handling code never changes. A fresh stream always emits the
 * current revision first, so reconnects catch up without Last-Event-ID.
 */

export const SSE_REVISION_EVENT = 'revision';
export const SSE_RECYCLE_EVENT = 'recycle';

/** Server: how often the stream re-checks boards.updated_at. */
export const SSE_POLL_MS = 1000;
/** Server: keepalive comment cadence (defeats proxy idle timeouts). */
export const SSE_HEARTBEAT_MS = 20000;
/** Server: how long before the function duration cap the stream ends. */
export const SSE_CLOSE_GRACE_S = 5;

/** Serializes a revision value (Date or ISO string) for the wire. */
export function serializeRevision(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) return value;
  return null;
}

/** Builds an `event: <name>\ndata: <data>\n\n` frame (SSE spec). */
export function buildSseEventFrame(event: string, data: string): string {
  // Multi-line data becomes one `data:` line per line; revisions are
  // single-line ISO timestamps, so this is defensive only.
  const normalized = data.replace(/\r\n|\r|\n/g, '\n');
  return `event: ${event}\ndata: ${normalized.split('\n').join('\ndata: ')}\n\n`;
}

/** Builds a `: keepalive\n\n` comment frame (invisible to the client). */
export function buildSseHeartbeat(): string {
  return ': keepalive\n\n';
}
