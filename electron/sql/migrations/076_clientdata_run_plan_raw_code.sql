-- Migration 076: raw_code plan entry columns for share-code import
ALTER TABLE run_plan_entries ADD COLUMN raw_level_code TEXT;
ALTER TABLE run_plan_entries ADD COLUMN plan_stage_name TEXT;
