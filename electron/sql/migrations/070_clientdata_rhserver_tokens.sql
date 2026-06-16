-- Migration 070: RHServer bearer token storage
-- Date: 2026-06-15

CREATE TABLE IF NOT EXISTS rhserver_tokens (
  token_uuid TEXT PRIMARY KEY,
  api_base_url TEXT NOT NULL,
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT,
  profile_uuid TEXT,
  expires_at INTEGER,
  connected_at INTEGER DEFAULT (strftime('%s', 'now')),
  is_active INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_rhserver_tokens_active ON rhserver_tokens(is_active);
