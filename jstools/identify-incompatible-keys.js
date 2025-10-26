#!/usr/bin/env node
/**
 * identify-incompatible-keys.js - Identify Incompatible Encryption Keys
 * 
 * Scans the patchblobs table to find keys that are incompatible with
 * the Python loadsmwrh.py format.
 * 
 * Python expects: base64(urlsafe_base64(32_byte_key))
 * Incompatible:   base64(32_byte_key)
 * 
 * Usage:
 *   node identify-incompatible-keys.js [--fix] [--dry-run]
 */

const path = require('path');
const DatabaseManager = require('./lib/database');
const BlobCreator = require('./lib/blob-creator');
const fs = require('fs');

const CONFIG = {
  DB_PATH: path.join(__dirname, 'electron', 'rhdata.db'),
  BLOBS_DIR: path.join(__dirname, 'blobs'),
  PATCH_DIR: path.join(__dirname, 'patch'),
  ROM_DIR: path.join(__dirname, 'rom'),
  PBKDF2_ITERATIONS: 390000,
  FIX_KEYS: false,
  DRY_RUN: false
};

function parseArgs(args) {
  const parsed = { fix: false, 'dry-run': false };
  for (const arg of args) {
    if (arg === '--fix') parsed.fix = true;
    if (arg === '--dry-run') parsed['dry-run'] = true;
  }
  return parsed;
}

/**
 * Detect key format
 * Returns: 'double_urlsafe' | 'single_standard' | 'unknown'
 */
function detectKeyFormat(keyBase64) {
  try {
    const decoded = Buffer.from(keyBase64, 'base64').toString('utf8');
    
    // Check if it looks like base64 (including URL-safe chars)
    // A properly double-encoded key should decode to ~44 chars of base64
    if (/^[A-Za-z0-9+/\-_]+=*$/.test(decoded) && decoded.length >= 40 && decoded.length <= 50) {
      // This looks like double-encoded URL-safe base64
      const innerBuf = Buffer.from(decoded, 'base64');
      if (innerBuf.length === 32) {
        return 'double_urlsafe';
      }
    }
    
    // Check if it's single-encoded (decodes directly to 32 bytes)
    const directBuf = Buffer.from(keyBase64, 'base64');
    if (directBuf.length === 32) {
      // This is single-encoded - incompatible!
      return 'single_standard';
    }
    
    return 'unknown';
  } catch (error) {
    return 'unknown';
  }
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  CONFIG.FIX_KEYS = argv.fix;
  CONFIG.DRY_RUN = argv['dry-run'];
  
  console.log('==================================================');
  console.log('  Identify Incompatible Encryption Keys         ');
  console.log('==================================================\n');
  
  if (CONFIG.FIX_KEYS && !CONFIG.DRY_RUN) {
    console.log('⚠  FIX MODE - Will recreate blobs with correct keys\n');
  } else if (CONFIG.DRY_RUN) {
    console.log('ⓘ  DRY RUN MODE\n');
  }
  
  const dbManager = new DatabaseManager(CONFIG.DB_PATH);
  
  // Get all patchblobs with their keys
  const patchblobs = dbManager.db.prepare(`
    SELECT pb.pbuuid, pb.gvuuid, pb.patchblob1_name, pb.patchblob1_key, 
           pb.pat_sha224, pb.result_sha224, gv.gameid
    FROM patchblobs pb
    LEFT JOIN gameversions gv ON gv.gvuuid = pb.gvuuid
    WHERE pb.patchblob1_key IS NOT NULL AND pb.patchblob1_key != ''
    ORDER BY gv.gameid
  `).all();
  
  console.log(`Found ${patchblobs.length} patchblobs to check\n`);
  
  const results = {
    double_urlsafe: [],
    single_standard: [],
    unknown: [],
    missing_blob_file: []
  };
  
  for (const pb of patchblobs) {
    const format = detectKeyFormat(pb.patchblob1_key);
    const blobPath = path.join(CONFIG.BLOBS_DIR, pb.patchblob1_name);
    const blobExists = fs.existsSync(blobPath);
    
    const info = {
      gameid: pb.gameid || 'N/A',
      pbuuid: pb.pbuuid,
      blobName: pb.patchblob1_name,
      keyLength: pb.patchblob1_key.length,
      keyPreview: pb.patchblob1_key.substring(0, 20) + '...',
      blobExists: blobExists
    };
    
    if (!blobExists) {
      results.missing_blob_file.push(info);
    }
    
    results[format].push(info);
  }
  
  // Print results
  console.log('='.repeat(70));
  console.log('RESULTS:');
  console.log('='.repeat(70));
  
  console.log(`\n✓ Compatible Keys (double-encoded URL-safe): ${results.double_urlsafe.length}`);
  if (results.double_urlsafe.length > 0 && results.double_urlsafe.length <= 10) {
    results.double_urlsafe.forEach(info => {
      console.log(`  - Game ${info.gameid}: ${info.blobName} (${info.keyLength} chars)`);
    });
  } else if (results.double_urlsafe.length > 10) {
    console.log(`  (${results.double_urlsafe.length} games - too many to list)`);
  }
  
  console.log(`\n✗ INCOMPATIBLE Keys (single-encoded standard): ${results.single_standard.length}`);
  if (results.single_standard.length > 0) {
    results.single_standard.forEach(info => {
      const status = info.blobExists ? '✓' : '✗ MISSING BLOB';
      console.log(`  - Game ${info.gameid}: ${info.blobName} (${info.keyLength} chars) ${status}`);
    });
  }
  
  console.log(`\n? Unknown Format: ${results.unknown.length}`);
  if (results.unknown.length > 0) {
    results.unknown.forEach(info => {
      console.log(`  - Game ${info.gameid}: ${info.blobName} (${info.keyLength} chars)`);
    });
  }
  
  if (results.missing_blob_file.length > 0) {
    console.log(`\n⚠  Missing Blob Files: ${results.missing_blob_file.length}`);
    results.missing_blob_file.forEach(info => {
      console.log(`  - Game ${info.gameid}: ${info.blobName}`);
    });
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY:');
  console.log('='.repeat(70));
  console.log(`  Total patchblobs:        ${patchblobs.length}`);
  console.log(`  Compatible (Python):     ${results.double_urlsafe.length}`);
  console.log(`  Incompatible:            ${results.single_standard.length}`);
  console.log(`  Unknown:                 ${results.unknown.length}`);
  console.log(`  Missing blob files:      ${results.missing_blob_file.length}`);
  
  if (results.single_standard.length > 0) {
    console.log('\n⚠  INCOMPATIBLE KEYS FOUND!');
    console.log('These keys will NOT work with Python scripts (loadsmwrh.py, pb_repatch.py)');
    console.log('\nTo fix these games, you need to:');
    console.log('1. Delete the gameversion records for the affected games');
    console.log('2. Delete the queue entries');
    console.log('3. Re-run updategames.js with the corrected blob-creator.js');
    console.log('\nExample:');
    console.log('  sqlite3 electron/rhdata.db "DELETE FROM gameversions WHERE gameid IN (\'40663\')"');
    console.log('  sqlite3 electron/rhdata.db "DELETE FROM game_fetch_queue WHERE gameid=\'40663\'"');
    console.log('  node updategames.js --game-ids=40663 --all-patches');
    
    // Generate a SQL script
    const gameIds = [...new Set(results.single_standard.map(i => i.gameid).filter(id => id !== 'N/A'))];
    if (gameIds.length > 0) {
      const scriptPath = path.join(__dirname, 'fix-incompatible-keys.sql');
      const sqlScript = [
        '-- SQL Script to Remove Games with Incompatible Keys',
        '-- Run this before re-processing the games with updategames.js',
        '',
        '-- Delete gameversions',
        `DELETE FROM gameversions WHERE gameid IN (${gameIds.map(id => `'${id}'`).join(', ')});`,
        '',
        '-- Delete orphaned patchblobs',
        'DELETE FROM patchblobs WHERE gvuuid NOT IN (SELECT gvuuid FROM gameversions);',
        '',
        '-- Delete orphaned attachments (in patchbin.db)',
        '-- Run this in patchbin.db:',
        '-- DELETE FROM attachments WHERE gvuuid NOT IN (SELECT gvuuid FROM gameversions);',
        '',
        '-- Delete queue entries',
        `DELETE FROM game_fetch_queue WHERE gameid IN (${gameIds.map(id => `'${id}'`).join(', ')});`,
        '',
        `-- Then re-run: node updategames.js --game-ids=${gameIds.join(',')} --all-patches`
      ].join('\n');
      
      fs.writeFileSync(scriptPath, sqlScript);
      console.log(`\n✓ SQL cleanup script written to: ${scriptPath}`);
    }
  }
  
  console.log('');
  dbManager.close();
}

main().catch(console.error);

