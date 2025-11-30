-- Migration 052: Rename win rules rollover columns to match code expectations
-- Date: 2025-01-XX
-- Purpose: Rename rollover_time_at_start_ms and rollover_time_at_end_ms to rollover_time_remaining_start_ms and rollover_time_remaining_end_ms
-- Database: clientdata.db

-- SQLite doesn't support RENAME COLUMN directly, so we need to recreate the table
-- This migration renames the columns to match the code expectations

-- Step 1: Create new table with correct column names
CREATE TABLE IF NOT EXISTS run_results_new (
    result_uuid VARCHAR(255) PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    run_uuid VARCHAR(255) NOT NULL REFERENCES runs(run_uuid) ON DELETE CASCADE,
    plan_entry_uuid VARCHAR(255) REFERENCES run_plan_entries(entry_uuid),
    sequence_number INTEGER NOT NULL,
    gameid VARCHAR(255),
    game_name VARCHAR(255),
    exit_number VARCHAR(255),
    stage_description VARCHAR(255),
    levelnumber VARCHAR(255),
    levelname VARCHAR(255),
    translevel VARCHAR(255),
    was_random BOOLEAN DEFAULT 0,
    revealed_early BOOLEAN DEFAULT 0,
    status VARCHAR(50) DEFAULT 'pending',
    started_at TIMESTAMP NULL,
    started_at_ms INTEGER NULL,
    completed_at TIMESTAMP NULL,
    completed_at_ms INTEGER NULL,
    duration_seconds INTEGER,
    duration_milliseconds INTEGER,
    pause_seconds INTEGER DEFAULT 0,
    pause_milliseconds INTEGER DEFAULT 0,
    pause_start TIMESTAMP NULL,
    pause_start_ms INTEGER NULL,
    result_notes TEXT,
    conditions TEXT,
    sfcpath TEXT NULL,
    win_rules_met BOOLEAN DEFAULT NULL,
    rollover_time_remaining_start_ms INTEGER NULL,
    rollover_time_remaining_end_ms INTEGER NULL,
    allocated_time_ms INTEGER NULL,
    grace_time_ms INTEGER NULL,
    UNIQUE(run_uuid, sequence_number)
);

-- Step 2: Copy data from old table to new table, mapping old column names to new ones
INSERT INTO run_results_new SELECT 
    result_uuid,
    run_uuid,
    plan_entry_uuid,
    sequence_number,
    gameid,
    game_name,
    exit_number,
    stage_description,
    levelnumber,
    levelname,
    translevel,
    was_random,
    revealed_early,
    status,
    started_at,
    started_at_ms,
    completed_at,
    completed_at_ms,
    duration_seconds,
    duration_milliseconds,
    pause_seconds,
    pause_milliseconds,
    pause_start,
    pause_start_ms,
    result_notes,
    conditions,
    sfcpath,
    win_rules_met,
    rollover_time_at_start_ms AS rollover_time_remaining_start_ms,
    rollover_time_at_end_ms AS rollover_time_remaining_end_ms,
    allocated_time_ms,
    grace_time_ms
FROM run_results;

-- Step 3: Drop views that depend on run_results
DROP VIEW IF EXISTS v_run_progress;
DROP VIEW IF EXISTS v_run_results_timing_compat;

-- Step 4: Drop old table
DROP TABLE run_results;

-- Step 5: Rename new table to original name
ALTER TABLE run_results_new RENAME TO run_results;

-- Step 6: Recreate views
CREATE VIEW IF NOT EXISTS v_run_progress AS
SELECT 
    rr.run_uuid,
    rr.sequence_number,
    rr.gameid,
    rr.game_name,
    rr.exit_number,
    rr.stage_description,
    rr.status,
    rr.was_random,
    rr.revealed_early,
    rr.started_at,
    rr.completed_at,
    rr.duration_seconds
FROM run_results rr
ORDER BY rr.sequence_number;

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

-- Step 7: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_run_results_run ON run_results(run_uuid);
CREATE INDEX IF NOT EXISTS idx_run_results_sequence ON run_results(run_uuid, sequence_number);
CREATE INDEX IF NOT EXISTS idx_run_results_status ON run_results(status);
CREATE INDEX IF NOT EXISTS idx_run_results_game ON run_results(gameid);
CREATE INDEX IF NOT EXISTS idx_run_results_win_rules_met ON run_results(win_rules_met);

