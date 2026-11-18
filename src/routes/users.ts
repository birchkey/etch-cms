import { Hono } from 'hono';
import { Env, UserRow, JWTPayload } from '../types';
import { authMiddleware, adminOnly, hashPassword } from '../middleware/auth';
import { logAudit } from '../lib/audit';
import { z } from 'zod';
import { parseBody } from '../lib/validate';
import { ROLES, KEEPS_AN_ADMIN, migrateLegacyAdminIfPending, normalizeRole } from '../lib/users';
import { requirePasswordConfirmation } from '../lib/reauth';

const CreateUserSchema = z.object({
  username: z.string().min(1, 'Username required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
  role: z.enum(ROLES).optional(),
  // The acting admin's own password; required when the request grants admin access.
  currentPassword: z.string().optional(),
});
const UpdateUserSchema = z.object({
  name: z.string().optional(),
  must_reset_password: z.boolean().optional(),
  role: z.enum(ROLES).optional(),
  currentPassword: z.string().optional(),
});

const LAST_ADMIN_ERROR = 'There must always be at least one admin. Make someone else an admin first.';
const ResetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  currentPassword: z.string().optional(),
});
const PermissionsSchema = z.object({
  contentTypeIds: z.array(z.string()),
});

const users = new Hono<{ Bindings: Env; Variables: { jwtPayload: JWTPayload } }>();

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

  if (body.role === 'admin') {
    const denied = await requirePasswordConfirmation(c, body.currentPassword);
    if (denied) return denied;
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM users WHERE username = ?'
  ).bind(body.username).first();
  if (existing) return c.json({ error: 'Username already taken' }, 409);

  if (body.role === 'admin') await migrateLegacyAdminIfPending(c.env);

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(body.password);
  const now = Date.now();
  const name = body.name?.trim() ?? '';

  await c.env.DB.prepare(
    'INSERT INTO users (id, username, name, password_hash, role, must_reset_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
  ).bind(id, body.username.trim(), name, passwordHash, body.role ?? 'editor', now, now).run();

  const user = await c.env.DB.prepare(
    'SELECT id, username, name, role, must_reset_password, created_at, updated_at FROM users WHERE id = ?'
  ).bind(id).first<Omit<UserRow, 'password_hash'>>();

  void logAudit(c.env.DB, c.get('jwtPayload'), 'user.create', 'user', id, body.username.trim(), { role: body.role ?? 'editor' }).catch(() => {});
  return c.json(user, 201);
});

// PATCH /api/users/:id — update name, role and/or must_reset_password flag
users.patch('/:id', async (c) => {
  const { id } = c.req.param();
  const user = await c.env.DB.prepare('SELECT id, username, role FROM users WHERE id = ?').bind(id).first<{ id: string; username: string; role: string }>();
  if (!user) return c.json({ error: 'Not found' }, 404);

  const raw = await c.req.json().catch(() => null);
  const parsed = parseBody(UpdateUserSchema, raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const updates: string[] = [];
  const bindings: unknown[] = [];
  if (parsed.data.name !== undefined) { updates.push('name = ?'); bindings.push(parsed.data.name.trim()); }
  if (parsed.data.must_reset_password !== undefined) { updates.push('must_reset_password = ?'); bindings.push(parsed.data.must_reset_password ? 1 : 0); }
  const roleChanged = parsed.data.role !== undefined && parsed.data.role !== user.role;
  if (roleChanged) { updates.push('role = ?'); bindings.push(parsed.data.role); }
  if (roleChanged && parsed.data.role === 'admin') {
    const denied = await requirePasswordConfirmation(c, parsed.data.currentPassword);
    if (denied) return denied;
    await migrateLegacyAdminIfPending(c.env);
  }
  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  updates.push('updated_at = ?'); bindings.push(Date.now()); bindings.push(id);

  // Demoting the last admin is refused in the same statement that would do it.
  const where = roleChanged ? `id = ? AND ${KEEPS_AN_ADMIN}` : 'id = ?';
  if (roleChanged) bindings.push(id);
  const result = await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE ${where}`).bind(...bindings).run();
  if (result.meta.changes === 0) return c.json({ error: LAST_ADMIN_ERROR }, 409);

  // Sessions pick the new role up on their next request; ending them makes the change
  // visible in the UI straight away rather than on the next sign-in.
  if (roleChanged) {
    await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_sub = ?').bind(user.username).run();
  }

  const updated = await c.env.DB.prepare(
    'SELECT id, username, name, role, must_reset_password, created_at, updated_at FROM users WHERE id = ?'
  ).bind(id).first<Omit<UserRow, 'password_hash'>>();
  // Never record the confirming password in the audit log.
  const { currentPassword: _omit, ...changes } = parsed.data;
  void logAudit(c.env.DB, c.get('jwtPayload'), 'user.update', 'user', id, user.username, changes).catch(() => {});
  return c.json(updated);
});

// PATCH /api/users/:id/password — reset password
users.patch('/:id/password', async (c) => {
  const { id } = c.req.param();
  const user = await c.env.DB.prepare('SELECT id, username, role FROM users WHERE id = ?').bind(id).first<{ id: string; username: string; role: string }>();
  if (!user) return c.json({ error: 'Not found' }, 404);

  const raw = await c.req.json().catch(() => null);
  const pwParsed = parseBody(ResetPasswordSchema, raw);
  if (!pwParsed.ok) return c.json({ error: pwParsed.error }, 400);

  // Setting another admin's password amounts to signing in as them.
  if (normalizeRole(user.role) === 'admin') {
    const denied = await requirePasswordConfirmation(c, pwParsed.data.currentPassword);
    if (denied) return denied;
  }

  const passwordHash = await hashPassword(pwParsed.data.password);
  const now = Date.now();
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, must_reset_password = 1, updated_at = ? WHERE id = ?'
  ).bind(passwordHash, now, id).run();

  // Revoke all active sessions — forces re-login on all devices
  await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_sub = ?').bind(user.username).run();

  void logAudit(c.env.DB, c.get('jwtPayload'), 'user.reset_password', 'user', id, user.username).catch(() => {});
  return c.json({ ok: true });
});

// DELETE /api/users/:id
users.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const user = await c.env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(id).first<{ id: string; username: string }>();
  if (!user) return c.json({ error: 'Not found' }, 404);
  if (user.username === (c.get('jwtPayload')).sub) {
    return c.json({ error: 'You cannot delete your own account' }, 403);
  }
  const deleted = await c.env.DB.prepare(`DELETE FROM users WHERE id = ? AND ${KEEPS_AN_ADMIN}`).bind(id, id).run();
  if (deleted.meta.changes === 0) return c.json({ error: LAST_ADMIN_ERROR }, 409);
  await c.env.DB.batch([
    // Sessions and tokens would stop working anyway (the owner can't be resolved), but don't
    // leave them around to come back to life if the username is reused.
    c.env.DB.prepare('DELETE FROM api_tokens WHERE owner_sub = ?').bind(user.username),
    c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_sub = ?').bind(user.username),
  ]);
  void logAudit(c.env.DB, c.get('jwtPayload'), 'user.delete', 'user', id, user.username).catch(() => {});
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

  void logAudit(c.env.DB, c.get('jwtPayload'), 'user.permissions_update', 'user', id, user.username, { contentTypeIds }).catch(() => {});
  return c.json({ contentTypeIds });
});

export default users;
