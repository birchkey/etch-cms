-- Long-lived API tokens for scripts, integrations and agents.
--
-- A token acts as the user who created it: role and content-type permissions are
-- resolved from owner_sub on every request, never stored here, so permission changes
-- and user deletion take effect immediately. owner_sub is a username (matching the JWT
-- `sub`), which is how the hardcoded env admin is identified — it has no users row, so
-- there is no foreign key.
--
-- Only a SHA-256 hash of the token is stored. token_hint holds the first few characters
-- so people can tell their tokens apart in the UI.

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_api_tokens_owner ON api_tokens(owner_sub);
