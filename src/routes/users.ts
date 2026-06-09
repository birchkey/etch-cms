import { Hono } from 'hono';
import { Env, UserRow, JWTPayload } from '../types';
import { authMiddleware, adminOnly, hashPassword } from '../middleware/auth';
import { logAudit } from '../lib/audit';
import { z } from 'zod';
import { parseBody } from '../lib/validate';

const CreateUserSchema = z.object({
  username: z.string().min(1, 'Username required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
});
const UpdateUserSchema = z.object({
  name: z.string().optional(),
  must_reset_password: z.boolean().optional(),
});
const ResetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
const PermissionsSchema = z.object({
  contentTypeIds: z.array(z.string()),
});

const users = new Hono<{ Bindings: Env; Variables: { jwtPayload: unknown } }>();

users.use('*', authMiddleware);
users.use('*', adminOnly);

// GET /api/users
users.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, username, name, role, must_reset_password, created_at, updated_at FROM users ORDER BY created_at DESC'
  ).all<Omit<UserRow, 'password_hash'>>();
  return c.json(results);
});

// POST /api/users
users.post('/', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = parseBody(CreateUserSchema, raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const existing = await c.env.DB.prepare(
    'SELECT id FROM users WHERE username = ?'
  ).bind(body.username).first();
  if (existing) return c.json({ error: 'Username already taken' }, 409);

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(body.password);
  const now = Date.now();
  const name = body.name?.trim() ?? '';

  await c.env.DB.prepare(
    'INSERT INTO users (id, username, name, password_hash, role, must_reset_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
  ).bind(id, body.username.trim(), name, passwordHash, 'editor', now, now).run();

  const user = await c.env.DB.prepare(
    'SELECT id, username, name, role, must_reset_password, created_at, updated_at FROM users WHERE id = ?'
  ).bind(id).first<Omit<UserRow, 'password_hash'>>();

  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'user.create', 'user', id, body.username.trim()).catch(() => {});
  return c.json(user, 201);
});

// PATCH /api/users/:id — update name and/or must_reset_password flag
users.patch('/:id', async (c) => {
  const { id } = c.req.param();
  const user = await c.env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(id).first<{ id: string; username: string }>();
  if (!user) return c.json({ error: 'Not found' }, 404);

  const raw = await c.req.json().catch(() => null);
  const parsed = parseBody(UpdateUserSchema, raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const updates: string[] = [];
  const bindings: unknown[] = [];
  if (parsed.data.name !== undefined) { updates.push('name = ?'); bindings.push(parsed.data.name.trim()); }
  if (parsed.data.must_reset_password !== undefined) { updates.push('must_reset_password = ?'); bindings.push(parsed.data.must_reset_password ? 1 : 0); }
  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  updates.push('updated_at = ?'); bindings.push(Date.now()); bindings.push(id);

  await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...bindings).run();

  const updated = await c.env.DB.prepare(
    'SELECT id, username, name, role, must_reset_password, created_at, updated_at FROM users WHERE id = ?'
  ).bind(id).first<Omit<UserRow, 'password_hash'>>();
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'user.update', 'user', id, user.username, parsed.data).catch(() => {});
  return c.json(updated);
});

// PATCH /api/users/:id/password — reset password
users.patch('/:id/password', async (c) => {
  const { id } = c.req.param();
  const user = await c.env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(id).first<{ id: string; username: string }>();
  if (!user) return c.json({ error: 'Not found' }, 404);

  const raw = await c.req.json().catch(() => null);
  const pwParsed = parseBody(ResetPasswordSchema, raw);
  if (!pwParsed.ok) return c.json({ error: pwParsed.error }, 400);

  const passwordHash = await hashPassword(pwParsed.data.password);
  const now = Date.now();
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, must_reset_password = 1, updated_at = ? WHERE id = ?'
  ).bind(passwordHash, now, id).run();

  // Revoke all active sessions — forces re-login on all devices
  await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_sub = ?').bind(user.username).run();

  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'user.reset_password', 'user', id, user.username).catch(() => {});
  return c.json({ ok: true });
});

// DELETE /api/users/:id
users.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const user = await c.env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(id).first<{ id: string; username: string }>();
  if (!user) return c.json({ error: 'Not found' }, 404);
  if (user.username === (c.get('jwtPayload') as JWTPayload).sub) {
    return c.json({ error: 'You cannot delete your own account' }, 403);
  }
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'user.delete', 'user', id, user.username).catch(() => {});
  return c.json({ ok: true });
});

// GET /api/users/:id/permissions
users.get('/:id/permissions', async (c) => {
  const { id } = c.req.param();
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!user) return c.json({ error: 'Not found' }, 404);

  const { results } = await c.env.DB.prepare(
    'SELECT content_type_id FROM user_permissions WHERE user_id = ?'
  ).bind(id).all<{ content_type_id: string }>();

  return c.json({ contentTypeIds: results.map(r => r.content_type_id) });
});

// PUT /api/users/:id/permissions
users.put('/:id/permissions', async (c) => {
  const { id } = c.req.param();
  const user = await c.env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(id).first<{ id: string; username: string }>();
  if (!user) return c.json({ error: 'Not found' }, 404);

  const raw = await c.req.json().catch(() => null);
  const parsed = parseBody(PermissionsSchema, raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const { contentTypeIds } = parsed.data;

  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare('DELETE FROM user_permissions WHERE user_id = ?').bind(id),
    ...contentTypeIds.map(ctId =>
      c.env.DB.prepare(
        'INSERT INTO user_permissions (user_id, content_type_id) VALUES (?, ?)'
      ).bind(id, ctId)
    ),
  ];
  await c.env.DB.batch(stmts);

  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'user.permissions_update', 'user', id, user.username, { contentTypeIds }).catch(() => {});
  return c.json({ contentTypeIds });
});

export default users;
