-- Migration 040: Add playlevel_patch_code to gamestages
-- Date: 2025-01-XX
-- Description: Adds playlevel_patch_code column to gamestages table to specify which patch to use for level selection/testing

ALTER TABLE gamestages ADD COLUMN playlevel_patch_code TEXT DEFAULT '1lvno';

-- Index for querying by playlevel patch code
CREATE INDEX IF NOT EXISTS idx_gamestages_playlevel_patch ON gamestages(playlevel_patch_code);

