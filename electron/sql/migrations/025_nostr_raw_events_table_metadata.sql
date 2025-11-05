-- =============================================================================
-- Nostr Raw Events Table Metadata Columns
-- Purpose: Add table_name, record_uuid, and user_profile_uuid columns to nostr_raw_events
--          for efficient tracking of published events and quick status updates
-- Added: February 2025
-- =============================================================================

-- Note: This migration is for existing Nostr databases (nostr_cache_in.db, nostr_cache_out.db, etc.)
-- These databases are created by NostrLocalDBManager, but this migration handles existing databases
-- that may have been created before the new columns were added.

-- Add metadata columns
ALTER TABLE nostr_raw_events ADD COLUMN table_name TEXT;
ALTER TABLE nostr_raw_events ADD COLUMN record_uuid TEXT;
ALTER TABLE nostr_raw_events ADD COLUMN user_profile_uuid TEXT;

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_table_name ON nostr_raw_events(table_name);
CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_record_uuid ON nostr_raw_events(record_uuid);
CREATE INDEX IF NOT EXISTS idx_nostr_raw_events_user_profile_uuid ON nostr_raw_events(user_profile_uuid);

