-- Migration: Add extended rating columns to user_game_annotations and user_game_version_annotations
-- Date: 2025-01-XX
-- Description: Add additional rating components for more detailed game reviews
-- Database: clientdata.db

-- =============================================================================
-- Part 1: Add extended ratings to user_game_annotations
-- =============================================================================

ALTER TABLE user_game_annotations ADD COLUMN user_recommendation_rating INTEGER 
  CHECK (user_recommendation_rating IS NULL OR (user_recommendation_rating >= 0 AND user_recommendation_rating <= 5));

ALTER TABLE user_game_annotations ADD COLUMN user_importance_rating INTEGER 
  CHECK (user_importance_rating IS NULL OR (user_importance_rating >= 0 AND user_importance_rating <= 5));

ALTER TABLE user_game_annotations ADD COLUMN user_technical_quality_rating INTEGER 
  CHECK (user_technical_quality_rating IS NULL OR (user_technical_quality_rating >= 0 AND user_technical_quality_rating <= 5));

ALTER TABLE user_game_annotations ADD COLUMN user_gameplay_design_rating INTEGER 
  CHECK (user_gameplay_design_rating IS NULL OR (user_gameplay_design_rating >= 0 AND user_gameplay_design_rating <= 5));

ALTER TABLE user_game_annotations ADD COLUMN user_originality_rating INTEGER 
  CHECK (user_originality_rating IS NULL OR (user_originality_rating >= 0 AND user_originality_rating <= 5));

ALTER TABLE user_game_annotations ADD COLUMN user_visual_aesthetics_rating INTEGER 
  CHECK (user_visual_aesthetics_rating IS NULL OR (user_visual_aesthetics_rating >= 0 AND user_visual_aesthetics_rating <= 5));

ALTER TABLE user_game_annotations ADD COLUMN user_story_rating INTEGER 
  CHECK (user_story_rating IS NULL OR (user_story_rating >= 0 AND user_story_rating <= 5));

ALTER TABLE user_game_annotations ADD COLUMN user_soundtrack_graphics_rating INTEGER 
  CHECK (user_soundtrack_graphics_rating IS NULL OR (user_soundtrack_graphics_rating >= 0 AND user_soundtrack_graphics_rating <= 5));

-- Create indexes for new rating columns
CREATE INDEX IF NOT EXISTS idx_user_game_recommendation ON user_game_annotations(user_recommendation_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_importance ON user_game_annotations(user_importance_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_technical_quality ON user_game_annotations(user_technical_quality_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_gameplay_design ON user_game_annotations(user_gameplay_design_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_originality ON user_game_annotations(user_originality_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_visual_aesthetics ON user_game_annotations(user_visual_aesthetics_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_story ON user_game_annotations(user_story_rating);
CREATE INDEX IF NOT EXISTS idx_user_game_soundtrack_graphics ON user_game_annotations(user_soundtrack_graphics_rating);

-- =============================================================================
-- Part 2: Add extended ratings to user_game_version_annotations
-- =============================================================================

ALTER TABLE user_game_version_annotations ADD COLUMN user_recommendation_rating INTEGER 
  CHECK (user_recommendation_rating IS NULL OR (user_recommendation_rating >= 0 AND user_recommendation_rating <= 5));

ALTER TABLE user_game_version_annotations ADD COLUMN user_importance_rating INTEGER 
  CHECK (user_importance_rating IS NULL OR (user_importance_rating >= 0 AND user_importance_rating <= 5));

ALTER TABLE user_game_version_annotations ADD COLUMN user_technical_quality_rating INTEGER 
  CHECK (user_technical_quality_rating IS NULL OR (user_technical_quality_rating >= 0 AND user_technical_quality_rating <= 5));

ALTER TABLE user_game_version_annotations ADD COLUMN user_gameplay_design_rating INTEGER 
  CHECK (user_gameplay_design_rating IS NULL OR (user_gameplay_design_rating >= 0 AND user_gameplay_design_rating <= 5));

ALTER TABLE user_game_version_annotations ADD COLUMN user_originality_rating INTEGER 
  CHECK (user_originality_rating IS NULL OR (user_originality_rating >= 0 AND user_originality_rating <= 5));

ALTER TABLE user_game_version_annotations ADD COLUMN user_visual_aesthetics_rating INTEGER 
  CHECK (user_visual_aesthetics_rating IS NULL OR (user_visual_aesthetics_rating >= 0 AND user_visual_aesthetics_rating <= 5));

ALTER TABLE user_game_version_annotations ADD COLUMN user_story_rating INTEGER 
  CHECK (user_story_rating IS NULL OR (user_story_rating >= 0 AND user_story_rating <= 5));

ALTER TABLE user_game_version_annotations ADD COLUMN user_soundtrack_graphics_rating INTEGER 
  CHECK (user_soundtrack_graphics_rating IS NULL OR (user_soundtrack_graphics_rating >= 0 AND user_soundtrack_graphics_rating <= 5));

-- Create indexes for new rating columns
CREATE INDEX IF NOT EXISTS idx_user_gv_recommendation ON user_game_version_annotations(user_recommendation_rating);
CREATE INDEX IF NOT EXISTS idx_user_gv_importance ON user_game_version_annotations(user_importance_rating);
CREATE INDEX IF NOT EXISTS idx_user_gv_technical_quality ON user_game_version_annotations(user_technical_quality_rating);
CREATE INDEX IF NOT EXISTS idx_user_gv_gameplay_design ON user_game_version_annotations(user_gameplay_design_rating);
CREATE INDEX IF NOT EXISTS idx_user_gv_originality ON user_game_version_annotations(user_originality_rating);
CREATE INDEX IF NOT EXISTS idx_user_gv_visual_aesthetics ON user_game_version_annotations(user_visual_aesthetics_rating);
CREATE INDEX IF NOT EXISTS idx_user_gv_story ON user_game_version_annotations(user_story_rating);
CREATE INDEX IF NOT EXISTS idx_user_gv_soundtrack_graphics ON user_game_version_annotations(user_soundtrack_graphics_rating);

