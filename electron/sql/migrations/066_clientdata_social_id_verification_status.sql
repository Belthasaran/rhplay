-- =============================================================================
-- Migration: Add Social ID Verification Status Tracking
-- Date: 2025-01-XX
-- Database: clientdata.db
-- Purpose: Add columns to track verification status for user profiles and
--          create tables for tracking other users' verification status.
-- =============================================================================

-- Add account-level verification status to user_profiles
ALTER TABLE user_profiles ADD COLUMN account_verification_level INTEGER DEFAULT 0;
-- 0 = Unverified (default)
-- 1 = Verified Unconfirmed (client verified, network not confirmed)
-- 2 = Confirmed (network confirmed)
-- 3 = Accepted (network accepted with higher privileges)
-- -1 = Rejected (network rejected)

-- Add flag to track if network confirmation is pending
ALTER TABLE user_profiles ADD COLUMN verification_confirmation_pending INTEGER DEFAULT 0;
-- 1 = Yes, waiting for network confirmation
-- 0 = No

-- Add timestamp for when verification was last checked/updated
ALTER TABLE user_profiles ADD COLUMN verification_last_checked TIMESTAMP;
ALTER TABLE user_profiles ADD COLUMN verification_last_confirmed TIMESTAMP;

-- Create table to track other users' profiles and their verification status
CREATE TABLE IF NOT EXISTS nostr_profile_verification_status (
    profile_pubkey TEXT PRIMARY KEY, -- Nostr public key (hex or npub)
    account_verification_level INTEGER DEFAULT 0,
    verification_confirmation_pending INTEGER DEFAULT 0,
    verification_last_checked TIMESTAMP,
    verification_last_confirmed TIMESTAMP,
    verified_by_pubkey TEXT, -- Pubkey of admin/oracle that verified
    verification_signature TEXT, -- Signature of verification message
    verification_event_id TEXT, -- Nostr event ID of verification message
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nostr_profile_verification_level 
  ON nostr_profile_verification_status(account_verification_level);
CREATE INDEX IF NOT EXISTS idx_nostr_profile_verification_pending 
  ON nostr_profile_verification_status(verification_confirmation_pending);
CREATE INDEX IF NOT EXISTS idx_nostr_profile_verification_verified_by 
  ON nostr_profile_verification_status(verified_by_pubkey);

-- Create table to track other users' social ID verification status
CREATE TABLE IF NOT EXISTS nostr_social_id_verification_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_pubkey TEXT NOT NULL, -- Nostr public key of the profile owner
    social_id_type TEXT NOT NULL, -- e.g., 'twitch', 'youtube'
    social_id_value TEXT NOT NULL, -- The actual social ID value
    client_verification_status TEXT DEFAULT 'unverified', 
    -- 'unverified', 'verified_unconfirmed', 'confirmed', 'accepted', 'rejected'
    network_confirmation_status TEXT DEFAULT 'unconfirmed',
    -- 'unconfirmed', 'confirmed', 'accepted', 'rejected'
    verification_confirmation_pending INTEGER DEFAULT 0,
    verified_by_pubkey TEXT, -- Pubkey of admin/oracle that verified
    verification_signature TEXT, -- Signature of verification message
    verification_event_id TEXT, -- Nostr event ID of verification message
    verification_timestamp TIMESTAMP, -- When verification occurred
    last_checked TIMESTAMP, -- When we last checked this social ID
    last_confirmed TIMESTAMP, -- When network last confirmed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(profile_pubkey, social_id_type, social_id_value)
);

CREATE INDEX IF NOT EXISTS idx_nostr_social_id_profile 
  ON nostr_social_id_verification_status(profile_pubkey);
CREATE INDEX IF NOT EXISTS idx_nostr_social_id_type_value 
  ON nostr_social_id_verification_status(social_id_type, social_id_value);
CREATE INDEX IF NOT EXISTS idx_nostr_social_id_client_status 
  ON nostr_social_id_verification_status(client_verification_status);
CREATE INDEX IF NOT EXISTS idx_nostr_social_id_network_status 
  ON nostr_social_id_verification_status(network_confirmation_status);
CREATE INDEX IF NOT EXISTS idx_nostr_social_id_pending 
  ON nostr_social_id_verification_status(verification_confirmation_pending);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS trigger_nostr_profile_verification_updated
AFTER UPDATE ON nostr_profile_verification_status
BEGIN
    UPDATE nostr_profile_verification_status
    SET updated_at = CURRENT_TIMESTAMP
    WHERE profile_pubkey = NEW.profile_pubkey;
END;

CREATE TRIGGER IF NOT EXISTS trigger_nostr_social_id_verification_updated
AFTER UPDATE ON nostr_social_id_verification_status
BEGIN
    UPDATE nostr_social_id_verification_status
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

SELECT 'Migration 066 completed successfully.' as message;
SELECT 'Added verification status tracking columns and tables for user profiles and other users' as changes;

