import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthUser,
  hashPassword,
  verifyPassword,
  generateToken,
  setSessionCookie,
  SESSION_LIFETIME_SECONDS,
} from '@/lib/auth';
import { getSql } from '@/lib/db';
import { authLimited, PASSWORD_CHANGE_LIMIT, PASSWORD_CHANGE_WINDOW_MS } from '@/lib/rateLimit';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // The current password is a credential check — rate-limit it like login
    // (Security-Audit.md medium #6).
    const limited = authLimited(request, `change-password:${user.id}`, PASSWORD_CHANGE_LIMIT, PASSWORD_CHANGE_WINDOW_MS);
    if (limited) return limited;

    const { oldPassword, newPassword } = (await request.json()) as {
      oldPassword?: string;
      newPassword?: string;
    };
    if (!oldPassword || !newPassword) {
      return NextResponse.json(
        { error: 'Current password and new password are required.' },
        { status: 400 }
      );
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return NextResponse.json(
        { error: 'New password must be 8–128 characters long.' },
        { status: 400 }
      );
    }

    const valid = await verifyPassword(oldPassword, user.passwordHash, user.salt);
    if (!valid) {
      return NextResponse.json({ error: 'Incorrect current password.' }, { status: 401 });
    }

    const { hash, salt } = await hashPassword(newPassword);
    const sql = getSql();
    await sql`UPDATE users SET password_hash = ${hash}, salt = ${salt} WHERE id = ${user.id}`;

    // Revoke every session for this user (Security-Audit.md medium #6), then
    // reissue a fresh one so the account owner stays signed in while all other
    // devices are kicked out.
    await sql`DELETE FROM sessions WHERE user_id = ${user.id}`;
    const sessionToken = generateToken();
    await sql`
      INSERT INTO sessions (token, user_id, expires_at)
      VALUES (${sessionToken}, ${user.id}, NOW() + make_interval(secs => ${SESSION_LIFETIME_SECONDS}))
    `;

    return setSessionCookie(
      NextResponse.json({ success: true, message: 'Password successfully updated.' }),
      sessionToken
    );
  } catch (err) {
    console.error('Change password error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
