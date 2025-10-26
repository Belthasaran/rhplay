-- Migration 001: User Game and Stage Annotations
-- Date: October 12, 2025
-- Database: clientdata.db
-- Purpose: Add tables for user-specific game annotations, stage annotations, and stage metadata

-- =============================================================================
-- Table: user_game_annotations
-- Purpose: Store user-specific annotations for games (ratings, status, notes)
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_game_annotations (
    -- Primary key - references gameid from rhdata.db gameversions table
    gameid VARCHAR(255) PRIMARY KEY,
    
    -- User status (tracks user's progress)
    status VARCHAR(50) DEFAULT 'Default',  -- 'Default', 'In Progress', 'Finished'
    
    -- User's personal difficulty rating (1-5 scale, NULL if not rated)
    user_rating INTEGER CHECK (user_rating IS NULL OR (user_rating >= 1 AND user_rating <= 5)),
    
    -- Hidden flag (for hiding games from main list)
    hidden INTEGER DEFAULT 0,  -- 0 = visible, 1 = hidden
    
    -- User's personal notes about the game
    user_notes TEXT,
    
    -- Timestamps for tracking changes
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_game_status ON user_game_annotations(status);
CREATE INDEX IF NOT EXISTS idx_user_game_hidden ON user_game_annotations(hidden);
CREATE INDEX IF NOT EXISTS idx_user_game_rating ON user_game_annotations(user_rating);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS trigger_user_game_updated 
AFTER UPDATE ON user_game_annotations
BEGIN
    UPDATE user_game_annotations 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE gameid = NEW.gameid;
END;

-- =============================================================================
-- Table: game_stages
-- Purpose: Store stage/exit information for games
-- Note: Not all games have documented stages - this is optional metadata
-- =============================================================================
CREATE TABLE IF NOT EXISTS game_stages (
    -- Composite primary key: gameid + exit_number
    stage_key VARCHAR(510) PRIMARY KEY,  -- Format: "gameid-exitnumber"
    
    -- References the game
    gameid VARCHAR(255) NOT NULL,
    
    -- Stage identification
    exit_number VARCHAR(255) NOT NULL,  -- Exit number (e.g., "0x01", "1", "105")
    
    -- Stage description
    description TEXT,
    
    -- Public/community rating for this stage (if available)
    public_rating DECIMAL(3,2),  -- e.g., 3.75 for average community rating
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure unique combination of gameid and exit_number
    UNIQUE(gameid, exit_number)
);

CREATE INDEX IF NOT EXISTS idx_game_stages_gameid ON game_stages(gameid);
CREATE INDEX IF NOT EXISTS idx_game_stages_exit ON game_stages(exit_number);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS trigger_game_stages_updated 
AFTER UPDATE ON game_stages
BEGIN
    UPDATE game_stages 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE stage_key = NEW.stage_key;
END;

-- =============================================================================
-- Table: user_stage_annotations
-- Purpose: Store user-specific annotations for individual stages within games
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_stage_annotations (
    -- Primary key - composite of gameid and exit_number
    stage_key VARCHAR(510) PRIMARY KEY,  -- Format: "gameid-exitnumber"
    
    -- References the game
    gameid VARCHAR(255) NOT NULL,
    
    -- References the specific stage/exit
    exit_number VARCHAR(255) NOT NULL,
    
    -- User's personal difficulty rating for this specific stage (1-5 scale)
    user_rating INTEGER CHECK (user_rating IS NULL OR (user_rating >= 1 AND user_rating <= 5)),
    
    -- User's personal notes about this stage
    user_notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure unique combination
    UNIQUE(gameid, exit_number)
);

CREATE INDEX IF NOT EXISTS idx_user_stage_gameid ON user_stage_annotations(gameid);
CREATE INDEX IF NOT EXISTS idx_user_stage_rating ON user_stage_annotations(user_rating);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS trigger_user_stage_updated 
AFTER UPDATE ON user_stage_annotations
BEGIN
    UPDATE user_stage_annotations 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE stage_key = NEW.stage_key;
END;

-- =============================================================================
-- Views for convenient data access
-- =============================================================================

-- View: Combined game data with user annotations
CREATE VIEW IF NOT EXISTS v_games_with_annotations AS
SELECT 
    gameid,
    COALESCE(status, 'Default') as status,
    user_rating,
    COALESCE(hidden, 0) as hidden,
    user_notes,
    created_at,
    updated_at
FROM user_game_annotations;

-- View: Combined stage data with user annotations
CREATE VIEW IF NOT EXISTS v_stages_with_annotations AS
SELECT 
    gs.stage_key,
    gs.gameid,
    gs.exit_number,
    gs.description,
    gs.public_rating,
    usa.user_rating,
    usa.user_notes,
    gs.created_at as stage_created_at,
    usa.created_at as annotation_created_at
FROM game_stages gs
LEFT JOIN user_stage_annotations usa ON gs.stage_key = usa.stage_key;

-- =============================================================================
-- Migration Complete
-- =============================================================================

-- Verify tables were created
SELECT 'Migration 001 completed successfully. Tables created:' as message;
SELECT name FROM sqlite_master WHERE type='table' AND name IN (
    'user_game_annotations',
    'game_stages', 
    'user_stage_annotations'
);

