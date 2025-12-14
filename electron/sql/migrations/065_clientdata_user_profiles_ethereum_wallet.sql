-- =============================================================================
-- Migration: Add encrypted Ethereum private key column to user_profiles
-- Date: 2025-01-XX
-- Database: clientdata.db
-- Purpose: Add encrypted_ethereum_private_key column to store the encrypted
--          Ethereum wallet private key. This is PRIVATE data and must never
--          be included in profile_json (which is published to Nostr).
--          The Ethereum private key is encrypted using the Profile Guard key.
-- =============================================================================

-- Add encrypted_ethereum_private_key column to user_profiles table
-- This stores the encrypted Ethereum private key (encrypted with Profile Guard key)
-- Format: IV:HEX_ENCRYPTED_KEY (same format as encrypted_master_seed)
ALTER TABLE user_profiles ADD COLUMN encrypted_ethereum_private_key TEXT;

-- Add ethereum_address column for the public Ethereum address
-- This is PUBLIC data, but stored in database column for internal use
-- Can optionally be included in profile_json for Nostr publishing if desired
ALTER TABLE user_profiles ADD COLUMN ethereum_address TEXT;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_ethereum_address 
  ON user_profiles(ethereum_address) 
  WHERE ethereum_address IS NOT NULL;

SELECT 'Migration 065 completed successfully. Added encrypted_ethereum_private_key and ethereum_address columns to user_profiles.' as message;

