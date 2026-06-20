-- Run type (standard vs free_play) and optional stage prerequisites (schema for future use)
ALTER TABLE runs ADD COLUMN run_type TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE run_plan_entries ADD COLUMN prerequisites_json TEXT;
ALTER TABLE run_results ADD COLUMN prerequisites_json TEXT;
