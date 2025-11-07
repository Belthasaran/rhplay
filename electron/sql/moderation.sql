-- =============================================================================
-- Moderation Database Schema
-- Purpose: Store moderator/admin actions (blocks, freezes, warnings) and audit logs
-- Added: November 2025
-- =============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS moderation_actions (
    action_id TEXT PRIMARY KEY,
    action_type TEXT NOT NULL, -- block-user, freeze-channel, warn-user, etc.
    target_type TEXT NOT NULL, -- user, channel, forum, game
    target_identifier TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_identifier TEXT NOT NULL,
    content_json TEXT,
    reason TEXT,
    issued_by_pubkey TEXT NOT NULL,
    issued_by_trust_level INTEGER,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER,
    trust_level INTEGER,
    trust_tier TEXT,
    event_id TEXT,
    signature TEXT,
    status TEXT DEFAULT 'active', -- active, revoked, expired
    revoked_by_pubkey TEXT,
    revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_target ON moderation_actions(target_type, target_identifier);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_status ON moderation_actions(status);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_event_id ON moderation_actions(event_id);

CREATE TABLE IF NOT EXISTS moderation_logs (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_id TEXT,
    log_type TEXT NOT NULL, -- create, revoke, expire
    details_json TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_moderation_logs_action_id ON moderation_logs(action_id);
