/**
 * Shared Filter Utilities for RHTools
 * 
 * Provides consistent filtering logic that can be used by both frontend (Vue.js)
 * and backend (Node.js) components for game filtering.
 */

/**
 * Parse and apply advanced filter query to a game object
 * @param {Object} game - Game object with properties like name, author, type, etc.
 * @param {string} query - Filter query string
 * @returns {boolean} - Whether the game matches the filter
 */
function matchesFilter(game, query) {
  if (!query) return true;
  
  const q = query.trim().toLowerCase();
  
  // Check for attribute:value pattern
  const attributeMatch = q.match(/^(\w+):(>|<|>=|<=)?(.+)$/);
  
  if (attributeMatch) {
    const [, attr, operator, value] = attributeMatch;
    
    // Handle rating filters with operators
    if (attr === 'rating') {
      const rating = game.publicrating ?? game.Publicrating ?? 0;
      const targetValue = parseFloat(value);
      
      if (isNaN(targetValue)) return false;
      
      if (operator === '>') return rating > targetValue;
      if (operator === '<') return rating < targetValue;
      if (operator === '>=') return rating >= targetValue;
      if (operator === '<=') return rating <= targetValue;
      return rating === targetValue;
    }
    
    // Handle version filters
    if (attr === 'version') {
      const gameVersion = game.version ?? game.CurrentVersion ?? 1;
      const targetVersion = parseInt(value);
      
      if (isNaN(targetVersion)) return false;
      
      if (operator === '>') return gameVersion > targetVersion;
      if (operator === '<') return gameVersion < targetVersion;
      if (operator === '>=') return gameVersion >= targetVersion;
      if (operator === '<=') return gameVersion <= targetVersion;
      return gameVersion === targetVersion;
    }
    
    // Handle other attribute searches
    const gameValue = getGameAttribute(game, attr);
    if (gameValue === null) return false;
    
    return gameValue.toLowerCase().includes(value.toLowerCase());
  }
  
  // Default: search across all fields
  const haystack = [
    game.gameid ?? game.Id ?? '',
    game.name ?? game.Name ?? '',
    game.combinedtype ?? game.Type ?? '',
    game.author ?? game.Author ?? '',
    game.length ?? game.Length ?? '',
    game.status ?? game.Status ?? '',
    String(game.mydifficultyrating ?? game.MyDifficultyRating ?? ''),
    String(game.myreviewrating ?? game.MyReviewRating ?? ''),
    String(game.publicrating ?? game.Publicrating ?? ''),
    String(game.mynotes ?? game.Mynotes ?? ''),
    // Include JSON data if available
    game.added ? String(game.added) : '',
    game.difficulty ? String(game.difficulty) : '',
    game.gametype ? String(game.gametype) : '',
    game.legacy_type ? String(game.legacy_type) : '',
  ].join(' ').toLowerCase();
  
  return haystack.includes(q);
}

/**
 * Get attribute value from game object (handles both frontend and backend formats)
 * @param {Object} game - Game object
 * @param {string} attr - Attribute name
 * @returns {string|null} - Attribute value or null if not found
 */
function getGameAttribute(game, attr) {
  // Direct properties (handle both frontend and backend naming conventions)
  const directProps = {
    id: game.gameid ?? game.Id,
    name: game.name ?? game.Name,
    type: game.combinedtype ?? game.Type,
    author: game.author ?? game.Author,
    length: game.length ?? game.Length,
    status: game.status ?? game.Status,
    rating: game.publicrating ?? game.Publicrating,
    notes: game.mynotes ?? game.Mynotes,
    gametype: game.gametype,
    difficulty: game.difficulty,
    added: game.added,
    version: game.version ?? game.CurrentVersion,
  };
  
  if (directProps[attr] !== undefined) {
    return String(directProps[attr] ?? '');
  }
  
  // Check JSON data attributes (for frontend format)
  if (game.JsonData && game.JsonData[attr] !== undefined) {
    return String(game.JsonData[attr]);
  }
  
  return null;
}

/**
 * Apply filter to a list of games
 * @param {Array} games - Array of game objects
 * @param {string} query - Filter query string
 * @returns {Array} - Filtered array of games
 */
function filterGames(games, query) {
  if (!query) return games;
  return games.filter(game => matchesFilter(game, query));
}

/**
 * Count games matching a filter query
 * @param {Array} games - Array of game objects
 * @param {string} query - Filter query string
 * @returns {number} - Number of matching games
 */
function countMatchingGames(games, query) {
  if (!query) return games.length;
  return games.filter(game => matchesFilter(game, query)).length;
}

module.exports = {
  matchesFilter,
  getGameAttribute,
  filterGames,
  countMatchingGames
};
