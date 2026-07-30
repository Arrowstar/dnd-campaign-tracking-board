import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureBoardsTable } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const { boardId } = await params;
    if (!boardId) {
      return NextResponse.json({ error: 'Board ID is required' }, { status: 400 });
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({
        exists: true,
        requiresBoardPassword: false,
        tabs: [
          { id: 'default-tab', name: 'Main Board', color: '#3B82F6', items: [], connections: [] }
        ]
      });
    }

    await ensureBoardsTable();
    const sql = getSql();
    const rows = await sql`
      SELECT data FROM boards WHERE id = ${boardId} LIMIT 1
    `;

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        exists: false,
        requiresBoardPassword: false,
        tabs: [
          { id: 'default-tab', name: 'Main Board', color: '#3B82F6', items: [], connections: [] }
        ]
      });
    }

    return NextResponse.json({
      exists: true,
      requiresBoardPassword: false,
      ...rows[0].data
    });
  } catch (error: any) {
    console.error('Error fetching board data:', error);
    return NextResponse.json({
      exists: true,
      requiresBoardPassword: false,
      tabs: [
        { id: 'default-tab', name: 'Main Board', color: '#3B82F6', items: [], connections: [] }
      ]
    });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const { boardId } = await params;
    if (!boardId) {
      return NextResponse.json({ error: 'Board ID is required' }, { status: 400 });
    }

    const body = await request.json();

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ success: true, warning: 'DATABASE_URL not set' });
    }

    await ensureBoardsTable();
    const sql = getSql();
    const jsonString = JSON.stringify(body);

    await sql`
      INSERT INTO boards (id, data, updated_at)
      VALUES (${boardId}, ${jsonString}::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET data = ${jsonString}::jsonb, updated_at = NOW()
    `;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating board data:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ boardId: string }> }
) {
  return POST(request, context);
}
