import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie } from 'hono/cookie';
import { Env, EntryRow } from './types';
import { verifyJWT } from './middleware/auth';
import { verifyAssetSignature } from './lib/utils';
import { deliverWebhooks } from './lib/deliver';
import authRoutes from './routes/auth';
import contentTypeRoutes from './routes/content-types';
import entryRoutes from './routes/entries';
import assetRoutes from './routes/assets';
import publicRoutes from './routes/public';
import userRoutes from './routes/users';
import settingsRoutes from './routes/settings';
import webhookRoutes from './routes/webhooks';
import previewRoutes from './routes/preview';
import auditLogRoutes from './routes/audit-log';

import { getAssetFromKV } from '@cloudflare/kv-asset-handler';
// @ts-expect-error -- __STATIC_CONTENT_MANIFEST is a virtual module injected by wrangler at build time
import manifestJSON from '__STATIC_CONTENT_MANIFEST';

const assetManifest = JSON.parse(manifestJSON);

const app = new Hono<{ Bindings: Env }>();

// Public API and preview endpoints are consumed by external frontends — allow cross-origin
app.use('/api/public/*', cors({
  origin: '*',
  allowMethods: ['GET', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));
app.use('/api/preview/*', cors({
  origin: '*',
  allowMethods: ['GET', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});

// API routes
app.route('/api/auth', authRoutes);
app.route('/api/content-types', contentTypeRoutes);
app.route('/api/entries', entryRoutes);
app.route('/api/assets', assetRoutes);
app.route('/api/public', publicRoutes);
app.route('/api/users', userRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/webhooks', webhookRoutes);
app.route('/api/preview', previewRoutes);
app.route('/api/audit-logs', auditLogRoutes);

// Serve R2 objects
// Note: responses are cached by browsers for 1 year via cache-control, but Cloudflare's edge
// will invoke this Worker on every request unless you add Cache API support here. For
// high-traffic deployments, add caches.default.match()/put() calls around the R2 fetch.
app.get('/r2/:key{.+}', async (c) => {
  const key = c.req.param('key');
  const expires = c.req.query('expires');
  const sig = c.req.query('sig');

  if (expires && sig) {
    // External access via signed URL
    const valid = await verifyAssetSignature(`/r2/${key}`, expires, sig, c.env.JWT_SECRET);
    if (!valid) return c.json({ error: 'Forbidden' }, 403);
  } else {
    // Admin UI access via session cookie
    const token = getCookie(c, 'etch_access');
    const payload = token ? await verifyJWT(token, c.env.JWT_SECRET) : null;
    if (!payload) {
      // Allow unauthenticated access to assets used as branding — the login page
      // needs to load the logo and favicon before the user has authenticated.
      const branding = await c.env.DB.prepare(
        "SELECT value FROM settings WHERE key IN ('logo_image_url', 'login_logo_image_url', 'favicon_url')"
      ).all<{ value: string }>();
      const isBranding = branding.results.some(row => row.value === `/r2/${key}`);
      if (!isBranding) return c.json({ error: 'Unauthorized' }, 401);
    }
  }

  const object = await c.env.ASSETS_BUCKET.get(`assets/${key}`);
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000');
  // Prevent scripts in SVGs from executing when opened directly in a browser tab
  headers.set('content-security-policy', "default-src 'none'");

  return new Response(object.body, { headers });
});

// Serve static assets (React SPA)
app.get('*', async (c) => {
  c.header('content-security-policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'");
  try {
    return await getAssetFromKV(
      {
        request: c.req.raw,
        waitUntil: (p: Promise<unknown>) => c.executionCtx.waitUntil(p),
      },
      {
        ASSET_NAMESPACE: c.env.__STATIC_CONTENT,
        ASSET_MANIFEST: assetManifest,
        mapRequestToAsset: (req: Request) => {
          // SPA fallback: serve index.html for non-asset routes
          const url = new URL(req.url);
          if (!url.pathname.includes('.')) {
            return new Request(`${url.origin}/index.html`, req);
          }
          return req;
        },
      }
    );
  } catch {
    // If assets aren't built yet, return a placeholder
    return c.html(`<!DOCTYPE html>
<html>
<head><title>Etch CMS</title></head>
<body>
  <p>Run <code>cd client && npm run build</code> to build the client.</p>
</body>
</html>`);
  }
});

async function handleScheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  const now = Date.now();
  const due = await env.DB.prepare(
    "SELECT * FROM entries WHERE status = 'scheduled' AND scheduled_at <= ? LIMIT 100"
  ).bind(now).all<EntryRow>();

  if (due.results.length === 0) return;

  const stmts = due.results.map(entry =>
    env.DB.prepare(
      "UPDATE entries SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?"
    ).bind(now, now, entry.id)
  );
  await env.DB.batch(stmts);

  // Prune audit logs older than 30 days
  await env.DB.prepare(
    'DELETE FROM audit_logs WHERE created_at < ?'
  ).bind(now - 30 * 24 * 60 * 60 * 1000).run();

  for (const entry of due.results) {
    ctx.waitUntil(deliverWebhooks(env.DB, 'entry.published', {
      id: entry.id,
      slug: entry.slug,
      content_type_id: entry.content_type_id,
      status: 'published',
    }));
  }
}

export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
};
