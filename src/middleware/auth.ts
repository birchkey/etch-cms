import { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { Env, JWTPayload } from '../types';
import { API_TOKEN_PREFIX, verifyApiToken } from '../lib/api-tokens';
import { resolveUser } from '../lib/users';

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

// A session JWT proves who signed in, but not what they may do now: the user is re-read on
// every request, so deleting a user or changing their role takes effect immediately rather
// than when their access token expires.
export async function verifySession(env: Env, token: string): Promise<JWTPayload | null> {
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return null;
  const user = await resolveUser(env, payload.sub);
  // A token issued before the account existed belongs to an earlier user with the same name.
  // iat has one-second resolution, so compare in seconds.
  if (!user || payload.iat < Math.floor(user.created_at / 1000)) return null;
  return { ...payload, role: user.role, name: user.name };
}

export async function authMiddleware(c: Context<{ Bindings: Env; Variables: AuthVariables }>, next: Next) {
  // Prefer HttpOnly cookie; fall back to Bearer for programmatic access, which accepts
  // either an API token (etch_…) or a session JWT.
  let token = getCookie(c, 'etch_access');
  if (!token) {
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) token = authHeader.slice(7).trim();
  }

  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = token.startsWith(API_TOKEN_PREFIX)
    ? await verifyApiToken(c.env, token, p => c.executionCtx.waitUntil(p))
    : await verifySession(c.env, token);
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  c.set('jwtPayload', payload);
  await next();
}

// Blocks requests authenticated with an API token. Used for actions a leaked token must
// not be able to perform: minting more tokens and changing passwords.
export async function sessionOnly(c: Context<{ Bindings: Env; Variables: AuthVariables }>, next: Next) {
  if (c.get('jwtPayload').token_id) {
    return c.json({ error: 'This action requires signing in; API tokens cannot be used' }, 403);
  }
  await next();
}

export async function adminOnly(c: Context<{ Bindings: Env; Variables: AuthVariables }>, next: Next) {
  const payload = c.get('jwtPayload');
  if (payload.role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
}
