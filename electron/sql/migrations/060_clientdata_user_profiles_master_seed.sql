-- =============================================================================
-- Migration: Add encrypted master seed to user_profiles
-- Date: 2025-01-XX
-- Database: clientdata.db
-- Purpose: Add encrypted_master_seed column to store encrypted master seed
--          for profile keypair generation. The seed is encrypted using the
--          Profile Guard key (same encryption method as encrypted_private_key
--          in profile_keypairs table).
-- =============================================================================

-- Add encrypted_master_seed column to user_profiles table
-- This stores a 256-bit (32-byte) master seed encrypted with Profile Guard key
-- Format: IV:HEX_ENCRYPTED_SEED (same format as encrypted_private_key)
ALTER TABLE user_profiles ADD COLUMN encrypted_master_seed TEXT;

-- Add seed_generated_at timestamp to track when seed was first generated
ALTER TABLE user_profiles ADD COLUMN seed_generated_at TIMESTAMP;

-- Add index for queries checking seed existence
CREATE INDEX IF NOT EXISTS idx_user_profiles_has_seed 
  ON user_profiles(encrypted_master_seed) 
  WHERE encrypted_master_seed IS NOT NULL;

SELECT 'Migration 060 completed successfully. Added encrypted_master_seed and seed_generated_at to user_profiles.' as message;

