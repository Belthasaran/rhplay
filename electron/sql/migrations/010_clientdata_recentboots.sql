-- Migration 010: Create recentboots table
-- Date: 2025-01-XX
-- Description: Creates recentboots table to track recently uploaded files to USB2SNES

CREATE TABLE IF NOT EXISTS recentboots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  fullpath TEXT NOT NULL,
  
  -- Game metadata
  gameid TEXT,
  gamename TEXT,
  levelnumber TEXT,
  levelname TEXT,
  
  -- Timestamps
  uploaded_at INTEGER DEFAULT (strftime('%s', 'now')),
  booted_at INTEGER,
  
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_recentboots_uploaded_at ON recentboots(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_recentboots_gameid ON recentboots(gameid);
CREATE INDEX IF NOT EXISTS idx_recentboots_levelnumber ON recentboots(levelnumber);
CREATE INDEX IF NOT EXISTS idx_recentboots_fullpath ON recentboots(fullpath);

-- Trigger to update updated_at on changes
CREATE TRIGGER IF NOT EXISTS trg_recentboots_updated
  AFTER UPDATE ON recentboots
  FOR EACH ROW
BEGIN
  UPDATE recentboots SET updated_at = strftime('%s', 'now') WHERE id = NEW.id;
END;

