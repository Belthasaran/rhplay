-- Migration: Change user_difficulty_rating constraint from 0-5 to 0-10
-- Date: 2025-01-XX
-- Database: clientdata.db
-- Purpose: Update CHECK constraints to allow 0-10 range for user_difficulty_rating (instead of 0-5),
--          as this is a game difficulty score opinion, not a normal star rating like the others.

-- Note: SQLite doesn't support directly modifying CHECK constraints on existing columns.
-- We need to recreate the affected tables with updated constraints.

-- =============================================================================
-- Update user_game_annotations table
-- =============================================================================

-- Step 0: Drop dependent views before dropping tables
-- Note: Also drop v_run_results_timing_compat to avoid SQLite validation errors
-- during table recreation, even though we're not modifying run_results
DROP VIEW IF EXISTS v_games_with_annotations;
DROP VIEW IF EXISTS v_stages_with_annotations;
DROP VIEW IF EXISTS v_run_results_timing_compat;

-- Step 1: Create temporary table with updated constraints
CREATE TABLE user_game_annotations_new (
    gameid TEXT PRIMARY KEY,
    status TEXT DEFAULT 'Default',
    -- Deprecated user_rating column (kept for backwards compatibility)
    user_rating INTEGER CHECK (user_rating IS NULL OR (user_rating >= 1 AND user_rating <= 5)),
    user_difficulty_rating INTEGER CHECK (user_difficulty_rating IS NULL OR (user_difficulty_rating >= 0 AND user_difficulty_rating <= 10)),
    user_review_rating INTEGER CHECK (user_review_rating IS NULL OR (user_review_rating >= 0 AND user_review_rating <= 5)),
    user_skill_rating INTEGER CHECK (user_skill_rating IS NULL OR (user_skill_rating >= 0 AND user_skill_rating <= 10)),
    user_skill_rating_when_beat INTEGER CHECK (user_skill_rating_when_beat IS NULL OR (user_skill_rating_when_beat >= 0 AND user_skill_rating_when_beat <= 10)),
    user_recommendation_rating INTEGER CHECK (user_recommendation_rating IS NULL OR (user_recommendation_rating >= 0 AND user_recommendation_rating <= 5)),
    user_importance_rating INTEGER CHECK (user_importance_rating IS NULL OR (user_importance_rating >= 0 AND user_importance_rating <= 5)),
    user_technical_quality_rating INTEGER CHECK (user_technical_quality_rating IS NULL OR (user_technical_quality_rating >= 0 AND user_technical_quality_rating <= 5)),
    user_gameplay_design_rating INTEGER CHECK (user_gameplay_design_rating IS NULL OR (user_gameplay_design_rating >= 0 AND user_gameplay_design_rating <= 5)),
    user_originality_rating INTEGER CHECK (user_originality_rating IS NULL OR (user_originality_rating >= 0 AND user_originality_rating <= 5)),
    user_visual_aesthetics_rating INTEGER CHECK (user_visual_aesthetics_rating IS NULL OR (user_visual_aesthetics_rating >= 0 AND user_visual_aesthetics_rating <= 5)),
    user_story_rating INTEGER CHECK (user_story_rating IS NULL OR (user_story_rating >= 0 AND user_story_rating <= 5)),
    user_soundtrack_graphics_rating INTEGER CHECK (user_soundtrack_graphics_rating IS NULL OR (user_soundtrack_graphics_rating >= 0 AND user_soundtrack_graphics_rating <= 5)),
    user_difficulty_comment TEXT,
    user_skill_comment TEXT,
    user_skill_comment_when_beat TEXT,
    user_review_comment TEXT,
    user_recommendation_comment TEXT,
    user_importance_comment TEXT,
    user_technical_quality_comment TEXT,
    user_gameplay_design_comment TEXT,
    user_originality_comment TEXT,
    user_visual_aesthetics_comment TEXT,
    user_story_comment TEXT,
    user_soundtrack_graphics_comment TEXT,
    hidden INTEGER DEFAULT 0,
    exclude_from_random INTEGER DEFAULT 0,
    user_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Step 2: Copy all data from old table to new table
INSERT INTO user_game_annotations_new 
SELECT 
    gameid,
    status,
    user_rating,
    user_difficulty_rating,
    user_review_rating,
    user_skill_rating,
    user_skill_rating_when_beat,
    user_recommendation_rating,
    user_importance_rating,
    user_technical_quality_rating,
    user_gameplay_design_rating,
    user_originality_rating,
    user_visual_aesthetics_rating,
    user_story_rating,
    user_soundtrack_graphics_rating,
    user_difficulty_comment,
    user_skill_comment,
    user_skill_comment_when_beat,
    user_review_comment,
    user_recommendation_comment,
    user_importance_comment,
    user_technical_quality_comment,
    user_gameplay_design_comment,
    user_originality_comment,
    user_visual_aesthetics_comment,
    user_story_comment,
    user_soundtrack_graphics_comment,
    hidden,
    exclude_from_random,
    user_notes,
    created_at,
    updated_at
FROM user_game_annotations;

-- Step 3: Drop old table
DROP TABLE user_game_annotations;

-- Step 4: Rename new table to original name
ALTER TABLE user_game_annotations_new RENAME TO user_game_annotations;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_user_game_status ON user_game_annotations(status);
CREATE INDEX IF NOT EXISTS idx_user_game_hidden ON user_game_annotations(hidden);
CREATE INDEX IF NOT EXISTS idx_user_game_rating ON user_game_annotations(user_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_difficulty ON user_game_annotations(user_difficulty_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_review ON user_game_annotations(user_review_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_exclude ON user_game_annotations(exclude_from_random);
CREATE INDEX IF NOT EXISTS idx_user_game_skill_when_beat ON user_game_annotations(user_skill_rating_when_beat);
CREATE INDEX IF NOT EXISTS idx_user_game_recommendation ON user_game_annotations(user_recommendation_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_importance ON user_game_annotations(user_importance_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_technical_quality ON user_game_annotations(user_technical_quality_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_gameplay_design ON user_game_annotations(user_gameplay_design_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_originality ON user_game_annotations(user_originality_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_visual_aesthetics ON user_game_annotations(user_visual_aesthetics_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_story ON user_game_annotations(user_story_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_soundtrack_graphics ON user_game_annotations(user_soundtrack_graphics_rating);

-- Step 6: Recreate trigger for updated_at timestamp
CREATE TRIGGER IF NOT EXISTS trigger_user_game_updated 
AFTER UPDATE ON user_game_annotations
BEGIN
    UPDATE user_game_annotations 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE gameid = NEW.gameid;
END;

-- Step 7: Recreate dependent views
CREATE VIEW v_games_with_annotations AS
SELECT 
    gameid,
    COALESCE(status, 'Default') as status,
    user_difficulty_rating,
    user_review_rating,
    user_skill_rating,
    COALESCE(hidden, 0) as hidden,
    COALESCE(exclude_from_random, 0) as exclude_from_random,
    user_notes,
    created_at,
    updated_at
FROM user_game_annotations;

-- =============================================================================
-- Update user_game_version_annotations table
-- =============================================================================

-- Step 1: Create temporary table with updated constraints
CREATE TABLE user_game_version_annotations_new (
    gameid TEXT NOT NULL,
    version INTEGER NOT NULL,
    status TEXT DEFAULT 'Default',
    user_difficulty_rating INTEGER CHECK (user_difficulty_rating IS NULL OR (user_difficulty_rating >= 0 AND user_difficulty_rating <= 10)),
    user_review_rating INTEGER CHECK (user_review_rating IS NULL OR (user_review_rating >= 0 AND user_review_rating <= 5)),
    user_skill_rating INTEGER CHECK (user_skill_rating IS NULL OR (user_skill_rating >= 0 AND user_skill_rating <= 10)),
    user_skill_rating_when_beat INTEGER CHECK (user_skill_rating_when_beat IS NULL OR (user_skill_rating_when_beat >= 0 AND user_skill_rating_when_beat <= 10)),
    user_recommendation_rating INTEGER CHECK (user_recommendation_rating IS NULL OR (user_recommendation_rating >= 0 AND user_recommendation_rating <= 5)),
    user_importance_rating INTEGER CHECK (user_importance_rating IS NULL OR (user_importance_rating >= 0 AND user_importance_rating <= 5)),
    user_technical_quality_rating INTEGER CHECK (user_technical_quality_rating IS NULL OR (user_technical_quality_rating >= 0 AND user_technical_quality_rating <= 5)),
    user_gameplay_design_rating INTEGER CHECK (user_gameplay_design_rating IS NULL OR (user_gameplay_design_rating >= 0 AND user_gameplay_design_rating <= 5)),
    user_originality_rating INTEGER CHECK (user_originality_rating IS NULL OR (user_originality_rating >= 0 AND user_originality_rating <= 5)),
    user_visual_aesthetics_rating INTEGER CHECK (user_visual_aesthetics_rating IS NULL OR (user_visual_aesthetics_rating >= 0 AND user_visual_aesthetics_rating <= 5)),
    user_story_rating INTEGER CHECK (user_story_rating IS NULL OR (user_story_rating >= 0 AND user_story_rating <= 5)),
    user_soundtrack_graphics_rating INTEGER CHECK (user_soundtrack_graphics_rating IS NULL OR (user_soundtrack_graphics_rating >= 0 AND user_soundtrack_graphics_rating <= 5)),
    user_difficulty_comment TEXT,
    user_skill_comment TEXT,
    user_skill_comment_when_beat TEXT,
    user_review_comment TEXT,
    user_recommendation_comment TEXT,
    user_importance_comment TEXT,
    user_technical_quality_comment TEXT,
    user_gameplay_design_comment TEXT,
    user_originality_comment TEXT,
    user_visual_aesthetics_comment TEXT,
    user_story_comment TEXT,
    user_soundtrack_graphics_comment TEXT,
    user_notes TEXT,
    PRIMARY KEY (gameid, version)
);

-- Step 2: Copy all data from old table to new table
INSERT INTO user_game_version_annotations_new 
SELECT 
    gameid,
    version,
    status,
    user_difficulty_rating,
    user_review_rating,
    user_skill_rating,
    user_skill_rating_when_beat,
    user_recommendation_rating,
    user_importance_rating,
    user_technical_quality_rating,
    user_gameplay_design_rating,
    user_originality_rating,
    user_visual_aesthetics_rating,
    user_story_rating,
    user_soundtrack_graphics_rating,
    user_difficulty_comment,
    user_skill_comment,
    user_skill_comment_when_beat,
    user_review_comment,
    user_recommendation_comment,
    user_importance_comment,
    user_technical_quality_comment,
    user_gameplay_design_comment,
    user_originality_comment,
    user_visual_aesthetics_comment,
    user_story_comment,
    user_soundtrack_graphics_comment,
    user_notes
FROM user_game_version_annotations;

-- Step 3: Drop old table
DROP TABLE user_game_version_annotations;

-- Step 4: Rename new table to original name
ALTER TABLE user_game_version_annotations_new RENAME TO user_game_version_annotations;

-- =============================================================================
-- Recreate v_run_results_timing_compat view (if run_results table exists)
-- This view was dropped at the start to avoid SQLite validation errors
-- during table recreation operations
-- =============================================================================

-- Check if run_results table exists and has the required columns before recreating the view
-- This view definition matches migration 052_clientdata_win_rules_rename_columns.sql
CREATE VIEW IF NOT EXISTS v_run_results_timing_compat AS
SELECT 
    result_uuid,
    -- Milliseconds columns (primary)
    started_at_ms,
    completed_at_ms,
    pause_start_ms,
    pause_end_ms,
    pause_milliseconds,
    duration_milliseconds,
    -- Seconds columns (for backwards compatibility, rounded)
    CAST(COALESCE(started_at_ms, 0) / 1000 AS INTEGER) as started_at_seconds,
    CAST(COALESCE(completed_at_ms, 0) / 1000 AS INTEGER) as completed_at_seconds,
    CAST(COALESCE(pause_milliseconds, 0) / 1000 AS INTEGER) as pause_seconds_rounded,
    CAST(COALESCE(duration_milliseconds, 0) / 1000 AS INTEGER) as duration_seconds_rounded,
    -- Original columns (for backwards compatibility)
    started_at,
    completed_at,
    pause_start,
    pause_end,
    pause_seconds,
    duration_seconds
FROM run_results;

-- =============================================================================
-- Migration complete
-- =============================================================================

SELECT 'Migration 057 completed successfully.' as message;
SELECT 'Updated constraints: user_difficulty_rating now allows 0-10 range (instead of 0-5)' as changes;

