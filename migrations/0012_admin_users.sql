-- Let users be admins, so admins live in the database instead of the ADMIN_USERNAME /
-- ADMIN_PASSWORD_HASH secrets.
--
-- The role CHECK constraint is dropped rather than widened: roles are validated by Zod at the
-- API layer, so adding a role later needs only code changes (the same approach migration 0004
-- took for field types). Code treats any role other than 'admin' as least-privileged.
--
-- users has a child table (user_permissions, ON DELETE CASCADE), so this uses the safe
-- recreation pattern from MIGRATIONS.md. Dropping users while user_permissions still pointed
-- at it would fail; renaming users first would leave user_permissions pointing at a dropped
-- table. Back up the child, drop it, swap the parent, then restore.
--
-- Existing installs keep working: the environment admin can still sign in until the first
-- database admin exists. Their first sign-in after this migration creates that admin.

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  must_reset_password INTEGER NOT NULL DEFAULT 0
);

INSERT INTO users_new (id, username, name, password_hash, role, created_at, updated_at, must_reset_password)
SELECT                 id, username, name, password_hash, role, created_at, updated_at, must_reset_password
FROM users;

CREATE TABLE user_permissions_backup (user_id TEXT, content_type_id TEXT);

INSERT INTO user_permissions_backup SELECT user_id, content_type_id FROM user_permissions;

DROP TABLE user_permissions;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

CREATE INDEX idx_users_role ON users(role);

CREATE TABLE user_permissions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type_id TEXT NOT NULL REFERENCES content_types(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, content_type_id)
);

CREATE INDEX idx_user_permissions_user ON user_permissions(user_id);

INSERT INTO user_permissions SELECT user_id, content_type_id FROM user_permissions_backup;

DROP TABLE user_permissions_backup;
