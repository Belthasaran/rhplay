-- Migration: Add rating comment columns to clientdata.db
-- Date: 2025-01-XX
-- Database: clientdata.db
-- Purpose: Add comment text fields for each rating component to allow users to add comments for their ratings.

-- Add comment columns to user_game_annotations
ALTER TABLE user_game_annotations ADD COLUMN user_review_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_recommendation_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_importance_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_technical_quality_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_gameplay_design_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_originality_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_visual_aesthetics_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_story_comment TEXT;
ALTER TABLE user_game_annotations ADD COLUMN user_soundtrack_graphics_comment TEXT;

-- Add comment columns to user_game_version_annotations
ALTER TABLE user_game_version_annotations ADD COLUMN user_review_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_recommendation_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_importance_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_technical_quality_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_gameplay_design_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_originality_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_visual_aesthetics_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_story_comment TEXT;
ALTER TABLE user_game_version_annotations ADD COLUMN user_soundtrack_graphics_comment TEXT;

