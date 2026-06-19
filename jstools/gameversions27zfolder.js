#!/usr/bin/env node

/**
 * gameversions27zfolder.js - Backfill SMWC catalog tree from gameversions DB
 *
 * Builds the same catalog layout and smwchack_(GAMEID).7z archives as updategames
 * catalog export, for games already present in gameversions.
 *
 * Usage:
 *   enode.sh gameversions27zfolder.js --target-7zfolder=~/proj/example \
 *     --sourcezips-folder=~/proj/zips --gameids=all
 *
 * Options:
 *   --target-7zfolder=<path>     Catalog output root (required)
 *   --sourcezips-folder=<path>   Local ZIP search root (required)
 *   --gameids=all|<ids>          All latest gameids or comma-separated list (required)
 *   --rhdata-db=<path>           rhdata.db path (default: electron/rhdata.db)
 *   --download-zips-dir=<path>   Download cache (default: jstools/temp/catalog_zips)
 *   --skip-existing              Skip when games/{id}.json and smwchack 7z exist
 *   --skip-catalog-images        Skip screenshot downloads
 *   --skip-catalog-images-for=<ids>
 *   --skip-catalog-7z            Skip all smwchack 7z builds
 *   --skip-catalog-7z-for=<ids>
 *   --no-download                Do not download missing ZIPs
 *   --dry-run                    Log actions only
 *   --limit=<n>                  Process at most N games
 *   --screenshot-db=<path>       Use local screenshot.db before HTTP image download
 *   --screenshot-data-dir=<path> Decrypted screenshot files root (default: getUserDataDir())
 *   --help, -h                   Show help
 *
 * Environment:
 *   RHDATA_DB_PATH               Override default rhdata.db path
 *   SCREENSHOT_DATA_DIR          Override default screenshot data directory
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { getFlipsPath, getSmwRomPath } = require('../lib/binary-finder');
const catalogExport = require('../lib/smwc_catalog_export');
const { resolveGameZip, findGameZip } = require('../lib/game_zip_resolver');
const {
  openScreenshotDb,
  resolveScreenshotDataDir,
  clearScreenshotCache
} = require('../lib/screenshot_db_reader');

const CONFIG = {
  RHDATA_DB_PATH: process.env.RHDATA_DB_PATH || path.join(__dirname, '..', 'electron', 'rhdata.db'),
  TEMP_DIR: path.join(__dirname, 'temp'),
  DOWNLOAD_ZIPS_DIR: path.join(__dirname, 'temp', 'catalog_zips'),
  USER_AGENT: 'rhtools-gameversions27zfolder/1.0',
  FLIPS_PATH: null,
  BASE_ROM_PATH: null
};

function parseArgs(args) {
  const parsed = {
    'target-7zfolder': null,
    'sourcezips-folder': null,
    'gameids': null,
    'rhdata-db': null,
    'download-zips-dir': null,
    'skip-existing': false,
    'skip-catalog-images': false,
    'skip-catalog-images-for': null,
    'skip-catalog-7z': false,
    'skip-catalog-7z-for': null,
    'no-download': false,
    'dry-run': false,
    'limit': null,
    'screenshot-db': null,
    'screenshot-data-dir': null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith('--target-7zfolder=')) {
      parsed['target-7zfolder'] = path.resolve(expandHome(arg.split('=').slice(1).join('=')));
    } else if (arg === '--target-7zfolder') {
      parsed['target-7zfolder'] = path.resolve(expandHome(args[++i]));
    } else if (arg.startsWith('--sourcezips-folder=')) {
      parsed['sourcezips-folder'] = path.resolve(expandHome(arg.split('=').slice(1).join('=')));
    } else if (arg === '--sourcezips-folder') {
      parsed['sourcezips-folder'] = path.resolve(expandHome(args[++i]));
    } else if (arg.startsWith('--gameids=')) {
      parsed.gameids = arg.split('=').slice(1).join('=');
    } else if (arg === '--gameids') {
      parsed.gameids = args[++i];
    } else if (arg.startsWith('--rhdata-db=')) {
      parsed['rhdata-db'] = path.resolve(expandHome(arg.split('=').slice(1).join('=')));
    } else if (arg === '--rhdata-db') {
      parsed['rhdata-db'] = path.resolve(expandHome(args[++i]));
    } else if (arg.startsWith('--download-zips-dir=')) {
      parsed['download-zips-dir'] = path.resolve(expandHome(arg.split('=').slice(1).join('=')));
    } else if (arg === '--download-zips-dir') {
      parsed['download-zips-dir'] = path.resolve(expandHome(args[++i]));
    } else if (arg === '--skip-existing') {
      parsed['skip-existing'] = true;
    } else if (arg === '--skip-catalog-images') {
      parsed['skip-catalog-images'] = true;
    } else if (arg.startsWith('--skip-catalog-images-for=')) {
      parsed['skip-catalog-images-for'] = arg.split('=')[1];
    } else if (arg === '--skip-catalog-images-for') {
      parsed['skip-catalog-images-for'] = args[++i];
    } else if (arg === '--skip-catalog-7z') {
      parsed['skip-catalog-7z'] = true;
    } else if (arg.startsWith('--skip-catalog-7z-for=')) {
      parsed['skip-catalog-7z-for'] = arg.split('=')[1];
    } else if (arg === '--skip-catalog-7z-for') {
      parsed['skip-catalog-7z-for'] = args[++i];
    } else if (arg === '--no-download') {
      parsed['no-download'] = true;
    } else if (arg === '--dry-run') {
      parsed['dry-run'] = true;
    } else if (arg.startsWith('--limit=')) {
      parsed.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--limit') {
      parsed.limit = parseInt(args[++i], 10);
    } else if (arg.startsWith('--screenshot-db=')) {
      parsed['screenshot-db'] = path.resolve(expandHome(arg.split('=').slice(1).join('=')));
    } else if (arg === '--screenshot-db') {
      parsed['screenshot-db'] = path.resolve(expandHome(args[++i]));
    } else if (arg.startsWith('--screenshot-data-dir=')) {
      parsed['screenshot-data-dir'] = path.resolve(expandHome(arg.split('=').slice(1).join('=')));
    } else if (arg === '--screenshot-data-dir') {
      parsed['screenshot-data-dir'] = path.resolve(expandHome(args[++i]));
    }
  }

  return parsed;
}

function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~/')) return path.join(process.env.HOME || '', p.slice(2));
  if (p === '~') return process.env.HOME || p;
  return p;
}

function printHelp() {
  console.log(`
gameversions27zfolder.js - Backfill SMWC catalog from gameversions DB

Usage:
  enode.sh gameversions27zfolder.js --target-7zfolder=<path> \\
    --sourcezips-folder=<path> --gameids=all|id1,id2

Required:
  --target-7zfolder=<path>       Catalog output root
  --sourcezips-folder=<path>     Recursive local ZIP search root
  --gameids=all|<ids>            Latest gameversions row per gameid

Options:
  --rhdata-db=<path>             rhdata.db (default: electron/rhdata.db, env RHDATA_DB_PATH)
  --download-zips-dir=<path>       Download cache (default: jstools/temp/catalog_zips)
  --skip-existing                Skip complete games/{id}.json + smwchack 7z
  --skip-catalog-images          Skip SMWC screenshot downloads
  --skip-catalog-images-for=<ids>
  --skip-catalog-7z              Skip smwchack 7z builds
  --skip-catalog-7z-for=<ids>
  --no-download                  Fail if ZIP not found locally
  --dry-run                      Preview without writes
  --limit=<n>                    Process at most N games
  --screenshot-db=<path>         Use screenshot.db before HTTP image download
  --screenshot-data-dir=<path>   Decrypted screenshot files root (env SCREENSHOT_DATA_DIR)
  --help, -h                     Show this help

Output:
  <target-7zfolder>/bps|bpsindex|games|extras|images/
  <target-7zfolder>.build/smwchack_(GAMEID).7z
`);
}

function verifyPrerequisites(argv, catalogDir) {
  CONFIG.FLIPS_PATH = getFlipsPath({ projectRoot: __dirname, throwOnError: true });
  CONFIG.BASE_ROM_PATH = getSmwRomPath({ projectRoot: __dirname, throwOnError: true });
  if (!fs.existsSync(CONFIG.TEMP_DIR)) {
    fs.mkdirSync(CONFIG.TEMP_DIR, { recursive: true });
  }
  catalogExport.verifyCatalogWritable(catalogDir, {
    skip7zCheck: argv['skip-catalog-7z']
  });
}

function loadLatestGameversions(dbPath, gameidsFilter) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare(`
      SELECT gv.*
      FROM gameversions gv
      INNER JOIN (
        SELECT gameid, MAX(version) AS max_version
        FROM gameversions
        GROUP BY gameid
      ) latest ON gv.gameid = latest.gameid AND gv.version = latest.max_version
      WHERE COALESCE(gv.removed, 0) = 0 AND COALESCE(gv.obsoleted, 0) = 0
      ORDER BY CAST(gv.gameid AS INTEGER)
    `).all();

    if (!gameidsFilter || gameidsFilter === 'all') {
      return rows;
    }

    const wanted = new Set(String(gameidsFilter).split(',').map(s => s.trim()).filter(Boolean));
    return rows.filter(r => wanted.has(String(r.gameid)));
  } finally {
    db.close();
  }
}

function isCatalogComplete(catalogDir, gameid) {
  const gid = String(gameid);
  const gamesJson = path.join(catalogDir, 'games', `${gid}.json`);
  const archive = path.join(catalogExport.getCatalogBuildDir(catalogDir), `smwchack_${gid}.7z`);
  return fs.existsSync(gamesJson) && fs.existsSync(archive);
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));

  if (!argv['target-7zfolder'] || !argv['sourcezips-folder'] || !argv.gameids) {
    console.error('Error: --target-7zfolder, --sourcezips-folder, and --gameids are required');
    printHelp();
    process.exit(1);
  }

  const catalogDir = argv['target-7zfolder'];
  const sourceZipsFolder = argv['sourcezips-folder'];
  const dbPath = argv['rhdata-db'] || CONFIG.RHDATA_DB_PATH;
  const downloadZipsDir = argv['download-zips-dir'] || CONFIG.DOWNLOAD_ZIPS_DIR;
  const dryRun = argv['dry-run'];

  if (!fs.existsSync(dbPath)) {
    console.error(`Error: rhdata.db not found: ${dbPath}`);
    process.exit(1);
  }

  console.log('==================================================');
  console.log('     gameversions27zfolder - Catalog Backfill     ');
  console.log('==================================================\n');
  console.log(`  Catalog dir:     ${catalogDir}`);
  console.log(`  Source zips:     ${sourceZipsFolder}`);
  console.log(`  Database:        ${dbPath}`);
  console.log(`  Download cache:  ${downloadZipsDir}`);
  if (argv['screenshot-db']) {
    console.log(`  Screenshot DB:   ${argv['screenshot-db']}`);
    console.log(`  Screenshot data: ${resolveScreenshotDataDir({ screenshotDataDir: argv['screenshot-data-dir'] })}`);
  }
  if (dryRun) console.log('  Mode:            DRY RUN\n');

  verifyPrerequisites(argv, catalogDir);

  let screenshotDb = null;
  const screenshotDataDir = argv['screenshot-db']
    ? resolveScreenshotDataDir({ screenshotDataDir: argv['screenshot-data-dir'] })
    : null;

  if (argv['screenshot-db']) {
    try {
      screenshotDb = openScreenshotDb(argv['screenshot-db']);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  }

  let failed = 0;
  try {
  let rows = loadLatestGameversions(dbPath, argv.gameids);
  if (argv.limit != null && argv.limit > 0) {
    rows = rows.slice(0, argv.limit);
  }

  console.log(`  Games to process: ${rows.length}\n`);

  let processed = 0;
  let skipped = 0;
  let downloaded = 0;

  for (const row of rows) {
    const gameid = String(row.gameid);
    processed++;
    console.log(`\n[${processed}/${rows.length}] Game ${gameid}: ${row.name || '(no name)'}`);

    if (argv['skip-existing'] && isCatalogComplete(catalogDir, gameid)) {
      console.log('  ⓘ Catalog already complete, skipping');
      skipped++;
      continue;
    }

    const metadata = catalogExport.metadataFromGameversionRow(row);

    try {
      if (dryRun) {
        const local = findGameZip(sourceZipsFolder, gameid, metadata, row);
        console.log(`  [DRY RUN] ZIP: ${local || '(would download or fail)'}`);
        await catalogExport.exportCatalogForGame({
          catalogDir,
          gameid,
          metadata,
          zipPath: local || path.join(downloadZipsDir, `${gameid}.zip`),
          flipsPath: CONFIG.FLIPS_PATH,
          baseRomPath: CONFIG.BASE_ROM_PATH,
          tempDir: CONFIG.TEMP_DIR,
          argv,
          dryRun: true,
          screenshotDb,
          screenshotDataDir,
          logFn: (msg) => console.log(msg)
        });
        continue;
      }

      const zipResult = await resolveGameZip({
        sourceRoot: sourceZipsFolder,
        gameid,
        metadata,
        row,
        downloadUrl: row.download_url,
        downloadDir: downloadZipsDir,
        allowDownload: !argv['no-download'],
        config: { USER_AGENT: CONFIG.USER_AGENT },
        logFn: (msg) => console.log(msg)
      });

      if (!zipResult.zipPath) {
        throw new Error(zipResult.error || 'Could not resolve ZIP file');
      }

      if (zipResult.source === 'download') downloaded++;

      const result = await catalogExport.exportCatalogForGame({
        catalogDir,
        gameid,
        metadata,
        zipPath: zipResult.zipPath,
        flipsPath: CONFIG.FLIPS_PATH,
        baseRomPath: CONFIG.BASE_ROM_PATH,
        tempDir: CONFIG.TEMP_DIR,
        argv,
        dryRun: false,
        screenshotDb,
        screenshotDataDir,
        logFn: (msg) => console.log(msg)
      });

      if (!result.ok) {
        throw new Error((result.errors && result.errors.join('; ')) || 'Catalog export failed');
      }

      console.log(`  ✓ Catalog export complete (ZIP: ${zipResult.source})`);
    } catch (error) {
      console.error(`  ✗ Failed: ${error.message}`);
      failed++;
    }
  }

  console.log('\n==================================================');
  console.log('                  Summary                         ');
  console.log('==================================================');
  console.log(`  Processed:   ${processed}`);
  console.log(`  Skipped:    ${skipped}`);
  console.log(`  Downloaded: ${downloaded}`);
  console.log(`  Failed:     ${failed}\n`);
  } finally {
    if (screenshotDb) {
      screenshotDb.close();
    }
    clearScreenshotCache();
  }

  return failed > 0 ? 1 : 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch(err => {
      console.error('Fatal error:', err.message);
      console.error(err.stack);
      process.exit(1);
    });
}

module.exports = { main, parseArgs, loadLatestGameversions, isCatalogComplete };
