-- Add repeater_subfields column to fields table.
-- This stores a JSON array of sub-field definitions for repeater fields.
-- Simple ALTER TABLE ADD COLUMN — no table recreation needed since the column is nullable.

ALTER TABLE fields ADD COLUMN repeater_subfields TEXT;
