-- Migration 041: Add is_playlevel flag to extrapatches
-- Date: 2025-01-XX
-- Description: Adds is_playlevel boolean flag to extrapatches table to indicate patches that can be used as playlevel patches

ALTER TABLE extrapatches ADD COLUMN is_playlevel INTEGER DEFAULT 0;

-- Index for querying playlevel patches
CREATE INDEX IF NOT EXISTS idx_extrapatches_is_playlevel ON extrapatches(is_playlevel);
