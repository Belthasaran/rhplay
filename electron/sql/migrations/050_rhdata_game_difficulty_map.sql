-- Migration: 050_rhdata_game_difficulty_map
-- Description: Create game_difficulty_map table for mapping difficulty strings and legacy_type strings to numeric difficulty levels
-- Date: 2025-01-XX
--
-- This migration creates a table to store mappings from:
-- - Difficulty attribute strings (e.g., "Newcomer", "Casual", "Intermediate") to numeric difficulty (0-10)
-- - Legacytype strings (e.g., "Standard: Easy", "Kaizo: Intermediate") to numeric difficulty (0-10)
--
-- The table supports filtering games by numeric difficulty ranges for random game selection.

CREATE TABLE IF NOT EXISTS game_difficulty_map (
  map_id INTEGER PRIMARY KEY AUTOINCREMENT,
  map_type TEXT NOT NULL CHECK(map_type IN ('difficulty', 'legacytype')),
  map_string TEXT NOT NULL,
  difficulty_number INTEGER NOT NULL CHECK(difficulty_number >= 0 AND difficulty_number <= 10),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(map_type, map_string)
);

-- Index for lookups by type and string
CREATE INDEX IF NOT EXISTS idx_game_difficulty_map_type_string ON game_difficulty_map(map_type, map_string);

-- Index for lookups by difficulty number
CREATE INDEX IF NOT EXISTS idx_game_difficulty_map_number ON game_difficulty_map(difficulty_number);

-- Populate with difficulty string mappings
INSERT OR IGNORE INTO game_difficulty_map (map_type, map_string, difficulty_number) VALUES
  ('difficulty', 'Newcomer', 0),
  ('difficulty', 'newcomer', 0),
  ('difficulty', 'Casual', 1),
  ('difficulty', 'casual', 1),
  ('difficulty', 'Intermediate', 2),
  ('difficulty', 'intermediate', 2),
  ('difficulty', 'Skilled', 3),
  ('difficulty', 'skilled', 3),
  ('difficulty', 'Advanced', 3),
  ('difficulty', 'advanced', 3),
  ('difficulty', 'Hard', 3),
  ('difficulty', 'hard', 3),
  ('difficulty', 'Expert', 4),
  ('difficulty', 'expert', 4),
  ('difficulty', 'Master', 5),
  ('difficulty', 'master', 5),
  ('difficulty', 'Grandmaster', 6),
  ('difficulty', 'grandmaster', 6),
  ('difficulty', 'Grandmaster Plus', 7),
  ('difficulty', 'grandmaster plus', 7),
  ('difficulty', 'Tool-Assisted', 8),
  ('difficulty', 'tool-assisted', 8),
  ('difficulty', 'tool assisted', 8);

-- Populate with legacytype string mappings
INSERT OR IGNORE INTO game_difficulty_map (map_type, map_string, difficulty_number) VALUES
  ('legacytype', 'Standard: Easy', 0),
  ('legacytype', 'Test Type', 0),
  ('legacytype', 'Standard: Normal', 2),
  ('legacytype', 'Joke', 2),
  ('legacytype', 'Competition Winner 2024', 2),
  ('legacytype', 'Classic Example - Historical', 2),
  ('legacytype', 'Tutorial Example - Keep This!', 2),
  ('legacytype', 'Standard: Casual (diff_2) (standard)', 2),
  ('legacytype', 'Standard: Newcomer (diff_1) (standard)', 1),
  ('legacytype', 'Hard', 3),
  ('legacytype', 'Standard: Hard', 3),
  ('legacytype', 'Standard: Hard, Kaizo: Beginner', 3),
  ('legacytype', 'Standard: Normal, Misc.: Troll', 3),
  ('legacytype', 'Standard: Skilled (diff_3) (standard)', 3),
  ('legacytype', 'Intermediate Intro Kaizo', 3),
  ('legacytype', 'Intermediate', 3),
  ('legacytype', 'Kaizo: Beginner', 3),
  ('legacytype', 'Standard: Very Hard', 4),
  ('legacytype', 'Intermediate Intermediate Kaizo', 4),
  ('legacytype', 'Intermediate Advanced Kaizo', 4),
  ('legacytype', 'Kaizo: Intermediate', 4),
  ('legacytype', 'Misc.: Troll', 4),
  ('legacytype', 'Standard: Very Hard, Kaizo: Expert', 5),
  ('legacytype', 'Kaizo: Intermediate, Standard: Very Hard', 4),
  ('legacytype', 'Standard: Hard, Kaizo: Intermediate', 4),
  ('legacytype', 'Standard: Hard, Misc.: Troll', 4),
  ('legacytype', 'Standard: Very Hard, Kaizo: Beginner', 4),
  ('legacytype', 'Standard: Easy, Kaizo: Intermediate', 4),
  ('legacytype', 'Standard: Hard, Standard: Very Hard', 4),
  ('legacytype', 'Standard: Normal, Kaizo: Intermediate', 4),
  ('legacytype', 'Standard: Very Hard, Kaizo: Intermediate', 4),
  ('legacytype', 'Kaizo: Intermediate, Misc.: Troll', 4),
  ('legacytype', 'Standard: Normal, Misc.: Puzzle', 4),
  ('legacytype', 'Standard, Kaizo: Advanced (diff_4) (standard, kaizo)', 4),
  ('legacytype', 'Kaizo: Expert (diff_5) (kaizo)', 5),
  ('legacytype', 'Kaizo: Advanced (diff_4) (kaizo)', 4),
  ('legacytype', 'Standard: Advanced (diff_4) (standard)', 4),
  ('legacytype', 'Kaizo: Master (diff_6) (kaizo)', 6),
  ('legacytype', 'Kaizo: Grandmaster (diff_7) (kaizo)', 7),
  ('legacytype', 'Kaizo: Expert', 5),
  ('legacytype', 'Tool-Assisted: Pit', 8),
  ('legacytype', 'Tool-Assisted: Kaizo', 8),
  ('legacytype', 'Kaizo, Puzzle, Tool-Assisted: Master (diff_6) (kaizo, puzzle, tool_assisted)', 8),
  ('legacytype', 'Kaizo, Tool-Assisted: Advanced (diff_4) (kaizo, tool_assisted)', 8);

