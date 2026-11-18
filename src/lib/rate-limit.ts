// Failed password attempts, per IP, shared by sign-in, token refresh and password
// confirmation, so a stolen session can't be used to guess its owner's password any faster
// than signing in would allow.

export const RATE_LIMIT_MAX = 10;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Only waitUntil is needed here. Typing the parameter structurally keeps this compatible with
// both Hono's ExecutionContext (what c.executionCtx returns) and the Workers runtime's, which
// have drifted apart — workers-types v5 added `tracing`/`abort` that Hono's interface lacks.
export async function isRateLimited(db: D1Database, ctx: { waitUntil(promise: Promise<unknown>): void }, ip: string, nowMs: number): Promise<boolean> {
  const cutoff = nowMs - RATE_LIMIT_WINDOW_MS;
  ctx.waitUntil(db.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(cutoff).run());
  const row = await db.prepare(
    'SELECT COUNT(*) as count FROM login_attempts WHERE ip = ? AND attempted_at > ?'
  ).bind(ip, cutoff).first<{ count: number }>();
  return (row?.count ?? 0) >= RATE_LIMIT_MAX;
}

export async function recordFailedAttempt(db: D1Database, ip: string, nowMs: number): Promise<void> {
  await db.prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)').bind(ip, nowMs).run();
}

export const retryAfterHeader = () => ({ 'Retry-After': String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) });
