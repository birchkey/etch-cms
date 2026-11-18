import { Context } from 'hono';
import { Env, JWTPayload } from '../types';
import { verifyPassword } from '../middleware/auth';
import { isRateLimited, recordFailedAttempt, retryAfterHeader } from './rate-limit';
import { legacyAdminActive } from './users';

/**
 * Asks the signed-in admin to re-enter their password before an action that hands out admin
 * access: creating an admin, promoting someone to admin, or resetting another admin's
 * password. Each of these makes a lasting admin that a stolen session (or a leaked API
 * token) could otherwise create and keep after the session is revoked.
 *
 * Returns a response to send back if the confirmation fails, or null to carry on. Failures
 * use 403, not 401: the client treats 401 as an expired session and signs the user out.
 */
export async function requirePasswordConfirmation(
  c: Context<{ Bindings: Env; Variables: { jwtPayload: JWTPayload } }>,
  password: string | undefined,
): Promise<Response | null> {
  const actor = c.get('jwtPayload');
  if (actor.token_id) {
    return c.json({ error: 'This action requires signing in; API tokens cannot be used', code: 'session_required' }, 403);
  }
  if (!password) {
    return c.json({ error: 'Enter your password to confirm this change', code: 'password_required' }, 403);
  }

  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const nowMs = Date.now();
  if (await isRateLimited(c.env.DB, c.executionCtx, ip, nowMs)) {
    return c.json({ error: 'Too many attempts. Try again later.' }, { status: 429, headers: retryAfterHeader() });
  }

  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE username = ?')
    .bind(actor.sub).first<{ password_hash: string }>();
  // A session the environment admin opened before upgrading has no users row yet.
  const hash = row?.password_hash
    ?? (await legacyAdminActive(c.env, actor.sub) ? c.env.ADMIN_PASSWORD_HASH : undefined);
  if (!hash || !(await verifyPassword(password, hash))) {
    await recordFailedAttempt(c.env.DB, ip, nowMs);
    return c.json({ error: 'Incorrect password', code: 'password_incorrect' }, 403);
  }
  return null;
}
