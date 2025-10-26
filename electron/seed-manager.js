/**
 * Seed Manager - Handles deterministic random game selection with seed mappings
 */

const crypto = require('crypto');

/**
 * Characters allowed in seeds (excluding confusing: 0, O, 1, l, I)
 */
const SEED_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';

/**
 * Generate a random alphanumeric string without confusing characters
 * @param {number} length - Length of string to generate
 * @returns {string} Random string
 */
function generateRandomString(length) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += SEED_CHARS[Math.floor(Math.random() * SEED_CHARS.length)];
  }
  return result;
}

/**
 * Generate a new seed mapping ID (first part of seed)
 * @returns {string} 5-character mapping ID
 */
function generateMapId() {
  return generateRandomString(5);
}

/**
 * Generate a new full seed with mapping ID and random suffix
 * @param {string} mapId - Mapping ID (5 chars)
 * @returns {string} Full seed (e.g., "A7K9M-XyZ3q")
 */
function generateSeedWithMap(mapId) {
  const suffix = generateRandomString(5);
  return `${mapId}-${suffix}`;
}

/**
 * Parse a seed into mapId and suffix
 * @param {string} seed - Full seed string
 * @returns {{mapId: string, suffix: string}}
 */
function parseSeed(seed) {
  if (!seed || seed === '*') {
    return { mapId: null, suffix: null };
  }
  
  const parts = seed.split('-');
  if (parts.length !== 2) {
    throw new Error('Invalid seed format. Expected: MAPID-SUFFIX (e.g., A7K9M-XyZ3q)');
  }
  
  return {
    mapId: parts[0],
    suffix: parts[1]
  };
}

/**
 * Get all candidate games for random selection from rhdata.db
 * @param {Object} dbManager - Database manager
 * @returns {Array} Array of {gameid, version}
 */
function getCandidateGames(dbManager) {
  const db = dbManager.getConnection('rhdata');
  
  // Attach clientdata to check user exclusions
  return dbManager.withClientData('rhdata', (db) => {
    const candidates = db.prepare(`
      SELECT gv.gameid, gv.version
      FROM gameversions gv
      LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
      WHERE gv.removed = 0
        AND gv.obsoleted = 0
        AND gv.local_runexcluded = 0
        AND (uga.exclude_from_random IS NULL OR uga.exclude_from_random = 0)
        AND gv.version = (
          SELECT MAX(version) 
          FROM gameversions gv2 
          WHERE gv2.gameid = gv.gameid
        )
      ORDER BY gv.gameid
    `).all();
    
    return candidates;
  });
}

/**
 * Create a new seed mapping from current candidate games
 * @param {Object} dbManager - Database manager
 * @returns {Object} {mapId, mappingData, gameCount}
 */
function createSeedMapping(dbManager) {
  const candidates = getCandidateGames(dbManager);
  
  // Build mapping: {gameid: version}
  const mappingObj = {};
  candidates.forEach(c => {
    mappingObj[c.gameid] = c.version;
  });
  
  const mappingData = JSON.stringify(mappingObj);
  const mapId = generateMapId();
  
  // Calculate hash for verification
  const hash = crypto.createHash('sha256').update(mappingData).digest('hex');
  
  // Save to database
  const db = dbManager.getConnection('clientdata');
  db.prepare(`
    INSERT INTO seedmappings (mapid, mappingdata, game_count, mapping_hash, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(mapId, mappingData, candidates.length, hash);
  
  console.log(`Created seed mapping ${mapId} with ${candidates.length} games`);
  
  return {
    mapId,
    mappingData,
    gameCount: candidates.length,
    hash
  };
}

/**
 * Get or create the default seed mapping (largest one)
 * @param {Object} dbManager - Database manager
 * @returns {Object} {mapId, gameCount}
 */
function getOrCreateDefaultMapping(dbManager) {
  const db = dbManager.getConnection('clientdata');
  
  // Get largest existing mapping
  const existing = db.prepare(`
    SELECT mapid, game_count 
    FROM seedmappings 
    ORDER BY game_count DESC, created_at DESC 
    LIMIT 1
  `).get();
  
  if (existing) {
    // Check if we have more games now
    const currentCandidates = getCandidateGames(dbManager);
    
    if (currentCandidates.length > existing.game_count) {
      // Create new mapping with more games
      const newMapping = createSeedMapping(dbManager);
      return { mapId: newMapping.mapId, gameCount: newMapping.gameCount };
    }
    
    return { mapId: existing.mapid, gameCount: existing.game_count };
  }
  
  // No mappings exist, create first one
  const newMapping = createSeedMapping(dbManager);
  return { mapId: newMapping.mapId, gameCount: newMapping.gameCount };
}

/**
 * Get seed mapping by mapId
 * @param {Object} dbManager - Database manager
 * @param {string} mapId - Mapping ID
 * @returns {Object|null} Mapping data or null
 */
function getSeedMapping(dbManager, mapId) {
  const db = dbManager.getConnection('clientdata');
  
  const mapping = db.prepare(`
    SELECT mapid, mappingdata, game_count, mapping_hash, created_at
    FROM seedmappings
    WHERE mapid = ?
  `).get(mapId);
  
  if (!mapping) {
    return null;
  }
  
  return {
    mapId: mapping.mapid,
    mappingData: JSON.parse(mapping.mappingdata),
    gameCount: mapping.game_count,
    hash: mapping.mapping_hash,
    createdAt: mapping.created_at
  };
}

/**
 * Select a random game deterministically based on seed and filters
 * @param {Object} params
 * @param {Object} params.dbManager - Database manager
 * @param {string} params.seed - Full seed (MAPID-SUFFIX)
 * @param {number} params.challengeIndex - Index of challenge (for uniqueness)
 * @param {string} params.filterType - Type filter (optional)
 * @param {string} params.filterDifficulty - Difficulty filter (optional)
 * @param {string} params.filterPattern - Pattern filter (optional)
 * @param {Array} params.excludeGameids - Already used gameids to exclude
 * @returns {Object} {gameid, version, name}
 */
function selectRandomGame(params) {
  const { dbManager, seed, challengeIndex, filterType, filterDifficulty, filterPattern, excludeGameids = [] } = params;
  
  // Parse seed
  const { mapId, suffix } = parseSeed(seed);
  if (!mapId || !suffix) {
    throw new Error('Invalid seed format');
  }
  
  // Get mapping
  const mapping = getSeedMapping(dbManager, mapId);
  if (!mapping) {
    throw new Error(`Seed mapping '${mapId}' not found. Please regenerate seed.`);
  }
  
  // Get list of candidate gameids from mapping
  const candidateGameids = Object.keys(mapping.mappingData);
  
  // Filter by exclude list
  const availableGameids = candidateGameids.filter(gid => !excludeGameids.includes(gid));
  
  if (availableGameids.length === 0) {
    throw new Error('No available games for random selection');
  }
  
  // Get full game data from rhdata.db and apply filters
  const db = dbManager.getConnection('rhdata');
  
  const filteredGames = dbManager.withClientData('rhdata', (db) => {
    let query = `
      SELECT gv.gameid, gv.version, gv.name, gv.combinedtype, gv.difficulty, gv.gametype, gv.legacy_type
      FROM gameversions gv
      WHERE gv.gameid IN (${availableGameids.map(() => '?').join(',')})
        AND gv.removed = 0
        AND gv.obsoleted = 0
    `;
    
    const queryParams = [...availableGameids];
    
    // Apply type filter - match either gametype OR legacy_type
    if (filterType && filterType !== '' && filterType !== 'any') {
      query += ` AND (gv.gametype = ? OR gv.legacy_type = ?)`;
      queryParams.push(filterType, filterType);
    }
    
    // Apply difficulty filter - exact match on difficulty field
    if (filterDifficulty && filterDifficulty !== '' && filterDifficulty !== 'any') {
      query += ` AND gv.difficulty = ?`;
      queryParams.push(filterDifficulty);
    }
    
    // Apply pattern filter - search name, description, and author
    if (filterPattern && filterPattern !== '') {
      query += ` AND (gv.name LIKE ? OR gv.description LIKE ? OR gv.author LIKE ?)`;
      queryParams.push(`%${filterPattern}%`, `%${filterPattern}%`, `%${filterPattern}%`);
    }
    
    const results = db.prepare(query).all(...queryParams);
    return results;
  });
  
  if (filteredGames.length === 0) {
    throw new Error('No games match the filter criteria');
  }
  
  // Use seed + challengeIndex for deterministic selection
  const seedString = `${seed}-${challengeIndex}`;
  const seedHash = crypto.createHash('sha256').update(seedString).digest();
  const randomValue = seedHash.readUInt32BE(0);
  
  // Select game deterministically
  const selectedIndex = randomValue % filteredGames.length;
  const selectedGame = filteredGames[selectedIndex];
  
  return {
    gameid: selectedGame.gameid,
    version: selectedGame.version,
    name: selectedGame.name,
    type: selectedGame.combinedtype,
    difficulty: selectedGame.difficulty
  };
}

/**
 * Get all available seed mappings
 * @param {Object} dbManager - Database manager
 * @returns {Array} Array of mapping info
 */
function getAllSeedMappings(dbManager) {
  const db = dbManager.getConnection('clientdata');
  
  const mappings = db.prepare(`
    SELECT mapid, game_count, created_at, description
    FROM seedmappings
    ORDER BY game_count DESC, created_at DESC
  `).all();
  
  return mappings;
}

/**
 * Validate a seed (check if mapping exists)
 * @param {Object} dbManager - Database manager
 * @param {string} seed - Full seed
 * @returns {boolean} True if valid
 */
function validateSeed(dbManager, seed) {
  try {
    const { mapId } = parseSeed(seed);
    if (!mapId) return false;
    
    const mapping = getSeedMapping(dbManager, mapId);
    return mapping !== null;
  } catch {
    return false;
  }
}

/**
 * Export run with seed mappings
 * @param {Object} dbManager - Database manager
 * @param {string} runUuid - Run UUID
 * @returns {Object} Export data
 */
function exportRun(dbManager, runUuid) {
  const db = dbManager.getConnection('clientdata');
  
  // Get run
  const run = db.prepare(`SELECT * FROM runs WHERE run_uuid = ?`).get(runUuid);
  if (!run) {
    throw new Error('Run not found');
  }
  
  // Get plan entries
  const planEntries = db.prepare(`
    SELECT * FROM run_plan_entries WHERE run_uuid = ? ORDER BY sequence_number
  `).all(runUuid);
  
  // Get expanded entries (actual games from run_results with filenames)
  const expandedResults = db.prepare(`
    SELECT 
      sequence_number,
      gameid,
      game_name,
      exit_number,
      stage_description,
      was_random,
      plan_entry_uuid,
      conditions,
      sfcpath
    FROM run_results
    WHERE run_uuid = ?
    ORDER BY sequence_number
  `).all(runUuid);
  
  // Generate run directory name (same logic as stageRunGames)
  const runDirName = `run-${run.run_name.replace(/[^a-zA-Z0-9_-]/g, '_')}-${runUuid.substring(0, 8)}`;
  
  // Build expandedEntries list with filenames and plan entry references
  const expandedEntries = expandedResults.map(result => {
    // Find which plan entry this belongs to
    const planEntryIndex = planEntries.findIndex(pe => pe.entry_uuid === result.plan_entry_uuid);
    
    // Generate filename (same logic as stageRunGames)
    let filename = null;
    if (result.gameid) {
      if (result.exit_number) {
        filename = `smw${result.gameid}_exit${result.exit_number}.sfc`;
      } else {
        filename = `smw${result.gameid}.sfc`;
      }
    }
    
    return {
      sequence_number: result.sequence_number,
      gameid: result.gameid,
      game_name: result.game_name,
      exit_number: result.exit_number || null,
      stage_description: result.stage_description || null,
      was_random: result.was_random === 1,
      plan_entry_index: planEntryIndex,
      run_directory: runDirName,
      filename: filename,
      sfcpath: result.sfcpath || null,  // USB2SNES path if uploaded
      conditions: result.conditions
    };
  });
  
  // Collect all seed mappings used
  const mapIds = new Set();
  planEntries.forEach(entry => {
    if (entry.filter_seed) {
      try {
        const { mapId } = parseSeed(entry.filter_seed);
        if (mapId) mapIds.add(mapId);
      } catch (e) {
        // Skip invalid seeds
      }
    }
  });
  
  // Get mapping data
  const mappings = [];
  mapIds.forEach(mapId => {
    const mapping = db.prepare(`SELECT * FROM seedmappings WHERE mapid = ?`).get(mapId);
    if (mapping) {
      mappings.push(mapping);
    }
  });
  
  return {
    version: 1,
    exportDate: new Date().toISOString(),
    run,
    planEntries,
    expandedEntries,  // NEW: List of actual games in order with filenames
    seedMappings: mappings
  };
}

/**
 * Import run with seed mappings
 * @param {Object} dbManager - Database manager
 * @param {Object} importData - Export data
 * @returns {Object} {success, error, warnings}
 */
function importRun(dbManager, importData) {
  const db = dbManager.getConnection('clientdata');
  const warnings = [];
  
  try {
    // Validate seed mappings first
    for (const mapping of importData.seedMappings || []) {
      // Check if we have all the gameids/versions referenced
      const mappingData = JSON.parse(mapping.mappingdata);
      
      const rhdb = dbManager.getConnection('rhdata');
      for (const [gameid, version] of Object.entries(mappingData)) {
        const exists = rhdb.prepare(`
          SELECT 1 FROM gameversions WHERE gameid = ? AND version = ?
        `).get(gameid, version);
        
        if (!exists) {
          warnings.push(`Missing game ${gameid} version ${version} referenced in mapping ${mapping.mapid}`);
          // Don't import incompatible mappings
          return { 
            success: false, 
            error: `Incompatible seed mapping: Missing games/versions. Cannot import.`,
            warnings 
          };
        }
      }
      
      // Import mapping if not already exists
      const existingMapping = db.prepare(`SELECT 1 FROM seedmappings WHERE mapid = ?`).get(mapping.mapid);
      if (!existingMapping) {
        db.prepare(`
          INSERT INTO seedmappings (mapid, mappingdata, game_count, mapping_hash, created_at, description)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          mapping.mapid,
          mapping.mappingdata,
          mapping.game_count,
          mapping.mapping_hash,
          mapping.created_at,
          `Imported mapping - ${mapping.description || 'No description'}`
        );
      } else {
        warnings.push(`Mapping ${mapping.mapid} already exists (skipped)`);
      }
    }
    
    // Import run (generate new UUID to avoid conflicts)
    const newRunUuid = crypto.randomUUID();
    const run = importData.run;
    
    db.prepare(`
      INSERT INTO runs (run_uuid, run_name, run_description, status, global_conditions, config_json)
      VALUES (?, ?, ?, 'preparing', ?, ?)
    `).run(
      newRunUuid,
      run.run_name + ' (Imported)',
      run.run_description,
      run.global_conditions,
      run.config_json
    );
    
    // Import plan entries
    importData.planEntries.forEach((entry, idx) => {
      const newEntryUuid = crypto.randomUUID();
      
      db.prepare(`
        INSERT INTO run_plan_entries
          (entry_uuid, run_uuid, sequence_number, entry_type, gameid, exit_number,
           count, filter_difficulty, filter_type, filter_pattern, filter_seed, conditions, entry_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newEntryUuid,
        newRunUuid,
        idx + 1,
        entry.entry_type,
        entry.gameid,
        entry.exit_number,
        entry.count,
        entry.filter_difficulty,
        entry.filter_type,
        entry.filter_pattern,
        entry.filter_seed,
        entry.conditions,
        entry.entry_notes
      );
    });
    
    return { 
      success: true, 
      runUuid: newRunUuid,
      warnings 
    };
  } catch (error) {
    return { 
      success: false, 
      error: error.message,
      warnings 
    };
  }
}

module.exports = {
  generateMapId,
  generateSeedWithMap,
  generateRandomString,
  parseSeed,
  getCandidateGames,
  createSeedMapping,
  getOrCreateDefaultMapping,
  getSeedMapping,
  selectRandomGame,
  getAllSeedMappings,
  validateSeed,
  exportRun,
  importRun,
  SEED_CHARS
};

