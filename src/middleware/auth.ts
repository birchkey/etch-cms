import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { Env, JWTPayload } from '../types';

type AuthVariables = { jwtPayload: JWTPayload };

// Minimal JWT verification using Web Crypto API (HS256)
export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;

    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const data = encoder.encode(`${headerB64}.${payloadB64}`);
    const sigBytes = base64UrlDecode(sigB64);
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, data);
    if (!valid) return null;

    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload as JWTPayload;
  } catch {
    return null;
  }
}

function base64UrlDecode(str: string): ArrayBuffer {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Verify signature and expiry. Returns the raw payload or null.
export async function verifySignature(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const key = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const data = encoder.encode(`${headerB64}.${payloadB64}`);
    const sigBytes = base64UrlDecode(sigB64);
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, data);
    if (!valid) return null;
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function signJWT(payload: object, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const data = encoder.encode(`${header}.${body}`);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, data);
  const sigArray = new Uint8Array(sigBuffer);
  let sigBinary = '';
  sigArray.forEach(b => sigBinary += String.fromCharCode(b));
  const sig = btoa(sigBinary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return `${header}.${body}.${sig}`;
}

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    keyMaterial,
    256
  );
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash.startsWith('pbkdf2:')) return false;
  const parts = hash.split(':');
  if (parts.length !== 3) return false;
  const [, saltHex, storedHash] = parts;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    keyMaterial,
    256
  );
  const derived = new Uint8Array(bits);
  const stored = new Uint8Array(storedHash.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  if (derived.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ stored[i];
  return diff === 0;
}

export async function authMiddleware(c: Context<{ Bindings: Env; Variables: AuthVariables }>, next: Next) {
  // Prefer HttpOnly cookie; fall back to Bearer token for programmatic API access
  let token = getCookie(c, 'etch_access');
  if (!token) {
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) token = authHeader.slice(7);
  }

  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  c.set('jwtPayload', payload);
  await next();
}

export async function adminOnly(c: Context<{ Bindings: Env; Variables: AuthVariables }>, next: Next) {
  const payload = c.get('jwtPayload');
  if (payload.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
}
