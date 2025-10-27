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

module.exports = {
  createPatchedSFC,
  stageRunGames,
  stageQuickLaunchGames,
  getStagingBasePath,
  getQuickLaunchBasePath,
  generateRunFolderName,
  getActiveRun,
  isRunPaused,
  calculateRunElapsed
};

