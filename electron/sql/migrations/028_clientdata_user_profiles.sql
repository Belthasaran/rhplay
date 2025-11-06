-- =============================================================================
-- User Profiles Table
-- Purpose: Store user profiles with JSON data, Nostr version, and edit tracking
-- Added: January 2025
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_profiles (
    profile_uuid VARCHAR(255) PRIMARY KEY,
    profile_json TEXT NOT NULL, -- Full profile JSON (encrypted private keys included)
    public_nostr_version TEXT, -- Public Nostr version (kind 0 event JSON)
    has_unpublished_edits INTEGER DEFAULT 0, -- 1 if user has edited public fields since last publish
    is_current_profile INTEGER DEFAULT 0, -- 1 if this is the current active profile
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_published_at TIMESTAMP -- When profile was last published to Nostr
);

CREATE INDEX idx_user_profiles_current ON user_profiles(is_current_profile);
CREATE INDEX idx_user_profiles_unpublished ON user_profiles(has_unpublished_edits);

CREATE TRIGGER trigger_user_profiles_updated 
AFTER UPDATE ON user_profiles
BEGIN
    UPDATE user_profiles 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE profile_uuid = NEW.profile_uuid;
END;

