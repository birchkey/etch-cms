import { Hono, Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Env, UserRow, JWTPayload } from '../types';
import { signJWT, verifyPassword, hashPassword, authMiddleware } from '../middleware/auth';
import { z } from 'zod';
import { parseBody } from '../lib/validate';

const ACCESS_COOKIE = 'etch_access';
const REFRESH_COOKIE = 'etch_refresh';

function cookieSecure(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

function setAuthCookies(c: Context, token: string, refreshToken: string) {
  const secure = cookieSecure(c);
  setCookie(c, ACCESS_COOKIE, token, { httpOnly: true, secure, sameSite: 'Strict', path: '/', maxAge: ACCESS_TOKEN_TTL });
  setCookie(c, REFRESH_COOKIE, refreshToken, { httpOnly: true, secure, sameSite: 'Strict', path: '/', maxAge: REFRESH_TOKEN_TTL / 1000 });
}

function clearAuthCookies(c: Context) {
  const secure = cookieSecure(c);
  deleteCookie(c, ACCESS_COOKIE, { secure, sameSite: 'Strict', path: '/' });
  deleteCookie(c, REFRESH_COOKIE, { secure, sameSite: 'Strict', path: '/' });
}

const LoginSchema = z.object({
  username: z.string().min(1, 'Username required'),
  password: z.string().min(1, 'Password required'),
});
const ChangePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

const auth = new Hono<{ Bindings: Env; Variables: { jwtPayload: JWTPayload } }>();

const ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes (seconds)
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days (ms)
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

async function isRateLimited(db: D1Database, ctx: ExecutionContext, ip: string, nowMs: number): Promise<boolean> {
  const cutoff = nowMs - RATE_LIMIT_WINDOW_MS;
  ctx.waitUntil(db.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(cutoff).run());
  const row = await db.prepare(
    'SELECT COUNT(*) as count FROM login_attempts WHERE ip = ? AND attempted_at > ?'
  ).bind(ip, cutoff).first<{ count: number }>();
  return (row?.count ?? 0) >= RATE_LIMIT_MAX;
}

async function createTokens(
  db: D1Database,
  jwtSecret: string,
  sub: string,
  role: 'admin' | 'editor',
  name?: string,
) {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJWT({ sub, role, name, iat: now, exp: now + ACCESS_TOKEN_TTL }, jwtSecret);

  const refreshToken = crypto.randomUUID();
  const nowMs = Date.now();
  await db.prepare(
    'INSERT INTO refresh_tokens (id, user_sub, user_role, user_name, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(refreshToken, sub, role, name ?? null, nowMs + REFRESH_TOKEN_TTL, nowMs).run();

  return { token, refreshToken };
}

auth.post('/login', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = parseBody(LoginSchema, raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const nowMs = Date.now();

  if (await isRateLimited(c.env.DB, c.executionCtx, ip, nowMs)) {
    return c.json({ error: 'Too many login attempts. Try again later.' }, { status: 429, headers: { 'Retry-After': String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) } });
  }

  // Check hardcoded admin credentials first
  if (body.username === c.env.ADMIN_USERNAME) {
    const valid = await verifyPassword(body.password, c.env.ADMIN_PASSWORD_HASH);
    if (!valid) {
      await c.env.DB.prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)').bind(ip, nowMs).run();
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    await c.env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
    const { token, refreshToken } = await createTokens(c.env.DB, c.env.JWT_SECRET, body.username, 'admin');
    setAuthCookies(c, token, refreshToken);
    return c.json({ role: 'admin', username: body.username, name: null });
  }

  // Check D1 editor users
  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE username = ?'
  ).bind(body.username).first<UserRow>();

  if (!user) {
    // Run a dummy verification so non-existent usernames take the same time as wrong passwords,
    // preventing timing-based username enumeration.
    await verifyPassword(body.password, 'pbkdf2:' + '00'.repeat(16) + ':' + '00'.repeat(32));
    await c.env.DB.prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)').bind(ip, nowMs).run();
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const valid = await verifyPassword(body.password, user.password_hash);
  if (!valid) {
    await c.env.DB.prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)').bind(ip, nowMs).run();
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  // Clear attempts on successful login
  await c.env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();

  const { token, refreshToken } = await createTokens(c.env.DB, c.env.JWT_SECRET, user.username, user.role, user.name || undefined);
  setAuthCookies(c, token, refreshToken);
  return c.json({ role: user.role, username: user.username, name: user.name || null, must_reset_password: user.must_reset_password === 1 });
});

auth.post('/refresh', async (c) => {
  const refreshToken = getCookie(c, REFRESH_COOKIE);
  if (!refreshToken) return c.json({ error: 'Unauthorized' }, 401);

  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const nowMs = Date.now();

  if (await isRateLimited(c.env.DB, c.executionCtx, ip, nowMs)) {
    return c.json({ error: 'Too many attempts. Try again later.' }, { status: 429, headers: { 'Retry-After': String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) } });
  }

  // Prune expired refresh tokens — fire-and-forget so it doesn't block the response
  c.executionCtx.waitUntil(c.env.DB.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').bind(nowMs).run());

  const row = await c.env.DB.prepare(
    'SELECT * FROM refresh_tokens WHERE id = ? AND expires_at > ?'
  ).bind(refreshToken, nowMs).first<{
    id: string; user_sub: string; user_role: string; user_name: string | null;
    expires_at: number; created_at: number;
  }>();

  if (!row) {
    return c.json({ error: 'Invalid or expired refresh token' }, 401);
  }

  // Delete old token and issue new ones (rotation)
  await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE id = ?').bind(row.id).run();

  const { token, refreshToken: newRefreshToken } = await createTokens(
    c.env.DB, c.env.JWT_SECRET,
    row.user_sub, row.user_role as 'admin' | 'editor', row.user_name ?? undefined,
  );

  setAuthCookies(c, token, newRefreshToken);
  return c.json({ ok: true });
});

auth.delete('/logout', async (c) => {
  const refreshToken = getCookie(c, REFRESH_COOKIE);
  if (refreshToken) {
    await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE id = ?').bind(refreshToken).run();
  }
  clearAuthCookies(c);
  return c.json({ ok: true });
});

// PATCH /api/auth/password — change own password (editor accounts only)
auth.patch('/password', authMiddleware, async (c) => {
  const payload = c.get('jwtPayload');

  if (payload.role === 'admin') {
    return c.json({ error: 'Admin password must be changed via: wrangler secret put ADMIN_PASSWORD_HASH' }, 400);
  }

  const raw = await c.req.json().catch(() => null);
  const pwParsed = parseBody(ChangePasswordSchema, raw);
  if (!pwParsed.ok) return c.json({ error: pwParsed.error }, 400);
  const body = pwParsed.data;

  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE username = ?'
  ).bind(payload.sub).first<UserRow>();
  if (!user) return c.json({ error: 'User not found' }, 404);

  if (user.must_reset_password !== 1) {
    if (!body.currentPassword) return c.json({ error: 'currentPassword required' }, 400);
    const valid = await verifyPassword(body.currentPassword, user.password_hash);
    if (!valid) return c.json({ error: 'Current password is incorrect' }, 400);
  }

  const newHash = await hashPassword(body.newPassword);
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, must_reset_password = 0, updated_at = ? WHERE id = ?'
  ).bind(newHash, Date.now(), user.id).run();

  // Revoke all refresh tokens for this user — forces re-login on all devices
  await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_sub = ?').bind(payload.sub).run();

  return c.json({ ok: true });
});

export default auth;
