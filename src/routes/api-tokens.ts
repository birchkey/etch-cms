import { Hono } from 'hono';
import { z } from 'zod';
import { Env, ApiTokenRow, JWTPayload } from '../types';
import { authMiddleware, sessionOnly } from '../middleware/auth';
import { generateApiToken, hashApiToken, tokenHint } from '../lib/api-tokens';
import { logAudit } from '../lib/audit';
import { parseBody } from '../lib/validate';
import { generateId } from '../lib/utils';

const CreateTokenSchema = z.object({
  name: z.string().trim().min(1, 'Name required').max(100, 'Name must be 100 characters or fewer'),
  // null = never expires
  expires_in_days: z.number().int().min(1).max(3650).nullable().optional(),
});

const DAY_MS = 24 * 60 * 60 * 1000;

// Everything except the hash, which never leaves the database.
const PUBLIC_COLUMNS = 'id, name, token_hint, owner_sub, expires_at, last_used_at, created_at';
type PublicToken = Omit<ApiTokenRow, 'token_hash'>;

const tokens = new Hono<{ Bindings: Env; Variables: { jwtPayload: JWTPayload } }>();

tokens.use('*', authMiddleware);

// GET /api/tokens — your own tokens; admins see everyone's.
tokens.get('/', async (c) => {
  const actor = c.get('jwtPayload');
  const stmt = actor.role === 'admin'
    ? c.env.DB.prepare(`SELECT ${PUBLIC_COLUMNS} FROM api_tokens ORDER BY created_at DESC`)
    : c.env.DB.prepare(`SELECT ${PUBLIC_COLUMNS} FROM api_tokens WHERE owner_sub = ? ORDER BY created_at DESC`).bind(actor.sub);
  const { results } = await stmt.all<PublicToken>();
  return c.json(results);
});

// POST /api/tokens — create a token owned by the signed-in user. The plaintext token is
// returned once and never again. A token can't create tokens: a leak must not be able to
// outlive its own revocation.
tokens.post('/', sessionOnly, async (c) => {
  const actor = c.get('jwtPayload');
  const raw = await c.req.json().catch(() => null);
  const parsed = parseBody(CreateTokenSchema, raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const token = generateApiToken();
  const id = generateId();
  const now = Date.now();
  const expiresAt = body.expires_in_days ? now + body.expires_in_days * DAY_MS : null;

  await c.env.DB.prepare(
    'INSERT INTO api_tokens (id, name, token_hash, token_hint, owner_sub, expires_at, last_used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)'
  ).bind(id, body.name, await hashApiToken(token), tokenHint(token), actor.sub, expiresAt, now).run();

  const row = await c.env.DB.prepare(`SELECT ${PUBLIC_COLUMNS} FROM api_tokens WHERE id = ?`).bind(id).first<PublicToken>();
  void logAudit(c.env.DB, actor, 'api_token.create', 'api_token', id, body.name, { expires_at: expiresAt }).catch(() => {});
  return c.json({ ...row, token }, 201);
});

// DELETE /api/tokens/:id — revoke. Owners can revoke their own; admins can revoke any.
tokens.delete('/:id', async (c) => {
  const actor = c.get('jwtPayload');
  const { id } = c.req.param();
  const row = await c.env.DB.prepare('SELECT id, name, owner_sub FROM api_tokens WHERE id = ?')
    .bind(id).first<{ id: string; name: string; owner_sub: string }>();
  // 404 rather than 403 for other people's tokens, so editors can't probe for IDs.
  if (!row || (actor.role !== 'admin' && row.owner_sub !== actor.sub)) {
    return c.json({ error: 'Not found' }, 404);
  }

  await c.env.DB.prepare('DELETE FROM api_tokens WHERE id = ?').bind(id).run();
  void logAudit(c.env.DB, actor, 'api_token.revoke', 'api_token', id, row.name, { owner: row.owner_sub }).catch(() => {});
  return c.json({ ok: true });
});

export default tokens;
