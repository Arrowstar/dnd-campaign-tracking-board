import { describe, it, expect } from 'vitest';
import {
  buildExportPayload,
  validateImportPayload,
  buildIdMap,
  remapBoardIds,
  buildImportRow,
  MAX_TITLE_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_CONTENT_LENGTH,
} from './exportImport';
import { remapLinksInValue } from './crossref';
import { BoardExportFile, BoardItem } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

let idCounter = 0;
function makeItem(overrides: Partial<BoardItem> = {}): BoardItem {
  idCounter += 1;
  return {
    id: `item-${idCounter}`,
    type: 'npc',
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    title: 'Test Item',
    content: '',
    date: '2026-01-01',
    color: '#000',
    tags: [],
    visibility: 'all',
    ownerId: 'u-1',
    ownerName: 'DM One',
    comments: [],
    ...overrides,
  };
}

function makePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    schemaVersion: 1,
    exportedAt: '2026-08-03T12:00:00.000Z',
    app: 'mythos-canvas',
    board: {
      id: 'my-world',
      name: 'my-world',
      settings: { cardFontScale: 1.1, tagDefs: { gold: { color: '#FFD700' } } },
      members: { 'u-1': { role: 'dm', joinedAt: '2026-01-01T00:00:00.000Z' } },
    },
    tabs: [
      {
        id: 'default-tab',
        name: 'Main Board',
        color: '#3B82F6',
        items: [makeItem({ id: 'item-a', title: 'Zog' })],
        connections: [{ id: 'conn-1', fromId: 'item-a', toId: 'item-b', label: 'hates', color: '#EF4444', style: 'solid' }],
        annotations: [
          { id: 'ann-1', type: 'text', x: 10, y: 20, text: 'mark', pins: [{ itemId: 'item-a', offsetX: 0.5, offsetY: 0.5 }, null] },
        ],
      },
    ],
  };
  return { ...base, ...overrides };
}

function validPayload(): Record<string, unknown> {
  return makePayload();
}

// Normalize a payload for structural diffing: drops everything that is
// intentionally different across an export → import → export round trip
// (ids, exportedAt, board id/name, ownership), including ids embedded in
// cross-link token strings.
function tokenIdsToTitles(value: string): string {
  if (!value) return value;
  try {
    if (value.startsWith('@@MULTILINK:')) {
      const tokens = JSON.parse(value.slice('@@MULTILINK:'.length)) as any[];
      return '@@MULTILINK:' + JSON.stringify(
        tokens.map((t) => (t.type === 'link' ? { type: 'link', title: t.title, itemType: t.itemType } : t))
      );
    }
    if (value.startsWith('@@LINK:')) {
      const ref = JSON.parse(value.slice('@@LINK:'.length)) as { title: string; type: string };
      return '@@LINK:' + JSON.stringify({ title: ref.title, type: ref.type });
    }
  } catch {
    // leave as-is
  }
  return value;
}

function extractStructure(payload: BoardExportFile): unknown {
  return {
    settings: payload.board.settings,
    tabs: payload.tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      color: tab.color,
      items: (tab.items || []).map((item) => ({
        type: item.type,
        title: item.title,
        content: item.content,
        tags: item.tags,
        fields: (item.fields || []).map((f) => ({
          id: f.id,
          label: f.label,
          type: f.type,
          textValue: f.textValue !== undefined ? tokenIdsToTitles(f.textValue) : undefined,
        })),
        comments: (item.comments || []).map((c) => c.userName),
      })),
      connections: (tab.connections || []).map((c) => ({ label: c.label, color: c.color, style: c.style })),
      annotations: (tab.annotations || []).map((a) => ({
        type: a.type,
        text: a.text,
        pins: (a.pins || []).map((p) => (p ? { x: p.offsetX, y: p.offsetY } : null)),
      })),
    })),
  };
}

// ─── buildExportPayload ──────────────────────────────────────────────────────

describe('buildExportPayload', () => {
  it('wraps a board row in the canonical format', () => {
    const row = {
      id: 'my-world',
      settings: { cardFontScale: 1.2 },
      members: { 'u-1': { role: 'dm', joinedAt: '2026-01-01T00:00:00.000Z' } },
      tabs: [{ id: 'default-tab', name: 'Main Board', color: '#3B82F6', items: [], connections: [] }],
    };
    const payload = buildExportPayload(row as any);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.app).toBe('mythos-canvas');
    expect(payload.board.id).toBe('my-world');
    expect(payload.board.name).toBe('my-world');
    expect(payload.board.settings).toEqual({ cardFontScale: 1.2 });
    expect(payload.board.members).toEqual(row.members);
    expect(payload.tabs).toEqual(row.tabs);
    expect(new Date(payload.exportedAt).toString()).not.toBe('Invalid Date');
  });

  it('defaults missing settings/members/tabs', () => {
    const payload = buildExportPayload({ id: 'x' } as any);
    expect(payload.board.settings).toEqual({});
    expect(payload.board.members).toEqual({});
    expect(payload.tabs).toEqual([]);
  });

  it('keeps tabs in original order', () => {
    const payload = buildExportPayload({
      id: 'x',
      tabs: [
        { id: 't2', name: 'B', items: [], connections: [] },
        { id: 't1', name: 'A', items: [], connections: [] },
      ],
    } as any);
    expect(payload.tabs.map((t) => t.id)).toEqual(['t2', 't1']);
  });
});

// ─── validateImportPayload ───────────────────────────────────────────────────

describe('validateImportPayload', () => {
  it('accepts a well-formed payload', () => {
    const result = validateImportPayload(validPayload());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.board.id).toBe('my-world');
  });

  it('accepts extra top-level fields (newBoardId / boardPassword)', () => {
    const result = validateImportPayload({ ...validPayload(), newBoardId: 'clone', boardPassword: 'secret' });
    expect(result.ok).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(validateImportPayload('hello').ok).toBe(false);
    expect(validateImportPayload(null).ok).toBe(false);
    expect(validateImportPayload([]).ok).toBe(false);
    expect(validateImportPayload(42).ok).toBe(false);
  });

  it('rejects a file from another app', () => {
    const result = validateImportPayload({ ...validPayload(), app: 'other-app' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a Mythos Canvas board export/);
  });

  it('rejects newer schema versions with a loud error', () => {
    const result = validateImportPayload({ ...validPayload(), schemaVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/newer version/);
  });

  it('rejects unsupported schema versions', () => {
    expect(validateImportPayload({ ...validPayload(), schemaVersion: 0 }).ok).toBe(false);
    expect(validateImportPayload({ ...validPayload(), schemaVersion: 'v1' }).ok).toBe(false);
  });

  it('rejects a missing board section', () => {
    const { board, ...rest } = validPayload();
    const result = validateImportPayload(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/board section/);
  });

  it('rejects missing tabs', () => {
    const payload = validPayload() as any;
    delete payload.tabs;
    expect(validateImportPayload(payload).ok).toBe(false);
  });

  it('rejects unknown item types', () => {
    const payload = validPayload() as any;
    payload.tabs[0].items[0].type = 'starship';
    const result = validateImportPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unknown type \(starship\)/);
  });

  it('rejects unknown field types', () => {
    const payload = validPayload() as any;
    payload.tabs[0].items[0].fields = [{ id: 'f1', label: 'Video', type: 'video' }];
    const result = validateImportPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unknown type \(video\)/);
  });

  it('rejects items missing id/type/title', () => {
    const noId = validPayload() as any;
    noId.tabs[0].items[0].id = '';
    expect(validateImportPayload(noId).ok).toBe(false);

    const noTitle = validPayload() as any;
    noTitle.tabs[0].items[0].title = '';
    expect(validateImportPayload(noTitle).ok).toBe(false);

    const noType = validPayload() as any;
    delete noType.tabs[0].items[0].type;
    expect(validateImportPayload(noType).ok).toBe(false);
  });

  it('rejects over-length strings', () => {
    const longTitle = validPayload() as any;
    longTitle.tabs[0].items[0].title = 'x'.repeat(MAX_TITLE_LENGTH + 1);
    expect(validateImportPayload(longTitle).ok).toBe(false);

    const longLabel = validPayload() as any;
    longLabel.tabs[0].items[0].fields = [{ id: 'f1', label: 'x'.repeat(MAX_LABEL_LENGTH + 1), type: 'text' }];
    expect(validateImportPayload(longLabel).ok).toBe(false);

    const longContent = validPayload() as any;
    longContent.tabs[0].items[0].content = 'x'.repeat(MAX_CONTENT_LENGTH + 1);
    expect(validateImportPayload(longContent).ok).toBe(false);
  });

  it('rejects connections with missing endpoints and oversized labels', () => {
    const badConn = validPayload() as any;
    badConn.tabs[0].connections[0].fromId = '';
    expect(validateImportPayload(badConn).ok).toBe(false);

    const longLabel = validPayload() as any;
    longLabel.tabs[0].connections[0].label = 'x'.repeat(MAX_LABEL_LENGTH + 1);
    expect(validateImportPayload(longLabel).ok).toBe(false);
  });

  it('rejects bad annotation pins', () => {
    const payload = validPayload() as any;
    payload.tabs[0].annotations[0].pins = [{ itemId: '', offsetX: 0.5, offsetY: 0.5 }];
    expect(validateImportPayload(payload).ok).toBe(false);
  });
});

// ─── remapLinksInValue (lib/crossref) ────────────────────────────────────────

describe('remapLinksInValue', () => {
  const idMap = new Map([
    ['item-a', 'new-a'],
    ['item-b', 'new-b'],
  ]);

  it('remaps link ids in multilink values and leaves text alone', () => {
    const value = '@@MULTILINK:[{"type":"text","value":"See "},{"type":"link","id":"item-a","title":"Zog","itemType":"npc"}]';
    expect(remapLinksInValue(value, idMap)).toBe(
      '@@MULTILINK:[{"type":"text","value":"See "},{"type":"link","id":"new-a","title":"Zog","itemType":"npc"}]'
    );
  });

  it('remaps legacy single-link values (normalized to multilink encoding)', () => {
    // parseTokens reads the legacy shape; encodeTokens normalizes the output
    // to the current @@MULTILINK: format with the remapped id.
    expect(remapLinksInValue('@@LINK:{"id":"item-a","title":"Zog","type":"npc"}', idMap)).toBe(
      '@@MULTILINK:[{"type":"link","id":"new-a","title":"Zog","itemType":"npc"}]'
    );
  });

  it('nulls the id of dangling links but keeps the title', () => {
    const value = '@@MULTILINK:[{"type":"link","id":"ghost","title":"Ghost","itemType":"npc"}]';
    expect(remapLinksInValue(value, idMap)).toBe(
      '@@MULTILINK:[{"type":"link","id":"","title":"Ghost","itemType":"npc"}]'
    );
  });

  it('remaps links inside structured JSON-object values', () => {
    const structured = JSON.stringify({
      stats: '@@MULTILINK:[{"type":"link","id":"item-a","title":"Zog","itemType":"npc"}]',
      hp: '42',
    });
    expect(remapLinksInValue(structured, idMap)).toBe(
      JSON.stringify({
        stats: '@@MULTILINK:[{"type":"link","id":"new-a","title":"Zog","itemType":"npc"}]',
        hp: '42',
      })
    );
  });

  it('leaves plain text untouched', () => {
    expect(remapLinksInValue('just text', idMap)).toBe('just text');
    expect(remapLinksInValue('', idMap)).toBe('');
  });
});

// ─── remapBoardIds / buildIdMap ──────────────────────────────────────────────

describe('remapBoardIds', () => {
  it('rewrites item ids, connection endpoints, annotation pins, and field links', () => {
    const payload = makePayload() as any;
    payload.tabs[0].items.push(
      makeItem({
        id: 'item-b',
        title: 'Tower',
        fields: [
          { id: 'f1', label: 'Allies', type: 'text', textValue: '@@MULTILINK:[{"type":"link","id":"item-a","title":"Zog","itemType":"npc"}]' },
        ],
      })
    );

    const idMap = new Map<string, string>([
      ['item-a', '00000000-0000-4000-8000-000000000001'],
      ['item-b', '00000000-0000-4000-8000-000000000002'],
    ]);
    const remapped = remapBoardIds(payload as BoardExportFile, idMap);

    expect(remapped.tabs[0].items.map((i) => i.id)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
    expect(remapped.tabs[0].connections[0].fromId).toBe('00000000-0000-4000-8000-000000000001');
    expect(remapped.tabs[0].connections[0].toId).toBe('00000000-0000-4000-8000-000000000002');
    expect(remapped.tabs[0].annotations![0].pins![0]).toEqual({
      itemId: '00000000-0000-4000-8000-000000000001',
      offsetX: 0.5,
      offsetY: 0.5,
    });
    // null pins survive
    expect(remapped.tabs[0].annotations![0].pins![1]).toBeNull();
    // cross-link tokens point at the new item id
    expect(remapped.tabs[0].items[1].fields![0].textValue).toBe(
      '@@MULTILINK:[{"type":"link","id":"00000000-0000-4000-8000-000000000001","title":"Zog","itemType":"npc"}]'
    );
  });

  it('keeps tab ids as-is', () => {
    const payload = makePayload() as any;
    const remapped = remapBoardIds(payload as BoardExportFile, new Map([['item-a', 'new-a']]));
    expect(remapped.tabs[0].id).toBe('default-tab');
  });
});

describe('buildIdMap', () => {
  it('assigns a unique uuid to every item across all tabs', () => {
    const payload = makePayload() as any;
    payload.tabs.push({ id: 't2', name: 'Second', color: '#000', items: [makeItem({ id: 'item-c' })], connections: [] });
    const idMap = buildIdMap(payload as BoardExportFile);

    expect(idMap.size).toBe(2);
    for (const [oldId, newId] of idMap) {
      expect(oldId).toMatch(/^item-/);
      expect(newId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(new Set(idMap.values()).size).toBe(2);
  });
});

// ─── buildImportRow ──────────────────────────────────────────────────────────

describe('buildImportRow', () => {
  it('adopts every item and annotation, keeps comments with display names', () => {
    const payload = makePayload() as any;
    payload.tabs[0].items[0].ownerId = 'u-1';
    payload.tabs[0].items[0].ownerName = 'DM One';
    payload.tabs[0].items[0].comments = [
      // comment authored by the importer themselves (e.g. same account) — kept
      { id: 'c1', userId: 'u-2', userName: 'DM One', text: 'nice', timestamp: '2026-01-01T00:00:00.000Z' },
      // comment authored by someone who doesn't exist in the new board — nulled
      { id: 'c2', userId: 'u-99', userName: 'Player Zed', text: 'run!', timestamp: '2026-01-02T00:00:00.000Z' },
    ];
    payload.tabs[0].annotations[0].ownerId = 'u-1';
    payload.tabs[0].annotations[0].ownerName = 'DM One';

    const row = buildImportRow(payload as BoardExportFile, { id: 'u-2', displayName: 'GM Two' }, 'my-world-2', null);

    expect(row.id).toBe('my-world-2');
    expect(row.board_password_hash).toBeNull();
    expect(row.board_password_salt).toBeNull();
    expect(row.members).toEqual({ 'u-2': { role: 'dm', joinedAt: expect.any(String) } });

    const item = row.tabs[0].items[0];
    expect(item.id).not.toBe('item-a');
    expect(item.ownerId).toBe('u-2');
    expect(item.ownerName).toBe('GM Two');
    // the importer's own comments keep their userId; everyone else's are nulled
    expect(item.comments[0]).toMatchObject({ userId: 'u-2', userName: 'DM One' });
    expect(item.comments[1]).toMatchObject({ userId: null, userName: 'Player Zed' });

    const ann = row.tabs[0].annotations![0];
    expect(ann.ownerId).toBe('u-2');
    expect(ann.ownerName).toBe('GM Two');
  });

  it('passes settings through unchanged', () => {
    const payload = validPayload();
    const row = buildImportRow(payload as BoardExportFile, { id: 'u-2', displayName: 'GM Two' }, 'my-world-2', null);
    expect(row.settings).toEqual((payload as BoardExportFile).board.settings);
  });

  it('passes an optional password hash/salt through', () => {
    const row = buildImportRow(
      validPayload() as BoardExportFile,
      { id: 'u-2', displayName: 'GM Two' },
      'my-world-2',
      { hash: 'h', salt: 's' }
    );
    expect(row.board_password_hash).toBe('h');
    expect(row.board_password_salt).toBe('s');
  });

  it('remaps ids inside structured field values', () => {
    const payload = validPayload() as any;
    payload.tabs[0].items[0].fields = [
      { id: 'f1', label: 'Allies', type: 'text', textValue: '@@MULTILINK:[{"type":"link","id":"item-a","title":"Zog","itemType":"npc"}]' },
    ];
    const row = buildImportRow(payload as BoardExportFile, { id: 'u-2', displayName: 'GM Two' }, 'my-world-2', null);
    const newItemId = row.tabs[0].items[0].id;
    expect(row.tabs[0].items[0].fields![0].textValue).toBe(
      `@@MULTILINK:[{"type":"link","id":"${newItemId}","title":"Zog","itemType":"npc"}]`
    );
  });
});

// ─── Round trip ──────────────────────────────────────────────────────────────

describe('export → import → export round trip', () => {
  it('preserves structure when normalized', () => {
    const source = buildExportPayload({
      id: 'my-world',
      settings: { cardFontScale: 1.1, tagDefs: { gold: { color: '#FFD700' } } },
      members: { 'u-1': { role: 'dm', joinedAt: '2026-01-01T00:00:00.000Z' } },
      tabs: [
        {
          id: 'default-tab',
          name: 'Main Board',
          color: '#3B82F6',
          items: [
            makeItem({
              id: 'item-a',
              title: 'Zog',
              content: '<p>big</p>',
              tags: ['orc'],
              fields: [
                { id: 'f1', label: 'Allies', type: 'text', textValue: '@@MULTILINK:[{"type":"link","id":"item-b","title":"Tower","itemType":"location"}]' },
              ],
              comments: [
                { id: 'c1', userId: 'u-1', userName: 'DM One', text: 'note', timestamp: '2026-01-01T00:00:00.000Z' },
              ],
            }),
            makeItem({ id: 'item-b', title: 'Tower' }),
          ],
          connections: [{ id: 'conn-1', fromId: 'item-a', toId: 'item-b', label: 'hates', color: '#EF4444', style: 'dashed' }],
          annotations: [
            { id: 'ann-1', type: 'arrow', x: 0, y: 0, x2: 10, y2: 10, text: 'here', pins: [{ itemId: 'item-a', offsetX: 0.5, offsetY: 0.5 }] },
          ],
        },
      ],
    } as any);

    // Simulate a file on disk
    const validated = validateImportPayload(JSON.parse(JSON.stringify(source)));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    // Import as a different user + board id, then export the new board
    const importedRow = buildImportRow(validated.payload, { id: 'u-2', displayName: 'GM Two' }, 'clone-of-my-world', null);
    const reExported = buildExportPayload(importedRow as any);

    expect(extractStructure(reExported)).toEqual(extractStructure(source));
  });
});
