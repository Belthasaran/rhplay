-- Migration 053: Twitch Integration Support
-- Date: 2025-01-XX
-- Purpose: Add Twitch integration table for storing encrypted OAuth tokens and predictions configuration
-- Database: clientdata.db

-- =============================================================================
-- Part 1: Twitch Integration Table
-- =============================================================================

-- Table to store Twitch OAuth tokens for user profiles
-- Tokens are encrypted using the user's profile guard key
CREATE TABLE IF NOT EXISTS twitch_integration (
    integration_uuid VARCHAR(255) PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    
    -- Profile association
    profile_uuid VARCHAR(255) NOT NULL, -- Foreign key to user_profiles
    
    -- Twitch user information
    twitch_user_id VARCHAR(255), -- Twitch user ID (from token validation)
    twitch_username VARCHAR(255), -- Twitch username (from token validation)
    
    -- Encrypted OAuth tokens (encrypted with profile guard key)
    encrypted_access_token TEXT NOT NULL, -- Encrypted access token (IV:CIPHERTEXT format)
    encrypted_refresh_token TEXT NOT NULL, -- Encrypted refresh token (IV:CIPHERTEXT format)
    
    -- Token metadata
    expires_in INTEGER DEFAULT 0, -- Token expiration time in seconds (0 forces refresh on next use)
    obtainment_timestamp INTEGER DEFAULT 0, -- Timestamp when token was obtained (milliseconds)
    
    -- OAuth scopes (space-delimited list)
    scopes TEXT NOT NULL, -- Space-delimited list of granted scopes (e.g., "channel:read:predictions channel:manage:predictions")
    
    -- Status
    is_active INTEGER DEFAULT 1, -- 1 if integration is active, 0 if disabled
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP, -- Last time tokens were used
    
    FOREIGN KEY (profile_uuid) REFERENCES user_profiles(profile_uuid) ON DELETE CASCADE,
    UNIQUE(profile_uuid) -- One integration per profile
);

CREATE INDEX idx_twitch_integration_profile ON twitch_integration(profile_uuid);
CREATE INDEX idx_twitch_integration_active ON twitch_integration(is_active);
CREATE INDEX idx_twitch_integration_user_id ON twitch_integration(twitch_user_id);

CREATE TRIGGER trigger_twitch_integration_updated 
AFTER UPDATE ON twitch_integration
BEGIN
    UPDATE twitch_integration 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE integration_uuid = NEW.integration_uuid;
END;

-- =============================================================================
-- Part 2: Predictions Template Configuration
-- =============================================================================

-- Predictions template settings will be stored in csettings table
-- The following csetting keys will be used:
-- - predictionsEnabled: "On" or "Off" (default: "Off")
-- - predictionsType: "whole_challenge" or "individual_item" (default: null)
-- - predictionsTemplate: JSON blob with template configuration
--
-- predictionsTemplate structure:
-- {
--   "type": "whole_challenge" | "individual_item",
--   "wholeChallenge": {
--     "outcomeCount": 5, // 3-10
--     "predictionWindowMinutes": 10
--   },
--   "individualItem": {
--     "predictionType": "yes_no" | "time_range",
--     "timeRange": {
--       "outcomeCount": 5, // 3-7, configurable
--       "maxTimeMinutes": 60 // or calculated from win rules
--     }
--   }
-- }

-- Note: These will be managed via the csettings table, no migration needed here
-- The UI will create/update these settings as needed

