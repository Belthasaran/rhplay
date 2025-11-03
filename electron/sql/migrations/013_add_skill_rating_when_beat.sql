-- Migration: Add user_skill_rating_when_beat column
-- Date: 2025-01-XX
-- Description: Add skill rating for when user beat the game (0-10 scale)
-- Database: clientdata.db

-- Add skill rating when beat to game annotations
ALTER TABLE user_game_annotations ADD COLUMN user_skill_rating_when_beat INTEGER 
  CHECK (user_skill_rating_when_beat IS NULL OR (user_skill_rating_when_beat >= 0 AND user_skill_rating_when_beat <= 10));

-- Add skill rating when beat to version-specific annotations
ALTER TABLE user_game_version_annotations ADD COLUMN user_skill_rating_when_beat INTEGER 
  CHECK (user_skill_rating_when_beat IS NULL OR (user_skill_rating_when_beat >= 0 AND user_skill_rating_when_beat <= 10));

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_user_game_skill_when_beat ON user_game_annotations(user_skill_rating_when_beat);
CREATE INDEX IF NOT EXISTS idx_user_gv_skill_when_beat ON user_game_version_annotations(user_skill_rating_when_beat);

