-- Migration: 011_clientdata_run_plan_entries_stage_filters
-- Description: Add stage filter columns and trans_level column to run_plan_entries table
-- Date: 2025-01-XX
--
-- This migration adds support for:
-- - Translevel storage for stage entries
-- - Stage-specific filters for random_stage entries (min/max difficulty, include/exclude flags)

-- Add trans_level column for stage entries (stores translevel_13bf value)
ALTER TABLE run_plan_entries ADD COLUMN trans_level TEXT;

-- Add stage filter columns for random_stage entries
ALTER TABLE run_plan_entries ADD COLUMN stage_filter_min_difficulty INTEGER;
ALTER TABLE run_plan_entries ADD COLUMN stage_filter_max_difficulty INTEGER;
ALTER TABLE run_plan_entries ADD COLUMN stage_filter_include_flags TEXT;  -- JSON array of flag codes: ['M', 'K', 'G', 'S', 'Ca', 'Bo']
ALTER TABLE run_plan_entries ADD COLUMN stage_filter_exclude_flags TEXT;  -- JSON array of flag codes

-- Add index for trans_level queries (optional, but useful for filtering)
CREATE INDEX IF NOT EXISTS idx_run_plan_entries_trans_level ON run_plan_entries(trans_level);

-- Note: stage_filter columns are NULL for non-random_stage entries
-- For random_stage entries:
-- - stage_filter_min_difficulty: 1-7 or NULL (no min filter)
-- - stage_filter_max_difficulty: 1-7 or NULL (no max filter)
-- - stage_filter_include_flags: JSON array like '["M","K","G","S","Ca","Bo"]' or NULL (all flags included by default)
-- - stage_filter_exclude_flags: JSON array like '["Se"]' or NULL (no exclusions by default)

