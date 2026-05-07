import { Hono } from 'hono';
import { Env, EntryRow, FieldRow, JWTPayload } from '../types';
import { authMiddleware, signJWT } from '../middleware/auth';
import { deliverWebhooks } from '../lib/deliver';
import { generateId, parseFieldValue, slugify } from '../lib/utils';
import { logAudit } from '../lib/audit';
import { getPermittedContentTypeIds, isPermitted } from '../lib/permissions';
import { z } from 'zod';
import { parseBody } from '../lib/validate';

const CreateEntrySchema = z.object({
  content_type_id: z.string().min(1, 'content_type_id required'),
  slug: z.string().nullable().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
});
const UpdateEntrySchema = z.object({
  slug: z.string().nullable().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
});
const ScheduleEntrySchema = z.object({
  scheduled_at: z.number().int().positive('scheduled_at must be a positive integer'),
});

const entries = new Hono<{ Bindings: Env; Variables: { jwtPayload: unknown } }>();

entries.use('*', authMiddleware);

function validateField(value: unknown, field: FieldRow): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (field.type === 'text' || field.type === 'rich_text') {
    const str = field.type === 'rich_text'
      ? String(value).replace(/<[^>]+>/g, '')
      : String(value);
    if (field.min_length !== null && str.length < field.min_length)
      return `Must be at least ${field.min_length} character${field.min_length !== 1 ? 's' : ''}`;
    if (field.max_length !== null && str.length > field.max_length)
      return `Must be ${field.max_length} character${field.max_length !== 1 ? 's' : ''} or fewer`;
    if (field.pattern) {
      try { if (!new RegExp(field.pattern).test(str.slice(0, 1000))) return 'Does not match the required format'; }
      catch { /* invalid regex, skip */ }
    }
  }
  if (field.type === 'number') {
    const num = typeof value === 'number' ? value : Number(value);
    if (!isNaN(num)) {
      if (field.min_value !== null && num < field.min_value) return `Must be at least ${field.min_value}`;
      if (field.max_value !== null && num > field.max_value) return `Must be ${field.max_value} or less`;
    }
  }
  return null;
}

function serializeFieldValue(value: unknown, type: string): string | null {
  if (value === null || value === undefined) return null;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') return String(value);
  if (type === 'relation' || type === 'repeater') return JSON.stringify(value);
  if (Array.isArray(value)) return JSON.stringify(value); // multiple image, multiple select
  return String(value);
}

// Admin always sees the latest values:
// - published + has_unpublished_changes → read from entry_fields_draft
// - otherwise → read from entry_fields (live)
async function getEntryWithFields(db: D1Database, entryId: string) {
  const entry = await db.prepare('SELECT * FROM entries WHERE id = ?').bind(entryId).first<EntryRow>();
  if (!entry) return null;

  const fields = await db.prepare(
    'SELECT * FROM fields WHERE content_type_id = ? ORDER BY sort_order'
  ).bind(entry.content_type_id).all<FieldRow>();

  const table = entry.has_unpublished_changes ? 'entry_fields_draft' : 'entry_fields';
  const efRows = await db.prepare(
    `SELECT * FROM ${table} WHERE entry_id = ?`
  ).bind(entryId).all<{ entry_id: string; field_id: string; value: string | null }>();

  const fieldValues: Record<string, unknown> = {};
  for (const f of fields.results) {
    const ef = efRows.results.find(r => r.field_id === f.id);
    fieldValues[f.slug] = ef ? parseFieldValue(ef.value, f.type) : null;
  }

  return { ...entry, fields: fieldValues, fieldDefs: fields.results };
}

// GET /api/entries/count
entries.get('/count', async (c) => {
  const permitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);

  if (permitted !== null && permitted.length === 0) {
    return c.json({ count: 0, published: 0, draft: 0, scheduled: 0 });
  }

  const bindings: unknown[] = [];
  let whereClause = '';
  if (permitted !== null) {
    const placeholders = permitted.map(() => '?').join(',');
    whereClause = `WHERE content_type_id IN (${placeholders})`;
    bindings.push(...permitted);
  }

  const row = await c.env.DB.prepare(`
    SELECT
      COUNT(*) as count,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published,
      SUM(CASE WHEN status = 'draft'     THEN 1 ELSE 0 END) as draft,
      SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled
    FROM entries ${whereClause}
  `).bind(...bindings).first<{ count: number; published: number; draft: number; scheduled: number }>();
  return c.json({
    count:     row?.count     ?? 0,
    published: row?.published ?? 0,
    draft:     row?.draft     ?? 0,
    scheduled: row?.scheduled ?? 0,
  });
});

// GET /api/entries/attention — per-content-type counts of drafts and unpublished changes
entries.get('/attention', async (c) => {
  const permitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);

  if (permitted !== null && permitted.length === 0) {
    return c.json([]);
  }

  const bindings: unknown[] = [];
  let ctFilter = '';
  if (permitted !== null) {
    const placeholders = permitted.map(() => '?').join(',');
    ctFilter = `AND ct.id IN (${placeholders})`;
    bindings.push(...permitted);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT
      ct.id   AS content_type_id,
      ct.name AS content_type_name,
      ct.slug AS content_type_slug,
      SUM(CASE WHEN e.status = 'draft'              THEN 1 ELSE 0 END) AS draft_count,
      SUM(CASE WHEN e.status = 'scheduled'          THEN 1 ELSE 0 END) AS scheduled_count,
      SUM(CASE WHEN e.has_unpublished_changes = 1   THEN 1 ELSE 0 END) AS changes_count
    FROM content_types ct
    JOIN entries e ON e.content_type_id = ct.id
    WHERE (e.status IN ('draft','scheduled') OR e.has_unpublished_changes = 1) ${ctFilter}
    GROUP BY ct.id, ct.name, ct.slug
    HAVING draft_count > 0 OR scheduled_count > 0 OR changes_count > 0
    ORDER BY ct.name ASC
  `).bind(...bindings).all<{ content_type_id: string; content_type_name: string; content_type_slug: string; draft_count: number; scheduled_count: number; changes_count: number }>();
  return c.json(results);
});

// GET /api/entries/recent — last 7 updated entries with label and content type
entries.get('/recent', async (c) => {
  const permitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);

  if (permitted !== null && permitted.length === 0) {
    return c.json([]);
  }

  const LABEL_SUBQUERY = `(
    SELECT ef.value FROM fields f
    JOIN entry_fields ef ON ef.field_id = f.id AND ef.entry_id = e.id
    WHERE f.content_type_id = ct.id AND f.type IN ('text', 'rich_text')
    ORDER BY f.sort_order LIMIT 1
  )`;
  const LABEL_TYPE_SUBQUERY = `(
    SELECT f.type FROM fields f
    WHERE f.content_type_id = ct.id AND f.type IN ('text', 'rich_text')
    ORDER BY f.sort_order LIMIT 1
  )`;

  const bindings: unknown[] = [];
  let ctFilter = '';
  if (permitted !== null) {
    const placeholders = permitted.map(() => '?').join(',');
    ctFilter = `WHERE ct.id IN (${placeholders})`;
    bindings.push(...permitted);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT e.id, e.status, e.updated_at, e.slug,
           ct.id AS content_type_id, ct.name AS content_type_name, ct.slug AS content_type_slug,
           ${LABEL_SUBQUERY} AS label_raw,
           ${LABEL_TYPE_SUBQUERY} AS label_type
    FROM entries e
    JOIN content_types ct ON ct.id = e.content_type_id
    ${ctFilter}
    ORDER BY e.updated_at DESC
    LIMIT 7
  `).bind(...bindings).all<{ id: string; status: string; updated_at: number; slug: string | null; content_type_id: string; content_type_name: string; content_type_slug: string; label_raw: string | null; label_type: string | null }>();

  return c.json(results.map(r => ({
    id: r.id,
    status: r.status,
    updated_at: r.updated_at,
    slug: r.slug,
    content_type_id: r.content_type_id,
    content_type_name: r.content_type_name,
    content_type_slug: r.content_type_slug,
    label: resolveLabel(r.label_raw, r.label_type, r.slug ?? r.id),
  })));
});

// GET /api/entries/upcoming — next scheduled entries, soonest first
entries.get('/upcoming', async (c) => {
  const permitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);

  if (permitted !== null && permitted.length === 0) {
    return c.json([]);
  }

  const LABEL_SUBQUERY = `(
    SELECT ef.value FROM fields f
    JOIN entry_fields ef ON ef.field_id = f.id AND ef.entry_id = e.id
    WHERE f.content_type_id = ct.id AND f.type IN ('text', 'rich_text')
    ORDER BY f.sort_order LIMIT 1
  )`;
  const LABEL_TYPE_SUBQUERY = `(
    SELECT f.type FROM fields f
    WHERE f.content_type_id = ct.id AND f.type IN ('text', 'rich_text')
    ORDER BY f.sort_order LIMIT 1
  )`;

  const bindings: unknown[] = [];
  let ctFilter = '';
  if (permitted !== null) {
    const placeholders = permitted.map(() => '?').join(',');
    ctFilter = `AND ct.id IN (${placeholders})`;
    bindings.push(...permitted);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT e.id, e.scheduled_at, e.slug,
           ct.id AS content_type_id, ct.name AS content_type_name, ct.slug AS content_type_slug,
           ${LABEL_SUBQUERY} AS label_raw,
           ${LABEL_TYPE_SUBQUERY} AS label_type
    FROM entries e
    JOIN content_types ct ON ct.id = e.content_type_id
    WHERE e.status = 'scheduled' ${ctFilter}
    ORDER BY e.scheduled_at ASC
    LIMIT 5
  `).bind(...bindings).all<{ id: string; scheduled_at: number; slug: string | null; content_type_id: string; content_type_name: string; content_type_slug: string; label_raw: string | null; label_type: string | null }>();

  return c.json(results.map(r => ({
    id: r.id,
    scheduled_at: r.scheduled_at,
    slug: r.slug,
    content_type_id: r.content_type_id,
    content_type_name: r.content_type_name,
    label: resolveLabel(r.label_raw, r.label_type, r.slug ?? r.id),
  })));
});

function resolveLabel(raw: string | null, type: string | null, fallback: string): string {
  if (!raw) return fallback;
  if (type === 'rich_text') return raw.replace(/<[^>]+>/g, '').slice(0, 80) || fallback;
  return raw.slice(0, 80) || fallback;
}

// POST /api/entries
entries.post('/', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = parseBody(CreateEntrySchema, raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const ct = await c.env.DB.prepare('SELECT id FROM content_types WHERE id = ?').bind(body.content_type_id).first();
  if (!ct) return c.json({ error: 'Content type not found' }, 404);
  const permitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(permitted, body.content_type_id)) return c.json({ error: 'Forbidden' }, 403);

  const slug = body.slug ? slugify(body.slug) || null : null;
  if (slug) {
    const conflict = await c.env.DB.prepare(
      'SELECT id FROM entries WHERE content_type_id = ? AND slug = ?'
    ).bind(body.content_type_id, slug).first();
    if (conflict) return c.json({ error: 'Slug already in use' }, 409);
  }

  const id = generateId();
  const now = Date.now();

  const maxRow = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as m FROM entries WHERE content_type_id = ?'
  ).bind(body.content_type_id).first<{ m: number | null }>();
  const sortOrder = (maxRow?.m ?? -1) + 1;

  await c.env.DB.prepare(
    'INSERT INTO entries (id, content_type_id, slug, status, has_unpublished_changes, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)'
  ).bind(id, body.content_type_id, slug, 'draft', sortOrder, now, now).run();

  if (body.fields) {
    const fieldDefs = await c.env.DB.prepare(
      'SELECT * FROM fields WHERE content_type_id = ?'
    ).bind(body.content_type_id).all<FieldRow>();

    const stmts = fieldDefs.results.map(f => {
      const serialized = serializeFieldValue(body.fields![f.slug], f.type);
      return c.env.DB.prepare(
        'INSERT INTO entry_fields (entry_id, field_id, value) VALUES (?, ?, ?)'
      ).bind(id, f.id, serialized);
    });
    if (stmts.length) await c.env.DB.batch(stmts);
  }

  const result = await getEntryWithFields(c.env.DB, id);
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'entry.create', 'entry', id, slug, { content_type_id: body.content_type_id }).catch(() => {});
  return c.json(result, 201);
});

// POST /api/entries/:id/duplicate
entries.post('/:id/duplicate', async (c) => {
  const { id } = c.req.param();
  const source = await getEntryWithFields(c.env.DB, id);
  if (!source) return c.json({ error: 'Not found' }, 404);
  const dupPermitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(dupPermitted, source.content_type_id)) return c.json({ error: 'Forbidden' }, 403);

  const newId = generateId();
  const now = Date.now();

  const maxRow2 = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as m FROM entries WHERE content_type_id = ?'
  ).bind(source.content_type_id).first<{ m: number | null }>();
  const dupSortOrder = (maxRow2?.m ?? -1) + 1;

  await c.env.DB.prepare(
    'INSERT INTO entries (id, content_type_id, slug, status, has_unpublished_changes, sort_order, created_at, updated_at) VALUES (?, ?, NULL, ?, 0, ?, ?, ?)'
  ).bind(newId, source.content_type_id, 'draft', dupSortOrder, now, now).run();

  const firstTextField = source.fieldDefs!.find(f => f.type === 'text');

  const stmts = source.fieldDefs!.map(f => {
    let val = source.fields[f.slug];
    if (f.id === firstTextField?.id && typeof val === 'string') {
      val = `${val} (Duplicate)`;
    }
    const serialized = serializeFieldValue(val, f.type);
    return c.env.DB.prepare(
      'INSERT INTO entry_fields (entry_id, field_id, value) VALUES (?, ?, ?)'
    ).bind(newId, f.id, serialized);
  });
  if (stmts.length) await c.env.DB.batch(stmts);

  const result = await getEntryWithFields(c.env.DB, newId);
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'entry.duplicate', 'entry', newId, null, { source_id: id }).catch(() => {});
  return c.json(result, 201);
});

// GET /api/entries/:id
entries.get('/:id', async (c) => {
  const { id } = c.req.param();
  const result = await getEntryWithFields(c.env.DB, id);
  if (!result) return c.json({ error: 'Not found' }, 404);
  const permitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(permitted, result.content_type_id)) return c.json({ error: 'Forbidden' }, 403);
  return c.json(result);
});

// PUT /api/entries/:id
entries.put('/:id', async (c) => {
  const { id } = c.req.param();
  const entry = await c.env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
  if (!entry) return c.json({ error: 'Not found' }, 404);
  const putPermitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(putPermitted, entry.content_type_id)) return c.json({ error: 'Forbidden' }, 403);

  const raw = await c.req.json().catch(() => null);
  const putParsed = parseBody(UpdateEntrySchema, raw);
  if (!putParsed.ok) return c.json({ error: putParsed.error }, 400);
  const body = putParsed.data;
  const now = Date.now();
  const isPublished = entry.status === 'published';

  if ('slug' in body) {
    const slug = body.slug ? slugify(body.slug) || null : null;
    if (slug) {
      const conflict = await c.env.DB.prepare(
        'SELECT id FROM entries WHERE content_type_id = ? AND slug = ? AND id != ?'
      ).bind(entry.content_type_id, slug, id).first();
      if (conflict) return c.json({ error: 'Slug already in use' }, 409);
    }
    await c.env.DB.prepare('UPDATE entries SET slug = ?, updated_at = ? WHERE id = ?').bind(slug, now, id).run();
  } else {
    await c.env.DB.prepare('UPDATE entries SET updated_at = ? WHERE id = ?').bind(now, id).run();
  }

  let auditChanges: { field: string; from?: unknown; to?: unknown }[] | undefined;

  if (body.fields) {
    const fieldDefs = await c.env.DB.prepare(
      'SELECT * FROM fields WHERE content_type_id = ?'
    ).bind(entry.content_type_id).all<FieldRow>();

    // Compute field-level diff for audit log
    const currentTable = entry.has_unpublished_changes ? 'entry_fields_draft' : 'entry_fields';
    const currentEfRows = await c.env.DB.prepare(
      `SELECT field_id, value FROM ${currentTable} WHERE entry_id = ?`
    ).bind(id).all<{ field_id: string; value: string | null }>();
    const currentMap = new Map(currentEfRows.results.map(r => [r.field_id, r.value]));
    auditChanges = [];
    for (const f of fieldDefs.results) {
      if (body.fields[f.slug] === undefined) continue;
      const newRaw = serializeFieldValue(body.fields[f.slug], f.type);
      const oldRaw = currentMap.get(f.id) ?? null;
      if (oldRaw === newRaw) continue;
      if (f.type === 'rich_text') {
        auditChanges.push({ field: f.slug });
      } else {
        auditChanges.push({ field: f.slug, from: parseFieldValue(oldRaw, f.type), to: parseFieldValue(newRaw, f.type) });
      }
    }

    if (isPublished) {
      // On first edit of a published entry, initialize the draft table from live values
      // so fields not yet touched by this edit still have correct values
      const initStmts: D1PreparedStatement[] = [];
      if (!entry.has_unpublished_changes) {
        initStmts.push(c.env.DB.prepare(
          `INSERT INTO entry_fields_draft (entry_id, field_id, value)
           SELECT entry_id, field_id, value FROM entry_fields WHERE entry_id = ?
           ON CONFLICT(entry_id, field_id) DO UPDATE SET value = excluded.value`
        ).bind(id));
      }

      const fieldStmts = fieldDefs.results
        .filter(f => body.fields![f.slug] !== undefined)
        .map(f => {
          const serialized = serializeFieldValue(body.fields![f.slug], f.type);
          return c.env.DB.prepare(
            `INSERT INTO entry_fields_draft (entry_id, field_id, value) VALUES (?, ?, ?)
             ON CONFLICT(entry_id, field_id) DO UPDATE SET value = excluded.value`
          ).bind(id, f.id, serialized);
        });

      await c.env.DB.batch([
        ...initStmts,
        ...fieldStmts,
        c.env.DB.prepare(
          'UPDATE entries SET has_unpublished_changes = 1, updated_at = ? WHERE id = ?'
        ).bind(now, id),
      ]);
    } else {
      const stmts = fieldDefs.results
        .filter(f => body.fields![f.slug] !== undefined)
        .map(f => {
          const serialized = serializeFieldValue(body.fields![f.slug], f.type);
          return c.env.DB.prepare(
            `INSERT INTO entry_fields (entry_id, field_id, value) VALUES (?, ?, ?)
             ON CONFLICT(entry_id, field_id) DO UPDATE SET value = excluded.value`
          ).bind(id, f.id, serialized);
        });
      if (stmts.length) await c.env.DB.batch(stmts);
    }
  }

  const result = await getEntryWithFields(c.env.DB, id);
  const auditDetails: Record<string, unknown> = { content_type_id: entry.content_type_id };
  if (auditChanges?.length) auditDetails.changes = auditChanges;
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'entry.update', 'entry', id, entry.slug, auditDetails).catch(() => {});
  return c.json(result);
});

// PATCH /api/entries/:id/publish
entries.patch('/:id/publish', async (c) => {
  const { id } = c.req.param();
  const entry = await c.env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
  if (!entry) return c.json({ error: 'Not found' }, 404);
  const publishPermitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(publishPermitted, entry.content_type_id)) return c.json({ error: 'Forbidden' }, 403);

  // Fetch field defs and current values for validation
  const fieldDefs = await c.env.DB.prepare(
    'SELECT * FROM fields WHERE content_type_id = ? ORDER BY sort_order'
  ).bind(entry.content_type_id).all<FieldRow>();

  const table = entry.has_unpublished_changes ? 'entry_fields_draft' : 'entry_fields';
  const efRows = await c.env.DB.prepare(
    `SELECT * FROM ${table} WHERE entry_id = ?`
  ).bind(id).all<{ field_id: string; value: string | null }>();
  const valueMap = new Map(efRows.results.map(r => [r.field_id, r.value]));

  // Required fields + validation rules — collect all field-level errors
  const fieldErrors: Record<string, string> = {};
  for (const f of fieldDefs.results) {
    const raw = valueMap.get(f.id) ?? null;
    if (f.required && (raw === null || raw === undefined || raw === '')) {
      fieldErrors[f.slug] = 'Required';
      continue;
    }
    const err = validateField(parseFieldValue(raw, f.type), f);
    if (err) fieldErrors[f.slug] = err;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return c.json({ error: 'Validation failed', fieldErrors }, 400);
  }

  // Relation fields — soft warning if related entry is not published
  const warnings: string[] = [];
  for (const f of fieldDefs.results.filter(f => f.type === 'relation')) {
    const rawValue = valueMap.get(f.id) ?? null;
    if (!rawValue) continue;
    const parsed = parseFieldValue(rawValue, 'relation');
    const relIds: string[] = typeof parsed === 'string' ? [parsed] : Array.isArray(parsed) ? parsed as string[] : [];
    if (relIds.length === 0) continue;
    const checks = await Promise.all(
      relIds.map(relId => c.env.DB.prepare('SELECT status FROM entries WHERE id = ?').bind(relId).first<{ status: string }>())
    );
    if (checks.some(rel => !rel || rel.status !== 'published')) {
      warnings.push(`"${f.name}" contains unpublished related entries`);
    }
  }

  const now = Date.now();

  if (entry.status === 'draft' || entry.status === 'scheduled') {
    // Draft / Scheduled → Published
    await c.env.DB.prepare(
      'UPDATE entries SET status = ?, published_at = ?, updated_at = ? WHERE id = ?'
    ).bind('published', now, now, id).run();

    c.executionCtx.waitUntil(deliverWebhooks(c.env.DB, 'entry.published', {
      id: entry.id,
      slug: entry.slug,
      content_type_id: entry.content_type_id,
      status: 'published',
    }));
  } else if (entry.has_unpublished_changes) {
    // Published + pending changes → push draft to live
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO entry_fields (entry_id, field_id, value)
         SELECT entry_id, field_id, value FROM entry_fields_draft WHERE entry_id = ?
         ON CONFLICT(entry_id, field_id) DO UPDATE SET value = excluded.value`
      ).bind(id),
      c.env.DB.prepare('DELETE FROM entry_fields_draft WHERE entry_id = ?').bind(id),
      c.env.DB.prepare(
        'UPDATE entries SET has_unpublished_changes = 0, updated_at = ? WHERE id = ?'
      ).bind(now, id),
    ]);

    c.executionCtx.waitUntil(deliverWebhooks(c.env.DB, 'entry.updated', {
      id: entry.id,
      slug: entry.slug,
      content_type_id: entry.content_type_id,
      status: 'published',
    }));
  }

  const result = await getEntryWithFields(c.env.DB, id);
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'entry.publish', 'entry', id, entry.slug, { content_type_id: entry.content_type_id }).catch(() => {});
  return c.json({ ...result, warnings });
});

// PATCH /api/entries/:id/unpublish
entries.patch('/:id/unpublish', async (c) => {
  const { id } = c.req.param();
  const entry = await c.env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
  if (!entry) return c.json({ error: 'Not found' }, 404);
  const unpubPermitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(unpubPermitted, entry.content_type_id)) return c.json({ error: 'Forbidden' }, 403);

  const now = Date.now();

  // Merge any pending draft changes into live fields before unpublishing,
  // so those edits become the starting point when the entry is re-edited as a draft
  const unpubStmts: D1PreparedStatement[] = [];
  if (entry.has_unpublished_changes) {
    unpubStmts.push(
      c.env.DB.prepare(
        `INSERT INTO entry_fields (entry_id, field_id, value)
         SELECT entry_id, field_id, value FROM entry_fields_draft WHERE entry_id = ?
         ON CONFLICT(entry_id, field_id) DO UPDATE SET value = excluded.value`
      ).bind(id),
      c.env.DB.prepare('DELETE FROM entry_fields_draft WHERE entry_id = ?').bind(id),
    );
  }
  unpubStmts.push(
    c.env.DB.prepare(
      'UPDATE entries SET status = ?, has_unpublished_changes = 0, updated_at = ? WHERE id = ?'
    ).bind('draft', now, id),
  );
  await c.env.DB.batch(unpubStmts);

  c.executionCtx.waitUntil(deliverWebhooks(c.env.DB, 'entry.unpublished', {
    id: entry.id,
    slug: entry.slug,
    content_type_id: entry.content_type_id,
    status: 'draft',
  }));

  const result = await getEntryWithFields(c.env.DB, id);
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'entry.unpublish', 'entry', id, entry.slug, { content_type_id: entry.content_type_id }).catch(() => {});
  return c.json(result);
});

// PATCH /api/entries/:id/schedule
entries.patch('/:id/schedule', async (c) => {
  const { id } = c.req.param();
  const entry = await c.env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
  if (!entry) return c.json({ error: 'Not found' }, 404);
  if (entry.status === 'published') return c.json({ error: 'Cannot schedule a published entry' }, 400);
  const schedPermitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(schedPermitted, entry.content_type_id)) return c.json({ error: 'Forbidden' }, 403);

  const raw = await c.req.json().catch(() => null);
  const schedParsed = parseBody(ScheduleEntrySchema, raw);
  if (!schedParsed.ok) return c.json({ error: schedParsed.error }, 400);
  if (schedParsed.data.scheduled_at <= Date.now()) {
    return c.json({ error: 'scheduled_at must be a future timestamp (ms)' }, 400);
  }

  const now = Date.now();
  await c.env.DB.prepare(
    "UPDATE entries SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?"
  ).bind(schedParsed.data.scheduled_at, now, id).run();

  const result = await getEntryWithFields(c.env.DB, id);
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'entry.schedule', 'entry', id, entry.slug, { scheduled_at: schedParsed.data.scheduled_at }).catch(() => {});
  return c.json(result);
});

// PATCH /api/entries/:id/unschedule
entries.patch('/:id/unschedule', async (c) => {
  const { id } = c.req.param();
  const entry = await c.env.DB.prepare('SELECT id, slug, content_type_id FROM entries WHERE id = ?').bind(id).first<{ id: string; slug: string | null; content_type_id: string }>();
  if (!entry) return c.json({ error: 'Not found' }, 404);
  const unschedPermitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(unschedPermitted, entry.content_type_id)) return c.json({ error: 'Forbidden' }, 403);

  const now = Date.now();
  await c.env.DB.prepare(
    "UPDATE entries SET status = 'draft', scheduled_at = NULL, updated_at = ? WHERE id = ?"
  ).bind(now, id).run();

  const result = await getEntryWithFields(c.env.DB, id);
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'entry.unschedule', 'entry', id, entry.slug, { content_type_id: entry.content_type_id }).catch(() => {});
  return c.json(result);
});

// POST /api/entries/:id/preview-token
entries.post('/:id/preview-token', async (c) => {
  const { id } = c.req.param();
  const entry = await c.env.DB.prepare('SELECT id, content_type_id FROM entries WHERE id = ?').bind(id).first<{ id: string; content_type_id: string }>();
  if (!entry) return c.json({ error: 'Not found' }, 404);
  const previewPermitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(previewPermitted, entry.content_type_id)) return c.json({ error: 'Forbidden' }, 403);

  const now = Math.floor(Date.now() / 1000);
  const token = await signJWT({ entryId: id, type: 'preview', iat: now, exp: now + 7 * 24 * 60 * 60 }, c.env.JWT_SECRET);
  const origin = new URL(c.req.url).origin;
  return c.json({ token, url: `${origin}/api/preview/${token}` });
});

// DELETE /api/entries/:id
entries.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const entry = await c.env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
  if (!entry) return c.json({ error: 'Not found' }, 404);
  const delPermitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(delPermitted, entry.content_type_id)) return c.json({ error: 'Forbidden' }, 403);

  await c.env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();

  c.executionCtx.waitUntil(deliverWebhooks(c.env.DB, 'entry.deleted', {
    id: entry.id,
    slug: entry.slug,
    content_type_id: entry.content_type_id,
  }));
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'entry.delete', 'entry', id, entry.slug, { content_type_id: entry.content_type_id }).catch(() => {});
  return c.json({ ok: true });
});

export default entries;
