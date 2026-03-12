import { Hono } from 'hono';
import { Env, WebhookRow, WebhookDeliveryRow } from '../types';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { signPayload } from '../lib/utils';
import { z } from 'zod';
import { parseBody } from '../lib/validate';

const CreateWebhookSchema = z.object({ url: z.string().url('Invalid URL') });
const UpdateWebhookSchema = z.object({
  url: z.string().url('Invalid URL').optional(),
  enabled: z.boolean().optional(),
});

const webhooks = new Hono<{ Bindings: Env; Variables: { jwtPayload: unknown } }>();

webhooks.use('*', authMiddleware);
webhooks.use('*', adminOnly);

function maskHook(hook: WebhookRow) {
  const { secret, ...rest } = hook;
  return { ...rest, secret_hint: '...' + secret.slice(-4) };
}

// GET /api/webhooks
webhooks.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM webhooks ORDER BY created_at DESC'
  ).all<WebhookRow>();
  return c.json(results.map(maskHook));
});

// POST /api/webhooks
// URL validation: syntax only. SSRF risk is mitigated by two factors:
// 1. This endpoint is admin-only — admins already have full DB/R2 access.
// 2. Cloudflare Workers blocks outbound requests to private/loopback IP ranges at the platform level.
webhooks.post('/', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = parseBody(CreateWebhookSchema, raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const id = crypto.randomUUID();
  const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  const now = Date.now();

  await c.env.DB.prepare(
    'INSERT INTO webhooks (id, url, secret, enabled, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)'
  ).bind(id, body.url.trim(), secret, now, now).run();

  const hook = await c.env.DB.prepare('SELECT * FROM webhooks WHERE id = ?').bind(id).first<WebhookRow>();
  return c.json(hook, 201);
});

// PATCH /api/webhooks/:id — update url and/or enabled
webhooks.patch('/:id', async (c) => {
  const { id } = c.req.param();
  const hook = await c.env.DB.prepare('SELECT id FROM webhooks WHERE id = ?').bind(id).first();
  if (!hook) return c.json({ error: 'Not found' }, 404);

  const raw = await c.req.json().catch(() => null);
  const patchParsed = parseBody(UpdateWebhookSchema, raw);
  if (!patchParsed.ok) return c.json({ error: patchParsed.error }, 400);
  const body = patchParsed.data;
  const now = Date.now();

  if (body.url !== undefined) {
    await c.env.DB.prepare(
      'UPDATE webhooks SET url = ?, updated_at = ? WHERE id = ?'
    ).bind(body.url.trim(), now, id).run();
  }
  if (body.enabled !== undefined) {
    await c.env.DB.prepare(
      'UPDATE webhooks SET enabled = ?, updated_at = ? WHERE id = ?'
    ).bind(body.enabled ? 1 : 0, now, id).run();
  }

  const updated = await c.env.DB.prepare('SELECT * FROM webhooks WHERE id = ?').bind(id).first<WebhookRow>();
  return c.json(updated ? maskHook(updated) : null);
});

// DELETE /api/webhooks/:id
webhooks.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const hook = await c.env.DB.prepare('SELECT id FROM webhooks WHERE id = ?').bind(id).first();
  if (!hook) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('DELETE FROM webhooks WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// GET /api/webhooks/:id/deliveries — last 50 delivery attempts
webhooks.get('/:id/deliveries', async (c) => {
  const { id } = c.req.param();
  const hook = await c.env.DB.prepare('SELECT id FROM webhooks WHERE id = ?').bind(id).first();
  if (!hook) return c.json({ error: 'Not found' }, 404);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(id).all<WebhookDeliveryRow>();
  return c.json(results);
});

// POST /api/webhooks/:id/test — send a test payload to a single webhook
webhooks.post('/:id/test', async (c) => {
  const { id } = c.req.param();
  const hook = await c.env.DB.prepare('SELECT * FROM webhooks WHERE id = ?').bind(id).first<WebhookRow>();
  if (!hook) return c.json({ error: 'Not found' }, 404);

  const payload = JSON.stringify({
    event: 'webhook.test',
    timestamp: new Date().toISOString(),
    data: { message: 'This is a test webhook from Etch CMS.' },
  });

  const sig = await signPayload(payload, hook.secret);
  const start = Date.now();
  let statusCode: number | null = null;
  let success = 0;
  let error: string | null = null;

  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${sig}`,
        'User-Agent': 'BasicCMS/1.0',
      },
      body: payload,
    });
    statusCode = res.status;
    success = res.ok ? 1 : 0;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Delivery failed';
  }

  const duration = Date.now() - start;
  await c.env.DB.prepare(
    'INSERT INTO webhook_deliveries (id, webhook_id, event, status_code, success, error, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), id, 'webhook.test', statusCode, success, error, duration, Date.now()).run().catch(() => {});

  if (success) {
    return c.json({ ok: true, status: statusCode });
  } else {
    return c.json({ ok: false, status: statusCode, error: error ?? undefined }, 502);
  }
});

export default webhooks;
