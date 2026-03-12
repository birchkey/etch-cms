import { WebhookRow } from '../types';
import { signPayload } from './utils';

export async function deliverWebhooks(
  db: D1Database,
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  const { results } = await db.prepare(
    'SELECT * FROM webhooks WHERE enabled = 1'
  ).all<WebhookRow>();

  if (results.length === 0) return;

  const payload = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data,
  });

  await Promise.allSettled(
    results.map(async (hook) => {
      const sig = await signPayload(payload, hook.secret);
      const start = Date.now();
      let statusCode: number | null = null;
      let success = 0;
      let error: string | null = null;

      for (let attempt = 0; attempt < 2; attempt++) {
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
          error = res.ok ? null : `HTTP ${res.status}`;
        } catch (err) {
          error = err instanceof Error ? err.message : 'Delivery failed';
        }
        if (success) break;
      }

      const duration = Date.now() - start;
      await db.prepare(
        'INSERT INTO webhook_deliveries (id, webhook_id, event, status_code, success, error, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), hook.id, event, statusCode, success, error, duration, Date.now()).run().catch(() => {});
    })
  );
}
