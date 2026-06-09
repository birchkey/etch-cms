import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { z } from 'zod';
import { parseBody } from '../lib/validate';

const settings = new Hono<{ Bindings: Env; Variables: { jwtPayload: unknown } }>();

const ALLOWED_KEYS = ['site_name', 'logo_type', 'logo_image_url', 'login_logo_image_url', 'accent_color', 'favicon_url', 'upload_limit_mb', 'jwt_provider', 'jwt_domain', 'jwt_jwks_url', 'jwt_issuer', 'jwt_audience'] as const;
type SettingsKey = typeof ALLOWED_KEYS[number];

const SettingsBodySchema = z.object({
  site_name: z.string().optional(),
  logo_type: z.string().optional(),
  logo_image_url: z.string().optional(),
  login_logo_image_url: z.string().optional(),
  accent_color: z.string().optional(),
  favicon_url: z.string().optional(),
  upload_limit_mb: z.string().optional(),
  jwt_provider: z.string().optional(),
  jwt_domain: z.string().optional(),
  jwt_jwks_url: z.string().optional(),
  jwt_issuer: z.string().optional(),
  jwt_audience: z.string().optional(),
});

// Subset of keys safe to expose without authentication (used to render the login page).
// Adding a key to ALLOWED_KEYS does not automatically make it public — add it here too only if it's safe to expose.
const PUBLIC_KEYS = new Set<SettingsKey>(['site_name', 'logo_type', 'logo_image_url', 'login_logo_image_url', 'accent_color', 'favicon_url', 'upload_limit_mb']);

async function getAll(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const map: Record<string, string> = {};
  for (const row of results) map[row.key] = row.value;
  return map;
}

// GET /api/settings — public, branding keys only
settings.get('/', async (c) => {
  const all = await getAll(c.env.DB);
  const pub: Partial<Record<SettingsKey, string>> = {};
  for (const key of PUBLIC_KEYS) {
    if (key in all) pub[key] = all[key];
  }
  return c.json(pub);
});

// GET /api/settings/admin — admin only, returns all settings including JWT config
settings.get('/admin', authMiddleware, adminOnly, async (c) => {
  return c.json(await getAll(c.env.DB));
});

// PUT /api/settings — admin only
settings.put('/', authMiddleware, adminOnly, async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = parseBody(SettingsBodySchema, raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body: Partial<Record<SettingsKey, string>> = parsed.data;

  for (const key of ALLOWED_KEYS) {
    if (body[key] !== undefined) {
      await c.env.DB.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).bind(key, body[key]).run();
    }
  }

  return c.json(await getAll(c.env.DB));
});

export default settings;
