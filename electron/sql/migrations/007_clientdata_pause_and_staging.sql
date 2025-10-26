-- Migration 007: Add pause tracking and staging folder support
-- Date: 2025-10-12
-- Purpose: Support run persistence, pause/unpause, and pre-staged game files

-- Add pause tracking to runs table
ALTER TABLE runs ADD COLUMN pause_seconds INTEGER DEFAULT 0;
ALTER TABLE runs ADD COLUMN pause_start TIMESTAMP NULL;
ALTER TABLE runs ADD COLUMN pause_end TIMESTAMP NULL;
ALTER TABLE runs ADD COLUMN staging_folder VARCHAR(500);  -- Path to RunYYMMDD_HHMM folder

-- Add pause tracking to run_results table (per challenge)
ALTER TABLE run_results ADD COLUMN pause_seconds INTEGER DEFAULT 0;
ALTER TABLE run_results ADD COLUMN pause_start TIMESTAMP NULL;
ALTER TABLE run_results ADD COLUMN pause_end TIMESTAMP NULL;

-- Add index for finding active/paused runs
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_active ON runs(status, started_at) WHERE status = 'active';

