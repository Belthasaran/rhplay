-- =============================================================================
-- Migration: Add did_pkh column to user_profiles
-- Date: 2025-01-XX
-- Database: clientdata.db
-- Purpose: Add did_pkh column to store the Ceramic-compatible did:pkh identifier
--          derived from the Ethereum wallet address (which is derived from the
--          master seed). Format: did:pkh:eip155:1:<EthereumAddress>
-- =============================================================================

-- Add did_pkh column to user_profiles table
-- This stores the Ceramic-compatible DID identifier derived from Ethereum wallet
ALTER TABLE user_profiles ADD COLUMN did_pkh TEXT;

-- Add index for did_pkh lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_did_pkh 
  ON user_profiles(did_pkh) 
  WHERE did_pkh IS NOT NULL;

SELECT 'Migration 064 completed successfully. Added did_pkh column to user_profiles.' as message;

