-- Migration: thumbnail_cache_001_create_thumbnail_cache
-- Description: Create thumbnail_cache table for storing decoded game thumbnail images
-- Date: 2025-01-XX
-- 
-- The thumbnail_cache table stores decoded image data (as base64 data URLs) for rapid
-- access when displaying game thumbnails in the UI. This avoids repeated decryption
-- of screenshots when listing games.
-- 
-- This database is separate from clientdata.db to allow users to easily reset the cache
-- by deleting the thumbnail_cache.db file without losing settings.

CREATE TABLE IF NOT EXISTS thumbnail_cache (
  gameid INTEGER PRIMARY KEY,
  thumbnail_data_url TEXT NOT NULL,
  screenshot_rsuuid TEXT,
  screenshot_decoded_sha256 TEXT,
  cached_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_thumbnail_cache_gameid
  ON thumbnail_cache(gameid);

CREATE INDEX IF NOT EXISTS idx_thumbnail_cache_updated_at
  ON thumbnail_cache(updated_at);

CREATE TRIGGER IF NOT EXISTS trg_thumbnail_cache_updated
  AFTER UPDATE ON thumbnail_cache
BEGIN
  UPDATE thumbnail_cache
  SET updated_at = CURRENT_TIMESTAMP
  WHERE gameid = NEW.gameid;
END;

