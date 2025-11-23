-- Migration: 044_rhdata_gamestages_rhpak_support
-- Description: Add rhpakuuid and extradescription columns to gamestages table for RHPAK support
-- Date: 2025-01-XX
--
-- This migration adds:
-- 1. rhpakuuid column to track which RHPAK a gamestage was installed from (similar to gameversions.rhpakuuid)
-- 2. extradescription column for optional free-form description in addition to levelname
--
-- The rhpakuuid allows gamestages to be installed/uninstalled with their parent RHPAK,
-- just like gameversions, patchblobs, and other RHPAK-managed records.

-- Add rhpakuuid column (nullable, for backward compatibility with existing stages)
ALTER TABLE gamestages ADD COLUMN rhpakuuid TEXT;

-- Add extradescription column (nullable, optional free-form description)
ALTER TABLE gamestages ADD COLUMN extradescription TEXT;

-- Create index on rhpakuuid for efficient queries during RHPAK uninstall
CREATE INDEX IF NOT EXISTS idx_gamestages_rhpakuuid ON gamestages(rhpakuuid);

-- Note:
-- - rhpakuuid is NULL for existing stages (not installed via RHPAK)
-- - rhpakuuid will be set when stages are installed from an RHPAK
-- - extradescription is optional and can be edited via the GameStagesDialog notepad icon

