-- Migration 051: Win Rules Support
-- Date: 2025-01-XX
-- Purpose: Add win rules configuration to runs and win rule tracking to run_results
-- Database: clientdata.db

-- =============================================================================
-- Part 1: Add win rules configuration to runs table
-- =============================================================================

-- Add win_rules_json to store win rules configuration as JSON
ALTER TABLE runs ADD COLUMN win_rules_json TEXT NULL;  -- JSON blob for win rules configuration

-- Example win_rules_json structure:
-- {
--   "challengeTimeCap": {
--     "enabled": true,
--     "minutes": 10,
--     "gracePeriodPercent": 1.0,
--     "gracePeriodMinSeconds": 2,
--     "gracePeriodMaxSeconds": 60
--   },
--   "challengeTimeWithRollover": {
--     "enabled": false,
--     "minutes": 10,
--     "rolloverStartMinutes": 0,
--     "rolloverMaxMinutes": 30,
--     "gracePeriodPercent": 1.0,
--     "gracePeriodMinSeconds": 2,
--     "gracePeriodMaxSeconds": 60
--   },
--   "runTimeLimit": {
--     "enabled": false,
--     "minutes": 60
--   },
--   "noGameOvers": {
--     "enabled": false
--   },
--   "noHits": {
--     "enabled": false,
--     "requiresOneHitKO": true,
--     "requiresNoLives": true
--   }
-- }

-- =============================================================================
-- Part 2: Add win rule tracking columns to run_results table
-- =============================================================================

-- Add win rule tracking fields to run_results
ALTER TABLE run_results ADD COLUMN win_rules_met BOOLEAN DEFAULT NULL;  -- NULL = not applicable, TRUE = met, FALSE = not met

-- Rollover time tracking
ALTER TABLE run_results ADD COLUMN rollover_time_remaining_start_ms INTEGER NULL;  -- Rollover time remaining when challenge started (milliseconds)
ALTER TABLE run_results ADD COLUMN rollover_time_remaining_end_ms INTEGER NULL;  -- Rollover time remaining when challenge ended (milliseconds)

-- Time allocation tracking
ALTER TABLE run_results ADD COLUMN allocated_time_ms INTEGER NULL;  -- Total time available for this challenge (base time + rollover time) in milliseconds
ALTER TABLE run_results ADD COLUMN grace_time_ms INTEGER NULL;  -- Grace period allowed for this challenge in milliseconds

-- =============================================================================
-- Part 3: Add indexes for win rule queries
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_run_results_win_rules_met ON run_results(win_rules_met);

-- =============================================================================
-- Notes
-- =============================================================================
-- Win Rules:
-- 1. Challenge Time Cap: Each challenge must complete within time limit (default 10 min)
--    - Grace period: 1% of time limit, minimum 2 seconds, maximum 60 seconds
--    - Example: 5 min cap = 5:06 grace period
-- 2. Challenge Time with Rollover: Like time cap, but with rollover minutes
--    - Early completion adds to rollover pool (up to max)
--    - Late completion deducts from rollover pool
--    - Grace period time does not add to rollover
-- 3. Run Time Limit: Total time limit for entire run
-- 4. No Game Overs: Display only, honor system (user clicks Skip on game over)
-- 5. No Hits: Only enabled when One-hit-KO and nolives are global conditions
--    - User clicks Skip if hit (honor system)

