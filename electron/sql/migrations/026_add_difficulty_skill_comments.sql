-- Migration: Add difficulty and skill rating comment columns to clientdata.db
-- Date: 2025-01-XX
-- Database: clientdata.db
-- Purpose: Add comment text fields for difficulty rating and skill ratings to allow users to add comments for these ratings.

-- Add comment columns to user_game_annotations
ALTER TABLE user_game_annotations ADD COLUMN user_difficulty_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_skill_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_skill_comment_when_beat TEXT;

-- Add comment columns to user_game_version_annotations
ALTER TABLE user_game_version_annotations ADD COLUMN user_difficulty_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_skill_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_skill_comment_when_beat TEXT;

