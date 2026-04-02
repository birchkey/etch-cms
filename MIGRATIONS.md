# Migration Notes

## D1 / SQLite constraints

Cloudflare D1 runs each statement in a migration file in a separate context. This has two important consequences:

- **`PRAGMA` settings do not persist** between statements. `PRAGMA foreign_keys = OFF` set in one statement has no effect on the next.
- **`PRAGMA legacy_alter_table`** is similarly unreliable — do not depend on it.

## Safe pattern for table recreation

SQLite cannot alter CHECK constraints or column types in-place, so updating them requires recreating the table. When the table has child tables with foreign keys pointing to it (e.g. `entry_fields → fields`), use this pattern — no PRAGMA required:

```sql
-- 1. Create the replacement table
CREATE TABLE foo_new ( ... );

-- 2. Copy data from the original
INSERT INTO foo_new (col1, col2, ...)
SELECT col1, col2, ... FROM foo;

-- 3. Back up child table data (plain table, no constraints)
CREATE TABLE child_backup (col1 TEXT, col2 TEXT, ...);
INSERT INTO child_backup SELECT col1, col2, ... FROM child;

-- 4. Drop child tables (safe — they have no dependents of their own)
DROP TABLE child;

-- 5. Drop the original parent (safe now — nothing references it)
DROP TABLE foo;

-- 6. Rename replacement into place
ALTER TABLE foo_new RENAME TO foo;

-- 7. Recreate child tables with correct FK references
CREATE TABLE child (
  col1 TEXT NOT NULL REFERENCES foo(id) ON DELETE CASCADE,
  ...
);

-- 8. Restore child data and clean up
INSERT INTO child SELECT * FROM child_backup;
DROP TABLE child_backup;
```

**Why not just `DROP TABLE foo` directly?**
With `foreign_keys = ON` (the default, and unoverridable per-statement in D1), dropping a parent table that is referenced by a child FK raises a constraint error. You must drop the children first.

**Why not `ALTER TABLE foo RENAME TO foo_old`?**
SQLite 3.26+ automatically rewrites FK references in other tables when a table is renamed. After renaming `foo → foo_old`, any child table's `REFERENCES foo` becomes `REFERENCES foo_old`. If you then drop `foo_old`, those FK references dangle and break all writes to the child table.

## Avoiding future table recreations

The `type` CHECK constraint was removed from the `fields` table in migration `0004` — type validation is enforced by Zod at the API layer instead. This means **adding new field types requires only code changes, no migration**.

Two CHECK constraints remain that could require table recreation if expanded:

| Table | Column | Constraint |
|-------|--------|-----------|
| `fields` | `phone_format` | `CHECK(phone_format IN ('us', 'international'))` |
| `entries` | `status` | `CHECK(status IN ('draft', 'published', 'scheduled'))` |

If either of these needs a new value, use the safe pattern above.
