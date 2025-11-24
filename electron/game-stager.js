/**
 * Game Stager - Creates pre-patched SFC files for run challenges
 * Similar to verify-all-blobs.js --full-check logic
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const lzma = require('lzma-native');
const fernet = require('fernet');
const sevenZip = require('7zip-min');
const { path7za } = require('7zip-bin');

const SKIP_CLEANUP_FOR_NOW = 0;
const gameGenieDecoder = require('./utils/gamegenie-decoder');

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

function stripleadingzeros(strval) {
        return strval.replace(/^0+/, '');
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
  const { dbManager, runUuid, expandedResults, userDataPath, vanillaRomPath, flipsPath, asarPath, onProgress } = params;
  console.log('[stageRunGames] Received asarPath:', asarPath);
  
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
      
      // Check if this is a stage entry (has levelnumber)
      const isStageEntry = result.levelnumber || result.translevel || result.levelname;
      
      let patchResult;
      if (isStageEntry) {
        // For stage entries, use buildPlusPatchedGame with stage-specific patches
        // Get stage info and requisite patches
        const rhdb = dbManager.getConnection('rhdata');
        const stage = rhdb.prepare(`
          SELECT requisites, playlevel_patch_code
          FROM gamestages
          WHERE gameid = ? AND levelnumber = ?
        `).get(result.gameid, result.levelnumber);
        
        // Build list of patch codes to apply (requisites + playlevel patch + global patch codes)
        const patchCodes = [];
        if (stage && stage.requisites) {
          // Parse requisites (comma-separated patch codes)
          const requisites = stage.requisites.split(',').map(r => r.trim()).filter(r => r);
          patchCodes.push(...requisites);
        }
        
        // Add playlevel patch (default to '1lvno' if not specified)
        const playlevelPatch = (stage && stage.playlevel_patch_code) ? stage.playlevel_patch_code : '1lvno';
        if (!patchCodes.includes(playlevelPatch)) {
          patchCodes.push(playlevelPatch);
        }
        
        // Add global patch codes (from run's global conditions)
        if (result.globalPatchCodes && Array.isArray(result.globalPatchCodes)) {
          for (const globalPatchCode of result.globalPatchCodes) {
            if (!patchCodes.includes(globalPatchCode)) {
              patchCodes.push(globalPatchCode);
            }
          }
        }
        
        // Convert patch codes to epuuids
        const selectedPatches = [];
        if (patchCodes.length > 0) {
          const patches = rhdb.prepare(`
            SELECT epuuid FROM extrapatches WHERE patch_code IN (${patchCodes.map(() => '?').join(',')})
          `).all(...patchCodes);
          selectedPatches.push(...patches.map(p => p.epuuid));
        }
        
        // Build global params with levelnumber
        // glevelnum is padded to 3 hex digits, glevelnum_s is the same without leading zeros
        const levelnumHex = (result.levelnumber || '').toString().trim().toUpperCase();
        const glevelnum = levelnumHex.padStart(3, '0').slice(0, 3);
        const globalParams = {
          glevelnum: glevelnum,
          glevelnum_s: stripleadingzeros(glevelnum),
          gonoffv: []
        };
        
        // Build plus-patched game
        patchResult = await buildPlusPatchedGame({
          dbManager,
          gameId: result.gameid,
          gameVersion: result.version || 1,
          selectedPatches,
          globalParams,
          localParams: {},
          action: 'build',
          vanillaRomPath,
          flipsPath,
          asarPath: asarPath || null,  // Use provided ASAR path or let it find automatically
          outputDir: path.dirname(sfcPath)
        });
        
        // Move output file to final location if needed
        if (patchResult.success && patchResult.outputPath && patchResult.outputPath !== sfcPath) {
          if (fs.existsSync(patchResult.outputPath)) {
            fs.copyFileSync(patchResult.outputPath, sfcPath);
            // Clean up temp file if it's in a temp directory
            if (patchResult.outputPath.includes('/tmp/') || patchResult.outputPath.includes('\\temp\\')) {
              try {
                fs.unlinkSync(patchResult.outputPath);
              } catch (e) {
                console.warn('Could not clean up temp file:', e);
              }
            }
          }
        }
      } else {
        // For regular game entries, check if we have global patch codes
        if (result.globalPatchCodes && Array.isArray(result.globalPatchCodes) && result.globalPatchCodes.length > 0) {
          // Convert global patch codes to epuuids
          const rhdb = dbManager.getConnection('rhdata');
          const selectedPatches = [];
          const patches = rhdb.prepare(`
            SELECT epuuid FROM extrapatches WHERE patch_code IN (${result.globalPatchCodes.map(() => '?').join(',')})
          `).all(...result.globalPatchCodes);
          selectedPatches.push(...patches.map(p => p.epuuid));
          
          if (selectedPatches.length > 0) {
            // Use buildPlusPatchedGame with global patch codes
            patchResult = await buildPlusPatchedGame({
              dbManager,
              gameId: result.gameid,
              gameVersion: result.version || 1,
              selectedPatches,
              globalParams: { glevelnum: '', glevelnum_s: '', gonoffv: [] },
              localParams: {},
              action: 'build',
              vanillaRomPath,
              flipsPath,
              asarPath: asarPath || null,  // Use provided ASAR path or let it find automatically
              outputDir: path.dirname(sfcPath)
            });
            
            // Move output file to final location if needed
            if (patchResult.success && patchResult.outputPath && patchResult.outputPath !== sfcPath) {
              if (fs.existsSync(patchResult.outputPath)) {
                fs.copyFileSync(patchResult.outputPath, sfcPath);
                if (patchResult.outputPath.includes('/tmp/') || patchResult.outputPath.includes('\\temp\\')) {
                  try {
                    fs.unlinkSync(patchResult.outputPath);
                  } catch (e) {
                    console.warn('Could not clean up temp file:', e);
                  }
                }
              }
            }
          } else {
            // No valid patches found, use standard patching
            patchResult = await createPatchedSFC({
              dbManager,
              gameid: result.gameid,
              version: result.version || 1,
              vanillaRomPath,
              flipsPath,
              outputPath: sfcPath
            });
          }
        } else {
          // No global patch codes, use standard patching
          patchResult = await createPatchedSFC({
            dbManager,
            gameid: result.gameid,
            version: result.version || 1,  // Use version from result or default to 1
            vanillaRomPath,
            flipsPath,
            outputPath: sfcPath
          });
        }
      }
      
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
    asarPath,
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
            localParams: localParams[patch.epuuid] || {},
            asarPath
          });
          break;
        case 'gamegenie':
          applyResult = await applyGameGeniePatch({
            patch,
            inputSfcPath: currentSfcPath,
            outputSfcPath: nextSfcPath,
            asarPath
          });
          break;
        case 'uberasmtree':
          applyResult = await applyUberASMTreePatch({
            patch,
            inputSfcPath: currentSfcPath,
            outputSfcPath: nextSfcPath,
            globalParams,
            localParams: localParams[patch.epuuid] || {},
            dbManager
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
    
    // Include level number in filename if set
    let levelSuffix = '';
    if (globalParams && globalParams.glevelnum && globalParams.glevelnum.trim()) {
      // glevelnum is expected to be a hex string (e.g., "11", "001", "13C")
      // Format it as _gl<LEVELNUMBER> in uppercase hex
      const levelHex = globalParams.glevelnum.trim().toUpperCase();
      levelSuffix = `_gl${levelHex}`;
    }
    
    const finalFilename = `sm${gameId}_${codeString}${levelSuffix}.sfc`;
    
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
    if (SKIP_CLEANUP_FOR_NOW == 0) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {
        console.warn('Failed to cleanup temp directory:', e);
      }
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
 * Apply GameGenie patch (converts codes to ASAR and applies)
 */
async function applyGameGeniePatch(params) {
  const { patch, inputSfcPath, outputSfcPath, asarPath } = params;
  
  try {
    // Get GameGenie codes from template_text
    const codesText = patch.template_text || '';
    if (!codesText.trim()) {
      return { success: false, error: 'No GameGenie codes provided' };
    }
    
    // Validate codes
    const validation = gameGenieDecoder.validateGameGenieCodes(codesText);
    if (!validation.valid) {
      return { success: false, error: `Invalid GameGenie codes: ${validation.errors.join('; ')}` };
    }
    
    // Convert codes to ASAR script
    const asarScript = gameGenieDecoder.gameGenieCodesToAsar(validation.codes);
    
    if (!asarScript.trim()) {
      return { success: false, error: 'Failed to generate ASAR script from GameGenie codes' };
    }
    
    console.log(`[GameGenie] Converted ${validation.codes.length} code(s) to ASAR script`);
    console.log(`[GameGenie] ASAR script:\n${asarScript}`);
    
    // Create a temporary patch object with the generated ASAR script
    const asarPatch = {
      ...patch,
      template_text: asarScript,
      parameter_mappings: null // GameGenie patches don't use parameter mappings
    };
    
    // Apply as ASAR patch (without parameter mappings)
    return await applyAsarPatch({
      patch: asarPatch,
      inputSfcPath,
      outputSfcPath,
      globalParams: {},
      localParams: {},
      asarPath
    });
  } catch (error) {
    console.error('[GameGenie] Error applying GameGenie patch:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Apply ASAR patch
 */
async function applyAsarPatch(params) {
  const { patch, inputSfcPath, outputSfcPath, globalParams, localParams, asarPath } = params;
  
  try {
    // Normalize globalParams: ensure glevelnum is padded to 3 hex digits and glevelnum_s is derived
    if (globalParams) {
      if (globalParams.glevelnum !== undefined && globalParams.glevelnum !== null && globalParams.glevelnum !== '') {
        // Normalize glevelnum: pad to 3 hex digits
        const levelnumHex = globalParams.glevelnum.toString().trim().toUpperCase().replace(/[^0-9A-F]/g, '');
        globalParams.glevelnum = levelnumHex.padStart(3, '0').slice(0, 3);
        // Automatically derive glevelnum_s from glevelnum (strip leading zeros)
        globalParams.glevelnum_s = stripleadingzeros(globalParams.glevelnum);
      } else if (globalParams.glevelnum_s !== undefined && globalParams.glevelnum_s !== null && globalParams.glevelnum_s !== '') {
        // If glevelnum_s is set but glevelnum is not, derive glevelnum from glevelnum_s
        const levelnumHex = globalParams.glevelnum_s.toString().trim().toUpperCase().replace(/[^0-9A-F]/g, '');
        globalParams.glevelnum = levelnumHex.padStart(3, '0').slice(0, 3);
      } else {
        // Both are empty, ensure they're both empty strings
        globalParams.glevelnum = '';
        globalParams.glevelnum_s = '';
      }
    }
    
    // Find ASAR binary if not provided
    let asarBinary = asarPath;
    if (!asarBinary) {
      try {
        const BinaryFinder = require('../../lib/binary-finder');
        const finder = new BinaryFinder({ 
          projectRoot: path.resolve(__dirname, '../..'),
          clientDbPath: path.join(__dirname, '../clientdata.db')
        });
        const foundAsar = finder.findAsar();
        if (foundAsar) {
          asarBinary = foundAsar;
        } else {
          // Fallback to 'asar' or 'asar.exe' based on platform
          asarBinary = process.platform === 'win32' ? 'asar.exe' : 'asar';
        }
      } catch (e) {
        // BinaryFinder not available, use platform-specific default
        asarBinary = process.platform === 'win32' ? 'asar.exe' : 'asar';
        console.log(`[ASAR] Could not use BinaryFinder, using default: ${asarBinary}`);
      }
    }
    
    if (!fs.existsSync(asarBinary)) {
      return { success: false, error: `ASAR not found at: ${asarBinary}. Please configure ASAR path in Settings.` };
    }
    
    // Get parameter mappings
    let templateText = patch.template_text || '';
    const mappings = patch.parameter_mappings ? JSON.parse(patch.parameter_mappings) : {};
    
    // Helper function to get parameter value
    function getParameterValue(inputVar) {
      // Special parameter: rom_file or rom_path - return the ROM path
      // ASAR doesn't use wine, so always use native path format
      if (inputVar === 'rom_file' || inputVar === 'rom_path') {
        return inputSfcPath;
      }
      
      // Check local params first, but treat empty strings as unset
      let value = localParams[inputVar];
      
      // If value is undefined, null, or empty string, try global params
      if (value === undefined || value === null || value === '') {
        // Try global params - check if inputVar exists as a key in globalParams
        if (globalParams && globalParams.hasOwnProperty(inputVar)) {
          value = globalParams[inputVar];
        } else {
          // Fallback to specific known global params for backwards compatibility
          if (inputVar === 'glevelnum') {
            value = globalParams?.glevelnum;
          } else if (inputVar == 'glevelnum_s') {
	    value = globalParams?.glevelnum_s;
          } else if (inputVar === 'gonoffv') {
            // Convert bit array to value
            if (Array.isArray(globalParams?.gonoffv)) {
              let byte = 0;
              for (const bit of globalParams.gonoffv) {
                if (bit >= 0 && bit < 8) byte |= (1 << (7 - bit));
              }
              value = byte.toString(16).padStart(2, '0');
            }
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
    
    // Use array format to avoid shell interpretation issues
    // This ensures arguments are passed exactly as-is without shell parsing
    const asarArgs = [asarScriptPath, inputSfcPath];
    console.log(`[ASAR] ASAR binary: ${asarBinary}`);
    console.log(`[ASAR] Arguments:`, JSON.stringify(asarArgs));
    console.log(`[ASAR] Script file: ${asarScriptPath}`);
    console.log(`[ASAR] Input ROM: ${inputSfcPath}`);
    console.log(`[ASAR] Script file exists: ${fs.existsSync(asarScriptPath)}`);
    console.log(`[ASAR] Input ROM exists: ${fs.existsSync(inputSfcPath)}`);
    if (fs.existsSync(asarScriptPath)) {
      const scriptStats = fs.statSync(asarScriptPath);
      console.log(`[ASAR] Script file size: ${scriptStats.size} bytes`);
    }
    
    // Build command string for logging (what it would look like in shell)
    const asarCmd = `"${asarBinary}" "${asarScriptPath}" "${inputSfcPath}"`;
    console.log(`[ASAR] Command (for reference): ${asarCmd}`);
    
    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    try {
      // Use spawnSync with array format to avoid shell interpretation
      // This passes arguments directly without shell parsing, avoiding quote issues
      const result = spawnSync(asarBinary, asarArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      
      exitCode = result.status || 0;
      stdout = result.stdout?.toString() || '';
      stderr = result.stderr?.toString() || '';
      
      if (stdout) {
        console.log(`[ASAR] stdout: ${stdout}`);
      }
      if (stderr) {
        console.log(`[ASAR] stderr: ${stderr}`);
      }
      
      if (exitCode === 0) {
        console.log(`[ASAR] Command completed with exit code: ${exitCode}`);
      } else {
        throw new Error(`ASAR exited with code ${exitCode}`);
      }
    } catch (execError) {
      // spawnSync doesn't throw on non-zero exit, but we check status
      // If we get here, it's a different error (like command not found)
      exitCode = execError.status || execError.code || -1;
      stdout = execError.stdout?.toString() || '';
      stderr = execError.stderr?.toString() || execError.message || '';
      
      console.log(`[ASAR] Command failed with exit code: ${exitCode}`);
      if (stdout) {
        console.log(`[ASAR] stdout: ${stdout}`);
      }
      if (stderr) {
        console.log(`[ASAR] stderr: ${stderr}`);
      }
      console.log(`[ASAR] Error message: ${execError.message}`);
      
      // Check if input file was modified (ASAR modifies in place)
      if (!fs.existsSync(inputSfcPath)) {
        return { 
          success: false, 
          error: `ASAR execution failed with exit code ${exitCode}: ${stderr || execError.message}` 
        };
      }
      
      // If file exists but exit code is non-zero, log warning
      if (exitCode !== 0) {
        console.warn(`[ASAR] ASAR returned exit code ${exitCode}, but input file exists. This may be a warning.`);
        // For now, we'll consider it a success if the file exists
        // You may want to make this stricter based on specific exit codes
      }
    }
    
    // Check stderr even if exit code is 0 (ASAR might report errors but return 0)
    // Also check stdout for error messages
    if (stderr || (stdout && (stdout.includes('error') || stdout.includes('Error') || stdout.includes('is not an asar command')))) {
      const errorMsg = stderr || stdout;
      console.error(`[ASAR] ASAR reported an error (exit code ${exitCode}): ${errorMsg}`);
      return { 
        success: false, 
        error: `ASAR reported an error: ${errorMsg}` 
      };
    }
    
    // ASAR modifies the file in place, so copy it
    console.log(`[Patch] Copy ${inputSfcPath}  to ${outputSfcPath}`)
    fs.copyFileSync(inputSfcPath, outputSfcPath);
    
    // Verify the output file exists and has content
    if (!fs.existsSync(outputSfcPath)) {
      console.error(`[ASAR] Output file does not exist: ${outputSfcPath}`);
      return { success: false, error: 'ASAR did not create output file' };
    }
    
    const stats = fs.statSync(outputSfcPath);
    console.log(`[ASAR] Output file created: ${outputSfcPath} (${stats.size} bytes)`);
    if (stats.size === 0) {
      console.error(`[ASAR] Output file is empty`);
      return { success: false, error: 'ASAR created empty output file' };
    }
    
    // Cleanup
    if (SKIP_CLEANUP_FOR_NOW == 0) {
      try {
        fs.unlinkSync(asarScriptPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error(`[ASAR] Unexpected error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Expected SHA256 hashes for UberASMTool validation
const UBERASMTOOL_EXE_SHA256 = 'f227ad292c2a28c30c57b626bfe78ed26fe1c55ae77a1f117e0a1de77e78c6c2';
const UBERASMTOOL_ASAR_DLL_SHA256 = 'bd25cd481dcb052d4e743380417a2a19c9e46c2be558a7ad754e1d7cc1f039de';
const UBERASMTOOL_ZIP_SHA256 = '026e5f38516c51e196f8fd8af6226b42b745701c02cb9b79fa1cc62ecf1c6863';

/**
 * Find UberASMTool.exe with validation
 * @param {Object} dbManager - Database manager for checking settings
 * @returns {Promise<string|null>} Path to UberASMTool.exe or null if not found
 */
async function findUberASMTool(dbManager) {
  const platform = process.platform;
  const isWindows = platform === 'win32';
  const isLinux = platform === 'linux';
  
  // Step 1: Check database setting
  try {
    const clientDb = dbManager.getConnection('clientdata');
    const row = clientDb.prepare(`
      SELECT csetting_value FROM csettings 
      WHERE csetting_name = 'uberAsmPath'
    `).get();
    
    if (row && row.csetting_value) {
      const settingValue = row.csetting_value.trim();
      let exePath;
      
      // Check if setting is already a full path to the exe
      if (settingValue.toLowerCase().endsWith('uberasmtool.exe')) {
        exePath = settingValue;
      } else {
        // Treat as directory and append exe name
        exePath = path.join(settingValue, 'UberASMTool.exe');
      }
      
      // Normalize path (resolve relative paths, handle .., etc.)
      exePath = path.resolve(exePath);
      
      if (fs.existsSync(exePath) && validateUberASMTool(exePath)) {
        console.log(`  ✓ Found UberASMTool via database setting: ${exePath}`);
        return exePath;
      } else {
        console.log(`  ✗ Database setting path not valid: ${exePath} (exists: ${fs.existsSync(exePath)})`);
      }
    }
  } catch (e) {
    console.error(`  ✗ Error checking database setting: ${e.message}`);
    // Continue to next check
  }
  
  // Step 2: Search in common locations
  const searchDirs = [];
  
  // Add project root and script directory
  const projectRoot = process.cwd();
  searchDirs.push(projectRoot);
  
  // Add packaged app resources
  if (process.resourcesPath) {
    searchDirs.push(process.resourcesPath);
    searchDirs.push(path.join(process.resourcesPath, 'app.asar.unpacked'));
  }
  
  // Add common installation directories
  if (isWindows) {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Local');
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Roaming');
    
    searchDirs.push(programFiles);
    searchDirs.push(programFilesX86);
    searchDirs.push(localAppData);
    searchDirs.push(appData);
    searchDirs.push(path.join(appData, 'rhtools'));
    searchDirs.push(path.join(appData, 'rhplay'));
    
    // Also check directly in %APPDATA%\rhtools\ for UberASMTool.exe (not in a subdirectory)
    const rhtoolsDir = path.join(appData, 'rhtools');
    if (fs.existsSync(rhtoolsDir)) {
      const directExePath = path.join(rhtoolsDir, 'UberASMTool.exe');
      if (fs.existsSync(directExePath) && validateUberASMTool(directExePath)) {
        console.log(`  ✓ Found UberASMTool directly in rhtools directory: ${directExePath}`);
        return directExePath;
      }
    }
  } else {
    const homeDir = process.env.HOME || '/root';
    searchDirs.push('/usr/local');
    searchDirs.push('/opt');
    searchDirs.push(homeDir);
    searchDirs.push(path.join(homeDir, '.local'));
  }
  
  // Search for UberASM21 first, then UberASM
  const dirNames = ['UberASM21', 'UberASM'];
  
  for (const searchDir of searchDirs) {
    if (!fs.existsSync(searchDir)) continue;
    
    for (const dirName of dirNames) {
      // Case-insensitive search
      try {
        const entries = fs.readdirSync(searchDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.toLowerCase() === dirName.toLowerCase()) {
            const candidateDir = path.join(searchDir, entry.name);
            const exePath = path.join(candidateDir, 'UberASMTool.exe');
            if (fs.existsSync(exePath) && validateUberASMTool(exePath)) {
              console.log(`  ✓ Found UberASMTool: ${exePath}`);
              return exePath;
            }
          }
        }
      } catch (e) {
        // Continue to next directory
      }
    }
  }
  
  // Step 3: Search for zip file
  for (const searchDir of searchDirs) {
    if (!fs.existsSync(searchDir)) continue;
    
    try {
      const entries = fs.readdirSync(searchDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase() === 'uberasmtool21.zip') {
          const zipPath = path.join(searchDir, entry.name);
          if (validateUberASMToolZip(zipPath)) {
            // Extract to program directory/UberASMTool21
            const extractDir = path.join(projectRoot, 'UberASMTool21');
            try {
              if (!fs.existsSync(extractDir)) {
                fs.mkdirSync(extractDir, { recursive: true });
              }
              
              // Extract zip
              await new Promise((resolve, reject) => {
                sevenZip.unpack(zipPath, extractDir, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });
              
              const exePath = path.join(extractDir, 'UberASMTool.exe');
              if (fs.existsSync(exePath) && validateUberASMTool(exePath)) {
                console.log(`  ✓ Extracted and found UberASMTool: ${exePath}`);
                return exePath;
              }
            } catch (e) {
              console.warn(`Failed to extract UberASMTool zip: ${e.message}`);
            }
          }
        }
      }
    } catch (e) {
      // Continue to next directory
    }
  }
  
  return null;
}

/**
 * Validate UberASMTool.exe and asar.dll
 * @param {string} exePath - Path to UberASMTool.exe
 * @returns {boolean} True if valid
 */
function validateUberASMTool(exePath) {
  try {
    // Check exe hash
    const exeData = fs.readFileSync(exePath);
    const exeHash = crypto.createHash('sha256').update(exeData).digest('hex');
    if (exeHash.toLowerCase() !== UBERASMTOOL_EXE_SHA256.toLowerCase()) {
      return false;
    }
    
    // Check asar.dll in same directory
    const exeDir = path.dirname(exePath);
    const dllPath = path.join(exeDir, 'asar.dll');
    if (!fs.existsSync(dllPath)) {
      return false;
    }
    
    const dllData = fs.readFileSync(dllPath);
    const dllHash = crypto.createHash('sha256').update(dllData).digest('hex');
    if (dllHash.toLowerCase() !== UBERASMTOOL_ASAR_DLL_SHA256.toLowerCase()) {
      return false;
    }
    
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Validate UberASMTool21.zip
 * @param {string} zipPath - Path to zip file
 * @returns {boolean} True if valid
 */
function validateUberASMToolZip(zipPath) {
  try {
    const zipData = fs.readFileSync(zipPath);
    const zipHash = crypto.createHash('sha256').update(zipData).digest('hex');
    return zipHash.toLowerCase() === UBERASMTOOL_ZIP_SHA256.toLowerCase();
  } catch (e) {
    return false;
  }
}

/**
 * Apply UberASMTree patch
 */
async function applyUberASMTreePatch(params) {
  const { patch, inputSfcPath, outputSfcPath, globalParams, localParams, dbManager } = params;
  
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
    
    // Determine if we need wine paths (for Linux)
    const isLinux = process.platform === 'linux';
    const useWinePaths = isLinux;
    
    // Helper function to get parameter value
    function getParameterValue(inputVar, forWine = false) {
      // Special parameter: rom_file or rom_path - return the ROM path
      // Format appropriately for the platform (Windows paths for wine on Linux)
      if (inputVar === 'rom_file' || inputVar === 'rom_path') {
        if (forWine && process.platform === 'linux') {
          // Convert to Windows path format for wine (Z: drive mapping)
          return inputSfcPath.replace(/\//g, '\\').replace(/^/, 'Z:');
        } else {
          // Use native path format
          return inputSfcPath;
        }
      }
      
      // Check local params first, but treat empty strings as unset
      let value = localParams[inputVar];
      
      // If value is undefined, null, or empty string, try global params
      if (value === undefined || value === null || value === '') {
        // Try global params - check if inputVar exists as a key in globalParams
        if (globalParams && globalParams.hasOwnProperty(inputVar)) {
          value = globalParams[inputVar];
        } else {
          // Fallback to specific known global params for backwards compatibility
          if (inputVar === 'glevelnum') {
            value = globalParams?.glevelnum;
          } else if (inputVar == 'glevelnum_s') {
            value = globalParams?.glevelnum_s;
          } else if (inputVar === 'gonoffv') {
            // Convert bit array to value
            if (Array.isArray(globalParams?.gonoffv)) {
              let byte = 0;
              for (const bit of globalParams.gonoffv) {
                if (bit >= 0 && bit < 8) byte |= (1 << (7 - bit));
              }
              value = byte.toString(16).padStart(2, '0');
            }
          }
        }
      }
      
      // Debug logging
      console.log(`[UberASM] getParameterValue("${inputVar}", forWine=${forWine}): value=${value}, type=${typeof value}`);
      if (inputVar === 'glevelnum') {
        console.log(`[UberASM] globalParams:`, JSON.stringify(globalParams));
        console.log(`[UberASM] localParams:`, JSON.stringify(localParams));
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
    // Supports two formats:
    // 1. {"PLACEHOLDER": {"input": "inputvar", "expression": "inputvar"}} - key is placeholder name
    // 2. {"inputvar": {"output": "PLACEHOLDER", "description": "..."}} - key is input var, output is placeholder name
    // IMPORTANT: Only replaces placeholders that are explicitly in the mappings. All other text is preserved as-is.
    function replaceInFile(filePath) {
      let content = fs.readFileSync(filePath, 'utf8');
      let modified = false;
      
      // Build a map of placeholder -> input variable
      const placeholderToInput = {};
      for (const [key, mapping] of Object.entries(mappings)) {
        if (mapping.input) {
          // Format 1: key is placeholder, mapping.input is input variable
          placeholderToInput[key] = mapping.input;
        } else if (mapping.output) {
          // Format 2: key is input variable, mapping.output is placeholder
          placeholderToInput[mapping.output] = key;
        }
      }
      
      // Process each placeholder (ONLY those in our mapping list)
      for (const [placeholder, inputVar] of Object.entries(placeholderToInput)) {
        const mapping = mappings[inputVar] || mappings[placeholder];
        const expression = mapping?.expression || inputVar; // Default to input variable name
        
        // Get the value (with wine path formatting if needed)
        let value = getParameterValue(inputVar, useWinePaths);
        
        // If expression is just the input variable name, use the value directly
        // Otherwise, we could evaluate the expression (for now, just use inputVar value)
        if (expression !== inputVar) {
          // For now, simple expression evaluation: if expression references inputVar, substitute it
          // This could be extended later for more complex expressions
          value = expression.replace(new RegExp(inputVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), getParameterValue(inputVar, useWinePaths) || '');
        }
        
        // Convert value to string, handling null/undefined
        const valueStr = (value !== null && value !== undefined) ? String(value) : '';
        
        // Debug logging
        console.log(`[UberASM] Processing placeholder "${placeholder}" (inputVar: "${inputVar}"), value: "${valueStr}"`);
        
        // Escape special regex characters in the placeholder name
        const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Replace {PLACEHOLDER} format (without $ prefix)
        const placeholderPattern1 = `\\{${escapedPlaceholder}\\}`;
        const regex1 = new RegExp(placeholderPattern1, 'g');
        if (content.match(regex1)) {
          console.log(`[UberASM] Replacing {${placeholder}} with "${valueStr}"`);
          // Use a function replacement to avoid $ being treated as special
          content = content.replace(regex1, () => valueStr);
          modified = true;
        }
        
        // Replace ${PLACEHOLDER} format (with $ prefix - common in ASM files)
        // The $ is just literal text, not a regex special character
        const placeholderPattern2 = `\\$\\{${escapedPlaceholder}\\}`;
        const regex2 = new RegExp(placeholderPattern2, 'g');
        if (content.match(regex2)) {
          console.log(`[UberASM] Replacing $${placeholder} with "$${valueStr}"`);
          // Replace ${placeholder} with $value (keeping the $ prefix)
          // Use a function to avoid $ being interpreted as special in replacement
          // Store valueStr in closure to ensure it's captured correctly
          const replacementValue = valueStr;
          content = content.replace(regex2, (match) => {
            const result = '$' + replacementValue;
            console.log(`[UberASM] Replacement: "${match}" -> "${result}"`);
            return result;
          });
          modified = true;
        }
        
        if (valueStr === '') {
          // Log warning if placeholder is in mapping but value is empty
          console.warn(`[UberASM] Placeholder "${placeholder}" (inputVar: "${inputVar}") has empty value`);
        }
      }
      
      // Also handle special {rom_path} placeholder (even if not in mappings)
      // This is a common placeholder in UberASM list.txt files
      if (content.includes('{rom_path}')) {
        const romPathValue = getParameterValue('rom_path', useWinePaths);
        content = content.replace(/{rom_path}/g, romPathValue);
        modified = true;
      }
      
      // Also handle {rom_file} placeholder (for consistency)
      if (content.includes('{rom_file}')) {
        const romFileValue = getParameterValue('rom_file', useWinePaths);
        content = content.replace(/{rom_file}/g, romFileValue);
        modified = true;
      }
      
      if (modified) {
        fs.writeFileSync(filePath, content, 'utf8');
      }
    }
    
    // Recursively process all text files (skip binary files)
    function processDirectory(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          processDirectory(fullPath);
        } else if (entry.isFile()) {
          // Only process text files (check extension or try to read as text)
          const ext = path.extname(entry.name).toLowerCase();
          const textExtensions = ['.txt', '.asm']; /*TXT: , '.json', '.cfg', '.ini', '.list', '']; */
          // Also try to process files without extension (like 'list' or files with no extension)
          if (textExtensions.includes(ext) || !ext) {
            try {
              // Try to read as text to verify it's not binary
              const content = fs.readFileSync(fullPath, 'utf8');
              // If we can read it as UTF-8, process it
              replaceInFile(fullPath);
            } catch (e) {
              // Skip binary files or files that can't be read as text
              console.warn(`Skipping non-text file: ${fullPath}`);
            }
          }
        }
      }
    }
    
    // Process all text files to replace template variables
    // This includes list.txt and any other text files in the UberASM tree
    processDirectory(extractDir);
    
    // Find UberASMTool
    const uberasmToolPath = await findUberASMTool(dbManager);
    if (!uberasmToolPath) {
      return { success: false, error: 'UberASMTool.exe not found. Please ensure it is installed or set uberAsmPath in settings.' };
    }
    
    // Copy input to output first (tool modifies file in place)
    fs.copyFileSync(inputSfcPath, outputSfcPath);
    
    // Check if list.txt exists (it should, as it's part of the UberASM tree)
    // We don't create it - it should already exist from the extracted archive
    const listFilePath = path.join(extractDir, 'list.txt');
    if (!fs.existsSync(listFilePath)) {
      return { success: false, error: 'list.txt not found in extracted UberASM tree. The patch archive may be invalid.' };
    }
    
    // Create stdin file with blank line (Enter key) - tool requires pressing Enter
    const stdinFile = path.join(extractDir, '_stdin0.txt');
    fs.writeFileSync(stdinFile, '\n', 'utf8');
    
    // Determine command based on platform
    const platform = process.platform;
    //const isLinux = platform === 'linux';
    
    // On Linux, check for wine
    if (isLinux) {
      try {
        execSync('which wine', { stdio: 'pipe' });
      } catch (e) {
        return { success: false, error: 'Wine is required to run UberASMTool.exe on Linux. Please install wine first.' };
      }
    }
    
    // Build command
    // Format: UberASMTool.exe -d <EXTRACT_DIR> list.txt inputfile.smc
    // The -d flag sets the working directory so paths in list.txt are relative to extractDir
    // The tool modifies inputfile.smc in place, so we use outputSfcPath (which is a copy of input)
    let command;
    
    if (isLinux) {
      // On Linux, use wine
      // Wine maps / to Z: by default, so we convert Unix paths to Windows-style paths
      // Use absolute paths and convert forward slashes to backslashes, prefix with Z:
      const wineToolPath = uberasmToolPath.replace(/\//g, '\\').replace(/^/, 'Z:');
      const wineExtractDir = extractDir.replace(/\//g, '\\').replace(/^/, 'Z:');
      const wineListPath = listFilePath.replace(/\//g, '\\').replace(/^/, 'Z:');
      const wineOutputPath = outputSfcPath.replace(/\//g, '\\').replace(/^/, 'Z:');
      
      // Note: stdin redirection (<) is handled by the shell, so we use the Unix path for stdinFile
      // Format: wine "tool.exe" -d "extractDir" "list.txt" "output.sfc"
      command = `wine "${wineToolPath}" -d "${wineExtractDir}" "${wineListPath}" "${wineOutputPath}" < "${stdinFile}"`;
    } else {
      // Windows - use direct paths
      // Format: "tool.exe" -d "extractDir" "list.txt" "output.sfc"
      command = `"${uberasmToolPath}" -d "${extractDir}" "${listFilePath}" "${outputSfcPath}" < "${stdinFile}"`;
    }
    
    // Build arguments array for spawnSync (avoids shell interpretation)
    // Format: [-d, extractDir, list.txt, output.sfc]
    let toolArgs;
    if (isLinux) {
      // On Linux with wine, convert paths to Windows format
      const wineExtractDir = extractDir.replace(/\//g, '\\').replace(/^/, 'Z:');
      const wineListPath = listFilePath.replace(/\//g, '\\').replace(/^/, 'Z:');
      const wineOutputPath = outputSfcPath.replace(/\//g, '\\').replace(/^/, 'Z:');
      toolArgs = ['-d', wineExtractDir, wineListPath, wineOutputPath];
    } else {
      // Windows - use native paths
      toolArgs = ['-d', extractDir, listFilePath, outputSfcPath];
    }
    
    console.log(`[UberASM] Executing: ${uberasmToolPath}`);
    console.log(`[UberASM] Arguments:`, JSON.stringify(toolArgs));
    console.log(`[UberASM] Working directory: ${extractDir}`);
    console.log(`[UberASM] Command (for reference): ${command}`);
    
    // Run UberASMTool with working directory set to extractDir
    // The tool modifies the input file in place, so outputSfcPath will be modified
    let execResult;
    let exitCode = 0;
    let stdout = '';
    let stderr = '';
    
    try {
      if (isLinux) {
        // On Linux, use wine with spawnSync
        // stdin redirection needs to be handled via input option
        const stdinContent = fs.readFileSync(stdinFile, 'utf8');
        const result = spawnSync('wine', [uberasmToolPath, ...toolArgs], {
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf8',
          input: stdinContent,
          cwd: extractDir
        });
        
        exitCode = result.status || 0;
        stdout = result.stdout?.toString() || '';
        stderr = result.stderr?.toString() || '';
      } else {
        // Windows - use spawnSync directly
        const stdinContent = fs.readFileSync(stdinFile, 'utf8');
        const result = spawnSync(uberasmToolPath, toolArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          encoding: 'utf8',
          input: stdinContent,
          cwd: extractDir
        });
        
        exitCode = result.status || 0;
        stdout = result.stdout?.toString() || '';
        stderr = result.stderr?.toString() || '';
      }
      
      if (stdout) {
        console.log(`[UberASM] stdout: ${stdout}`);
      }
      if (stderr) {
        console.log(`[UberASM] stderr: ${stderr}`);
      }
      
      if (exitCode === 0) {
        console.log(`[UberASM] Command completed successfully with exit code: ${exitCode}`);
      } else {
        throw new Error(`UberASMTool exited with code ${exitCode}`);
      }
    } catch (execError) {
      // spawnSync doesn't throw on non-zero exit, but we check status
      // If we get here, it's a different error (like command not found)
      exitCode = execError.status || execError.code || -1;
      stdout = execError.stdout?.toString() || '';
      stderr = execError.stderr?.toString() || execError.message || '';
      
      console.log(`[UberASM] Command failed with exit code: ${exitCode}`);
      if (stdout) {
        console.log(`[UberASM] stdout: ${stdout}`);
      }
      if (stderr) {
        console.log(`[UberASM] stderr: ${stderr}`);
      }
      console.log(`[UberASM] Error message: ${execError.message}`);
      
      // Check if output file was created/modified (tool may have succeeded despite error code)
      if (!fs.existsSync(outputSfcPath)) {
        return { 
          success: false, 
          error: `UberASMTool execution failed with exit code ${exitCode}: ${stderr || execError.message}` 
        };
      }
      
      // If file exists but exit code is non-zero, check if it's a warning or actual error
      // Exit code 0 = success, non-zero = error/warning
      if (exitCode !== 0) {
        // Log warning but continue if file was created
        console.warn(`[UberASM] UberASMTool returned exit code ${exitCode}, but output file exists. This may be a warning.`);
        // For now, we'll consider it a success if the file exists
        // You may want to make this stricter based on specific exit codes
      }
    }
    
    // Check stderr even if exit code is 0 (tool might report errors but return 0)
    if (stderr && (stderr.includes('error') || stderr.includes('Error') || stderr.includes('failed'))) {
      console.error(`[UberASM] UberASMTool reported an error (exit code ${exitCode}): ${stderr}`);
      return { 
        success: false, 
        error: `UberASMTool reported an error: ${stderr}` 
      };
    }
    
    // Verify the output file exists and has content
    if (!fs.existsSync(outputSfcPath)) {
      console.error(`[UberASM] Output file does not exist: ${outputSfcPath}`);
      return { success: false, error: 'UberASMTool did not create output file' };
    }
    
    const stats = fs.statSync(outputSfcPath);
    console.log(`[UberASM] Output file created: ${outputSfcPath} (${stats.size} bytes)`);
    if (stats.size === 0) {
      console.error(`[UberASM] Output file is empty`);
      return { success: false, error: 'UberASMTool created empty output file' };
    }
    
    // Cleanup
    if (SKIP_CLEANUP_FOR_NOW == 0) {
      try {
        fs.unlinkSync(stdinFile);
        fs.unlinkSync(listFilePath);
        fs.rmSync(extractDir, { recursive: true, force: true });
      } catch (e) {
        console.warn('Failed to cleanup UberASM extract directory:', e);
      }
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

