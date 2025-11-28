-- Migration: 049_clientdata_run_plan_entries_game_filters
-- Description: Add game filter columns to run_plan_entries table for numeric difficulty filtering
-- Date: 2025-01-XX
--
-- This migration adds support for min/max difficulty filtering for random game selection:
-- - game_filter_min_difficulty: Minimum difficulty level (0-8) or NULL
-- - game_filter_max_difficulty: Maximum difficulty level (0-8) or NULL

-- Add game filter columns for random_game entries
ALTER TABLE run_plan_entries ADD COLUMN game_filter_min_difficulty INTEGER;
ALTER TABLE run_plan_entries ADD COLUMN game_filter_max_difficulty INTEGER;

-- Note: game_filter columns are NULL for non-random_game entries
-- For random_game entries:
-- - game_filter_min_difficulty: 0-8 or NULL (no min filter)
-- - game_filter_max_difficulty: 0-8 or NULL (no max filter)
-- If maxDifficulty is specified, minDifficulty acts as the minimum of the range
-- If maxDifficulty is not specified, minDifficulty acts as exact difficulty match

