-- Mark a content type as a "singleton" (a global): it holds exactly one entry, edited
-- in place rather than listed. Used for site-wide values like contact details, social
-- links, or SEO defaults.
--
-- Nullable-with-default column, so a plain ALTER TABLE is sufficient — no table
-- recreation needed. Existing content types default to 0 (a normal collection).

ALTER TABLE content_types ADD COLUMN is_singleton INTEGER NOT NULL DEFAULT 0;
