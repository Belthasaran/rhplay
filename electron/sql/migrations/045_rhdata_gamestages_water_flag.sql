-- Migration: 045_rhdata_gamestages_water_flag
-- Description: Add water flag column to gamestages table
-- Date: 2025-01-XX
--
-- This migration adds a `water` flag column to track water levels in gamestages.
-- The flag follows the same pattern as other boolean flags (playable, castle, troll, etc.),
-- using INTEGER 0/1 values.

-- Add water column (defaults to 0, meaning not a water level)
ALTER TABLE gamestages ADD COLUMN water INTEGER DEFAULT 0;

-- Note:
-- - water = 0 means the stage is not a water level
-- - water = 1 means the stage is a water level
-- - Defaults to 0 for existing stages

