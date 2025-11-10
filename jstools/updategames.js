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
const { execSync, spawnSync } = require('child_process');

// Import modules
const DatabaseManager = require('../lib/database');
const SMWCFetcher = require('../lib/smwc-fetcher');
const GameDownloader = require('../lib/game-downloader');
const PatchProcessor = require('../lib/patch-processor');
const BlobCreator = require('../lib/blob-creator');
const RecordCreator = require('../lib/record-creator');
const UpdateProcessor = require('../lib/update-processor');
const StatsManager = require('../lib/stats-manager');
const { getFlipsPath, getSmwRomPath, SMW_EXPECTED_SHA224 } = require('../lib/binary-finder');

// Configuration
const CONFIG = {
  // Rate limiting
  SMWC_REQUEST_DELAY: 10000,        // 60 seconds between requests
  SMWC_EXTRA_DELAY: 10000,          // Extra 10 second delay
  DOWNLOAD_RETRY_MAX: 3,
  DOWNLOAD_TIMEOUT: 120000,         // 2 minutes
  
  // Paths
  DB_PATH: path.join(__dirname, '..', 'electron', 'rhdata.db'),
  PATCHBIN_DB_PATH: path.join(__dirname, '..', 'electron', 'patchbin.db'),
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

CONFIG.LOGGING = {
  mode: argv['log-mode'],
  baseline: argv['log-baseline'],
  dir: argv['log-dir'],
  splitSize: argv['log-split-size'],
  compress: argv['log-xz']
};

let deltaLogger;

class DeltaLogger {
  constructor(options = {}) {
    this.mode = options.mode || 'append';
    if (this.mode === 'baseline') {
      console.warn('[delta-log] Baseline diff mode not yet implemented; defaulting to append.');
      this.mode = 'append';
    }
    this.enabled = this.mode !== 'none';
    this.baseline = options.baseline || null;
    this.logDir = options.dir || path.join(__dirname, 'logs', 'game_deltas');
    this.splitSize = options.splitSize ? Number(options.splitSize) * 1024 * 1024 : null;
    this.compress = options.compress !== false;
    this.entries = [];
    this.ancillary = {};
    this.runId = new Date().toISOString();
    this.startTime = new Date();
    this.summary = {};
    this.manifestName = 'delta-manifest.json';
    this.xzAvailable = false;
    this.warnedCompression = false;
    if (!this.enabled) {
      return;
    }
    fs.mkdirSync(this.logDir, { recursive: true });
    if (this.compress) {
      this.xzAvailable = this.checkXzAvailable();
      if (!this.xzAvailable) {
        console.warn('[delta-log] xz utility not available; writing uncompressed JSON log.');
        this.compress = false;
      }
    }
  }

  get runIdFilePart() {
    return this.runId.replace(/[:]/g, '').replace(/\..+/, '');
  }

  checkXzAvailable() {
    try {
      const result = spawnSync('xz', ['--version'], { stdio: 'ignore' });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  sanitize(data) {
    if (data === undefined) {
      return null;
    }
    try {
      return JSON.parse(JSON.stringify(data));
    } catch {
      return data;
    }
  }

  logEntry(entry) {
    if (!this.enabled) {
      return;
    }
    const payload = {
      timestamp: entry.timestamp || new Date().toISOString(),
      run_id: this.runId,
      table: entry.table,
      action: entry.action,
      primary_key: this.sanitize(entry.primary_key || null),
      diff: this.sanitize(entry.diff || null),
      artifacts: this.sanitize(entry.artifacts || []),
      context: this.sanitize(entry.context || null)
    };
    this.entries.push(payload);
  }

  logAncillary(table, record) {
    if (!this.enabled) {
      return;
    }
    if (!this.ancillary[table]) {
      this.ancillary[table] = [];
    }
    this.ancillary[table].push({
      run_id: this.runId,
      timestamp: new Date().toISOString(),
      ...this.sanitize(record)
    });
  }

  finish(summary = {}) {
    if (!this.enabled) {
      return;
    }

    this.summary = summary || {};

    const payload = {
      version: 1,
      run_id: this.runId,
      mode: this.mode,
      started_at: this.startTime.toISOString(),
      completed_at: new Date().toISOString(),
      summary: this.summary,
      entries: this.entries,
      ancillary: this.ancillary
    };

    const json = JSON.stringify(payload, null, 2);
    const baseName = `delta-${this.runIdFilePart}.json`;
    const jsonPath = path.join(this.logDir, baseName);
    fs.writeFileSync(jsonPath, json, 'utf8');
    let finalPath = jsonPath;

    if (this.compress) {
      const result = spawnSync('xz', ['-zf', jsonPath]);
      if (result.status === 0) {
        finalPath = `${jsonPath}.xz`;
      } else if (!this.warnedCompression) {
        console.warn('[delta-log] Failed to compress log with xz; keeping JSON file.');
        this.warnedCompression = true;
      }
    }

    this.updateManifest(finalPath);
  }

  updateManifest(finalPath) {
    try {
      const manifestPath = path.join(this.logDir, this.manifestName);
      let manifest = [];
      if (fs.existsSync(manifestPath)) {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      }
      manifest.push({
        run_id: this.runId,
        mode: this.mode,
        file: path.basename(finalPath),
        entries: this.entries.length,
        summary: this.summary
      });
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    } catch (error) {
      console.warn('[delta-log] Failed to update manifest:', error.message);
    }
  }
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
    'use-js-blobs': false,
    'log-mode': 'append',
    'log-baseline': null,
    'log-dir': path.join(__dirname, 'logs', 'game_deltas'),
    'log-split-size': null,
    'log-xz': true
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
    } else if (arg === '--log-append') {
      parsed['log-mode'] = 'append';
    } else if (arg.startsWith('--log-baseline=')) {
      parsed['log-mode'] = 'baseline';
      parsed['log-baseline'] = path.resolve(arg.split('=')[1]);
    } else if (arg === '--log-baseline') {
      parsed['log-mode'] = 'baseline';
      parsed['log-baseline'] = path.resolve(args[++i]);
    } else if (arg === '--nolog') {
      parsed['log-mode'] = 'none';
    } else if (arg.startsWith('--log-dir=')) {
      parsed['log-dir'] = path.resolve(arg.split('=')[1]);
    } else if (arg === '--log-dir') {
      parsed['log-dir'] = path.resolve(args[++i]);
    } else if (arg.startsWith('--log-split-size=')) {
      parsed['log-split-size'] = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--log-split-size') {
      parsed['log-split-size'] = parseInt(args[++i], 10);
    } else if (arg === '--log-plain') {
      parsed['log-xz'] = false;
    } else if (arg === '--log-xz') {
      parsed['log-xz'] = true;
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
  --log-append            Emit append-mode delta log (default)
  --log-baseline=<db>     Generate baseline diff against provided database
  --nolog                 Disable delta logging for this run
  --log-dir=<path>        Output directory for delta logs
  --log-split-size=<MB>   Split log files after given size (future use)
  --log-plain             Write uncompressed JSON log
  --log-xz                Force XZ compression (default)

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
  deltaLogger = new DeltaLogger(CONFIG.LOGGING);
  let runSummary = { status: 'success' };
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
    const recordSummary = await createDatabaseRecords(dbManager, recordCreator, argv);
    runSummary.records = recordSummary;
    
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
      
      const updateResults = await checkExistingGameUpdates(dbManager, filteredGamesList, argv);
      if (updateResults) {
        runSummary.updateScan = {
          downloadNeeded: updateResults.downloadNeeded?.length || 0
        };
      }
    } else {
      console.log('[Step 6/6] Skipping update detection\n');
    }
    
    console.log('\n==================================================');
    console.log('              Update Complete!                    ');
    console.log('==================================================\n');
    
  } catch (error) {
    console.error('\n✗ Fatal error:', error.message);
    console.error(error.stack);
    runSummary = { status: 'failed', error: error.message };
  } finally {
    if (recordCreator) {
      recordCreator.close();
    }
    if (dbManager) {
      dbManager.close();
    }
  if (deltaLogger) {
    deltaLogger.finish(runSummary);
  }
  }

  if (runSummary.status === 'failed') {
    process.exit(1);
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
          logGameCreationDelta(dbManager, queueItem, patchFiles);
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

  return { created, skipped, errors };
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
  if (deltaLogger && deltaLogger.enabled && results) {
    deltaLogger.logEntry({
      table: 'game_updates_scan',
      action: 'analyze',
      primary_key: { run_id: deltaLogger.runId },
      diff: {
        before: null,
        after: {
          processed: gamesList.length,
          downloadNeeded: results.downloadNeeded?.map(item => item.gameid) || []
        }
      }
    });
  }
  
  // Handle games that need downloads
  if (results.downloadNeeded.length > 0 && !argv['update-stats-only']) {
    console.log(`\n  ${results.downloadNeeded.length} game(s) need new versions (file changed):`);
    
    for (const item of results.downloadNeeded) {
      console.log(`    - ${item.gameid}: ${item.metadata.name}`);
    }
    
    console.log('\n  ⓘ These games will be processed in a future run or manually.');
    console.log('    Use --process-new flag or add to queue manually.\n');
  }
  return results;
}

// Execute main
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main, CONFIG };

/**
 * Helpers
 */

function safeParseJSON(value) {
  if (value && typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function logGameCreationDelta(dbManager, queueItem, patchFiles) {
  if (!deltaLogger || !deltaLogger.enabled) {
    return;
  }
  try {
    const gameid = queueItem.gameid;
    const gameRow = dbManager.db.prepare(`
      SELECT * FROM gameversions
      WHERE gameid = ?
      ORDER BY version DESC
      LIMIT 1
    `).get(gameid);

    const artifactList = Array.isArray(patchFiles)
      ? patchFiles.map((pf) => ({
          patch_uuid: pf.pfuuid || null,
          patch_name: pf.patch_name || pf.filename || null,
          blob_hash: pf.blob_hash || pf.hash_sha256 || null,
          status: pf.status || null
        }))
      : [];

    deltaLogger.logEntry({
      table: 'gameversions',
      action: 'insert',
      primary_key: {
        gameid: gameRow?.gameid || gameid,
        version: gameRow?.version || 1
      },
      diff: {
        before: null,
        after: gameRow || null
      },
      artifacts: artifactList,
      context: {
        queueuuid: queueItem.queueuuid,
        metadata: safeParseJSON(queueItem.metadata || queueItem.metadata_json || null)
      }
    });
  } catch (error) {
    console.warn('[delta-log] Failed to capture game creation delta:', error.message);
  }
}

