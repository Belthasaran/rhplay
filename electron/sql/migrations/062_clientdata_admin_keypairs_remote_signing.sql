-- =============================================================================
-- Migration: Add remote signing support to admin_keypairs
-- Date: 2025-01-XX
-- Database: clientdata.db
-- Purpose: Add columns to support remote signing for admin keypairs using
--          external hardware or mobile wallets. This allows admin keypairs
--          to represent public trusted identities where the private key is
--          stored in an external wallet rather than in the application.
-- =============================================================================

-- Add is_remote_signing flag to indicate if keypair uses remote signing
-- 0 = local (private key stored in app, encrypted with Profile Guard)
-- 1 = remote (private key stored in external wallet)
ALTER TABLE admin_keypairs ADD COLUMN is_remote_signing INTEGER DEFAULT 0;

-- Add remote_wallet_type to identify the type of remote wallet
-- Examples: 'hardware-ledger', 'hardware-trezor', 'mobile-nostr-wallet', 
--           'ceramic', 'web3-wallet', 'custom'
ALTER TABLE admin_keypairs ADD COLUMN remote_wallet_type TEXT;

-- Add remote_wallet_id to store wallet-specific identifier
-- For hardware wallets: device ID or derivation path
-- For software wallets: account identifier or wallet address
ALTER TABLE admin_keypairs ADD COLUMN remote_wallet_id TEXT;

-- Add remote_wallet_metadata JSON for additional wallet-specific configuration
-- Examples: connection parameters, API endpoints, authentication methods
ALTER TABLE admin_keypairs ADD COLUMN remote_wallet_metadata TEXT;

-- Add seed_export_ready flag to indicate if keypair can be exported to remote wallet
-- This is for seed-based keypairs that are ready to be moved to a dedicated wallet
ALTER TABLE admin_keypairs ADD COLUMN seed_export_ready INTEGER DEFAULT 0;

-- Add is_seed_based flag (similar to profile_keypairs) for seed-based admin keypairs
ALTER TABLE admin_keypairs ADD COLUMN is_seed_based INTEGER DEFAULT 0;

-- Add derivation_path for seed-based admin keypairs
ALTER TABLE admin_keypairs ADD COLUMN derivation_path TEXT;

-- Add master_seed_id to reference which admin seed was used for this keypair
-- References admin_seeds.seed_id - NULL if keypair is not seed-based or uses a different seed
ALTER TABLE admin_keypairs ADD COLUMN master_seed_id TEXT;

-- Add indexes for remote signing queries
CREATE INDEX IF NOT EXISTS idx_admin_keypairs_remote_signing 
  ON admin_keypairs(is_remote_signing) 
  WHERE is_remote_signing = 1;

CREATE INDEX IF NOT EXISTS idx_admin_keypairs_wallet_type 
  ON admin_keypairs(remote_wallet_type) 
  WHERE remote_wallet_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_keypairs_seed_based 
  ON admin_keypairs(is_seed_based) 
  WHERE is_seed_based = 1;

CREATE INDEX IF NOT EXISTS idx_admin_keypairs_derivation_path 
  ON admin_keypairs(derivation_path) 
  WHERE derivation_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_keypairs_master_seed_id 
  ON admin_keypairs(master_seed_id) 
  WHERE master_seed_id IS NOT NULL;

SELECT 'Migration 062 completed successfully. Added remote signing support columns to admin_keypairs.' as message;

