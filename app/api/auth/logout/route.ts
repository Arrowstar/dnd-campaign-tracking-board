import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ')) {
    try {
      await ensureSchema();
      const sql = getSql();
      await sql`DELETE FROM sessions WHERE token = ${auth.slice(7)}`;
    } catch (err) {
      console.error('Logout error:', err);
    }
  }
  return NextResponse.json({ success: true });
}
