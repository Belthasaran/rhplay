-- Migration 054: Twitch Predictions Tracking
-- Date: 2025-01-XX
-- Purpose: Add table to track active Twitch predictions for lifecycle management
-- Database: clientdata.db

-- Table to track active Twitch predictions
-- Twitch only allows one active prediction per channel at a time
CREATE TABLE IF NOT EXISTS twitch_predictions (
    prediction_uuid VARCHAR(255) PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    
    -- Profile association
    profile_uuid VARCHAR(255) NOT NULL, -- Foreign key to user_profiles
    
    -- Twitch prediction information
    twitch_prediction_id VARCHAR(255) NOT NULL, -- Twitch API prediction ID
    twitch_broadcaster_id VARCHAR(255) NOT NULL, -- Twitch broadcaster user ID
    
    -- Prediction type and configuration
    prediction_type VARCHAR(50) NOT NULL, -- 'whole_challenge' or 'individual_item'
    prediction_subtype VARCHAR(50), -- 'yes_no', 'time_range', or null for whole_challenge
    template_config_json TEXT, -- JSON of the template configuration used
    
    -- Prediction details
    title TEXT NOT NULL, -- Prediction title
    outcomes_json TEXT NOT NULL, -- JSON array of outcome objects with id, title, color
    prediction_window_seconds INTEGER NOT NULL, -- Window duration in seconds
    
    -- Status tracking
    local_status VARCHAR(50) NOT NULL DEFAULT 'created', -- 'created', 'locked', 'resolved', 'cancelled', 'released'
    twitch_status VARCHAR(50), -- 'ACTIVE', 'LOCKED', 'RESOLVED', 'CANCELED' (from Twitch API)
    
    -- Lifecycle timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at_ms INTEGER NOT NULL, -- Milliseconds timestamp for precise timing
    locked_at TIMESTAMP,
    locked_at_ms INTEGER,
    resolved_at TIMESTAMP,
    resolved_at_ms INTEGER,
    cancelled_at TIMESTAMP,
    cancelled_at_ms INTEGER,
    
    -- Run association (optional - for whole challenge predictions)
    run_uuid VARCHAR(255), -- Foreign key to runs table (optional)
    
    -- Challenge association (for individual item predictions)
    challenge_sequence_number INTEGER, -- Sequence number of the challenge this prediction is for
    
    -- Resolution information
    winning_outcome_id VARCHAR(255), -- Twitch outcome ID that won
    resolution_method VARCHAR(50), -- 'automatic', 'manual', 'user_choice'
    
    -- Metadata
    notes TEXT, -- Additional notes or error messages
    
    FOREIGN KEY (profile_uuid) REFERENCES user_profiles(profile_uuid) ON DELETE CASCADE,
    FOREIGN KEY (run_uuid) REFERENCES runs(run_uuid) ON DELETE SET NULL,
    UNIQUE(twitch_prediction_id) -- One record per Twitch prediction ID
);

CREATE INDEX idx_twitch_predictions_profile ON twitch_predictions(profile_uuid);
CREATE INDEX idx_twitch_predictions_status ON twitch_predictions(local_status);
CREATE INDEX idx_twitch_predictions_twitch_status ON twitch_predictions(twitch_status);
CREATE INDEX idx_twitch_predictions_run ON twitch_predictions(run_uuid);
CREATE INDEX idx_twitch_predictions_active ON twitch_predictions(profile_uuid, local_status) WHERE local_status IN ('created', 'locked');

CREATE TRIGGER trigger_twitch_predictions_updated
AFTER UPDATE ON twitch_predictions
BEGIN
    UPDATE twitch_predictions
    SET updated_at = CURRENT_TIMESTAMP
    WHERE prediction_uuid = NEW.prediction_uuid;
END;

