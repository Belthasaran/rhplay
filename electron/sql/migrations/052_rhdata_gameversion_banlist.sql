-- Migration: 052_rhdata_gameversion_banlist
-- Description: Create gameversion_banlist table for dynamic game bans
-- Date: 2025-01-XX

CREATE TABLE IF NOT EXISTS gameversion_banlist (
  banuuid TEXT PRIMARY KEY,
  gameid TEXT,
  match_column TEXT NOT NULL CHECK(match_column IN ('gameid', 'gvuuid', 'author', 'tags', 'url', 'name')),
  match_pattern TEXT NOT NULL,
  sense TEXT NOT NULL,
  required_acknowledgments TEXT,
  starting_at TEXT,
  reason TEXT,
  warningtext TEXT,
  sequence_no INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_gameversion_banlist_gameid ON gameversion_banlist(gameid);
CREATE INDEX IF NOT EXISTS idx_gameversion_banlist_match_column ON gameversion_banlist(match_column);
CREATE INDEX IF NOT EXISTS idx_gameversion_banlist_active ON gameversion_banlist(active);
CREATE INDEX IF NOT EXISTS idx_gameversion_banlist_sequence ON gameversion_banlist(sequence_no);
CREATE INDEX IF NOT EXISTS idx_gameversion_banlist_starting_at ON gameversion_banlist(starting_at);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS trg_gameversion_banlist_updated
  AFTER UPDATE ON gameversion_banlist
BEGIN
  UPDATE gameversion_banlist
  SET updated_at = CURRENT_TIMESTAMP
  WHERE banuuid = NEW.banuuid;
END;

