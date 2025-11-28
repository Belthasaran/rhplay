-- Migration: 050_clientdata_run_plan_entries_stage_filter_flags_extended
-- Description: Add extended stage filter flag columns (include_any_of_flags, exclude_only_flags) to run_plan_entries table
-- Date: 2025-01-XX
--
-- This migration adds support for:
-- - stage_filter_include_any_of_flags: Stages must have at least ONE of these flags
-- - stage_filter_exclude_only_flags: Stages with ALL of these flags are excluded
--
-- These complement the existing flag filters:
-- - stage_filter_include_flags: Stages must have ALL of these flags (MustInclude)
-- - stage_filter_exclude_flags: Stages with ANY of these flags are excluded

-- Add extended stage filter flag columns for random_stage entries
ALTER TABLE run_plan_entries ADD COLUMN stage_filter_include_any_of_flags TEXT;  -- JSON array of flag codes: ['M', 'K', 'G', 'S', 'Ca', 'Bo']
ALTER TABLE run_plan_entries ADD COLUMN stage_filter_exclude_only_flags TEXT;    -- JSON array of flag codes

-- Note: These columns are NULL for non-random_stage entries
-- For random_stage entries:
-- - stage_filter_include_any_of_flags: JSON array like '["M","K"]' or NULL (no filter)
--   Meaning: Stage must have at least ONE of these flags
-- - stage_filter_exclude_only_flags: JSON array like '["Se"]' or NULL (no filter)
--   Meaning: Stage with ALL of these flags is excluded

