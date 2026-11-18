// Builds the API routes against an in-memory D1 so tests can drive real HTTP flows.
// index.ts isn't imported because it pulls in a module only wrangler can provide.
import { Hono } from 'hono';
import authRoutes from '../../routes/auth';
import userRoutes from '../../routes/users';
import assetRoutes from '../../routes/assets';
import apiTokenRoutes from '../../routes/api-tokens';
import contentTypeRoutes from '../../routes/content-types';
import auditLogRoutes from '../../routes/audit-log';
import entryRoutes from '../../routes/entries';
import { createMcpRoutes } from '../../routes/mcp';
import { hashPassword } from '../../middleware/auth';
import { createTestD1 } from './d1';
import type { Env } from '../../types';

export const ENV_ADMIN = { username: 'root', password: 'root-password' };

export async function createTestApp() {
  const { d1, raw } = createTestD1();
  const env = {
    DB: d1,
    ASSETS_BUCKET: createFakeR2(),
    JWT_SECRET: 'test-jwt-secret',
    ADMIN_USERNAME: ENV_ADMIN.username,
    ADMIN_PASSWORD_HASH: await hashPassword(ENV_ADMIN.password),
    ENVIRONMENT: 'test',
  } as unknown as Env;

  const app = new Hono<{ Bindings: Env }>();
  app.route('/api/auth', authRoutes);
  app.route('/api/users', userRoutes);
  app.route('/api/assets', assetRoutes);
  app.route('/api/tokens', apiTokenRoutes);
  app.route('/api/content-types', contentTypeRoutes);
  app.route('/api/audit-logs', auditLogRoutes);
  app.route('/api/entries', entryRoutes);
  app.route('/mcp', createMcpRoutes(app));

  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => { pending.push(p); },
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;

  async function request(path: string, init: { method?: string; body?: unknown; cookies?: Session; bearer?: string } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (init.cookies) headers.cookie = init.cookies.header();
    if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
    const res = await app.request(`http://localhost${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }, env, ctx);
    await Promise.all(pending.splice(0));
    init.cookies?.absorb(res);
    return res;
  }

  async function login(username: string, password: string) {
    const session = new Session();
    const res = await request('/api/auth/login', { method: 'POST', body: { username, password }, cookies: session });
    return { res, session };
  }

  return { app, env, ctx, pending, db: raw, request, login };
}

// The slice of R2 the asset routes use, kept in memory.
export function createFakeR2() {
  const objects = new Map<string, { body: Uint8Array; contentType?: string }>();
  return {
    objects,
    async put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
      objects.set(key, { body: new Uint8Array(value), contentType: opts?.httpMetadata?.contentType });
    },
    async head(key: string) {
      const o = objects.get(key);
      return o ? { size: o.body.byteLength, httpMetadata: { contentType: o.contentType } } : null;
    },
    async delete(key: string) { objects.delete(key); },
  };
}

// A cookie jar for one browser session.
export class Session {
  cookies = new Map<string, string>();

  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const [name, value] = pair.split('=');
      const expired = attrs.some(a => /max-age=0/i.test(a.trim())) || value === '';
      if (expired) this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value);
    }
  }

  // Simulates the 15-minute access token expiring, leaving only the refresh token.
  dropAccessToken() {
    this.cookies.delete('etch_access');
    return this;
  }
}
