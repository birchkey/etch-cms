// MCP server at /mcp, so AI agents can read the schema, import assets, and create and
// publish entries. Stateless Streamable HTTP: each request gets a fresh server, so it needs
// no Durable Objects or session storage.
//
// Every tool calls the admin API with the caller's own API token rather than touching the
// database itself. Roles, content-type permissions, validation, the activity log and webhooks
// therefore behave exactly as they do for any other API client, and there is one place to
// change each of them.
import { Hono } from 'hono';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Env, AssetRow, ContentTypeRow, FieldRow } from '../types';
import { API_TOKEN_PREFIX, verifyApiToken } from '../lib/api-tokens';
import { version } from '../../package.json';

// The app the tools send their API requests to: the Worker's own app in production.
export type ApiApp = Pick<Hono<{ Bindings: Env }>, 'fetch'>;

type ApiResult = { status: number; data: unknown };
type Api = (method: string, path: string, body?: unknown) => Promise<ApiResult>;

// Batch sizes. Each imported asset is an outbound fetch (plus redirects), which counts
// against the Worker's per-request subrequest limit, so asset batches stay small.
const MAX_ENTRY_BATCH = 50;
const MAX_ASSET_BATCH = 10;
const ASSET_IMPORT_CONCURRENCY = 4;

const INSTRUCTIONS = `Etch CMS content API. Tools act as the user who owns the API token, with their role and content-type permissions.

Typical import:
1. list_content_types, then get_content_type for each type you will write. Entry field values are keyed by field slug.
2. import_assets_from_urls for images. Each result's "value" (a /r2/<filename> path) is what goes in an image field, or an array of them when the field is "multiple", or in an <img src> inside rich_text. Re-importing a URL returns the existing asset, so it is safe to retry.
3. create_entries with a stable slug per item (e.g. from the SKU) and if_exists: "update", so re-running the import updates entries instead of failing or duplicating them.
4. publish_entries once the drafts are right. Entries are always created as drafts. Publishing checks required fields and formats; failures come back per entry as field_errors. Each publish may trigger the site's webhooks (e.g. a rebuild).

Field values: text/email/phone/color strings; rich_text HTML; number; boolean; datetime {"datetime":"2025-06-01T09:30","timezone":"America/Chicago"}; select one of select_options (array when multiple); relation entry id (array when cardinality "many"); icon "fa-solid fa-house"; repeater array of objects keyed by subfield slug, each with a unique "_id". Unknown field slugs are ignored. null clears a field; on update, omitted fields are left unchanged.`;

function json(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function fail(message: string, extra?: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }) }], isError: true };
}

function apiError(res: ApiResult): string {
  const err = (res.data as { error?: unknown } | null)?.error;
  return typeof err === 'string' ? err : `Request failed with status ${res.status}`;
}

const isOk = (res: ApiResult) => res.status >= 200 && res.status < 300;

// Drop the empty options and database bookkeeping from field definitions, and decode the
// JSON-in-a-string columns, so the schema an agent reads is small and unambiguous.
function describeField(f: FieldRow) {
  const parse = (s: string | null) => { if (!s) return undefined; try { return JSON.parse(s); } catch { return s; } };
  const out: Record<string, unknown> = { slug: f.slug, name: f.name, type: f.type, required: !!f.required };
  if (f.type === 'image' || f.type === 'select') out.multiple = !!f.multiple;
  if (f.select_options) out.select_options = parse(f.select_options);
  if (f.relation_content_type_id) {
    out.relation_content_type_id = f.relation_content_type_id;
    out.relation_cardinality = f.relation_cardinality;
  }
  if (f.repeater_subfields) out.repeater_subfields = parse(f.repeater_subfields);
  for (const key of ['helper_text', 'min_length', 'max_length', 'min_value', 'max_value', 'pattern', 'phone_format'] as const) {
    if (f[key] !== null && f[key] !== undefined) out[key] = f[key];
  }
  return out;
}

function describeAsset(a: AssetRow) {
  return {
    id: a.id,
    value: `/r2/${a.filename}`,
    original_name: a.original_name,
    content_type: a.content_type,
    size: a.size,
    alt_text: a.alt_text,
    is_public: !!a.is_public,
    source_url: a.source_url ?? null,
  };
}

// Entries carry the access password for protected pages; it has no use to an agent and
// shouldn't end up in a model's context.
function describeEntry(e: Record<string, unknown>) {
  const { fieldDefs: _defs, protection_password: _pw, ...rest } = e;
  return rest;
}

// Accept a content type's id or its slug. Listing first means a slug works, and a type the
// caller can't access looks the same as one that doesn't exist.
async function resolveContentType(api: Api, ref: string): Promise<ContentTypeRow | string> {
  const res = await api('GET', '/api/content-types');
  if (!isOk(res)) return apiError(res);
  const types = res.data as ContentTypeRow[];
  return types.find(t => t.id === ref) ?? types.find(t => t.slug === ref) ?? `No content type with id or slug "${ref}"`;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function buildServer(api: Api): McpServer {
  const server = new McpServer(
    { name: 'etch-cms', version },
    { instructions: INSTRUCTIONS, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );

  server.registerTool('list_content_types', {
    description: 'List the content types you can access (id, name, slug, description, is_singleton).',
    annotations: { readOnlyHint: true },
  }, async () => {
    const res = await api('GET', '/api/content-types');
    if (!isOk(res)) return fail(apiError(res));
    return json((res.data as ContentTypeRow[]).map(t => ({
      id: t.id, name: t.name, slug: t.slug, description: t.description, is_singleton: !!t.is_singleton,
    })));
  });

  server.registerTool('get_content_type', {
    description: 'Get a content type and its fields. Entry values are keyed by each field\'s slug; check type, required, multiple and select_options before writing entries.',
    inputSchema: { content_type: z.string().describe('Content type id or slug') },
    annotations: { readOnlyHint: true },
  }, async ({ content_type }) => {
    const ct = await resolveContentType(api, content_type);
    if (typeof ct === 'string') return fail(ct);
    const res = await api('GET', `/api/content-types/${encodeURIComponent(ct.id)}`);
    if (!isOk(res)) return fail(apiError(res));
    const data = res.data as ContentTypeRow & { fields: FieldRow[] };
    return json({
      id: data.id, name: data.name, slug: data.slug, description: data.description,
      is_singleton: !!data.is_singleton, fields: data.fields.map(describeField),
    });
  });

  server.registerTool('list_entries', {
    description: 'List entries of a content type. Use slug for an exact lookup by slug, or search for a substring match over slugs and text fields. Field values are the published ones for entries with unpublished changes; use get_entry for the latest draft values.',
    inputSchema: {
      content_type: z.string().describe('Content type id or slug'),
      status: z.enum(['draft', 'published', 'scheduled', 'changes']).optional().describe('"changes" means published with unpublished edits'),
      slug: z.string().optional().describe('Exact slug match'),
      search: z.string().optional(),
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional().describe('Default 50'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ content_type, status, slug, search, page, limit }) => {
    const ct = await resolveContentType(api, content_type);
    if (typeof ct === 'string') return fail(ct);
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (slug) qs.set('slug', slug);
    if (search) qs.set('q', search);
    qs.set('page', String(page ?? 1));
    qs.set('limit', String(limit ?? 50));
    const res = await api('GET', `/api/content-types/${encodeURIComponent(ct.id)}/entries?${qs}`);
    if (!isOk(res)) return fail(apiError(res));
    const data = res.data as { data: Record<string, unknown>[]; meta: unknown };
    return json({ entries: data.data.map(describeEntry), meta: data.meta });
  });

  server.registerTool('get_entry', {
    description: 'Get one entry with its latest field values, including unpublished edits.',
    inputSchema: { id: z.string() },
    annotations: { readOnlyHint: true },
  }, async ({ id }) => {
    const res = await api('GET', `/api/entries/${encodeURIComponent(id)}`);
    if (!isOk(res)) return fail(apiError(res));
    return json(describeEntry(res.data as Record<string, unknown>));
  });

  server.registerTool('create_entries', {
    description: `Create up to ${MAX_ENTRY_BATCH} draft entries of one content type, in order. Give each a slug from a stable key (SKU, source ID) and set if_exists to "update" to make imports re-runnable: an entry whose slug already exists is then updated with the given fields instead. Returns one result per input, in the same order; one failing doesn't stop the rest.`,
    inputSchema: {
      content_type: z.string().describe('Content type id or slug'),
      entries: z.array(z.object({
        slug: z.string().optional().describe('Normalised to lowercase-with-hyphens; must be unique within the content type'),
        fields: z.record(z.string(), z.unknown()).describe('Values keyed by field slug'),
      })).min(1).max(MAX_ENTRY_BATCH),
      if_exists: z.enum(['error', 'update', 'skip']).optional().describe('What to do when an entry with the slug exists. Default "error"'),
    },
  }, async ({ content_type, entries, if_exists }) => {
    const ct = await resolveContentType(api, content_type);
    if (typeof ct === 'string') return fail(ct);
    const mode = if_exists ?? 'error';
    const typeId = encodeURIComponent(ct.id);

    const results: Record<string, unknown>[] = [];
    for (const [index, item] of entries.entries()) {
      if (item.slug && mode !== 'error') {
        const found = await api('GET', `/api/content-types/${typeId}/entries?slug=${encodeURIComponent(item.slug)}&limit=1`);
        if (!isOk(found)) { results.push({ index, slug: item.slug, error: apiError(found) }); continue; }
        const existing = (found.data as { data: { id: string; slug: string }[] }).data[0];
        if (existing) {
          if (mode === 'skip') { results.push({ index, id: existing.id, slug: existing.slug, action: 'skipped' }); continue; }
          const res = await api('PUT', `/api/entries/${encodeURIComponent(existing.id)}`, { fields: item.fields });
          results.push(isOk(res)
            ? { index, id: existing.id, slug: existing.slug, action: 'updated' }
            : { index, slug: item.slug, error: apiError(res) });
          continue;
        }
      }
      const res = await api('POST', '/api/entries', { content_type_id: ct.id, slug: item.slug ?? null, fields: item.fields });
      const created = res.data as { id: string; slug: string | null };
      results.push(isOk(res)
        ? { index, id: created.id, slug: created.slug, action: 'created' }
        : { index, slug: item.slug, error: apiError(res) });
    }
    const failed = results.filter(r => 'error' in r).length;
    return json({ succeeded: results.length - failed, failed, results });
  });

  server.registerTool('update_entry', {
    description: 'Update an entry\'s fields and/or slug. Fields you leave out keep their value; null clears one. Editing a published entry saves the change as unpublished until it is published again.',
    inputSchema: {
      id: z.string(),
      slug: z.string().nullable().optional(),
      fields: z.record(z.string(), z.unknown()).optional().describe('Values keyed by field slug'),
    },
  }, async ({ id, slug, fields }) => {
    const body: Record<string, unknown> = {};
    if (slug !== undefined) body.slug = slug;
    if (fields !== undefined) body.fields = fields;
    const res = await api('PUT', `/api/entries/${encodeURIComponent(id)}`, body);
    if (!isOk(res)) return fail(apiError(res));
    return json(describeEntry(res.data as Record<string, unknown>));
  });

  const setPublished = (publish: boolean) => async ({ ids }: { ids: string[] }) => {
    const results: Record<string, unknown>[] = [];
    for (const id of ids) {
      const res = await api('PATCH', `/api/entries/${encodeURIComponent(id)}/${publish ? 'publish' : 'unpublish'}`);
      const data = (res.data ?? {}) as { fieldErrors?: unknown; warnings?: unknown };
      if (isOk(res)) {
        results.push(data.warnings ? { id, ok: true, warnings: data.warnings } : { id, ok: true });
      } else {
        results.push(data.fieldErrors ? { id, error: apiError(res), field_errors: data.fieldErrors } : { id, error: apiError(res) });
      }
    }
    const failed = results.filter(r => 'error' in r).length;
    return json({ succeeded: results.length - failed, failed, results });
  };

  server.registerTool('publish_entries', {
    description: 'Publish entries (up to 100), making their current values live. Required fields and formats are checked here; an entry that fails is left unpublished and its result lists field_errors by field slug. Each publish may fire the site\'s webhooks.',
    inputSchema: { ids: z.array(z.string()).min(1).max(100) },
    annotations: { idempotentHint: true },
  }, setPublished(true));

  server.registerTool('unpublish_entries', {
    description: 'Unpublish entries (up to 100), returning them to draft.',
    inputSchema: { ids: z.array(z.string()).min(1).max(100) },
    annotations: { idempotentHint: true },
  }, setPublished(false));

  server.registerTool('list_assets', {
    description: 'List assets in the library, newest first. Each asset\'s "value" is what goes in an image field.',
    inputSchema: {
      search: z.string().optional().describe('Substring of the original file name'),
      page: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(100).optional().describe('Default 50'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ search, page, limit }) => {
    const qs = new URLSearchParams({ page: String(page ?? 1), limit: String(limit ?? 50) });
    if (search) qs.set('search', search);
    const res = await api('GET', `/api/assets?${qs}`);
    if (!isOk(res)) return fail(apiError(res));
    const data = res.data as { data: AssetRow[]; meta: unknown };
    return json({ assets: data.data.map(describeAsset), meta: data.meta });
  });

  server.registerTool('import_assets_from_urls', {
    description: `Download files from public https URLs into the asset library (up to ${MAX_ASSET_BATCH} per call). Accepts JPEG, PNG, GIF, WebP, AVIF, SVG, ICO, PDF, MP4 and WebM, within the instance's upload size limit. A URL that was imported before returns the existing asset (existing: true) instead of a copy. Use each result's "value" in image fields.`,
    inputSchema: {
      assets: z.array(z.object({
        url: z.string().describe('Public https URL'),
        alt_text: z.string().optional(),
      })).min(1).max(MAX_ASSET_BATCH),
    },
  }, async ({ assets }) => {
    const results = await mapLimit(assets, ASSET_IMPORT_CONCURRENCY, async (item) => {
      const res = await api('POST', '/api/assets/import', { url: item.url, alt_text: item.alt_text ?? null });
      if (!isOk(res)) return { url: item.url, error: apiError(res) };
      const asset = describeAsset(res.data as AssetRow);
      return { url: item.url, id: asset.id, value: asset.value, existing: res.status === 200 };
    });
    const failed = results.filter(r => 'error' in r).length;
    return json({ succeeded: results.length - failed, failed, results });
  });

  return server;
}

export function createMcpRoutes(app: ApiApp) {
  const mcp = new Hono<{ Bindings: Env }>();

  mcp.all('/', async (c) => {
    // API tokens only. Session cookies are ignored entirely, so a page in a signed-in
    // browser can't drive the endpoint, and session JWTs are too short-lived for an agent.
    const authorization = c.req.header('Authorization') ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    const identity = token.startsWith(API_TOKEN_PREFIX)
      ? await verifyApiToken(c.env, token, p => c.executionCtx.waitUntil(p))
      : null;
    if (!identity) {
      c.header('WWW-Authenticate', 'Bearer realm="etch-cms", error="invalid_token"');
      return c.json({ error: 'Unauthorized: send an API token as "Authorization: Bearer etch_…"' }, 401);
    }

    const origin = new URL(c.req.url).origin;
    const api: Api = async (method, path, body) => {
      const req = new Request(origin + path, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const res = await app.fetch(req, c.env, c.executionCtx);
      return { status: res.status, data: await res.json().catch(() => null) };
    };

    const server = buildServer(api);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return mcp;
}
