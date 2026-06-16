-- Migration 071: Profile wizard hosting mode and SMWResource sync flags
-- Date: 2026-06-16

ALTER TABLE user_profiles ADD COLUMN profile_hosting_mode TEXT; -- smwresource | local | offline_explicit
ALTER TABLE user_profiles ADD COLUMN profile_wizard_complete INTEGER DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN smwresource_sync_pending INTEGER DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN smwresource_last_sync_at INTEGER;

