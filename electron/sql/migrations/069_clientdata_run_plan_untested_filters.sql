-- Migration 069: run_plan_entries untested stage filter columns
-- Date: 2026-06-14
-- Description: Persist include-untested / untested-only flags for random_stage entries

ALTER TABLE run_plan_entries ADD COLUMN stage_filter_include_untested INTEGER DEFAULT 0;
ALTER TABLE run_plan_entries ADD COLUMN stage_filter_untested_only INTEGER DEFAULT 0;
