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

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const derived = await scryptAsync(password, salt, 64);
  return derived.toString('hex') === hash;
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

/** Looks up the session cookie on the request and returns the user, or null. */
export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  await ensureSchema();
  const sql = getSql();

  const rows = await sql`
    SELECT u.id, u.username, u.display_name AS "displayName",
           u.password_hash AS "passwordHash", u.salt
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND u.deleted_at IS NULL
    LIMIT 1
  `;

  if (!rows || rows.length === 0) return null;
  return rows[0] as AuthUser;
}
