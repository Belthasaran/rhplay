/**
 * Game Stager - Creates pre-patched SFC files for run challenges
 * Similar to verify-all-blobs.js --full-check logic
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const lzma = require('lzma-native');
const fernet = require('fernet');
const sevenZip = require('7zip-min');
const { path7za } = require('7zip-bin');

// Helper function to configure 7zip-min with the correct unpacked binary path
// This is needed for Electron packaged apps where the binary is in app.asar.unpacked
function configure7zipPath() {
  if (typeof process === 'undefined' || !process.versions || !process.versions.electron) {
    return; // Not running in Electron
  }

  try {
    const currentConfig = sevenZip.getConfig();
    let binaryPath = currentConfig.binaryPath || path7za;

    // Check if the binary path contains 'app.asar' but not 'app.asar.unpacked'
    if (binaryPath && binaryPath.includes('app.asar') && !binaryPath.includes('app.asar.unpacked')) {
      // Replace 'app.asar' with 'app.asar.unpacked' in the binary path
      // Handle both forward and backward slashes with global replace
      const unpackedPath = binaryPath.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1');
      
      if (fs.existsSync(unpackedPath)) {
        sevenZip.config({ binaryPath: unpackedPath });
        return;
      }

      // Fallback: try to reconstruct the unpacked path using path manipulation
      try {
        const normalizedPath = path.normalize(binaryPath);
        const unpackedBinary = normalizedPath.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1');
        if (fs.existsSync(unpackedBinary)) {
          sevenZip.config({ binaryPath: unpackedBinary });
          return;
        }

        // Another fallback: find the base directory and reconstruct
        const asarIndex = normalizedPath.indexOf('app.asar');
        if (asarIndex !== -1) {
          const baseDir = normalizedPath.substring(0, asarIndex);
          const relativePath = normalizedPath.substring(asarIndex + 'app.asar'.length);
          const fallbackPath = path.join(baseDir, 'app.asar.unpacked', relativePath);
          if (fs.existsSync(fallbackPath)) {
            sevenZip.config({ binaryPath: fallbackPath });
            return;
          }
          
          // If unpacked doesn't exist, log a warning with the expected path
          console.warn(`[game-stager.js] 7zip binary not found at unpacked path: ${fallbackPath}`);
          console.warn(`[game-stager.js] Original path: ${binaryPath}`);
          console.warn(`[game-stager.js] This may indicate that 7zip-bin was not unpacked during build.`);
        }
      } catch (err) {
        console.warn('[game-stager.js] Failed to configure 7zip unpacked path:', err.message);
      }
    }
  } catch (err) {
    console.warn('[game-stager.js] Error checking 7zip path configuration:', err.message);
  }
}

// Configure 7zip-min on module load (for Electron packaged apps)
configure7zipPath();

/**
 * Decode encrypted/compressed blob data
 * @param {Buffer} encryptedData - Raw blob data
 * @param {string} keyBase64 - Base64-encoded key
 * @returns {Promise<Buffer>} Decoded patch data
 */
async function decodeBlob(encryptedData, keyBase64) {
  // Step 1: Decompress LZMA
  const decompressed1 = await new Promise((resolve, reject) => {
    lzma.decompress(encryptedData, (result, error) => {
      if (error) reject(error);
      else resolve(Buffer.from(result));
    });
  });
  
  // Step 2: Decrypt Fernet
  let fernetKey;
  try {
    const decoded = Buffer.from(keyBase64, 'base64').toString('utf8');
    if (/^[A-Za-z0-9+/\-_]+=*$/.test(decoded) && decoded.length >= 40) {
      fernetKey = decoded;
    } else {
      fernetKey = keyBase64;
    }
  } catch (error) {
    fernetKey = keyBase64;
  }
  
  const frnsecret = new fernet.Secret(fernetKey);
  let tokenStr;
  try {
    tokenStr = decompressed1.toString('utf8');
  } catch (error) {
    // Fallback to latin1 if UTF-8 fails
    tokenStr = decompressed1.toString('latin1');
  }
  const token = new fernet.Token({ 
    secret: frnsecret, 
    ttl: 0, 
    token: tokenStr
  });
  const decrypted = token.decode();
  
  // Step 3: Decompress again
  // The `decrypted` string may contain:
  // 1. Base64-encoded LZMA data (Python blobs)
  // 2. Base64-encoded base64-encoded LZMA data (JavaScript blobs - double encoding)
  // We need to auto-detect which format we have
  
  let lzmaData;
  
  // Detect if decrypted contains non-ASCII characters (Latin1-encoded binary)
  const hasNonAscii = /[^\x00-\x7F]/.test(decrypted);
  
  if (hasNonAscii) {
    // Decrypted is Latin1-encoded binary data (UTF-8 conversion failed in crypto-js)
    // Convert directly from Latin1 string to Buffer
    lzmaData = Buffer.from(decrypted, 'latin1');
  } else {
    // Decrypted is a base64 string (normal case)
    lzmaData = Buffer.from(decrypted, 'base64');
    
    // Check if it starts with LZMA/XZ magic bytes (0xFD or 0x5D)
    if (lzmaData[0] !== 0xfd && lzmaData[0] !== 0x5d) {
      // Not LZMA magic - might be double-encoded base64 (JavaScript blobs)
      // Try decoding one more layer
      try {
        const decoded1Str = lzmaData.toString('utf8');
        lzmaData = Buffer.from(decoded1Str, 'base64');
      } catch (e) {
        // If UTF-8 fails, try latin1
        try {
          const decoded1Str = lzmaData.toString('latin1');
          lzmaData = Buffer.from(decoded1Str, 'base64');
        } catch (e2) {
          // Keep original lzmaData
        }
      }
    }
  }
  
  const decompressed2 = await new Promise((resolve, reject) => {
    lzma.decompress(lzmaData, (result, error) => {
      if (error) reject(error);
      else resolve(Buffer.from(result));
    });
  });
  
  return decompressed2;
}

/**
 * Get staging folder path (uses OS temp directory or override)
 * @param {string} tempDirOverride - Optional custom temp directory base path
 * @returns {string} Path to staging folder
 */
function getStagingBasePath(tempDirOverride = '') {
  const os = require('os');
  const baseDir = tempDirOverride && tempDirOverride.trim() ? tempDirOverride : os.tmpdir();
  return path.join(baseDir, 'RHTools-Runs');
}

/**
 * Get quick launch folder path (uses OS temp directory or override)
 * @param {string} tempDirOverride - Optional custom temp directory base path
 * @returns {string} Path to quick launch folder
 */
function getQuickLaunchBasePath(tempDirOverride = '') {
  const os = require('os');
  const baseDir = tempDirOverride && tempDirOverride.trim() ? tempDirOverride : os.tmpdir();
  return path.join(baseDir, 'RHTools-QuickLaunch');
}

/**
 * Generate run folder name
 * @param {Date} date - Date for folder name
 * @returns {string} Folder name (e.g., "Run251012_1530")
 */
function generateRunFolderName(date = new Date()) {
  const year = date.getFullYear().toString().slice(2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hour = date.getHours().toString().padStart(2, '0');
  const min = date.getMinutes().toString().padStart(2, '0');
  
  return `Run${year}${month}${day}_${hour}${min}`;
}

/**
 * Create patched SFC file for a game
 * @param {Object} params
 * @param {Object} params.dbManager - Database manager
 * @param {string} params.gameid - Game ID
 * @param {number} params.version - Game version
 * @param {string} params.vanillaRomPath - Path to vanilla SMW ROM
 * @param {string} params.flipsPath - Path to FLIPS executable
 * @param {string} params.outputPath - Where to save the SFC file
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function createPatchedSFC(params) {
  const { dbManager, gameid, version, vanillaRomPath, flipsPath, outputPath } = params;
  
  try {
    // Get game version from rhdata.db
    const rhdb = dbManager.getConnection('rhdata');
    const gameVersion = rhdb.prepare(`
      SELECT gv.*, pb.patchblob1_name, pb.patchblob1_sha224, pb.patchblob1_key
      FROM gameversions gv
      LEFT JOIN patchblobs pb ON gv.patchblob1_name = pb.patchblob1_name
      WHERE gv.gameid = ? AND gv.version = ?
    `).get(gameid, version);
    
    if (!gameVersion) {
      return { success: false, error: `Game ${gameid} version ${version} not found` };
    }
    
    if (!gameVersion.patchblob1_name) {
      return { success: false, error: `No patch blob for ${gameid} v${version}` };
    }
    
    if (!gameVersion.patchblob1_key) {
      return { success: false, error: `No decryption key for ${gameid} v${version}` };
    }
    
    // Get patch file data from patchbin.db
    const patchbinDb = dbManager.getConnection('patchbin');
    const attachment = patchbinDb.prepare(`
      SELECT file_data, file_hash_sha224, decoded_hash_sha224
      FROM attachments
      WHERE file_name = ?
    `).get(gameVersion.patchblob1_name);
    
    if (!attachment) {
      return { success: false, error: `Patch file ${gameVersion.patchblob1_name} not found in patchbin.db` };
    }
    
    if (!attachment.file_data) {
      return { success: false, error: `Patch file ${gameVersion.patchblob1_name} has no file_data` };
    }
    
    // Create temp directory for patching
    const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rhtools-patch-'));
    const patchPath = path.join(tempDir, 'patch.bps');
    const tempOutputPath = path.join(tempDir, 'output.sfc');
    
    try {
      // Decode the compressed/encrypted patch data
      let decodedData;
      try {
        decodedData = await decodeBlob(attachment.file_data, gameVersion.patchblob1_key);
      } catch (decodeError) {
        console.error('Blob decode error for game', game.gameid, ':', decodeError);
        return { success: false, error: `Failed to decode patch: ${decodeError.message}` };
      }
      
      // Verify decoded hash
      const decodedHash = crypto.createHash('sha224').update(decodedData).digest('hex');
      if (attachment.decoded_hash_sha224 && decodedHash !== attachment.decoded_hash_sha224) {
        return { 
          success: false, 
          error: `Decoded hash mismatch for ${gameVersion.patchblob1_name}: expected ${attachment.decoded_hash_sha224}, got ${decodedHash}` 
        };
      }
      
      // Write decoded patch file
      fs.writeFileSync(patchPath, decodedData);
      
      // Verify vanilla ROM exists
      if (!fs.existsSync(vanillaRomPath)) {
        return { success: false, error: 'Vanilla ROM not found. Please configure in Settings.' };
      }
      
      // Verify FLIPS exists
      if (!fs.existsSync(flipsPath)) {
        return { success: false, error: 'FLIPS not found. Please configure in Settings.' };
      }
      
      // Run FLIPS to apply patch
      const flipsCmd = `"${flipsPath}" --apply "${patchPath}" "${vanillaRomPath}" "${tempOutputPath}"`;
      
      try {
        execSync(flipsCmd, { stdio: 'pipe' });
      } catch (execError) {
        return { success: false, error: `FLIPS failed: ${execError.message}` };
      }
      
      // Verify output was created
      if (!fs.existsSync(tempOutputPath)) {
        return { success: false, error: 'FLIPS did not create output file' };
      }
      
      // Move to final location
      fs.copyFileSync(tempOutputPath, outputPath);
      
      // Cleanup temp dir
      fs.rmSync(tempDir, { recursive: true, force: true });
      
      return { success: true };
      
    } catch (error) {
      // Cleanup on error
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      throw error;
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Stage all games for a run
 * @param {Object} params
 * @param {Object} params.dbManager - Database manager
 * @param {string} params.runUuid - Run UUID
 * @param {Array} params.expandedResults - All run results (after expansion)
 * @param {string} params.userDataPath - App user data path
 * @param {string} params.vanillaRomPath - Path to vanilla ROM
 * @param {string} params.flipsPath - Path to FLIPS
 * @param {Function} params.onProgress - Progress callback (current, total, gameName)
 * @returns {Promise<{success: boolean, folderPath?: string, gamesStaged?: number, error?: string}>}
 */
async function stageRunGames(params) {
  const { dbManager, runUuid, expandedResults, userDataPath, vanillaRomPath, flipsPath, onProgress } = params;
  
  try {
    // Create staging base directory if it doesn't exist
    const stagingBase = getStagingBasePath();
    if (!fs.existsSync(stagingBase)) {
      fs.mkdirSync(stagingBase, { recursive: true });
    }
    
    // Create run-specific folder
    const runFolderName = generateRunFolderName();
    let runFolder = path.join(stagingBase, runFolderName);
    
    if (fs.existsSync(runFolder)) {
      // Folder exists, append timestamp to make unique
      const timestamp = Date.now();
      const uniqueFolderName = `${runFolderName}_${timestamp}`;
      runFolder = path.join(stagingBase, uniqueFolderName);
    }
    
    fs.mkdirSync(runFolder, { recursive: true });
    console.log(`Created staging folder: ${runFolder}`);
    
    // Stage each game
    let successCount = 0;
    const errors = [];
    
    for (let i = 0; i < expandedResults.length; i++) {
      const result = expandedResults[i];
      const sequenceNum = (i + 1).toString().padStart(2, '0');
      const tmnows = Math.floor(Date.now()/1000);
      const sfcPath = path.join(runFolder, `${sequenceNum}_${tmnows}.sfc`);
      
      if (onProgress) {
        onProgress(i + 1, expandedResults.length, result.game_name);
      }
      
      // Skip if no gameid (shouldn't happen after reveal, but just in case)
      if (!result.gameid) {
        console.warn(`Skipping challenge ${i + 1}: No gameid (random not yet resolved)`);
        continue;
      }
      
      // Create patched SFC
      const patchResult = await createPatchedSFC({
        dbManager,
        gameid: result.gameid,
        version: result.version || 1,  // Use version from result or default to 1
        vanillaRomPath,
        flipsPath,
        outputPath: sfcPath
      });
      
      if (patchResult.success) {
        successCount++;
        console.log(`✓ Created ${sequenceNum}.sfc: ${result.game_name}`);
      } else {
        errors.push(`Challenge ${i + 1} (${result.game_name}): ${patchResult.error}`);
        console.error(`✗ Failed ${sequenceNum}.sfc: ${patchResult.error}`);
      }
    }
    
    // Export run info to JSON
    const seedManager = require('./seed-manager');
    const exportData = seedManager.exportRun(dbManager, runUuid);
    const runInfoPath = path.join(runFolder, 'runinfo.json');
    fs.writeFileSync(runInfoPath, JSON.stringify(exportData, null, 2));
    console.log(`✓ Created runinfo.json`);
    
    // Update run with staging folder path
    const db = dbManager.getConnection('clientdata');
    db.prepare(`
      UPDATE runs SET staging_folder = ? WHERE run_uuid = ?
    `).run(runFolder, runUuid);
    
    if (errors.length > 0) {
      return {
        success: false,
        folderPath: runFolder,
        gamesStaged: successCount,
        error: `Failed to stage ${errors.length} games:\n${errors.join('\n')}`
      };
    }
    
    console.log(`Staging complete! Folder: ${runFolder}, Games: ${successCount}`);
    
    return {
      success: true,
      folderPath: runFolder,
      gamesStaged: successCount
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get active run (if any)
 * @param {Object} dbManager - Database manager
 * @returns {Object|null} Active run or null
 */
function getActiveRun(dbManager) {
  const db = dbManager.getConnection('clientdata');
  
  const activeRun = db.prepare(`
    SELECT * FROM runs 
    WHERE status = 'active' 
    ORDER BY started_at DESC 
    LIMIT 1
  `).get();
  
  return activeRun || null;
}

/**
 * Check if run is currently paused
 * @param {Object} run - Run object
 * @returns {boolean} True if paused
 */
function isRunPaused(run) {
  return run.pause_start && !run.pause_end;
}

/**
 * Calculate elapsed time for run (excluding paused time)
 * @param {Object} run - Run object
 * @returns {number} Elapsed seconds
 */
function calculateRunElapsed(run) {
  if (!run.started_at) return 0;
  
  const startTime = new Date(run.started_at).getTime();
  const now = Date.now();
  const totalElapsed = Math.floor((now - startTime) / 1000);
  
  // Subtract paused time
  let pausedTime = run.pause_seconds || 0;
  
  // If currently paused, add current pause duration
  if (isRunPaused(run)) {
    const pauseStart = new Date(run.pause_start).getTime();
    const currentPause = Math.floor((now - pauseStart) / 1000);
    pausedTime += currentPause;
  }
  
  return Math.max(0, totalElapsed - pausedTime);
}

/**
 * Stage games for quick launch (direct launch without creating a run)
 * @param {Object} params
 * @param {Object} params.dbManager - Database manager
 * @param {Array} params.gameIds - Array of game IDs to stage
 * @param {string} params.vanillaRomPath - Path to vanilla ROM
 * @param {string} params.flipsPath - Path to FLIPS
 * @param {string} params.tempDirOverride - Optional custom temp directory base path
 * @param {Function} params.onProgress - Progress callback (current, total, gameName)
 * @returns {Promise<{success: boolean, folderPath?: string, gamesStaged?: number, error?: string}>}
 */
async function stageQuickLaunchGames(params) {
  const { dbManager, gameIds, vanillaRomPath, flipsPath, tempDirOverride = '', onProgress } = params;
  
  try {
    // Create quick launch base directory if it doesn't exist
    const quickLaunchBase = getQuickLaunchBasePath(tempDirOverride);
    if (!fs.existsSync(quickLaunchBase)) {
      fs.mkdirSync(quickLaunchBase, { recursive: true });
    }
    
    console.log(`Quick launch folder: ${quickLaunchBase}`);
    
    // Get game information from database
    const rhdb = dbManager.getConnection('rhdata');
    const gameInfos = [];
    
    for (const gameId of gameIds) {
      // Get latest version of the game
      const gameVersion = rhdb.prepare(`
        SELECT *
        FROM gameversions
        WHERE gameid = ?
        ORDER BY version DESC
        LIMIT 1
      `).get(gameId);
      
      if (gameVersion) {
        gameInfos.push(gameVersion);
      } else {
        console.warn(`Game ${gameId} not found in database`);
      }
    }
    
    if (gameInfos.length === 0) {
      return { success: false, error: 'No valid games found to stage' };
    }
    
    // Stage each game
    let successCount = 0;
    const errors = [];
    const stagedFiles = []; // Track which files we actually staged
    
    for (let i = 0; i < gameInfos.length; i++) {
      const gameInfo = gameInfos[i];
      const sfcFilename = `smw${gameInfo.gameid}_${gameInfo.version}.sfc`;
      const jsonFilename = `md${gameInfo.gameid}_${gameInfo.version}.json`;
      const sfcPath = path.join(quickLaunchBase, sfcFilename);
      const jsonPath = path.join(quickLaunchBase, jsonFilename);
      
      if (onProgress) {
        onProgress(i + 1, gameInfos.length, gameInfo.name);
      }
      
      // Create patched SFC
      const patchResult = await createPatchedSFC({
        dbManager,
        gameid: gameInfo.gameid,
        version: gameInfo.version,
        vanillaRomPath,
        flipsPath,
        outputPath: sfcPath
      });
      
      if (patchResult.success) {
        successCount++;
        stagedFiles.push(sfcFilename); // Track successful staging
        console.log(`✓ Created ${sfcFilename}: ${gameInfo.name}`);
        
        // Save game metadata as JSON
        const metadata = {
          gameid: gameInfo.gameid,
          version: gameInfo.version,
          name: gameInfo.name,
          authors: gameInfo.authors,
          author: gameInfo.author,
          gametype: gameInfo.gametype,
          length: gameInfo.length,
          difficulty: gameInfo.difficulty,
          demo: gameInfo.demo,
          featured: gameInfo.featured,
          description: gameInfo.description,
          added: gameInfo.added,
          moderated: gameInfo.moderated,
          staged_at: new Date().toISOString(),
          sfc_file: sfcFilename
        };
        
        fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2));
        console.log(`✓ Created ${jsonFilename}`);
      } else {
        errors.push(`Game ${gameInfo.gameid} (${gameInfo.name}): ${patchResult.error}`);
        console.error(`✗ Failed ${sfcFilename}: ${patchResult.error}`);
      }
    }
    
    if (errors.length > 0) {
      return {
        success: false,
        folderPath: quickLaunchBase,
        gamesStaged: successCount,
        error: `Failed to stage ${errors.length} games:\n${errors.join('\n')}`
      };
    }
    
    console.log(`Quick launch staging complete! Folder: ${quickLaunchBase}, Games: ${successCount}`);
    console.log(`Staged files:`, stagedFiles);
    
    return {
      success: true,
      folderPath: quickLaunchBase,
      gamesStaged: successCount,
      stagedFiles: stagedFiles  // Return list of files we staged
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get available extra patches for a game
 * @param {Object} params - { dbManager, gameId, gameVersion }
 * @returns {Promise<Object>} { success, patches, error }
 */
async function getAvailableExtraPatches(params) {
  const { dbManager, gameId, gameVersion } = params;
  
  try {
    // Get game info to check tags
    let gameTags = [];
    try {
      const game = dbManager.getGame(gameId, gameVersion);
      if (game) {
        gameTags = (game.tags || '').split(',').map(t => t.trim()).filter(Boolean);
      } else {
        console.warn(`[getAvailableExtraPatches] Game ${gameId} version ${gameVersion} not found, using empty tags`);
      }
    } catch (e) {
      console.warn(`[getAvailableExtraPatches] Error getting game info:`, e.message);
      // Continue with empty tags - patches without restrictions will still be available
    }
    
    // Get all extra patches
    const db = dbManager.getConnection('rhdata');
    const patches = db.prepare(`
      SELECT * FROM extrapatches 
      ORDER BY priority ASC, name ASC
    `).all();
    
    // Filter patches based on restrictions
    const availablePatches = patches.filter(patch => {
      // If no restrictions are set (null, undefined, or empty string), patch is available
      if (!patch.restrictions || (typeof patch.restrictions === 'string' && patch.restrictions.trim() === '')) {
        return true;
      }
      
      try {
        const restrictions = JSON.parse(patch.restrictions);
        
        // Check allowed games
        if (restrictions.allowed_games && Array.isArray(restrictions.allowed_games)) {
          if (restrictions.allowed_games.length > 0 && !restrictions.allowed_games.includes(gameId)) {
            return false;
          }
        }
        
        // Check required tags
        if (restrictions.required_tags && Array.isArray(restrictions.required_tags)) {
          if (restrictions.required_tags.length > 0) {
            const hasAllTags = restrictions.required_tags.every(tag => 
              gameTags.some(gt => gt.toLowerCase() === tag.toLowerCase())
            );
            if (!hasAllTags) return false;
          }
        }
        
        // Check excluded tags
        if (restrictions.excluded_tags && Array.isArray(restrictions.excluded_tags)) {
          if (restrictions.excluded_tags.length > 0) {
            const hasExcludedTag = restrictions.excluded_tags.some(tag =>
              gameTags.some(gt => gt.toLowerCase() === tag.toLowerCase())
            );
            if (hasExcludedTag) return false;
          }
        }
        
        return true;
      } catch (e) {
        console.error('Error parsing restrictions for patch', patch.patch_code, e);
        // Include patch if restrictions can't be parsed (fail open)
        return true;
      }
    });
    
    console.log(`[getAvailableExtraPatches] Found ${patches.length} total patches, ${availablePatches.length} available for game ${gameId} v${gameVersion}`);
    
    return { success: true, patches: availablePatches };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Maximum code string length before hashing (constant for all patches)
const MAX_PATCH_CODE_STRING_LENGTH = 14;

/**
 * Generate patch code string from selected patches and parameters
 * @param {Array} patches - Selected patch objects
 * @param {Object} globalParams - Global parameters
 * @param {Object} localParams - Local parameters per patch
 * @returns {string} Patch code string
 */
function generatePatchCodeString(patches, globalParams, localParams) {
  let codeString = '';
  
  // Sort patches by priority
  const sortedPatches = [...patches].sort((a, b) => (a.priority || 100) - (b.priority || 100));
  
  for (const patch of sortedPatches) {
    codeString += patch.patch_code;
    
    // Add parameter values if patch has parameter mappings
    if (patch.parameter_mappings) {
      try {
        const mappings = JSON.parse(patch.parameter_mappings);
        const patchLocalParams = localParams[patch.epuuid] || {};
        
        // Extract parameter values and append as hex
        // New format: {"PLACEHOLDER": {"input": "inputvar", ...}}
        // We need to look up the input variable name from the mapping
        for (const [placeholder, mapping] of Object.entries(mappings)) {
          const inputVar = mapping.input;
          if (!inputVar) continue;
          
          // Skip special parameters that don't contribute to code string
          if (inputVar === 'rom_file') continue;
          
          // Get value from local params (mapped by input variable name)
          const value = patchLocalParams[inputVar];
          if (value !== undefined && value !== null && value !== '') {
            if (Array.isArray(value)) {
              // Bitflag vector - convert to hex byte
              let byte = 0;
              for (const bit of value) {
                if (bit >= 0 && bit < 8) {
                  byte |= (1 << (7 - bit)); // High bit first
                }
              }
              codeString += byte.toString(16).padStart(2, '0');
            } else if (typeof value === 'string') {
              // Hex string - pad to appropriate length
              const hexValue = value.replace(/[^0-9A-Fa-f]/g, '');
              if (inputVar === 'local11' || inputVar === 'local12') {
                codeString += hexValue.padStart(4, '0').slice(0, 4);
              } else {
                codeString += hexValue.padStart(2, '0').slice(0, 2);
              }
            } else if (typeof value === 'number') {
              codeString += value.toString(16).padStart(2, '0');
            }
          }
        }
      } catch (e) {
        console.error('Error processing parameter mappings for patch', patch.patch_code, e);
      }
    }
  }
  
  // Add global parameters to code string
  if (globalParams.glevelnum) {
    const levelHex = globalParams.glevelnum.replace(/[^0-9A-Fa-f]/g, '').padStart(2, '0').slice(0, 2);
    codeString += levelHex;
  }
  
  if (globalParams.gonoffv && Array.isArray(globalParams.gonoffv) && globalParams.gonoffv.length > 0) {
    let byte = 0;
    for (const bit of globalParams.gonoffv) {
      if (bit >= 0 && bit < 8) {
        byte |= (1 << (7 - bit));
      }
    }
    codeString += byte.toString(16).padStart(2, '0');
  }
  
  // Hash if too long
  if (codeString.length > MAX_PATCH_CODE_STRING_LENGTH) {
    try {
      const hash = crypto.createHash('shake128', { outputLength: 16 });
      hash.update(codeString);
      return hash.digest('hex');
    } catch (error) {
      // Fallback to SHA256 if SHAKE128 not available
      console.warn('SHAKE128 not available, using SHA256 for patch code hash');
      const hash = crypto.createHash('sha256');
      hash.update(codeString);
      return hash.digest('hex').slice(0, 32); // 16 bytes = 32 hex chars
    }
  }
  
  return codeString;
}

/**
 * Apply extra patches to a patched SFC file
 * @param {Object} params - Patch application parameters
 * @returns {Promise<Object>} { success, outputPath, error }
 */
async function buildPlusPatchedGame(params) {
  const {
    dbManager,
    gameId,
    gameVersion,
    selectedPatches,
    globalParams,
    localParams,
    action,
    vanillaRomPath,
    flipsPath,
    outputDir
  } = params;
  
  try {
    // Step 1: Create initial patched SFC (same as Start button)
    const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rhtools-pluspatch-'));
    const initialSfcPath = path.join(tempDir, 'initial.sfc');
    
    const initialResult = await createPatchedSFC({
      dbManager,
      gameid: gameId,
      version: gameVersion,
      vanillaRomPath,
      flipsPath,
      outputPath: initialSfcPath
    });
    
    if (!initialResult.success) {
      return { success: false, error: `Initial patching failed: ${initialResult.error}` };
    }
    
    // Step 2: Get selected patch objects
    const db = dbManager.getConnection('rhdata');
    const patchObjects = db.prepare(`
      SELECT * FROM extrapatches WHERE epuuid IN (${selectedPatches.map(() => '?').join(',')})
    `).all(...selectedPatches);
    
    if (patchObjects.length !== selectedPatches.length) {
      return { success: false, error: 'Some selected patches not found' };
    }
    
    // Step 3: Check conflicts and dependencies
    for (const patch of patchObjects) {
      if (patch.conflicts) {
        try {
          const conflicts = JSON.parse(patch.conflicts);
          for (const conflictCode of conflicts) {
            if (patchObjects.some(p => p.patch_code === conflictCode)) {
              return { success: false, error: `Patch ${patch.patch_code} conflicts with ${conflictCode}` };
            }
          }
        } catch (e) {
          console.error('Error parsing conflicts for patch', patch.patch_code, e);
        }
      }
    }
    
    // Step 4: Sort patches by priority and dependencies
    const sortedPatches = [];
    const processed = new Set();
    
    function addPatch(patch) {
      if (processed.has(patch.epuuid)) return;
      
      // Check dependencies
      if (patch.dependencies) {
        try {
          const deps = JSON.parse(patch.dependencies);
          for (const depCode of deps) {
            const depPatch = patchObjects.find(p => p.patch_code === depCode);
            if (depPatch && !processed.has(depPatch.epuuid)) {
              addPatch(depPatch);
            }
          }
        } catch (e) {
          console.error('Error parsing dependencies for patch', patch.patch_code, e);
        }
      }
      
      sortedPatches.push(patch);
      processed.add(patch.epuuid);
    }
    
    // Sort by priority first, then add respecting dependencies
    const prioritySorted = [...patchObjects].sort((a, b) => (a.priority || 100) - (b.priority || 100));
    for (const patch of prioritySorted) {
      addPatch(patch);
    }
    
    // Step 5: Apply patches in sequence
    let currentSfcPath = initialSfcPath;
    
    for (const patch of sortedPatches) {
      const nextSfcPath = path.join(tempDir, `after_${patch.patch_code}.sfc`);
      
      let applyResult;
      switch (patch.patch_type) {
        case 'ips':
        case 'bps':
          applyResult = await applyFilePatch({
            patch,
            inputSfcPath: currentSfcPath,
            outputSfcPath: nextSfcPath,
            flipsPath
          });
          break;
        case 'asar':
          applyResult = await applyAsarPatch({
            patch,
            inputSfcPath: currentSfcPath,
            outputSfcPath: nextSfcPath,
            globalParams,
            localParams: localParams[patch.epuuid] || {}
          });
          break;
        case 'uberasmtree':
          applyResult = await applyUberASMTreePatch({
            patch,
            inputSfcPath: currentSfcPath,
            outputSfcPath: nextSfcPath,
            globalParams,
            localParams: localParams[patch.epuuid] || {}
          });
          break;
        default:
          return { success: false, error: `Unknown patch type: ${patch.patch_type}` };
      }
      
      if (!applyResult.success) {
        return { success: false, error: `Failed to apply patch ${patch.patch_code}: ${applyResult.error}` };
      }
      
      currentSfcPath = nextSfcPath;
    }
    
    // Step 6: Generate final filename
    const codeString = generatePatchCodeString(sortedPatches, globalParams, localParams);
    const finalFilename = `sm${gameId}_${codeString}.sfc`;
    
    // Step 7: Determine output path
    let finalOutputPath;
    if (outputDir) {
      finalOutputPath = path.join(outputDir, finalFilename);
    } else {
      const basePath = getQuickLaunchBasePath(params.tempDirOverride);
      finalOutputPath = path.join(basePath, finalFilename);
    }
    
    // Ensure output directory exists
    fs.mkdirSync(path.dirname(finalOutputPath), { recursive: true });
    
    // Copy final SFC to output location
    fs.copyFileSync(currentSfcPath, finalOutputPath);
    
    // Step 8: Handle action (upload/boot if requested)
    if (action === 'upload' || action === 'boot') {
      // This would integrate with USB2SNES upload logic
      // For now, just return success - upload can be handled separately
    }
    
    // Cleanup temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('Failed to cleanup temp directory:', e);
    }
    
    return {
      success: true,
      outputPath: finalOutputPath,
      filename: finalFilename
    };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Apply IPS or BPS patch using FLIPS
 */
async function applyFilePatch(params) {
  const { patch, inputSfcPath, outputSfcPath, flipsPath } = params;
  
  try {
    // Write patch file to temp location
    const patchPath = path.join(require('os').tmpdir(), `patch_${patch.patch_code}.${patch.patch_type}`);
    fs.writeFileSync(patchPath, patch.file_data);
    
    // Apply patch using FLIPS
    const flipsCmd = `"${flipsPath}" --apply "${patchPath}" "${inputSfcPath}" "${outputSfcPath}"`;
    execSync(flipsCmd, { stdio: 'pipe' });
    
    // Verify output
    if (!fs.existsSync(outputSfcPath)) {
      return { success: false, error: 'FLIPS did not create output file' };
    }
    
    // Cleanup patch file
    try {
      fs.unlinkSync(patchPath);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Apply ASAR patch
 */
async function applyAsarPatch(params) {
  const { patch, inputSfcPath, outputSfcPath, globalParams, localParams } = params;
  
  try {
    // Get parameter mappings
    let templateText = patch.template_text || '';
    const mappings = patch.parameter_mappings ? JSON.parse(patch.parameter_mappings) : {};
    
    // Helper function to get parameter value
    function getParameterValue(inputVar) {
      // Special parameter: rom_file
      if (inputVar === 'rom_file') {
        return inputSfcPath;
      }
      
      // Check local params first
      let value = localParams[inputVar];
      
      if (value === undefined || value === null) {
        // Try global params
        if (inputVar === 'glevelnum') {
          value = globalParams.glevelnum;
        } else if (inputVar === 'gonoffv') {
          // Convert bit array to value
          if (Array.isArray(globalParams.gonoffv)) {
            let byte = 0;
            for (const bit of globalParams.gonoffv) {
              if (bit >= 0 && bit < 8) byte |= (1 << (7 - bit));
            }
            value = byte.toString(16).padStart(2, '0');
          }
        }
      }
      
      // Convert value to string representation
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          // Convert bit array to hex
          let byte = 0;
          for (const bit of value) {
            if (bit >= 0 && bit < 8) byte |= (1 << (7 - bit));
          }
          value = byte.toString(16).padStart(2, '0');
        }
        return String(value);
      }
      
      return null;
    }
    
    // Replace template variables
    // New format: {"PLACEHOLDER": {"input": "inputvar", "expression": "inputvar"}}
    // Placeholder name (without {}) maps to {PLACEHOLDER} in template
    for (const [placeholder, mapping] of Object.entries(mappings)) {
      const inputVar = mapping.input;
      const expression = mapping.expression || inputVar; // Default to input variable name
      
      // Get the value
      let value = getParameterValue(inputVar);
      
      // If expression is just the input variable name, use the value directly
      // Otherwise, we could evaluate the expression (for now, just use inputVar value)
      if (expression === inputVar) {
        value = getParameterValue(inputVar);
      } else {
        // For now, simple expression evaluation: if expression references inputVar, substitute it
        // This could be extended later for more complex expressions
        value = expression.replace(new RegExp(inputVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), getParameterValue(inputVar) || '');
      }
      
      if (value !== null) {
        // Replace {PLACEHOLDER} in template (placeholder name is without {})
        const placeholderPattern = `{${placeholder}}`;
        templateText = templateText.replace(new RegExp(placeholderPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
      }
    }
    
    // Write ASAR script to temp file
    const asarScriptPath = path.join(require('os').tmpdir(), `asar_${patch.patch_code}.asm`);
    fs.writeFileSync(asarScriptPath, templateText);
    
    // Run ASAR
    // Note: This assumes ASAR is in PATH or configured separately
    // You may need to add ASAR path to settings
    const asarCmd = `asar "${asarScriptPath}" "${inputSfcPath}"`;
    execSync(asarCmd, { stdio: 'pipe' });
    
    // ASAR modifies the file in place, so copy it
    fs.copyFileSync(inputSfcPath, outputSfcPath);
    
    // Cleanup
    try {
      fs.unlinkSync(asarScriptPath);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Apply UberASMTree patch
 */
async function applyUberASMTreePatch(params) {
  const { patch, inputSfcPath, outputSfcPath, globalParams, localParams } = params;
  
  try {
    // Extract 7z file
    const extractDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'uberasm_'));
    
    // Write 7z archive to temp file
    const archivePath = path.join(require('os').tmpdir(), `uberasm_${patch.patch_code}.7z`);
    fs.writeFileSync(archivePath, patch.file_data);
    
    // Verify and reconfigure 7zip path if needed (in case of late resolution)
    configure7zipPath();
    
    // Extract 7z archive using 7zip-min unpack function
    // This uses the bundled 7z binary from 7zip-bin, works on Linux, Windows, etc.
    // Same library and approach as newgame.js uses
    await new Promise((resolve, reject) => {
      sevenZip.unpack(archivePath, extractDir, (err) => {
        if (err) {
          reject(new Error(`7z extraction failed: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
    
    // Cleanup temp archive file
    try {
      fs.unlinkSync(archivePath);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    // Get parameter mappings
    const mappings = patch.parameter_mappings ? JSON.parse(patch.parameter_mappings) : {};
    
    // Helper function to get parameter value
    function getParameterValue(inputVar) {
      // Special parameter: rom_file
      if (inputVar === 'rom_file') {
        return inputSfcPath;
      }
      
      // Check local params first
      let value = localParams[inputVar];
      
      if (value === undefined || value === null) {
        // Try global params
        if (inputVar === 'glevelnum') {
          value = globalParams.glevelnum;
        } else if (inputVar === 'gonoffv') {
          // Convert bit array to value
          if (Array.isArray(globalParams.gonoffv)) {
            let byte = 0;
            for (const bit of globalParams.gonoffv) {
              if (bit >= 0 && bit < 8) byte |= (1 << (7 - bit));
            }
            value = byte.toString(16).padStart(2, '0');
          }
        }
      }
      
      // Convert value to string representation
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          // Convert bit array to hex
          let byte = 0;
          for (const bit of value) {
            if (bit >= 0 && bit < 8) byte |= (1 << (7 - bit));
          }
          value = byte.toString(16).padStart(2, '0');
        }
        return String(value);
      }
      
      return null;
    }
    
    // Replace template variables in all files
    // New format: {"PLACEHOLDER": {"input": "inputvar", "expression": "inputvar"}}
    // Placeholder name (without {}) maps to {PLACEHOLDER} in template
    function replaceInFile(filePath) {
      let content = fs.readFileSync(filePath, 'utf8');
      for (const [placeholder, mapping] of Object.entries(mappings)) {
        const inputVar = mapping.input;
        const expression = mapping.expression || inputVar; // Default to input variable name
        
        // Get the value
        let value = getParameterValue(inputVar);
        
        // If expression is just the input variable name, use the value directly
        // Otherwise, we could evaluate the expression (for now, just use inputVar value)
        if (expression === inputVar) {
          value = getParameterValue(inputVar);
        } else {
          // For now, simple expression evaluation: if expression references inputVar, substitute it
          // This could be extended later for more complex expressions
          value = expression.replace(new RegExp(inputVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), getParameterValue(inputVar) || '');
        }
        
        if (value !== null) {
          // Replace {PLACEHOLDER} in template (placeholder name is without {})
          const placeholderPattern = `{${placeholder}}`;
          content = content.replace(new RegExp(placeholderPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
        }
      }
      fs.writeFileSync(filePath, content, 'utf8');
    }
    
    // Recursively process all files
    function processDirectory(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          processDirectory(fullPath);
        } else if (entry.isFile()) {
          replaceInFile(fullPath);
        }
      }
    }
    
    processDirectory(extractDir);
    
    // Run UberASM
    // Note: This assumes UberASM is in PATH or configured separately
    const uberasmCmd = `uberasm "${extractDir}" "${inputSfcPath}" "${outputSfcPath}"`;
    execSync(uberasmCmd, { stdio: 'pipe' });
    
    // Cleanup
    try {
      fs.rmSync(extractDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('Failed to cleanup UberASM extract directory:', e);
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  createPatchedSFC,
  stageRunGames,
  stageQuickLaunchGames,
  getStagingBasePath,
  getQuickLaunchBasePath,
  generateRunFolderName,
  getActiveRun,
  getAvailableExtraPatches,
  buildPlusPatchedGame,
  isRunPaused,
  calculateRunElapsed
};

