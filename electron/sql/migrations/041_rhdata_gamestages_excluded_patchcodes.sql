-- Migration: 041_rhdata_gamestages_excluded_patchcodes
-- Description: Add excluded_patchcodes column to gamestages table
-- Date: 2025-01-XX
--
-- This migration adds support for excluding specific patch codes (or declarative tags) from being applied to a gamestage.
-- The column stores JSON text that can contain:
-- - Patch codes (e.g., ["infliv", "moonjump"])
-- - Declarative tags (e.g., ["needspowerup", "needsyoshi"])
-- - Or a mix of both

-- Add excluded_patchcodes column to gamestages table
ALTER TABLE gamestages ADD COLUMN excluded_patchcodes TEXT;

-- Note: This column is NULL by default (no exclusions)
-- When set, it should contain a JSON array of strings, e.g.:
-- '["infliv", "moonjump", "needspowerup"]'
-- 
-- If a patch code in global conditions matches an excluded patch code or tag,
-- the stage should be filtered out during random stage selection.

