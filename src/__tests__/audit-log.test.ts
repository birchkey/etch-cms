import { describe, it, expect } from 'vitest';
import { createTestApp, ENV_ADMIN } from './helpers/app';

interface Entry { action: string; actor_id: string; actor_user_id: string | null; actor_deleted: number; resource_type: string }

// logAudit is fire-and-forget; give it a turn to land.
const settle = () => new Promise(r => setTimeout(r, 10));

describe('audit log attribution', () => {
  it('tells an old account\'s actions apart from a new account that reused its username', async () => {
    const t = await createTestApp();
    const { session: admin } = await t.login(ENV_ADMIN.username, ENV_ADMIN.password);

    const makeEd = async (password: string) => {
      const res = await t.request('/api/users', { method: 'POST', cookies: admin, body: { username: 'ed', password } });
      const { id } = await res.json() as { id: string };
      const { session } = await t.login('ed', password);
      await t.request('/api/tokens', { method: 'POST', cookies: session, body: { name: 'ci' } });
      await settle();
      return id;
    };

    const firstEd = await makeEd('first-password');
    await t.request(`/api/users/${firstEd}`, { method: 'DELETE', cookies: admin });
    const secondEd = await makeEd('second-password');

    const res = await t.request('/api/audit-logs', { cookies: admin });
    const { data } = await res.json() as { data: Entry[] };
    const byEd = data.filter(e => e.actor_id === 'ed' && e.action === 'api_token.create');

    expect(byEd).toHaveLength(2);
    expect(byEd.find(e => e.actor_user_id === firstEd)?.actor_deleted).toBe(1);
    expect(byEd.find(e => e.actor_user_id === secondEd)?.actor_deleted).toBe(0);
  });

  it('leaves entries from before the column existed unmarked', async () => {
    const t = await createTestApp();
    const { session: admin } = await t.login(ENV_ADMIN.username, ENV_ADMIN.password);
    t.db.prepare("INSERT INTO audit_logs (id, actor_id, actor_role, action, resource_type, resource_id, created_at) VALUES ('old', 'someone', 'editor', 'entry.create', 'entry', 'e1', 1)").run();

    const { data } = await (await t.request('/api/audit-logs', { cookies: admin })).json() as { data: (Entry & { id: string })[] };
    expect(data.find(e => e.id === 'old')).toMatchObject({ actor_user_id: null, actor_deleted: 0 });
  });

  it('filters to user management actions', async () => {
    const t = await createTestApp();
    const { session: admin } = await t.login(ENV_ADMIN.username, ENV_ADMIN.password);
    await t.request('/api/users', { method: 'POST', cookies: admin, body: { username: 'ed', password: 'ed-password' } });
    await settle();

    const { data } = await (await t.request('/api/audit-logs?resource_type=user', { cookies: admin })).json() as { data: Entry[] };
    expect(data.length).toBeGreaterThan(0);
    expect(data.every(e => e.resource_type === 'user')).toBe(true);
  });
});
