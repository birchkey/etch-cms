import { Hono } from 'hono';
import { Env, FieldRow, EntryRow } from '../types';
import { parseFieldValue, signAssetUrl } from '../lib/utils';
import { verifySignature } from '../middleware/auth';
import { verifyExternalJWT } from '../lib/jwks';
import { faGlyph } from '../lib/fa-icons';

function formatIcon(faClass: string): { class: string; glyph: string | null } {
  return { class: faClass, glyph: faGlyph(faClass) };
}

function formatDatetime(rawValue: string): Record<string, unknown> | null {
  let datetimeStr: string;
  let timezone: string | null = null;

  try {
    const parsed = JSON.parse(rawValue) as { datetime?: string; timezone?: string };
    if (parsed && typeof parsed === 'object' && 'datetime' in parsed) {
      datetimeStr = parsed.datetime ?? '';
      timezone = parsed.timezone ?? null;
    } else {
      datetimeStr = rawValue;
    }
  } catch {
    datetimeStr = rawValue;
  }

  if (!datetimeStr) return null;

  const match = datetimeStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) {
    return { iso: datetimeStr, long: null, date: null, time: null, timestamp: null, timezone };
  }

  const [, yyyy, MM, dd, HH, mm] = match;
  // Construct a UTC Date using the wall-clock components so Intl formatting at
  // timeZone:'UTC' always produces the exact hour/minute the user entered.
  const wallUtcMs = Date.UTC(+yyyy, +MM - 1, +dd, +HH, +mm, 0);
  const d = new Date(wallUtcMs);

  const longStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);

  const dateStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric',
  }).format(d);

  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);

  // Derive the correct UTC epoch for this wall-clock time in the stored timezone.
  // Strategy: format wallUtcMs in the target timezone to find the offset it applies,
  // then shift accordingly (single-iteration; accurate for all non-ambiguous times).
  let timestamp: number;
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
      }).formatToParts(d);
      const p: Record<string, number> = {};
      for (const part of parts) if (part.type !== 'literal') p[part.type] = parseInt(part.value);
      const tzDisplayedAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second ?? 0);
      const offset = wallUtcMs - tzDisplayedAsUtc;
      timestamp = Math.floor((wallUtcMs + offset) / 1000);
    } catch {
      timestamp = Math.floor(wallUtcMs / 1000);
    }
  } else {
    timestamp = Math.floor(wallUtcMs / 1000);
  }

  return { iso: datetimeStr, long: longStr, date: dateStr, time: timeStr, timestamp, timezone };
}

function addHeadingIds(html: string): string {
  return html.replace(/<(h[12])>(.*?)<\/\1>/gis, (match, tag, content) => {
    const text = content.replace(/<[^>]+>/g, '').trim();
    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return id ? `<${tag} id="${id}">${content}</${tag}>` : match;
  });
}

async function getAltText(db: D1Database, storedPath: string): Promise<string | null> {
  const filename = storedPath.replace(/^\/r2\//, '');
  const r2Key = `assets/${filename}`;
  const row = await db.prepare('SELECT alt_text FROM assets WHERE r2_key = ?').bind(r2Key).first<{ alt_text: string | null }>();
  return row?.alt_text ?? null;
}

// Collect all image paths from ef rows, including paths inside repeater field values.
// Returns a set of stored paths like "/r2/abc.jpg".
function extractImagePaths(
  efRows: { field_id: string; value: string | null }[],
  imageFieldIds: Set<string>,
  repeaterFields: Map<string, { repeater_subfields: string | null }>
): Set<string> {
  const paths = new Set<string>();
  for (const ef of efRows) {
    if (imageFieldIds.has(ef.field_id) && ef.value) {
      try {
        const parsed = JSON.parse(ef.value);
        if (Array.isArray(parsed)) {
          for (const p of parsed) if (typeof p === 'string') paths.add(p);
          continue;
        }
      } catch { /* not JSON — single path */ }
      paths.add(ef.value);
    }
    const rf = repeaterFields.get(ef.field_id);
    if (rf?.repeater_subfields && ef.value) {
      try {
        const subfields = JSON.parse(rf.repeater_subfields) as Array<{ type: string; slug: string; multiple: boolean }>;
        const imageSubs = subfields.filter(sf => sf.type === 'image');
        if (imageSubs.length > 0) {
          const items = JSON.parse(ef.value) as Array<Record<string, unknown>>;
          for (const item of items) {
            for (const sf of imageSubs) {
              const v = item[sf.slug];
              if (typeof v === 'string') paths.add(v);
              else if (Array.isArray(v)) for (const p of v) if (typeof p === 'string') paths.add(p);
            }
          }
        }
      } catch { /* skip */ }
    }
  }
  return paths;
}

// Batch-fetch alt texts for a set of image paths.
// Returns a map of stored path ("/r2/...") → alt_text.
async function fetchAltTextMap(
  db: D1Database,
  paths: Set<string>
): Promise<Map<string, string | null>> {
  if (paths.size === 0) return new Map();

  const r2Keys = [...paths].map(p => `assets/${p.replace(/^\/r2\//, '')}`);
  const placeholders = r2Keys.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT r2_key, alt_text FROM assets WHERE r2_key IN (${placeholders})`
  ).bind(...r2Keys).all<{ r2_key: string; alt_text: string | null }>();

  const r2KeyToAlt = new Map(rows.results.map(r => [r.r2_key, r.alt_text]));
  const result = new Map<string, string | null>();
  for (const p of paths) {
    result.set(p, r2KeyToAlt.get(`assets/${p.replace(/^\/r2\//, '')}`) ?? null);
  }
  return result;
}

async function checkEntryAccess(
  entry: EntryRow,
  request: Request,
  db: D1Database,
): Promise<boolean> {
  if (!entry.protection_type) return true;

  if (entry.protection_type === 'password') {
    const url = new URL(request.url);
    const provided = url.searchParams.get('password');
    return provided !== null && provided === entry.protection_password;
  }

  if (entry.protection_type === 'jwt') {
    const auth = request.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return false;
    const token = auth.slice(7);
    const { results } = await db.prepare(
      "SELECT key, value FROM settings WHERE key IN ('jwt_jwks_url','jwt_issuer','jwt_audience')"
    ).all<{ key: string; value: string }>();
    const cfg: Record<string, string> = {};
    for (const r of results) cfg[r.key] = r.value;
    if (!cfg.jwt_jwks_url || !cfg.jwt_issuer) return false;
    return verifyExternalJWT(token, cfg.jwt_jwks_url, cfg.jwt_issuer, cfg.jwt_audience);
  }

  return false;
}

const publicApi = new Hono<{ Bindings: Env }>();

publicApi.use('*', async (c, next) => {
  const requiredKey = c.env.PUBLIC_API_KEY;
  if (!requiredKey) return next();
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ') || auth.slice(7) !== requiredKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
});


async function expandEntry(db: D1Database, entry: EntryRow, fields: FieldRow[], baseUrl: string, includeSlug = true, prefetchedEfRows?: { entry_id: string; field_id: string; value: string | null }[], altTextMap?: Map<string, string | null>, relatedData?: RelatedData, secret?: string): Promise<Record<string, unknown>> {
  const efRows = prefetchedEfRows
    ? { results: prefetchedEfRows }
    : await db.prepare(
        'SELECT * FROM entry_fields WHERE entry_id = ?'
      ).bind(entry.id).all<{ entry_id: string; field_id: string; value: string | null }>();

  const fieldValues: Record<string, unknown> = {};

  for (const f of fields) {
    const ef = efRows.results.find(r => r.field_id === f.id);
    const rawValue = ef?.value ?? null;

    if (f.type === 'image' && rawValue) {
      if (f.multiple === 1) {
        // Multiple images stored as JSON array of paths
        try {
          const paths = JSON.parse(rawValue) as string[];
          fieldValues[f.slug] = await Promise.all(paths.map(async p => {
            const signedPath = secret ? await signAssetUrl(p, secret) : p;
            return {
              url: `${baseUrl}${signedPath}`,
              alt_text: altTextMap ? (altTextMap.get(p) ?? null) : await getAltText(db, p),
            };
          }));
        } catch {
          fieldValues[f.slug] = rawValue;
        }
      } else {
        const signedPath = secret ? await signAssetUrl(rawValue, secret) : rawValue;
        fieldValues[f.slug] = {
          url: `${baseUrl}${signedPath}`,
          alt_text: altTextMap ? (altTextMap.get(rawValue) ?? null) : await getAltText(db, rawValue),
        };
      }
    } else if (f.type === 'rich_text' && rawValue) {
      // Collect /r2/ paths, sign them, then rewrite src attributes to full URLs
      const r2Paths: string[] = [];
      rawValue.replace(/src="(\/r2\/[^"]+)"/g, (_, path: string) => { r2Paths.push(path); return ''; });
      const signedPaths = secret
        ? await Promise.all(r2Paths.map(p => signAssetUrl(p, secret)))
        : r2Paths;
      let ri = 0;
      const withImages = rawValue.replace(
        /src="(\/r2\/[^"]+)"/g,
        () => `src="${baseUrl}${signedPaths[ri++]}"`
      );
      fieldValues[f.slug] = addHeadingIds(withImages);
    } else if (f.type === 'relation' && rawValue) {
      const parsed = parseFieldValue(rawValue, 'relation');
      if (typeof parsed === 'string') {
        const relEntry = relatedData?.entries.get(parsed);
        fieldValues[f.slug] = relEntry ? await hydrateRelatedEntry(relEntry, relatedData!, baseUrl, altTextMap, secret) : null;
      } else if (Array.isArray(parsed)) {
        fieldValues[f.slug] = (await Promise.all(
          (parsed as string[]).map(relId => {
            const relEntry = relatedData?.entries.get(relId);
            return relEntry ? hydrateRelatedEntry(relEntry, relatedData!, baseUrl, altTextMap, secret) : null;
          })
        )).filter(Boolean);
      } else {
        fieldValues[f.slug] = parsed;
      }
    } else if (f.type === 'datetime') {
      fieldValues[f.slug] = rawValue ? formatDatetime(rawValue) : null;
    } else if (f.type === 'icon') {
      fieldValues[f.slug] = rawValue ? formatIcon(rawValue) : null;
    } else if (f.type === 'phone' && rawValue) {
      fieldValues[f.slug] = rawValue;
      fieldValues[`${f.slug}_digits`] = rawValue.replace(/\D/g, '');
    } else if (f.type === 'repeater' && rawValue) {
      try {
        const subfields = f.repeater_subfields
          ? JSON.parse(f.repeater_subfields) as Array<{ id: string; name: string; slug: string; type: string; multiple: boolean }>
          : [];
        const items = JSON.parse(rawValue) as Array<Record<string, unknown>>;
        fieldValues[f.slug] = await Promise.all(items.map(async item => {
          const expanded: Record<string, unknown> = { _id: item._id };
          for (const sf of subfields) {
            const val = item[sf.slug] ?? null;
            if (sf.type === 'image' && val) {
              if (sf.multiple) {
                const paths = val as string[];
                expanded[sf.slug] = await Promise.all(paths.map(async (p: string) => {
                  const signedPath = secret ? await signAssetUrl(p, secret) : p;
                  return { url: `${baseUrl}${signedPath}`, alt_text: altTextMap ? (altTextMap.get(p) ?? null) : null };
                }));
              } else {
                const path = val as string;
                const signedPath = secret ? await signAssetUrl(path, secret) : path;
                expanded[sf.slug] = { url: `${baseUrl}${signedPath}`, alt_text: altTextMap ? (altTextMap.get(path) ?? null) : null };
              }
            } else if (sf.type === 'rich_text' && typeof val === 'string') {
              const r2Paths: string[] = [];
              val.replace(/src="(\/r2\/[^"]+)"/g, (_, p: string) => { r2Paths.push(p); return ''; });
              const signedPaths = secret
                ? await Promise.all(r2Paths.map(p => signAssetUrl(p, secret)))
                : r2Paths;
              let ri = 0;
              expanded[sf.slug] = addHeadingIds(val.replace(
                /src="(\/r2\/[^"]+)"/g,
                () => `src="${baseUrl}${signedPaths[ri++]}"`
              ));
            } else if (sf.type === 'datetime') {
              const rawVal = val === null ? null : (typeof val === 'string' ? val : JSON.stringify(val));
              expanded[sf.slug] = rawVal ? formatDatetime(rawVal) : null;
            } else if (sf.type === 'icon') {
              expanded[sf.slug] = val ? formatIcon(String(val)) : null;
            } else {
              expanded[sf.slug] = val;
            }
          }
          return expanded;
        }));
      } catch {
        fieldValues[f.slug] = null;
      }
    } else {
      fieldValues[f.slug] = parseFieldValue(rawValue, f.type);
    }
  }

  return {
    id: entry.id,
    ...(includeSlug ? { slug: entry.slug ?? null } : {}),
    status: entry.status,
    published_at: entry.published_at ? new Date(entry.published_at).toISOString() : null,
    created_at: new Date(entry.created_at).toISOString(),
    updated_at: new Date(entry.updated_at).toISOString(),
    fields: fieldValues,
  };
}

type RelatedData = {
  entries: Map<string, EntryRow>;
  fieldsByType: Map<string, FieldRow[]>;
  efRows: Map<string, { field_id: string; value: string | null }[]>;
};

// Batch-fetch all related entries referenced by relation fields, along with their
// field definitions and field values. Replaces N×3 individual queries with 3 total.
async function buildRelatedData(
  db: D1Database,
  efRows: { field_id: string; value: string | null }[],
  relationFieldIds: Set<string>
): Promise<RelatedData> {
  const relatedIds = new Set<string>();
  for (const ef of efRows) {
    if (!relationFieldIds.has(ef.field_id) || !ef.value) continue;
    const parsed = parseFieldValue(ef.value, 'relation');
    if (typeof parsed === 'string') relatedIds.add(parsed);
    else if (Array.isArray(parsed)) (parsed as string[]).forEach(id => typeof id === 'string' && relatedIds.add(id));
  }

  if (relatedIds.size === 0) {
    return { entries: new Map(), fieldsByType: new Map(), efRows: new Map() };
  }

  const idList = [...relatedIds];
  const placeholders = idList.map(() => '?').join(',');

  const relEntries = await db.prepare(
    `SELECT * FROM entries WHERE id IN (${placeholders}) AND status = 'published'`
  ).bind(...idList).all<EntryRow>();

  const ctIds = [...new Set(relEntries.results.map(e => e.content_type_id))];
  const fieldsByType = new Map<string, FieldRow[]>();
  if (ctIds.length > 0) {
    const ctPlaceholders = ctIds.map(() => '?').join(',');
    const relFields = await db.prepare(
      `SELECT * FROM fields WHERE content_type_id IN (${ctPlaceholders}) ORDER BY sort_order`
    ).bind(...ctIds).all<FieldRow>();
    for (const ctId of ctIds) {
      fieldsByType.set(ctId, relFields.results.filter(f => f.content_type_id === ctId));
    }
  }

  const relEfByEntry = new Map<string, { field_id: string; value: string | null }[]>();
  const relEfResult = await db.prepare(
    `SELECT * FROM entry_fields WHERE entry_id IN (${placeholders})`
  ).bind(...idList).all<{ entry_id: string; field_id: string; value: string | null }>();
  for (const ef of relEfResult.results) {
    let arr = relEfByEntry.get(ef.entry_id);
    if (!arr) { arr = []; relEfByEntry.set(ef.entry_id, arr); }
    arr.push(ef);
  }

  return {
    entries: new Map(relEntries.results.map(e => [e.id, e])),
    fieldsByType,
    efRows: relEfByEntry,
  };
}

// Hydrate a related entry from pre-fetched data — no DB calls required.
async function hydrateRelatedEntry(
  entry: EntryRow,
  relatedData: RelatedData,
  baseUrl: string,
  altTextMap?: Map<string, string | null>,
  secret?: string,
): Promise<Record<string, unknown>> {
  const fields = relatedData.fieldsByType.get(entry.content_type_id) ?? [];
  const efRows = relatedData.efRows.get(entry.id) ?? [];

  const fieldValues: Record<string, unknown> = {};
  for (const f of fields) {
    const ef = efRows.find(r => r.field_id === f.id);
    const rawValue = ef?.value ?? null;
    if (f.type === 'image' && rawValue) {
      if (f.multiple === 1) {
        try {
          const paths = JSON.parse(rawValue) as string[];
          fieldValues[f.slug] = await Promise.all(paths.map(async p => {
            const signedPath = secret ? await signAssetUrl(p, secret) : p;
            return {
              url: `${baseUrl}${signedPath}`,
              alt_text: altTextMap ? (altTextMap.get(p) ?? null) : null,
            };
          }));
        } catch {
          fieldValues[f.slug] = rawValue;
        }
      } else {
        const signedPath = secret ? await signAssetUrl(rawValue, secret) : rawValue;
        fieldValues[f.slug] = {
          url: `${baseUrl}${signedPath}`,
          alt_text: altTextMap ? (altTextMap.get(rawValue) ?? null) : null,
        };
      }
    } else if (f.type === 'rich_text' && rawValue) {
      const r2Paths: string[] = [];
      rawValue.replace(/src="(\/r2\/[^"]+)"/g, (_, path: string) => { r2Paths.push(path); return ''; });
      const signedPaths = secret
        ? await Promise.all(r2Paths.map(p => signAssetUrl(p, secret)))
        : r2Paths;
      let ri = 0;
      const withImages = rawValue.replace(
        /src="(\/r2\/[^"]+)"/g,
        () => `src="${baseUrl}${signedPaths[ri++]}"`
      );
      fieldValues[f.slug] = addHeadingIds(withImages);
    } else if (f.type === 'datetime') {
      fieldValues[f.slug] = rawValue ? formatDatetime(rawValue) : null;
    } else if (f.type === 'icon') {
      fieldValues[f.slug] = rawValue ? formatIcon(rawValue) : null;
    } else if (f.type === 'phone' && rawValue) {
      fieldValues[f.slug] = rawValue;
      fieldValues[`${f.slug}_digits`] = rawValue.replace(/\D/g, '');
    } else if (f.type === 'repeater' && rawValue) {
      try {
        const subfields = f.repeater_subfields
          ? JSON.parse(f.repeater_subfields) as Array<{ id: string; name: string; slug: string; type: string; multiple: boolean }>
          : [];
        const items = JSON.parse(rawValue) as Array<Record<string, unknown>>;
        fieldValues[f.slug] = await Promise.all(items.map(async item => {
          const expanded: Record<string, unknown> = { _id: item._id };
          for (const sf of subfields) {
            const val = item[sf.slug] ?? null;
            if (sf.type === 'image' && val) {
              if (sf.multiple) {
                const paths = val as string[];
                expanded[sf.slug] = await Promise.all(paths.map(async (p: string) => {
                  const signedPath = secret ? await signAssetUrl(p, secret) : p;
                  return { url: `${baseUrl}${signedPath}`, alt_text: altTextMap ? (altTextMap.get(p) ?? null) : null };
                }));
              } else {
                const path = val as string;
                const signedPath = secret ? await signAssetUrl(path, secret) : path;
                expanded[sf.slug] = { url: `${baseUrl}${signedPath}`, alt_text: altTextMap ? (altTextMap.get(path) ?? null) : null };
              }
            } else if (sf.type === 'rich_text' && typeof val === 'string') {
              const r2Paths: string[] = [];
              val.replace(/src="(\/r2\/[^"]+)"/g, (_, p: string) => { r2Paths.push(p); return ''; });
              const signedPaths = secret
                ? await Promise.all(r2Paths.map(p => signAssetUrl(p, secret)))
                : r2Paths;
              let ri = 0;
              expanded[sf.slug] = addHeadingIds(val.replace(
                /src="(\/r2\/[^"]+)"/g,
                () => `src="${baseUrl}${signedPaths[ri++]}"`
              ));
            } else if (sf.type === 'datetime') {
              const rawVal = val === null ? null : (typeof val === 'string' ? val : JSON.stringify(val));
              expanded[sf.slug] = rawVal ? formatDatetime(rawVal) : null;
            } else if (sf.type === 'icon') {
              expanded[sf.slug] = val ? formatIcon(String(val)) : null;
            } else {
              expanded[sf.slug] = val;
            }
          }
          return expanded;
        }));
      } catch {
        fieldValues[f.slug] = null;
      }
    } else {
      fieldValues[f.slug] = parseFieldValue(rawValue, f.type);
    }
  }

  return {
    id: entry.id,
    status: entry.status,
    published_at: entry.published_at ? new Date(entry.published_at).toISOString() : null,
    created_at: new Date(entry.created_at).toISOString(),
    updated_at: new Date(entry.updated_at).toISOString(),
    fields: fieldValues,
  };
}

// GET /api/public/:typeSlug
publicApi.get('/:typeSlug', async (c) => {
  const { typeSlug } = c.req.param();
  const baseUrl = new URL(c.req.url).origin;

  const ct = await c.env.DB.prepare(
    'SELECT * FROM content_types WHERE slug = ?'
  ).bind(typeSlug).first<{ id: string; name: string; slug: string }>();
  if (!ct) return c.json({ error: 'Content type not found' }, 404);

  // Pagination params
  const limitParam = c.req.query('limit') ?? '100';
  const fetchAll = limitParam === 'all';
  const FETCH_ALL_CAP = 10_000;
  const limit = fetchAll ? FETCH_ALL_CAP : Math.min(1000, Math.max(1, parseInt(limitParam) || 100));
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'));

  const countRow = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM entries WHERE content_type_id = ? AND status = 'published' AND protection_type IS NULL"
  ).bind(ct.id).first<{ count: number }>();
  const total = countRow?.count ?? 0;

  const fields = await c.env.DB.prepare(
    'SELECT * FROM fields WHERE content_type_id = ? ORDER BY sort_order'
  ).bind(ct.id).all<FieldRow>();

  const offset = fetchAll ? 0 : (page - 1) * limit;
  const entriesResult = await c.env.DB.prepare(
    "SELECT * FROM entries WHERE content_type_id = ? AND status = 'published' AND protection_type IS NULL ORDER BY sort_order ASC LIMIT ? OFFSET ?"
  ).bind(ct.id, limit, offset).all<EntryRow>();

  // Batch-fetch all entry_fields for this page in one query (avoids N+1)
  const entryIds = entriesResult.results.map(e => e.id);
  let allEfRows: { entry_id: string; field_id: string; value: string | null }[] = [];
  if (entryIds.length > 0) {
    const placeholders = entryIds.map(() => '?').join(',');
    const efResult = await c.env.DB.prepare(
      `SELECT * FROM entry_fields WHERE entry_id IN (${placeholders})`
    ).bind(...entryIds).all<{ entry_id: string; field_id: string; value: string | null }>();
    allEfRows = efResult.results;
  }
  const efByEntry = new Map<string, { entry_id: string; field_id: string; value: string | null }[]>();
  for (const ef of allEfRows) {
    let arr = efByEntry.get(ef.entry_id);
    if (!arr) { arr = []; efByEntry.set(ef.entry_id, arr); }
    arr.push(ef);
  }

  const relationFieldIds = new Set(fields.results.filter(f => f.type === 'relation').map(f => f.id));
  const relatedData = await buildRelatedData(c.env.DB, allEfRows, relationFieldIds);
  const relEfRows = [...relatedData.efRows.values()].flat();
  const allImageFieldIds = new Set([
    ...fields.results.filter(f => f.type === 'image').map(f => f.id),
    ...[...relatedData.fieldsByType.values()].flat().filter(f => f.type === 'image').map(f => f.id),
  ]);
  const allRepeaterFields = new Map([
    ...fields.results.filter(f => f.type === 'repeater').map(f => [f.id, f] as [string, typeof f]),
    ...[...relatedData.fieldsByType.values()].flat().filter(f => f.type === 'repeater').map(f => [f.id, f] as [string, typeof f]),
  ]);
  const imagePaths = extractImagePaths([...allEfRows, ...relEfRows], allImageFieldIds, allRepeaterFields);
  const altTextMap = await fetchAltTextMap(c.env.DB, imagePaths);

  const data = await Promise.all(
    entriesResult.results.map(e => expandEntry(c.env.DB, e, fields.results, baseUrl, true, efByEntry.get(e.id), altTextMap, relatedData, c.env.JWT_SECRET))
  );

  const pages = Math.max(1, Math.ceil(total / limit));
  return c.json({
    data,
    meta: {
      total,
      page: fetchAll ? 1 : page,
      limit,
      pages,
      has_next: fetchAll ? false : page < pages,
    },
  });
});

// GET /api/public/:typeSlug/random
// Declared before /:typeSlug/:id so "random" is never treated as an entry ID.
publicApi.get('/:typeSlug/random', async (c) => {
  const { typeSlug } = c.req.param();
  const baseUrl = new URL(c.req.url).origin;

  const ct = await c.env.DB.prepare(
    'SELECT * FROM content_types WHERE slug = ?'
  ).bind(typeSlug).first<{ id: string }>();
  if (!ct) return c.json({ error: 'Content type not found' }, 404);

  // Use ORDER BY RANDOM() LIMIT 1 — efficient for D1/SQLite
  const entry = await c.env.DB.prepare(
    "SELECT * FROM entries WHERE content_type_id = ? AND status = 'published' AND protection_type IS NULL ORDER BY RANDOM() LIMIT 1"
  ).bind(ct.id).first<EntryRow>();
  if (!entry) return c.json({ error: 'No published entries found' }, 404);

  const fields = await c.env.DB.prepare(
    'SELECT * FROM fields WHERE content_type_id = ? ORDER BY sort_order'
  ).bind(ct.id).all<FieldRow>();

  const efRows = await c.env.DB.prepare(
    'SELECT * FROM entry_fields WHERE entry_id = ?'
  ).bind(entry.id).all<{ entry_id: string; field_id: string; value: string | null }>();
  const relationFieldIds = new Set(fields.results.filter(f => f.type === 'relation').map(f => f.id));
  const relatedData = await buildRelatedData(c.env.DB, efRows.results, relationFieldIds);
  const relEfRows = [...relatedData.efRows.values()].flat();
  const allImageFieldIds = new Set([
    ...fields.results.filter(f => f.type === 'image').map(f => f.id),
    ...[...relatedData.fieldsByType.values()].flat().filter(f => f.type === 'image').map(f => f.id),
  ]);
  const allRepeaterFields = new Map([
    ...fields.results.filter(f => f.type === 'repeater').map(f => [f.id, f] as [string, typeof f]),
    ...[...relatedData.fieldsByType.values()].flat().filter(f => f.type === 'repeater').map(f => [f.id, f] as [string, typeof f]),
  ]);
  const imagePaths = extractImagePaths([...efRows.results, ...relEfRows], allImageFieldIds, allRepeaterFields);
  const altTextMap = await fetchAltTextMap(c.env.DB, imagePaths);
  const data = await expandEntry(c.env.DB, entry, fields.results, baseUrl, true, efRows.results, altTextMap, relatedData, c.env.JWT_SECRET);
  return c.json({ data });
});

// GET /api/public/:typeSlug/:id
publicApi.get('/:typeSlug/:id', async (c) => {
  const { typeSlug, id } = c.req.param();
  const baseUrl = new URL(c.req.url).origin;

  const ct = await c.env.DB.prepare(
    'SELECT * FROM content_types WHERE slug = ?'
  ).bind(typeSlug).first<{ id: string }>();
  if (!ct) return c.json({ error: 'Content type not found' }, 404);

  // Check for an optional preview token
  const previewParam = c.req.query('preview');
  let previewEntryId: string | null = null;
  if (previewParam) {
    const payload = await verifySignature(previewParam, c.env.JWT_SECRET);
    if (payload && payload.type === 'preview' && typeof payload.entryId === 'string') {
      previewEntryId = payload.entryId;
    }
  }

  const fields = await c.env.DB.prepare(
    'SELECT * FROM fields WHERE content_type_id = ? ORDER BY sort_order'
  ).bind(ct.id).all<FieldRow>();

  if (previewEntryId) {
    // Preview mode: fetch by token's entryId (no status filter), verify it belongs to this content type
    const entry = await c.env.DB.prepare(
      'SELECT * FROM entries WHERE id = ? AND content_type_id = ? LIMIT 1'
    ).bind(previewEntryId, ct.id).first<EntryRow>();
    if (!entry) return c.json({ error: 'Not found' }, 404);

    // Read from draft table if there are unpublished changes, otherwise from live
    const table = entry.has_unpublished_changes ? 'entry_fields_draft' : 'entry_fields';
    const efRows = await c.env.DB.prepare(
      `SELECT entry_id, field_id, value FROM ${table} WHERE entry_id = ?`
    ).bind(entry.id).all<{ entry_id: string; field_id: string; value: string | null }>();

    c.header('Cache-Control', 'no-store');
    const previewRelationFieldIds = new Set(fields.results.filter(f => f.type === 'relation').map(f => f.id));
    const previewRelatedData = await buildRelatedData(c.env.DB, efRows.results, previewRelationFieldIds);
    const previewRelEfRows = [...previewRelatedData.efRows.values()].flat();
    const previewImageFieldIds = new Set([
      ...fields.results.filter(f => f.type === 'image').map(f => f.id),
      ...[...previewRelatedData.fieldsByType.values()].flat().filter(f => f.type === 'image').map(f => f.id),
    ]);
    const previewRepeaterFields = new Map([
      ...fields.results.filter(f => f.type === 'repeater').map(f => [f.id, f] as [string, typeof f]),
      ...[...previewRelatedData.fieldsByType.values()].flat().filter(f => f.type === 'repeater').map(f => [f.id, f] as [string, typeof f]),
    ]);
    const previewImagePaths = extractImagePaths([...efRows.results, ...previewRelEfRows], previewImageFieldIds, previewRepeaterFields);
    const previewAltTextMap = await fetchAltTextMap(c.env.DB, previewImagePaths);
    const data = await expandEntry(c.env.DB, entry, fields.results, baseUrl, true, efRows.results, previewAltTextMap, previewRelatedData, c.env.JWT_SECRET);
    return c.json({ data });
  }

  // Normal mode: only published entries, accept either a UUID or a slug
  const entry = await c.env.DB.prepare(
    "SELECT * FROM entries WHERE content_type_id = ? AND status = 'published' AND (id = ? OR slug = ?) LIMIT 1"
  ).bind(ct.id, id, id).first<EntryRow>();
  if (!entry) return c.json({ error: 'Not found' }, 404);

  if (!(await checkEntryAccess(entry, c.req.raw, c.env.DB))) {
    return c.json({ error: 'Not found' }, 404);
  }

  const efRows = await c.env.DB.prepare(
    'SELECT * FROM entry_fields WHERE entry_id = ?'
  ).bind(entry.id).all<{ entry_id: string; field_id: string; value: string | null }>();
  const relationFieldIds = new Set(fields.results.filter(f => f.type === 'relation').map(f => f.id));
  const relatedData = await buildRelatedData(c.env.DB, efRows.results, relationFieldIds);
  const relEfRows = [...relatedData.efRows.values()].flat();
  const allImageFieldIds = new Set([
    ...fields.results.filter(f => f.type === 'image').map(f => f.id),
    ...[...relatedData.fieldsByType.values()].flat().filter(f => f.type === 'image').map(f => f.id),
  ]);
  const allRepeaterFields = new Map([
    ...fields.results.filter(f => f.type === 'repeater').map(f => [f.id, f] as [string, typeof f]),
    ...[...relatedData.fieldsByType.values()].flat().filter(f => f.type === 'repeater').map(f => [f.id, f] as [string, typeof f]),
  ]);
  const imagePaths = extractImagePaths([...efRows.results, ...relEfRows], allImageFieldIds, allRepeaterFields);
  const altTextMap = await fetchAltTextMap(c.env.DB, imagePaths);
  const data = await expandEntry(c.env.DB, entry, fields.results, baseUrl, true, efRows.results, altTextMap, relatedData, c.env.JWT_SECRET);
  return c.json({ data });
});

export default publicApi;
