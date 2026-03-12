import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware, adminOnly } from '../middleware/auth';

const auditLog = new Hono<{ Bindings: Env; Variables: { jwtPayload: unknown } }>();

auditLog.use('*', authMiddleware);
auditLog.use('*', adminOnly);

// GET /api/audit-logs
auditLog.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10) || 50));
  const offset = (page - 1) * limit;
  const resourceType = c.req.query('resource_type') ?? '';

  const VALID_TYPES = new Set(['entry', 'content_type', 'asset']);
  const whereClause = VALID_TYPES.has(resourceType) ? 'WHERE resource_type = ?' : '';
  const bindings: unknown[] = VALID_TYPES.has(resourceType) ? [resourceType] : [];

  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM audit_logs ${whereClause}`
  ).bind(...bindings).first<{ count: number }>();
  const total = countRow?.count ?? 0;

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(...bindings, limit, offset).all();

  const pages = Math.ceil(total / limit);
  return c.json({
    data: results,
    meta: { total, page, limit, pages, has_next: page < pages },
  });
});

export default auditLog;
