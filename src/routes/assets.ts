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
const UpdateAssetSchema = z.object({ alt_text: z.string().nullable().optional() });

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
    return c.json({ error: 'File type not allowed. Accepted: JPEG, PNG, GIF, WebP, AVIF, SVG, ICO, PDF, MP4, WebM' }, 415);
  }

  const limitRow = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('upload_limit_mb').first<{ value: string }>();
  const limitMb = Math.max(1, parseInt(limitRow?.value ?? '50') || 50);
  if (file.size > limitMb * 1024 * 1024) {
    return c.json({ error: `File size exceeds the ${limitMb} MB limit` }, 413);
  }

  const buffer = await file.arrayBuffer();

  // For formats with known magic bytes, verify content matches declared type
  const magicCheck = MAGIC_BYTE_TYPES[declaredType];
  if (magicCheck && !magicCheck(new Uint8Array(buffer))) {
    return c.json({ error: 'File content does not match declared type' }, 415);
  }

  const id = generateId();
  const ext = file.name.split('.').pop() ?? '';
  const filename = `${id}${ext ? '.' + ext : ''}`;
  const r2Key = `assets/${filename}`;
  const now = Date.now();

  await c.env.ASSETS_BUCKET.put(r2Key, buffer, {
    httpMetadata: { contentType: file.type },
  });

  await c.env.DB.prepare(
    'INSERT INTO assets (id, filename, original_name, content_type, size, r2_key, alt_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, filename, file.name, file.type, file.size, r2Key, altText, now).run();

  const asset = await c.env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(id).first<AssetRow>();
  void logAudit(c.env.DB, c.get('jwtPayload') as JWTPayload, 'asset.upload', 'asset', id, file.name, { size: file.size, content_type: file.type }).catch(() => {});
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
  const altText = typeof patchParsed.data.alt_text === 'string' ? patchParsed.data.alt_text.trim() || null : null;

  await c.env.DB.prepare(
    'UPDATE assets SET alt_text = ? WHERE id = ?'
  ).bind(altText, id).run();

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
