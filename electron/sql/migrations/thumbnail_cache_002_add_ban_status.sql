-- Migration: thumbnail_cache_002_add_ban_status
-- Description: Add columns for caching image_title and image_preview ban status
-- Date: 2025-01-XX
-- 
-- These columns cache ban status for performance during the current session only.
-- The cache is NOT persisted between program restarts - values are cleared on startup.
-- This allows rapid checking of ban status without repeated database queries.

ALTER TABLE thumbnail_cache ADD COLUMN image_title_banned INTEGER DEFAULT 0;
ALTER TABLE thumbnail_cache ADD COLUMN image_preview_banned INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_thumbnail_cache_image_title_banned
  ON thumbnail_cache(image_title_banned);

CREATE INDEX IF NOT EXISTS idx_thumbnail_cache_image_preview_banned
  ON thumbnail_cache(image_preview_banned);

