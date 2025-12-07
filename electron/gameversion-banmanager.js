/**
 * GameVersion Ban Manager
 * 
 * Manages bans on gameversions based on various criteria and actions (senses).
 * Supports both hardcoded bans and database-stored bans.
 */

const { v4: uuidv4 } = require('uuid');

// Hardcoded ban entries (evaluated before database entries)
const HARDCODED_BANS = [
  { gameid: '19571', 
    match_column: 'gameid',
    match_pattern: 'exact:19571',
    sense: 'image_title,run_random_*,check_random,image_show_soft,details_soft',
    required_acknowledgments: 'Mature_Content,Suggestive_Content,Crude_Content_or_Language,Sexual_Content',
    starting_at: null,
    warningtext: 'Super Fart World: Crude/Sexual',
    reason: 'Contains cartoon butt images.',
    sequence_no: 0,
    active: 1 },
  { gameid: null,
    match_column: 'gameid',
    match_pattern: 'exact:41022',
    sense: 'run_random_*,check_random',
    required_acknowledgments: '',
    starting_at: null,
    reason: 'Game excluded from random run feature',
    warningtext: 'Game excluded from random run feature',
    sequence_no: 2,
    active: 1
  },
  { gameid: '16058',
    match_column: 'gameid',
    match_pattern: 'exact:16058',
    sense: 'run_random_*,check_random',
    required_acknowledgments: '',
    starting_at: null,
    reason: 'Game is too diabolical for the random run feature.',
    warningtext: 'Game is too diabolical for the random run feature.',
    sequence_no: 2,
    active: 1
  },
  { gameid: '16059',
    match_column: 'gameid',
    match_pattern: 'exact:16059',
    sense: 'run_random_*,check_random',
    required_acknowledgments: '',
    starting_at: null,
    reason: 'Game is too diabolical for the random run feature.',
    warningtext: 'Game is too diabolical for the random run feature.',
    sequence_no: 2,
    active: 1
  },
  { gameid: null,
    match_column: 'author',
    match_pattern: 'regex:/^(NaroGugul|levelengine)/',
    sense: 'run_random_*,check_random',
    required_acknowledgments: '',
    starting_at: null,
    reason: 'Author excluded from random run feature',
    warningtext: 'Author excluded from random run feature',
    sequence_no: 2,
    active: 1
  },
  {
     gameid: 40470,
    match_column: 'gameid',
    match_pattern: 'exact:40470',
    sense: 'run_random_*',
    required_acknowledgments: '',
    starting_at: null,
    warningtext: 'Missing patch data',
    reason: 'Missing patch data',
    sequence_no: 0,
    active: 1 
  }

  // Example structure:
  // {
  //   gameid: '12345',
  //   match_column: 'gameid',
  //   match_pattern: 'exact:12345',
  //   sense: 'list_any,details_hard',
  //   required_acknowledgments: 'Mature_Content*',
  //   starting_at: null,
  //   reason: 'Example ban',
  //   warningtext: 'This game is banned',
  //   sequence_no: 0,
  //   active: 1
  // }
];

/**
 * Parse sense string into individual sense actions
 * Supports wildcards like "run_random_*"
 * @param {string} senseStr - Comma-separated sense string
 * @param {string} action - Action to check
 * @returns {boolean} True if action matches sense
 */
function matchesSense(senseStr, action) {
  if (!senseStr) return false;
  
  const senses = senseStr.split(',').map(s => s.trim().toLowerCase());
  const actionLower = action.toLowerCase();
  
  for (const sense of senses) {
    // Exact match
    if (sense === actionLower) {
      return true;
    }
    
    // Wildcard match (e.g., "run_random_*" matches "run_random_game", "run_random_stage")
    if (sense.endsWith('*')) {
      const prefix = sense.slice(0, -1);
      if (actionLower.startsWith(prefix)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Parse match pattern and check if value matches
 * @param {string} pattern - Match pattern (exact:, substring:, regex:, or comma-separated list)
 * @param {string} value - Value to match against
 * @returns {boolean} True if value matches pattern
 */
function matchesPattern(pattern, value) {
  if (!pattern || !value) return false;
  
  const patternLower = pattern.toLowerCase();
  const valueLower = String(value).toLowerCase();
  
  // Comma-separated list match (e.g., "a,b,c,d")
  if (pattern.includes(',') && !pattern.startsWith('exact:') && !pattern.startsWith('substring:') && !pattern.startsWith('regex:')) {
    const items = pattern.split(',').map(s => s.trim().toLowerCase());
    return items.includes(valueLower);
  }
  
  // Exact match
  if (patternLower.startsWith('exact:')) {
    const exactValue = pattern.slice(6).trim().toLowerCase();
    return valueLower === exactValue;
  }
  
  // Substring match
  if (patternLower.startsWith('substring:')) {
    const substring = pattern.slice(10).trim().toLowerCase();
    return valueLower.includes(substring);
  }
  
  // Regex match
  if (patternLower.startsWith('regex:')) {
    try {
      const regexStr = pattern.slice(6).trim();
      // Remove leading/trailing slashes if present
      const cleanRegex = regexStr.replace(/^\/|\/$/g, '');
      const regex = new RegExp(cleanRegex, 'i');
      return regex.test(value);
    } catch (error) {
      console.warn(`[BanManager] Invalid regex pattern: ${pattern}`, error);
      return false;
    }
  }
  
  // Default: exact match
  return valueLower === patternLower;
}

/**
 * Check if a game matches ban criteria
 * @param {Object} ban - Ban entry
 * @param {Object} game - Game object with gameid, gvuuid, author, tags, url, name
 * @returns {boolean} True if game matches ban
 */
function gameMatchesBan(ban, game) {
  if (!ban.active || ban.active !== 1) {
    return false;
  }
  
  // Check starting_at timestamp
  if (ban.starting_at) {
    const startTime = new Date(ban.starting_at).getTime();
    const now = Date.now();
    if (startTime > now) {
      return false; // Ban not yet active
    }
  }
  
  const matchColumn = ban.match_column;
  const matchPattern = ban.match_pattern;
  
  // Get value to match based on match_column
  let valueToMatch = null;
  switch (matchColumn) {
    case 'gameid':
      // Ensure gameid is converted to string for consistent matching
      valueToMatch = String(game.gameid || game.Id || '');
      break;
    case 'gvuuid':
      valueToMatch = game.gvuuid;
      break;
    case 'author':
      valueToMatch = game.author || game.Author;
      break;
    case 'tags':
      // Tags might be a string, array, or JSON string
      if (Array.isArray(game.tags)) {
        valueToMatch = game.tags.join(',');
      } else if (typeof game.tags === 'string') {
        try {
          const parsed = JSON.parse(game.tags);
          if (Array.isArray(parsed)) {
            valueToMatch = parsed.join(',');
          } else {
            valueToMatch = game.tags;
          }
        } catch {
          valueToMatch = game.tags;
        }
      } else {
        valueToMatch = game.tags || game.Tags || '';
      }
      break;
    case 'url':
      valueToMatch = game.url || game.download_url;
      break;
    case 'name':
      valueToMatch = game.name || game.Name;
      break;
    default:
      return false;
  }
  
  if (valueToMatch === null || valueToMatch === undefined) {
    return false;
  }
  
  return matchesPattern(matchPattern, valueToMatch);
}

/**
 * Get computed column value based on sense string
 * @param {string} sense - Comma-separated sense string
 * @param {string} columnName - Column name to check
 * @returns {number} 1 if sense matches column, 0 otherwise
 */
function getComputedColumn(sense, columnName) {
  if (!sense) return 0;
  
  const senses = sense.split(',').map(s => s.trim().toLowerCase());
  const columnLower = columnName.toLowerCase();
  
  // Check for exact match
  if (senses.includes(columnLower)) {
    return 1;
  }
  
  // Check for wildcard match (e.g., "run_random_*" matches "run_random_game")
  for (const senseItem of senses) {
    if (senseItem.endsWith('*')) {
      const prefix = senseItem.slice(0, -1);
      if (columnLower.startsWith(prefix)) {
        return 1;
      }
    }
  }
  
  return 0;
}

/**
 * GameVersion Ban Manager Class
 */
class GameVersionBanManager {
  constructor(dbManager) {
    this.dbManager = dbManager;
    this.db = null;
    this.cache = {
      bans: null,
      lastUpdate: 0,
      cacheTimeout: 60000 // 1 minute cache
    };
  }
  
  /**
   * Get database connection
   */
  getDb() {
    if (!this.db) {
      this.db = this.dbManager.getConnection('rhdata');
    }
    return this.db;
  }
  
  /**
   * Load all active bans from database
   * @returns {Array} Array of ban entries
   */
  loadDatabaseBans() {
    try {
      const db = this.getDb();
      const now = new Date().toISOString();
      
      const bans = db.prepare(`
        SELECT 
          banuuid,
          gameid,
          match_column,
          match_pattern,
          sense,
          required_acknowledgments,
          starting_at,
          reason,
          warningtext,
          sequence_no,
          active
        FROM gameversion_banlist
        WHERE active = 1
          AND (starting_at IS NULL OR starting_at <= ?)
        ORDER BY sequence_no ASC, created_at ASC
      `).all(now);
      
      return bans;
    } catch (error) {
      console.error('[BanManager] Error loading database bans:', error);
      return [];
    }
  }
  
  /**
   * Get all bans (hardcoded + database) with caching
   * @returns {Array} Array of all ban entries
   */
  getAllBans() {
    const now = Date.now();
    
    // Return cached bans if still valid
    if (this.cache.bans && (now - this.cache.lastUpdate) < this.cache.cacheTimeout) {
      return this.cache.bans;
    }
    
    // Load database bans
    const databaseBans = this.loadDatabaseBans();
    
    // Combine hardcoded (sequence_no 0, evaluated first) and database bans
    const allBans = [
      ...HARDCODED_BANS.filter(b => b.active === 1),
      ...databaseBans
    ];
    
    // Sort by sequence_no (hardcoded are always first)
    allBans.sort((a, b) => {
      const seqA = a.sequence_no || 0;
      const seqB = b.sequence_no || 0;
      if (seqA !== seqB) {
        return seqA - seqB;
      }
      // Same sequence_no: hardcoded first, then by created_at
      const isHardcodedA = !a.banuuid;
      const isHardcodedB = !b.banuuid;
      if (isHardcodedA && !isHardcodedB) return -1;
      if (!isHardcodedA && isHardcodedB) return 1;
      return 0;
    });
    
    // Update cache
    this.cache.bans = allBans;
    this.cache.lastUpdate = now;
    
    return allBans;
  }
  
  /**
   * Find matching ban for a game and action
   * @param {Object} game - Game object
   * @param {string} action - Action/sense to check
   * @returns {Object|null} Matching ban entry or null
   */
  findMatchingBan(game, action) {
    const allBans = this.getAllBans();

    if (action == null) {
	    action = '';
    }
    
    for (const ban of allBans) {
      if (gameMatchesBan(ban, game)) {
        if ( action == '' || matchesSense(ban.sense, action) ) {
            return ban;
	}
      }
    }
    
    return null;
  }
  
  /**
   * Check if a game is banned for a specific action
   * @param {string} gameid - Game ID
   * @param {string} action - Action to check (e.g., 'image_preview', 'list_any')
   * @param {Object} gameData - Optional full game object for matching on other fields
   * @returns {boolean} True if game is banned for this action
   */
  isGameBanned(gameid, action, gameData = null) {
    // If we have full game data, use it; otherwise construct minimal game object
    const game = gameData || { gameid, Id: gameid };
    
    const ban = this.findMatchingBan(game, action);
    return ban !== null;
  }
  
  /**
   * Get ban details for a game and action
   * @param {string} gameid - Game ID
   * @param {string} action - Action to check
   * @param {Object} gameData - Optional full game object
   * @returns {Object|null} Ban details or null
   */
  getBanDetails(gameid, action, gameData = null) {
    const game = gameData || { gameid, Id: gameid };
    return this.findMatchingBan(game, action);
  }
  
  /**
   * Get list of banned gameids for a specific action
   * @param {string} action - Action to check
   * @returns {Array<string>} Array of banned gameids
   */
  getBannedList(action) {
    try {
      const db = this.getDb();
      const allBans = this.getAllBans();
      const bannedGameids = new Set();
      
      // Get all games from gameversions table
      const games = db.prepare(`
        SELECT gameid, gvuuid, author, tags, url, name
        FROM gameversions
        WHERE removed = 0 AND obsoleted = 0
      `).all();
      
      // Check each game against all bans
      for (const game of games) {
        for (const ban of allBans) {
          if (gameMatchesBan(ban, game) && matchesSense(ban.sense, action)) {
            bannedGameids.add(game.gameid);
            break; // Found a match, no need to check other bans for this game
          }
        }
      }
      
      return Array.from(bannedGameids);
    } catch (error) {
      console.error('[BanManager] Error getting banned list:', error);
      return [];
    }
  }
  
  /**
   * Get computed column value for a ban
   * @param {Object} ban - Ban entry
   * @param {string} columnName - Column name
   * @returns {number} 1 or 0
   */
  getComputedColumn(ban, columnName) {
    return getComputedColumn(ban.sense, columnName);
  }
  
  /**
   * Invalidate cache (call after adding/updating/deleting bans)
   */
  invalidateCache() {
    this.cache.bans = null;
    this.cache.lastUpdate = 0;
  }
  
  /**
   * Add a ban to the database
   * @param {Object} banData - Ban data
   * @returns {string} banuuid of created ban
   */
  addBan(banData) {
    try {
      const db = this.getDb();
      const banuuid = uuidv4();
      
      db.prepare(`
        INSERT INTO gameversion_banlist (
          banuuid, gameid, match_column, match_pattern, sense,
          required_acknowledgments, starting_at, reason, warningtext,
          sequence_no, active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        banuuid,
        banData.gameid || null,
        banData.match_column,
        banData.match_pattern,
        banData.sense,
        banData.required_acknowledgments || null,
        banData.starting_at || null,
        banData.reason || null,
        banData.warningtext || null,
        banData.sequence_no || 0,
        banData.active !== undefined ? banData.active : 1
      );
      
      this.invalidateCache();
      return banuuid;
    } catch (error) {
      console.error('[BanManager] Error adding ban:', error);
      throw error;
    }
  }
  
  /**
   * Update a ban in the database
   * @param {string} banuuid - Ban UUID
   * @param {Object} banData - Updated ban data
   */
  updateBan(banuuid, banData) {
    try {
      const db = this.getDb();
      const updates = [];
      const values = [];
      
      const allowedFields = [
        'gameid', 'match_column', 'match_pattern', 'sense',
        'required_acknowledgments', 'starting_at', 'reason', 'warningtext',
        'sequence_no', 'active'
      ];
      
      for (const field of allowedFields) {
        if (banData.hasOwnProperty(field)) {
          updates.push(`${field} = ?`);
          values.push(banData[field]);
        }
      }
      
      if (updates.length === 0) {
        return; // No updates
      }
      
      values.push(banuuid);
      
      db.prepare(`
        UPDATE gameversion_banlist
        SET ${updates.join(', ')}
        WHERE banuuid = ?
      `).run(...values);
      
      this.invalidateCache();
    } catch (error) {
      console.error('[BanManager] Error updating ban:', error);
      throw error;
    }
  }
  
  /**
   * Delete a ban from the database
   * @param {string} banuuid - Ban UUID
   */
  deleteBan(banuuid) {
    try {
      const db = this.getDb();
      db.prepare('DELETE FROM gameversion_banlist WHERE banuuid = ?').run(banuuid);
      this.invalidateCache();
    } catch (error) {
      console.error('[BanManager] Error deleting ban:', error);
      throw error;
    }
  }
}

module.exports = GameVersionBanManager;

