-- Migration: Add extended design rating columns to clientdata.db
-- Date: 2025-01-XX
-- Database: clientdata.db
-- Purpose: Add 10 new optional rating columns for extended design evaluation
--          These are 0-5 star ratings without SQL constraints (as requested)

-- Add rating columns to user_game_annotations (no CHECK constraints per request)
ALTER TABLE user_game_annotations ADD COLUMN user_accessibility_rating INTEGER;
ALTER TABLE user_game_annotations ADD COLUMN user_accessibility_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_length_pacing INTEGER;
ALTER TABLE user_game_annotations ADD COLUMN user_length_pacing_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_progression_rating INTEGER;
ALTER TABLE user_game_annotations ADD COLUMN user_progression_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_consistency_rating INTEGER;
ALTER TABLE user_game_annotations ADD COLUMN user_consistency_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_overworld_rating INTEGER;
ALTER TABLE user_game_annotations ADD COLUMN user_overworld_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_education_rating INTEGER;
ALTER TABLE user_game_annotations ADD COLUMN user_education_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_custom_rating INTEGER;
ALTER TABLE user_game_annotations ADD COLUMN user_custom_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_puzzle_rating INTEGER;
ALTER TABLE user_game_annotations ADD COLUMN user_puzzle_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_polish_rating INTEGER;
ALTER TABLE user_game_annotations ADD COLUMN user_polish_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_boss_rating INTEGER;
ALTER TABLE user_game_annotations ADD COLUMN user_boss_comment TEXT;

-- Add rating columns to user_game_version_annotations (no CHECK constraints per request)
ALTER TABLE user_game_version_annotations ADD COLUMN user_accessibility_rating INTEGER;
ALTER TABLE user_game_version_annotations ADD COLUMN user_accessibility_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_length_pacing INTEGER;
ALTER TABLE user_game_version_annotations ADD COLUMN user_length_pacing_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_progression_rating INTEGER;
ALTER TABLE user_game_version_annotations ADD COLUMN user_progression_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_consistency_rating INTEGER;
ALTER TABLE user_game_version_annotations ADD COLUMN user_consistency_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_overworld_rating INTEGER;
ALTER TABLE user_game_version_annotations ADD COLUMN user_overworld_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_education_rating INTEGER;
ALTER TABLE user_game_version_annotations ADD COLUMN user_education_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_custom_rating INTEGER;
ALTER TABLE user_game_version_annotations ADD COLUMN user_custom_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_puzzle_rating INTEGER;
ALTER TABLE user_game_version_annotations ADD COLUMN user_puzzle_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_polish_rating INTEGER;
ALTER TABLE user_game_version_annotations ADD COLUMN user_polish_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_boss_rating INTEGER;
ALTER TABLE user_game_version_annotations ADD COLUMN user_boss_comment TEXT;

SELECT 'Migration 059 completed successfully.' as message;
SELECT 'Added 10 extended design rating columns and comment columns to user_game_annotations and user_game_version_annotations' as changes;

