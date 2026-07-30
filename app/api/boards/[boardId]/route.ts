import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';

export const runtime = 'nodejs';

/** Public check: does this board exist, and does joining need a password? */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const { boardId } = await params;
    await ensureSchema();
    const sql = getSql();

    const rows = await sql`SELECT board_password_hash FROM boards WHERE id = ${boardId} LIMIT 1`;
    if (rows.length === 0) {
      return NextResponse.json({ exists: false });
    }

    return NextResponse.json({
      exists: true,
      requiresBoardPassword: !!rows[0].board_password_hash,
    });
  } catch (err) {
    console.error('Board existence check error:', err);
    return NextResponse.json({ exists: false });
  }
}
