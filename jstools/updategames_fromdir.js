#!/usr/bin/env node

/**
 * updategames_fromdir.js - Process game updates from legacy directory format
 * 
 * Processes game update packages from a legacy directory tree format (not from SMWC).
 * Scans hacks/ subfolder for JSON game files and blobs/ subfolder for patch blobs.
 * 
 * Usage:
 *   enode.sh ~/rhplay/jstools/updategames_fromdir.js --dir=<path>
 *   enode.sh ~/rhplay/jstools/updategames_fromdir.js --dir=<path> --force-update
 *   enode.sh ~/rhplay/jstools/updategames_fromdir.js --dir=<path> --force-update --create-version
 * 
 * Required:
 *   --dir=<path>    Path to the directory tree containing hacks/ and blobs/ subfolders
 * 
 * Options:
 *   --force-update  Process games even if gameid already exists (updates in-place by default)
 *   --create-version Create a new gameversion instead of updating in-place (requires --force-update)
 *   --dry-run       Simulate operations without database changes
 *   --help, -h      Show this help message
 * 
 * Directory Structure:
 *   <dir>/
 *     hacks/        JSON files (one per game), filename should match "id" attribute
 *     blobs/        Patch blob files
 * 
 * JSON Format:
 *   - "id" attribute is converted to "gameid"
 *   - Must have patchblob1_name, patchblob1_key, patchblob1_sha224 attributes
 *   - Patch blob must exist in blobs/ subfolder
 *   - Blob must decrypt, decode, and verify correctly before processing
 * 
 * Behavior:
 *   - By default: Only processes games where gameid doesn't exist in gameversions table
 *   - With --force-update: Updates existing games in-place (no new version created)
 *   - With --force-update --create-version: Creates new version for existing games
 *   - Avoids creating duplicate patchblobs, attachments, gameversions, or rhpatches
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');
const Database = require('better-sqlite3');

// Import modules
const DatabaseManager = require('../lib/database');
const RecordCreator = require('../lib/record-creator');
const { getFlipsPath, getSmwRomPath, SMW_EXPECTED_SHA224 } = require('../lib/binary-finder');
const fernet = require('fernet');
const lzma = require('lzma-native');
const UrlBase64 = require('urlsafe-base64');

// Configuration
const CONFIG = {
  DB_PATH: process.env.RHDATA_DB_PATH || path.join(__dirname, '..', 'electron', 'rhdata.db'),
  PATCHBIN_DB_PATH: process.env.PATCHBIN_DB_PATH || path.join(__dirname, '..', 'electron', 'patchbin.db'),
  TEMP_DIR: path.join(__dirname, 'temp'),
  BLOBS_DIR: path.join(__dirname, 'blobs'),
  BASE_ROM_PATH: null,
  BASE_ROM_SHA224: SMW_EXPECTED_SHA224,
  FLIPS_PATH: null,
  DRY_RUN: false
};

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const parsed = {
    'dir': null,
    'force-update': false,
    'create-version': false,
    'dry-run': false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith('--dir=')) {
      parsed['dir'] = path.resolve(arg.split('=')[1]);
    } else if (arg === '--dir') {
      parsed['dir'] = path.resolve(args[++i]);
    } else if (arg === '--force-update') {
      parsed['force-update'] = true;
    } else if (arg === '--create-version') {
      parsed['create-version'] = true;
    } else if (arg === '--dry-run') {
      parsed['dry-run'] = true;
    }
  }
  
  return parsed;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
updategames_fromdir.js - Process game updates from legacy directory format

Usage:
  enode.sh ~/rhplay/jstools/updategames_fromdir.js --dir=<path> [options]

Required:
  --dir=<path>        Path to directory tree containing hacks/ and blobs/ subfolders

Options:
  --force-update      Process games even if gameid already exists (updates in-place by default)
  --create-version    Create a new gameversion instead of updating in-place (requires --force-update)
  --dry-run           Simulate operations without database changes
  --help, -h          Show this help message

Examples:
  enode.sh ~/rhplay/jstools/updategames_fromdir.js --dir=~/rhplay/RHR_UPDATE_20251225
  enode.sh ~/rhplay/jstools/updategames_fromdir.js --dir=~/rhplay/RHR_UPDATE_20251225 --force-update
  enode.sh ~/rhplay/jstools/updategames_fromdir.js --dir=~/rhplay/RHR_UPDATE_20251225 --force-update --create-version
  `);
}

/**
 * Generate UUID v4
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Calculate SHA-224 hash
 */
function sha224(buffer) {
  return crypto.createHash('sha224').update(buffer).digest('hex');
}

/**
 * Calculate SHA-1 hash
 */
function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

/**
 * Calculate SHAKE-128 hash
 */
function shake128(buffer) {
  return crypto.createHash('shake128', { outputLength: 16 }).update(buffer).digest('base64url');
}

/**
 * Decompress LZMA data
 */
async function decompressLZMA(buffer) {
  return await lzma.decompress(buffer);
}

/**
 * Decrypt Fernet
 */
async function decryptFernet(encryptedData, key) {
  const token = new fernet.Token({
    secret: new fernet.Secret(key),
    ttl: 0
  });
  return token.decode(encryptedData);
}

/**
 * Decode encrypted patchblob (decrypt and decompress)
 */
async function decodePatchBlob(rawData, patchblob1_key) {
  try {
    // Step 1: Decompress LZMA
    const decomp1 = await decompressLZMA(rawData);
    
    // Step 2: Prepare Fernet key (double-encoded base64)
    const key = UrlBase64.encode(atob(patchblob1_key)).toString();
    
    // Step 3: Decrypt with Fernet
    const decrypted = await decryptFernet(Buffer.from(decomp1).toString(), key);
    
    // Step 4: Try to decompress again (auto-detect format)
    try {
      // Try Python format (single LZMA decompress)
      const decomp2 = await decompressLZMA(Buffer.from(decrypted, 'base64'));
      return decomp2;
    } catch (e1) {
      // Try JavaScript format (base64-encoded LZMA data)
      try {
        const lzmaData = Buffer.from(decrypted, 'base64');
        const decomp2 = await decompressLZMA(lzmaData);
        return decomp2;
      } catch (e2) {
        // If decrypted data already looks like patch data, return it
        if (decrypted.length > 0) {
          return Buffer.from(decrypted, 'base64');
        }
        throw new Error(`Cannot decode blob. Python format failed: ${e1.message}, JavaScript format failed: ${e2.message}`);
      }
    }
  } catch (error) {
    throw new Error(`Error decoding patchblob: ${error.message}`);
  }
}

/**
 * Verify patch blob (check file exists, hash matches, decrypts correctly, and optionally tests with flips)
 */
async function verifyBlob(blobPath, blobData, patchblob1_key, patchblob1_sha224, pat_sha224, result_sha224) {
  const result = {
    valid: false,
    errors: [],
    decodedData: null
  };
  
  try {
    // Check 1: File exists
    if (!fs.existsSync(blobPath)) {
      result.errors.push(`Blob file not found: ${blobPath}`);
      return result;
    }
    
    // Check 2: Read file and verify blob hash
    const fileData = fs.readFileSync(blobPath);
    const fileHash = sha224(fileData);
    
    if (fileHash !== patchblob1_sha224) {
      result.errors.push(`Blob hash mismatch: expected ${patchblob1_sha224}, got ${fileHash}`);
      return result;
    }
    
    // Check 3: Decrypt and decode blob
    const decodedData = await decodePatchBlob(fileData, patchblob1_key);
    result.decodedData = decodedData;
    
    // Check 4: Verify decoded patch hash
    const decodedHash = sha224(decodedData);
    if (decodedHash !== pat_sha224) {
      result.errors.push(`Patch hash mismatch: expected ${pat_sha224}, got ${decodedHash}`);
      return result;
    }
    
    // Check 5: Optionally test with flips (if result_sha224 is provided)
    if (result_sha224 && CONFIG.FLIPS_PATH && CONFIG.BASE_ROM_PATH) {
      try {
        const tempPatch = path.join(CONFIG.TEMP_DIR, `verify_${path.basename(blobPath)}.patch`);
        const tempRom = path.join(CONFIG.TEMP_DIR, `verify_${path.basename(blobPath)}.sfc`);
        
        fs.writeFileSync(tempPatch, decodedData);
        
        const flipsCmd = `"${CONFIG.FLIPS_PATH}" --apply "${tempPatch}" "${CONFIG.BASE_ROM_PATH}" "${tempRom}"`;
        execSync(flipsCmd, { stdio: 'pipe' });
        
        if (fs.existsSync(tempRom)) {
          const resultData = fs.readFileSync(tempRom);
          const resultHash = sha224(resultData);
          
          if (resultHash !== result_sha224) {
            result.errors.push(`Result hash mismatch: expected ${result_sha224}, got ${resultHash}`);
            // Clean up
            fs.unlinkSync(tempPatch);
            fs.unlinkSync(tempRom);
            return result;
          }
          
          // Clean up
          fs.unlinkSync(tempPatch);
          fs.unlinkSync(tempRom);
        }
      } catch (error) {
        result.errors.push(`Flips test failed: ${error.message}`);
        return result;
      }
    }
    
    result.valid = true;
    return result;
    
  } catch (error) {
    result.errors.push(`Unexpected error: ${error.message}`);
    return result;
  }
}

/**
 * Scan hacks/ subfolder for JSON game files
 */
function scanHacksFolder(hacksDir) {
  const gameFiles = [];
  
  if (!fs.existsSync(hacksDir)) {
    throw new Error(`Hacks directory not found: ${hacksDir}`);
  }
  
  const entries = fs.readdirSync(hacksDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isFile()) {
      const filePath = path.join(hacksDir, entry.name);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const gameData = JSON.parse(content);
        
        // Convert "id" to "gameid"
        if (gameData.id && !gameData.gameid) {
          gameData.gameid = gameData.id;
        }
        
        // Verify filename matches id
        const filenameWithoutExt = path.basename(filePath, path.extname(filePath));
        if (gameData.gameid && gameData.gameid !== filenameWithoutExt) {
          console.warn(`  ⚠ Warning: Filename "${filenameWithoutExt}" doesn't match gameid "${gameData.gameid}"`);
        }
        
        gameFiles.push({ filePath, gameData });
      } catch (error) {
        console.warn(`  ⚠ Skipping invalid JSON file: ${entry.name} (${error.message})`);
      }
    }
  }
  
  return gameFiles;
}

/**
 * Main function
 */
async function main() {
  const argv = parseArgs(process.argv.slice(2));
  
  console.log('==================================================');
  console.log('  updategames_fromdir.js - Legacy Format Import  ');
  console.log('==================================================\n');
  
  // Validate required arguments
  if (!argv['dir']) {
    console.error('Error: --dir is required');
    printHelp();
    process.exit(1);
  }
  
  if (argv['create-version'] && !argv['force-update']) {
    console.error('Error: --create-version requires --force-update');
    process.exit(1);
  }
  
  const sourceDir = argv['dir'];
  const hacksDir = path.join(sourceDir, 'hacks');
  const blobsDir = path.join(sourceDir, 'blobs');
  
  if (!fs.existsSync(sourceDir)) {
    console.error(`Error: Source directory not found: ${sourceDir}`);
    process.exit(1);
  }
  
  if (!fs.existsSync(hacksDir)) {
    console.error(`Error: Hacks directory not found: ${hacksDir}`);
    process.exit(1);
  }
  
  if (!fs.existsSync(blobsDir)) {
    console.error(`Error: Blobs directory not found: ${blobsDir}`);
    process.exit(1);
  }
  
  CONFIG.DRY_RUN = argv['dry-run'];
  
  if (CONFIG.DRY_RUN) {
    console.log('⚠  DRY RUN MODE - No database changes will be made\n');
  }
  
  try {
    console.log('Initializing...');
    
    // Initialize paths
    CONFIG.BASE_ROM_PATH = getSmwRomPath({ 
      projectRoot: __dirname,
      throwOnError: true
    });
    console.log('  ✓ Base ROM verified');
    
    CONFIG.FLIPS_PATH = getFlipsPath({ projectRoot: __dirname });
    console.log('  ✓ Flips utility found');
    
    // Create temp and blobs directories
    if (!fs.existsSync(CONFIG.TEMP_DIR)) {
      fs.mkdirSync(CONFIG.TEMP_DIR, { recursive: true });
    }
    if (!fs.existsSync(CONFIG.BLOBS_DIR)) {
      fs.mkdirSync(CONFIG.BLOBS_DIR, { recursive: true });
    }
    
    // Open databases
    const dbManager = new DatabaseManager(CONFIG.DB_PATH);
    console.log('  ✓ Database opened\n');
    
    const recordCreator = new RecordCreator(dbManager, CONFIG.PATCHBIN_DB_PATH, CONFIG);
    
    // Scan for game files
    console.log(`Scanning ${hacksDir} for game files...`);
    const gameFiles = scanHacksFolder(hacksDir);
    console.log(`  ✓ Found ${gameFiles.length} game file(s)\n`);
    
    if (gameFiles.length === 0) {
      console.log('No game files found to process.');
      return;
    }
    
    // Get existing game IDs
    const existingGameIds = new Set(dbManager.getExistingGameIds());
    console.log(`  Existing games in database: ${existingGameIds.size}\n`);
    
    let processed = 0;
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    
    // Process each game file
    for (const { filePath, gameData } of gameFiles) {
      processed++;
      const gameid = gameData.gameid || gameData.id;
      
      if (!gameid) {
        console.log(`\n[${processed}/${gameFiles.length}] Skipping file (no gameid): ${path.basename(filePath)}`);
        skipped++;
        continue;
      }
      
      console.log(`\n[${processed}/${gameFiles.length}] Game ${gameid}: ${gameData.name || 'Unknown'}`);
      
      // Check if game already exists
      const exists = existingGameIds.has(String(gameid));
      
      if (exists && !argv['force-update']) {
        console.log(`  ⓘ Game already exists, skipping (use --force-update to process)`);
        skipped++;
        continue;
      }
      
      // Verify required patchblob fields
      if (!gameData.patchblob1_name || !gameData.patchblob1_key || !gameData.patchblob1_sha224) {
        console.log(`  ✗ Missing required patchblob fields (patchblob1_name, patchblob1_key, patchblob1_sha224)`);
        failed++;
        continue;
      }
      
      if (!gameData.pat_sha224) {
        console.log(`  ✗ Missing required pat_sha224 field`);
        failed++;
        continue;
      }
      
      // Verify blob exists and is valid
      const blobPath = path.join(blobsDir, gameData.patchblob1_name);
      console.log(`  Verifying blob: ${gameData.patchblob1_name}...`);
      
      const verifyResult = await verifyBlob(
        blobPath,
        null,
        gameData.patchblob1_key,
        gameData.patchblob1_sha224,
        gameData.pat_sha224,
        gameData.result_sha224 || null
      );
      
      if (!verifyResult.valid) {
        console.log(`  ✗ Blob verification failed:`);
        verifyResult.errors.forEach(err => console.log(`    - ${err}`));
        failed++;
        continue;
      }
      
      console.log(`  ✓ Blob verified successfully`);
      
      if (CONFIG.DRY_RUN) {
        console.log(`  [DRY RUN] Would process game ${gameid}`);
        succeeded++;
        continue;
      }
      
      // Prepare data structures for record creation
      // Convert legacy format to match what RecordCreator expects
      const metadata = { ...gameData };
      delete metadata.id; // Already converted to gameid
      
      // Create a "patch file" record structure (similar to what updategames.js uses)
      const patchFileRecord = {
        pfuuid: generateUUID(),
        gameid: gameid,
        patch_filename: gameData.patch_filename || null,
        patch_type: gameData.patch_type || 'bps',
        pat_sha1: gameData.pat_sha1 || null,
        pat_sha224: gameData.pat_sha224,
        pat_shake_128: gameData.pat_shake_128 || null,
        result_sha1: gameData.result_sha1 || null,
        result_sha224: gameData.result_sha224 || null,
        result_shake1: gameData.result_shake1 || null,
        is_primary: 1,
        status: 'completed',
        blob_data: JSON.stringify({
          patchblob1_name: gameData.patchblob1_name,
          patchblob1_key: gameData.patchblob1_key,
          patchblob1_sha224: gameData.patchblob1_sha224
        })
      };
      
      // Check for duplicate patchblob (by name or hash)
      const existingPatchblob = dbManager.db.prepare(`
        SELECT pbuuid FROM patchblobs 
        WHERE patchblob1_name = ? OR pat_sha224 = ?
        LIMIT 1
      `).get(gameData.patchblob1_name, gameData.pat_sha224);
      
      if (existingPatchblob && !argv['force-update']) {
        console.log(`  ⓘ Patchblob already exists, skipping duplicate`);
        skipped++;
        continue;
      }
      
      try {
        dbManager.beginTransaction();
        
        if (exists && argv['force-update']) {
          // Update existing game
          const latestVersion = dbManager.getLatestVersionForGame(gameid);
          
          if (!latestVersion) {
            throw new Error(`Game ${gameid} marked as existing but no version found`);
          }
          
          if (argv['create-version']) {
            // Create new version
            console.log(`  Creating new version (${latestVersion.version + 1})...`);
            const gvuuid = recordCreator.createGameVersionRecord(
              gameid,
              metadata,
              patchFileRecord,
              JSON.parse(patchFileRecord.blob_data),
              null
            );
            
            // Create patchblob record
            const pbuuid = await recordCreator.createPatchBlobRecord(
              gvuuid,
              gameid,
              patchFileRecord,
              JSON.parse(patchFileRecord.blob_data)
            );
            
            // Copy blob to standard location and create attachment record
            await copyBlobAndCreateAttachment(
              recordCreator,
              pbuuid,
              gvuuid,
              blobPath,
              gameData.patchblob1_name,
              gameData.patchblob1_key,
              gameData.pat_sha224
            );
            
            // Create rhpatch record if patch name exists
            if (gameData.patch) {
              createRhPatchRecord(dbManager, gameid, gameData.patch);
            }
            
            console.log(`  ✓ Created new version ${latestVersion.version + 1}`);
          } else {
            // Update in-place
            console.log(`  Updating existing game in-place (version ${latestVersion.version})...`);
            
            await recordCreator.updateGameVersionRecordInPlace(
              gameid,
              latestVersion.gvuuid,
              metadata,
              patchFileRecord,
              JSON.parse(patchFileRecord.blob_data),
              latestVersion
            );
            
            // Check if patchblob exists for this gvuuid
            const existingPb = dbManager.db.prepare(`
              SELECT pbuuid FROM patchblobs WHERE gvuuid = ? LIMIT 1
            `).get(latestVersion.gvuuid);
            
            let finalPbuuid;
            if (existingPb) {
              // Update existing patchblob
              await recordCreator.updatePatchBlobRecord(
                existingPb.pbuuid,
                latestVersion.gvuuid,
                gameid,
                patchFileRecord,
                JSON.parse(patchFileRecord.blob_data)
              );
              finalPbuuid = existingPb.pbuuid;
            } else {
              // Create new patchblob
              finalPbuuid = await recordCreator.createPatchBlobRecord(
                latestVersion.gvuuid,
                gameid,
                patchFileRecord,
                JSON.parse(patchFileRecord.blob_data)
              );
            }
            
            // Always ensure attachment record exists (createAttachmentRecord handles duplicates)
            await copyBlobAndCreateAttachment(
              recordCreator,
              finalPbuuid,
              latestVersion.gvuuid,
              blobPath,
              gameData.patchblob1_name,
              gameData.patchblob1_key,
              gameData.pat_sha224
            );
            
            // Update rhpatch record if patch name exists
            if (gameData.patch) {
              createRhPatchRecord(dbManager, gameid, gameData.patch);
            }
            
            console.log(`  ✓ Updated game in-place`);
          }
        } else {
          // Create new game
          console.log(`  Creating new game...`);
          const gvuuid = recordCreator.createGameVersionRecord(
            gameid,
            metadata,
            patchFileRecord,
            JSON.parse(patchFileRecord.blob_data),
            null
          );
          
          // Create patchblob record
          const pbuuid = await recordCreator.createPatchBlobRecord(
            gvuuid,
            gameid,
            patchFileRecord,
            JSON.parse(patchFileRecord.blob_data)
          );
          
          // Copy blob to standard location and create attachment record
          await copyBlobAndCreateAttachment(
            recordCreator,
            pbuuid,
            gvuuid,
            blobPath,
            gameData.patchblob1_name,
            gameData.patchblob1_key,
            gameData.pat_sha224
          );
          
          // Create rhpatch record if patch name exists
          if (gameData.patch) {
            createRhPatchRecord(dbManager, gameid, gameData.patch);
          }
          
          console.log(`  ✓ Created new game`);
        }
        
        dbManager.commit();
        succeeded++;
        
      } catch (error) {
        dbManager.rollback();
        console.error(`  ✗ Error processing game: ${error.message}`);
        console.error(`    ${error.stack}`);
        failed++;
      }
    }
    
    recordCreator.close();
    dbManager.close();
    
    console.log(`\n==================================================`);
    console.log('              Processing Complete!                ');
    console.log('==================================================\n');
    console.log(`  Total:     ${processed}`);
    console.log(`  Succeeded: ${succeeded}`);
    console.log(`  Skipped:   ${skipped}`);
    console.log(`  Failed:    ${failed}\n`);
    
  } catch (error) {
    console.error('\n✗ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Copy blob to standard location and create attachment record
 */
async function copyBlobAndCreateAttachment(recordCreator, pbuuid, gvuuid, sourceBlobPath, blobName, patchblob1_key, pat_sha224) {
  // Copy blob to standard BLOBS_DIR location (if not already there)
  const targetBlobPath = path.join(CONFIG.BLOBS_DIR, blobName);
  if (!fs.existsSync(targetBlobPath)) {
    fs.copyFileSync(sourceBlobPath, targetBlobPath);
    console.log(`    ✓ Copied blob to ${targetBlobPath}`);
  }
  
  // Use the standard createAttachmentRecord method
  // It expects blobData object with patchblob1_name, patchblob1_key, patchblob1_sha224
  const blobData = {
    patchblob1_name: blobName,
    patchblob1_key: patchblob1_key,
    patchblob1_sha224: sha224(fs.readFileSync(sourceBlobPath))
  };
  
  await recordCreator.createAttachmentRecord(pbuuid, gvuuid, blobData);
}

/**
 * Create rhpatch record (avoid duplicates)
 */
function createRhPatchRecord(dbManager, gameid, patchName) {
  if (!patchName) return;
  
  try {
    dbManager.db.prepare(`
      INSERT INTO rhpatches (rhpuuid, gameid, patch_name) 
      VALUES (?, ?, ?)
      ON CONFLICT(patch_name) DO NOTHING
    `).run(generateUUID(), gameid, patchName);
  } catch (error) {
    // Ignore duplicate errors
  }
}

// Execute main
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main, CONFIG };

