-- =============================================================================
-- Nostr Relays Table
-- Purpose: Store relay definitions with categories, health stats, and flags
-- Added: November 2025
-- =============================================================================

CREATE TABLE IF NOT EXISTS nostr_relays (
    relay_url TEXT PRIMARY KEY,
    label TEXT,
    categories TEXT DEFAULT '[]', -- JSON array of category tags
    priority INTEGER DEFAULT 0,
    auth_required INTEGER DEFAULT 0,
    read INTEGER DEFAULT 1,
    write INTEGER DEFAULT 1,
    added_by TEXT DEFAULT 'system', -- system, user, admin-published
    health_score REAL DEFAULT 0,
    last_success INTEGER,
    last_failure INTEGER,
    consecutive_failures INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_nostr_relays_priority ON nostr_relays(priority DESC);
CREATE INDEX IF NOT EXISTS idx_nostr_relays_added_by ON nostr_relays(added_by);

CREATE TRIGGER IF NOT EXISTS trg_nostr_relays_updated
AFTER UPDATE ON nostr_relays
BEGIN
    UPDATE nostr_relays
    SET updated_at = CURRENT_TIMESTAMP
    WHERE relay_url = NEW.relay_url;
END;

