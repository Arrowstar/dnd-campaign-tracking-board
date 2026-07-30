import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureBoardsTable } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { boardId } = body;

    if (!boardId) {
      return NextResponse.json({ error: 'Board ID is required' }, { status: 400 });
    }

    if (process.env.DATABASE_URL) {
      await ensureBoardsTable();
      const sql = getSql();
      const defaultState = JSON.stringify({
        tabs: [
          { id: 'default-tab', name: 'Main Board', color: '#3B82F6', items: [], connections: [] }
        ]
      });

      await sql`
        INSERT INTO boards (id, data, updated_at)
        VALUES (${boardId}, ${defaultState}::jsonb, NOW())
        ON CONFLICT (id) DO NOTHING
      `;
    }

    return NextResponse.json({ success: true, boardId });
  } catch (error: any) {
    console.error('Error creating board:', error);
    return NextResponse.json({ success: true });
  }
}
