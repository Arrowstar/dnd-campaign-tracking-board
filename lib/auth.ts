import crypto from 'crypto';
import { promisify } from 'util';
import { NextRequest, NextResponse } from 'next/server';
import { getSql, ensureSchema } from './db';

const scryptAsync = promisify<string | Buffer, string | Buffer, number, Buffer>(
  crypto.scrypt as (
    password: string | Buffer,
    salt: string | Buffer,
    keylen: number,
    cb: (err: Error | null, derivedKey: Buffer) => void
  ) => void
);

/**
 * Session cookie name. The token is carried in an HttpOnly cookie (never
 * localStorage) so injected script cannot read it (Security-Audit.md critical
 * #2). `HttpOnly` + `SameSite=Lax` + `Secure` in production.
 */
export const SESSION_COOKIE = 'dnd_session';

/**
 * Sessions live 30 days and slide forward on use (Security-Audit.md medium
 * #6): `getAuthUser` refreshes `expires_at` once the session is past half of
 * its lifetime, so an active user never hits the wall while inactive sessions
 * age out and are pruned.
 */
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_LIFETIME_SECONDS = Math.floor(SESSION_LIFETIME_MS / 1000);

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}

/** Attaches the session token as an HttpOnly cookie to a response. */
export function setSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}

/** Clears the session cookie (logout / account deletion). */
export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return { hash: derived.toString('hex'), salt };
}

/**
 * Constant-time password comparison (Security-Audit.md medium #6):
 * `crypto.timingSafeEqual` on the derived/hash buffers instead of a plain
 * string compare.
 */
export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const derived = await scryptAsync(password, salt, 64);
  const derivedHex = derived.toString('hex');
  if (derivedHex.length !== hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(derivedHex, 'hex'), Buffer.from(hash, 'hex'));
}

/**
 * Runs a full scrypt verification against a fixed dummy credential. Call this
 * in login when the username is unknown so that "unknown user" and "wrong
 * password" take the same time as a real verification — otherwise attackers
 * can enumerate usernames via timing (Security-Audit.md medium #6).
 */
let dummyCreds: { hash: string; salt: string } | null = null;
export async function verifyDummyPassword(password: string): Promise<boolean> {
  if (!dummyCreds) dummyCreds = await hashPassword('dummy-password');
  return verifyPassword(password, dummyCreds.hash, dummyCreds.salt);
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  salt: string;
}

/**
 * Looks up the session cookie on the request and returns the user, or null.
 * Expired sessions are rejected (and pruned by login/register). Still-valid
 * sessions past half their lifetime get `expires_at` slid forward so active
 * users stay signed in.
 */
export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  await ensureSchema();
  const sql = getSql();

  const rows = await sql`
    SELECT u.id, u.username, u.display_name AS "displayName",
           u.password_hash AS "passwordHash", u.salt,
           s.expires_at AS "expiresAt"
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND u.deleted_at IS NULL
      AND (s.expires_at IS NULL OR s.expires_at > NOW())
    LIMIT 1
  `;

  if (!rows || rows.length === 0) return null;
  const row = rows[0] as AuthUser & { expiresAt: string | null };

  // Slide the window when it's past half-life (or not set yet — pre-expiry
  // migration rows get their clock started on first use).
  const expiresAt = row.expiresAt ? Date.parse(row.expiresAt) : 0;
  if (!row.expiresAt || expiresAt - Date.now() < SESSION_LIFETIME_MS / 2) {
    await sql`
      UPDATE sessions
      SET expires_at = NOW() + make_interval(secs => ${SESSION_LIFETIME_SECONDS})
      WHERE token = ${token}
    `;
  }

  return row;
}
