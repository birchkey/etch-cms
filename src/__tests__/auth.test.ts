import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, signJWT, verifyJWT } from '../middleware/auth';

const SECRET = 'test-secret-for-unit-tests';

describe('hashPassword', () => {
  it('produces a pbkdf2: prefixed hash', async () => {
    const hash = await hashPassword('password123');
    expect(hash).toMatch(/^pbkdf2:[0-9a-f]{32}:[0-9a-f]{64}$/);
  });

  it('produces a different hash each call (unique salt)', async () => {
    const h1 = await hashPassword('same-password');
    const h2 = await hashPassword('same-password');
    expect(h1).not.toBe(h2);
  });
});

describe('verifyPassword', () => {
  it('accepts the correct password', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPassword('correct-horse', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPassword('wrong-horse', hash)).toBe(false);
  });

  it('rejects a hash that is not pbkdf2 format', async () => {
    expect(await verifyPassword('password', 'sha256:abc123')).toBe(false);
  });

  it('rejects a malformed pbkdf2 string', async () => {
    expect(await verifyPassword('password', 'pbkdf2:onlytwoparts')).toBe(false);
  });
});

describe('signJWT / verifyJWT', () => {
  it('produces a three-part dot-separated token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJWT({ sub: 'admin', role: 'admin', iat: now, exp: now + 3600 }, SECRET);
    expect(token.split('.')).toHaveLength(3);
  });

  it('round-trips: verified payload matches signed payload', async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: 'user-1', role: 'admin' as const, name: 'Alice', iat: now, exp: now + 3600 };
    const token = await signJWT(payload, SECRET);
    const result = await verifyJWT(token, SECRET);
    expect(result?.sub).toBe('user-1');
    expect(result?.role).toBe('admin');
    expect(result?.name).toBe('Alice');
  });

  it('returns null for a tampered token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJWT({ sub: 'admin', role: 'admin' as const, iat: now, exp: now + 3600 }, SECRET);
    const [header, payload, sig] = token.split('.');
    const tampered = `${header}.${payload}TAMPERED.${sig}`;
    expect(await verifyJWT(tampered, SECRET)).toBeNull();
  });

  it('returns null for a wrong secret', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJWT({ sub: 'admin', role: 'admin' as const, iat: now, exp: now + 3600 }, SECRET);
    expect(await verifyJWT(token, 'wrong-secret')).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const token = await signJWT({ sub: 'admin', role: 'admin' as const, iat: past - 3600, exp: past }, SECRET);
    expect(await verifyJWT(token, SECRET)).toBeNull();
  });

  it('returns null for a malformed token', async () => {
    expect(await verifyJWT('not.a.valid.jwt.token', SECRET)).toBeNull();
    expect(await verifyJWT('onlytwoparts.here', SECRET)).toBeNull();
  });
});
