import { NextRequest, NextResponse } from 'next/server';

/**
 * Minimal in-memory fixed-window rate limiter (Security-Audit.md medium #6).
 *
 * Deliberately dependency-free. Counters live in process memory, so on
 * serverless deployments each warm instance enforces its own window — limits
 * are per-instance rather than global. That still defeats casual brute-force
 * and credential-stuffing scripts, which is the goal here.
 */
export class RateLimiter {
  private windows = new Map<string, { windowStart: number; count: number }>();

  /**
   * Registers one attempt against `key`. Returns `true` when the attempt is
   * within the limit, `false` when it must be rejected.
   */
  allow(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const state = this.windows.get(key);
    if (!state || now - state.windowStart >= windowMs) {
      if (this.windows.size > 10000) this.prune(now, windowMs);
      this.windows.set(key, { windowStart: now, count: 1 });
      return true;
    }
    if (state.count >= limit) return false;
    state.count += 1;
    return true;
  }

  /** Drops the stored window for `key` (used by tests). */
  reset(key: string): void {
    this.windows.delete(key);
  }

  /** Bounds memory: drop fully-aged windows once the map grows large. */
  private prune(now: number, windowMs: number): void {
    for (const [key, state] of this.windows) {
      if (now - state.windowStart >= windowMs) this.windows.delete(key);
    }
  }
}

/** Best-effort client IP from the request headers. */
export function requestIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}

function rateLimitEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

export const LOGIN_LIMIT = rateLimitEnv('LOGIN_RATE_LIMIT', 10);
export const LOGIN_IP_LIMIT = rateLimitEnv('LOGIN_RATE_LIMIT_PER_IP', 30);
export const LOGIN_WINDOW_MS = FIFTEEN_MINUTES;

export const REGISTER_LIMIT = rateLimitEnv('REGISTER_RATE_LIMIT', 5);
export const REGISTER_WINDOW_MS = ONE_HOUR;

export const JOIN_LIMIT = rateLimitEnv('JOIN_RATE_LIMIT', 10);
export const JOIN_WINDOW_MS = FIFTEEN_MINUTES;

export const PASSWORD_CHANGE_LIMIT = rateLimitEnv('PASSWORD_CHANGE_RATE_LIMIT', 10);
export const PASSWORD_CHANGE_WINDOW_MS = FIFTEEN_MINUTES;

const authLimiter = new RateLimiter();

/**
 * Enforces a rate limit keyed by IP (plus whatever distinguishing `keySuffix`
 * the caller provides, e.g. the attempted username). Returns a 429 response
 * when the limit is hit, otherwise `null` (caller should proceed).
 */
export function authLimited(
  request: NextRequest,
  keySuffix: string,
  limit: number,
  windowMs: number
): NextResponse | null {
  const ip = requestIp(request);
  if (!authLimiter.allow(`${keySuffix}|${ip}`, limit, windowMs)) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(windowMs / 1000)) },
      }
    );
  }
  return null;
}
