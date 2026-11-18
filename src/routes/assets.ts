import { Hono } from 'hono';
import { Env, AssetRow, JWTPayload } from '../types';
import { authMiddleware } from '../middleware/auth';
import { generateId } from '../lib/utils';
import { logAudit } from '../lib/audit';
import { z } from 'zod';
import { parseBody } from '../lib/validate';

const RegisterAssetSchema = z.object({
  r2_key: z.string().min(1, 'r2_key required'),
  alt_text: z.string().nullable().optional(),
});
const UpdateAssetSchema = z.object({
  alt_text: z.string().nullable().optional(),
  is_public: z.boolean().optional(),
});

const assets = new Hono<{ Bindings: Env; Variables: { jwtPayload: unknown } }>();

assets.use('*', authMiddleware);

// Formats validated by magic bytes — prevents MIME spoofing
const MAGIC_BYTE_TYPES: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg':      b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  'image/png':       b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47,
  'image/gif':       b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  'image/webp':      b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
                          b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  'application/pdf': b => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46, // %PDF
  'video/mp4':       b => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70, // ftyp
  'video/webm':      b => b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3, // EBML
};

// Formats accepted on declared MIME type alone (no reliable magic bytes)
const PASSTHROUGH_TYPES = new Set([
  'image/svg+xml', 'image/avif', 'image/x-icon', 'image/vnd.microsoft.icon',
]);

const ALLOWED_MIME_TYPES = new Set([...Object.keys(MAGIC_BYTE_TYPES), ...PASSTHROUGH_TYPES]);
const TYPE_NOT_ALLOWED = 'File type not allowed. Accepted: JPEG, PNG, GIF, WebP, AVIF, SVG, ICO, PDF, MP4, WebM';

// Imported files are named by type, since a URL often has no extension (or a misleading one).
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
  'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/webm': 'webm',
};

const IMPORT_TIMEOUT_MS = 20_000;
const IMPORT_MAX_REDIRECTS = 3;

const ImportAssetSchema = z.object({
  url: z.string().min(1, 'url required'),
  alt_text: z.string().nullable().optional(),
});

async function getUploadLimitMb(db: D1Database): Promise<number> {
  const limitRow = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('upload_limit_mb').first<{ value: string }>();
  return Math.max(1, parseInt(limitRow?.value ?? '50') || 50);
}

async function storeAsset(env: Env, file: {
  buffer: ArrayBuffer; contentType: string; originalName: string; ext: string; altText: string | null; sourceUrl: string | null;
}): Promise<AssetRow> {
  const id = generateId();
  const filename = `${id}${file.ext ? '.' + file.ext : ''}`;
  const r2Key = `assets/${filename}`;

  await env.ASSETS_BUCKET.put(r2Key, file.buffer, { httpMetadata: { contentType: file.contentType } });
  await env.DB.prepare(
    'INSERT INTO assets (id, filename, original_name, content_type, size, r2_key, alt_text, source_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, filename, file.originalName, file.contentType, file.buffer.byteLength, r2Key, file.altText, file.sourceUrl, Date.now()).run();

  return (await env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(id).first<AssetRow>())!;
}

// Only public https URLs on a named host. The Worker fetches whatever it is given, so refuse
// plain http, credentials in the URL, and addresses that can only mean a private network
// (which matters under `wrangler dev`, where the fetch runs on the developer's machine).
export function checkImportUrl(raw: string): { url: URL } | { error: string } {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return { error: 'url is not a valid URL' }; }
  if (url.protocol !== 'https:') return { error: 'Only https URLs can be imported' };
  if (url.username || url.password) return { error: 'URLs with credentials cannot be imported' };
  const host = url.hostname.toLowerCase();
  const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
  if (isIpLiteral || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.')) {
    return { error: 'URL must use a public hostname' };
  }
  url.hash = '';
  return { url };
}

// Follows redirects by hand so each hop is held to the same rules as the original URL, and
// reads the body with a byte cap so a server that lies about (or omits) Content-Length can't
// make the Worker buffer more than the upload limit.
async function fetchRemoteFile(url: URL, maxBytes: number): Promise<
  { buffer: ArrayBuffer; declaredType: string } | { error: string; status: 413 | 502 }
> {
  const signal = AbortSignal.timeout(IMPORT_TIMEOUT_MS);
  let current = url;
  let res: Response;
  try {
    for (let hop = 0; ; hop++) {
      res = await fetch(current.href, { redirect: 'manual', signal, headers: { 'user-agent': 'EtchCMS-AssetImport' } });
      if (res.status < 300 || res.status >= 400) break;
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location) return { error: `Source returned ${res.status} without a Location header`, status: 502 };
      if (hop >= IMPORT_MAX_REDIRECTS) return { error: 'Source redirected too many times', status: 502 };
      const next = checkImportUrl(new URL(location, current).href);
      if ('error' in next) return { error: `Source redirected to a URL that can't be imported: ${next.error}`, status: 502 };
      current = next.url;
    }
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { error: timedOut ? 'Timed out fetching the source URL' : 'Could not fetch the source URL', status: 502 };
  }

  if (!res.ok) {
    await res.body?.cancel();
    return { error: `Source returned ${res.status}`, status: 502 };
  }
  const tooLarge = { error: `File size exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit`, status: 413 as const };
  const declaredLength = Number(res.headers.get('content-length'));
  if (declaredLength > maxBytes) {
    await res.body?.cancel();
    return tooLarge;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (res.body) {
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return tooLarge;
        }
        chunks.push(value);
      }
    } catch {
      return { error: 'Connection failed while downloading the source URL', status: 502 };
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }

  const declaredType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return { buffer: bytes.buffer, declaredType };
}

// Servers often send a generic or wrong Content-Type for images (application/octet-stream,
// or a CDN's default), so trust the bytes: the declared type when the content matches it,
// otherwise whichever known format the content is. Formats without magic bytes are only
// accepted when declared.
function resolveImportedType(declared: string, bytes: Uint8Array): string | null {
  const check = MAGIC_BYTE_TYPES[declared];
  if (check ? check(bytes) : PASSTHROUGH_TYPES.has(declared)) return declared;
  for (const [type, matches] of Object.entries(MAGIC_BYTE_TYPES)) {
    if (bytes.length >= 12 && matches(bytes)) return type;
  }
  return null;
}

function fileNameFromUrl(url: URL, contentType: string): string {
  let name = url.pathname.split('/').filter(Boolean).pop() ?? '';
  try { name = decodeURIComponent(name); } catch { /* keep as is */ }
  name = name.slice(0, 200);
  if (!name) name = `${url.hostname}.${EXT_BY_TYPE[contentType] ?? 'bin'}`;
  return name;
}

// GET /api/assets
assets.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(1000, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10) || 50));
  const offset = (page - 1) * limit;
  const search = c.req.query('search')?.trim() ?? '';
  const filename = c.req.query('filename')?.trim() ?? '';

  const whereClause = filename ? 'WHERE filename = ?' : search ? 'WHERE original_name LIKE ?' : '';
  const searchBinding = filename ? [filename] : search ? [`%${search}%`] : [];

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM assets ${whereClause}`
  ).bind(...searchBinding).first<{ count: number }>();
  const total = countRow?.count ?? 0;

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM assets ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(...searchBinding, limit, offset).all<AssetRow>();

  const pages = Math.ceil(total / limit);
  return c.json({
    data: results,
    meta: { total, page, limit, pages, has_next: page < pages },
  });
});

// POST /api/assets — multipart upload
assets.post('/', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  const altText = (formData.get('alt_text') as string | null) || null;

  if (!file) return c.json({ error: 'No file provided' }, 400);

  const declaredType = file.type.toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(declaredType)) {
    return c.json({ error: TYPE_NOT_ALLOWED }, 415);
  }

  const limitMb = await getUploadLimitMb(c.env.DB);
  if (file.size > limitMb * 1024 * 1024) {
    return c.json({ error: `File size exceeds the ${limitMb} MB limit` }, 413);
  }

  const buffer = await file.arrayBuffer();

  // For formats with known magic bytes, verify content matches declared type
  const magicCheck = MAGIC_BYTE_TYPES[declaredType];
  if (magicCheck && !magicCheck(new Uint8Array(buffer))) {
    return c.json({ error: 'File content does not match declared type' }, 415);
  }

  const ext = file.name.includes('.') ? file.name.split('.').pop()! : '';
  const asset = await storeAsset(c.env, { buffer, contentType: file.type, originalName: file.name, ext, altText, sourceUrl: null });
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'asset.upload', 'asset', asset.id, file.name, { size: file.size, content_type: file.type }).catch(() => {});
  return c.json(asset, 201);
});

// POST /api/assets/import — fetch a file from a public https URL into the asset library.
// Importing a URL that was imported before returns the existing asset (200) instead of
// storing it again, so a catalog import can be re-run safely.
assets.post('/import', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = parseBody(ImportAssetSchema, raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const checked = checkImportUrl(parsed.data.url);
  if ('error' in checked) return c.json({ error: checked.error }, 400);
  const sourceUrl = checked.url.href;

  const existing = await c.env.DB.prepare('SELECT * FROM assets WHERE source_url = ? ORDER BY created_at LIMIT 1').bind(sourceUrl).first<AssetRow>();
  if (existing) return c.json(existing, 200);

  const limitMb = await getUploadLimitMb(c.env.DB);
  const fetched = await fetchRemoteFile(checked.url, limitMb * 1024 * 1024);
  if ('error' in fetched) return c.json({ error: fetched.error }, fetched.status);

  const bytes = new Uint8Array(fetched.buffer);
  const contentType = resolveImportedType(fetched.declaredType, bytes);
  if (!contentType) {
    return c.json({ error: `${TYPE_NOT_ALLOWED}. The URL returned ${fetched.declaredType || 'no content type'}` }, 415);
  }

  const originalName = fileNameFromUrl(checked.url, contentType);
  const altText = parsed.data.alt_text?.trim() || null;
  const asset = await storeAsset(c.env, {
    buffer: fetched.buffer, contentType, originalName, ext: EXT_BY_TYPE[contentType] ?? '', altText, sourceUrl,
  });
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'asset.import', 'asset', asset.id, originalName, { size: asset.size, content_type: contentType, source_url: sourceUrl }).catch(() => {});
  return c.json(asset, 201);
});

// POST /api/assets/register — link an existing R2 object into the asset library
assets.post('/register', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = parseBody(RegisterAssetSchema, raw);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.data;

  // Normalize key: strip leading slash, ensure assets/ prefix
  const rawKey = body.r2_key.trim().replace(/^\//, '');
  const r2Key = rawKey.startsWith('assets/') ? rawKey : `assets/${rawKey}`;

  const obj = await c.env.ASSETS_BUCKET.head(r2Key);
  if (!obj) return c.json({ error: 'Object not found in R2 bucket' }, 404);

  const filename = r2Key.replace(/^assets\//, '');
  const originalName = filename.split('/').pop() ?? filename;
  const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';
  const altText = body.alt_text?.trim() || null;

  const id = generateId();
  const now = Date.now();
  await c.env.DB.prepare(
    'INSERT INTO assets (id, filename, original_name, content_type, size, r2_key, alt_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, filename, originalName, contentType, obj.size, r2Key, altText, now).run();

  const asset = await c.env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(id).first<AssetRow>();
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'asset.register', 'asset', id, originalName, { r2_key: r2Key }).catch(() => {});
  return c.json(asset, 201);
});

// PATCH /api/assets/:id
assets.patch('/:id', async (c) => {
  const { id } = c.req.param();
  const asset = await c.env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(id).first<AssetRow>();
  if (!asset) return c.json({ error: 'Not found' }, 404);

  const raw = await c.req.json().catch(() => null);
  const patchParsed = parseBody(UpdateAssetSchema, raw);
  if (!patchParsed.ok) return c.json({ error: patchParsed.error }, 400);
  // Absent means "leave alone", not "clear" — a PATCH that only flips is_public must not
  // wipe the alt text, and one that only sets alt text must not un-publish the asset.
  // An explicit null still clears the alt text.
  const altText = patchParsed.data.alt_text === undefined
    ? asset.alt_text
    : (patchParsed.data.alt_text?.trim() || null);
  const isPublic = patchParsed.data.is_public === undefined
    ? asset.is_public
    : (patchParsed.data.is_public ? 1 : 0);

  await c.env.DB.prepare(
    'UPDATE assets SET alt_text = ?, is_public = ? WHERE id = ?'
  ).bind(altText, isPublic, id).run();

  const updated = await c.env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(id).first<AssetRow>();
  return c.json(updated);
});

// DELETE /api/assets/:id
assets.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const asset = await c.env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(id).first<AssetRow>();
  if (!asset) return c.json({ error: 'Not found' }, 404);

  await c.env.ASSETS_BUCKET.delete(asset.r2_key);
  await c.env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(id).run();
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'asset.delete', 'asset', id, asset.original_name, { size: asset.size }).catch(() => {});
  return c.json({ ok: true });
});

export default assets;
