-- =============================================================================
-- Migration 031: Add target_keypair_public_hex to admindeclarations
-- Purpose: Store the explicit hex-encoded public key for declaration subjects
-- Added: November 2025
-- =============================================================================

ALTER TABLE admindeclarations
  ADD COLUMN target_keypair_public_hex VARCHAR(128);

-- Backfill hex column where the fingerprint already contains a 64-character hex string
UPDATE admindeclarations
SET target_keypair_public_hex = lower(target_keypair_fingerprint)
WHERE target_keypair_public_hex IS NULL
  AND target_keypair_fingerprint IS NOT NULL
  AND length(target_keypair_fingerprint) = 64
  AND target_keypair_fingerprint GLOB '[0-9A-Fa-f]*';

