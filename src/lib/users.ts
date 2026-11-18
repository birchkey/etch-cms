import { Env, Role, UserRow } from '../types';

export const ROLES = ['admin', 'editor'] as const;

// Roles aren't constrained in the database (see migration 0012), so anything unrecognised is
// treated as the least-privileged role rather than trusted.
export function normalizeRole(role: string): Role {
  return role === 'admin' ? 'admin' : 'editor';
}

export interface ResolvedUser {
  username: string;
  name?: string;
  role: Role;
  // Credentials (sessions, API tokens) issued before this are from an earlier account that
  // had the same username, and must not be honoured.
  created_at: number;
  // True for the retired environment admin (see legacyAdminActive).
  legacy?: boolean;
}

export async function hasDatabaseAdmin(db: D1Database): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").first());
}

/**
 * The environment admin (ADMIN_USERNAME / ADMIN_PASSWORD_HASH) is retired: it only works
 * until the first database admin exists, so that installs from before migration 0012 can
 * sign in once and have their account copied into the database. After that the secrets are
 * ignored, and `npm run admin:reset` is the way back in.
 */
export async function legacyAdminActive(env: Env, username: string): Promise<boolean> {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD_HASH || username !== env.ADMIN_USERNAME) return false;
  return !(await hasDatabaseAdmin(env.DB));
}

/** Looks a user up as they are now. Returns null if they no longer exist. */
export async function resolveUser(env: Env, username: string): Promise<ResolvedUser | null> {
  const user = await env.DB.prepare('SELECT username, name, role, created_at FROM users WHERE username = ?')
    .bind(username).first<Pick<UserRow, 'username' | 'name' | 'role' | 'created_at'>>();
  if (user) {
    return { username: user.username, name: user.name || undefined, role: normalizeRole(user.role), created_at: user.created_at };
  }
  if (await legacyAdminActive(env, username)) {
    return { username, role: 'admin', created_at: 0, legacy: true };
  }
  return null;
}

/**
 * Copies the environment admin into the users table on its first sign-in. The account is
 * dated to its oldest session or API token so those keep working (anything newer than an
 * account's created_at is honoured). Safe under concurrent sign-ins: the loser's insert is
 * ignored and both read back the same row.
 */
export async function migrateLegacyAdmin(env: Env): Promise<UserRow | null> {
  const username = env.ADMIN_USERNAME;
  const now = Date.now();
  const oldest = await env.DB.prepare(
    `SELECT MIN(created_at) AS t FROM (
       SELECT created_at FROM api_tokens WHERE owner_sub = ?
       UNION ALL SELECT created_at FROM refresh_tokens WHERE user_sub = ?
     )`
  ).bind(username, username).first<{ t: number | null }>();
  const createdAt = Math.min(oldest?.t ?? now, now);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, username, name, password_hash, role, must_reset_password, created_at, updated_at)
     VALUES (?, ?, '', ?, 'admin', 0, ?, ?)`
  ).bind(crypto.randomUUID(), username, env.ADMIN_PASSWORD_HASH, createdAt, now).run();

  return env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<UserRow>();
}

/**
 * Conditions that keep at least one admin. Appended to an UPDATE or DELETE on the target
 * user, they make the check and the write a single statement, so two admins demoting each
 * other at the same moment can't both succeed.
 */
export const KEEPS_AN_ADMIN = "(role != 'admin' OR (SELECT COUNT(*) FROM users WHERE role = 'admin' AND id != ?) > 0)";

/**
 * Call before creating or promoting an admin. If the environment admin hasn't been moved
 * into the database yet, the new admin would retire it on the spot and lock it out, so move
 * it first.
 */
export async function migrateLegacyAdminIfPending(env: Env): Promise<void> {
  if (env.ADMIN_USERNAME && env.ADMIN_PASSWORD_HASH && !(await hasDatabaseAdmin(env.DB))) {
    await migrateLegacyAdmin(env);
  }
}
