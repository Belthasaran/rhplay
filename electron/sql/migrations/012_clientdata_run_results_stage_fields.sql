-- Migration: 012_clientdata_run_results_stage_fields
-- Description: Add stage-specific columns to run_results table
-- Date: 2025-01-XX
--
-- This migration adds support for storing stage information in run_results:
-- - levelnumber: Stage level number (hex string, e.g., "001")
-- - translevel: Translevel value (13BF, hex string, e.g., "01")
-- - levelname: Stage name

-- Add stage-specific columns to run_results table
ALTER TABLE run_results ADD COLUMN levelnumber TEXT;
ALTER TABLE run_results ADD COLUMN translevel TEXT;
ALTER TABLE run_results ADD COLUMN levelname TEXT;

-- Add index for levelnumber queries (optional, but useful for filtering)
CREATE INDEX IF NOT EXISTS idx_run_results_levelnumber ON run_results(levelnumber);

-- Note: These columns are NULL for non-stage entries (game entries)
-- For stage entries:
-- - levelnumber: Hex string (e.g., "001", "13C") from gamestages.levelnumber
-- - translevel: Hex string (e.g., "01", "25") from gamestages.translevel_13bf
-- - levelname: Stage name from gamestages.levelname

