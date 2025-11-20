-- Migration: 036_rhdata_gamestages_fix_foreign_key
-- Description: Fix foreign key constraint issue in gamestages table
-- Date: 2025-01-XX
-- 
-- The gamestages table was created with a foreign key constraint referencing
-- gameversions(gameid), but gameid is not a PRIMARY KEY or UNIQUE in gameversions.
-- This migration drops and recreates the table without the foreign key constraint.

-- Drop the existing table (safe since it's empty or can be recreated)
DROP TABLE IF EXISTS gamestages;

-- Recreate the table without the foreign key constraint
CREATE TABLE IF NOT EXISTS gamestages (
  stage_uuid TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  gameid TEXT NOT NULL, -- Links to gameversions by gameid (no FK constraint - gameid is not unique in gameversions)
  
  -- Level identification
  levelnumber TEXT, -- Lunar magic level number as 3-digit hex (000-13C)
  levelname TEXT NOT NULL,
  
  -- Version compatibility pattern
  -- "*" = all versions, comma-separated list of version numbers, ">N" for versions greater than N,
  -- "!N,*" for all versions except N
  versions TEXT DEFAULT '*',
  
  -- Level details
  submapid TEXT, -- Optional 1-byte hex
  translevel_13bf TEXT, -- 13BF value: Translevel number as hex string
  
  -- Prerequisites
  requisites TEXT, -- Comma-separated list of prerequisite tags (e.g., patch codes)
  
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
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  -- Note: No foreign key constraint because gameid is not unique in gameversions
  -- (multiple versions can share the same gameid). Application logic ensures integrity.
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

