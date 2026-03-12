import { JWTPayload } from '../types';

/**
 * Returns the set of content type IDs the requesting user may access.
 *   null       — unrestricted (admin, or editor with no permission rows)
 *   string[]   — restricted to exactly these IDs (may be empty)
 */
export async function getPermittedContentTypeIds(
  db: D1Database,
  payload: JWTPayload,
): Promise<string[] | null> {
  if (payload.role === 'admin') return null;

  const user = await db
    .prepare('SELECT id FROM users WHERE username = ?')
    .bind(payload.sub)
    .first<{ id: string }>();
  if (!user) return [];

  const { results } = await db
    .prepare('SELECT content_type_id FROM user_permissions WHERE user_id = ?')
    .bind(user.id)
    .all<{ content_type_id: string }>();

  if (results.length === 0) return null;
  return results.map(r => r.content_type_id);
}

export function isPermitted(permitted: string[] | null, contentTypeId: string): boolean {
  if (permitted === null) return true;
  return permitted.includes(contentTypeId);
}
