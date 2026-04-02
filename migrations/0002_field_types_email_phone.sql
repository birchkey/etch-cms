-- SQLite does not support ALTER TABLE ... ALTER COLUMN CHECK constraints,
-- so we recreate the fields table with the updated constraint.
--
-- We use fields_new (not fields_old) to avoid the issue where SQLite >= 3.26
-- rewrites FK references in entry_fields/entry_fields_draft when renaming
-- the original table. By creating a new table and renaming it into place,
-- the original 'fields' table (which other tables reference) is dropped last
-- after the new one has already taken its name.

PRAGMA foreign_keys = OFF;

CREATE TABLE fields_new (
  id TEXT PRIMARY KEY,
  content_type_id TEXT NOT NULL REFERENCES content_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('text','rich_text','image','number','datetime','boolean','relation','select','email','phone')),
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

INSERT INTO fields_new SELECT * FROM fields;

DROP TABLE fields;

ALTER TABLE fields_new RENAME TO fields;

PRAGMA foreign_keys = ON;
