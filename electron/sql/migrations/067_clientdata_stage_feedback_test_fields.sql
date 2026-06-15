-- Migration 067: stage_feedback test and tag fields
-- Date: 2026-06-14
-- Description: Extend stage_feedback for Stage Test dialog and unified Prepare Run feedback

ALTER TABLE stage_feedback ADD COLUMN feedback_source TEXT;
ALTER TABLE stage_feedback ADD COLUMN test_result TEXT
  CHECK (test_result IS NULL OR test_result IN ('no_action', 'reject', 'accept'));
ALTER TABLE stage_feedback ADD COLUMN tag_feedback TEXT;
ALTER TABLE stage_feedback ADD COLUMN stage_uuid TEXT;

CREATE INDEX IF NOT EXISTS idx_stage_feedback_source ON stage_feedback(feedback_source);
CREATE INDEX IF NOT EXISTS idx_stage_feedback_stage_uuid ON stage_feedback(stage_uuid);
