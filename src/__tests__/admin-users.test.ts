import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createTestApp, ENV_ADMIN, Session } from './helpers/app';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const json = async <T = Record<string, unknown>>(res: Response) => res.json() as Promise<T>;

async function adminSession(t: TestApp) {
  const { res, session } = await t.login(ENV_ADMIN.username, ENV_ADMIN.password);
  expect(res.status).toBe(200);
  return session;
}

async function createUser(t: TestApp, admin: Session, username: string, role: 'admin' | 'editor' = 'editor') {
  const res = await t.request('/api/users', { method: 'POST', cookies: admin, body: { username, password: `${username}-password`, role } });
  expect(res.status).toBe(201);
  return json<{ id: string; role: string }>(res);
}

const userId = (t: TestApp, username: string) =>
  (t.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string }).id;

describe('migration 0012', () => {
  it('keeps users and their content-type permissions when rebuilding the users table', () => {
    const dir = resolve(__dirname, '../../migrations');
    const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    const db = new DatabaseSync(':memory:');
    for (const f of files.filter(f => f < '0012')) db.exec(readFileSync(join(dir, f), 'utf8'));

    db.exec(`
      INSERT INTO content_types (id, name, slug, created_at, updated_at) VALUES ('ct1', 'Posts', 'posts', 0, 0);
      INSERT INTO users (id, username, name, password_hash, role, created_at, updated_at, must_reset_password)
        VALUES ('u1', 'ed', 'Ed', 'h', 'editor', 1, 2, 1);
      INSERT INTO user_permissions (user_id, content_type_id) VALUES ('u1', 'ct1');
    `);
    expect(() => db.exec("INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES ('u2', 'a', 'h', 'admin', 0, 0)")).toThrow();

    for (const f of files.filter(f => f >= '0012')) db.exec(readFileSync(join(dir, f), 'utf8'));

    expect(db.prepare('SELECT * FROM users').all()).toEqual([
      { id: 'u1', username: 'ed', name: 'Ed', password_hash: 'h', role: 'editor', created_at: 1, updated_at: 2, must_reset_password: 1 },
    ]);
    expect(db.prepare('SELECT * FROM user_permissions').all()).toEqual([{ user_id: 'u1', content_type_id: 'ct1' }]);
    db.exec("INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES ('u2', 'a', 'h', 'admin', 0, 0)");
    // The foreign key still cascades.
    db.exec("DELETE FROM users WHERE id = 'u1'");
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_permissions').get()).toEqual({ n: 0 });
  });
});

describe('retiring the environment admin', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });

  it('copies the environment admin into the users table on first sign-in', async () => {
    await adminSession(t);
    const row = t.db.prepare('SELECT username, role, password_hash FROM users').get() as Record<string, string>;
    expect(row).toEqual({ username: ENV_ADMIN.username, role: 'admin', password_hash: t.env.ADMIN_PASSWORD_HASH });
  });

  it('ignores the environment secrets once a database admin exists', async () => {
    const admin = await adminSession(t);
    // Change the database password: the environment password must stop working.
    const res = await t.request('/api/auth/password', { method: 'PATCH', cookies: admin, body: { currentPassword: ENV_ADMIN.password, newPassword: 'a-new-admin-password' } });
    expect(res.status).toBe(200);
    expect((await t.login(ENV_ADMIN.username, ENV_ADMIN.password)).res.status).toBe(401);
    expect((await t.login(ENV_ADMIN.username, 'a-new-admin-password')).res.status).toBe(200);
  });

  it('keeps API tokens the environment admin made before the move', async () => {
    // A token created by the environment admin before this release.
    t.db.prepare("INSERT INTO api_tokens (id, name, token_hash, token_hint, owner_sub, created_at) VALUES ('tok', 'ci', ?, 'etch_abcd', ?, ?)")
      .run(await (await import('../lib/api-tokens')).hashApiToken('etch_legacy-token'), ENV_ADMIN.username, Date.now() - 86_400_000);
    expect((await t.request('/api/users', { bearer: 'etch_legacy-token' })).status).toBe(200);
    await adminSession(t);
    expect((await t.request('/api/users', { bearer: 'etch_legacy-token' })).status).toBe(200);
  });

  it('moves the environment admin first if it promotes someone before signing in', async () => {
    t.db.prepare("INSERT INTO api_tokens (id, name, token_hash, token_hint, owner_sub, created_at) VALUES ('tok', 'ci', ?, 'etch_abcd', ?, ?)")
      .run(await (await import('../lib/api-tokens')).hashApiToken('etch_legacy-token'), ENV_ADMIN.username, Date.now() - 1000);
    const res = await t.request('/api/users', { method: 'POST', bearer: 'etch_legacy-token', body: { username: 'second', password: 'second-password', role: 'admin' } });
    expect(res.status).toBe(201);
    expect((await t.login(ENV_ADMIN.username, ENV_ADMIN.password)).res.status).toBe(200);
  });

  it('refuses to move the admin over an editor with the same username', async () => {
    t.db.prepare("INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES ('e', ?, 'pbkdf2:00:00', 'editor', 0, 0)").run(ENV_ADMIN.username);
    const { res } = await t.login(ENV_ADMIN.username, ENV_ADMIN.password);
    expect(res.status).toBe(409);
    expect(t.db.prepare("SELECT role FROM users").all()).toEqual([{ role: 'editor' }]);
  });

  it('rejects a wrong environment password without creating anything', async () => {
    expect((await t.login(ENV_ADMIN.username, 'nope')).res.status).toBe(401);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
  });
});

describe('admin roles', () => {
  let t: TestApp;
  let admin: Session;
  beforeEach(async () => { t = await createTestApp(); admin = await adminSession(t); });

  it('creates admins who can use admin endpoints', async () => {
    await createUser(t, admin, 'second', 'admin');
    const { session } = await t.login('second', 'second-password');
    expect((await t.request('/api/users', { cookies: session })).status).toBe(200);
  });

  it('defaults new users to editor', async () => {
    const res = await t.request('/api/users', { method: 'POST', cookies: admin, body: { username: 'ed', password: 'ed-password' } });
    expect((await json(res)).role).toBe('editor');
  });

  it('rejects unknown roles', async () => {
    const res = await t.request('/api/users', { method: 'POST', cookies: admin, body: { username: 'x', password: 'x-password', role: 'owner' } });
    expect(res.status).toBe(400);
  });

  it('a demoted admin loses admin access immediately, without waiting for their token to expire', async () => {
    const second = await createUser(t, admin, 'second', 'admin');
    const { session } = await t.login('second', 'second-password');
    expect((await t.request('/api/users', { cookies: session })).status).toBe(200);

    expect((await t.request(`/api/users/${second.id}`, { method: 'PATCH', cookies: admin, body: { role: 'editor' } })).status).toBe(200);
    // Same access token as before the demotion.
    expect((await t.request('/api/users', { cookies: session })).status).toBe(403);
  });

  it('a deleted user loses access immediately', async () => {
    const ed = await createUser(t, admin, 'ed');
    const { session } = await t.login('ed', 'ed-password');
    await t.request(`/api/users/${ed.id}`, { method: 'DELETE', cookies: admin });
    expect((await t.request('/api/assets', { cookies: session })).status).toBe(401);
  });

  it('a demoted admin\'s API tokens lose admin access', async () => {
    const second = await createUser(t, admin, 'second', 'admin');
    const { session } = await t.login('second', 'second-password');
    const tokenRes = await t.request('/api/tokens', { method: 'POST', cookies: session, body: { name: 'ci' } });
    const { token } = await json<{ token: string }>(tokenRes);
    expect((await t.request('/api/users', { bearer: token })).status).toBe(200);

    await t.request(`/api/users/${second.id}`, { method: 'PATCH', cookies: admin, body: { role: 'editor' } });
    expect((await t.request('/api/users', { bearer: token })).status).toBe(403);
  });

  it('refuses to demote the last admin, including yourself', async () => {
    const res = await t.request(`/api/users/${userId(t, ENV_ADMIN.username)}`, { method: 'PATCH', cookies: admin, body: { role: 'editor' } });
    expect(res.status).toBe(409);
    expect((await t.request('/api/users', { cookies: admin })).status).toBe(200);
  });

  it('allows demoting yourself when another admin exists', async () => {
    await createUser(t, admin, 'second', 'admin');
    const res = await t.request(`/api/users/${userId(t, ENV_ADMIN.username)}`, { method: 'PATCH', cookies: admin, body: { role: 'editor' } });
    expect(res.status).toBe(200);
    expect((await t.request('/api/users', { cookies: admin })).status).toBe(403);
  });

  it('two admins demoting each other leaves one admin', async () => {
    const second = await createUser(t, admin, 'second', 'admin');
    const { session } = await t.login('second', 'second-password');
    const results = await Promise.all([
      t.request(`/api/users/${second.id}`, { method: 'PATCH', cookies: admin, body: { role: 'editor' } }),
      t.request(`/api/users/${userId(t, ENV_ADMIN.username)}`, { method: 'PATCH', cookies: session, body: { role: 'editor' } }),
    ]);
    // The loser gets 409 (last admin) or 403 (already demoted, so no longer an admin).
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get()).toEqual({ n: 1 });
  });

  it('admins can change their own password', async () => {
    const res = await t.request('/api/auth/password', { method: 'PATCH', cookies: admin, body: { currentPassword: ENV_ADMIN.password, newPassword: 'changed-password' } });
    expect(res.status).toBe(200);
  });

  it('treats an unrecognised role in the database as editor', async () => {
    const ed = await createUser(t, admin, 'odd');
    t.db.prepare("UPDATE users SET role = 'superuser' WHERE id = ?").run(ed.id);
    const { res, session } = await t.login('odd', 'odd-password');
    expect((await json(res)).role).toBe('editor');
    expect((await t.request('/api/users', { cookies: session })).status).toBe(403);
  });
});
