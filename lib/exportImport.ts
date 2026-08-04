/**
 * exportImport.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Pure helpers for Feature 06 — board export/import as JSON.
 *
 * The export format is the canonical `BoardExportFile` (see lib/types.ts):
 * unscrubbed server state, DM-only. Imports ALWAYS create a NEW board with all
 * item/connection/pin/cross-link ids remapped, so the imported board can
 * coexist with the source board on the same host.
 *
 * Everything in this module is pure (no DB, no I/O) → unit-testable.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { v4 as uuidv4 } from 'uuid';
import { BoardExportFile, BoardTab, Comment, ItemType, FieldType } from './types';
import { remapLinksInValue } from './crossref';
import { remapCardLinksInValue } from './cardLinks';

// ─────────────────────────────────────────────────────────────────────────────
// Validation constants (single source of truth)
// ─────────────────────────────────────────────────────────────────────────────

export const EXPORT_APP_ID = 'mythos-canvas';
export const EXPORT_SCHEMA_VERSION = 1;

/** Reject exports above this serialized size (Vercel function-body limits). */
export const MAX_EXPORT_BYTES = 15 * 1024 * 1024;
/** Reject imports above this body size. Note: on Vercel the platform itself
 *  rejects bodies > ~4.5 MB with an HTML 413 before this check ever runs —
 *  clients must treat a 413 / non-JSON response as "file too large". */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export const MAX_ID_LENGTH = 200;
export const MAX_TITLE_LENGTH = 200;
export const MAX_LABEL_LENGTH = 100;
export const MAX_CONTENT_LENGTH = 1024 * 1024;

const ITEM_TYPES: ReadonlySet<string> = new Set<ItemType>([
  'character', 'npc', 'faction', 'event', 'location', 'session',
  'quest', 'note', 'rule', 'loot', 'downtime', 'image',
]);

const FIELD_TYPES: ReadonlySet<string> = new Set<FieldType>(['text', 'image', 'file']);

// ─────────────────────────────────────────────────────────────────────────────
// Board id validation (shared by create-board and import)
// ─────────────────────────────────────────────────────────────────────────────

export const BOARD_ID_PATTERN = /^[a-z0-9-]+$/;

/** Trim + lowercase + validate; returns the clean id, or null when invalid. */
export function validateBoardId(id: string): string | null {
  const clean = id.trim().toLowerCase();
  if (!BOARD_ID_PATTERN.test(clean) || clean.length < 2 || clean.length > 48) return null;
  return clean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export interface BoardRowForExport {
  id: string;
  settings?: Record<string, unknown> | null;
  members?: Record<string, unknown> | null;
  tabs?: BoardTab[] | null;
}

/**
 * Build the canonical export payload from a `boards` row. The same SELECT
 * shape as the state GET; tabs are passed through unscrubbed and unmodified
 * (stable output aids diffing of backups).
 */
export function buildExportPayload(board: BoardRowForExport): BoardExportFile {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    app: EXPORT_APP_ID,
    board: {
      id: board.id,
      name: board.id,
      settings: (board.settings ?? {}) as BoardExportFile['board']['settings'],
      members: (board.members ?? {}) as BoardExportFile['board']['members'],
    },
    tabs: board.tabs ?? [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Import validation
// ─────────────────────────────────────────────────────────────────────────────

type ValidationResult =
  | { ok: true; payload: BoardExportFile }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown, maxLen: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen;
}

/**
 * Strictly validate an import payload. Rejects non-objects, wrong
 * app/schemaVersion, unknown ItemType/FieldType values, missing item
 * id/type/title, and over-length strings. Returns a typed payload on success
 * and a human-readable error otherwise.
 */
export function validateImportPayload(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'Import file is not a JSON object.' };
  }

  if (raw.app !== EXPORT_APP_ID) {
    return { ok: false, error: 'This file is not a Mythos Canvas board export.' };
  }

  if (raw.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > EXPORT_SCHEMA_VERSION) {
      return { ok: false, error: 'This file was exported by a newer version of Mythos Canvas. Please update the app and try again.' };
    }
    return { ok: false, error: `Unsupported export schema version (${String(raw.schemaVersion)}).` };
  }

  if (typeof raw.exportedAt !== 'string') {
    return { ok: false, error: 'Import file is missing the exportedAt timestamp.' };
  }

  const board = raw.board;
  if (!isPlainObject(board)) {
    return { ok: false, error: 'Import file is missing the board section.' };
  }
  if (typeof board.id !== 'string' || board.id.length === 0 || board.id.length > MAX_ID_LENGTH) {
    return { ok: false, error: 'Import file has an invalid board id.' };
  }
  if (typeof board.name !== 'string' || board.name.length === 0 || board.name.length > MAX_ID_LENGTH) {
    return { ok: false, error: 'Import file has an invalid board name.' };
  }
  if (!isPlainObject(board.settings)) {
    return { ok: false, error: 'Import file has invalid board settings.' };
  }
  if (!isPlainObject(board.members)) {
    return { ok: false, error: 'Import file has invalid board members.' };
  }

  const tabs = raw.tabs;
  if (!Array.isArray(tabs)) {
    return { ok: false, error: 'Import file is missing the tabs array.' };
  }

  for (let t = 0; t < tabs.length; t++) {
    const tab = tabs[t];
    if (!isPlainObject(tab)) {
      return { ok: false, error: `Tab ${t + 1} is not a valid object.` };
    }
    if (!isNonEmptyString(tab.id, MAX_ID_LENGTH)) {
      return { ok: false, error: `Tab ${t + 1} is missing a valid id.` };
    }
    if (!isNonEmptyString(tab.name, MAX_TITLE_LENGTH)) {
      return { ok: false, error: `Tab "${String(tab.id)}" is missing a valid name.` };
    }
    if (!Array.isArray(tab.items)) {
      return { ok: false, error: `Tab "${String(tab.id)}" is missing its items array.` };
    }
    if (!Array.isArray(tab.connections)) {
      return { ok: false, error: `Tab "${String(tab.id)}" is missing its connections array.` };
    }

    for (const item of tab.items) {
      const itemErr = validateItem(item);
      if (itemErr) return { ok: false, error: itemErr };
    }

    for (let c = 0; c < tab.connections.length; c++) {
      const conn = tab.connections[c];
      if (!isPlainObject(conn)) {
        return { ok: false, error: `Tab "${String(tab.id)}" has an invalid connection.` };
      }
      if (!isNonEmptyString(conn.fromId, MAX_ID_LENGTH) || !isNonEmptyString(conn.toId, MAX_ID_LENGTH)) {
        return { ok: false, error: `Tab "${String(tab.id)}" has a connection with missing endpoints.` };
      }
      if (typeof conn.label !== 'string' || conn.label.length > MAX_LABEL_LENGTH) {
        return { ok: false, error: `Tab "${String(tab.id)}" has a connection with an invalid label.` };
      }
    }

    if (tab.annotations !== undefined && !Array.isArray(tab.annotations)) {
      return { ok: false, error: `Tab "${String(tab.id)}" has an invalid annotations array.` };
    }
    for (const ann of Array.isArray(tab.annotations) ? tab.annotations : []) {
      if (!isPlainObject(ann)) {
        return { ok: false, error: `Tab "${String(tab.id)}" has an invalid annotation.` };
      }
      if (ann.pins !== undefined && !Array.isArray(ann.pins)) {
        return { ok: false, error: `Tab "${String(tab.id)}" has an invalid annotation pins array.` };
      }
      for (const pin of Array.isArray(ann.pins) ? ann.pins : []) {
        if (pin !== null) {
          if (!isPlainObject(pin) || !isNonEmptyString(pin.itemId, MAX_ID_LENGTH)) {
            return { ok: false, error: `Tab "${String(tab.id)}" has an annotation pin with an invalid item id.` };
          }
        }
      }
    }
  }

  return { ok: true, payload: raw as unknown as BoardExportFile };
}

function validateItem(item: unknown): string | null {
  if (!isPlainObject(item)) return 'Board contains an item that is not an object.';
  if (!isNonEmptyString(item.id, MAX_ID_LENGTH)) return 'Board contains an item without a valid id.';
  if (typeof item.type !== 'string' || !ITEM_TYPES.has(item.type)) {
    return `Item "${String(item.id)}" has an unknown type (${String(item.type)}).`;
  }
  if (!isNonEmptyString(item.title, MAX_TITLE_LENGTH)) {
    return `Item "${String(item.id)}" is missing a valid title.`;
  }
  if (typeof item.content !== 'string' || item.content.length > MAX_CONTENT_LENGTH) {
    return `Item "${String(item.id)}" has an invalid content field.`;
  }

  if (item.fields !== undefined && !Array.isArray(item.fields)) {
    return `Item "${String(item.id)}" has an invalid fields array.`;
  }
  for (const field of Array.isArray(item.fields) ? item.fields : []) {
    if (!isPlainObject(field)) return `Item "${String(item.id)}" has an invalid field.`;
    if (typeof field.id !== 'string' || field.id.length === 0 || field.id.length > MAX_ID_LENGTH) {
      return `Item "${String(item.id)}" has a field without a valid id.`;
    }
    if (typeof field.label !== 'string' || field.label.length > MAX_LABEL_LENGTH) {
      return `Item "${String(item.id)}" has a field with an invalid label.`;
    }
    if (typeof field.type !== 'string' || !FIELD_TYPES.has(field.type)) {
      return `Item "${String(item.id)}" has a field with an unknown type (${String(field.type)}).`;
    }
    if (typeof field.textValue === 'string' && field.textValue.length > MAX_CONTENT_LENGTH) {
      return `Item "${String(item.id)}" has a field that is too large.`;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client-side export download (shared by Board Settings and the delete-board
// confirm modal). Returns an error message, or null on success. Browser-only —
// never call this from a server route.
// ─────────────────────────────────────────────────────────────────────────────

export async function downloadBoardExport(boardId: string): Promise<string | null> {
  const res = await fetch(`/api/boards/${boardId}/export`);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    return data?.error || 'Failed to export board.';
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match?.[1] ?? `${boardId}-${new Date().toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Id remapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the mandatory old→new id map (uuidv4 per item across all tabs).
 * Import ALWAYS remaps — the source board may still exist on the same host,
 * so id collisions are real.
 */
export function buildIdMap(payload: BoardExportFile): Map<string, string> {
  const idMap = new Map<string, string>();
  for (const tab of payload.tabs) {
    for (const item of tab.items || []) {
      idMap.set(item.id, uuidv4());
    }
  }
  return idMap;
}

/**
 * Rewrite every item id plus every reference to one: connection endpoints,
 * annotation pins, cross-link tokens inside structured field values, and
 * Feature 10 card links inside rich-text slots (item content + field text
 * values, direct HTML or structured-JSON sub-values).
 * Tab ids are kept as-is (tabs are scoped to a board). Pins whose itemId has
 * no mapping are left untouched rather than silently dropped.
 */
export function remapBoardIds(payload: BoardExportFile, idMap: Map<string, string>): BoardExportFile {
  const remapItem = (item: BoardExportFile['tabs'][number]['items'][number]) => ({
    ...item,
    id: idMap.get(item.id) ?? item.id,
    content: item.content ? remapCardLinksInValue(item.content, idMap) : item.content,
    fields: (item.fields || []).map((f) =>
      f.textValue !== undefined
        ? { ...f, textValue: remapLinksInValue(remapCardLinksInValue(f.textValue, idMap), idMap) }
        : f
    ),
  });

  return {
    ...payload,
    tabs: payload.tabs.map((tab) => ({
      ...tab,
      items: (tab.items || []).map(remapItem),
      connections: (tab.connections || []).map((conn) => ({
        ...conn,
        fromId: idMap.get(conn.fromId) ?? conn.fromId,
        toId: idMap.get(conn.toId) ?? conn.toId,
      })),
      annotations: (tab.annotations || []).map((ann) => ({
        ...ann,
        pins: (ann.pins || []).map((pin) =>
          pin && idMap.has(pin.itemId) ? { ...pin, itemId: idMap.get(pin.itemId)! } : pin
        ),
      })),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Import row construction
// ─────────────────────────────────────────────────────────────────────────────

export interface ImporterUser {
  id: string;
  displayName: string;
}

export interface ImportPassword {
  hash: string;
  salt: string;
}

export interface ImportBoardRow {
  id: string;
  board_password_hash: string | null;
  board_password_salt: string | null;
  members: Record<string, { role: 'dm'; joinedAt: string }>;
  tabs: BoardTab[];
  settings: BoardExportFile['board']['settings'];
}

/**
 * Build the `boards` row for an import:
 *  - All ids remapped (via buildIdMap) so the new board can coexist with the source.
 *  - Ownership: every item AND annotation is adopted by the importer
 *    (avoids dangling references to users who don't exist in the new board;
 *    original names remain visible in comments).
 *  - Comments: kept with original display names; userId kept only when it
 *    belongs to the importer, else nulled.
 *  - Members: exactly one — the importer, role dm. File memberships are
 *    host-local and ignored.
 */
export function buildImportRow(
  payload: BoardExportFile,
  importer: ImporterUser,
  newBoardId: string,
  password: ImportPassword | null
): ImportBoardRow {
  const remapped = remapBoardIds(payload, buildIdMap(payload));

  const adoptComments = (comments: Comment[]): Comment[] =>
    (comments || []).map((c) => ({
      ...c,
      userId: c.userId === importer.id ? importer.id : null,
    }));

  const tabs: BoardTab[] = remapped.tabs.map((tab) => ({
    ...tab,
    items: (tab.items || []).map((item) => ({
      ...item,
      ownerId: importer.id,
      ownerName: importer.displayName,
      comments: adoptComments(item.comments),
    })),
    annotations: (tab.annotations || []).map((ann) => ({
      ...ann,
      ownerId: importer.id,
      ownerName: importer.displayName,
    })),
  }));

  return {
    id: newBoardId,
    board_password_hash: password?.hash ?? null,
    board_password_salt: password?.salt ?? null,
    members: { [importer.id]: { role: 'dm', joinedAt: new Date().toISOString() } },
    tabs,
    settings: payload.board.settings,
  };
}
