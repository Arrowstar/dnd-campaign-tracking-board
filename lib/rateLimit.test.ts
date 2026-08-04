import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter, authLimited, requestIp } from './rateLimit';
import { NextRequest } from 'next/server';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests up to the limit', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 3; i++) {
      expect(limiter.allow('k', 3, 60_000)).toBe(true);
    }
  });

  it('rejects requests beyond the limit', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 3; i++) limiter.allow('k', 3, 60_000);
    expect(limiter.allow('k', 3, 60_000)).toBe(false);
  });

  it('resets after the window elapses', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 3; i++) limiter.allow('k', 3, 60_000);
    vi.advanceTimersByTime(60_001);
    expect(limiter.allow('k', 3, 60_000)).toBe(true);
  });

  it('keeps independent windows per key', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 3; i++) limiter.allow('a', 3, 60_000);
    expect(limiter.allow('b', 3, 60_000)).toBe(true);
    expect(limiter.allow('a', 3, 60_000)).toBe(false);
  });

  it('treats a new window as a fresh start after key expiry', () => {
    const limiter = new RateLimiter();
    expect(limiter.allow('k', 1, 60_000)).toBe(true);
    expect(limiter.allow('k', 1, 60_000)).toBe(false);
    vi.advanceTimersByTime(59_999);
    expect(limiter.allow('k', 1, 60_000)).toBe(false);
    vi.advanceTimersByTime(2);
    expect(limiter.allow('k', 1, 60_000)).toBe(true);
  });
});

describe('requestIp', () => {
  it('reads the first entry of x-forwarded-for', () => {
    const request = new NextRequest('https://example.test/', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    });
    expect(requestIp(request)).toBe('203.0.113.9');
  });

  it('falls back to x-real-ip', () => {
    const request = new NextRequest('https://example.test/', {
      headers: { 'x-real-ip': '198.51.100.7' },
    });
    expect(requestIp(request)).toBe('198.51.100.7');
  });

  it('falls back to unknown', () => {
    const request = new NextRequest('https://example.test/');
    expect(requestIp(request)).toBe('unknown');
  });
});

describe('authLimited', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null while under the limit and 429 once exceeded', () => {
    const request = new NextRequest('https://example.test/', {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    expect(authLimited(request, 'login:alice', 2, 60_000)).toBeNull();
    expect(authLimited(request, 'login:alice', 2, 60_000)).toBeNull();
    const blocked = authLimited(request, 'login:alice', 2, 60_000);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get('Retry-After')).toBe('60');
  });

  it('does not share windows across keys', () => {
    const request = new NextRequest('https://example.test/', {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    authLimited(request, 'login:alice', 1, 60_000);
    expect(authLimited(request, 'login:bob', 1, 60_000)).toBeNull();
    expect(authLimited(request, 'login:bob', 1, 60_000)).not.toBeNull();
  });
});
