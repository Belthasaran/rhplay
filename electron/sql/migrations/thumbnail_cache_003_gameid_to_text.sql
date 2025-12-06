-- Migration: thumbnail_cache_003_gameid_to_text
-- Description: Change gameid column from INTEGER to TEXT to support non-numeric gameids
-- Date: 2025-01-XX
-- 
-- Many gameversions have non-numeric gameids, so gameid must be stored as TEXT.
-- This migration recreates the table with TEXT gameid and preserves existing data.

-- Create new table with TEXT gameid
CREATE TABLE IF NOT EXISTS thumbnail_cache_new (
  gameid TEXT PRIMARY KEY,
  thumbnail_data_url TEXT NOT NULL,
  screenshot_rsuuid TEXT,
  screenshot_decoded_sha256 TEXT,
  image_title_banned INTEGER DEFAULT 0,
  image_preview_banned INTEGER DEFAULT 0,
  cached_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Copy existing data (convert INTEGER gameid to TEXT)
INSERT INTO thumbnail_cache_new 
SELECT 
  CAST(gameid AS TEXT) as gameid,
  thumbnail_data_url,
  screenshot_rsuuid,
  screenshot_decoded_sha256,
  COALESCE(image_title_banned, 0) as image_title_banned,
  COALESCE(image_preview_banned, 0) as image_preview_banned,
  cached_at,
  updated_at
FROM thumbnail_cache;

-- Drop old table
DROP TABLE thumbnail_cache;

-- Rename new table
ALTER TABLE thumbnail_cache_new RENAME TO thumbnail_cache;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_thumbnail_cache_gameid
  ON thumbnail_cache(gameid);

CREATE INDEX IF NOT EXISTS idx_thumbnail_cache_updated_at
  ON thumbnail_cache(updated_at);

CREATE INDEX IF NOT EXISTS idx_thumbnail_cache_image_title_banned
  ON thumbnail_cache(image_title_banned);

CREATE INDEX IF NOT EXISTS idx_thumbnail_cache_image_preview_banned
  ON thumbnail_cache(image_preview_banned);

-- Recreate trigger
CREATE TRIGGER IF NOT EXISTS trg_thumbnail_cache_updated
  AFTER UPDATE ON thumbnail_cache
BEGIN
  UPDATE thumbnail_cache
  SET updated_at = CURRENT_TIMESTAMP
  WHERE gameid = NEW.gameid;
END;

