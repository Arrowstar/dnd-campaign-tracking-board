import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, verifyDummyPassword, generateToken, SESSION_LIFETIME_MS } from './auth';

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const { hash, salt } = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash, salt)).toBe(true);
    expect(await verifyPassword('wrong password', hash, salt)).toBe(false);
  });

  it('rejects a password when the stored hash length differs', async () => {
    const { hash, salt } = await hashPassword('secret password');
    const truncated = hash.slice(0, 60);
    expect(await verifyPassword('secret password', truncated, salt)).toBe(false);
  });

  it('produces unique salts per hash', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('dummy verification behaves like a real verification (returns false)', async () => {
    expect(await verifyDummyPassword('anything-at-all')).toBe(false);
  });
});

describe('tokens & session lifetime', () => {
  it('generates high-entropy tokens', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('exposes a 30-day session lifetime', () => {
    expect(SESSION_LIFETIME_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
