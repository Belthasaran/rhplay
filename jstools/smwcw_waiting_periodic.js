#!/usr/bin/env node

/**
 * smwcw_waiting_periodic.js - Periodic runner for SMWC Waiting pipeline
 *
 * Runs in sequence: smwcw_waiting_compare, smwcw_waiting_fetchmissing, build7z.
 * Uses persistent completed registry so we never re-build for games that were
 * already fully processed, even after upload/done files are expired externally.
 *
 * Usage:
 *   enode.sh ~/rhplay/jstools/smwcw_waiting_periodic.js [options]
 *
 * Options:
 *   --dry-run        Do not run compare/fetch/build, only report what would run
 *   --skip-compare   Skip smwcw_waiting_compare
 *   --skip-fetch     Skip smwcw_waiting_fetchmissing
 *   --only-build-7z  Skip compare and fetch, only run build7z
 *   --max-games N    Limit build7z to at most N games (default: unlimited)
 *   --no-extras      Do not include extras in waiting 7z packages
 *   --help           Show this help message
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { build7zForGame, loadCompletedRegistry, getProcessedGameIds } = require('./smwcw_waiting_build7z');
const { appendUpdate, copyToUpload } = require('./update_waiting_index');

const CONFIG = {
  JSTOOLS_DIR: __dirname,
  OUTPUT_DIR: path.join(__dirname, 'smwc_world'),
  PERIODIC_LOG_PREFIX: 'periodic_log_'
};

function getLogPath() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return path.join(CONFIG.OUTPUT_DIR, `${CONFIG.PERIODIC_LOG_PREFIX}${date}.txt`);
}

function log(message, logStream) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(message);
  if (logStream && logStream.writable) {
    logStream.write(line + '\n');
  }
}

function runCompare() {
  const scriptPath = path.resolve(CONFIG.JSTOOLS_DIR, 'smwcw_waiting_compare.js');
  const enode = path.resolve(__dirname, '..', 'enode.sh');
  const projectRoot = path.resolve(__dirname, '..');
  const result = spawnSync(enode, [scriptPath], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env
  });
  return result.status;
}

function runFetchMissing() {
  const scriptPath = path.resolve(CONFIG.JSTOOLS_DIR, 'smwcw_waiting_fetchmissing.js');
  const enode = path.resolve(__dirname, '..', 'enode.sh');
  const projectRoot = path.resolve(__dirname, '..');
  const result = spawnSync(enode, [scriptPath], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env
  });
  return result.status;
}

function runBuild7z(options, logStream) {
  const completed = new Set(loadCompletedRegistry());
  const processed = getProcessedGameIds();
  const toBuild = processed.filter(g => !completed.has(g));
  const maxGames = options.maxGames ? parseInt(options.maxGames, 10) : toBuild.length;
  const limited = toBuild.slice(0, maxGames);

  log(`Build7z: ${limited.length} games to build (${toBuild.length} total eligible, ${completed.size} already completed)`, logStream);
  let built = 0;
  let failed = 0;
  const buildOptions = { includeExtras: options.includeExtras };
  for (const gameid of limited) {
    try {
      build7zForGame(gameid, false, buildOptions);
      log(`  Built upload/waiting_${gameid}.7z`, logStream);
      built++;
    } catch (e) {
      log(`  Failed ${gameid}: ${e.message}`, logStream);
      failed++;
    }
  }
  return { built, failed, total: limited.length };
}

function main() {
  const argv = process.argv.slice(2);
  const options = {
    dryRun: false,
    skipCompare: false,
    skipFetch: false,
    onlyBuild7z: false,
    maxGames: null,
    includeExtras: true
  };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') options.dryRun = true;
    else if (argv[i] === '--skip-compare') options.skipCompare = true;
    else if (argv[i] === '--skip-fetch') options.skipFetch = true;
    else if (argv[i] === '--only-build-7z') options.onlyBuild7z = true;
    else if (argv[i] === '--no-extras') options.includeExtras = false;
    else if (argv[i] === '--max-games' && i + 1 < argv.length) {
      options.maxGames = argv[++i];
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`
Usage: enode.sh smwcw_waiting_periodic.js [options]

Periodic runner for SMWC Waiting pipeline. Runs compare, fetch, and build7z in sequence.
Uses persistent completed registry so we never re-build for games already fully processed.

Options:
  --dry-run        Do not run compare/fetch/build, only report what would run
  --skip-compare   Skip smwcw_waiting_compare
  --skip-fetch     Skip smwcw_waiting_fetchmissing
  --only-build-7z  Skip compare and fetch, only run build7z
  --max-games N    Limit build7z to at most N games (default: unlimited)
  --no-extras      Do not include extras in waiting 7z packages
  --help           Show this help message

Examples:
  enode.sh smwcw_waiting_periodic.js
  enode.sh smwcw_waiting_periodic.js --only-build-7z --max-games 10
  enode.sh smwcw_waiting_periodic.js --dry-run
`);
      process.exit(0);
    }
  }

  const logPath = getLogPath();
  if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
    fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
  }
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  log('========== smwcw_waiting_periodic started ==========', logStream);

  if (options.dryRun) {
    log('DRY RUN - no actions performed', logStream);
    if (!options.onlyBuild7z) {
      log('Would run: compare, fetch', logStream);
    }
    const completed = new Set(loadCompletedRegistry());
    const processed = getProcessedGameIds();
    const toBuild = processed.filter(g => !completed.has(g));
    log(`Would build ${toBuild.length} packages`, logStream);
    logStream.end();
    process.exit(0);
  }

  let compareStatus = 0;
  let fetchStatus = 0;

  if (!options.onlyBuild7z && !options.skipCompare) {
    log('Running smwcw_waiting_compare...', logStream);
    compareStatus = runCompare();
    log(`Compare exit code: ${compareStatus}`, logStream);
    if (compareStatus !== 0) {
      log('Compare failed, aborting', logStream);
      logStream.end();
      process.exit(1);
    }
  }

  if (!options.onlyBuild7z && !options.skipFetch) {
    log('Running smwcw_waiting_fetchmissing...', logStream);
    fetchStatus = runFetchMissing();
    log(`Fetch exit code: ${fetchStatus}`, logStream);
  }

  log('Running build7z...', logStream);
  const buildResult = runBuild7z(options, logStream);
  log(`Build7z: ${buildResult.built} built, ${buildResult.failed} failed`, logStream);

  log('Updating waiting_index.csv (append/update mode)...', logStream);
  try {
    const csvResult = appendUpdate();
    log(`waiting_index.csv: ${csvResult.added} added, ${csvResult.updated} updated, ${csvResult.total} total rows`, logStream);
    copyToUpload();
    log('Copied waiting_index.csv to upload/', logStream);
  } catch (e) {
    log(`Warning: update_waiting_index failed: ${e.message}`, logStream);
  }

  log('========== smwcw_waiting_periodic complete ==========', logStream);
  logStream.end();

  process.exit(buildResult.failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { main, runCompare, runFetchMissing, runBuild7z, CONFIG };
