import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

export const runtime = 'nodejs';

export interface NotificationRow {
  id: number;
  itemId: string;
  itemTitle: string;
  commentId: string;
  commenterName: string;
  createdAt: string;
  read: boolean;
  /** True when the referenced card/comment no longer exists on the board. */
  itemDeleted: boolean;
}

/**
 * Board-scoped notification list for the current user (Feature 08).
 * Unread first, newest first. Item titles and commenter names are resolved
 * from the board's tabs JSON (comments are not a relational surface), so a
 * row whose card or comment has been deleted degrades to an inert "(deleted)"
 * row the client renders without navigation.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const boardId = (await params).boardId;
    await ensureSchema();
    const sql = getSql();

    const boardRows = await sql`SELECT tabs, members FROM boards WHERE id = ${boardId} LIMIT 1`;
    if (boardRows.length === 0) return NextResponse.json({ error: 'Board not found.' }, { status: 404 });
    const members = boardRows[0].members || {};
    if (!members[user.id]) {
      return NextResponse.json({ error: 'You are not a member of this board.' }, { status: 403 });
    }

    const notifications = await sql`
      SELECT id, item_id AS "itemId", comment_id AS "commentId", created_at AS "createdAt", read
      FROM notifications
      WHERE user_id = ${user.id} AND board_id = ${boardId}
      ORDER BY read ASC, created_at DESC
      LIMIT 100
    `;

    // Resolve item titles + commenter names from the board payload.
    const tabs: any[] = boardRows[0].tabs || [];
    const commentsById = new Map<string, { commenterName: string; itemTitle: string; itemId: string }>();
    for (const tab of tabs) {
      for (const item of tab.items || []) {
        for (const c of item.comments || []) {
          commentsById.set(c.id, {
            commenterName: c.userName || 'Unknown',
            itemTitle: item.title || 'Untitled',
            itemId: item.id,
          });
        }
      }
    }

    const result: NotificationRow[] = notifications.map((n: any) => {
      const meta = commentsById.get(n.commentId);
      return {
        id: n.id,
        itemId: meta?.itemId ?? n.itemId,
        itemTitle: meta?.itemTitle ?? '',
        commentId: n.commentId,
        commenterName: meta?.commenterName ?? '',
        createdAt: n.createdAt ?? null,
        read: n.read,
        itemDeleted: !meta,
      };
    });

    return NextResponse.json({ notifications: result });
  } catch (err) {
    console.error('List notifications error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
