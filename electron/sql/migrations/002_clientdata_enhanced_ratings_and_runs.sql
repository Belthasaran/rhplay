-- Migration 002: Enhanced Ratings and Run System
-- Date: October 12, 2025
-- Database: clientdata.db
-- Purpose: Add review ratings, version-specific ratings, exclude flags, and run system

-- =============================================================================
-- Part 1: Enhance user_game_annotations with review ratings and exclude flags
-- =============================================================================

-- Add review rating column (separate from difficulty rating)
ALTER TABLE user_game_annotations ADD COLUMN user_review_rating INTEGER 
  CHECK (user_review_rating IS NULL OR (user_review_rating >= 1 AND user_review_rating <= 5));

-- Add exclude from random flag
ALTER TABLE user_game_annotations ADD COLUMN exclude_from_random INTEGER DEFAULT 0;

-- Rename user_rating to user_difficulty_rating for clarity
-- Note: SQLite doesn't support RENAME COLUMN directly in older versions
-- We'll create a new column and copy data
ALTER TABLE user_game_annotations ADD COLUMN user_difficulty_rating INTEGER 
  CHECK (user_difficulty_rating IS NULL OR (user_difficulty_rating >= 1 AND user_difficulty_rating <= 5));

-- Copy existing user_rating to user_difficulty_rating
UPDATE user_game_annotations SET user_difficulty_rating = user_rating WHERE user_rating IS NOT NULL;

-- Note: We'll keep user_rating for backwards compatibility but document it as deprecated
-- Applications should use user_difficulty_rating going forward

-- Add index for new columns
CREATE INDEX IF NOT EXISTS idx_user_game_difficulty ON user_game_annotations(user_difficulty_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_review ON user_game_annotations(user_review_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_exclude ON user_game_annotations(exclude_from_random);

-- =============================================================================
-- Part 2: Version-specific game annotations
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_game_version_annotations (
    -- Composite primary key: gameid + version
    annotation_key VARCHAR(510) PRIMARY KEY,  -- Format: "gameid-version"
    
    -- References
    gameid VARCHAR(255) NOT NULL,
    version INTEGER NOT NULL,
    
    -- Version-specific ratings (override game-wide ratings for this version)
    user_difficulty_rating INTEGER CHECK (user_difficulty_rating IS NULL OR (user_difficulty_rating >= 1 AND user_difficulty_rating <= 5)),
    user_review_rating INTEGER CHECK (user_review_rating IS NULL OR (user_review_rating >= 1 AND user_review_rating <= 5)),
    
    -- Version-specific status (override game-wide status for this version)
    status VARCHAR(50),  -- 'Default', 'In Progress', 'Finished'
    
    -- Version-specific notes
    user_notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure unique combination
    UNIQUE(gameid, version)
);

CREATE INDEX IF NOT EXISTS idx_user_gv_gameid ON user_game_version_annotations(gameid);
CREATE INDEX IF NOT EXISTS idx_user_gv_version ON user_game_version_annotations(version);
CREATE INDEX IF NOT EXISTS idx_user_gv_status ON user_game_version_annotations(status);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS trigger_user_game_version_updated 
AFTER UPDATE ON user_game_version_annotations
BEGIN
    UPDATE user_game_version_annotations 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE annotation_key = NEW.annotation_key;
END;

-- =============================================================================
-- Part 3: Enhanced stage annotations with review ratings
-- =============================================================================

-- Add review rating to stage annotations
ALTER TABLE user_stage_annotations ADD COLUMN user_review_rating INTEGER 
  CHECK (user_review_rating IS NULL OR (user_review_rating >= 1 AND user_review_rating <= 5));

-- Rename user_rating to user_difficulty_rating for clarity
ALTER TABLE user_stage_annotations ADD COLUMN user_difficulty_rating INTEGER 
  CHECK (user_difficulty_rating IS NULL OR (user_difficulty_rating >= 1 AND user_difficulty_rating <= 5));

-- Copy existing user_rating to user_difficulty_rating
UPDATE user_stage_annotations SET user_difficulty_rating = user_rating WHERE user_rating IS NOT NULL;

-- Add index
CREATE INDEX IF NOT EXISTS idx_user_stage_difficulty ON user_stage_annotations(user_difficulty_rating);
CREATE INDEX IF NOT EXISTS idx_user_stage_review ON user_stage_annotations(user_review_rating);

-- =============================================================================
-- Part 4: Run System Schema
-- =============================================================================

-- Table: runs
-- Stores user's planned and executed game/stage runs
CREATE TABLE IF NOT EXISTS runs (
    run_uuid VARCHAR(255) PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    
    -- Run metadata
    run_name VARCHAR(255),
    run_description TEXT,
    
    -- Run status
    status VARCHAR(50) DEFAULT 'preparing',  -- 'preparing', 'active', 'completed', 'cancelled'
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP NULL,  -- When run was started
    completed_at TIMESTAMP NULL,  -- When run was completed
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Run statistics (calculated)
    total_challenges INTEGER DEFAULT 0,
    completed_challenges INTEGER DEFAULT 0,
    skipped_challenges INTEGER DEFAULT 0,
    
    -- Run configuration
    config_json TEXT  -- JSON blob for additional run configuration
);

CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);

-- Trigger to update updated_at
CREATE TRIGGER IF NOT EXISTS trigger_runs_updated 
AFTER UPDATE ON runs
BEGIN
    UPDATE runs 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE run_uuid = NEW.run_uuid;
END;

-- Table: run_plan_entries
-- Stores the planned challenges in a run (before execution)
CREATE TABLE IF NOT EXISTS run_plan_entries (
    entry_uuid VARCHAR(255) PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    
    -- Reference to parent run
    run_uuid VARCHAR(255) NOT NULL REFERENCES runs(run_uuid) ON DELETE CASCADE,
    
    -- Sequence order within run
    sequence_number INTEGER NOT NULL,
    
    -- Entry type
    entry_type VARCHAR(50) NOT NULL,  -- 'game', 'stage', 'random_game', 'random_stage'
    
    -- For specific game/stage entries
    gameid VARCHAR(255),  -- Specific game ID (if not random)
    exit_number VARCHAR(255),  -- Specific exit number (for stage entries)
    
    -- For random entries - filters
    count INTEGER DEFAULT 1,  -- Number of times to include this challenge
    filter_difficulty VARCHAR(255),  -- Filter by difficulty value
    filter_type VARCHAR(255),  -- Filter by type value
    filter_pattern VARCHAR(255),  -- Additional filter pattern
    filter_seed VARCHAR(255),  -- Random seed for reproducibility
    
    -- Entry metadata
    entry_notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(run_uuid, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_run_plan_run ON run_plan_entries(run_uuid);
CREATE INDEX IF NOT EXISTS idx_run_plan_sequence ON run_plan_entries(run_uuid, sequence_number);
CREATE INDEX IF NOT EXISTS idx_run_plan_type ON run_plan_entries(entry_type);

-- Table: run_results
-- Stores actual results of run execution (expanded from plan entries)
CREATE TABLE IF NOT EXISTS run_results (
    result_uuid VARCHAR(255) PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    
    -- References
    run_uuid VARCHAR(255) NOT NULL REFERENCES runs(run_uuid) ON DELETE CASCADE,
    plan_entry_uuid VARCHAR(255) REFERENCES run_plan_entries(entry_uuid),  -- Original plan entry
    
    -- Sequence in actual execution
    sequence_number INTEGER NOT NULL,
    
    -- What was actually attempted
    gameid VARCHAR(255) NOT NULL,  -- Resolved game ID
    game_name VARCHAR(255),  -- Game name (cached for display)
    exit_number VARCHAR(255),  -- Exit number if stage challenge
    stage_description VARCHAR(255),  -- Stage description (cached)
    
    -- Challenge metadata
    was_random BOOLEAN DEFAULT 0,  -- Was this a random selection?
    revealed_early BOOLEAN DEFAULT 0,  -- Was name revealed before attempt?
    
    -- Result status
    status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'success', 'ok', 'skipped', 'failed'
    
    -- Timestamps
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    duration_seconds INTEGER,  -- Time spent on this challenge
    
    -- Result notes
    result_notes TEXT,
    
    UNIQUE(run_uuid, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_run_results_run ON run_results(run_uuid);
CREATE INDEX IF NOT EXISTS idx_run_results_sequence ON run_results(run_uuid, sequence_number);
CREATE INDEX IF NOT EXISTS idx_run_results_status ON run_results(status);
CREATE INDEX IF NOT EXISTS idx_run_results_game ON run_results(gameid);

-- =============================================================================
-- Part 5: Run History and Archives
-- =============================================================================

-- Table: run_archive
-- Metadata about archived runs
CREATE TABLE IF NOT EXISTS run_archive (
    archive_uuid VARCHAR(255) PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    run_uuid VARCHAR(255) NOT NULL REFERENCES runs(run_uuid),
    
    -- Archive metadata
    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    archive_notes TEXT,
    
    -- Summary statistics (cached)
    total_time_seconds INTEGER,
    success_rate DECIMAL(5,2),  -- Percentage of successful completions
    
    UNIQUE(run_uuid)
);

CREATE INDEX IF NOT EXISTS idx_run_archive_date ON run_archive(archived_at);

-- =============================================================================
-- Part 6: Updated Views
-- =============================================================================

-- Drop old views
DROP VIEW IF EXISTS v_games_with_annotations;
DROP VIEW IF EXISTS v_stages_with_annotations;

-- Recreate v_games_with_annotations with new columns
CREATE VIEW v_games_with_annotations AS
SELECT 
    gameid,
    COALESCE(status, 'Default') as status,
    user_difficulty_rating,
    user_review_rating,
    COALESCE(hidden, 0) as hidden,
    COALESCE(exclude_from_random, 0) as exclude_from_random,
    user_notes,
    created_at,
    updated_at
FROM user_game_annotations;

-- Recreate v_stages_with_annotations with new columns
CREATE VIEW v_stages_with_annotations AS
SELECT 
    gs.stage_key,
    gs.gameid,
    gs.exit_number,
    gs.description,
    gs.public_rating,
    usa.user_difficulty_rating,
    usa.user_review_rating,
    usa.user_notes,
    gs.created_at as stage_created_at,
    usa.created_at as annotation_created_at
FROM game_stages gs
LEFT JOIN user_stage_annotations usa ON gs.stage_key = usa.stage_key;

-- View: Active run summary
CREATE VIEW IF NOT EXISTS v_active_run AS
SELECT 
    r.run_uuid,
    r.run_name,
    r.status,
    r.started_at,
    r.total_challenges,
    r.completed_challenges,
    r.skipped_challenges,
    (julianday('now') - julianday(r.started_at)) * 86400 as elapsed_seconds
FROM runs r
WHERE r.status = 'active'
LIMIT 1;

-- View: Current run progress
CREATE VIEW IF NOT EXISTS v_run_progress AS
SELECT 
    rr.run_uuid,
    rr.sequence_number,
    rr.gameid,
    rr.game_name,
    rr.exit_number,
    rr.stage_description,
    rr.status,
    rr.was_random,
    rr.revealed_early,
    rr.started_at,
    rr.completed_at,
    rr.duration_seconds
FROM run_results rr
ORDER BY rr.sequence_number;

-- =============================================================================
-- Migration Complete
-- =============================================================================

SELECT 'Migration 002 completed successfully.' as message;
SELECT 'New tables: user_game_version_annotations, runs, run_plan_entries, run_results, run_archive' as tables;
SELECT 'Enhanced columns: user_difficulty_rating, user_review_rating, exclude_from_random' as columns;

