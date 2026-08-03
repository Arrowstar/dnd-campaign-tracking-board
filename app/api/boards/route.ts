import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { getAuthUser, hashPassword } from '@/lib/auth';
import { validateBoardId } from '@/lib/exportImport';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { boardId, boardPassword } = (await request.json()) as {
      boardId?: string;
      boardPassword?: string;
    };

    const cleanId = validateBoardId(boardId ?? '');
    if (!cleanId) {
      return NextResponse.json(
        { error: 'Board ID must be 2–48 lowercase letters, numbers, or hyphens.' },
        { status: 400 }
      );
    }

    await ensureSchema();
    const sql = getSql();

    const existing = await sql`SELECT id FROM boards WHERE id = ${cleanId} LIMIT 1`;
    if (existing.length > 0) {
      return NextResponse.json({ error: 'A board with that ID already exists.' }, { status: 409 });
    }

    const members = { [user.id]: { role: 'dm', joinedAt: new Date().toISOString() } };
    const tabs = [{ id: 'default-tab', name: 'Main Board', color: '#3B82F6', items: [], connections: [] }];

    let boardPasswordHash: string | null = null;
    let boardPasswordSalt: string | null = null;
    if (boardPassword && boardPassword.trim()) {
      const bPass = await hashPassword(boardPassword);
      boardPasswordHash = bPass.hash;
      boardPasswordSalt = bPass.salt;
    }

    await sql`
      INSERT INTO boards (id, board_password_hash, board_password_salt, members, tabs)
      VALUES (
        ${cleanId},
        ${boardPasswordHash},
        ${boardPasswordSalt},
        ${JSON.stringify(members)}::jsonb,
        ${JSON.stringify(tabs)}::jsonb
      )
    `;

    return NextResponse.json({ success: true, boardId: cleanId, role: 'dm' });
  } catch (err) {
    console.error('Create board error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
