-- Migration: 038_rhdata_gamestages_tile_coords
-- Description: Add tile_x and tile_y columns to gamestages table
-- Date: 2025-01-XX
-- 
-- Add optional tile coordinates (x, y) to gamestages table.
-- These are stored as TEXT containing integer strings.

-- SQLite doesn't support ALTER COLUMN ADD, so we need to recreate the table
-- Since gamestages may have data, we need to preserve it
-- However, since this is early development, we can safely recreate

-- Create temporary table with new columns
CREATE TABLE IF NOT EXISTS gamestages_new (
  stage_uuid TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  gameid TEXT NOT NULL,
  levelnumber TEXT,
  levelname TEXT NOT NULL,
  versions TEXT DEFAULT '*',
  submapid TEXT,
  translevel_13bf TEXT,
  tile_x TEXT,
  tile_y TEXT,
  tile_value TEXT,
  requisites TEXT,
  playable INTEGER DEFAULT 1,
  rando INTEGER DEFAULT 1,
  difficulty INTEGER DEFAULT 0 CHECK(difficulty >= 0 AND difficulty <= 10),
  mainexit INTEGER DEFAULT 1,
  keyhole INTEGER DEFAULT 0,
  credits INTEGER DEFAULT 0,
  ghouse INTEGER DEFAULT 0,
  spalace INTEGER DEFAULT 0,
  castle INTEGER DEFAULT 0,
  boss INTEGER DEFAULT 0,
  secret INTEGER DEFAULT 0,
  troll INTEGER DEFAULT 0,
  final INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Copy data from old table to new table
INSERT INTO gamestages_new 
  (stage_uuid, gameid, levelnumber, levelname, versions, submapid, translevel_13bf,
   requisites, playable, rando, difficulty,
   mainexit, keyhole, credits, ghouse, spalace, castle, boss, secret, troll, final,
   created_at, updated_at)
SELECT 
  stage_uuid, gameid, levelnumber, levelname, versions, submapid, translevel_13bf,
  requisites, playable, rando, difficulty,
  mainexit, keyhole, credits, ghouse, spalace, castle, boss, secret, troll, final,
  created_at, updated_at
FROM gamestages;

-- Drop old table
DROP TABLE IF EXISTS gamestages;

-- Rename new table to original name
ALTER TABLE gamestages_new RENAME TO gamestages;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_gamestages_gameid ON gamestages(gameid);
CREATE INDEX IF NOT EXISTS idx_gamestages_levelnumber ON gamestages(levelnumber);
CREATE INDEX IF NOT EXISTS idx_gamestages_translevel ON gamestages(translevel_13bf);
CREATE INDEX IF NOT EXISTS idx_gamestages_playable ON gamestages(playable);
CREATE INDEX IF NOT EXISTS idx_gamestages_rando ON gamestages(rando);

-- Recreate trigger
CREATE TRIGGER IF NOT EXISTS trg_gamestages_updated
  AFTER UPDATE ON gamestages
  FOR EACH ROW
BEGIN
  UPDATE gamestages SET updated_at = CURRENT_TIMESTAMP WHERE stage_uuid = NEW.stage_uuid;
END;

