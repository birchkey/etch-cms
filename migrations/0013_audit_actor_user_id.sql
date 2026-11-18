-- Record which account made each change, not just its username. Usernames can be reused
-- after a user is deleted, so the username alone can't tell an old account's history from a
-- new account with the same name.
--
-- Entries written before this migration have no id (NULL) and stay attributed by username
-- only; there's no reliable way to back-fill them. NULL is also recorded for the retired
-- environment admin, which has no users row.
ALTER TABLE audit_logs ADD COLUMN actor_user_id TEXT;
