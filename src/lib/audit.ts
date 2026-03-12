import { JWTPayload } from '../types';
import { generateId } from './utils';

export async function logAudit(
  db: D1Database,
  actor: JWTPayload,
  action: string,
  resourceType: string,
  resourceId: string,
  resourceLabel: string | null,
  details?: Record<string, unknown>
): Promise<void> {
  await db.prepare(
    `INSERT INTO audit_logs (id, actor_id, actor_name, actor_role, action, resource_type, resource_id, resource_label, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    generateId(), actor.sub, actor.name ?? null, actor.role,
    action, resourceType, resourceId, resourceLabel ?? null,
    details ? JSON.stringify(details) : null,
    Date.now()
  ).run();
}
