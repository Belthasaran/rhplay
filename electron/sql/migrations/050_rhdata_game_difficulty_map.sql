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
-- Correct mappings for gameversions difficulty (not game stage difficulty)
INSERT OR REPLACE INTO game_difficulty_map (map_type, map_string, difficulty_number) VALUES
  ('difficulty', 'Trivial', 0),
  ('difficulty', 'trivial', 0),
  ('difficulty', 'Newcomer', 1),
  ('difficulty', 'newcomer', 1),
  ('difficulty', 'Casual', 2),
  ('difficulty', 'casual', 2),
  ('difficulty', 'Intermediate', 3),
  ('difficulty', 'intermediate', 3),
  ('difficulty', 'Advanced', 4),
  ('difficulty', 'advanced', 4),
  ('difficulty', 'Expert', 5),
  ('difficulty', 'expert', 5),
  ('difficulty', 'Master', 6),
  ('difficulty', 'master', 6),
  ('difficulty', 'Grandmaster', 7),
  ('difficulty', 'grandmaster', 7),
  ('difficulty', 'Grandmaster Plus', 8),
  ('difficulty', 'grandmaster plus', 8),
  ('difficulty', 'grandmasterplus', 8),
  ('difficulty', 'Tool-Only', 9),
  ('difficulty', 'tool-only', 9),
  ('difficulty', 'toolonly', 9),
  ('difficulty', 'Pit Kaizo', 9),
  ('difficulty', 'pit kaizo', 9),
  ('difficulty', 'pitkaizo', 9),
  ('difficulty', 'Impossible', 10),
  ('difficulty', 'impossible', 10),
  ('difficulty', 'Bugged', 10),
  ('difficulty', 'bugged', 10),
  ('difficulty', 'Impossible/Bugged', 10),
  ('difficulty', 'impossible/bugged', 10);

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

