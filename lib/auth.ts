import crypto from 'crypto';
import { promisify } from 'util';
import { NextRequest } from 'next/server';
import { getSql, ensureSchema } from './db';

const scryptAsync = promisify<string | Buffer, string | Buffer, number, Buffer>(
  crypto.scrypt as (
    password: string | Buffer,
    salt: string | Buffer,
    keylen: number,
    cb: (err: Error | null, derivedKey: Buffer) => void
  ) => void
);

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

/** Looks up the Bearer session token on the request and returns the user, or null. */
export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  const auth = request.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);

  await ensureSchema();
  const sql = getSql();

  const rows = await sql`
    SELECT u.id, u.username, u.display_name AS "displayName",
           u.password_hash AS "passwordHash", u.salt
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token}
    LIMIT 1
  `;

  if (!rows || rows.length === 0) return null;
  return rows[0] as AuthUser;
}
