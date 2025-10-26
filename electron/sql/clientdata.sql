CREATE TABLE csettings (
	 csettinguid varchar(255),
	 csetting_name varchar(255),
	 csetting_value text NOT NULL,
	 csetting_binary blob,
	primary  key(csettinguid)
	unique(csetting_name)
);

-- API Servers table for storing metadata API server credentials
-- Credentials are encrypted using AES-256-CBC with RHTCLIENT_VAULT_KEY
-- TODO: Move encryption key storage to OS-specific secure keychain
--       (e.g., Windows Credential Manager, macOS Keychain, Linux Secret Service)
CREATE TABLE apiservers (
	apiserveruuid VARCHAR(255) PRIMARY KEY,
	server_name VARCHAR(255),
	api_url TEXT NOT NULL,
	encrypted_clientid TEXT,
	encrypted_clientsecret TEXT,
	is_active INTEGER DEFAULT 1,
	last_used TIMESTAMP,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	notes TEXT
);

-- =============================================================================
-- User Game Annotations
-- Purpose: Store user-specific data for games (ratings, status, notes, hidden)
-- Added: October 12, 2025
-- =============================================================================
CREATE TABLE user_game_annotations (
    gameid VARCHAR(255) PRIMARY KEY,
    status VARCHAR(50) DEFAULT 'Default',
    user_rating INTEGER CHECK (user_rating IS NULL OR (user_rating >= 0 AND user_rating <= 5)),
    user_difficulty_rating INTEGER CHECK (user_difficulty_rating IS NULL OR (user_difficulty_rating >= 0 AND user_difficulty_rating <= 5)),
    user_review_rating INTEGER CHECK (user_review_rating IS NULL OR (user_review_rating >= 0 AND user_review_rating <= 5)),
    user_skill_rating INTEGER CHECK (user_skill_rating IS NULL OR (user_skill_rating >= 0 AND user_skill_rating <= 10)),
    hidden INTEGER DEFAULT 0,
    exclude_from_random INTEGER DEFAULT 0,
    user_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_game_status ON user_game_annotations(status);
CREATE INDEX idx_user_game_hidden ON user_game_annotations(hidden);
CREATE INDEX idx_user_game_rating ON user_game_annotations(user_rating);

CREATE TRIGGER trigger_user_game_updated 
AFTER UPDATE ON user_game_annotations
BEGIN
    UPDATE user_game_annotations 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE gameid = NEW.gameid;
END;

-- =============================================================================
-- Game Stages
-- Purpose: Store stage/exit metadata for games
-- Note: Not all games have documented stages - this is optional
-- Added: October 12, 2025
-- =============================================================================
CREATE TABLE game_stages (
    stage_key VARCHAR(510) PRIMARY KEY,
    gameid VARCHAR(255) NOT NULL,
    exit_number VARCHAR(255) NOT NULL,
    description TEXT,
    public_rating DECIMAL(3,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(gameid, exit_number)
);

CREATE INDEX idx_game_stages_gameid ON game_stages(gameid);
CREATE INDEX idx_game_stages_exit ON game_stages(exit_number);

CREATE TRIGGER trigger_game_stages_updated 
AFTER UPDATE ON game_stages
BEGIN
    UPDATE game_stages 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE stage_key = NEW.stage_key;
END;

-- =============================================================================
-- User Stage Annotations
-- Purpose: Store user-specific annotations for individual stages
-- Added: October 12, 2025
-- =============================================================================
CREATE TABLE user_stage_annotations (
    stage_key VARCHAR(510) PRIMARY KEY,
    gameid VARCHAR(255) NOT NULL,
    exit_number VARCHAR(255) NOT NULL,
    user_rating INTEGER CHECK (user_rating IS NULL OR (user_rating >= 0 AND user_rating <= 5)),
    user_difficulty_rating INTEGER CHECK (user_difficulty_rating IS NULL OR (user_difficulty_rating >= 0 AND user_difficulty_rating <= 5)),
    user_review_rating INTEGER CHECK (user_review_rating IS NULL OR (user_review_rating >= 0 AND user_review_rating <= 5)),
    user_skill_rating INTEGER CHECK (user_skill_rating IS NULL OR (user_skill_rating >= 0 AND user_skill_rating <= 10)),
    user_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(gameid, exit_number)
);

CREATE INDEX idx_user_stage_gameid ON user_stage_annotations(gameid);
CREATE INDEX idx_user_stage_rating ON user_stage_annotations(user_rating);

CREATE TRIGGER trigger_user_stage_updated 
AFTER UPDATE ON user_stage_annotations
BEGIN
    UPDATE user_stage_annotations 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE stage_key = NEW.stage_key;
END;

-- =============================================================================
-- Convenience Views
-- =============================================================================

CREATE VIEW v_games_with_annotations AS
SELECT 
    gameid,
    COALESCE(status, 'Default') as status,
    user_rating,
    COALESCE(hidden, 0) as hidden,
    user_notes,
    created_at,
    updated_at
FROM user_game_annotations;

CREATE VIEW v_stages_with_annotations AS
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
