import { Env, ApiTokenRow, JWTPayload } from '../types';

// Every token starts with this prefix, which is how the auth middleware tells an API
// token apart from a session JWT, and makes leaked tokens easy to grep for.
export const API_TOKEN_PREFIX = 'etch_';

// Don't write last_used_at on every request; once a minute is precise enough.
const LAST_USED_THROTTLE_MS = 60 * 1000;

export function generateApiToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(30));
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  const body = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return API_TOKEN_PREFIX + body;
}

// Tokens are 240 bits of randomness, so a fast unsalted hash is sufficient — there is
// nothing to brute-force, and it lets us look tokens up by hash directly.
export async function hashApiToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function tokenHint(token: string): string {
  return token.slice(0, API_TOKEN_PREFIX.length + 4);
}

/**
 * Resolve an API token to a request identity, or null if it is unknown, expired, or
 * its owner no longer exists. Role and name come from the owner as they are now.
 */
export async function verifyApiToken(
  env: Env,
  token: string,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<JWTPayload | null> {
  const hash = await hashApiToken(token);
  const row = await env.DB.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').bind(hash).first<ApiTokenRow>();
  if (!row) return null;

  const now = Date.now();
  if (row.expires_at !== null && row.expires_at <= now) return null;

  let identity: JWTPayload;
  if (row.owner_sub === env.ADMIN_USERNAME) {
    identity = { sub: row.owner_sub, role: 'admin', iat: 0, exp: 0, token_id: row.id };
  } else {
    const user = await env.DB.prepare('SELECT username, name, role FROM users WHERE username = ?')
      .bind(row.owner_sub).first<{ username: string; name: string; role: 'editor' }>();
    // Owner deleted, or this was an admin token and ADMIN_USERNAME has since changed.
    if (!user) return null;
    identity = { sub: user.username, role: user.role, name: user.name || undefined, iat: 0, exp: 0, token_id: row.id };
  }

  if (row.last_used_at === null || now - row.last_used_at > LAST_USED_THROTTLE_MS) {
    waitUntil(env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(now, row.id).run());
  }

  return identity;
}
