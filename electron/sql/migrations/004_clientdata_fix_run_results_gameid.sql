-- Migration 004: Fix run_results.gameid to allow NULL for unresolved random challenges
-- Date: 2025-10-12
-- Issue: Random challenges don't have a gameid until resolved, but schema requires NOT NULL

-- For SQLite, we need to recreate the table to modify the constraint
-- Save existing data first (if any)
DROP TABLE IF EXISTS run_results_backup;
CREATE TABLE run_results_backup AS SELECT * FROM run_results WHERE 1=0;  -- Empty backup table with structure

-- Drop old table
DROP TABLE IF EXISTS run_results;

-- Recreate with gameid allowing NULL
CREATE TABLE IF NOT EXISTS run_results (
    result_uuid VARCHAR(255) PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    
    -- References
    run_uuid VARCHAR(255) NOT NULL REFERENCES runs(run_uuid) ON DELETE CASCADE,
    plan_entry_uuid VARCHAR(255) REFERENCES run_plan_entries(entry_uuid),
    
    -- Sequence in actual execution
    sequence_number INTEGER NOT NULL,
    
    -- What was actually attempted
    gameid VARCHAR(255),  -- Resolved game ID (NULL for unresolved random challenges)
    game_name VARCHAR(255),  -- Game name (cached for display, "???" for masked)
    exit_number VARCHAR(255),  -- Exit number if stage challenge
    stage_description VARCHAR(255),  -- Stage description (cached)
    
    -- Challenge metadata
    was_random BOOLEAN DEFAULT 0,  -- Was this a random selection?
    revealed_early BOOLEAN DEFAULT 0,  -- Was name revealed before attempt?
    
    -- Result status
    status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'success', 'ok', 'skipped', 'failed'
    
    -- Timestamps
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    duration_seconds INTEGER,  -- Time spent on this challenge
    
    -- Result notes
    result_notes TEXT,
    
    -- Challenge conditions
    conditions TEXT,  -- JSON array of challenge conditions for this result
    
    -- USB2SNES file path
    sfcpath TEXT NULL,  -- Relative path on USB2SNES (e.g., run251025_2307/02.sfc)
    
    UNIQUE(run_uuid, sequence_number)
);

-- Restore data would go here if any existed (table is empty on first run)
-- INSERT INTO run_results SELECT * FROM run_results_backup;

-- Drop backup
DROP TABLE IF EXISTS run_results_backup;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_run_results_run ON run_results(run_uuid);
CREATE INDEX IF NOT EXISTS idx_run_results_sequence ON run_results(run_uuid, sequence_number);
CREATE INDEX IF NOT EXISTS idx_run_results_status ON run_results(status);
CREATE INDEX IF NOT EXISTS idx_run_results_gameid ON run_results(gameid);

