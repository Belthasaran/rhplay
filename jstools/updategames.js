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
const Database = require('better-sqlite3');

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
    'new-only': false,
    'target-folder': null,
    'source-folder': null,
    'subfolders': null,
    'changes-inplace': false,
    'backup-folder': null,
    'orphan-cleanup': false,
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
    } else if (arg === '--new-only') {
      parsed['new-only'] = true;
    } else if (arg.startsWith('--target-folder=')) {
      parsed['target-folder'] = path.resolve(arg.split('=')[1]);
    } else if (arg === '--target-folder') {
      parsed['target-folder'] = path.resolve(args[++i]);
    } else if (arg.startsWith('--source-folder=')) {
      parsed['source-folder'] = path.resolve(arg.split('=')[1]);
    } else if (arg === '--source-folder') {
      parsed['source-folder'] = path.resolve(args[++i]);
    } else if (arg.startsWith('--subfolders=')) {
      parsed['subfolders'] = arg.split('=')[1];
    } else if (arg === '--subfolders') {
      parsed['subfolders'] = args[++i];
    } else if (arg === '--changes-inplace') {
      parsed['changes-inplace'] = true;
    } else if (arg.startsWith('--backup-folder=')) {
      parsed['backup-folder'] = path.resolve(arg.split('=')[1]);
    } else if (arg === '--backup-folder') {
      parsed['backup-folder'] = path.resolve(args[++i]);
    } else if (arg === '--orphan-cleanup') {
      parsed['orphan-cleanup'] = true;
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
  --new-only              Only process new gameids (skip updates to existing games)
  --target-folder=<path>  Export game data to folder instead of database
                          Creates RHPAK-compatible structure for each gameid
  --source-folder=<path>  Import game data from folder (created by --target-folder)
                          Requires --subfolders option
  --subfolders=<ids|all>  Process specific game IDs (comma-separated) or 'all'
                          Required when using --source-folder
  --changes-inplace       Update existing games in-place (same version number)
                          Instead of creating new version entries
  --backup-folder=<path>  Backup SQL rows before updates (requires --changes-inplace)
                          Backups saved to <backup-folder>/<gameid>/
  --orphan-cleanup        Clean up orphaned resources (not referenced by any game)
                          Use with --dry-run to preview what would be cleaned
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
  node updategames.js --new-only  # Only process new gameids
  node updategames.js --target-folder=games1  # Export to folder instead of database
  node updategames.js --source-folder=games --subfolders=all --changes-inplace --backup-folder=backups  # Import from folders
  node updategames.js --source-folder=games --subfolders=41036,41037 --changes-inplace --backup-folder=backups  # Import specific games
  node updategames.js --orphan-cleanup  # Clean up orphaned resources
  node updategames.js --orphan-cleanup --dry-run  # Preview orphaned resources without cleaning

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
    
    // Check if we're cleaning up orphaned resources
    if (argv['orphan-cleanup']) {
      console.log('[Orphan Cleanup Mode] Cleaning up orphaned resources...');
      await cleanupOrphanedResources(argv);
      console.log('\n==================================================');
      console.log('              Cleanup Complete!                  ');
      console.log('==================================================\n');
      return;
    }
    
    // Check if we're importing from folders
    if (argv['source-folder']) {
      if (!argv['subfolders']) {
        console.error('Error: --source-folder requires --subfolders option');
        console.error('Example: --source-folder=games --subfolders=all');
        console.error('Example: --source-folder=games --subfolders=41036,41037');
        process.exit(1);
      }
      
      if (argv['changes-inplace'] && !argv['backup-folder']) {
        console.error('Error: --changes-inplace requires --backup-folder option');
        console.error('Example: --changes-inplace --backup-folder=backups');
        process.exit(1);
      }
      
      console.log('[Import Mode] Importing games from folders...');
      await importFromFolders(dbManager, argv);
      console.log('\n==================================================');
      console.log('              Import Complete!                    ');
      console.log('==================================================\n');
      return;
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
	    //console.log(`argv: ${JSON.stringify(argv)}`)
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
    if (argv['new-only']) {
      console.log('[Step 6/6] Skipping update detection (--new-only mode)\n');
    } else if (argv['check-updates'] && gamesList.length > 0) {
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
 * Export game data to folder structure (RHPAK-compatible)
 */
async function exportGameToFolder(dbManager, recordCreator, queueItem, patchFiles, targetFolder) {
  const gameid = queueItem.gameid;
  const gameFolder = path.join(targetFolder, gameid);
  
  // Create game folder
  if (!fs.existsSync(gameFolder)) {
    fs.mkdirSync(gameFolder, { recursive: true });
  }
  
  console.log(`  Exporting game ${gameid} to ${gameFolder}...`);
  
  // Parse metadata
  const metadata = typeof queueItem.game_metadata === 'string'
    ? JSON.parse(queueItem.game_metadata)
    : queueItem.game_metadata;
  
  // Filter successful patches
  const successfulPatches = patchFiles.filter(p => p.status === 'completed' && p.blob_data);
  
  if (successfulPatches.length === 0) {
    console.log(`    ⚠ No successful patches with blobs, skipping export`);
    return null;
  }
  
  // Find primary patch
  const primaryPatch = successfulPatches.find(p => p.is_primary === 1) || successfulPatches[0];
  const primaryBlobData = JSON.parse(primaryPatch.blob_data);
  
  // Get previous version to determine next version number
  const previousVersion = dbManager.getLatestVersionForGame(gameid);
  const nextVersion = previousVersion ? (previousVersion.version || 0) + 1 : 1;
  
  // Prepare gameversion record data (without inserting)
  const gvuuid = recordCreator.generateUUID();
  
  // Find changed attributes
  let changedAttributes = null;
  if (previousVersion) {
    changedAttributes = recordCreator.findChangedFields(previousVersion, metadata);
  }
  
  // Copy locked attributes from previous version if they exist
  const lockedValues = {};
  if (previousVersion) {
    const LOCKED_ATTRIBUTES = ['legacy_type'];
    LOCKED_ATTRIBUTES.forEach(attr => {
      if (previousVersion[attr] !== undefined && previousVersion[attr] !== null) {
        lockedValues[attr] = previousVersion[attr];
      }
    });
  }
  
  // Extract schema fields
  const fieldsType = metadata.fields && metadata.fields.type ? metadata.fields.type : null;
  const rawDifficulty = metadata.raw_fields && metadata.raw_fields.difficulty ? metadata.raw_fields.difficulty : null;
  const combinedType = computeCombinedType(metadata);
  
  // Build gameversion data
  const gameVersionData = {
    gvuuid: gvuuid,
    gameid: gameid,
    version: nextVersion,
    section: metadata.section || null,
    gametype: metadata.type || metadata.gametype || metadata.difficulty || null,
    name: metadata.name || null,
    time: metadata.time || null,
    added: metadata.added || null,
    moderated: metadata.moderated ? 1 : 0,
    author: metadata.author || null,
    authors: metadata.authors || null,
    submitter: metadata.submitter || null,
    demo: metadata.demo || null,
    featured: metadata.featured ? 1 : 0,
    length: metadata.length || null,
    difficulty: metadata.difficulty || null,
    url: metadata.url || null,
    download_url: metadata.download_url || null,
    name_href: metadata.name_href || null,
    author_href: metadata.author_href || null,
    obsoleted_by: metadata.obsoleted_by || null,
    size: metadata.size || null,
    description: metadata.description || null,
    tags: Array.isArray(metadata.tags) ? JSON.stringify(metadata.tags) : metadata.tags,
    tags_href: metadata.tags_href || null,
    gvjsondata: JSON.stringify(metadata),
    gvchange_attributes: changedAttributes ? JSON.stringify(changedAttributes) : null,
    fields_type: fieldsType,
    raw_difficulty: rawDifficulty,
    combinedtype: combinedType,
    patchblob1_name: primaryBlobData.patchblob1_name || null,
    pat_sha224: primaryPatch.pat_sha224 || null,
    removed: metadata.removed || 0,
    obsoleted: metadata.obsoleted || 0,
    local_resource_etag: null,
    local_resource_lastmodified: null,
    local_resource_filename: nextVersion === 1 ? `zips/${gameid}.zip` : `zips/${gameid}_${nextVersion}.zip`,
    ...lockedValues
  };
  
  // Export gameversions data
  fs.writeFileSync(
    path.join(gameFolder, 'gameversions.json'),
    JSON.stringify([gameVersionData], null, 2)
  );
  
  // Export gameversion_stats (empty for now, will be populated later)
  fs.writeFileSync(
    path.join(gameFolder, 'gameversion_stats.json'),
    JSON.stringify([], null, 2)
  );
  
  // Export patchblobs
  const patchblobsExport = [];
  const patchblobsExtendedExport = [];
  
  for (const patchFile of successfulPatches) {
    const blobData = JSON.parse(patchFile.blob_data);
    const pbuuid = recordCreator.generateUUID();
    
    const patchblobData = {
      pbuuid: pbuuid,
      gvuuid: gvuuid,
      patch_name: patchFile.patch_filename || null,
      pat_sha1: patchFile.pat_sha1 || null,
      pat_sha224: patchFile.pat_sha224 || null,
      pat_shake_128: patchFile.pat_shake_128 || null,
      result_sha1: patchFile.result_sha1 || null,
      result_sha224: patchFile.result_sha224 || null,
      result_shake1: patchFile.result_shake1 || null,
      patchblob1_key: blobData.patchblob1_key || null,
      patchblob1_name: blobData.patchblob1_name || null,
      patchblob1_sha224: blobData.patchblob1_sha224 || null,
      pbjsondata: JSON.stringify({
        ...patchFile,
        ...blobData
      })
    };
    
    patchblobsExport.push(patchblobData);
    
    // Extended data
    const extendedData = {
      pbuuid: pbuuid,
      patch_filename: patchFile.patch_filename || null,
      patch_type: patchFile.patch_type || null,
      is_primary: patchFile.is_primary || 0,
      zip_source: patchFile.zip_path || null
    };
    patchblobsExtendedExport.push(extendedData);
  }
  
  fs.writeFileSync(
    path.join(gameFolder, 'patchblobs.json'),
    JSON.stringify(patchblobsExport, null, 2)
  );
  
  fs.writeFileSync(
    path.join(gameFolder, 'patchblobs_extended.json'),
    JSON.stringify(patchblobsExtendedExport, null, 2)
  );
  
  // Export extrapatches (empty for now)
  fs.writeFileSync(
    path.join(gameFolder, 'extrapatches.json'),
    JSON.stringify([], null, 2)
  );
  
  // Export rhpatches
  const rhpatchesExport = [];
  for (const patchFile of successfulPatches) {
    if (patchFile.pat_sha224) {
      rhpatchesExport.push({
        pat_sha224: patchFile.pat_sha224,
        gameid: gameid,
        patch_name: patchFile.patch_name || patchFile.filename
      });
    }
  }
  fs.writeFileSync(
    path.join(gameFolder, 'rhpatches.json'),
    JSON.stringify(rhpatchesExport, null, 2)
  );
  
  // Export attachments (from patchbin.db) - prepare data structure
  // Note: Actual attachment creation requires reading blob files and calculating hashes
  // For export, we'll create a placeholder structure
  const attachmentsExport = [];
  for (const patchblob of patchblobsExport) {
    const blobData = JSON.parse(successfulPatches.find(p => {
      const bd = JSON.parse(p.blob_data);
      return bd.patchblob1_name === patchblob.patchblob1_name;
    }).blob_data);
    
    // Create attachment data structure (without actually reading files)
    attachmentsExport.push({
      auuid: recordCreator.generateUUID(),
      pbuuid: patchblob.pbuuid,
      gvuuid: gvuuid,
      file_name: blobData.patchblob1_name || null,
      file_hash_sha224: blobData.patchblob1_sha224 || null,
      // Note: Other hash fields would need to be calculated from actual blob file
      // This is a skeleton structure for RHPAK assembly
    });
  }
  fs.writeFileSync(
    path.join(gameFolder, 'attachments.json'),
    JSON.stringify(attachmentsExport, null, 2)
  );
  
  // Export res_attachments (from resource.db) - source zip file
  // This would need to be queried from resource.db if available
  fs.writeFileSync(
    path.join(gameFolder, 'res_attachments.json'),
    JSON.stringify([], null, 2)
  );
  
  // Export res_screenshots (from screenshot.db)
  // This would need to be queried from screenshot.db if available
  fs.writeFileSync(
    path.join(gameFolder, 'res_screenshots.json'),
    JSON.stringify([], null, 2)
  );
  
  // Export delta_records.json (from delta logger if available)
  const deltaRecords = [];
  if (deltaLogger && deltaLogger.enabled) {
    // Collect relevant delta entries for this game
    const gameDeltas = deltaLogger.entries.filter(entry => {
      if (entry.primary_key && entry.primary_key.gameid === gameid) {
        return true;
      }
      if (entry.context && entry.context.queueuuid === queueItem.queueuuid) {
        return true;
      }
      return false;
    });
    
    if (gameDeltas.length > 0) {
      deltaRecords.push(...gameDeltas);
    }
  }
  fs.writeFileSync(
    path.join(gameFolder, 'delta_records.json'),
    JSON.stringify(deltaRecords, null, 2)
  );
  
  // Copy patch files to game folder (before creating skeleton so we can set patch_local_path)
  const patchSubfolder = path.join(gameFolder, 'patch');
  if (!fs.existsSync(patchSubfolder)) {
    fs.mkdirSync(patchSubfolder, { recursive: true });
  }
  
  let primaryPatchPath = null;
  for (let i = 0; i < successfulPatches.length; i++) {
    const patchFile = successfulPatches[i];
    
    // Get patch file path from patchFile record
    const sourcePatchPath = patchFile.patch_file_path;
    if (sourcePatchPath && fs.existsSync(sourcePatchPath)) {
      const patchFilename = path.basename(sourcePatchPath);
      const destPatchPath = path.join(patchSubfolder, patchFilename);
      fs.copyFileSync(sourcePatchPath, destPatchPath);
      console.log(`    ✓ Copied patch: ${patchFilename}`);
      
      // If this is the primary patch, store the path for skeleton
      if (patchFile.is_primary === 1 || i === 0) {
        primaryPatchPath = `patch/${patchFilename}`;
      }
    } else if (patchFile.patch_filename) {
      // Fallback: try to find patch by filename in PATCH_DIR
      // Patches are stored by shake128 hash, but we can try to find by filename
      const fallbackPath = path.join(CONFIG.PATCH_DIR, patchFile.patch_filename);
      if (fs.existsSync(fallbackPath)) {
        const destPatchPath = path.join(patchSubfolder, patchFile.patch_filename);
        fs.copyFileSync(fallbackPath, destPatchPath);
        console.log(`    ✓ Copied patch (by filename): ${patchFile.patch_filename}`);
        
        if (patchFile.is_primary === 1 || i === 0) {
          primaryPatchPath = `patch/${patchFile.patch_filename}`;
        }
      } else {
        // Try to find by shake128 hash (patches are stored by hash)
        if (patchFile.pat_shake_128) {
          const hashPath = path.join(CONFIG.PATCH_DIR, patchFile.pat_shake_128);
          if (fs.existsSync(hashPath)) {
            const destPatchPath = path.join(patchSubfolder, patchFile.patch_filename || `${patchFile.pat_shake_128}.${patchFile.patch_type || 'bps'}`);
            fs.copyFileSync(hashPath, destPatchPath);
            console.log(`    ✓ Copied patch (by hash): ${path.basename(destPatchPath)}`);
            
            if (patchFile.is_primary === 1 || i === 0) {
              primaryPatchPath = `patch/${path.basename(destPatchPath)}`;
            }
          } else {
            console.log(`    ⚠ Patch file not found: ${sourcePatchPath || fallbackPath || hashPath}`);
          }
        } else {
          console.log(`    ⚠ Patch file not found: ${sourcePatchPath || fallbackPath}`);
        }
      }
    }
  }
  
  // Create combined skeleton JSON file for newgame.js
  const primaryPatchblob = patchblobsExport[0] || {};
  const primaryAttachment = attachmentsExport[0] || {};
  
  // Parse metadata for skeleton
  const parsedMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
  
  // Build skeleton structure matching newgame.js format
  const skeleton = {
    metadata: {
      script: 'newgame.js',
      version: '0.1.1', // SCRIPT_VERSION from newgame.js
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      prepared: false,
      prepared_at: null,
      added_at: null,
      rhpakuuid: recordCreator.generateUUID(),
      rhpakname: `${gameid} - ${parsedMetadata.author || parsedMetadata.submitter || 'unknown'} - ${parsedMetadata.name || 'Untitled'} - ${nextVersion}`,
      rhpak_type: 'single',
      gameids: [gameid],
      has_detached_resources: false,
      has_extrapatches: false
    },
    artifacts: {
      patch: null // Will be set during --prepare
    },
    gameversion: {
      gvuuid: gvuuid,
      gameid: gameid,
      section: gameVersionData.section || 'smwhacks',
      based_against: 'SMW',
      version: nextVersion,
      removed: gameVersionData.removed || 0,
      obsoleted: gameVersionData.obsoleted || 0,
      moderated: gameVersionData.moderated || 0,
      featured: gameVersionData.featured || 0,
      name: gameVersionData.name || '',
      gametype: gameVersionData.gametype || '',
      difficulty: gameVersionData.difficulty || '',
      raw_difficulty: gameVersionData.raw_difficulty || null,
      fields_type: gameVersionData.fields_type || null,
      combinedtype: gameVersionData.combinedtype || null,
      type: gameVersionData.gametype || '',
      warnings: [],
      tags: parsedMetadata.tags ? (Array.isArray(parsedMetadata.tags) ? parsedMetadata.tags : JSON.parse(parsedMetadata.tags || '[]')) : [],
      author: gameVersionData.author || '',
      authors: gameVersionData.authors || '',
      submitter: gameVersionData.submitter || '',
      legacy_type: gameVersionData.legacy_type || '',
      url: gameVersionData.url || '',
      download_url: gameVersionData.download_url || '',
      name_href: gameVersionData.name_href || '',
      author_href: gameVersionData.author_href || '',
      obsoleted_by: gameVersionData.obsoleted_by || '',
      description: gameVersionData.description || '',
      length: gameVersionData.length || '',
      demo: gameVersionData.demo || 'No',
      sa1: 'No',
      collab: 'No',
      screenshots: [],
      patch_filename: primaryPatchblob.patch_name || null,
      patch_local_path: primaryPatchPath || null, // Set to relative path in patch/ subfolder
      patch_notes: '',
      submission_notes: '',
      // Include full gvjsondata for access to original metadata (including images array)
      gvjsondata: gameVersionData.gvjsondata || JSON.stringify(metadata)
    },
    gameversion_stats: {
      download_count: 0,
      view_count: 0,
      comment_count: 0,
      rating_value: null,
      rating_count: 0,
      favorite_count: 0,
      hof_status: null,
      featured_status: null
    },
    patchblob: {
      pbuuid: primaryPatchblob.pbuuid || recordCreator.generateUUID(),
      patchblob1_name: primaryPatchblob.patchblob1_name || null,
      patchblob1_sha224: primaryPatchblob.patchblob1_sha224 || null,
      patchblob1_key: primaryPatchblob.patchblob1_key || null,
      pat_sha1: primaryPatchblob.pat_sha1 || null,
      pat_sha224: primaryPatchblob.pat_sha224 || null,
      pat_shake_128: primaryPatchblob.pat_shake_128 || null,
      result_sha1: primaryPatchblob.result_sha1 || null,
      result_sha224: primaryPatchblob.result_sha224 || null,
      result_shake1: primaryPatchblob.result_shake1 || null,
      patch_name: primaryPatchblob.patch_name || null
    },
    attachment: {
      auuid: primaryAttachment.auuid || recordCreator.generateUUID(),
      file_name: primaryAttachment.file_name || null,
      download_urls: []
    },
    resources: [],
    screenshots: [],
    gamestages: [],
    extrapatches: []
  };
  
  // Copy blob files to game folder
  const blobsSubfolder = path.join(gameFolder, 'blobs');
  if (!fs.existsSync(blobsSubfolder)) {
    fs.mkdirSync(blobsSubfolder, { recursive: true });
  }
  
  for (const patchblob of patchblobsExport) {
    if (patchblob.patchblob1_name) {
      const sourceBlobPath = path.join(CONFIG.BLOBS_DIR, patchblob.patchblob1_name);
      if (fs.existsSync(sourceBlobPath)) {
        const destBlobPath = path.join(blobsSubfolder, patchblob.patchblob1_name);
        fs.copyFileSync(sourceBlobPath, destBlobPath);
        console.log(`    ✓ Copied blob: ${patchblob.patchblob1_name}`);
      } else {
        console.log(`    ⚠ Blob file not found: ${sourceBlobPath}`);
      }
    }
  }
  
  // Copy zip file to game folder and add as resource
  const resourcesSubfolder = path.join(gameFolder, 'resources');
  if (!fs.existsSync(resourcesSubfolder)) {
    fs.mkdirSync(resourcesSubfolder, { recursive: true });
  }
  
  let zipResource = null;
  if (queueItem.zip_path && fs.existsSync(queueItem.zip_path)) {
    const zipFilename = path.basename(queueItem.zip_path);
    const destZipPath = path.join(resourcesSubfolder, zipFilename);
    fs.copyFileSync(queueItem.zip_path, destZipPath);
    console.log(`    ✓ Copied ZIP: ${zipFilename}`);
    
    // Calculate zip file hash
    const zipData = fs.readFileSync(destZipPath);
    const zipSha256 = crypto.createHash('sha256').update(zipData).digest('hex');
    const zipSha224 = crypto.createHash('sha224').update(zipData).digest('hex');
    
    // Add zip as resource in skeleton
    zipResource = {
      ruuid: recordCreator.generateUUID(),
      gameid: gameid,
      gvuuid: gvuuid,
      resource_type: 'source_zip',
      file_name: zipFilename,
      file_path: `resources/${zipFilename}`,
      file_size: zipData.length,
      file_hash_sha224: zipSha224,
      file_hash_sha256: zipSha256,
      source_url: metadata.download_url || metadata.name_href || null,
      created_at: new Date().toISOString()
    };
    
    skeleton.resources.push(zipResource);
  } else {
    console.log(`    ⚠ ZIP file not found: ${queueItem.zip_path || 'unknown'}`);
  }
  
  // Write combined skeleton JSON file
  const skeletonPath = path.join(gameFolder, `${gameid}.json`);
  fs.writeFileSync(skeletonPath, JSON.stringify(skeleton, null, 2));
  
  console.log(`    ✓ Exported game data to ${gameFolder}`);
  console.log(`    ✓ Created skeleton JSON: ${skeletonPath}`);
  return { gameFolder, gvuuid, patchblobsExport, skeletonPath, zipResource };
}

/**
 * Compute combined type string (copied from record-creator.js)
 */
function computeCombinedType(record) {
  const parts = [];
  const fieldsType = record.fields && record.fields.type ? record.fields.type : null;
  const difficulty = record.difficulty;
  const rawDifficulty = record.raw_fields && record.raw_fields.difficulty ? record.raw_fields.difficulty : null;
  let rawFieldsType = null;
  if (record.raw_fields && record.raw_fields.type) {
    if (Array.isArray(record.raw_fields.type)) {
      rawFieldsType = record.raw_fields.type.join(', ');
    } else {
      rawFieldsType = record.raw_fields.type;
    }
  }
  
  let result = '';
  if (fieldsType) {
    result += fieldsType + ': ';
  }
  if (difficulty) {
    result += difficulty;
  }
  if (rawDifficulty) {
    result += ' (' + rawDifficulty + ')';
  }
  if (rawFieldsType) {
    result += ' (' + rawFieldsType + ')';
  }
  result = result.trim();
  if (!result) {
    const fallbackType = record.type || record.gametype;
    if (fallbackType) {
      result = fallbackType;
    }
  }
  return result || null;
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
    console.log(`  No games ready for ${argv['target-folder'] ? 'export' : 'record creation'}\n`);
    return;
  }
  
  if (argv['target-folder']) {
    console.log(`  Exporting ${queueItems.length} games to ${argv['target-folder']}/`);
  } else {
    console.log(`  Creating records for ${queueItems.length} games`);
  }
  
  let created = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const queueItem of queueItems) {
    const gameid = queueItem.gameid;
    console.log(`\nGame ${gameid}:`);
    
    try {
      // Check if already created (only if not exporting to folder)
      if (!argv['target-folder'] && dbManager.gameVersionExists(gameid)) {
        console.log(`  ⓘ Game version already exists, skipping`);
        skipped++;
        continue;
      }
      
      // Get patch files
      const patchFiles = dbManager.getPatchFilesByQueue(queueItem.queueuuid);
      
      if (CONFIG.DRY_RUN) {
        if (argv['target-folder']) {
          console.log(`  [DRY RUN] Would export to ${argv['target-folder']}/${gameid}/`);
        } else {
          console.log(`  [DRY RUN] Would create records for ${patchFiles.length} patches`);
        }
        created++;
      } else if (argv['target-folder']) {
        // Export to folder instead of database
        const result = await exportGameToFolder(
          dbManager,
          recordCreator,
          queueItem,
          patchFiles,
          argv['target-folder']
        );
        
        if (result) {
          created++;
          logGameCreationDelta(dbManager, queueItem, patchFiles);
        } else {
          skipped++;
        }
      } else {
        // Create records in database
        const result = await recordCreator.createGameRecords(queueItem, patchFiles);
        
        if (result) {
          created++;
          logGameCreationDelta(dbManager, queueItem, patchFiles);
        } else {
          skipped++;
        }
      }
      
    } catch (error) {
      console.error(`  ✗ Failed to ${argv['target-folder'] ? 'export' : 'create records'}: ${error.message}`);
      errors++;
    }
  }
  
  const actionName = argv['target-folder'] ? 'Export' : 'Record Creation';
  console.log(`\n  ${actionName} Summary:`);
  console.log(`    ${argv['target-folder'] ? 'Exported' : 'Created'}: ${created}`);
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

/**
 * Import games from folders created by --target-folder
 */
async function importFromFolders(dbManager, argv) {
  const sourceFolder = argv['source-folder'];
  const subfolders = argv['subfolders'];
  const changesInplace = argv['changes-inplace'];
  const backupFolder = argv['backup-folder'];
  
  if (!fs.existsSync(sourceFolder)) {
    throw new Error(`Source folder does not exist: ${sourceFolder}`);
  }
  
  // Find game folders
  let gameFolders = [];
  if (subfolders === 'all') {
    const entries = fs.readdirSync(sourceFolder, { withFileTypes: true });
    gameFolders = entries
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(sourceFolder, entry.name));
  } else {
    const gameIds = subfolders.split(',').map(s => s.trim());
    gameFolders = gameIds.map(gameid => path.join(sourceFolder, gameid));
  }
  
  // Filter to only existing folders with skeleton JSON
  gameFolders = gameFolders.filter(folder => {
    const skeletonPath = path.join(folder, path.basename(folder) + '.json');
    return fs.existsSync(folder) && fs.existsSync(skeletonPath);
  });
  
  console.log(`  Found ${gameFolders.length} game folder(s) to process\n`);
  
  if (gameFolders.length === 0) {
    console.log('  No game folders found to process.');
    return;
  }
  
  // Open all databases
  const rhdataDb = new Database(CONFIG.DB_PATH);
  const patchbinDb = new Database(CONFIG.PATCHBIN_DB_PATH);
  const resourceDbPath = path.join(__dirname, '..', 'electron', 'resource.db');
  const screenshotDbPath = path.join(__dirname, '..', 'electron', 'screenshot.db');
  const resourceDb = fs.existsSync(resourceDbPath) ? new Database(resourceDbPath) : null;
  const screenshotDb = fs.existsSync(screenshotDbPath) ? new Database(screenshotDbPath) : null;
  
  // Ensure resource and screenshot databases exist
  if (!resourceDb) {
    throw new Error(`Resource database not found: ${resourceDbPath}`);
  }
  if (!screenshotDb) {
    throw new Error(`Screenshot database not found: ${screenshotDbPath}`);
  }
  
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const gameFolder of gameFolders) {
    const gameid = path.basename(gameFolder);
    const skeletonPath = path.join(gameFolder, gameid + '.json');
    
    try {
      console.log(`  [${gameid}] Processing...`);
      
      // Load skeleton
      const skeleton = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
      
      // Check if prepared
      if (!skeleton.metadata || !skeleton.metadata.prepared) {
        console.log(`    ⓘ Running --prepare...`);
        // Run newgame.js --prepare
        const prepareCmd = `enode.sh ${path.join(__dirname, 'newgame.js')} "${skeletonPath}" --prepare`;
        try {
          execSync(prepareCmd, { stdio: 'inherit', cwd: __dirname });
          // Reload skeleton after prepare
          const updatedSkeleton = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
          Object.assign(skeleton, updatedSkeleton);
        } catch (error) {
          console.error(`    ✗ Prepare failed: ${error.message}`);
          errors++;
          continue;
        }
      }
      
      // Check if there are changes (compare with latest version in DB)
      const latestVersion = rhdataDb.prepare(`
        SELECT * FROM gameversions 
        WHERE gameid = ? 
        ORDER BY version DESC 
        LIMIT 1
      `).get(gameid);
      
      if (latestVersion && changesInplace) {
        // Compare to see if there are actual changes
        const hasChanges = compareGameVersions(skeleton.gameversion, latestVersion);
        if (!hasChanges) {
          console.log(`    ⓘ No changes detected, skipping`);
          skipped++;
          continue;
        }
        
        // Backup existing records if backup folder specified
        if (backupFolder) {
          await backupGameRecords(backupFolder, gameid, rhdataDb, patchbinDb, resourceDb, screenshotDb, latestVersion);
        }
        
        // Update in-place (keep same version number)
        skeleton.gameversion.version = latestVersion.version;
        skeleton.gameversion.gvuuid = latestVersion.gvuuid;
      } else if (latestVersion && !changesInplace) {
        // Create new version
        skeleton.gameversion.version = latestVersion.version + 1;
      }
      
      // Import using newgame.js logic
      // We'll need to call newgame.js's performAddOperation or replicate it
      // For now, let's use a simplified approach that calls newgame.js --add
      console.log(`    ⓘ Importing to database...`);
      const addCmd = `enode.sh ${path.join(__dirname, 'newgame.js')} "${skeletonPath}" --add`;
      try {
        execSync(addCmd, { stdio: 'inherit', cwd: __dirname });
        console.log(`    ✓ Imported successfully`);
        processed++;
      } catch (error) {
        console.error(`    ✗ Import failed: ${error.message}`);
        errors++;
      }
      
    } catch (error) {
      console.error(`  [${gameid}] ✗ Error: ${error.message}`);
      errors++;
    }
  }
  
  rhdataDb.close();
  patchbinDb.close();
  resourceDb.close();
  screenshotDb.close();
  
  console.log(`\n  Summary: ${processed} processed, ${skipped} skipped, ${errors} errors`);
}

/**
 * Compare two game versions to detect changes
 */
function compareGameVersions(newVersion, existingVersion) {
  // Compare key fields that indicate changes
  const fieldsToCompare = [
    'title', 'author', 'description', 'patch_filename', 'pat_sha224', 
    'result_sha224', 'version', 'download_url'
	  //
	, 'fields_type', 'raw_difficulty'
  ];
  
  for (const field of fieldsToCompare) {
    if (newVersion[field] !== existingVersion[field]) {
      return true;
    }
  }
  
  return false;
}

/**
 * Backup SQL rows before updates
 */
async function backupGameRecords(backupFolder, gameid, rhdataDb, patchbinDb, resourceDb, screenshotDb, gameversion) {
  const gameBackupDir = path.join(backupFolder, gameid);
  fs.mkdirSync(gameBackupDir, { recursive: true });
  
  console.log(`    ⓘ Backing up existing records to ${gameBackupDir}...`);
  
  const gvuuid = gameversion.gvuuid;
  const rhpakuuid = gameversion.rhpakuuid;
  
  // Backup gameversions
  const gameversions = rhdataDb.prepare('SELECT * FROM gameversions WHERE gameid = ?').all(gameid);
  if (gameversions.length > 0) {
    fs.writeFileSync(
      path.join(gameBackupDir, 'gameversions.json'),
      JSON.stringify(gameversions, null, 2)
    );
  }
  
  // Backup gameversion_stats
  const gameversionStats = rhdataDb.prepare('SELECT * FROM gameversion_stats WHERE gameid = ?').all(gameid);
  if (gameversionStats.length > 0) {
    fs.writeFileSync(
      path.join(gameBackupDir, 'gameversion_stats.json'),
      JSON.stringify(gameversionStats, null, 2)
    );
  }
  
  // Backup patchblobs
  const patchblobs = rhdataDb.prepare('SELECT * FROM patchblobs WHERE gvuuid = ?').all(gvuuid);
  if (patchblobs.length > 0) {
    fs.writeFileSync(
      path.join(gameBackupDir, 'patchblobs.json'),
      JSON.stringify(patchblobs, null, 2)
    );
  }
  
  // Backup patchblobs_extended
  const patchblobsExtended = rhdataDb.prepare('SELECT * FROM patchblobs_extended WHERE rhpakuuid = ?').all(rhpakuuid);
  if (patchblobsExtended.length > 0) {
    fs.writeFileSync(
      path.join(gameBackupDir, 'patchblobs_extended.json'),
      JSON.stringify(patchblobsExtended, null, 2)
    );
  }
  
  // Backup rhpatches
  const rhpatches = rhdataDb.prepare('SELECT * FROM rhpatches WHERE gameid = ?').all(gameid);
  if (rhpatches.length > 0) {
    fs.writeFileSync(
      path.join(gameBackupDir, 'rhpatches.json'),
      JSON.stringify(rhpatches, null, 2)
    );
  }
  
  // Backup attachments
  const attachments = patchbinDb.prepare('SELECT * FROM attachments WHERE gvuuid = ?').all(gvuuid);
  if (attachments.length > 0) {
    fs.writeFileSync(
      path.join(gameBackupDir, 'attachments.json'),
      JSON.stringify(attachments, null, 2)
    );
  }
  
  // Backup res_attachments
  const resAttachments = resourceDb.prepare('SELECT * FROM res_attachments WHERE gameid = ? OR gvuuid = ?').all(gameid, gvuuid);
  if (resAttachments.length > 0) {
    fs.writeFileSync(
      path.join(gameBackupDir, 'res_attachments.json'),
      JSON.stringify(resAttachments, null, 2)
    );
  }
  
  // Backup res_screenshots
  const resScreenshots = screenshotDb.prepare('SELECT * FROM res_screenshots WHERE gameid = ? OR gvuuid = ?').all(gameid, gvuuid);
  if (resScreenshots.length > 0) {
    fs.writeFileSync(
      path.join(gameBackupDir, 'res_screenshots.json'),
      JSON.stringify(resScreenshots, null, 2)
    );
  }
  
  console.log(`    ✓ Backup complete`);
}

/**
 * Clean up orphaned resources (resources not referenced by any game)
 * This is a separate operation that can be run with --orphan-cleanup
 */
async function cleanupOrphanedResources(argv) {
  const dryRun = argv['dry-run'] || false;
  
  if (dryRun) {
    console.log('  ⚠  DRY RUN MODE - No resources will be deleted\n');
  }
  
  // Open all databases
  const rhdataDb = new Database(CONFIG.DB_PATH);
  const patchbinDb = new Database(CONFIG.PATCHBIN_DB_PATH);
  const resourceDbPath = path.join(__dirname, '..', 'electron', 'resource.db');
  const screenshotDbPath = path.join(__dirname, '..', 'electron', 'screenshot.db');
  
  if (!fs.existsSync(resourceDbPath)) {
    throw new Error(`Resource database not found: ${resourceDbPath}`);
  }
  if (!fs.existsSync(screenshotDbPath)) {
    throw new Error(`Screenshot database not found: ${screenshotDbPath}`);
  }
  
  const resourceDb = new Database(resourceDbPath);
  const screenshotDb = new Database(screenshotDbPath);
  
  try {
    // Get ALL gameversions (not just latest - any version of any gameid is considered in use)
    const allGameversions = rhdataDb.prepare(`
      SELECT DISTINCT gvuuid, gameid, rhpakuuid 
      FROM gameversions
    `).all();
    
    const activeGvuuids = new Set(allGameversions.map(gv => gv.gvuuid).filter(Boolean));
    const activeRhpakuuids = new Set(allGameversions.map(gv => gv.rhpakuuid).filter(Boolean));
    const activeGameids = new Set(allGameversions.map(gv => gv.gameid).filter(Boolean));
    
    console.log(`  Found ${allGameversions.length} gameversion(s) in database`);
    console.log(`    Active gameids: ${activeGameids.size}`);
    console.log(`    Active gvuuids: ${activeGvuuids.size}`);
    console.log(`    Active rhpakuuids: ${activeRhpakuuids.size}\n`);
    
    let cleaned = 0;
    const orphanedResAttachments = [];
    const orphanedResScreenshots = [];
    const orphanedAttachments = [];
    
    // Find orphaned res_attachments (only those scoped to gameversion)
    const allResAttachments = resourceDb.prepare(`
      SELECT rauuid, gameid, gvuuid, rhpakuuid, resource_scope, linked_type, linked_uuid, file_name
      FROM res_attachments
      WHERE resource_scope = 'gameversion' AND linked_type = 'gameversion'
    `).all();
    
    console.log(`  Checking ${allResAttachments.length} res_attachment(s) (gameversion-scoped)...`);
    for (const attachment of allResAttachments) {
      const isOrphaned = !(
        (attachment.gameid && activeGameids.has(attachment.gameid)) ||
        (attachment.gvuuid && activeGvuuids.has(attachment.gvuuid)) ||
        (attachment.linked_uuid && activeGvuuids.has(attachment.linked_uuid)) ||
        (attachment.rhpakuuid && activeRhpakuuids.has(attachment.rhpakuuid))
      );
      
      if (isOrphaned) {
        orphanedResAttachments.push(attachment);
        if (!dryRun) {
          resourceDb.prepare('DELETE FROM res_attachments WHERE rauuid = ?').run(attachment.rauuid);
        }
        cleaned++;
      }
    }
    
    if (orphanedResAttachments.length > 0) {
      console.log(`    Found ${orphanedResAttachments.length} orphaned res_attachment(s):`);
      for (const orphan of orphanedResAttachments) {
        console.log(`      - ${orphan.file_name || orphan.rauuid} (gameid: ${orphan.gameid || 'N/A'}, gvuuid: ${orphan.gvuuid || orphan.linked_uuid || 'N/A'})`);
      }
    }
    
    // Find orphaned res_screenshots
    const allResScreenshots = screenshotDb.prepare('SELECT rsuuid, gameid, gvuuid, rhpakuuid, file_name, source_url FROM res_screenshots').all();
    
    console.log(`\n  Checking ${allResScreenshots.length} res_screenshot(s)...`);
    for (const screenshot of allResScreenshots) {
      const isOrphaned = !(
        (screenshot.gameid && activeGameids.has(screenshot.gameid)) ||
        (screenshot.gvuuid && activeGvuuids.has(screenshot.gvuuid)) ||
        (screenshot.rhpakuuid && activeRhpakuuids.has(screenshot.rhpakuuid))
      );
      
      if (isOrphaned) {
        orphanedResScreenshots.push(screenshot);
        if (!dryRun) {
          screenshotDb.prepare('DELETE FROM res_screenshots WHERE rsuuid = ?').run(screenshot.rsuuid);
        }
        cleaned++;
      }
    }
    
    if (orphanedResScreenshots.length > 0) {
      console.log(`    Found ${orphanedResScreenshots.length} orphaned res_screenshot(s):`);
      for (const orphan of orphanedResScreenshots) {
        const identifier = orphan.file_name || orphan.source_url || orphan.rsuuid;
        console.log(`      - ${identifier} (gameid: ${orphan.gameid || 'N/A'}, gvuuid: ${orphan.gvuuid || 'N/A'})`);
      }
    }
    
    // Find orphaned attachments (from patchbin.db)
    const allAttachments = patchbinDb.prepare('SELECT auuid, gvuuid, file_name FROM attachments').all();
    
    console.log(`\n  Checking ${allAttachments.length} attachment(s)...`);
    for (const attachment of allAttachments) {
      const isOrphaned = !(attachment.gvuuid && activeGvuuids.has(attachment.gvuuid));
      
      if (isOrphaned) {
        orphanedAttachments.push(attachment);
        if (!dryRun) {
          patchbinDb.prepare('DELETE FROM attachments WHERE auuid = ?').run(attachment.auuid);
        }
        cleaned++;
      }
    }
    
    if (orphanedAttachments.length > 0) {
      console.log(`    Found ${orphanedAttachments.length} orphaned attachment(s):`);
      for (const orphan of orphanedAttachments) {
        console.log(`      - ${orphan.file_name || orphan.auuid} (gvuuid: ${orphan.gvuuid || 'N/A'})`);
      }
    }
    
    console.log(`\n  Summary:`);
    if (dryRun) {
      console.log(`    Would clean up ${cleaned} orphaned resource(s)`);
      if (cleaned === 0) {
        console.log(`    ⓘ No orphaned resources found`);
      }
    } else {
      if (cleaned > 0) {
        console.log(`    ✓ Cleaned up ${cleaned} orphaned resource(s)`);
      } else {
        console.log(`    ⓘ No orphaned resources found`);
      }
    }
    
  } finally {
    rhdataDb.close();
    patchbinDb.close();
    resourceDb.close();
    screenshotDb.close();
  }
}

