-- Migration: 034_rhdata_extrapatches_is_system
-- Description: Add is_system flag to extrapatches table to mark system patches as read-only
-- Date: 2025-01-XX

-- Add is_system column (0 = user patch, 1 = system patch)
ALTER TABLE extrapatches ADD COLUMN is_system INTEGER DEFAULT 0;

-- Create index for system patches
CREATE INDEX IF NOT EXISTS idx_extrapatches_is_system ON extrapatches(is_system);

