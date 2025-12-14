-- =============================================================================
-- Migration: Create admin_seeds table for storing encrypted admin master seeds
-- Date: 2025-01-XX
-- Database: clientdata.db
-- Purpose: Create a dedicated table to store encrypted master seeds for 
--          admin keypairs. This allows seed-based admin keypairs to reference
--          which master seed was used for their generation. Admin seeds are
--          encrypted using the Profile Guard key (same encryption method as
--          encrypted_private_key in admin_keypairs table).
-- =============================================================================

-- Create admin_seeds table to store encrypted master seeds for admin keypairs
CREATE TABLE IF NOT EXISTS admin_seeds (
    seed_id VARCHAR(255) PRIMARY KEY, -- UUID identifier for this seed
    seed_name TEXT, -- Human-readable name/description (e.g., "Primary Admin Seed", "Organization A Seed")
    encrypted_master_seed TEXT NOT NULL, -- Encrypted 256-bit (32-byte) master seed (encrypted with Profile Guard key)
    -- Format: IV:HEX_ENCRYPTED_SEED (same format as encrypted_private_key in admin_keypairs)
    seed_generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- When seed was first generated
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT -- Optional notes about the seed (usage, organization, etc.)
);

-- Add trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS trigger_admin_seeds_updated 
AFTER UPDATE ON admin_seeds
BEGIN
    UPDATE admin_seeds 
    SET updated_at = CURRENT_TIMESTAMP 
    WHERE seed_id = NEW.seed_id;
END;

-- Add index for seed lookups
CREATE INDEX IF NOT EXISTS idx_admin_seeds_name 
  ON admin_seeds(seed_name) 
  WHERE seed_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_seeds_created_at 
  ON admin_seeds(seed_generated_at);

SELECT 'Migration 063 completed successfully. Created admin_seeds table for storing encrypted admin master seeds.' as message;

