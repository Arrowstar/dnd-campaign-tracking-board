import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { isTokenUsable, buildViewPayload, ShareRow, ShareBoardRow } from '@/lib/shareTokens';

export const runtime = 'nodejs';

/**
 * Public read-only board view — the token IS the credential (a high-entropy
 * bearer secret minted by the DM). No session, no membership required.
 *
 * Status mapping for the view page:
 *  - 404 → board doesn't exist, or the token was never valid / was revoked.
 *  - 403 → the link is valid but expired.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; token: string }> }
) {
  try {
    const { boardId, token } = await params;
    await ensureSchema();
    const sql = getSql();

    const boardRows = await sql`
      SELECT id, tabs, settings, updated_at
      FROM boards WHERE id = ${boardId} LIMIT 1
    `;
    if (boardRows.length === 0) {
      return NextResponse.json({ error: 'This board doesn\'t exist or the link is invalid.' }, { status: 404 });
    }

    const shareRows = await sql`
      SELECT token, board_id, label, created_at, expires_at
      FROM board_shares WHERE token = ${token} AND board_id = ${boardId} LIMIT 1
    ` as unknown as ShareRow[];
    const share = shareRows[0];
    if (!share) {
      return NextResponse.json({ error: 'This board doesn\'t exist or the link is invalid.' }, { status: 404 });
    }
    if (!isTokenUsable(share)) {
      return NextResponse.json({ error: 'This link is no longer active.' }, { status: 403 });
    }

    // Least privilege: items filtered to 'all' and per-field content scrubbed
    // for an anonymous player — dm/owner items never leave the server.
    return NextResponse.json(buildViewPayload(boardRows[0] as unknown as ShareBoardRow));
  } catch (err) {
    console.error('Load share view error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
