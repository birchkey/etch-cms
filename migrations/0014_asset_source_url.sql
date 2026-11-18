-- Where an asset was imported from, for assets created with POST /api/assets/import. Importing
-- the same URL again returns the existing asset instead of storing a second copy, which makes
-- catalog imports safe to re-run. NULL for uploaded and registered assets.
ALTER TABLE assets ADD COLUMN source_url TEXT;
CREATE INDEX idx_assets_source_url ON assets(source_url);
