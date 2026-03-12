import { Hono } from 'hono';
import { Env, FieldRow } from '../types';
import { verifySignature } from '../middleware/auth';
import { parseFieldValue } from '../lib/utils';

const preview = new Hono<{ Bindings: Env }>();

// GET /api/preview/:token — serve draft entry data for preview consumers (e.g. Webstudio)
preview.get('/:token', async (c) => {
  const { token } = c.req.param();

  const payload = await verifySignature(token, c.env.JWT_SECRET);
  if (!payload || payload.type !== 'preview' || typeof payload.entryId !== 'string') {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const entry = await c.env.DB.prepare(
    'SELECT * FROM entries WHERE id = ?'
  ).bind(payload.entryId).first<{ id: string; content_type_id: string; slug: string | null; status: string; has_unpublished_changes: number; published_at: number | null; created_at: number; updated_at: number }>();
  if (!entry) return c.json({ error: 'Not found' }, 404);

  const fields = await c.env.DB.prepare(
    'SELECT * FROM fields WHERE content_type_id = ? ORDER BY sort_order'
  ).bind(entry.content_type_id).all<FieldRow>();

  // Read from draft table if there are unpublished changes, otherwise from live
  const table = entry.has_unpublished_changes ? 'entry_fields_draft' : 'entry_fields';
  const efRows = await c.env.DB.prepare(
    `SELECT * FROM ${table} WHERE entry_id = ?`
  ).bind(entry.id).all<{ field_id: string; value: string | null }>();

  const fieldValues: Record<string, unknown> = {};
  for (const f of fields.results) {
    const ef = efRows.results.find(r => r.field_id === f.id);
    fieldValues[f.slug] = ef ? parseFieldValue(ef.value, f.type) : null;
  }

  c.header('Cache-Control', 'no-store');

  return c.json({
    id: entry.id,
    slug: entry.slug,
    status: entry.status,
    published_at: entry.published_at,
    fields: fieldValues,
  });
});

export default preview;
