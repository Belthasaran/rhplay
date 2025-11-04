-- =============================================================================
-- Add Name, Label, and Comments columns to admin_keypairs table
-- Purpose: Allow users to add custom names, labels, and comments to keypairs
-- Added: January 2025
-- =============================================================================

ALTER TABLE admin_keypairs ADD COLUMN name TEXT;
ALTER TABLE admin_keypairs ADD COLUMN label TEXT;
ALTER TABLE admin_keypairs ADD COLUMN comments TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_keypairs_name ON admin_keypairs(name);
CREATE INDEX IF NOT EXISTS idx_admin_keypairs_label ON admin_keypairs(label);

