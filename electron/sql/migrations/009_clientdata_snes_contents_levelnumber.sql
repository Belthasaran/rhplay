-- Migration 009: Add levelnumber and levelname to snes_contents
-- Date: 2025-01-XX
-- Description: Adds levelnumber and levelname columns to snes_contents table to track which level was used when uploading a file

ALTER TABLE snes_contents ADD COLUMN levelnumber TEXT;
ALTER TABLE snes_contents ADD COLUMN levelname TEXT;

-- Index for querying by levelnumber
CREATE INDEX IF NOT EXISTS idx_snes_contents_levelnumber ON snes_contents(levelnumber);

