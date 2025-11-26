-- Migration: 046_rhdata_gamestages_stagetags
-- Description: Add stagetags column to gamestages table
-- Date: 2025-01-XX
--
-- This migration adds a `stagetags` column to store comma-separated arbitrary tags
-- about gamestages (e.g., "cape", "autoscroller").
-- This allows for flexible categorization and filtering of stages beyond the
-- existing boolean flags.

-- Add stagetags column (TEXT, nullable, defaults to empty string)
ALTER TABLE gamestages ADD COLUMN stagetags TEXT DEFAULT '';

-- Note:
-- - stagetags is a comma-separated list of strings
-- - Examples: "cape", "autoscroller", "cape,autoscroller"
-- - Empty string or NULL means no tags
-- - Tags are case-sensitive and should be lowercase for consistency

