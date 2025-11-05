-- =============================================================================
-- Admin Declarations Table Nostr Event Fields
-- Purpose: Add individual fields for Nostr event serialization format
-- Added: February 2025
-- =============================================================================

-- Add Nostr event serialization fields
ALTER TABLE admindeclarations ADD COLUMN nostr_public_key VARCHAR(64); -- Public key as hex string
ALTER TABLE admindeclarations ADD COLUMN nostr_created_at INTEGER; -- Unix timestamp as number
ALTER TABLE admindeclarations ADD COLUMN nostr_content TEXT; -- Content as string (Format 2 signed data JSON)

-- Update existing records: Extract values from nostr_event JSON if present
-- Note: This will be NULL for existing records, but will be populated for new Nostr-signed declarations

-- Create index for Nostr public key queries
CREATE INDEX IF NOT EXISTS idx_admindeclarations_nostr_public_key ON admindeclarations(nostr_public_key);
CREATE INDEX IF NOT EXISTS idx_admindeclarations_nostr_created_at ON admindeclarations(nostr_created_at);

