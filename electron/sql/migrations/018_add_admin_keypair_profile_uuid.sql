-- =============================================================================
-- Add profile_uuid column to admin_keypairs table
-- Purpose: Distinguish between global admin keypairs (NULL) and User Op keys (bound to profile)
-- Added: January 2025
-- =============================================================================

ALTER TABLE admin_keypairs ADD COLUMN profile_uuid TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_keypairs_profile_uuid ON admin_keypairs(profile_uuid);

