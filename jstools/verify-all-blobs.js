#!/usr/bin/env node
/**
 * verify-all-blobs.js - Comprehensive Blob Verification
 * 
 * Verifies all patchblobs in the SQLite database can be decoded and are valid.
 * 
 * Usage:
 *   node verify-all-blobs.js [options]
 * 
 * Options:
 *   --verify-blobs=<source>  Source to verify: 'db' or 'files' (default: files)
 *                            db = verify from patchbin.db file_data column
 *                            files = verify from blob files in blobs/ directory
 *   --gameid=<id>            Verify specific game ID only
 *   --file-name=<name>       Verify specific blob file only
 *   --full-check             Test patches with flips (slow, comprehensive)
 *   --verify-result          Verify flips result hash against result_sha224 (requires --full-check)
 *   --newer-than=<value>     Only verify blobs newer than timestamp or blob file_name
 *                            (value can be ISO date/timestamp or a patchblob file_name)
 *   --log-file=<path>        Log results to file (default: verification_results.log)
 *   --failed-file=<path>     Save failed items list (default: failed_blobs.json)
 * 
 * Exit codes:
 *   0 - All blobs valid
 *   1 - Some blobs failed verification
 *   2 - Fatal error
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const DatabaseManager = require('./lib/database');
const RecordCreator = require('./lib/record-creator');
const { getFlipsPath, getSmwRomPath } = require('./lib/binary-finder');

const CONFIG = {
  DB_PATH: path.join(__dirname, 'electron', 'rhdata.db'),
  PATCHBIN_DB_PATH: path.join(__dirname, 'electron', 'patchbin.db'),
  BLOBS_DIR: path.join(__dirname, 'blobs'),
  TEMP_DIR: path.join(__dirname, 'temp'),
  LOG_FILE: 'verification_results.log',
  FAILED_FILE: 'failed_blobs.json',
  VERIFY_SOURCE: 'files',  // 'files' or 'db'
  FULL_CHECK: false,
  VERIFY_RESULT: false,  // Verify flips result hash
  GAMEID: null,
  FILE_NAME: null,
  NEWER_THAN: null,  // Timestamp or blob file_name
  FLIPS_PATH: null,
  BASE_ROM_PATH: null
};

function parseArgs(args) {
  const parsed = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--verify-blobs=')) {
      parsed.verifySource = arg.split('=')[1];
    } else if (arg === '--verify-blobs') {
      parsed.verifySource = args[++i];
    } else if (arg.startsWith('--gameid=')) {
      parsed.gameid = arg.split('=')[1];
    } else if (arg === '--gameid') {
      parsed.gameid = args[++i];
    } else if (arg.startsWith('--file-name=')) {
      parsed.fileName = arg.split('=')[1];
    } else if (arg === '--file-name') {
      parsed.fileName = args[++i];
    } else if (arg === '--full-check') {
      parsed.fullCheck = true;
    } else if (arg === '--verify-result') {
      parsed.verifyResult = true;
    } else if (arg.startsWith('--newer-than=')) {
      parsed.newerThan = arg.split('=')[1];
    } else if (arg === '--newer-than') {
      parsed.newerThan = args[++i];
    } else if (arg.startsWith('--log-file=')) {
      parsed.logFile = arg.split('=')[1];
    } else if (arg === '--log-file') {
      parsed.logFile = args[++i];
    } else if (arg.startsWith('--failed-file=')) {
      parsed.failedFile = arg.split('=')[1];
    } else if (arg === '--failed-file') {
      parsed.failedFile = args[++i];
    }
  }
  
  return parsed;
}

class VerificationLogger {
  constructor(logFile) {
    this.logFile = logFile;
    this.logStream = logFile ? fs.createWriteStream(logFile, { flags: 'w' }) : null;
  }
  
  log(message) {
    console.log(message);
    if (this.logStream) {
      this.logStream.write(message + '\n');
    }
  }
  
  close() {
    if (this.logStream) {
      this.logStream.end();
    }
  }
}

async function verifyBlob(patchblob, recordCreator, patchbinDb, logger, fullCheck = false, verifyResult = false, verifySource = 'files') {
  const gameid = patchblob.gameid || 'N/A';
  const blobName = patchblob.patchblob1_name;
  
  const result = {
    gameid,
    pbuuid: patchblob.pbuuid,
    patchblob1_name: blobName,
    source_checked: verifySource,
    file_exists: false,
    file_hash_valid: false,
    decode_success: false,
    patch_hash_valid: false,
    flips_test_success: false,
    result_hash_valid: false,
    errors: []
  };
  
  let fileData = null;
  
  try {
    // Get blob data from appropriate source
    if (verifySource === 'db') {
      // Check 1: Get blob from patchbin.db file_data column
      const attachment = patchbinDb.prepare(`
        SELECT file_data, file_hash_sha224 
        FROM attachments 
        WHERE file_name = ?
      `).get(blobName);
      
      if (!attachment || !attachment.file_data) {
        result.errors.push('Attachment not found in database or file_data is NULL');
        return result;
      }
      result.file_exists = true;
      
      fileData = attachment.file_data;
      
      // Verify against stored hash
      const fileHash = crypto.createHash('sha224').update(fileData).digest('hex');
      if (fileHash !== attachment.file_hash_sha224) {
        result.errors.push(`DB file_hash_sha224 mismatch: expected ${attachment.file_hash_sha224}, got ${fileHash}`);
        return result;
      }
      
    } else {
      // Check 1: Blob file exists on filesystem
      const blobPath = path.join(CONFIG.BLOBS_DIR, blobName);
      
      if (!fs.existsSync(blobPath)) {
        result.errors.push('Blob file not found on filesystem');
        return result;
      }
      result.file_exists = true;
      
      fileData = fs.readFileSync(blobPath);
    }
    
    // Check 2: File hash matches patchblob1_sha224
    const fileHash = crypto.createHash('sha224').update(fileData).digest('hex');
    
    if (fileHash !== patchblob.patchblob1_sha224) {
      result.errors.push(`File hash mismatch: expected ${patchblob.patchblob1_sha224}, got ${fileHash}`);
      return result;
    }
    result.file_hash_valid = true;
    
    // Check 3: Blob can be decoded
    let decodedData;
    try {
      decodedData = await recordCreator.decodeBlob(fileData, patchblob.patchblob1_key);
      result.decode_success = true;
    } catch (error) {
      result.errors.push(`Decode failed: ${error.message}`);
      return result;
    }
    
    // Check 4: Decoded hash matches
    const decodedHash = crypto.createHash('sha224').update(decodedData).digest('hex');
    
    if (decodedHash !== patchblob.pat_sha224) {
      result.errors.push(`Patch hash mismatch: expected ${patchblob.pat_sha224}, got ${decodedHash}`);
      return result;
    }
    result.patch_hash_valid = true;
    
    // Check 5: Full check with flips (optional)
    if (fullCheck && CONFIG.FLIPS_PATH && CONFIG.BASE_ROM_PATH) {
      try {
        const tempPatch = path.join(CONFIG.TEMP_DIR, `verify_${blobName}.patch`);
        const tempRom = path.join(CONFIG.TEMP_DIR, `verify_${blobName}.sfc`);
        
        fs.writeFileSync(tempPatch, decodedData);
        
        const flipsCmd = `"${CONFIG.FLIPS_PATH}" --apply "${tempPatch}" "${CONFIG.BASE_ROM_PATH}" "${tempRom}"`;
        execSync(flipsCmd, { stdio: 'pipe' });
        
        result.flips_test_success = true;
        
        // Check 6: Verify result hash (optional)
        if (verifyResult && patchblob.result_sha224 && fs.existsSync(tempRom)) {
          const resultData = fs.readFileSync(tempRom);
          const resultHash = crypto.createHash('sha224').update(resultData).digest('hex');
          
          if (resultHash === patchblob.result_sha224) {
            result.result_hash_valid = true;
          } else {
            result.errors.push(`Result hash mismatch: expected ${patchblob.result_sha224}, got ${resultHash}`);
            result.flips_test_success = false; // Override - result doesn't match despite success
          }
        } else if (verifyResult && !patchblob.result_sha224) {
          // No expected hash to verify against - skip
          result.result_hash_valid = null;
        }
        
        // Clean up
        fs.unlinkSync(tempPatch);
        if (fs.existsSync(tempRom)) {
          fs.unlinkSync(tempRom);
        }
        
      } catch (error) {
        result.errors.push(`Flips test failed: ${error.message}`);
      }
    }
    
  } catch (error) {
    result.errors.push(`Unexpected error: ${error.message}`);
  }
  
  return result;
}

async function resolveNewerThanTimestamp(newerThanValue, dbManager, patchbinDb) {
  // Check if it's a blob file_name or a timestamp
  // First, try to look it up as a blob file_name
  
  // Check if it looks like a patchblob filename
  if (newerThanValue.startsWith('pblob_') || newerThanValue.startsWith('rblob_')) {
    // Query patchblobs table for pbimport_time
    const patchblob = dbManager.db.prepare(
      'SELECT pbimport_time FROM patchblobs WHERE patchblob1_name = ?'
    ).get(newerThanValue);
    
    const timestamps = [];
    
    if (patchblob && patchblob.pbimport_time) {
      timestamps.push(patchblob.pbimport_time);
    }
    
    // Query attachments table for updated_time and import_time (from patchbin.db)
    if (patchbinDb) {
      const attachment = patchbinDb.prepare(
        'SELECT updated_time, import_time FROM attachments WHERE file_name = ?'
      ).get(newerThanValue);
      
      if (attachment) {
        if (attachment.updated_time) timestamps.push(attachment.updated_time);
        if (attachment.import_time) timestamps.push(attachment.import_time);
      }
    }
    
    if (timestamps.length === 0) {
      throw new Error(`Blob ${newerThanValue} not found or has no valid timestamps`);
    }
    
    // Return the latest timestamp
    const latest = timestamps.reduce((max, ts) => ts > max ? ts : max);
    console.log(`Using timestamp from blob ${newerThanValue}: ${latest}`);
    return latest;
  }
  
  // Not a blob name - treat as timestamp
  // Try to parse as ISO date or timestamp
  try {
    const date = new Date(newerThanValue);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date');
    }
    const timestamp = date.toISOString();
    console.log(`Using specified timestamp: ${timestamp}`);
    return timestamp;
  } catch (error) {
    throw new Error(`Invalid --newer-than value: ${newerThanValue}. Must be a valid blob file_name or ISO date/timestamp.`);
  }
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  
  CONFIG.VERIFY_SOURCE = argv.verifySource || CONFIG.VERIFY_SOURCE;
  CONFIG.GAMEID = argv.gameid || null;
  CONFIG.FILE_NAME = argv.fileName || null;
  CONFIG.FULL_CHECK = argv.fullCheck || false;
  CONFIG.VERIFY_RESULT = argv.verifyResult || false;
  CONFIG.NEWER_THAN = argv.newerThan || null;
  CONFIG.LOG_FILE = argv.logFile || CONFIG.LOG_FILE;
  CONFIG.FAILED_FILE = argv.failedFile || CONFIG.FAILED_FILE;
  
  // Verify-result requires full-check
  if (CONFIG.VERIFY_RESULT && !CONFIG.FULL_CHECK) {
    console.error('Error: --verify-result requires --full-check');
    process.exit(2);
  }
  
  // Validate verify source
  if (CONFIG.VERIFY_SOURCE !== 'files' && CONFIG.VERIFY_SOURCE !== 'db') {
    console.error(`Error: --verify-blobs must be 'files' or 'db', got '${CONFIG.VERIFY_SOURCE}'`);
    process.exit(2);
  }
  
  console.log('='.repeat(70));
  console.log('BLOB VERIFICATION UTILITY');
  console.log('='.repeat(70));
  console.log(`Verification source: ${CONFIG.VERIFY_SOURCE === 'db' ? 'patchbin.db file_data' : 'blob files'}\n`);
  
  if (CONFIG.FULL_CHECK) {
    console.log('⚠️  FULL CHECK MODE - Will test patches with flips (SLOW)');
    if (CONFIG.VERIFY_RESULT) {
      console.log('⚠️  VERIFY RESULT MODE - Will verify result_sha224 hash\n');
    } else {
      console.log('');
    }
    
    try {
      CONFIG.FLIPS_PATH = getFlipsPath({ projectRoot: __dirname });
      CONFIG.BASE_ROM_PATH = getSmwRomPath({ projectRoot: __dirname, throwOnError: true });
      console.log(`✓ Flips: ${CONFIG.FLIPS_PATH}`);
      console.log(`✓ Base ROM: ${CONFIG.BASE_ROM_PATH}\n`);
    } catch (error) {
      console.error('✗ Cannot run full check:', error.message);
      console.log('Continuing without flips verification...\n');
      CONFIG.FULL_CHECK = false;
    }
  }
  
  if (CONFIG.LOG_FILE) {
    console.log(`📝 Logging to: ${CONFIG.LOG_FILE}\n`);
  }
  
  const logger = new VerificationLogger(CONFIG.LOG_FILE);
  
  try {
    const dbManager = new DatabaseManager(CONFIG.DB_PATH);
    const recordCreator = new RecordCreator(dbManager, CONFIG.PATCHBIN_DB_PATH, CONFIG);
    
    // Open patchbin database if verifying from db or if newer-than is specified
    const Database = require('better-sqlite3');
    const patchbinDb = (CONFIG.VERIFY_SOURCE === 'db' || CONFIG.NEWER_THAN)
      ? new Database(CONFIG.PATCHBIN_DB_PATH, { readonly: true })
      : null;
    
    // Build query
    // Resolve newer-than timestamp if specified
    let newerThanTimestamp = null;
    if (CONFIG.NEWER_THAN) {
      newerThanTimestamp = await resolveNewerThanTimestamp(CONFIG.NEWER_THAN, dbManager, patchbinDb);
      logger.log(`Filtering to blobs newer than: ${newerThanTimestamp}\n`);
    }
    
    let query = `
      SELECT pb.*, gv.gameid
      FROM patchblobs pb
      LEFT JOIN gameversions gv ON gv.gvuuid = pb.gvuuid
      WHERE pb.patchblob1_key IS NOT NULL
    `;
    
    const params = [];
    
    if (CONFIG.GAMEID) {
      query += ` AND gv.gameid = ?`;
      params.push(CONFIG.GAMEID);
      logger.log(`Filtering to game ID: ${CONFIG.GAMEID}`);
    }
    
    if (CONFIG.FILE_NAME) {
      query += ` AND pb.patchblob1_name = ?`;
      params.push(CONFIG.FILE_NAME);
      logger.log(`Filtering to file: ${CONFIG.FILE_NAME}`);
    }
    
    if (newerThanTimestamp) {
      // Attach patchbin.db to query attachments table
      dbManager.db.prepare(`ATTACH DATABASE '${CONFIG.PATCHBIN_DB_PATH}' AS patchbin`).run();
      
      query = `
        SELECT pb.*, gv.gameid
        FROM patchblobs pb
        LEFT JOIN gameversions gv ON gv.gvuuid = pb.gvuuid
        LEFT JOIN patchbin.attachments a ON a.file_name = pb.patchblob1_name
        WHERE pb.patchblob1_key IS NOT NULL
      `;
      
      // Re-apply filters
      params.length = 0;
      
      if (CONFIG.GAMEID) {
        query += ` AND gv.gameid = ?`;
        params.push(CONFIG.GAMEID);
      }
      
      if (CONFIG.FILE_NAME) {
        query += ` AND pb.patchblob1_name = ?`;
        params.push(CONFIG.FILE_NAME);
      }
      
      // Filter by any of the three timestamps
      query += ` AND (pb.pbimport_time >= ? OR a.updated_time >= ? OR a.import_time >= ?)`;
      params.push(newerThanTimestamp, newerThanTimestamp, newerThanTimestamp);
    }
    
    query += ` ORDER BY gv.gameid`;
    
    const patchblobs = dbManager.db.prepare(query).all(...params);
    
    logger.log(`\nFound ${patchblobs.length} patchblobs to verify\n`);
    logger.log('='.repeat(70));
    
    let verified = 0;
    let failed = 0;
    const failures = [];
    
    for (let i = 0; i < patchblobs.length; i++) {
      const pb = patchblobs[i];
      const progress = `[${i + 1}/${patchblobs.length}]`;
      
      logger.log(`\n${progress} Game ${pb.gameid || 'N/A'}: ${pb.patchblob1_name}`);
      
      const result = await verifyBlob(pb, recordCreator, patchbinDb, logger, CONFIG.FULL_CHECK, CONFIG.VERIFY_RESULT, CONFIG.VERIFY_SOURCE);
      
      if (result.errors.length === 0 && result.patch_hash_valid) {
        let statusMsg = '  ✅ VALID';
        if (CONFIG.FULL_CHECK && result.flips_test_success) {
          statusMsg += ' (flips test passed';
          if (CONFIG.VERIFY_RESULT && result.result_hash_valid) {
            statusMsg += ', result hash verified';
          }
          statusMsg += ')';
        }
        logger.log(statusMsg);
        verified++;
      } else {
        logger.log(`  ❌ FAILED:`);
        result.errors.forEach(err => logger.log(`     - ${err}`));
        failed++;
        failures.push(result);
      }
    }
    
    logger.log('\n' + '='.repeat(70));
    logger.log('VERIFICATION SUMMARY');
    logger.log('='.repeat(70));
    logger.log(`Total blobs:    ${patchblobs.length}`);
    logger.log(`✅ Valid:        ${verified}`);
    logger.log(`❌ Failed:       ${failed}`);
    logger.log('='.repeat(70));
    
    // Save failures to file
    if (failures.length > 0) {
      const failedData = {
        timestamp: new Date().toISOString(),
        total_checked: patchblobs.length,
        failed_count: failed,
        failures: failures.map(f => ({
          gameid: f.gameid,
          pbuuid: f.pbuuid,
          patchblob1_name: f.patchblob1_name,
          errors: f.errors,
          checks: {
            file_exists: f.file_exists,
            file_hash_valid: f.file_hash_valid,
            decode_success: f.decode_success,
            patch_hash_valid: f.patch_hash_valid,
            flips_test_success: f.flips_test_success
          }
        }))
      };
      
      fs.writeFileSync(CONFIG.FAILED_FILE, JSON.stringify(failedData, null, 2));
      logger.log(`\n❌ Failed blobs saved to: ${CONFIG.FAILED_FILE}`);
    }
    
    if (patchbinDb) {
      patchbinDb.close();
    }
    recordCreator.close();
    dbManager.close();
    logger.close();
    
    process.exit(failed > 0 ? 1 : 0);
    
  } catch (error) {
    logger.log(`\n❌ Fatal error: ${error.message}`);
    logger.log(error.stack);
    logger.close();
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

module.exports = { verifyBlob };

