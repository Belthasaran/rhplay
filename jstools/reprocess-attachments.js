#!/usr/bin/env node
/**
 * reprocess-attachments.js - Reprocess Attachments for Existing Gameversions
 * 
 * Recreates attachment records for existing gameversions without touching
 * the gameversions or patchblobs tables. Useful for:
 * - Fixing missing decoded_* fields
 * - Reprocessing after blob decoding bugs
 * - Updating attachment metadata
 * 
 * Usage:
 *   node reprocess-attachments.js [options]
 * 
 * Options:
 *   --game-ids=<ids>    Process specific game IDs (comma-separated)
 *   --gvuuid=<uuid>     Process specific gameversion UUID
 *   --force             Reprocess even if attachments exist
 *   --dry-run           Show what would be done without making changes
 */

const path = require('path');
const DatabaseManager = require('./lib/database');
const RecordCreator = require('./lib/record-creator');

// Configuration
const CONFIG = {
  DB_PATH: path.join(__dirname, 'electron', 'rhdata.db'),
  PATCHBIN_DB_PATH: path.join(__dirname, 'electron', 'patchbin.db'),
  BLOBS_DIR: path.join(__dirname, 'blobs'),
  DRY_RUN: false,
  FORCE: false
};

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const parsed = {
    'game-ids': null,
    'gvuuid': null,
    'force': false,
    'dry-run': false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith('--game-ids=')) {
      parsed['game-ids'] = arg.split('=')[1];
    } else if (arg === '--game-ids') {
      parsed['game-ids'] = args[++i];
    } else if (arg.startsWith('--gvuuid=')) {
      parsed['gvuuid'] = arg.split('=')[1];
    } else if (arg === '--gvuuid') {
      parsed['gvuuid'] = args[++i];
    } else if (arg === '--force') {
      parsed['force'] = true;
    } else if (arg === '--dry-run') {
      parsed['dry-run'] = true;
    }
  }
  
  return parsed;
}

/**
 * Print help
 */
function printHelp() {
  console.log(`
reprocess-attachments.js - Reprocess Attachments for Existing Gameversions

Usage:
  node reprocess-attachments.js [options]

Options:
  --help, -h              Show this help message
  --game-ids=<ids>        Process specific game IDs (comma-separated)
  --gvuuid=<uuid>         Process specific gameversion UUID
  --force                 Reprocess even if attachments exist
  --dry-run               Show what would be done without making changes

Examples:
  node reprocess-attachments.js --game-ids=40663
  node reprocess-attachments.js --gvuuid=66150acb-364b-4612-ba59-144bdb5e245e
  node reprocess-attachments.js --force --game-ids=40663,40664
  node reprocess-attachments.js --dry-run
  `);
}

/**
 * Main function
 */
async function main() {
  const argv = parseArgs(process.argv.slice(2));
  
  CONFIG.DRY_RUN = argv['dry-run'];
  CONFIG.FORCE = argv['force'];
  
  console.log('==================================================');
  console.log('   rhtools - Reprocess Attachments Script       ');
  console.log('==================================================\n');
  
  if (CONFIG.DRY_RUN) {
    console.log('⚠  DRY RUN MODE - No changes will be made\n');
  }
  
  if (CONFIG.FORCE) {
    console.log('ⓘ  FORCE MODE - Will reprocess even if attachments exist\n');
  }
  
  let dbManager = null;
  let recordCreator = null;
  
  try {
    // Open databases
    dbManager = new DatabaseManager(CONFIG.DB_PATH);
    recordCreator = new RecordCreator(dbManager, CONFIG.PATCHBIN_DB_PATH, CONFIG);
    console.log('✓ Databases opened\n');
    
    // Build query to find gameversions
    let query = `
      SELECT DISTINCT gv.gvuuid, gv.gameid, pb.pbuuid, pb.patchblob1_name, pb.patchblob1_key
      FROM gameversions gv
      INNER JOIN patchblobs pb ON pb.gvuuid = gv.gvuuid
      WHERE 1=1
    `;
    
    const params = [];
    
    if (argv['gvuuid']) {
      query += ` AND gv.gvuuid = ?`;
      params.push(argv['gvuuid']);
    } else if (argv['game-ids']) {
      const gameIds = argv['game-ids'].split(',').map(s => s.trim());
      const placeholders = gameIds.map(() => '?').join(',');
      query += ` AND gv.gameid IN (${placeholders})`;
      params.push(...gameIds);
    }
    
    query += ` ORDER BY gv.gameid`;
    
    const patchblobs = dbManager.db.prepare(query).all(...params);
    
    console.log(`Found ${patchblobs.length} patchblobs to process\n`);
    
    if (patchblobs.length === 0) {
      console.log('Nothing to process.');
      return;
    }
    
    let processed = 0;
    let created = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const pb of patchblobs) {
      processed++;
      console.log(`\n[${processed}/${patchblobs.length}] Processing patchblob ${pb.pbuuid}`);
      console.log(`  Game: ${pb.gameid}, Gameversion: ${pb.gvuuid}`);
      console.log(`  Blob: ${pb.patchblob1_name}`);
      
      try {
        // Check if attachment already exists
        const existingAttachment = recordCreator.patchbinDb.prepare(`
          SELECT auuid, decoded_ipfs_cidv1, decoded_hash_sha224
          FROM attachments
          WHERE pbuuid = ?
        `).get(pb.pbuuid);
        
        if (existingAttachment && !CONFIG.FORCE) {
          const hasDecoded = existingAttachment.decoded_ipfs_cidv1 && 
                            existingAttachment.decoded_hash_sha224;
          
          if (hasDecoded) {
            console.log(`  ✓ Attachment exists with decoded fields, skipping`);
            skipped++;
            continue;
          } else {
            console.log(`  ⓘ Attachment exists but missing decoded fields, reprocessing`);
          }
        } else if (existingAttachment && CONFIG.FORCE) {
          console.log(`  ⓘ Force mode: Reprocessing existing attachment`);
        }
        
        if (CONFIG.DRY_RUN) {
          console.log(`  [DRY RUN] Would reprocess attachment for ${pb.patchblob1_name}`);
          created++;
          continue;
        }
        
        // Delete existing attachment if present
        if (existingAttachment) {
          recordCreator.patchbinDb.prepare(`
            DELETE FROM attachments WHERE auuid = ?
          `).run(existingAttachment.auuid);
          console.log(`  ✓ Deleted existing attachment ${existingAttachment.auuid}`);
        }
        
        // Create new attachment with proper decoding
        const blobData = {
          patchblob1_name: pb.patchblob1_name,
          patchblob1_key: pb.patchblob1_key,
          patchblob1_sha224: pb.patchblob1_name.split('_').pop()
        };
        
        const auuid = await recordCreator.createAttachmentRecord(
          pb.pbuuid,
          pb.gvuuid,
          blobData
        );
        
        console.log(`  ✓ Created attachment ${auuid}`);
        created++;
        
      } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        errors++;
      }
    }
    
    console.log('\n==================================================');
    console.log('               Processing Summary                 ');
    console.log('==================================================');
    console.log(`  Total:    ${processed}`);
    console.log(`  Created:  ${created}`);
    console.log(`  Skipped:  ${skipped}`);
    console.log(`  Errors:   ${errors}`);
    console.log('==================================================\n');
    
  } catch (error) {
    console.error('\n✗ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (recordCreator) {
      recordCreator.close();
    }
    if (dbManager) {
      dbManager.close();
    }
  }
}

// Execute main
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };

