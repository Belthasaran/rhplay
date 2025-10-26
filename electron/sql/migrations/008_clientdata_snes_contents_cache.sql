-- Migration 008: SNES Contents Cache
-- Tracks files on SNES device for quick launch access

CREATE TABLE IF NOT EXISTS snes_contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  fullpath TEXT NOT NULL UNIQUE,
  
  -- Game metadata (if known)
  gameid TEXT,
  version INTEGER,
  gamename TEXT,
  gametype TEXT,
  difficulty TEXT,
  combinedtype TEXT,
  
  -- Status flags
  part_of_a_run INTEGER DEFAULT 0,
  launched_yet INTEGER DEFAULT 0,
  dismissed INTEGER DEFAULT 0,
  pinned INTEGER DEFAULT 0,
  finished INTEGER DEFAULT 0,
  
  -- Timestamps
  upload_timestamp INTEGER,  -- Unix timestamp when uploaded
  detected_timestamp INTEGER DEFAULT (strftime('%s', 'now')),  -- When first detected
  last_seen_timestamp INTEGER DEFAULT (strftime('%s', 'now')),  -- Last time file was seen on device
  
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Index for fast queries
CREATE INDEX IF NOT EXISTS idx_snes_contents_upload_timestamp ON snes_contents(upload_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_snes_contents_pinned_dismissed ON snes_contents(pinned DESC, dismissed ASC, upload_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_snes_contents_gameid ON snes_contents(gameid);
CREATE INDEX IF NOT EXISTS idx_snes_contents_fullpath ON snes_contents(fullpath);

