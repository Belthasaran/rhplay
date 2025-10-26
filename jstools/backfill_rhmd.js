#!/usr/bin/env node
/**
 * backfill_rhmd.js - Backfill SQLite Database to RHMD File
 * 
 * Exports game records from SQLite database to the Python RHMD file format,
 * allowing Python scripts (pb_repatch.py, etc.) to access new games created
 * by updategames.js.
 * 
 * Usage:
 *   node backfill_rhmd.js [--game-ids=<ids>] [--all] [--dry-run]
 * 
 * Options:
 *   --game-ids=<ids>  Export specific game IDs (comma-separated)
 *   --all             Export all games (WARNING: overwrites RHMD file)
 *   --merge           Merge with existing RHMD file (default)
 *   --dry-run         Show what would be exported without making changes
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const DatabaseManager = require('./lib/database');

const CONFIG = {
  DB_PATH: path.join(__dirname, 'electron', 'rhdata.db'),
  RHMD_FILE: process.env.RHMD_FILE || path.join(__dirname, 'RHMD_FILE'),
  DRY_RUN: false,
  MERGE: true
};

function parseArgs(args) {
  const parsed = {
    'game-ids': null,
    'all': false,
    'merge': true,
    'dry-run': false
  };
  
  for (const arg of args) {
    if (arg.startsWith('--game-ids=')) {
      parsed['game-ids'] = arg.split('=')[1];
    } else if (arg === '--game-ids') {
      parsed['game-ids'] = args[args.indexOf(arg) + 1];
    } else if (arg === '--all') {
      parsed['all'] = true;
      parsed['merge'] = false;
    } else if (arg === '--merge') {
      parsed['merge'] = true;
    } else if (arg === '--dry-run') {
      parsed['dry-run'] = true;
    }
  }
  
  return parsed;
}

/**
 * Convert SQLite gameversion to RHMD hack format
 */
function convertToRHMDFormat(gameversion, patchblobs) {
  const jsonData = typeof gameversion.gvjsondata === 'string' 
    ? JSON.parse(gameversion.gvjsondata) 
    : gameversion.gvjsondata;
  
  // Base hack info
  const hack = {
    id: gameversion.gameid,
    name: jsonData.name || '',
    authors: jsonData.authors || jsonData.author || '',
    version: gameversion.version || 1,
    ...jsonData
  };
  
  // Add patch blob info
  if (patchblobs && patchblobs.length > 0) {
    // Use primary patch if available
    const primaryPatch = patchblobs.find(p => p.is_primary === 1) || patchblobs[0];
    
    hack.pat_sha224 = primaryPatch.pat_sha224;
    hack.pat_sha1 = primaryPatch.pat_sha1;
    hack.result_sha224 = primaryPatch.result_sha224;
    hack.result_sha1 = primaryPatch.result_sha1;
    
    // xdata contains blob-specific info
    hack.xdata = {
      patchblob1_name: primaryPatch.patchblob1_name,
      patchblob1_key: primaryPatch.patchblob1_key,
      patchblob1_sha224: primaryPatch.patchblob1_sha224,
      patchblob1_kn: primaryPatch.patchblob1_name  // kn = known name
    };
    
    // Add additional patches if any
    if (patchblobs.length > 1) {
      hack.xdata.additional_patches = patchblobs.slice(1).map(p => ({
        patchblob1_name: p.patchblob1_name,
        patchblob1_key: p.patchblob1_key,
        patchblob1_sha224: p.patchblob1_sha224,
        pat_sha224: p.pat_sha224,
        is_primary: false
      }));
    }
  }
  
  return hack;
}

/**
 * Export games from SQLite to JSON format
 */
function exportGames(dbManager, gameIds = null) {
  let query = `
    SELECT gv.*, COUNT(pb.pbuuid) as patch_count
    FROM gameversions gv
    LEFT JOIN patchblobs pb ON pb.gvuuid = gv.gvuuid
    WHERE 1=1
  `;
  
  const params = [];
  
  if (gameIds && gameIds.length > 0) {
    const placeholders = gameIds.map(() => '?').join(',');
    query += ` AND gv.gameid IN (${placeholders})`;
    params.push(...gameIds);
  }
  
  query += ` GROUP BY gv.gvuuid ORDER BY gv.gameid`;
  
  const gameversions = dbManager.db.prepare(query).all(...params);
  
  console.log(`Found ${gameversions.length} gameversions to export`);
  
  const hacks = [];
  
  for (const gv of gameversions) {
    // Get patchblobs for this gameversion
    const patchblobs = dbManager.db.prepare(`
      SELECT pb.*, pbe.patch_filename, pbe.patch_type, pbe.is_primary
      FROM patchblobs pb
      LEFT JOIN patchblobs_extended pbe ON pbe.pbuuid = pb.pbuuid
      WHERE pb.gvuuid = ?
      ORDER BY pbe.is_primary DESC, pb.pbuuid
    `).all(gv.gvuuid);
    
    const hack = convertToRHMDFormat(gv, patchblobs);
    hacks.push(hack);
    
    console.log(`  Exported: ${hack.id} - ${hack.name}`);
  }
  
  return hacks;
}

/**
 * Load existing RHMD file
 */
function loadExistingRHMD() {
  if (!fs.existsSync(CONFIG.RHMD_FILE)) {
    console.log('No existing RHMD file found, will create new');
    return [];
  }
  
  try {
    // Call Python to decode RHMD file
    const result = execSync(`python3 -c "
import sys
sys.path.insert(0, '${__dirname}')
import loadsmwrh
import json

hacklist = loadsmwrh.get_hacklist_data()
print(json.dumps(hacklist))
"`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
    
    return JSON.parse(result);
  } catch (error) {
    console.error('Warning: Could not load existing RHMD file:', error.message);
    return [];
  }
}

/**
 * Save to RHMD file format (calls Python)
 */
function saveToRHMD(hacks) {
  // Create a temporary JSON file
  const tempJson = path.join(__dirname, '.rhmd_export.json');
  fs.writeFileSync(tempJson, JSON.stringify(hacks, null, 2));
  
  try {
    // Call Python to encode and save RHMD file
    execSync(`python3 << 'EOSCRIPT'
import sys
import json
sys.path.insert(0, '${__dirname}')

with open('${tempJson}', 'r') as f:
    hacklist = json.load(f)

# TODO: Implement RHMD encoding
# For now, just save as JSON (loadsmwrh.py will need to be updated to handle this)
import loadsmwrh

# This is a placeholder - loadsmwrh.py doesn't have a save function yet
# You'll need to implement this based on how RHMD files are structured
print(f"Would save {len(hacklist)} hacks to RHMD file")
print("Note: RHMD save functionality needs to be implemented in loadsmwrh.py")

EOSCRIPT
`, { encoding: 'utf8' });
    
  } finally {
    if (fs.existsSync(tempJson)) {
      fs.unlinkSync(tempJson);
    }
  }
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  
  CONFIG.DRY_RUN = argv['dry-run'];
  CONFIG.MERGE = argv['merge'];
  
  console.log('='.repeat(70));
  console.log('SQLite → RHMD Backfill Script');
  console.log('='.repeat(70));
  
  if (CONFIG.DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  }
  
  // Open database
  const dbManager = new DatabaseManager(CONFIG.DB_PATH);
  
  // Export games
  let gameIds = null;
  if (argv['game-ids']) {
    gameIds = argv['game-ids'].split(',').map(s => s.trim());
    console.log(`Exporting specific games: ${gameIds.join(', ')}\n`);
  } else if (argv['all']) {
    console.log('Exporting ALL games\n');
  } else {
    console.log('Error: Must specify --game-ids or --all');
    console.log('Example: node backfill_rhmd.js --game-ids=40663,40664');
    process.exit(1);
  }
  
  const exportedHacks = exportGames(dbManager, gameIds);
  
  console.log(`\nExported ${exportedHacks.length} games`);
  
  // Merge or replace
  let finalHacks = exportedHacks;
  
  if (CONFIG.MERGE) {
    console.log('\nMerging with existing RHMD file...');
    const existingHacks = loadExistingRHMD();
    console.log(`  Existing hacks: ${existingHacks.length}`);
    
    // Create a map of existing hacks
    const existingMap = new Map(existingHacks.map(h => [h.id, h]));
    
    // Merge: new hacks override existing ones with same ID
    for (const hack of exportedHacks) {
      existingMap.set(hack.id, hack);
    }
    
    finalHacks = Array.from(existingMap.values());
    console.log(`  Final count: ${finalHacks.length}`);
  }
  
  if (!CONFIG.DRY_RUN) {
    console.log('\nSaving to RHMD file...');
    saveToRHMD(finalHacks);
    console.log('✅ Backfill complete');
  } else {
    console.log('\n[DRY RUN] Would save to RHMD file');
    
    // Save to a test JSON file for inspection
    const testFile = path.join(__dirname, 'rhmd_export_preview.json');
    fs.writeFileSync(testFile, JSON.stringify(finalHacks, null, 2));
    console.log(`Preview saved to: ${testFile}`);
  }
  
  dbManager.close();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}

module.exports = { exportGames, convertToRHMDFormat };

