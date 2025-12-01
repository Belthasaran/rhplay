-- Migration: Add fairness and challenge quality rating columns to clientdata.db
-- Date: 2025-01-XX
-- Database: clientdata.db
-- Purpose: Add Player Fairness Rating and Challenge Quality Rating columns with comments
--          to user_game_annotations and user_game_version_annotations tables.

-- Add rating and comment columns to user_game_annotations
ALTER TABLE user_game_annotations ADD COLUMN user_fairness_rating INTEGER;
ALTER TABLE user_game_annotations ADD COLUMN user_fairness_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_challenge_quality_rating INTEGER;
ALTER TABLE user_game_annotations ADD COLUMN user_challenge_quality_comment TEXT;

-- Add rating and comment columns to user_game_version_annotations
ALTER TABLE user_game_version_annotations ADD COLUMN user_fairness_rating INTEGER;
ALTER TABLE user_game_version_annotations ADD COLUMN user_fairness_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_challenge_quality_rating INTEGER;
ALTER TABLE user_game_version_annotations ADD COLUMN user_challenge_quality_comment TEXT;

