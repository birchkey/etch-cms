-- Add 'color' to the fields type CHECK constraint, and drop the CHECK on type
-- entirely so future type additions don't require table recreation.
--
-- Strategy (no PRAGMA required):
--   1. Create fields_new with updated schema (no CHECK on type)
--   2. Copy field definitions
--   3. Back up entry_fields / entry_fields_draft data (child tables — safe to drop)
--   4. Drop child tables so fields has no dependents
--   5. Drop fields (now safe — nothing references it)
--   6. Rename fields_new → fields
--   7. Recreate entry_fields / entry_fields_draft with correct FKs
--   8. Restore data and drop backups

CREATE TABLE fields_new (
  id TEXT PRIMARY KEY,
  content_type_id TEXT NOT NULL REFERENCES content_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT NOT NULL,
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
  phone_format TEXT CHECK(phone_format IN ('us', 'international')),
  UNIQUE(content_type_id, slug)
);

INSERT INTO fields_new (id, content_type_id, name, slug, type, required, sort_order, relation_content_type_id, relation_cardinality, multiple, rich_text_extensions, select_options, min_length, max_length, min_value, max_value, pattern, created_at, phone_format)
SELECT                  id, content_type_id, name, slug, type, required, sort_order, relation_content_type_id, relation_cardinality, multiple, rich_text_extensions, select_options, min_length, max_length, min_value, max_value, pattern, created_at, phone_format
FROM fields;

CREATE TABLE entry_fields_backup (entry_id TEXT, field_id TEXT, value TEXT);

INSERT INTO entry_fields_backup SELECT entry_id, field_id, value FROM entry_fields;

CREATE TABLE entry_fields_draft_backup (entry_id TEXT, field_id TEXT, value TEXT);

INSERT INTO entry_fields_draft_backup SELECT entry_id, field_id, value FROM entry_fields_draft;

DROP TABLE entry_fields;

DROP TABLE entry_fields_draft;

DROP TABLE fields;

ALTER TABLE fields_new RENAME TO fields;

CREATE TABLE entry_fields (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  value TEXT,
  PRIMARY KEY (entry_id, field_id)
);

CREATE INDEX idx_entry_fields_field ON entry_fields(field_id);

CREATE TABLE entry_fields_draft (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  value TEXT,
  PRIMARY KEY (entry_id, field_id)
);

INSERT INTO entry_fields SELECT * FROM entry_fields_backup;

INSERT INTO entry_fields_draft SELECT * FROM entry_fields_draft_backup;

DROP TABLE entry_fields_backup;

DROP TABLE entry_fields_draft_backup;
