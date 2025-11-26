-- Migration 044: Add stage-related fields to snes_contents table
-- Date: 2025-01-XX
-- Description: Adds stage_uuid, patchcodes, and patch_parameters columns
-- to snes_contents table to track which stage was used and what patches/parameters
-- were applied when uploading a file for testing purposes.
-- Note: levelnumber already exists from migration 009.

ALTER TABLE snes_contents ADD COLUMN stage_uuid TEXT;
ALTER TABLE snes_contents ADD COLUMN patchcodes TEXT;
ALTER TABLE snes_contents ADD COLUMN patch_parameters TEXT;

-- Index for querying by stage_uuid
CREATE INDEX IF NOT EXISTS idx_snes_contents_stage_uuid ON snes_contents(stage_uuid);

-- Note:
-- - stage_uuid: The UUID of the gamestage record that was used
-- - patchcodes: Comma-separated list of patch codes applied (e.g., "1lvno,infliv")
-- - patch_parameters: JSON string containing patch parameters used during staging

