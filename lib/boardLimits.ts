/**
 * boardLimits.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Shared board-size thresholds (Feature 12). Used by both the client (Board.tsx
 * hard block + warning) and the server (state-save route 413) so the limits
 * never drift apart.
 * ──────────────────────────────────────────────────────────────────────────────
 */

/** Client hard block: saves whose serialized tabs exceed this are refused before the fetch. */
export const CLIENT_MAX_SAVE_BYTES = 4 * 1024 * 1024;

/** Server hard block: state POST bodies above this are rejected with 413. */
export const SERVER_MAX_SAVE_BYTES = 4.5 * 1024 * 1024;

/** DM warning threshold: above this, the board surfaces the "getting large" notice. */
export const WARN_SAVE_BYTES = 2 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
