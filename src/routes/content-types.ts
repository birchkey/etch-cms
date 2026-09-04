import { Hono } from 'hono';
import { Env, ContentTypeRow, FieldRow, JWTPayload } from '../types';
import { authMiddleware, adminOnly } from '../middleware/auth';
import { generateId, isSafeRegex, parseFieldValue, slugify, slugifyUnderscore } from '../lib/utils';
import { logAudit } from '../lib/audit';
import { getPermittedContentTypeIds, isPermitted } from '../lib/permissions';
import { getEntryWithFields } from './entries';
import { z } from 'zod';
import { parseBody } from '../lib/validate';

const FieldSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Field name required'),
  slug: z.string().optional(),
  type: z.enum(['text', 'rich_text', 'image', 'number', 'datetime', 'boolean', 'relation', 'select', 'email', 'phone', 'color', 'repeater', 'icon']),
  required: z.boolean().optional(),
  multiple: z.boolean().optional(),
  sort_order: z.number().optional(),
  relation_content_type_id: z.string().nullable().optional(),
  relation_cardinality: z.enum(['one', 'many']).nullable().optional(),
  rich_text_extensions: z.string().nullable().optional(),
  select_options: z.string().nullable().optional(),
  min_length: z.number().nullable().optional(),
  max_length: z.number().nullable().optional(),
  min_value: z.number().nullable().optional(),
  max_value: z.number().nullable().optional(),
  pattern: z.string().nullable().optional(),
  phone_format: z.enum(['us', 'international']).nullable().optional(),
  repeater_subfields: z.string().nullable().optional(),
  helper_text: z.string().nullable().optional(),
});
const CreateContentTypeSchema = z.object({
  name: z.string().min(1, 'Name required'),
  slug: z.string().optional(),
  description: z.string().optional(),
  preview_url: z.string().nullable().optional(),
  is_singleton: z.boolean().optional(),
  fields: z.array(FieldSchema).optional(),
});
const UpdateContentTypeSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().optional(),
  description: z.string().optional(),
  preview_url: z.string().nullable().optional(),
  is_singleton: z.boolean().optional(),
  fields: z.array(FieldSchema).optional(),
});
const ReorderSchema = z.object({ ids: z.array(z.string()).min(1, 'ids must be a non-empty array') });

const contentTypes = new Hono<{ Bindings: Env; Variables: { jwtPayload: unknown } }>();

contentTypes.use('*', authMiddleware);
// Mutations are admin-only; reads are open to all authenticated users
contentTypes.on('POST', '/', adminOnly);
contentTypes.on('PUT', '/:id', adminOnly);
contentTypes.on('DELETE', '/:id', adminOnly);
// GET /api/content-types
contentTypes.get('/', async (c) => {
  const permitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);

  if (permitted !== null && permitted.length === 0) {
    return c.json([]);
  }

  if (permitted !== null) {
    const placeholders = permitted.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM content_types WHERE id IN (${placeholders}) ORDER BY name ASC`
    ).bind(...permitted).all<ContentTypeRow>();
    return c.json(results);
  }

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM content_types ORDER BY name ASC'
  ).all<ContentTypeRow>();
  return c.json(results);
});

// POST /api/content-types
contentTypes.post('/', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = parseBody(CreateContentTypeSchema, raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  const id = generateId();
  const slug = body.slug || slugify(body.name);
  const now = Date.now();

  await c.env.DB.prepare(
    'INSERT INTO content_types (id, name, slug, description, preview_url, is_singleton, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.name, slug, body.description ?? null, body.preview_url ?? null, body.is_singleton ? 1 : 0, now, now).run();

  // Insert fields if provided
  if (body.fields?.length) {
    for (const f of body.fields) {
      if (f.pattern && !isSafeRegex(f.pattern)) {
        return c.json({ error: `Field "${f.name}" has an unsafe regex pattern` }, 400);
      }
    }
    const stmts = body.fields.map((f, i) => {
      const fId = generateId();
      const fSlug = f.slug || slugifyUnderscore(f.name);
      return c.env.DB.prepare(
        `INSERT INTO fields (id, content_type_id, name, slug, type, required, multiple, sort_order, relation_content_type_id, relation_cardinality, rich_text_extensions, select_options, min_length, max_length, min_value, max_value, pattern, phone_format, repeater_subfields, helper_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        fId, id, f.name, fSlug, f.type,
        f.required ? 1 : 0,
        f.multiple ? 1 : 0,
        f.sort_order ?? i,
        f.relation_content_type_id ?? null,
        f.relation_cardinality ?? null,
        f.rich_text_extensions ?? null,
        f.select_options ?? null,
        f.min_length ?? null,
        f.max_length ?? null,
        f.min_value ?? null,
        f.max_value ?? null,
        f.pattern ?? null,
        f.phone_format ?? null,
        f.repeater_subfields ?? null,
        f.helper_text ?? null,
        now
      );
    });
    await c.env.DB.batch(stmts);
  }

  const ct = await c.env.DB.prepare('SELECT * FROM content_types WHERE id = ?').bind(id).first<ContentTypeRow>();
  const fields = await c.env.DB.prepare('SELECT * FROM fields WHERE content_type_id = ? ORDER BY sort_order').bind(id).all<FieldRow>();
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'content_type.create', 'content_type', id, ct!.name, { slug: ct!.slug }).catch(() => {});
  return c.json({ ...ct, fields: fields.results }, 201);
});

// GET /api/content-types/:id
contentTypes.get('/:id', async (c) => {
  const { id } = c.req.param();
  const ct = await c.env.DB.prepare('SELECT * FROM content_types WHERE id = ?').bind(id).first<ContentTypeRow>();
  if (!ct) return c.json({ error: 'Not found' }, 404);
  const permitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(permitted, id)) return c.json({ error: 'Forbidden' }, 403);
  const fields = await c.env.DB.prepare('SELECT * FROM fields WHERE content_type_id = ? ORDER BY sort_order').bind(id).all<FieldRow>();
  return c.json({ ...ct, fields: fields.results });
});

// GET /api/content-types/:id/entries/select — lightweight list for relation pickers
contentTypes.get('/:id/entries/select', async (c) => {
  const { id } = c.req.param();
  const permitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(permitted, id)) return c.json({ error: 'Forbidden' }, 403);
  // Get the content type to find the first text field for label
  const fields = await c.env.DB.prepare(
    "SELECT * FROM fields WHERE content_type_id = ? AND type IN ('text','rich_text') ORDER BY sort_order LIMIT 1"
  ).bind(id).all<FieldRow>();

  const labelField = fields.results[0];
  const entries = await c.env.DB.prepare(
    'SELECT * FROM entries WHERE content_type_id = ? ORDER BY created_at DESC'
  ).bind(id).all<{ id: string; status: string }>();

  if (!labelField || entries.results.length === 0) {
    return c.json(entries.results.map(e => ({ id: e.id, label: e.id, status: e.status })));
  }

  // Batch-fetch label values for all entries in one query
  const entryIds = entries.results.map(e => e.id);
  const placeholders = entryIds.map(() => '?').join(',');
  const efRows = await c.env.DB.prepare(
    `SELECT entry_id, value FROM entry_fields WHERE field_id = ? AND entry_id IN (${placeholders})`
  ).bind(labelField.id, ...entryIds).all<{ entry_id: string; value: string | null }>();

  const labelMap = new Map(efRows.results.map(r => [r.entry_id, r.value]));

  const result = entries.results.map(entry => {
    let label = labelMap.get(entry.id) ?? entry.id;
    if (labelField.type === 'rich_text' && label) {
      label = label.replace(/<[^>]+>/g, '').slice(0, 80);
    }
    return { id: entry.id, label, status: entry.status };
  });
  return c.json(result);
});

// GET /api/content-types/:typeId/singleton
// Resolves the one entry belonging to a singleton content type, provisioning it on first
// access. The entry is created already published — an empty global is a far less alarming
// failure for a frontend than a 404 on a site-wide fetch. Required-field validation is
// deliberately skipped here; it still applies to every later publish.
contentTypes.get('/:typeId/singleton', async (c) => {
  const { typeId } = c.req.param();
  const ct = await c.env.DB.prepare('SELECT * FROM content_types WHERE id = ?').bind(typeId).first<ContentTypeRow>();
  if (!ct) return c.json({ error: 'Not found' }, 404);
  if (!ct.is_singleton) return c.json({ error: 'Not a single-entry content type' }, 400);
  const permitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(permitted, typeId)) return c.json({ error: 'Forbidden' }, 403);

  const id = generateId();
  const now = Date.now();

  // Guarded INSERT ... SELECT so two concurrent first-visits cannot both provision an
  // entry — SQLite evaluates the NOT EXISTS within the same statement.
  await c.env.DB.prepare(
    `INSERT INTO entries (id, content_type_id, slug, status, has_unpublished_changes, sort_order, created_at, updated_at, published_at)
     SELECT ?, ?, NULL, 'published', 0, 0, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM entries WHERE content_type_id = ?)`
  ).bind(id, typeId, now, now, now, typeId).run();

  const row = await c.env.DB.prepare(
    'SELECT id FROM entries WHERE content_type_id = ? ORDER BY created_at ASC LIMIT 1'
  ).bind(typeId).first<{ id: string }>();
  if (!row) return c.json({ error: 'Failed to provision entry' }, 500);

  const created = row.id === id;
  if (created) {
    void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'entry.create', 'entry', id, ct.name, { content_type_id: typeId, singleton: true }).catch(() => {});
  }
  return c.json(await getEntryWithFields(c.env.DB, row.id), created ? 201 : 200);
});

// PUT /api/content-types/:id
contentTypes.put('/:id', async (c) => {
  const { id } = c.req.param();
  const ct = await c.env.DB.prepare('SELECT * FROM content_types WHERE id = ?').bind(id).first<ContentTypeRow>();
  if (!ct) return c.json({ error: 'Not found' }, 404);

  const raw = await c.req.json().catch(() => null);
  const putParsed = parseBody(UpdateContentTypeSchema, raw);
  if (!putParsed.ok) return c.json({ error: putParsed.error }, 400);
  const body = putParsed.data;

  const now = Date.now();
  const name = body.name ?? ct.name;
  const slug = body.slug ?? ct.slug;
  const description = body.description !== undefined ? body.description : ct.description;
  const preview_url = body.preview_url !== undefined ? body.preview_url : ct.preview_url;
  const is_singleton = body.is_singleton !== undefined ? (body.is_singleton ? 1 : 0) : ct.is_singleton;

  // A singleton holds exactly one entry, so it can only be turned on when the type has
  // at most one entry — otherwise we'd silently orphan the rest.
  if (is_singleton === 1 && ct.is_singleton === 0) {
    const countRow = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM entries WHERE content_type_id = ?'
    ).bind(id).first<{ count: number }>();
    if ((countRow?.count ?? 0) > 1) {
      return c.json({ error: `Cannot make "${ct.name}" a single-entry type — it has ${countRow!.count} entries. Delete all but one first.` }, 400);
    }
  }

  await c.env.DB.prepare(
    'UPDATE content_types SET name = ?, slug = ?, description = ?, preview_url = ?, is_singleton = ?, updated_at = ? WHERE id = ?'
  ).bind(name, slug, description, preview_url, is_singleton, now, id).run();

  // Diff fields to preserve entry_fields data for existing fields
  if (body.fields !== undefined) {
    for (const f of body.fields) {
      if (f.pattern && !isSafeRegex(f.pattern)) {
        return c.json({ error: `Field "${f.name}" has an unsafe regex pattern` }, 400);
      }
    }
    const existingFields = await c.env.DB.prepare(
      'SELECT id FROM fields WHERE content_type_id = ?'
    ).bind(id).all<{ id: string }>();
    const existingIds = new Set(existingFields.results.map(f => f.id));
    const incomingIds = new Set(body.fields.map(f => f.id).filter(Boolean) as string[]);

    const stmts: D1PreparedStatement[] = [];

    // Delete fields that were removed (cascade will clean up entry_fields)
    for (const existingId of existingIds) {
      if (!incomingIds.has(existingId)) {
        stmts.push(c.env.DB.prepare('DELETE FROM fields WHERE id = ?').bind(existingId));
      }
    }

    // Update existing fields or insert new ones
    for (let i = 0; i < body.fields.length; i++) {
      const f = body.fields[i];
      const fSlug = f.slug || slugifyUnderscore(f.name);
      if (f.id && existingIds.has(f.id)) {
        stmts.push(c.env.DB.prepare(
          `UPDATE fields SET name = ?, slug = ?, type = ?, required = ?, multiple = ?, sort_order = ?,
           relation_content_type_id = ?, relation_cardinality = ?, rich_text_extensions = ?, select_options = ?,
           min_length = ?, max_length = ?, min_value = ?, max_value = ?, pattern = ?, phone_format = ?,
           repeater_subfields = ?, helper_text = ? WHERE id = ?`
        ).bind(
          f.name, fSlug, f.type,
          f.required ? 1 : 0,
          f.multiple ? 1 : 0,
          f.sort_order ?? i,
          f.relation_content_type_id ?? null,
          f.relation_cardinality ?? null,
          f.rich_text_extensions ?? null,
          f.select_options ?? null,
          f.min_length ?? null,
          f.max_length ?? null,
          f.min_value ?? null,
          f.max_value ?? null,
          f.pattern ?? null,
          f.phone_format ?? null,
          f.repeater_subfields ?? null,
          f.helper_text ?? null,
          f.id
        ));
      } else {
        const fId = generateId();
        stmts.push(c.env.DB.prepare(
          `INSERT INTO fields (id, content_type_id, name, slug, type, required, multiple, sort_order, relation_content_type_id, relation_cardinality, rich_text_extensions, select_options, min_length, max_length, min_value, max_value, pattern, phone_format, helper_text, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          fId, id, f.name, fSlug, f.type,
          f.required ? 1 : 0,
          f.multiple ? 1 : 0,
          f.sort_order ?? i,
          f.relation_content_type_id ?? null,
          f.relation_cardinality ?? null,
          f.rich_text_extensions ?? null,
          f.select_options ?? null,
          f.min_length ?? null,
          f.max_length ?? null,
          f.min_value ?? null,
          f.max_value ?? null,
          f.pattern ?? null,
          f.phone_format ?? null,
          f.helper_text ?? null,
          now
        ));
      }
    }

    if (stmts.length) await c.env.DB.batch(stmts);
  }

  const updated = await c.env.DB.prepare('SELECT * FROM content_types WHERE id = ?').bind(id).first<ContentTypeRow>();
  const fields = await c.env.DB.prepare('SELECT * FROM fields WHERE content_type_id = ? ORDER BY sort_order').bind(id).all<FieldRow>();
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'content_type.update', 'content_type', id, updated!.name, { slug: updated!.slug }).catch(() => {});
  return c.json({ ...updated, fields: fields.results });
});

// DELETE /api/content-types/:id
contentTypes.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const ct = await c.env.DB.prepare('SELECT * FROM content_types WHERE id = ?').bind(id).first<ContentTypeRow>();
  if (!ct) return c.json({ error: 'Not found' }, 404);
  await c.env.DB.prepare('DELETE FROM content_types WHERE id = ?').bind(id).run();
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'content_type.delete', 'content_type', id, ct.name, { slug: ct.slug }).catch(() => {});
  return c.json({ ok: true });
});

// GET /api/content-types/:typeId/entries/export
contentTypes.get('/:typeId/entries/export', async (c) => {
  const { typeId } = c.req.param();
  const format = c.req.query('format') === 'csv' ? 'csv' : 'json';
  const status = c.req.query('status');

  const ct = await c.env.DB.prepare('SELECT * FROM content_types WHERE id = ?').bind(typeId).first<ContentTypeRow>();
  if (!ct) return c.json({ error: 'Not found' }, 404);
  const permitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(permitted, typeId)) return c.json({ error: 'Forbidden' }, 403);

  let whereClause = 'WHERE e.content_type_id = ?';
  const bindings: unknown[] = [typeId];
  if (status === 'changes') {
    whereClause += ' AND e.has_unpublished_changes = 1';
  } else if (status) {
    whereClause += ' AND e.status = ?';
    bindings.push(status);
  }

  const entries = await c.env.DB.prepare(
    `SELECT * FROM entries e ${whereClause} ORDER BY e.created_at DESC`
  ).bind(...bindings).all<{ id: string; slug: string | null; status: string; has_unpublished_changes: number; created_at: number; updated_at: number; published_at: number | null; scheduled_at: number | null }>();

  const fields = await c.env.DB.prepare(
    'SELECT * FROM fields WHERE content_type_id = ? ORDER BY sort_order'
  ).bind(typeId).all<FieldRow>();

  // Fetch live field values via JOIN to avoid D1 variable binding limits
  const liveResult = await c.env.DB.prepare(
    `SELECT ef.entry_id, ef.field_id, ef.value
     FROM entry_fields ef
     JOIN entries e ON e.id = ef.entry_id
     WHERE e.content_type_id = ?`
  ).bind(typeId).all<{ entry_id: string; field_id: string; value: string | null }>();

  // Fetch draft field values for entries with unpublished changes (same "admin sees latest" logic)
  const draftResult = await c.env.DB.prepare(
    `SELECT efd.entry_id, efd.field_id, efd.value
     FROM entry_fields_draft efd
     JOIN entries e ON e.id = efd.entry_id
     WHERE e.content_type_id = ? AND e.has_unpublished_changes = 1`
  ).bind(typeId).all<{ entry_id: string; field_id: string; value: string | null }>();

  // Build per-entry field maps; draft values overwrite live values
  const efByEntry = new Map<string, Map<string, string | null>>();
  for (const ef of liveResult.results) {
    let m = efByEntry.get(ef.entry_id);
    if (!m) { m = new Map(); efByEntry.set(ef.entry_id, m); }
    m.set(ef.field_id, ef.value);
  }
  for (const ef of draftResult.results) {
    let m = efByEntry.get(ef.entry_id);
    if (!m) { m = new Map(); efByEntry.set(ef.entry_id, m); }
    m.set(ef.field_id, ef.value);
  }

  function toISO(ms: number | null): string | null {
    return ms ? new Date(ms).toISOString() : null;
  }

  const rows = entries.results.map(entry => {
    const fieldValues: Record<string, unknown> = {};
    for (const [fieldId, value] of efByEntry.get(entry.id) ?? []) {
      const field = fields.results.find(f => f.id === fieldId);
      if (field) fieldValues[field.slug] = parseFieldValue(value, field.type);
    }
    return {
      ...entry,
      created_at: toISO(entry.created_at),
      updated_at: toISO(entry.updated_at),
      published_at: toISO(entry.published_at),
      scheduled_at: toISO(entry.scheduled_at),
      fields: fieldValues,
    };
  });

  // Resolve relation IDs → slugs for human-readable output
  const relationFieldIds = new Set(fields.results.filter(f => f.type === 'relation').map(f => f.id));
  if (relationFieldIds.size > 0) {
    const relatedIds = new Set<string>();
    for (const row of rows) {
      for (const [fieldId, value] of efByEntry.get(row.id) ?? []) {
        if (!relationFieldIds.has(fieldId)) continue;
        const parsed = parseFieldValue(value, 'relation');
        if (typeof parsed === 'string') relatedIds.add(parsed);
        else if (Array.isArray(parsed)) parsed.forEach((id: unknown) => typeof id === 'string' && relatedIds.add(id));
      }
    }

    if (relatedIds.size > 0) {
      // Fetch slugs in chunks of 50 to stay within D1 variable binding limits
      const idList = [...relatedIds];
      const slugMap = new Map<string, string>();
      for (let i = 0; i < idList.length; i += 50) {
        const chunk = idList.slice(i, i + 50);
        const placeholders = chunk.map(() => '?').join(',');
        const slugRows = await c.env.DB.prepare(
          `SELECT id, slug FROM entries WHERE id IN (${placeholders})`
        ).bind(...chunk).all<{ id: string; slug: string | null }>();
        for (const r of slugRows.results) slugMap.set(r.id, r.slug ?? r.id);
      }

      // Replace IDs with slugs in each row's field values
      for (const row of rows) {
        for (const f of fields.results.filter(f => f.type === 'relation')) {
          const val = row.fields[f.slug];
          if (typeof val === 'string') row.fields[f.slug] = slugMap.get(val) ?? val;
          else if (Array.isArray(val)) row.fields[f.slug] = (val as string[]).map(id => slugMap.get(id) ?? id);
        }
      }
    }
  }

  const filename = `${ct.slug}-export`;

  if (format === 'json') {
    return new Response(JSON.stringify(rows, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}.json"`,
      },
    });
  }

  // CSV
  function csvCell(val: unknown): string {
    if (val === null || val === undefined) return '';
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const baseColumns = ['id', 'slug', 'status', 'has_unpublished_changes', 'created_at', 'updated_at', 'published_at', 'scheduled_at'];
  const fieldColumns = fields.results.map(f => f.slug);
  const allColumns = [...baseColumns, ...fieldColumns];

  const lines = [
    allColumns.join(','),
    ...rows.map(row =>
      allColumns.map(col =>
        baseColumns.includes(col)
          ? csvCell((row as Record<string, unknown>)[col])
          : csvCell(row.fields[col])
      ).join(',')
    ),
  ];

  return new Response(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}.csv"`,
    },
  });
});

// PATCH /api/content-types/:typeId/entries/reorder
contentTypes.patch('/:typeId/entries/reorder', async (c) => {
  const { typeId } = c.req.param();
  const permitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(permitted, typeId)) return c.json({ error: 'Forbidden' }, 403);
  const raw = await c.req.json().catch(() => null);
  const reorderParsed = parseBody(ReorderSchema, raw);
  if (!reorderParsed.ok) return c.json({ error: reorderParsed.error }, 400);
  const body = reorderParsed.data;
  const stmts = body.ids.map((id, i) =>
    c.env.DB.prepare(
      'UPDATE entries SET sort_order = ? WHERE id = ? AND content_type_id = ?'
    ).bind(i, id, typeId)
  );
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// GET /api/content-types/:typeId/entries/slug-suggest
contentTypes.get('/:typeId/entries/slug-suggest', async (c) => {
  const { typeId } = c.req.param();
  const base = c.req.query('slug')?.trim() ?? '';
  const exclude = c.req.query('exclude')?.trim() ?? '';
  if (!base) return c.json({ error: 'slug param required' }, 400);

  for (let i = 0; i <= 99; i++) {
    const candidate = i === 0 ? base : `${base}-${i}`;
    const sql = exclude
      ? 'SELECT id FROM entries WHERE content_type_id = ? AND slug = ? AND id != ?'
      : 'SELECT id FROM entries WHERE content_type_id = ? AND slug = ?';
    const row = await c.env.DB.prepare(sql)
      .bind(...(exclude ? [typeId, candidate, exclude] : [typeId, candidate]))
      .first<{ id: string }>();
    if (!row) return c.json({ slug: candidate });
  }

  return c.json({ slug: `${base}-${Date.now()}` });
});

// GET /api/content-types/:typeId/entries
contentTypes.get('/:typeId/entries', async (c) => {
  const { typeId } = c.req.param();
  const permitted = await getPermittedContentTypeIds(c.env.DB, c.get('jwtPayload') as JWTPayload);
  if (!isPermitted(permitted, typeId)) return c.json({ error: 'Forbidden' }, 403);
  const status = c.req.query('status');
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(1000, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10) || 50));
  const offset = (page - 1) * limit;

  const ALLOWED_SORT = new Set(['created_at', 'updated_at', 'published_at', 'sort_order']);
  const rawSort = c.req.query('sort_by') ?? '';
  const sortDir = c.req.query('sort_dir') === 'desc' ? 'DESC' : 'ASC';

  // Support field-based sorting via "field:SLUG" format
  let sortJoin = '';
  const sortJoinBindings: unknown[] = [];
  let orderClause: string;

  if (rawSort.startsWith('field:')) {
    const fieldSlug = rawSort.slice(6);
    const sortField = await c.env.DB.prepare(
      'SELECT id, type FROM fields WHERE content_type_id = ? AND slug = ?'
    ).bind(typeId, fieldSlug).first<{ id: string; type: string }>();

    if (sortField) {
      sortJoin = 'LEFT JOIN entry_fields _sf ON _sf.entry_id = e.id AND _sf.field_id = ?';
      sortJoinBindings.push(sortField.id);
      const sortExpr = sortField.type === 'number'
        ? 'CAST(_sf.value AS REAL)'
        : sortField.type === 'datetime'
          ? "json_extract(_sf.value, '$.datetime')"
          : '_sf.value';
      orderClause = `ORDER BY ${sortExpr} IS NULL, ${sortExpr} ${sortDir}`;
    } else {
      orderClause = 'ORDER BY e.sort_order ASC';
    }
  } else {
    const sortBy = ALLOWED_SORT.has(rawSort) ? rawSort : 'sort_order';
    // Push NULL published_at values to the bottom regardless of sort direction
    orderClause = sortBy === 'published_at'
      ? `ORDER BY e.published_at IS NULL, e.published_at ${sortDir}`
      : `ORDER BY e.${sortBy} ${sortDir}`;
  }

  const q = c.req.query('q')?.trim() ?? '';

  let whereClause = 'WHERE e.content_type_id = ?';
  const bindings: unknown[] = [typeId];
  if (status === 'changes') {
    whereClause += ' AND e.has_unpublished_changes = 1';
  } else if (status) {
    whereClause += ' AND e.status = ?';
    bindings.push(status);
  }
  if (q) {
    const like = `%${q}%`;
    whereClause += ` AND (e.slug LIKE ? OR e.id IN (
      SELECT entry_id FROM entry_fields ef
      JOIN fields f ON f.id = ef.field_id
      WHERE f.content_type_id = ? AND f.type IN ('text', 'rich_text', 'select') AND ef.value LIKE ?
    ))`;
    bindings.push(like, typeId, like);
  }

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM entries e ${sortJoin} ${whereClause}`
  ).bind(...sortJoinBindings, ...bindings).first<{ count: number }>();
  const total = countRow?.count ?? 0;

  const entries = await c.env.DB.prepare(
    `SELECT e.* FROM entries e ${sortJoin} ${whereClause} ${orderClause} LIMIT ? OFFSET ?`
  ).bind(...sortJoinBindings, ...bindings, limit, offset).all<{
    id: string; content_type_id: string; status: string; created_at: number; updated_at: number; published_at: number | null;
  }>();

  // Get all fields for this content type
  const fields = await c.env.DB.prepare(
    'SELECT * FROM fields WHERE content_type_id = ? ORDER BY sort_order'
  ).bind(typeId).all<FieldRow>();

  // Batch-fetch all entry_fields for this page in one query
  const entryIds = entries.results.map(e => e.id);
  let allEfRows: { entry_id: string; field_id: string; value: string | null }[] = [];
  if (entryIds.length > 0) {
    const placeholders = entryIds.map(() => '?').join(',');
    const efResult = await c.env.DB.prepare(
      `SELECT * FROM entry_fields WHERE entry_id IN (${placeholders})`
    ).bind(...entryIds).all<{ entry_id: string; field_id: string; value: string | null }>();
    allEfRows = efResult.results;
  }

  // Group entry_fields by entry_id
  const efByEntry = new Map<string, { field_id: string; value: string | null }[]>();
  for (const ef of allEfRows) {
    let arr = efByEntry.get(ef.entry_id);
    if (!arr) { arr = []; efByEntry.set(ef.entry_id, arr); }
    arr.push(ef);
  }

  const result = entries.results.map(entry => {
    const fieldValues: Record<string, unknown> = {};
    const efRows = efByEntry.get(entry.id) ?? [];
    for (const ef of efRows) {
      const field = fields.results.find(f => f.id === ef.field_id);
      if (!field) continue;
      fieldValues[field.slug] = parseFieldValue(ef.value, field.type);
    }
    return { ...entry, fields: fieldValues };
  });

  const pages = Math.ceil(total / limit);
  return c.json({
    data: result,
    meta: { total, page, limit, pages, has_next: page < pages },
  });
});

export default contentTypes;
