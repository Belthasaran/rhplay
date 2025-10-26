#!/usr/bin/env node

/**
 * updategames.js - Consolidated Game Update Script
 * 
 * Fetches new games from SMWC, downloads ZIPs, extracts patches,
 * creates encrypted blobs, and updates the database.
 * 
 * Usage:
 *   node updategames.js [options]
 *   npm run updategames [-- options]
 * 
 * See docs/NEW_UPDATE_SCRIPT_SPEC.md for full documentation
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Import modules
const DatabaseManager = require('./lib/database');
const SMWCFetcher = require('./lib/smwc-fetcher');
const GameDownloader = require('./lib/game-downloader');
const PatchProcessor = require('./lib/patch-processor');
const BlobCreator = require('./lib/blob-creator');
const RecordCreator = require('./lib/record-creator');
const UpdateProcessor = require('./lib/update-processor');
const StatsManager = require('./lib/stats-manager');
const { getFlipsPath, getSmwRomPath, SMW_EXPECTED_SHA224 } = require('./lib/binary-finder');

// Configuration
const CONFIG = {
  // Rate limiting
  SMWC_REQUEST_DELAY: 10000,        // 60 seconds between requests
  SMWC_EXTRA_DELAY: 10000,          // Extra 10 second delay
  DOWNLOAD_RETRY_MAX: 3,
  DOWNLOAD_TIMEOUT: 120000,         // 2 minutes
  
  // Paths
  DB_PATH: path.join(__dirname, 'electron', 'rhdata.db'),
  PATCHBIN_DB_PATH: path.join(__dirname, 'electron', 'patchbin.db'),
  ZIPS_DIR: path.join(__dirname, 'zips'),
  PATCH_DIR: path.join(__dirname, 'patch'),
  ROM_DIR: path.join(__dirname, 'rom'),
  BLOBS_DIR: path.join(__dirname, 'blobs'),
  TEMP_DIR: path.join(__dirname, 'temp'),
  HACKS_DIR: path.join(__dirname, 'hacks'),
  META_DIR: path.join(__dirname, 'meta'),
  PAT_META_DIR: path.join(__dirname, 'pat_meta'),
  ROM_META_DIR: path.join(__dirname, 'rom_meta'),
  
  // Base ROM (will be set during initialization)
  BASE_ROM_PATH: null,
  BASE_ROM_SHA224: SMW_EXPECTED_SHA224,
  
  // SMWC API
  SMWC_BASE_URL: 'https://www.smwcentral.net/',
  
  // User Agent
  USER_AGENT: 'rhtools-updategames/1.0',
  
  // Flips utility (will be set during initialization)
  FLIPS_PATH: null,
  
  // Encryption settings
  PBKDF2_ITERATIONS: 390000,
  
  // Options (can be overridden by command line)
  PROCESS_ALL_PATCHES: false,
  DRY_RUN: false,
  
  // Blob creation method (Python = universal compatibility, JavaScript = faster but different format)
  USE_PYTHON_BLOB_CREATOR: true,  // Default: true for maximum compatibility
  
  // Phase 2 options
  CHECK_UPDATES: true,
  UPDATE_STATS_ONLY: false,
  HEAD_REQUEST_SIZE_THRESHOLD: 5 * 1024 * 1024, // 5 MB
  SIZE_CHANGE_THRESHOLD_PERCENT: 5,
};

// Command line argument parsing
const argv = parseArgs(process.argv.slice(2));

// Apply command line overrides
if (argv['all-patches']) {
  CONFIG.PROCESS_ALL_PATCHES = true;
}
if (argv['dry-run']) {
  CONFIG.DRY_RUN = true;
}
if (argv['use-js-blobs']) {
  CONFIG.USE_PYTHON_BLOB_CREATOR = false;
}

/**
 * Simple argument parser
 */
function parseArgs(args) {
  const parsed = {
    'fetch-metadata': true,
    'process-new': true,
    'all-patches': false,
    'resume': false,
    'dry-run': false,
    'game-ids': null,
    'limit': null,
    'check-updates': true,
    'update-stats-only': false,
    'use-js-blobs': false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--all-patches') {
      parsed['all-patches'] = true;
    } else if (arg === '--dry-run') {
      parsed['dry-run'] = true;
    } else if (arg === '--resume') {
      parsed['resume'] = true;
    } else if (arg === '--no-fetch-metadata') {
      parsed['fetch-metadata'] = false;
    } else if (arg === '--no-process-new') {
      parsed['process-new'] = false;
    } else if (arg === '--no-check-updates') {
      parsed['check-updates'] = false;
    } else if (arg === '--update-stats-only') {
      parsed['update-stats-only'] = true;
    } else if (arg === '--use-js-blobs') {
      parsed['use-js-blobs'] = true;
    } else if (arg.startsWith('--game-ids=')) {
      parsed['game-ids'] = arg.split('=')[1];
    } else if (arg === '--game-ids') {
      parsed['game-ids'] = args[++i];
    } else if (arg.startsWith('--limit=')) {
      parsed['limit'] = parseInt(arg.split('=')[1]);
    } else if (arg === '--limit') {
      parsed['limit'] = parseInt(args[++i]);
    }
  }
  
  return parsed;
}

/**
 * Print help
 */
function printHelp() {
  console.log(`
updategames.js - Consolidated Game Update Script

Usage:
  node updategames.js [options]

Options:
  --help, -h              Show this help message
  --all-patches           Process all patch files, not just primary
  --dry-run               Simulate operations without database changes
  --resume                Resume from previous interrupted run
  --no-fetch-metadata     Skip fetching metadata from SMWC
  --no-process-new        Skip processing new games
  --game-ids=<ids>        Process specific game IDs (comma-separated)
  --limit=<n>             Limit number of games to process
  --use-js-blobs          Use JavaScript blob creator (faster, double base64)
                          Default: use Python blob creator (universal compatibility)

Examples:
  node updategames.js
  node updategames.js --all-patches
  node updategames.js --game-ids=12345,12346
  node updategames.js --dry-run --limit=5
  node updategames.js --resume
  node updategames.js --use-js-blobs  # Use JavaScript instead of Python

For full documentation, see docs/NEW_UPDATE_SCRIPT_SPEC.md
  `);
}

/**
 * Main function
 */
async function main() {
  console.log('==================================================');
  console.log('       rhtools - Update Games Script v1.0        ');
  console.log('==================================================\n');
  
  if (CONFIG.DRY_RUN) {
    console.log('⚠  DRY RUN MODE - No database changes will be made\n');
  }
  
  if (CONFIG.PROCESS_ALL_PATCHES) {
    console.log('ⓘ  Processing all patches (not just primary)\n');
  }
  
  // Initialize databases
  let dbManager = null;
  let recordCreator = null;
  
  try {
    console.log('Initializing...');
    
    // Verify prerequisites
    await verifyPrerequisites();
    
    // Open databases
    dbManager = new DatabaseManager(CONFIG.DB_PATH);
    console.log('  ✓ Database opened\n');
    
    // Clear expired cache
    const expired = dbManager.clearExpiredCache();
    if (expired > 0) {
      console.log(`  ✓ Cleared ${expired} expired cache entries\n`);
    }
    
    let gamesList = [];
    
    // Step 1: Fetch metadata (if enabled)
    if (argv['fetch-metadata']) {
      console.log('[Step 1/5] Fetching metadata from SMWC...');
      gamesList = await fetchMetadata(dbManager);
      console.log(`  ✓ Fetched ${gamesList.length} games\n`);
    } else {
      console.log('[Step 1/5] Skipping metadata fetch\n');
    }
    
    // Step 2: Identify new games
    console.log('[Step 2/5] Identifying new games...');
    const newGames = await identifyNewGames(dbManager, gamesList, argv);
    console.log(`  ✓ Found ${newGames.length} new games\n`);
    
    if (newGames.length === 0 && argv['process-new']) {
      console.log('No new games to process.');
      return;
    }
    
    // Step 3: Download and process games
    if (argv['process-new'] && newGames.length > 0) {
      console.log('[Step 3/5] Processing games...');
      await processGames(dbManager, newGames);
    } else {
      console.log('[Step 3/5] Skipping game processing\n');
    }
    
    // Step 4: Create blobs
    console.log('[Step 4/5] Creating encrypted blobs...');
    await createBlobs(dbManager, argv);
    
    // Step 5: Create database records
    console.log('[Step 5/6] Creating database records...');
    recordCreator = new RecordCreator(dbManager, CONFIG.PATCHBIN_DB_PATH, CONFIG);
    await createDatabaseRecords(dbManager, recordCreator, argv);
    
    // Step 6: Check for updates to existing games (Phase 2)
    if (argv['check-updates'] && gamesList.length > 0) {
      console.log('[Step 6/6] Checking for updates to existing games...');
      
      // Apply game-ids filter if specified
      let filteredGamesList = gamesList;
      if (argv['game-ids']) {
        const requestedIds = argv['game-ids'].split(',').map(s => s.trim());
        filteredGamesList = gamesList.filter(game => 
          requestedIds.includes(String(game.id))
        );
        console.log(`  Filtered to specific IDs: ${filteredGamesList.length} games\n`);
      }
      
      await checkExistingGameUpdates(dbManager, filteredGamesList, argv);
    } else {
      console.log('[Step 6/6] Skipping update detection\n');
    }
    
    console.log('\n==================================================');
    console.log('              Update Complete!                    ');
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

/**
 * Verify prerequisites
 */
async function verifyPrerequisites() {
  console.log('  Verifying prerequisites...');
  
  // Check base ROM using the finder
  try {
    CONFIG.BASE_ROM_PATH = getSmwRomPath({ 
      projectRoot: __dirname,
      throwOnError: true
    });
    console.log(`    ✓ Base ROM verified`);
  } catch (error) {
    throw error;
  }
  
  // Check flips utility using the finder
  try {
    CONFIG.FLIPS_PATH = getFlipsPath({ projectRoot: __dirname });
    console.log(`    ✓ Flips utility found`);
  } catch (error) {
    throw error;
  }
  
  // Check/create directories
  const dirs = [
    CONFIG.ZIPS_DIR,
    CONFIG.PATCH_DIR,
    CONFIG.ROM_DIR,
    CONFIG.BLOBS_DIR,
    CONFIG.TEMP_DIR,
    CONFIG.HACKS_DIR,
    CONFIG.META_DIR,
    CONFIG.PAT_META_DIR,
    CONFIG.ROM_META_DIR
  ];
  
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`    ✓ Created directory: ${path.basename(dir)}/`);
    }
  }
  
  console.log('    ✓ All prerequisites verified');
}

/**
 * Fetch metadata from SMWC
 */
async function fetchMetadata(dbManager) {
  const uuuid = dbManager.createUpdateStatus('metadata_fetch', {
    started: new Date().toISOString()
  });
  
  try {
    const fetcher = new SMWCFetcher(dbManager, CONFIG);
    const games = await fetcher.fetchCompleteGameList();
    
    dbManager.updateUpdateStatus(uuuid, 'completed');
    
    return games;
    
  } catch (error) {
    dbManager.updateUpdateStatus(uuuid, 'failed', error.message);
    throw error;
  }
}

/**
 * Identify new games not in database
 */
async function identifyNewGames(dbManager, gamesList, argv) {
  // Get existing game IDs
  const existingIds = new Set(dbManager.getExistingGameIds());
  
  console.log(`  Existing games in database: ${existingIds.size}`);
  
  // Filter for new games
  let newGames = gamesList.filter(game => {
    const gameid = String(game.id);
    return !existingIds.has(gameid);
  });
  
  console.log(`  New games found: ${newGames.length}`);
  
  // Apply filters from command line
  if (argv['game-ids']) {
    const requestedIds = argv['game-ids'].split(',').map(s => s.trim());
    newGames = newGames.filter(game => 
      requestedIds.includes(String(game.id))
    );
    console.log(`  Filtered to specific IDs: ${newGames.length}`);
  }
  
  if (argv.limit && argv.limit > 0) {
    newGames = newGames.slice(0, argv.limit);
    console.log(`  Limited to: ${newGames.length}`);
  }
  
  return newGames;
}

/**
 * Process games (download, extract, test patches)
 */
async function processGames(dbManager, newGames) {
  const downloader = new GameDownloader(dbManager, CONFIG);
  const processor = new PatchProcessor(dbManager, CONFIG);
  
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  
  for (const game of newGames) {
    const gameid = String(game.id);
    processed++;
    
    console.log(`\n[${processed}/${newGames.length}] Game ${gameid}: ${game.name}`);
    
    // Check if already in queue
    let queueItem = dbManager.getQueueItemByGameId(gameid);
    
    if (!queueItem || (argv.resume && queueItem.status !== 'completed')) {
      // Add to queue
      const queueuuid = dbManager.addToFetchQueue(
        gameid,
        game,
        game.download_url || game.name_href
      );
      
      queueItem = dbManager.getQueueItem(queueuuid);
    } else if (queueItem.status === 'completed') {
      console.log(`  ✓ Already processed, skipping`);
      succeeded++;
      continue;
    }
    
      try {
        // Determine version (always 1 for new games)
        const version = 1;
        
        // Download ZIP if not already downloaded
        if (!queueItem.zip_path || !fs.existsSync(queueItem.zip_path)) {
          dbManager.updateQueueStatus(queueItem.queueuuid, 'downloading');
          const downloadResult = await downloader.downloadGame(queueItem, version);
          const zipPath = typeof downloadResult === 'string' ? downloadResult : downloadResult.zipPath;
          dbManager.updateQueueZipPath(queueItem.queueuuid, zipPath);
          queueItem.zip_path = zipPath;
        } else {
          console.log(`  Using existing ZIP: ${path.basename(queueItem.zip_path)}`);
        }
      
      // Process patches
      dbManager.updateQueueStatus(queueItem.queueuuid, 'processing');
      const results = await processor.processZipPatches(
        queueItem.queueuuid,
        gameid,
        queueItem.zip_path
      );
      
      // Check results
      const successCount = results.filter(r => r.success).length;
      
      if (successCount > 0) {
        dbManager.updateQueueStatus(queueItem.queueuuid, 'completed');
        console.log(`  ✓ Completed: ${successCount}/${results.length} patches successful`);
        succeeded++;
      } else {
        dbManager.updateQueueStatus(
          queueItem.queueuuid, 
          'failed', 
          'No patches could be processed'
        );
        console.log(`  ✗ Failed: No patches could be processed`);
        failed++;
      }
      
    } catch (error) {
      console.error(`  ✗ Error: ${error.message}`);
      dbManager.updateQueueStatus(queueItem.queueuuid, 'failed', error.message);
      failed++;
    }
  }
  
  console.log(`\n  Processing Summary:`);
  console.log(`    Total:     ${processed}`);
  console.log(`    Succeeded: ${succeeded}`);
  console.log(`    Failed:    ${failed}\n`);
}

/**
 * Create encrypted blobs for all processed patches
 */
async function createBlobs(dbManager, argv) {
  const blobCreator = new BlobCreator(dbManager, CONFIG);
  
  // Get all completed queue items without blobs
  let queueItems = dbManager.getCompletedQueueItemsWithoutBlobs();
  
  // Apply game-ids filter if specified
  if (argv['game-ids']) {
    const requestedIds = argv['game-ids'].split(',').map(s => s.trim());
    queueItems = queueItems.filter(item => 
      requestedIds.includes(String(item.gameid))
    );
    console.log(`  Filtered to specific IDs: ${queueItems.length} games`);
  }
  
  if (queueItems.length === 0) {
    console.log(`  No patches need blob creation\n`);
    return;
  }
  
  console.log(`  Processing ${queueItems.length} games for blob creation`);
  
  for (const queueItem of queueItems) {
    const gameid = queueItem.gameid;
    console.log(`\n  Game ${gameid}:`);
    
    // Get patch files for this game
    const patchFiles = dbManager.getPatchFilesByQueue(queueItem.queueuuid);
    
    for (const patchFile of patchFiles) {
      if (patchFile.status === 'completed' && !patchFile.blob_data) {
        try {
          const blobData = await blobCreator.createPatchBlob(gameid, patchFile);
          
          // Store blob data in working table
          dbManager.updatePatchFileBlobData(patchFile.pfuuid, blobData);
          
        } catch (error) {
          console.error(`      ✗ Failed to create blob: ${error.message}`);
        }
      }
    }
  }
  
  console.log('');
}

/**
 * Create final database records
 */
async function createDatabaseRecords(dbManager, recordCreator, argv) {
  // Get all completed queue items ready for record creation
  let queueItems = dbManager.getCompletedQueueItemsReadyForRecords();
  
  // Apply game-ids filter if specified
  if (argv['game-ids']) {
    const requestedIds = argv['game-ids'].split(',').map(s => s.trim());
    queueItems = queueItems.filter(item => 
      requestedIds.includes(String(item.gameid))
    );
    console.log(`  Filtered to specific IDs: ${queueItems.length} games`);
  }
  
  if (queueItems.length === 0) {
    console.log(`  No games ready for record creation\n`);
    return;
  }
  
  console.log(`  Creating records for ${queueItems.length} games`);
  
  let created = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const queueItem of queueItems) {
    const gameid = queueItem.gameid;
    console.log(`\nGame ${gameid}:`);
    
    try {
      // Check if already created
      if (dbManager.gameVersionExists(gameid)) {
        console.log(`  ⓘ Game version already exists, skipping`);
        skipped++;
        continue;
      }
      
      // Get patch files
      const patchFiles = dbManager.getPatchFilesByQueue(queueItem.queueuuid);
      
      if (CONFIG.DRY_RUN) {
        console.log(`  [DRY RUN] Would create records for ${patchFiles.length} patches`);
        created++;
      } else {
        // Create records
        const result = await recordCreator.createGameRecords(queueItem, patchFiles);
        
        if (result) {
          created++;
        } else {
          skipped++;
        }
      }
      
    } catch (error) {
      console.error(`  ✗ Failed to create records: ${error.message}`);
      errors++;
    }
  }
  
  console.log(`\n  Record Creation Summary:`);
  console.log(`    Created: ${created}`);
  console.log(`    Skipped: ${skipped}`);
  console.log(`    Errors:  ${errors}\n`);
}

/**
 * Check for updates to existing games (Phase 2)
 */
async function checkExistingGameUpdates(dbManager, gamesList, argv) {
  const updateProcessor = new UpdateProcessor(dbManager, CONFIG);
  
  // Initialize stats table if it doesn't have data
  // (but skip full initialization when filtering by specific game IDs)
  const statsManager = new StatsManager(dbManager);
  const statsCount = dbManager.db.prepare(`
    SELECT COUNT(*) as count FROM gameversion_stats
  `).get().count;
  
  if (statsCount === 0 && !argv['game-ids']) {
    console.log('  Initializing gameversion_stats table...');
    statsManager.initializeStatsTable();
  } else if (statsCount === 0 && argv['game-ids']) {
    console.log('  ⓘ Skipping full stats initialization (filtering by specific game IDs)');
  }
  
  // Process existing games
  const results = await updateProcessor.processExistingGames(gamesList);
  
  // Handle games that need downloads
  if (results.downloadNeeded.length > 0 && !argv['update-stats-only']) {
    console.log(`\n  ${results.downloadNeeded.length} game(s) need new versions (file changed):`);
    
    for (const item of results.downloadNeeded) {
      console.log(`    - ${item.gameid}: ${item.metadata.name}`);
    }
    
    console.log('\n  ⓘ These games will be processed in a future run or manually.');
    console.log('    Use --process-new flag or add to queue manually.\n');
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

