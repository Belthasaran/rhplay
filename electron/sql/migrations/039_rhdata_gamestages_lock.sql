-- Migration 039: Add lock column to gamestages
-- Date: 2025-01-XX
-- Description: Adds lock column to gamestages table to prevent non-edit users from accessing certain levels

ALTER TABLE gamestages ADD COLUMN lock INTEGER DEFAULT 0;

-- Index for querying by lock status
CREATE INDEX IF NOT EXISTS idx_gamestages_lock ON gamestages(lock);

