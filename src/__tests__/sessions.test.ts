import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, ENV_ADMIN } from './helpers/app';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

async function createEditor(t: TestApp, username = 'ed') {
  const { session: admin } = await t.login(ENV_ADMIN.username, ENV_ADMIN.password);
  const res = await t.request('/api/users', { method: 'POST', cookies: admin, body: { username, password: 'editor-password' } });
  expect(res.status).toBe(201);
  const user = await res.json() as { id: string };
  const { session } = await t.login(username, 'editor-password');
  return { admin, user, session };
}

describe('sessions', () => {
  let t: TestApp;
  beforeEach(async () => { t = await createTestApp(); });

  it('refresh issues a new access token for a live user', async () => {
    const { session } = await createEditor(t);
    session.dropAccessToken();
    expect((await t.request('/api/auth/refresh', { method: 'POST', cookies: session })).status).toBe(200);
    expect((await t.request('/api/assets', { cookies: session })).status).toBe(200);
  });

  it('a deleted user can no longer refresh their session', async () => {
    const { admin, user, session } = await createEditor(t);
    expect((await t.request(`/api/users/${user.id}`, { method: 'DELETE', cookies: admin })).status).toBe(200);

    session.dropAccessToken();
    expect((await t.request('/api/auth/refresh', { method: 'POST', cookies: session })).status).toBe(401);
    expect((await t.request('/api/assets', { cookies: session })).status).toBe(401);
  });

  it('deleting a user removes their refresh tokens', async () => {
    const { admin, user } = await createEditor(t);
    await t.request(`/api/users/${user.id}`, { method: 'DELETE', cookies: admin });
    const row = t.db.prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_sub = ?').get('ed') as { n: number };
    expect(row.n).toBe(0);
  });

  it('a refresh token left behind by a deleted user does not carry over to a new user with the same name', async () => {
    const { admin, user, session } = await createEditor(t);
    // Simulate a token that survived deletion (as they did before this fix).
    const leftover = t.db.prepare('SELECT * FROM refresh_tokens WHERE user_sub = ?').all('ed') as Record<string, never>[];
    await t.request(`/api/users/${user.id}`, { method: 'DELETE', cookies: admin });
    const res = await t.request('/api/users', { method: 'POST', cookies: admin, body: { username: 'ed', password: 'another-password' } });
    expect(res.status).toBe(201);
    for (const r of leftover) {
      t.db.prepare('INSERT INTO refresh_tokens (id, user_sub, user_role, user_name, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(r.id, r.user_sub, r.user_role, r.user_name, r.expires_at, (r.created_at as number) - 1000);
    }

    session.dropAccessToken();
    expect((await t.request('/api/auth/refresh', { method: 'POST', cookies: session })).status).toBe(401);
  });

  it('refresh takes the role from the database, not the old token', async () => {
    const { session } = await createEditor(t);
    // Tamper with the stored role, as a stale token from before a demotion would look.
    t.db.prepare("UPDATE refresh_tokens SET user_role = 'admin' WHERE user_sub = 'ed'").run();
    session.dropAccessToken();
    await t.request('/api/auth/refresh', { method: 'POST', cookies: session });
    expect((await t.request('/api/users', { cookies: session })).status).toBe(403);
  });

  it('resetting a user\'s password ends their sessions', async () => {
    const { admin, user, session } = await createEditor(t);
    await t.request(`/api/users/${user.id}/password`, { method: 'PATCH', cookies: admin, body: { password: 'a-new-password' } });
    session.dropAccessToken();
    expect((await t.request('/api/auth/refresh', { method: 'POST', cookies: session })).status).toBe(401);
  });
});
