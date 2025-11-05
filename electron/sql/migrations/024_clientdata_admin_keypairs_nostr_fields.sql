-- =============================================================================
-- Admin Keypairs Table Nostr Fields
-- Purpose: Add Nostr event ID and status for publishing admin keypairs to Nostr
-- Added: February 2025
-- =============================================================================

-- Add Nostr event ID column (stores the Nostr event ID when published)
ALTER TABLE admin_keypairs ADD COLUMN nostr_event_id VARCHAR(64);

-- Add Nostr status column (pending, published, failed, retrying)
ALTER TABLE admin_keypairs ADD COLUMN nostr_status VARCHAR(50) DEFAULT 'pending';

-- Create indexes for Nostr fields
CREATE INDEX IF NOT EXISTS idx_admin_keypairs_nostr_event_id ON admin_keypairs(nostr_event_id);
CREATE INDEX IF NOT EXISTS idx_admin_keypairs_nostr_status ON admin_keypairs(nostr_status);

