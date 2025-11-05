-- =============================================================================
-- Admin Declarations Signing Fields
-- Purpose: Add fields for signed data storage and signing metadata
-- Added: February 2025
-- =============================================================================

-- Add signed data fields
ALTER TABLE admindeclarations ADD COLUMN signed_data TEXT; -- JSON text of signed data (Format 3)
ALTER TABLE admindeclarations ADD COLUMN signed_data_sha256 VARCHAR(64); -- SHA256 hash of signed_data (what countersigners sign)
ALTER TABLE admindeclarations ADD COLUMN signing_timestamp TIMESTAMP; -- When signing occurred
ALTER TABLE admindeclarations ADD COLUMN signing_keypair_canonical_name VARCHAR(255); -- Canonical name of signing keypair
ALTER TABLE admindeclarations ADD COLUMN target_keypair_canonical_name VARCHAR(255); -- Canonical name of target keypair

-- Create indexes for signing fields
CREATE INDEX IF NOT EXISTS idx_admindeclarations_signed_data_sha256 ON admindeclarations(signed_data_sha256);
CREATE INDEX IF NOT EXISTS idx_admindeclarations_signing_timestamp ON admindeclarations(signing_timestamp);
CREATE INDEX IF NOT EXISTS idx_admindeclarations_signing_keypair_canonical ON admindeclarations(signing_keypair_canonical_name);

