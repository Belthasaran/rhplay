/**
 * Seed Manager - Handles deterministic random game selection with seed mappings
 */

const crypto = require('crypto');
const { normalizeRunType } = require('./shared/run-types');
const { matchesFilter } = require('./shared-filter-utils');
const GameVersionBanManager = require('./gameversion-banmanager');
const {
  buildFeedbackTripletMap,
  filterStagesByTestState,
} = require('./stage-test-resolution');

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
  const { dbManager, seed, challengeIndex, filterType, filterDifficulty, filterPattern, minDifficulty, maxDifficulty, excludeGameids = [] } = params;
  
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
  
  // Get full game data from rhdata.db and apply basic filters
  const db = dbManager.getConnection('rhdata');
  
  const basicFilteredGames = dbManager.withClientData('rhdata', (db) => {
    let query = `
      SELECT gv.gameid, gv.version, gv.name, gv.combinedtype, gv.difficulty, gv.gametype, gv.legacy_type, gv.author, gv.length, gv.description, gv.demo, gv.featured, gv.obsoleted, gv.removed, gv.moderated, gvs.rating_value
      FROM gameversions gv
      LEFT JOIN gameversion_stats gvs ON gv.gameid = gvs.gameid
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
    
    // Note: Legacy filterDifficulty is kept for backwards compatibility but ignored if minDifficulty/maxDifficulty are provided
    
    const results = db.prepare(query).all(...queryParams);
    return results;
  });
  
  // Apply difficulty filter using numeric difficulty mapping
  let filteredGames = basicFilteredGames;
  
  // If minDifficulty or maxDifficulty are provided, use numeric filtering
  if (minDifficulty !== null && minDifficulty !== undefined || maxDifficulty !== null && maxDifficulty !== undefined) {
    const { matchesDifficultyFilter } = require('./utils/difficulty-mapper');
    filteredGames = filteredGames.filter(game => 
      matchesDifficultyFilter(game, minDifficulty, maxDifficulty)
    );
  } else if (filterDifficulty && filterDifficulty !== '' && filterDifficulty !== 'any') {
    // Legacy behavior: exact match on difficulty string
    filteredGames = filteredGames.filter(game => 
      game.difficulty === filterDifficulty
    );
  }
  
  // Apply advanced pattern filter using shared filter logic
  let finalFilteredGames = filterPattern && filterPattern !== '' 
    ? filteredGames.filter(game => matchesFilter(game, filterPattern))
    : filteredGames;
  
  // Apply ban filter - exclude games banned from random game selection
  const banManager = new GameVersionBanManager(dbManager);
  finalFilteredGames = finalFilteredGames.filter(game => {
    return !banManager.isGameBanned(game.gameid, 'run_random_game', game);
  });
  
  if (finalFilteredGames.length === 0) {
    throw new Error('No games match the filter criteria');
  }
  
  // Use seed + challengeIndex for deterministic selection
  const seedString = `${seed}-${challengeIndex}`;
  const seedHash = crypto.createHash('sha256').update(seedString).digest();
  const randomValue = seedHash.readUInt32BE(0);
  
  // Select game deterministically
  const selectedIndex = randomValue % finalFilteredGames.length;
  const selectedGame = finalFilteredGames[selectedIndex];
  
  return {
    gameid: selectedGame.gameid,
    version: selectedGame.version,
    name: selectedGame.name,
    type: selectedGame.combinedtype,
    difficulty: selectedGame.difficulty
  };
}

/**
 * Select a random stage deterministically based on seed and filters
 * @param {Object} params
 * @param {Object} params.dbManager - Database manager
 * @param {string} params.seed - Full seed (MAPID-SUFFIX)
 * @param {number} params.challengeIndex - Index of challenge (for uniqueness)
 * @param {string} params.filterType - Game type filter (optional)
 * @param {string} params.filterDifficulty - Game difficulty filter (optional)
 * @param {string} params.filterPattern - Game pattern filter (optional)
 * @param {number} params.stageMinDifficulty - Stage min difficulty (0-9, optional)
 * @param {number} params.stageMaxDifficulty - Stage max difficulty (0-9, optional)
 * @param {Array} params.stageIncludeFlags - Array of flag codes to include (optional)
 * @param {Array} params.stageExcludeFlags - Array of flag codes to exclude (optional)
 * @param {Array} params.excludeGameids - Already used gameids to exclude (optional)
 * @param {Array} params.excludeStageUuids - Already used stage UUIDs to exclude (optional)
 * @returns {Object} {stage_uuid, gameid, version, gameName, levelnumber, translevel_13bf, levelname}
 */
function selectRandomStage(params) {
  const {
    dbManager,
    seed,
    challengeIndex,
    filterType,
    filterDifficulty,
    filterPattern,
    stageMinDifficulty,
    stageMaxDifficulty,
    stageIncludeFlags,
    stageExcludeFlags,
    stageIncludeAnyOfFlags,
    stageExcludeOnlyFlags,
    stageHasTags,
    stageExcludeTags,
    stageIncludeUntested,
    stageUntestedOnly,
    excludeGameids = [],
    excludeStageUuids = []
  } = params;
  
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
  
  // First, get all games matching game filters (same logic as selectRandomGame)
  const db = dbManager.getConnection('rhdata');
  
  // Get list of candidate gameids from mapping
  const candidateGameids = Object.keys(mapping.mappingData);
  
  // Filter by exclude list
  const availableGameids = candidateGameids.filter(gid => !excludeGameids.includes(gid));
  
  if (availableGameids.length === 0) {
    throw new Error('No available games for random stage selection');
  }
  
  // Get full game data from rhdata.db and apply basic filters
  const basicFilteredGames = dbManager.withClientData('rhdata', (db) => {
    let query = `
      SELECT gv.gameid, gv.version, gv.name, gv.combinedtype, gv.difficulty, gv.gametype, gv.legacy_type, gv.author, gv.length, gv.description, gv.demo, gv.featured, gv.obsoleted, gv.removed, gv.moderated, gvs.rating_value
      FROM gameversions gv
      LEFT JOIN gameversion_stats gvs ON gv.gameid = gvs.gameid
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
    
    const results = db.prepare(query).all(...queryParams);
    return results;
  });
  
  // Apply advanced pattern filter using shared filter logic
  let finalFilteredGames = filterPattern && filterPattern !== '' 
    ? basicFilteredGames.filter(game => matchesFilter(game, filterPattern))
    : basicFilteredGames;
  
  // Apply ban filter - exclude games banned from random stage selection
  // Also exclude games banned from random game selection (since stages come from games)
  const banManager = new GameVersionBanManager(dbManager);
  finalFilteredGames = finalFilteredGames.filter(game => {
    // Exclude if banned from random game selection
    if (banManager.isGameBanned(game.gameid, 'run_random_game', game)) {
      return false;
    }
    // Exclude if banned from random stage selection
    if (banManager.isGameBanned(game.gameid, 'run_random_stage', game)) {
      return false;
    }
    return true;
  });
  
  if (finalFilteredGames.length === 0) {
    throw new Error('No games match the filter criteria');
  }
  
  // Get all stages for matching games
  const gameids = finalFilteredGames.map(g => g.gameid);
  const placeholders = gameids.map(() => '?').join(',');
  
  let stageQuery = `
    SELECT gs.*, gv.version, gv.name as game_name
    FROM gamestages gs
    INNER JOIN gameversions gv ON gs.gameid = gv.gameid
    WHERE gs.gameid IN (${placeholders})
      AND gs.playable = 1
      AND gs.rando = 1
      AND gs.difficulty >= 0
      AND gs.difficulty <= 9
  `;
  const stageQueryParams = [...gameids];
  
  // Filter out excluded stage UUIDs
  if (excludeStageUuids && excludeStageUuids.length > 0) {
    const excludePlaceholders = excludeStageUuids.map(() => '?').join(',');
    stageQuery += ` AND gs.stage_uuid NOT IN (${excludePlaceholders})`;
    stageQueryParams.push(...excludeStageUuids);
  }
  
  // Apply stage difficulty filters
  // Note: When minDifficulty is null, difficulty 0 is allowed (user explicitly set to "Any")
  if (stageMinDifficulty !== null && stageMinDifficulty !== undefined) {
    stageQuery += ` AND gs.difficulty >= ?`;
    stageQueryParams.push(stageMinDifficulty);
  }
  // If minDifficulty is null, we don't add a filter, so difficulty 0 is allowed
  
  if (stageMaxDifficulty !== null && stageMaxDifficulty !== undefined) {
    stageQuery += ` AND gs.difficulty <= ?`;
    stageQueryParams.push(stageMaxDifficulty);
  }
  
  const allStages = db.prepare(stageQuery).all(...stageQueryParams);
  
  // Filter by include/exclude flags
  let filteredStages = allStages;
  
  // Helper function to check if a stage has a specific flag
  const hasFlag = (stage, flag) => {
    switch (flag) {
      case 'M': return stage.mainexit === 1;
      case 'K': return stage.keyhole === 1;
      case 'W': return stage.water === 1;
      case 'G': return stage.ghouse === 1;
      case 'S': return stage.spalace === 1;
      case 'Ca': return stage.castle === 1;
      case 'Bo': return stage.boss === 1;
      default: return false;
    }
  };
  
  // Apply MustInclude flags (stages must have ALL of the included flags)
  if (stageIncludeFlags && Array.isArray(stageIncludeFlags) && stageIncludeFlags.length > 0) {
    filteredStages = filteredStages.filter(stage => {
      // Check if stage has ALL of the included flags
      return stageIncludeFlags.every(flag => hasFlag(stage, flag));
    });
  }
  
  // Apply Exclude flags (stages must NOT have ANY of the excluded flags)
  if (stageExcludeFlags && Array.isArray(stageExcludeFlags) && stageExcludeFlags.length > 0) {
    filteredStages = filteredStages.filter(stage => {
      // Check if stage has none of the excluded flags
      return !stageExcludeFlags.some(flag => hasFlag(stage, flag));
    });
  }
  
  // Apply IncludeAnyOf flags (stages must have at least ONE of the included flags)
  if (stageIncludeAnyOfFlags && Array.isArray(stageIncludeAnyOfFlags) && stageIncludeAnyOfFlags.length > 0) {
    filteredStages = filteredStages.filter(stage => {
      // Check if stage has at least one of the included flags
      return stageIncludeAnyOfFlags.some(flag => hasFlag(stage, flag));
    });
  }
  
  // Apply ExcludeOnly flags (stages must have ALL of the excluded flags to be excluded)
  if (stageExcludeOnlyFlags && Array.isArray(stageExcludeOnlyFlags) && stageExcludeOnlyFlags.length > 0) {
    filteredStages = filteredStages.filter(stage => {
      // Check if stage has ALL of the excluded flags (if so, exclude it)
      return !stageExcludeOnlyFlags.every(flag => hasFlag(stage, flag));
    });
  }
  
  // Helper function to parse comma-separated tags
  const parseStageTags = (stagetags) => {
    if (!stagetags || typeof stagetags !== 'string') return [];
    return stagetags.split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);
  };
  
  // Apply Has Tags filter (stages must have ALL of the selected tags)
  if (stageHasTags && Array.isArray(stageHasTags) && stageHasTags.length > 0) {
    filteredStages = filteredStages.filter(stage => {
      const stageTags = parseStageTags(stage.stagetags);
      // Check if stage has ALL of the required tags
      return stageHasTags.every(requiredTag => stageTags.includes(requiredTag));
    });
  }
  
  // Apply Exclude Tags filter (stages with ANY of the excluded tags are excluded)
  if (stageExcludeTags && Array.isArray(stageExcludeTags) && stageExcludeTags.length > 0) {
    filteredStages = filteredStages.filter(stage => {
      const stageTags = parseStageTags(stage.stagetags);
      // Check if stage has none of the excluded tags
      return !stageExcludeTags.some(excludedTag => stageTags.includes(excludedTag));
    });
  }
  
  // Filter out stages that exclude any global patch codes
  // Get global patch codes from params (passed from expand-and-prepare)
  // Note: globalPatchCodes is not destructured above, so we access it from params
  // Create a copy to avoid any const assignment issues
  const activeGlobalPatchCodes = Array.isArray(params.globalPatchCodes) ? [...params.globalPatchCodes] : [];
  if (activeGlobalPatchCodes.length > 0) {
    // Get patch conflict information for declarative tag checking
    const rhdb = dbManager.getConnection('rhdata');
    const patchConflictMap = new Map(); // Map patch_code -> conflicts array
    
    for (const patchCode of activeGlobalPatchCodes) {
      const patch = rhdb.prepare(`
        SELECT conflicts FROM extrapatches WHERE patch_code = ?
      `).get(patchCode);
      
      if (patch && patch.conflicts) {
        try {
          const conflicts = JSON.parse(patch.conflicts);
          if (Array.isArray(conflicts)) {
            patchConflictMap.set(patchCode, conflicts);
          }
        } catch (e) {
          console.warn(`Error parsing conflicts for patch ${patchCode}:`, e);
        }
      }
    }
    
    filteredStages = filteredStages.filter(stage => {
      // Check if stage has excluded_patchcodes
      if (!stage.excluded_patchcodes) {
        return true; // No exclusions, stage is valid
      }
      
      try {
        const excluded = JSON.parse(stage.excluded_patchcodes);
        if (!Array.isArray(excluded)) {
          return true; // Invalid format, allow stage
        }
        
        // Check if any global patch code conflicts with stage's excluded list
        const hasConflict = activeGlobalPatchCodes.some(patchCode => {
          // Check for exact patch code match in excluded list
          if (excluded.includes(patchCode)) {
            return true;
          }
          
          // Check for declarative tag conflicts
          // If patch has conflicts that include a tag in the stage's excluded list, exclude the stage
          const patchConflicts = patchConflictMap.get(patchCode) || [];
          const hasTagConflict = patchConflicts.some(conflictTag => {
            return excluded.includes(conflictTag);
          });
          
          return hasTagConflict;
        });
        
        return !hasConflict; // Exclude stage if there's a conflict
      } catch (e) {
        console.warn('Error parsing excluded_patchcodes for stage:', e);
        return true; // Invalid JSON, allow stage
      }
    });
  }

  const clientdataDb = dbManager.getConnection('clientdata');
  const gameidsForFeedback = [...new Set(filteredStages.map((s) => s.gameid))];
  let feedbackMap = new Map();
  if (gameidsForFeedback.length > 0) {
    const placeholdersFb = gameidsForFeedback.map(() => '?').join(',');
    const feedbackRows = clientdataDb.prepare(`
      SELECT * FROM stage_feedback WHERE gameid IN (${placeholdersFb})
    `).all(...gameidsForFeedback);
    feedbackMap = buildFeedbackTripletMap(feedbackRows);
  }

  filteredStages = filterStagesByTestState(filteredStages, feedbackMap, {
    includeUntestedStages: stageIncludeUntested === true || stageIncludeUntested === 1,
    untestedStagesOnly: stageUntestedOnly === true || stageUntestedOnly === 1,
  });
  
  if (filteredStages.length === 0) {
    throw new Error('No stages match the filter criteria');
  }
  
  // Use seed + challengeIndex for deterministic selection
  const seedString = `${seed}-${challengeIndex}`;
  const seedHash = crypto.createHash('sha256').update(seedString).digest();
  const randomValue = seedHash.readUInt32BE(0);
  
  // Select stage deterministically
  const selectedIndex = randomValue % filteredStages.length;
  const selectedStage = filteredStages[selectedIndex];
  
  return {
    stage_uuid: selectedStage.stage_uuid,
    gameid: selectedStage.gameid,
    version: selectedStage.version,
    gameName: selectedStage.game_name,
    levelnumber: selectedStage.levelnumber || '',
    translevel_13bf: selectedStage.translevel_13bf || '',
    levelname: selectedStage.levelname || ''
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
  // Join with plan_entries to get entry_type
  const expandedResults = db.prepare(`
    SELECT 
      rr.sequence_number,
      rr.gameid,
      rr.game_name,
      rr.exit_number,
      rr.stage_description,
      rr.was_random,
      rr.plan_entry_uuid,
      rr.conditions,
      rr.sfcpath,
      rr.levelnumber,
      rr.translevel,
      rr.levelname,
      rr.prerequisites_json,
      rpe.entry_type
    FROM run_results rr
    LEFT JOIN run_plan_entries rpe ON rr.plan_entry_uuid = rpe.entry_uuid
    WHERE rr.run_uuid = ?
    ORDER BY rr.sequence_number
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
      if (result.levelnumber) {
        // Stage entry: use levelnumber in filename
        filename = `smw${result.gameid}_gl${result.levelnumber}.sfc`;
      } else if (result.exit_number) {
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
      conditions: result.conditions,
      entry_type: result.entry_type || null,  // Include entry_type from plan entry
      levelnumber: result.levelnumber || null,
      translevel: result.translevel || null,
      levelname: result.levelname || null,
      prerequisites_json: result.prerequisites_json || null,
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
      INSERT INTO runs (run_uuid, run_name, run_description, status, global_conditions, config_json, run_type)
      VALUES (?, ?, ?, 'preparing', ?, ?, ?)
    `).run(
      newRunUuid,
      run.run_name + ' (Imported)',
      run.run_description,
      run.global_conditions,
      run.config_json,
      normalizeRunType(run.run_type)
    );
    
    // Import plan entries
    importData.planEntries.forEach((entry, idx) => {
      const newEntryUuid = crypto.randomUUID();
      
      db.prepare(`
        INSERT INTO run_plan_entries
          (entry_uuid, run_uuid, sequence_number, entry_type, gameid, exit_number,
           count, filter_difficulty, filter_type, filter_pattern, filter_seed, conditions, entry_notes,
           trans_level, stage_filter_min_difficulty, stage_filter_max_difficulty,
           stage_filter_include_flags, stage_filter_exclude_flags,
           stage_filter_include_any_of_flags, stage_filter_exclude_only_flags,
           stage_filter_has_tags, stage_filter_exclude_tags,
           game_filter_min_difficulty, game_filter_max_difficulty,
           stage_filter_include_untested, stage_filter_untested_only,
           prerequisites_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        entry.entry_notes || null,
        entry.trans_level || null,
        entry.stage_filter_min_difficulty !== undefined ? entry.stage_filter_min_difficulty : null,
        entry.stage_filter_max_difficulty !== undefined ? entry.stage_filter_max_difficulty : null,
        entry.stage_filter_include_flags && Array.isArray(entry.stage_filter_include_flags) ? JSON.stringify(entry.stage_filter_include_flags) : (entry.stage_filter_include_flags || null),
        entry.stage_filter_exclude_flags && Array.isArray(entry.stage_filter_exclude_flags) ? JSON.stringify(entry.stage_filter_exclude_flags) : (entry.stage_filter_exclude_flags || null),
        entry.stage_filter_include_any_of_flags && Array.isArray(entry.stage_filter_include_any_of_flags) ? JSON.stringify(entry.stage_filter_include_any_of_flags) : (entry.stage_filter_include_any_of_flags || null),
        entry.stage_filter_exclude_only_flags && Array.isArray(entry.stage_filter_exclude_only_flags) ? JSON.stringify(entry.stage_filter_exclude_only_flags) : (entry.stage_filter_exclude_only_flags || null),
        entry.stage_filter_has_tags && Array.isArray(entry.stage_filter_has_tags) ? JSON.stringify(entry.stage_filter_has_tags) : (entry.stage_filter_has_tags || null),
        entry.stage_filter_exclude_tags && Array.isArray(entry.stage_filter_exclude_tags) ? JSON.stringify(entry.stage_filter_exclude_tags) : (entry.stage_filter_exclude_tags || null),
        entry.game_filter_min_difficulty ?? null,
        entry.game_filter_max_difficulty ?? null,
        entry.stage_filter_include_untested ?? 0,
        entry.stage_filter_untested_only ?? 0,
        entry.prerequisites_json || null
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

function expectedResultCountFromPlan(planEntries) {
  return planEntries.reduce((sum, entry) => sum + (entry.count || 1), 0);
}

function shouldSkipExpandIfResultsExist(planEntries, existingCount) {
  if (!existingCount || existingCount <= 0) return false;
  return existingCount === expectedResultCountFromPlan(planEntries);
}

/**
 * Clone a completed/cancelled run into a new preparing run for Run Again.
 * @param {Object} dbManager
 * @param {string} sourceRunUuid
 * @param {'reseed'|'keep'} mode
 */
function runAgainFromPastRun(dbManager, sourceRunUuid, mode) {
  const db = dbManager.getConnection('clientdata');
  const sourceRun = db.prepare(`SELECT * FROM runs WHERE run_uuid = ?`).get(sourceRunUuid);
  if (!sourceRun) {
    return { success: false, error: 'Run not found' };
  }
  if (sourceRun.status !== 'completed' && sourceRun.status !== 'cancelled') {
    return { success: false, error: `Run Again requires a completed or cancelled run (status: ${sourceRun.status})` };
  }

  const planEntries = db.prepare(`
    SELECT * FROM run_plan_entries WHERE run_uuid = ? ORDER BY sequence_number
  `).all(sourceRunUuid);
  if (!planEntries.length) {
    return { success: false, error: 'Run has no plan entries' };
  }

  const hasRandomEntries = planEntries.some(
    (e) => e.entry_type === 'random_game' || e.entry_type === 'random_stage'
  );
  if (mode !== 'reseed' && mode !== 'keep') {
    return { success: false, error: `Invalid mode: ${mode}` };
  }

  const newRunUuid = crypto.randomUUID();
  const suggestedName = `${sourceRun.run_name} (Again)`;

  const insertPlanStmt = db.prepare(`
    INSERT INTO run_plan_entries
      (entry_uuid, run_uuid, sequence_number, entry_type, gameid, exit_number,
       count, filter_difficulty, filter_type, filter_pattern, filter_seed, conditions, entry_notes,
       trans_level, stage_filter_min_difficulty, stage_filter_max_difficulty,
       stage_filter_include_flags, stage_filter_exclude_flags,
       stage_filter_include_any_of_flags, stage_filter_exclude_only_flags,
       stage_filter_has_tags, stage_filter_exclude_tags,
       game_filter_min_difficulty, game_filter_max_difficulty,
       stage_filter_include_untested, stage_filter_untested_only,
       prerequisites_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertResultStmt = db.prepare(`
    INSERT INTO run_results
      (result_uuid, run_uuid, plan_entry_uuid, sequence_number,
       gameid, game_name, exit_number, stage_description,
       was_random, revealed_early, status, conditions,
       levelnumber, translevel, levelname, prerequisites_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?, ?)
  `);

  const entryUuidMap = new Map();

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO runs (run_uuid, run_name, run_description, status, global_conditions, config_json, win_rules_json, run_type)
      VALUES (?, ?, ?, 'preparing', ?, ?, ?, ?)
    `).run(
      newRunUuid,
      suggestedName,
      sourceRun.run_description || '',
      sourceRun.global_conditions,
      sourceRun.config_json,
      sourceRun.win_rules_json || null,
      normalizeRunType(sourceRun.run_type)
    );

    let reseedDefaultMapping = null;

    planEntries.forEach((entry, idx) => {
      const newEntryUuid = crypto.randomUUID();
      entryUuidMap.set(entry.entry_uuid, newEntryUuid);

      let filterSeed = entry.filter_seed;
      if (mode === 'reseed' && (entry.entry_type === 'random_game' || entry.entry_type === 'random_stage')) {
        let mapId = null;
        if (entry.filter_seed) {
          try {
            mapId = parseSeed(entry.filter_seed).mapId;
          } catch {
            mapId = null;
          }
        }
        if (!mapId || !getSeedMapping(dbManager, mapId)) {
          if (!reseedDefaultMapping) {
            reseedDefaultMapping = getOrCreateDefaultMapping(dbManager);
          }
          mapId = reseedDefaultMapping.mapId;
        }
        filterSeed = generateSeedWithMap(mapId);
      }

      insertPlanStmt.run(
        newEntryUuid,
        newRunUuid,
        idx + 1,
        entry.entry_type,
        entry.gameid,
        entry.exit_number,
        entry.count || 1,
        entry.filter_difficulty,
        entry.filter_type,
        entry.filter_pattern,
        filterSeed,
        entry.conditions,
        entry.entry_notes || null,
        entry.trans_level || null,
        entry.stage_filter_min_difficulty ?? null,
        entry.stage_filter_max_difficulty ?? null,
        entry.stage_filter_include_flags || null,
        entry.stage_filter_exclude_flags || null,
        entry.stage_filter_include_any_of_flags || null,
        entry.stage_filter_exclude_only_flags || null,
        entry.stage_filter_has_tags || null,
        entry.stage_filter_exclude_tags || null,
        entry.game_filter_min_difficulty ?? null,
        entry.game_filter_max_difficulty ?? null,
        entry.stage_filter_include_untested ?? 0,
        entry.stage_filter_untested_only ?? 0,
        entry.prerequisites_json || null
      );
    });

    if (mode === 'keep') {
      const sourceResults = db.prepare(`
        SELECT * FROM run_results WHERE run_uuid = ? ORDER BY sequence_number
      `).all(sourceRunUuid);

      if (sourceResults.length === 0) {
        throw new Error('Keep mode requires expanded run results from the source run');
      }

      for (const result of sourceResults) {
        const mappedPlanUuid = entryUuidMap.get(result.plan_entry_uuid) || null;
        insertResultStmt.run(
          crypto.randomUUID(),
          newRunUuid,
          mappedPlanUuid,
          result.sequence_number,
          result.gameid,
          result.game_name,
          result.exit_number,
          result.stage_description,
          result.was_random ? 1 : 0,
          result.conditions,
          result.levelnumber || null,
          result.translevel || null,
          result.levelname || null,
          result.prerequisites_json || null
        );
      }
    }
  });

  try {
    transaction();
  } catch (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    runUuid: newRunUuid,
    suggestedName,
    hasRandomEntries,
    mode,
    expectedResultCount: expectedResultCountFromPlan(planEntries),
  };
}

module.exports = {
  generateMapId,
  generateSeedWithMap,
  selectRandomStage,
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
  runAgainFromPastRun,
  expectedResultCountFromPlan,
  shouldSkipExpandIfResultsExist,
  SEED_CHARS
};

