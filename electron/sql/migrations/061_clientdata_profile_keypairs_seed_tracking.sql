-- =============================================================================
-- Migration: Add seed-based tracking to profile_keypairs
-- Date: 2025-01-XX
-- Database: clientdata.db
-- Purpose: Add columns to track which keypairs are generated from the master
--          seed and their derivation paths. This allows identification of
--          non-portable keypairs (those not generated from seed).
-- =============================================================================

-- Add is_seed_based flag to indicate if keypair was generated from master seed
ALTER TABLE profile_keypairs ADD COLUMN is_seed_based INTEGER DEFAULT 0;

-- Add derivation_path to store BIP32/BIP44 derivation path (e.g., "m/44'/1237'/0'/0/0")
-- This allows deterministic regeneration of the same keypair from the seed
-- Format: BIP32 path string or custom path format
ALTER TABLE profile_keypairs ADD COLUMN derivation_path TEXT;

-- Add index for filtering seed-based keypairs
CREATE INDEX IF NOT EXISTS idx_profile_keypairs_seed_based 
  ON profile_keypairs(is_seed_based) 
  WHERE is_seed_based = 1;

-- Add index for derivation path lookups
CREATE INDEX IF NOT EXISTS idx_profile_keypairs_derivation_path 
  ON profile_keypairs(derivation_path) 
  WHERE derivation_path IS NOT NULL;

SELECT 'Migration 061 completed successfully. Added is_seed_based and derivation_path to profile_keypairs.' as message;

