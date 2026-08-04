import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from '@/lib/db';
import { hashPassword, generateToken, setSessionCookie, SESSION_LIFETIME_SECONDS } from '@/lib/auth';
import { authLimited, REGISTER_LIMIT, REGISTER_WINDOW_MS } from '@/lib/rateLimit';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // Cap account-creation rate per IP so the open register endpoint can't be
    // used to farm accounts for abuse (Security-Audit.md medium #5/#6).
    const limited = authLimited(request, 'register', REGISTER_LIMIT, REGISTER_WINDOW_MS);
    if (limited) return limited;

    const { username, password } = (await request.json()) as { username?: string; password?: string };

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
    }
    if (username.trim().length < 2 || username.trim().length > 32) {
      return NextResponse.json({ error: 'Username must be 2–32 characters.' }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9_\- ]+$/.test(username)) {
      return NextResponse.json(
        { error: 'Username may only contain letters, numbers, spaces, hyphens, and underscores.' },
        { status: 400 }
      );
    }
    if (password.length < 8 || password.length > 128) {
      return NextResponse.json(
        { error: 'Password must be 8–128 characters.' },
        { status: 400 }
      );
    }

    await ensureSchema();
    const sql = getSql();

    // Opportunistic prune of expired sessions.
    await sql`DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < NOW()`;

    const lowerUsername = username.trim().toLowerCase();
    // Deleted accounts are renamed (`deleted_<id>`, Feature 07) so this check
    // also releases their username; the deleted_at filter is defense-in-depth.
    const existing = await sql`SELECT id FROM users WHERE username = ${lowerUsername} AND deleted_at IS NULL LIMIT 1`;
    if (existing.length > 0) {
      return NextResponse.json({ error: 'That username is already taken.' }, { status: 409 });
    }

    const { hash, salt } = await hashPassword(password);
    const userId = crypto.randomUUID();
    const displayName = username.trim();

    await sql`
      INSERT INTO users (id, username, display_name, password_hash, salt)
      VALUES (${userId}, ${lowerUsername}, ${displayName}, ${hash}, ${salt})
    `;

    const sessionToken = generateToken();
    await sql`
      INSERT INTO sessions (token, user_id, expires_at)
      VALUES (${sessionToken}, ${userId}, NOW() + make_interval(secs => ${SESSION_LIFETIME_SECONDS}))
    `;

    // Session rides an HttpOnly cookie — never exposed to JS (Security-Audit.md
    // critical #2). The body still carries the token for transitional clients.
    return setSessionCookie(
      NextResponse.json({
        sessionToken,
        user: { id: userId, username: lowerUsername, displayName },
      }),
      sessionToken
    );
  } catch (err) {
    console.error('Register error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
