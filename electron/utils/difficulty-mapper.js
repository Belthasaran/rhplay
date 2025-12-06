/**
 * Difficulty Mapper Utility
 * 
 * Maps difficulty strings and legacy_type strings to numeric difficulty levels
 * for filtering games in random selection.
 * 
 * Difficulty Level Mappings:
 * - Newcomer - 0
 * - Casual - 1
 * - Intermediate - 2
 * - Skilled/Advanced/Hard - 3
 * - Expert - 4
 * - Master - 5
 * - Grandmaster - 6
 * - Grandmaster Plus - 7
 * - Tool-Assisted - 8
 */

// Map difficulty string values to numeric levels
// Correct mappings for gameversions difficulty (not game stage difficulty)
const DIFFICULTY_STRING_MAP = {
  'Trivial': 0,
  'trivial': 0,
  'Newcomer': 1,
  'newcomer': 1,
  'Casual': 2,
  'casual': 2,
  'Intermediate': 3,
  'intermediate': 3,
  'Advanced': 4,
  'advanced': 4,
  'Expert': 5,
  'expert': 5,
  'Master': 6,
  'master': 6,
  'Grandmaster': 7,
  'grandmaster': 7,
  'Grandmaster Plus': 8,
  'grandmaster plus': 8,
  'grandmasterplus': 8,
  'Tool-Only': 9,
  'tool-only': 9,
  'toolonly': 9,
  'Pit Kaizo': 9,
  'pit kaizo': 9,
  'pitkaizo': 9,
  'Impossible': 10,
  'impossible': 10,
  'Bugged': 10,
  'bugged': 10,
  'Impossible/Bugged': 10,
  'impossible/bugged': 10,
  // Legacy mappings (kept for backwards compatibility, but may need correction)
  'Skilled': 3,
  'skilled': 3,
  'Hard': 3,
  'hard': 3,
  'Tool-Assisted': 8,
  'tool-assisted': 8,
  'tool assisted': 8,
};

// Map legacy_type strings to numeric levels (from DIFFICULTY_MAPPINGS.csv)
const LEGACY_TYPE_MAP = {
  'Standard: Easy': 0,
  'Intermediate Intermediate Kaizo': 4,
  'Test Type': 0,
  'Hard': 3,
  'Standard: Normal': 2,
  'Intermediate Advanced Kaizo': 4,
  'Standard: Hard': 3,
  'Standard: Very Hard': 4,
  'Kaizo: Intermediate': 4,
  'Tool-Assisted: Pit': 8,
  'Tool-Assisted: Kaizo': 8,
  'Kaizo: Expert': 5,
  'Kaizo: Beginner': 3,
  'Misc.: Troll': 4,
  'Standard: Very Hard, Kaizo: Expert': 5,
  'Kaizo: Intermediate, Standard: Very Hard': 4,
  'Standard: Hard, Kaizo: Intermediate': 4,
  'Standard: Hard, Misc.: Troll': 4,
  'Standard: Hard, Kaizo: Beginner': 3,
  'Standard: Very Hard, Kaizo: Beginner': 4,
  'Standard: Easy, Kaizo: Intermediate': 4,
  'Standard: Hard, Standard: Very Hard': 4,
  'Standard: Normal, Kaizo: Intermediate': 4,
  'Standard: Very Hard, Kaizo: Intermediate': 4,
  'Kaizo: Intermediate, Misc.: Troll': 4,
  'Standard: Normal, Misc.: Troll': 3,
  'Standard: Normal, Misc.: Puzzle': 4,
  'Intermediate Intro Kaizo': 3,
  'Intermediate': 3,
  'Joke': 2,
  'Standard, Kaizo: Advanced (diff_4) (standard, kaizo)': 4,
  'Standard: Casual (diff_2) (standard)': 2,
  'Kaizo: Expert (diff_5) (kaizo)': 5,
  'Kaizo: Advanced (diff_4) (kaizo)': 4,
  'Standard: Advanced (diff_4) (standard)': 4,
  'Standard: Newcomer (diff_1) (standard)': 1,
  'Kaizo: Master (diff_6) (kaizo)': 6,
  'Kaizo, Puzzle, Tool-Assisted: Master (diff_6) (kaizo, puzzle, tool_assisted)': 8,
  'Kaizo, Tool-Assisted: Advanced (diff_4) (kaizo, tool_assisted)': 8,
  'Competition Winner 2024': 2,
  'Standard: Skilled (diff_3) (standard)': 3,
  'Kaizo: Grandmaster (diff_7) (kaizo)': 7,
  'Classic Example - Historical': 2,
  'Tutorial Example - Keep This!': 2,
};

// Default difficulty if unknown (Intermediate = 3 per new mapping)
const DEFAULT_DIFFICULTY = 3;

/**
 * Extract numeric value from raw_difficulty string (e.g., "diff_4" -> 4)
 * @param {string} rawDifficulty - Raw difficulty string like "diff_4"
 * @returns {number|null} Numeric difficulty or null if not parseable
 */
function parseRawDifficulty(rawDifficulty) {
  if (!rawDifficulty || typeof rawDifficulty !== 'string') {
    return null;
  }
  const match = rawDifficulty.trim().match(/^diff[_\s]*(\d+)$/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Get numeric difficulty level for a game
 * @param {Object} game - Game object from database
 * @param {Function|null} dbQueryFn - Optional function to query game_difficulty_map table
 * @returns {number} Numeric difficulty level (0-10)
 */
function getGameDifficultyLevel(game, dbQueryFn = null) {
  // 1. First, try raw_difficulty (e.g., "diff_4" -> 4)
  if (game.raw_difficulty) {
    const parsed = parseRawDifficulty(game.raw_difficulty);
    if (parsed !== null) {
      return parsed;
    }
  }
  
  // 2. Try difficulty string mapping
  if (game.difficulty) {
    const difficultyStr = String(game.difficulty).trim();
    if (DIFFICULTY_STRING_MAP.hasOwnProperty(difficultyStr)) {
      return DIFFICULTY_STRING_MAP[difficultyStr];
    }
  }
  
  // 3. Try legacy_type or combinedtype via database lookup if available
  if (dbQueryFn) {
    if (game.legacy_type) {
      const legacyTypeStr = String(game.legacy_type).trim();
      const dbResult = dbQueryFn('legacytype', legacyTypeStr);
      if (dbResult !== null) {
        return dbResult;
      }
    }
    if (game.combinedtype) {
      const combinedTypeStr = String(game.combinedtype).trim();
      const dbResult = dbQueryFn('legacytype', combinedTypeStr);
      if (dbResult !== null) {
        return dbResult;
      }
    }
  }
  
  // 4. Fallback to in-memory legacy_type map
  if (game.legacy_type) {
    const legacyTypeStr = String(game.legacy_type).trim();
    if (LEGACY_TYPE_MAP.hasOwnProperty(legacyTypeStr)) {
      return LEGACY_TYPE_MAP[legacyTypeStr];
    }
  }
  
  // 5. Default to Intermediate (3) - note: changed from 2 to match new mapping
  return DEFAULT_DIFFICULTY;
}

/**
 * Check if a game's difficulty matches the filter criteria
 * @param {Object} game - Game object from database
 * @param {number|null} minDifficulty - Minimum difficulty (0-8) or null
 * @param {number|null} maxDifficulty - Maximum difficulty (0-8) or null
 * @returns {boolean} True if game matches difficulty filter
 */
function matchesDifficultyFilter(game, minDifficulty, maxDifficulty) {
  const gameDifficulty = getGameDifficultyLevel(game);
  
  // If no filters specified, match all
  if (minDifficulty === null && maxDifficulty === null) {
    return true;
  }
  
  // Check min difficulty
  if (minDifficulty !== null && gameDifficulty < minDifficulty) {
    return false;
  }
  
  // Check max difficulty
  if (maxDifficulty !== null && gameDifficulty > maxDifficulty) {
    return false;
  }
  
  return true;
}

module.exports = {
  getGameDifficultyLevel,
  matchesDifficultyFilter,
  parseRawDifficulty,
  DIFFICULTY_STRING_MAP,
  LEGACY_TYPE_MAP,
  DEFAULT_DIFFICULTY
};

