-- Migration 047: Run Timing Millisecond Precision and Network Time Verification
-- Date: 2025-01-XX
-- Purpose: Add millisecond precision to all timing fields, network time verification, and run validity status
-- Database: clientdata.db

-- =============================================================================
-- Part 1: Convert timestamps to millisecond precision (INTEGER milliseconds since epoch)
-- =============================================================================

-- Add new columns for millisecond precision timestamps
-- We keep the old TIMESTAMP columns for backwards compatibility during migration

-- runs table: Add millisecond precision columns
ALTER TABLE runs ADD COLUMN created_at_ms INTEGER NULL;  -- Milliseconds since epoch
ALTER TABLE runs ADD COLUMN started_at_ms INTEGER NULL;  -- Milliseconds since epoch
ALTER TABLE runs ADD COLUMN completed_at_ms INTEGER NULL;  -- Milliseconds since epoch
ALTER TABLE runs ADD COLUMN updated_at_ms INTEGER NULL;  -- Milliseconds since epoch
ALTER TABLE runs ADD COLUMN pause_start_ms INTEGER NULL;  -- Milliseconds since epoch
ALTER TABLE runs ADD COLUMN pause_end_ms INTEGER NULL;  -- Milliseconds since epoch

-- run_results table: Add millisecond precision columns
ALTER TABLE run_results ADD COLUMN started_at_ms INTEGER NULL;  -- Milliseconds since epoch
ALTER TABLE run_results ADD COLUMN completed_at_ms INTEGER NULL;  -- Milliseconds since epoch
ALTER TABLE run_results ADD COLUMN pause_start_ms INTEGER NULL;  -- Milliseconds since epoch
ALTER TABLE run_results ADD COLUMN pause_end_ms INTEGER NULL;  -- Milliseconds since epoch

-- =============================================================================
-- Part 2: Convert pause_seconds to pause_milliseconds
-- =============================================================================

-- runs table: Change pause_seconds to pause_milliseconds
-- First add new column, then migrate data, then drop old column
ALTER TABLE runs ADD COLUMN pause_milliseconds INTEGER DEFAULT 0;  -- Total paused time in milliseconds

-- Migrate existing pause_seconds to pause_milliseconds (multiply by 1000)
UPDATE runs SET pause_milliseconds = COALESCE(pause_seconds, 0) * 1000 WHERE pause_seconds IS NOT NULL;

-- run_results table: Change pause_seconds to pause_milliseconds
ALTER TABLE run_results ADD COLUMN pause_milliseconds INTEGER DEFAULT 0;  -- Per-challenge pause time in milliseconds

-- Migrate existing pause_seconds to pause_milliseconds (multiply by 1000)
UPDATE run_results SET pause_milliseconds = COALESCE(pause_seconds, 0) * 1000 WHERE pause_seconds IS NOT NULL;

-- =============================================================================
-- Part 3: Network Time Verification and Run Validity Status
-- =============================================================================

-- Add network time verification fields to runs table
ALTER TABLE runs ADD COLUMN clock_offset_ms INTEGER NULL;  -- Difference between system time and network time in milliseconds (positive = system ahead, negative = system behind)
ALTER TABLE runs ADD COLUMN clock_validated BOOLEAN DEFAULT 0;  -- Whether clock was validated against network time
ALTER TABLE runs ADD COLUMN network_time_ms INTEGER NULL;  -- Network time snapshot in milliseconds since epoch (taken at run start)
ALTER TABLE runs ADD COLUMN run_validity_status VARCHAR(20) DEFAULT 'unverified';  -- 'valid', 'invalid', 'unverified', 'suspicious'

-- Add index for run validity queries
CREATE INDEX IF NOT EXISTS idx_runs_validity_status ON runs(run_validity_status);

-- =============================================================================
-- Part 4: Update duration_seconds to support millisecond precision (optional)
-- =============================================================================

-- Keep duration_seconds as INTEGER (seconds) for display purposes
-- But we can also add duration_milliseconds for internal precision
ALTER TABLE run_results ADD COLUMN duration_milliseconds INTEGER NULL;  -- Duration in milliseconds for internal precision

-- Migrate existing duration_seconds to duration_milliseconds (multiply by 1000)
UPDATE run_results SET duration_milliseconds = COALESCE(duration_seconds, 0) * 1000 WHERE duration_seconds IS NOT NULL;

-- =============================================================================
-- Part 5: Migrate existing TIMESTAMP data to millisecond columns
-- =============================================================================

-- Convert existing TIMESTAMP columns to milliseconds
-- SQLite TIMESTAMP columns are stored as TEXT (ISO8601) or INTEGER
-- We'll convert them to milliseconds since epoch (1970-01-01)

-- runs table: Convert existing timestamps
UPDATE runs SET created_at_ms = CAST((julianday(created_at) - 2440587.5) * 86400000 AS INTEGER)
WHERE created_at IS NOT NULL AND created_at_ms IS NULL;

UPDATE runs SET started_at_ms = CAST((julianday(started_at) - 2440587.5) * 86400000 AS INTEGER)
WHERE started_at IS NOT NULL AND started_at_ms IS NULL;

UPDATE runs SET completed_at_ms = CAST((julianday(completed_at) - 2440587.5) * 86400000 AS INTEGER)
WHERE completed_at IS NOT NULL AND completed_at_ms IS NULL;

UPDATE runs SET updated_at_ms = CAST((julianday(updated_at) - 2440587.5) * 86400000 AS INTEGER)
WHERE updated_at IS NOT NULL AND updated_at_ms IS NULL;

UPDATE runs SET pause_start_ms = CAST((julianday(pause_start) - 2440587.5) * 86400000 AS INTEGER)
WHERE pause_start IS NOT NULL AND pause_start_ms IS NULL;

UPDATE runs SET pause_end_ms = CAST((julianday(pause_end) - 2440587.5) * 86400000 AS INTEGER)
WHERE pause_end IS NOT NULL AND pause_end_ms IS NULL;

-- run_results table: Convert existing timestamps
UPDATE run_results SET started_at_ms = CAST((julianday(started_at) - 2440587.5) * 86400000 AS INTEGER)
WHERE started_at IS NOT NULL AND started_at_ms IS NULL;

UPDATE run_results SET completed_at_ms = CAST((julianday(completed_at) - 2440587.5) * 86400000 AS INTEGER)
WHERE completed_at IS NOT NULL AND completed_at_ms IS NULL;

UPDATE run_results SET pause_start_ms = CAST((julianday(pause_start) - 2440587.5) * 86400000 AS INTEGER)
WHERE pause_start IS NOT NULL AND pause_start_ms IS NULL;

UPDATE run_results SET pause_end_ms = CAST((julianday(pause_end) - 2440587.5) * 86400000 AS INTEGER)
WHERE pause_end IS NOT NULL AND pause_end_ms IS NULL;

-- =============================================================================
-- Part 6: Update triggers to populate millisecond columns
-- =============================================================================

-- Drop existing trigger and recreate to also update millisecond columns
DROP TRIGGER IF EXISTS trigger_runs_updated;

-- Recreate trigger to update both TIMESTAMP and millisecond columns
CREATE TRIGGER IF NOT EXISTS trigger_runs_updated 
AFTER UPDATE ON runs
BEGIN
    UPDATE runs 
    SET updated_at = CURRENT_TIMESTAMP,
        updated_at_ms = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)  -- Convert to milliseconds since epoch
    WHERE run_uuid = NEW.run_uuid;
END;

-- Create trigger to populate millisecond columns on INSERT
CREATE TRIGGER IF NOT EXISTS trigger_runs_insert_ms 
AFTER INSERT ON runs
BEGIN
    UPDATE runs 
    SET created_at_ms = CAST((julianday(created_at) - 2440587.5) * 86400000 AS INTEGER),
        updated_at_ms = CAST((julianday(updated_at) - 2440587.5) * 86400000 AS INTEGER),
        started_at_ms = CASE WHEN started_at IS NOT NULL THEN CAST((julianday(started_at) - 2440587.5) * 86400000 AS INTEGER) ELSE NULL END,
        completed_at_ms = CASE WHEN completed_at IS NOT NULL THEN CAST((julianday(completed_at) - 2440587.5) * 86400000 AS INTEGER) ELSE NULL END,
        pause_start_ms = CASE WHEN pause_start IS NOT NULL THEN CAST((julianday(pause_start) - 2440587.5) * 86400000 AS INTEGER) ELSE NULL END,
        pause_end_ms = CASE WHEN pause_end IS NOT NULL THEN CAST((julianday(pause_end) - 2440587.5) * 86400000 AS INTEGER) ELSE NULL END
    WHERE run_uuid = NEW.run_uuid;
END;

-- =============================================================================
-- Part 7: Create helper view for backwards compatibility (converts ms to seconds)
-- =============================================================================

-- View to provide backwards-compatible seconds-based columns from millisecond columns
CREATE VIEW IF NOT EXISTS v_runs_timing_compat AS
SELECT 
    run_uuid,
    -- Milliseconds columns (primary)
    created_at_ms,
    started_at_ms,
    completed_at_ms,
    updated_at_ms,
    pause_start_ms,
    pause_end_ms,
    pause_milliseconds,
    clock_offset_ms,
    clock_validated,
    network_time_ms,
    run_validity_status,
    -- Seconds columns (for backwards compatibility, rounded)
    CAST(COALESCE(created_at_ms, 0) / 1000 AS INTEGER) as created_at_seconds,
    CAST(COALESCE(started_at_ms, 0) / 1000 AS INTEGER) as started_at_seconds,
    CAST(COALESCE(completed_at_ms, 0) / 1000 AS INTEGER) as completed_at_seconds,
    CAST(COALESCE(pause_milliseconds, 0) / 1000 AS INTEGER) as pause_seconds_rounded,
    -- Original TIMESTAMP columns (for backwards compatibility)
    created_at,
    started_at,
    completed_at,
    updated_at,
    pause_start,
    pause_end
FROM runs;

-- Similar view for run_results
CREATE VIEW IF NOT EXISTS v_run_results_timing_compat AS
SELECT 
    result_uuid,
    -- Milliseconds columns (primary)
    started_at_ms,
    completed_at_ms,
    pause_start_ms,
    pause_end_ms,
    pause_milliseconds,
    duration_milliseconds,
    -- Seconds columns (for backwards compatibility, rounded)
    CAST(COALESCE(started_at_ms, 0) / 1000 AS INTEGER) as started_at_seconds,
    CAST(COALESCE(completed_at_ms, 0) / 1000 AS INTEGER) as completed_at_seconds,
    CAST(COALESCE(pause_milliseconds, 0) / 1000 AS INTEGER) as pause_seconds_rounded,
    CAST(COALESCE(duration_milliseconds, 0) / 1000 AS INTEGER) as duration_seconds_rounded,
    -- Original columns (for backwards compatibility)
    started_at,
    completed_at,
    pause_start,
    pause_end,
    pause_seconds,
    duration_seconds
FROM run_results;

