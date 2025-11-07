-- =============================================================================
-- Ratings Database Schema
-- Purpose: Store incoming Nostr rating events and aggregated summaries
-- Added: November 2025
-- =============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rating_events (
  rater_pubkey TEXT NOT NULL,
  gameid TEXT NOT NULL,
  gvuuid TEXT,
  version INTEGER,
  status TEXT,
  rating_json TEXT NOT NULL,
  user_notes TEXT,
  overall_rating REAL,
  difficulty_rating REAL,
  created_at_ts INTEGER,
  updated_at_ts INTEGER,
  published_at INTEGER,
  received_at INTEGER DEFAULT (strftime('%s','now')),
  trust_level INTEGER DEFAULT 1,
  trust_tier TEXT DEFAULT 'unverified',
  event_id TEXT NOT NULL,
  signature TEXT,
  tags_json TEXT,
  PRIMARY KEY (rater_pubkey, gameid)
);

CREATE INDEX IF NOT EXISTS idx_rating_events_gameid ON rating_events(gameid);
CREATE INDEX IF NOT EXISTS idx_rating_events_trust_tier ON rating_events(trust_tier);
CREATE INDEX IF NOT EXISTS idx_rating_events_event_id ON rating_events(event_id);

CREATE TABLE IF NOT EXISTS rating_summaries (
  gameid TEXT NOT NULL,
  rating_category TEXT NOT NULL,
  trust_tier TEXT NOT NULL,
  rating_count INTEGER DEFAULT 0,
  rating_average REAL,
  rating_median REAL,
  rating_stddev REAL,
  updated_at INTEGER DEFAULT (strftime('%s','now')),
  PRIMARY KEY (gameid, rating_category, trust_tier)
);

CREATE INDEX IF NOT EXISTS idx_rating_summaries_gameid ON rating_summaries(gameid);

CREATE TABLE IF NOT EXISTS trust_assignments (
  assignment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  pubkey TEXT NOT NULL,
  assigned_trust_level INTEGER NOT NULL,
  trust_limit INTEGER,
  assigned_by_pubkey TEXT,
  assigned_by_trust_level INTEGER,
  scope TEXT,
  source TEXT,
  reason TEXT,
  expires_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_trust_assignments_pubkey ON trust_assignments(pubkey);
CREATE INDEX IF NOT EXISTS idx_trust_assignments_assigned_by ON trust_assignments(assigned_by_pubkey);
