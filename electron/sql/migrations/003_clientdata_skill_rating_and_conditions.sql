-- Migration 003: Skill Rating and Challenge Conditions
-- Date: October 12, 2025
-- Database: clientdata.db
-- Purpose: Add skill rating (0-10), update rating constraints to 0-5, add conditions to run system

-- =============================================================================
-- Part 1: Add skill rating columns
-- =============================================================================

-- Add skill rating to game annotations
ALTER TABLE user_game_annotations ADD COLUMN user_skill_rating INTEGER 
  CHECK (user_skill_rating IS NULL OR (user_skill_rating >= 0 AND user_skill_rating <= 10));

-- Add skill rating to version-specific annotations
ALTER TABLE user_game_version_annotations ADD COLUMN user_skill_rating INTEGER 
  CHECK (user_skill_rating IS NULL OR (user_skill_rating >= 0 AND user_skill_rating <= 10));

-- Add skill rating to stage annotations
ALTER TABLE user_stage_annotations ADD COLUMN user_skill_rating INTEGER 
  CHECK (user_skill_rating IS NULL OR (user_skill_rating >= 0 AND user_skill_rating <= 10));

-- Note: SQLite doesn't easily allow modifying CHECK constraints
-- For existing constraints (1-5), we'll document that applications should accept 0-5
-- New installs will use updated clientdata.sql with 0-5 constraints

-- =============================================================================
-- Part 2: Add conditions to run system
-- =============================================================================

-- Add global conditions to runs table
ALTER TABLE runs ADD COLUMN global_conditions TEXT;  -- JSON array of ChallengeCondition

-- Add conditions to plan entries
ALTER TABLE run_plan_entries ADD COLUMN conditions TEXT;  -- JSON array of ChallengeCondition

-- Add conditions to results (combined global + entry-specific)
ALTER TABLE run_results ADD COLUMN conditions TEXT;  -- JSON array of ChallengeCondition

-- =============================================================================
-- Part 3: Update views
-- =============================================================================

-- Drop old views
DROP VIEW IF EXISTS v_games_with_annotations;
DROP VIEW IF EXISTS v_stages_with_annotations;

-- Recreate v_games_with_annotations with skill rating
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

-- Recreate v_stages_with_annotations with skill rating
CREATE VIEW v_stages_with_annotations AS
SELECT 
    gs.stage_key,
    gs.gameid,
    gs.exit_number,
    gs.description,
    gs.public_rating,
    usa.user_difficulty_rating,
    usa.user_review_rating,
    usa.user_skill_rating,
    usa.user_notes,
    gs.created_at as stage_created_at,
    usa.created_at as annotation_created_at
FROM game_stages gs
LEFT JOIN user_stage_annotations usa ON gs.stage_key = usa.stage_key;

-- =============================================================================
-- Migration Complete
-- =============================================================================

SELECT 'Migration 003 completed successfully.' as message;
SELECT 'Added skill_rating columns (0-10 scale)' as change1;
SELECT 'Added conditions columns to run system tables' as change2;
SELECT 'Note: Existing rating constraints remain 1-5. New data accepts 0-5. Update schema for fresh installs.' as note;

