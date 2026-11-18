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
  // Record which API token made the change, so a script's actions can be told apart
  // from the same user working in the admin UI.
  if (actor.token_id) details = { ...details, api_token_id: actor.token_id };
  await db.prepare(
    // actor_user_id is looked up in the same statement. The request was authenticated against
    // the account that holds this username right now, so that's the account that acted.
    `INSERT INTO audit_logs (id, actor_id, actor_user_id, actor_name, actor_role, action, resource_type, resource_id, resource_label, details, created_at)
     VALUES (?, ?, (SELECT id FROM users WHERE username = ?), ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    generateId(), actor.sub, actor.sub, actor.name ?? null, actor.role,
    action, resourceType, resourceId, resourceLabel ?? null,
    details ? JSON.stringify(details) : null,
    Date.now()
  ).run();
}
