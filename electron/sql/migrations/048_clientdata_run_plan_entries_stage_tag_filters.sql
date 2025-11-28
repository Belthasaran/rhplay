-- Migration: 048_clientdata_run_plan_entries_stage_tag_filters
-- Description: Add stage tag filter columns to run_plan_entries table
-- Date: 2025-01-XX
--
-- This migration adds support for filtering random stages by stagetags:
-- - stage_filter_has_tags: JSON array of tags that stage must have ALL of
-- - stage_filter_exclude_tags: JSON array of tags that stage must NOT have ANY of

-- Add stage tag filter columns for random_stage entries
ALTER TABLE run_plan_entries ADD COLUMN stage_filter_has_tags TEXT;  -- JSON array of tag names
ALTER TABLE run_plan_entries ADD COLUMN stage_filter_exclude_tags TEXT;  -- JSON array of tag names

-- Note: stage_filter tag columns are NULL for non-random_stage entries
-- For random_stage entries:
-- - stage_filter_has_tags: JSON array like '["cape","autoscroller"]' or NULL (no tag requirement)
-- - stage_filter_exclude_tags: JSON array like '["cape"]' or NULL (no tag exclusions)

