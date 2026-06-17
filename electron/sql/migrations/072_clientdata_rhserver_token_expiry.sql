-- Migration 072: RHServer token expiry columns and per-profile scoping
-- Date: 2026-06-16

ALTER TABLE rhserver_tokens ADD COLUMN access_expires_at INTEGER;
ALTER TABLE rhserver_tokens ADD COLUMN refresh_expires_at INTEGER;
ALTER TABLE rhserver_tokens ADD COLUMN obtainment_timestamp INTEGER;
ALTER TABLE rhserver_tokens ADD COLUMN expires_in INTEGER;
ALTER TABLE rhserver_tokens ADD COLUMN encryption_method TEXT DEFAULT 'keyguard';

UPDATE rhserver_tokens
SET access_expires_at = expires_at,
    obtainment_timestamp = COALESCE(connected_at, strftime('%s', 'now')),
    encryption_method = 'vault'
WHERE access_expires_at IS NULL AND expires_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rhserver_tokens_profile_api_active
  ON rhserver_tokens(profile_uuid, api_base_url)
  WHERE is_active = 1;
