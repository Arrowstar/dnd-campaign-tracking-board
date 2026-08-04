import { useEffect, useRef } from 'react';
import { FALLBACK_POLL_INTERVAL_MS } from './viewNavigation';
import { SSE_REVISION_EVENT, SSE_RECYCLE_EVENT } from './events';

export type RealtimeHandlers = {
  /** Called with the board revision whenever it changes (or on reconnect catch-up). */
  onRevision: (revision: string) => void;
  /** Slow fallback poll. Return true when the board is still reachable. */
  onFallbackPoll: () => Promise<boolean>;
};

/**
 * useBoardRealtime — Feature 12 / Phase 3.
 *
 * Replaces the 3 s revision poller with an SSE stream (`/boards/:id/events`)
 * that pushes the board revision whenever it changes. The slow
 * FALLBACK_POLL_INTERVAL_MS poller stays behind it:
 *
 *  - kick / expiry detection: EventSource exposes no HTTP status codes, so a
 *    403/404 on the stream is invisible to it — the fallback hits the revision
 *    endpoint, which answers 403/404, and the caller redirects.
 *  - recovery: if the stream gives up after repeated errors, a successful
 *    fallback poll reopens it.
 *  - background tabs: focus/visibility trigger an immediate fallback poll.
 *
 * The server ends each stream with a `recycle` event just before its function
 * duration cap; the client treats that as a graceful close and reconnects
 * right away. Every new stream emits the current revision first, so reconnects
 * catch up without Last-Event-ID.
 *
 * `handlers` may be a fresh object every render: it is stashed into a ref
 * (updated in an effect, per the react-hooks/refs rule) so the stream effect
 * depends only on `enabled`/`url` and never churns, while listeners always
 * call the latest handlers.
 */
export function useBoardRealtime(options: {
  enabled: boolean;
  url: string;
  handlers: RealtimeHandlers;
}): void {
  const { enabled, url, handlers } = options;
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let es: EventSource | null = null;
    let reopenTimer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveErrors = 0;

    const openStream = () => {
      if (cancelled || es) return;
      es = new EventSource(url);
      es.addEventListener(SSE_REVISION_EVENT, (e) => {
        consecutiveErrors = 0;
        handlersRef.current.onRevision((e as MessageEvent<string>).data);
      });
      es.addEventListener(SSE_RECYCLE_EVENT, () => {
        // Graceful close: the server ended the stream on purpose just before
        // its duration cap. Reconnect immediately so the next stream covers
        // the gap (the reconnect emits the current revision for catch-up).
        consecutiveErrors = 0;
        es?.close();
        es = null;
        reopenTimer = setTimeout(openStream, 300);
      });
      es.onerror = () => {
        consecutiveErrors += 1;
        if (consecutiveErrors > 3) {
          // Persistent failure (kick, board gone, network down): stop
          // reopening. A successful fallback poll reopens the stream.
          es?.close();
          es = null;
        }
      };
    };

    const fallbackPoll = async () => {
      if (cancelled) return;
      const ok = await handlersRef.current.onFallbackPoll();
      if (!cancelled && ok && !es) openStream();
    };

    openStream();
    const intervalId = setInterval(fallbackPoll, FALLBACK_POLL_INTERVAL_MS);
    const onFocus = () => fallbackPoll();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') fallbackPoll();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      if (reopenTimer) clearTimeout(reopenTimer);
      clearInterval(intervalId);
      es?.close();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, url]);
}
