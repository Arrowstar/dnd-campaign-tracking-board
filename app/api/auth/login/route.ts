import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { verifyPassword, generateToken } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = (await request.json()) as { username?: string; password?: string };

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
    }

    await ensureSchema();
    const sql = getSql();

    const lowerUsername = username.trim().toLowerCase();
    const rows = await sql`
      SELECT id, username, display_name AS "displayName", password_hash AS "passwordHash", salt
      FROM users WHERE username = ${lowerUsername} AND deleted_at IS NULL LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
    }

    const user = rows[0];
    const valid = await verifyPassword(password, user.passwordHash, user.salt);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
    }

    const sessionToken = generateToken();
    await sql`INSERT INTO sessions (token, user_id) VALUES (${sessionToken}, ${user.id})`;

    return NextResponse.json({
      sessionToken,
      user: { id: user.id, username: user.username, displayName: user.displayName },
    });
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
