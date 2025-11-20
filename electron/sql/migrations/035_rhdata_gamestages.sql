-- Migration: 035_rhdata_gamestages
-- Description: Create gamestages table for storing verified "warpable" level id numbers for games
-- Date: 2025-01-XX

CREATE TABLE IF NOT EXISTS gamestages (
  stage_uuid TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  gameid TEXT NOT NULL, -- Links to gameversions by gameid
  
  -- Level identification
  levelnumber INTEGER, -- Lunar magic level number if it has one
  levelname TEXT NOT NULL,
  
  -- Version compatibility pattern
  -- "*" = all versions, comma-separated list of version numbers, ">N" for versions greater than N,
  -- "!N,*" for all versions except N
  versions TEXT DEFAULT '*',
  
  -- Level details
  submapid TEXT, -- Optional 1-byte hex
  translevel_13bf INTEGER, -- 13BF value: Translevel number
  
  -- Prerequisites
  requisites TEXT, -- Comma-separated list of prerequisite tags (e.g., "greenswitch")
  
  -- Flags
  playable INTEGER DEFAULT 1, -- Is this a good level to play assuming all pre-requisites can be patched?
  rando INTEGER DEFAULT 1, -- Is this a good level to include in randomizers?
  difficulty INTEGER DEFAULT 0 CHECK(difficulty >= 0 AND difficulty <= 10), -- Exit-specific difficulty (0-10, 8+ = impossible)
  
  -- Exit types
  mainexit INTEGER DEFAULT 1, -- Level has main exit
  keyhole INTEGER DEFAULT 0, -- Does this level have a keyhole exit
  credits INTEGER DEFAULT 0, -- Is this level credits
  
  -- Level types
  ghouse INTEGER DEFAULT 0, -- Is this level a ghost house level
  spalace INTEGER DEFAULT 0, -- Is this level a switch house level
  castle INTEGER DEFAULT 0, -- Is this level a castle
  boss INTEGER DEFAULT 0, -- Is this level a boss
  secret INTEGER DEFAULT 0, -- Is this level a secret
  troll INTEGER DEFAULT 0, -- Is this level a trick or troll only
  final INTEGER DEFAULT 0, -- Is this level the final level of a game
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (gameid) REFERENCES gameversions(gameid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gamestages_gameid ON gamestages(gameid);
CREATE INDEX IF NOT EXISTS idx_gamestages_levelnumber ON gamestages(levelnumber);
CREATE INDEX IF NOT EXISTS idx_gamestages_translevel ON gamestages(translevel_13bf);
CREATE INDEX IF NOT EXISTS idx_gamestages_playable ON gamestages(playable);
CREATE INDEX IF NOT EXISTS idx_gamestages_rando ON gamestages(rando);

CREATE TRIGGER IF NOT EXISTS trg_gamestages_updated
  AFTER UPDATE ON gamestages
  FOR EACH ROW
BEGIN
  UPDATE gamestages SET updated_at = CURRENT_TIMESTAMP WHERE stage_uuid = NEW.stage_uuid;
END;

