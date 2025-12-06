-- Migration: thumbnail_cache_004_add_ban_cache_timestamp
-- Description: Add timestamp columns for tracking when ban status was cached
-- Date: 2025-01-XX
-- 
-- These columns track when the ban status was last cached, allowing expiration
-- after 30 minutes. This enables real-time ban list updates without requiring
-- a program restart.

ALTER TABLE thumbnail_cache ADD COLUMN image_title_banned_at TEXT;
ALTER TABLE thumbnail_cache ADD COLUMN image_preview_banned_at TEXT;

CREATE INDEX IF NOT EXISTS idx_thumbnail_cache_image_title_banned_at
  ON thumbnail_cache(image_title_banned_at);

CREATE INDEX IF NOT EXISTS idx_thumbnail_cache_image_preview_banned_at
  ON thumbnail_cache(image_preview_banned_at);

