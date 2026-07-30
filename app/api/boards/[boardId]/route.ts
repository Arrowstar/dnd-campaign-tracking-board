import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureBoardsTable, getConnectionString } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const { boardId } = await params;
    if (!boardId) {
      return NextResponse.json({ error: 'Board ID is required' }, { status: 400 });
    }

    const connStr = getConnectionString();
    if (!connStr) {
      console.warn('No database connection string found in environment.');
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

    let boardData = rows[0].data;
    if (typeof boardData === 'string') {
      try {
        boardData = JSON.parse(boardData);
      } catch (e) {
        console.error('Failed to parse stored JSON data:', e);
      }
    }

    const parsedTabs = boardData?.tabs && Array.isArray(boardData.tabs) ? boardData.tabs : [];

    return NextResponse.json({
      exists: true,
      requiresBoardPassword: false,
      tabs: parsedTabs
    });
  } catch (error: any) {
    console.error('Error fetching board data from Neon DB:', error);
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

    const connStr = getConnectionString();
    if (!connStr) {
      console.warn('No database connection string found in environment during POST.');
      return NextResponse.json({ success: true, warning: 'No database connection string configured' });
    }

    await ensureBoardsTable();
    const sql = getSql();

    // Ensure data is formatted as valid JSON string for PostgreSQL JSONB
    const jsonPayload = typeof body === 'string' ? body : JSON.stringify(body);

    await sql`
      INSERT INTO boards (id, data, updated_at)
      VALUES (${boardId}, ${jsonPayload}::jsonb, NOW())
      ON CONFLICT (id)
      DO UPDATE SET data = ${jsonPayload}::jsonb, updated_at = NOW()
    `;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating board data in Neon DB:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ boardId: string }> }
) {
  return POST(request, context);
}
