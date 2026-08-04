import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { scrubTabsForUser, mergeTabsForSave } from '@/lib/fieldVisibility';
import { syncLinkTitles, sameItemTitles } from '@/lib/crossref';
import { syncRichTextCardLinks } from '@/lib/cardLinks';
import { mergeTagDefs } from '@/lib/tags';
import { sanitizeTabsForSave } from '@/lib/sanitize.server';
import {
  diffComments,
  planMentionNotifications,
  applyMentionNotifications,
  normalizeUsername,
} from '@/lib/mentions';
import { SERVER_MAX_SAVE_BYTES } from '@/lib/boardLimits';
import {
  ItemSaveOp,
  applyItemOpsToTabs,
  buildJsonbSetChain,
  buildUpsertRows,
  diffBoardItems,
} from '@/lib/scalability';

export const runtime = 'nodejs';

/** Keep only well-formed upsert ops (a hostile client may send anything). */
function validOps(ops: unknown): ItemSaveOp[] {
  if (!Array.isArray(ops)) return [];
  return ops.filter(
    (o): o is ItemSaveOp =>
      !!o &&
      typeof o === 'object' &&
      (o as Record<string, unknown>).type === 'upsert' &&
      typeof (o as Record<string, unknown>).tabId === 'string' &&
      !!((o as Record<string, unknown>).item as { id?: unknown })?.id &&
      typeof ((o as Record<string, unknown>).item as { id?: unknown }).id === 'string'
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { boardId } = await params;
    await ensureSchema();
    const sql = getSql();

    const rows = await sql`SELECT members, tabs, settings, updated_at FROM boards WHERE id = ${boardId} LIMIT 1`;
    if (rows.length === 0) return NextResponse.json({ error: 'Board not found.' }, { status: 404 });

    const board = rows[0];
    const member = board.members?.[user.id];
    if (!member) {
      return NextResponse.json({ error: 'You are not a member of this board.' }, { status: 403 });
    }

    // Feature 12 — conditional refetch: the poller passes its last applied
    // revision; when it still matches, skip the payload entirely (304).
    const since = request.nextUrl.searchParams.get('since');
    if (since) {
      const updatedAt = board.updated_at as unknown;
      const updatedAtSerialized = updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;
      if (since === updatedAtSerialized) {
        return new NextResponse(null, { status: 304 });
      }
    }

    const body = {
      userId: user.id,
      username: user.displayName,
      role: member.role,
      updatedAt: board.updated_at ?? null,
      settings: board.settings ?? {},
      // Strip per-field restricted content (e.g. DM-only fields) before
      // sending — the stored data is never mutated.
      tabs: scrubTabsForUser(board.tabs || [], { id: user.id, role: member.role }),
    };
    // Feature 12 — refetch telemetry: payload size + (derivable from logs)
    // refetch frequency, so Phase 2 decisions are numbers-driven.
    console.log(`[scalability] state GET boardId=${boardId} responseBytes=${JSON.stringify(body).length}`);
    return NextResponse.json(body);
  } catch (err) {
    console.error('Load board state error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { boardId } = await params;
    await ensureSchema();
    const sql = getSql();

    const startTime = Date.now();

    const rows = await sql`SELECT members FROM boards WHERE id = ${boardId} LIMIT 1`;
    if (rows.length === 0) return NextResponse.json({ error: 'Board not found.' }, { status: 404 });

    const member = rows[0].members?.[user.id];
    if (!member) {
      return NextResponse.json({ error: 'You are not a member of this board.' }, { status: 403 });
    }
    // Owners may only be reassigned to existing board members.
    const memberIds = new Set(Object.keys(rows[0].members || {}));

    // Feature 12 — read the raw body so oversized payloads get a clean 413
    // before JSON parsing (and the byte count is logged).
    const raw = await request.text();
    const payloadBytes = raw.length;
    if (payloadBytes > SERVER_MAX_SAVE_BYTES) {
      console.log(`[scalability] save rejected boardId=${boardId} payloadBytes=${payloadBytes} status=413`);
      return NextResponse.json(
        { error: 'Board payload exceeds the maximum supported size.' },
        { status: 413 }
      );
    }
    let body: { tabs?: unknown; settings?: unknown; ops?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const { tabs, settings, ops } = body as {
      tabs?: unknown;
      settings?: Record<string, unknown>;
      ops?: unknown;
    };
    let updatedAt: string | null = null;

    if (tabs || ops !== undefined) {
      // Stored tabs + byte size in one query (only when the save carries board
      // content — settings-only saves stay lightweight).
      const storedRows = await sql`
        SELECT tabs, octet_length(tabs::text) AS tabs_bytes FROM boards WHERE id = ${boardId} LIMIT 1
      `;
      const storedTabs: any[] = storedRows[0]?.tabs || [];
      const tabsBytes: number = storedRows[0]?.tabs_bytes ?? 0;

      // Feature 12 / Phase 2.5 — items-only save body: the client sends
      // { ops: [{ type: 'upsert', tabId, item }] } instead of full tabs.
      // Reconstruct the incoming state by applying ops onto the stored tabs,
      // so the EXACT same merge/sync/sanitize pipeline below runs either way.
      const hasOps = Array.isArray(ops);
      const opList = hasOps ? validOps(ops) : [];
      const incoming: any[] = hasOps ? applyItemOpsToTabs(storedTabs, opList) : (tabs as any[]);

      // Merge on top of stored state so clients can never overwrite or delete
      // content they are not permitted to see (per-field visibility, item ownership).
      const merged = mergeTabsForSave(
        storedTabs,
        incoming,
        { id: user.id, role: member.role, displayName: user.displayName },
        memberIds
      );
      // Keep link-token title snapshots in sync with item titles. Skipped when
      // no title changed (Feature 12) — the whole-board walk is the expensive part.
      let synced = sameItemTitles(storedTabs, merged) ? merged : syncLinkTitles(merged);
      // Feature 10 — authoritative rich-text card-link pass: unwrap links to
      // deleted items, retitle links to renamed ones. Runs server-side so a
      // stale client can never persist a dead card link.
      synced = syncRichTextCardLinks(synced);
      // Allowlist-sanitize every rich-text slot (item content, field text
      // values, comments) before it can reach the DB (Security-Audit.md #2).
      const sanitized = sanitizeTabsForSave(synced);

      // Feature 08 — @mention notifications. This is the single comment write
      // path, so detect mentions here (never trust the client). Covers the
      // polled state too: remote commenters notify without any client work.
      const storedMembers: Record<string, { role: string }> = rows[0].members || {};
      const memberUsernameRows = await sql`
        SELECT id, username FROM users WHERE id = ANY(${Array.from(memberIds)})
      `;
      const memberUsernameToId: Record<string, string> = {};
      for (const r of memberUsernameRows) {
        if (storedMembers[r.id]) memberUsernameToId[normalizeUsername(r.username)] = r.id;
      }
      const { newComments, removedCommentIds } = diffComments(storedTabs, sanitized);
      const plan = planMentionNotifications(boardId, memberUsernameToId, newComments);
      // Deleted comments take their notifications with them (dead-link guard).
      await applyMentionNotifications(sql, boardId, plan, removedCommentIds);

      if (hasOps) {
        // Feature 12 / Phase 2.5 — per-item jsonb_set patch: the UPDATE payload
        // is O(changed items); the whole-board JSONB rebuild happens inside
        // Postgres, not in the Node runtime.
        const chain = buildJsonbSetChain(storedTabs, sanitized, opList);
        if (chain.length > 0) {
          let expr = 'tabs';
          const params: unknown[] = [];
          for (const c of chain) {
            params.push(c.path, JSON.stringify(c.item));
            expr = `jsonb_set(${expr}, $${params.length - 1}::text[], $${params.length}::jsonb)`;
          }
          params.push(boardId);
          const updated = (await sql.query(
            `UPDATE boards SET tabs = ${expr}, updated_at = NOW() WHERE id = $${params.length} RETURNING updated_at`,
            params
          )) as { updated_at: string }[];
          updatedAt = updated[0]?.updated_at ?? null;
        }
      } else {
        const updated = await sql`
          UPDATE boards SET tabs = ${JSON.stringify(sanitized)}::jsonb, updated_at = NOW() WHERE id = ${boardId}
          RETURNING updated_at
        `;
        updatedAt = updated[0]?.updated_at ?? null;
      }

      // Feature 12 — keep the board_items shadow in sync: O(changed items)
      // upserts instead of (later, instead of) whole-board read-modify-write.
      const { upserts, deletes } = diffBoardItems(storedTabs, sanitized);
      if (upserts.length > 0 || deletes.length > 0) {
        await sql.transaction((tx) => {
          const queries: ReturnType<typeof tx>[] = [];
          if (upserts.length > 0) {
            // Batch upsert via jsonb_to_recordset — one parameterized statement
            // for any number of changed items.
            const rows = buildUpsertRows(upserts, boardId).map(([id, board_id, tab_id, payload]) => ({
              id,
              board_id,
              tab_id,
              payload,
            }));
            queries.push(
              tx.query(
                `INSERT INTO board_items (id, board_id, tab_id, payload)
                 SELECT t.id, t.board_id, t.tab_id, t.payload::jsonb
                 FROM jsonb_to_recordset($1::jsonb) AS t(id TEXT, board_id TEXT, tab_id TEXT, payload TEXT)
                 ON CONFLICT (id) DO UPDATE
                   SET payload = EXCLUDED.payload, tab_id = EXCLUDED.tab_id, updated_at = NOW()`,
                [JSON.stringify(rows)]
              )
            );
          }
          if (deletes.length > 0) {
            queries.push(tx`DELETE FROM board_items WHERE board_id = ${boardId} AND id = ANY(${deletes})`);
          }
          return queries;
        });
      }

      // Feature 12 — save telemetry (baseline vs after comparison).
      console.log(
        `[scalability] save boardId=${boardId} payloadBytes=${payloadBytes} tabsBytes=${tabsBytes} durationMs=${Date.now() - startTime} ops=${hasOps} upserts=${upserts.length} deletes=${deletes.length}`
      );
    }

    // Board-wide settings are DM-only: players may read them (the GET above
    // ships them to everyone so card rendering stays consistent) but only the
    // DM may change them. Merged onto stored settings so a client can never
    // wipe settings it didn't load.
    if (settings && member.role === 'dm') {
      const storedRows = await sql`SELECT settings FROM boards WHERE id = ${boardId} LIMIT 1`;
      const storedSettings: Record<string, unknown> = storedRows[0]?.settings ?? {};
      // tagDefs must merge per-key, else one client's defs wipe another's.
      const mergedSettings = {
        ...storedSettings,
        ...settings,
        tagDefs: mergeTagDefs(
          (storedSettings.tagDefs as Record<string, { color?: string }> | undefined) ?? {},
          (settings.tagDefs as Record<string, { color?: string }> | undefined) ?? {}
        ),
      };
      const updated = await sql`
        UPDATE boards SET settings = ${JSON.stringify(mergedSettings)}::jsonb, updated_at = NOW() WHERE id = ${boardId}
        RETURNING updated_at
      `;
      updatedAt = updated[0]?.updated_at ?? null;
    }

    // Echo the revision back so the saving client can skip re-fetching the
    // full board state it already has.
    return NextResponse.json({ success: true, updatedAt });
  } catch (err) {
    console.error('Save board state error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
