import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { verifyPassword, verifyDummyPassword, generateToken, setSessionCookie, SESSION_LIFETIME_SECONDS } from '@/lib/auth';
import { authLimited, LOGIN_LIMIT, LOGIN_IP_LIMIT, LOGIN_WINDOW_MS } from '@/lib/rateLimit';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = (await request.json()) as { username?: string; password?: string };

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
    }

    const lowerUsername = username.trim().toLowerCase();

    // Brute-force / credential-stuffing protection (Security-Audit.md medium
    // #6): a per-IP+username window and a wider per-IP window. Limit checks run
    // before any DB work.
    const limitedUser = authLimited(request, `login:${lowerUsername}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
    if (limitedUser) return limitedUser;
    const limitedIp = authLimited(request, 'login-ip', LOGIN_IP_LIMIT, LOGIN_WINDOW_MS);
    if (limitedIp) return limitedIp;

    await ensureSchema();
    const sql = getSql();

    // Opportunistic prune of expired sessions.
    await sql`DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < NOW()`;

    const rows = await sql`
      SELECT id, username, display_name AS "displayName", password_hash AS "passwordHash", salt
      FROM users WHERE username = ${lowerUsername} AND deleted_at IS NULL LIMIT 1
    `;

    if (rows.length === 0) {
      // Same scrypt cost as a real verification so user enumeration via timing
      // is not feasible.
      await verifyDummyPassword(password);
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
    }

    const user = rows[0];
    const valid = await verifyPassword(password, user.passwordHash, user.salt);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });
    }

    const sessionToken = generateToken();
    await sql`
      INSERT INTO sessions (token, user_id, expires_at)
      VALUES (${sessionToken}, ${user.id}, NOW() + make_interval(secs => ${SESSION_LIFETIME_SECONDS}))
    `;

    // Session rides an HttpOnly cookie — never exposed to JS (Security-Audit.md
    // critical #2). The body still carries the token for transitional clients.
    return setSessionCookie(
      NextResponse.json({
        sessionToken,
        user: { id: user.id, username: user.username, displayName: user.displayName },
      }),
      sessionToken
    );
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
