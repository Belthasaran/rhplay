-- =============================================================================
-- Admin Declarations Table Updates
-- Purpose: Add fields for Nostr publishing, update tracking, and status management
-- Added: February 2025
-- =============================================================================

-- Add Status column for Draft/Finalized/Published states
ALTER TABLE admindeclarations ADD COLUMN status VARCHAR(50) DEFAULT 'Draft';
-- Status values: 'Draft', 'Finalized', 'Published', 'Revoked'

-- Add Schema Version tracking
ALTER TABLE admindeclarations ADD COLUMN schema_version VARCHAR(10) DEFAULT '1.0';
ALTER TABLE admindeclarations ADD COLUMN content_version INTEGER DEFAULT 1;

-- Add Nostr Publishing fields
ALTER TABLE admindeclarations ADD COLUMN nostr_event_id VARCHAR(64);
ALTER TABLE admindeclarations ADD COLUMN nostr_published_at TIMESTAMP;
ALTER TABLE admindeclarations ADD COLUMN nostr_published_to_relays TEXT; -- JSON array of relay URLs
ALTER TABLE admindeclarations ADD COLUMN nostr_publish_status VARCHAR(50) DEFAULT 'pending'; -- pending, published, failed, retrying
ALTER TABLE admindeclarations ADD COLUMN nostr_kind INTEGER DEFAULT 31106; -- Nostr event kind
ALTER TABLE admindeclarations ADD COLUMN nostr_tags TEXT; -- JSON array of Nostr tags

-- Add Countersignature support
ALTER TABLE admindeclarations ADD COLUMN required_countersignatures INTEGER DEFAULT 0;
ALTER TABLE admindeclarations ADD COLUMN current_countersignatures INTEGER DEFAULT 0;
ALTER TABLE admindeclarations ADD COLUMN countersignatures_json TEXT; -- JSON array of countersignatures

-- Add Network Discovery fields
ALTER TABLE admindeclarations ADD COLUMN discovered_from_relay TEXT;
ALTER TABLE admindeclarations ADD COLUMN discovered_at TIMESTAMP;
ALTER TABLE admindeclarations ADD COLUMN is_local BOOLEAN DEFAULT 1; -- 1=created locally, 0=discovered from network
ALTER TABLE admindeclarations ADD COLUMN verification_status VARCHAR(50) DEFAULT 'pending'; -- pending, verified, failed

-- Add Update Tracking fields
ALTER TABLE admindeclarations ADD COLUMN original_declaration_uuid VARCHAR(255); -- For updates/revokes that reference original
ALTER TABLE admindeclarations ADD COLUMN is_update BOOLEAN DEFAULT 0; -- 1=update/revoke, 0=original
ALTER TABLE admindeclarations ADD COLUMN update_chain_uuid VARCHAR(255); -- Links updates to same original declaration
ALTER TABLE admindeclarations ADD COLUMN update_history_json TEXT; -- JSON array of update/revoke declarations
ALTER TABLE admindeclarations ADD COLUMN is_revoked BOOLEAN DEFAULT 0;
ALTER TABLE admindeclarations ADD COLUMN revoked_at TIMESTAMP;
ALTER TABLE admindeclarations ADD COLUMN revoked_by_declaration_uuid VARCHAR(255);
ALTER TABLE admindeclarations ADD COLUMN retroactive_effect_enabled BOOLEAN DEFAULT 0;
ALTER TABLE admindeclarations ADD COLUMN retroactive_effective_from TIMESTAMP;

-- Create indexes for new fields
CREATE INDEX IF NOT EXISTS idx_admindeclarations_status ON admindeclarations(status);
CREATE INDEX IF NOT EXISTS idx_admindeclarations_nostr_event_id ON admindeclarations(nostr_event_id);
CREATE INDEX IF NOT EXISTS idx_admindeclarations_nostr_publish_status ON admindeclarations(nostr_publish_status);
CREATE INDEX IF NOT EXISTS idx_admindeclarations_discovered_at ON admindeclarations(discovered_at);
CREATE INDEX IF NOT EXISTS idx_admindeclarations_is_local ON admindeclarations(is_local);
CREATE INDEX IF NOT EXISTS idx_admindeclarations_verification_status ON admindeclarations(verification_status);
CREATE INDEX IF NOT EXISTS idx_admindeclarations_schema_version ON admindeclarations(schema_version);
CREATE INDEX IF NOT EXISTS idx_admindeclarations_original_declaration ON admindeclarations(original_declaration_uuid);
CREATE INDEX IF NOT EXISTS idx_admindeclarations_is_update ON admindeclarations(is_update);
CREATE INDEX IF NOT EXISTS idx_admindeclarations_update_chain ON admindeclarations(update_chain_uuid);
CREATE INDEX IF NOT EXISTS idx_admindeclarations_is_revoked ON admindeclarations(is_revoked);

