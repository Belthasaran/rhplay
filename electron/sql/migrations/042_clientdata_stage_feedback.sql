-- Migration 042: Create stage_feedback table
-- Date: 2025-01-XX
-- Description: Creates stage_feedback table to track user difficulty feedback and comments for individual game stages

CREATE TABLE IF NOT EXISTS stage_feedback (
  feedback_uuid TEXT PRIMARY KEY,
  gameid TEXT NOT NULL,
  levelnumber TEXT NOT NULL,
  translevel TEXT,
  levelname TEXT,
  difficulty_feedback INTEGER,  -- 0-9 difficulty rating
  comment TEXT,  -- Text comment/note
  current_difficulty INTEGER,  -- Stage difficulty at time of feedback
  flag_values TEXT,  -- JSON string of flag values at time of feedback
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  
  -- Ensure only one feedback per gameid+levelnumber combination
  UNIQUE(gameid, levelnumber)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_stage_feedback_gameid ON stage_feedback(gameid);
CREATE INDEX IF NOT EXISTS idx_stage_feedback_levelnumber ON stage_feedback(levelnumber);
CREATE INDEX IF NOT EXISTS idx_stage_feedback_created_at ON stage_feedback(created_at DESC);

-- Trigger to update updated_at on changes
CREATE TRIGGER IF NOT EXISTS trg_stage_feedback_updated
  AFTER UPDATE ON stage_feedback
  FOR EACH ROW
BEGIN
  UPDATE stage_feedback SET updated_at = strftime('%s', 'now') WHERE feedback_uuid = NEW.feedback_uuid;
END;

