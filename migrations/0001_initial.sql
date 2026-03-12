-- Content types
CREATE TABLE content_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  preview_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Fields
CREATE TABLE fields (
  id TEXT PRIMARY KEY,
  content_type_id TEXT NOT NULL REFERENCES content_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('text','rich_text','image','number','datetime','boolean','relation','select')),
  required INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  relation_content_type_id TEXT REFERENCES content_types(id) ON DELETE SET NULL,
  relation_cardinality TEXT CHECK(relation_cardinality IN ('one','many')),
  multiple INTEGER NOT NULL DEFAULT 0,
  rich_text_extensions TEXT,
  select_options TEXT,
  min_length INTEGER,
  max_length INTEGER,
  min_value REAL,
  max_value REAL,
  pattern TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(content_type_id, slug)
);

-- Entries
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  content_type_id TEXT NOT NULL REFERENCES content_types(id) ON DELETE CASCADE,
  slug TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','scheduled')),
  has_unpublished_changes INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER,
  scheduled_at INTEGER
);
CREATE UNIQUE INDEX idx_entries_slug ON entries(content_type_id, slug) WHERE slug IS NOT NULL;
CREATE INDEX idx_entries_ct_status ON entries(content_type_id, status);
CREATE INDEX idx_entries_ct_sort ON entries(content_type_id, sort_order);

-- Entry fields (live)
CREATE TABLE entry_fields (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  value TEXT,
  PRIMARY KEY (entry_id, field_id)
);
CREATE INDEX idx_entry_fields_field ON entry_fields(field_id);

-- Entry fields (draft — for published entries with unpublished edits)
CREATE TABLE entry_fields_draft (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  value TEXT,
  PRIMARY KEY (entry_id, field_id)
);

-- Assets
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  alt_text TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_assets_r2key ON assets(r2_key);

-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('editor')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Settings
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('site_name', 'Basic CMS');
INSERT OR IGNORE INTO settings (key, value) VALUES ('logo_type', 'text');
INSERT OR IGNORE INTO settings (key, value) VALUES ('logo_image_url', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('accent_color', '#4f46e5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('favicon_url', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('upload_limit_mb', '50');

-- Webhooks
CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Webhook delivery logs
CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  status_code INTEGER,
  success INTEGER NOT NULL,
  error TEXT,
  duration_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, created_at DESC);

-- Login rate limiting
CREATE TABLE login_attempts (
  ip TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts_ip_time ON login_attempts(ip, attempted_at);

-- Refresh tokens
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  user_role TEXT NOT NULL,
  user_name TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_sub);

-- Audit log
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_name TEXT,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  resource_label TEXT,
  details TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_resource_type ON audit_logs(resource_type, created_at DESC);

-- Per-editor content type permissions
-- No rows for a user = unrestricted; any rows = restricted to those content types
CREATE TABLE user_permissions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type_id TEXT NOT NULL REFERENCES content_types(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, content_type_id)
);
CREATE INDEX idx_user_permissions_user ON user_permissions(user_id);
