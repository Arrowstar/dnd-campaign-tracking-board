import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { SESSION_COOKIE, clearSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await ensureSchema();
      const sql = getSql();
      await sql`DELETE FROM sessions WHERE token = ${token}`;
    } catch (err) {
      console.error('Logout error:', err);
    }
  }
  return clearSessionCookie(NextResponse.json({ success: true }));
}
