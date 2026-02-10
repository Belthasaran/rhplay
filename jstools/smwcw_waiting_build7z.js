#!/usr/bin/env node

/**
 * smwcw_waiting_build7z.js - Build 7z waiting packages for SMWC Waiting games
 *
 * Port of enter.py: creates upload/waiting_<GAMEID>.7z for each game.
 * Uses persistent completed registry (waiting_packages_completed.json) so we
 * never re-build for games that were already fully processed, even after
 * upload/done files are expired externally.
 *
 * Usage:
 *   enode.sh ~/rhplay/jstools/smwcw_waiting_build7z.js <GAMEID>
 *   enode.sh ~/rhplay/jstools/smwcw_waiting_build7z.js --all
 *   enode.sh ~/rhplay/jstools/smwcw_waiting_build7z.js --help
 *
 * Options:
 *   --all     Build 7z for all processed games not in completed registry
 *   --dry-run List games that would be built, do not create archives
 *   --help    Show this help message
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { listExtrasUnder } = require('./smwc_world_extras');

const CONFIG = {
  OUTPUT_DIR: path.join(__dirname, 'smwc_world'),
  GAMES_DIR: path.join(__dirname, 'smwc_world', 'games'),
  BPSINDEX_DIR: path.join(__dirname, 'smwc_world', 'bpsindex'),
  BPS_DIR: path.join(__dirname, 'smwc_world', 'bps'),
  IMAGES_DIR: path.join(__dirname, 'smwc_world', 'images'),
  EXTRAS_DIR: path.join(__dirname, 'smwc_world', 'extras'),
  UPLOAD_DIR: path.join(__dirname, 'smwc_world', 'upload'),
  COMPLETED_REGISTRY_PATH: path.join(__dirname, 'smwc_world', 'waiting_packages_completed.json'),
  TRANSIENT_STATE_PATH: path.join(__dirname, 'smwc_world', 'upload', 'waiting_packages_state.json')
};

function loadCompletedRegistry() {
  if (!fs.existsSync(CONFIG.COMPLETED_REGISTRY_PATH)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(CONFIG.COMPLETED_REGISTRY_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : (data.gameids || []);
  } catch (e) {
    return [];
  }
}

function loadTransientState() {
  if (!fs.existsSync(CONFIG.TRANSIENT_STATE_PATH)) {
    return { built: [], uploaded: [] };
  }
  try {
    const raw = fs.readFileSync(CONFIG.TRANSIENT_STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { built: [], uploaded: [] };
  }
}

function getProcessedGameIds() {
  if (!fs.existsSync(CONFIG.GAMES_DIR)) {
    return [];
  }
  const files = fs.readdirSync(CONFIG.GAMES_DIR);
  const gameIds = [];
  for (const f of files) {
    const m = f.match(/^(\d+)\.json$/);
    if (m) gameIds.push(m[1]);
  }
  return gameIds.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

function build7zForGame(gameid, dryRun = false, options = {}) {
  const includeExtras = options.includeExtras !== false;
  const gamesJsonPath = path.join(CONFIG.GAMES_DIR, `${gameid}.json`);
  if (!fs.existsSync(gamesJsonPath)) {
    throw new Error(`games/${gameid}.json not found`);
  }
  const gameData = JSON.parse(fs.readFileSync(gamesJsonPath, 'utf8'));
  const jsonFiles = gameData.json_files || [];
  const bpsFiles = gameData.bps_files || [];
  const screenshotFiles = gameData.screenshot_files || [];
  const archiveRelPath = `upload/waiting_${gameid}.7z`;

  const filesToAdd = [];
  filesToAdd.push(`games/${gameid}.json`);
  for (const jf of jsonFiles) {
    const p = path.join(CONFIG.BPSINDEX_DIR, jf);
    if (fs.existsSync(p)) filesToAdd.push(`bpsindex/${jf}`);
  }
  for (const bf of bpsFiles) {
    const p = path.join(CONFIG.BPS_DIR, bf);
    if (fs.existsSync(p)) filesToAdd.push(`bps/${bf}`);
  }
  const imagesDir = path.join(CONFIG.IMAGES_DIR, gameid);
  if (fs.existsSync(imagesDir) && screenshotFiles.length > 0) {
    for (const sf of screenshotFiles) {
      const p = path.join(imagesDir, sf);
      if (fs.existsSync(p)) filesToAdd.push(`images/${gameid}/${sf}`);
    }
  }

  if (includeExtras && fs.existsSync(CONFIG.EXTRAS_DIR)) {
    const relExtras = path.relative(CONFIG.OUTPUT_DIR, CONFIG.EXTRAS_DIR).replace(/\\/g, '/');
    for (const rel of listExtrasUnder(CONFIG.EXTRAS_DIR, String(gameid))) {
      const arcPath = `${relExtras}/${gameid}/${rel}`.replace(/\\/g, '/');
      const fullPath = path.join(CONFIG.EXTRAS_DIR, String(gameid), rel);
      if (fs.existsSync(fullPath)) filesToAdd.push(arcPath);
    }
    for (const bf of bpsFiles) {
      const hash = bf.replace(/\.bps$/, '');
      const hash2 = hash.slice(0, 2);
      const subPath = path.join(hash2, hash);
      for (const rel of listExtrasUnder(CONFIG.EXTRAS_DIR, subPath)) {
        const arcPath = `${relExtras}/${hash2}/${hash}/${rel}`.replace(/\\/g, '/');
        const fullPath = path.join(CONFIG.EXTRAS_DIR, subPath, rel);
        if (fs.existsSync(fullPath)) filesToAdd.push(arcPath);
      }
    }
  }

  if (dryRun) {
    return { gameid, wouldAdd: filesToAdd.length };
  }

  if (!fs.existsSync(CONFIG.UPLOAD_DIR)) {
    fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true });
  }

  const args = ['a', '-t7z', '-y', archiveRelPath, ...filesToAdd];
  const result = spawnSync('7z', args, {
    cwd: CONFIG.OUTPUT_DIR,
    stdio: 'pipe',
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`7z failed: ${result.stderr || result.stdout || 'unknown error'}`);
  }
  return { gameid, archivePath: path.join(CONFIG.UPLOAD_DIR, `waiting_${gameid}.7z`) };
}

function main() {
  const argv = process.argv.slice(2);
  let gameIdArg = null;
  let all = false;
  let dryRun = false;
  let includeExtras = true;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--all') all = true;
    else if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--no-extras') includeExtras = false;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`
Usage: enode.sh smwcw_waiting_build7z.js <GAMEID> | --all [options]

Build 7z waiting packages for SMWC Waiting games. Uses persistent completed
registry (waiting_packages_completed.json) so we never re-build for games that
were already fully processed, even after upload/done files are expired externally.
By default includes extras (text/README/images from zips) in extras/<gameid>/ and
extras/<hash2>/<bps_hash>/.

Options:
  --all       Build 7z for all processed games not in completed registry
  --dry-run   List games that would be built, do not create archives
  --no-extras Do not include extras from smwc_world/extras in the 7z
  --help      Show this help message

Examples:
  enode.sh smwcw_waiting_build7z.js 41363
  enode.sh smwcw_waiting_build7z.js --all
  enode.sh smwcw_waiting_build7z.js --all --dry-run
`);
      process.exit(0);
    } else if (!argv[i].startsWith('-')) {
      gameIdArg = argv[i];
    }
  }

  const buildOptions = { includeExtras };

  const completed = new Set(loadCompletedRegistry());
  const processed = getProcessedGameIds();

  if (all) {
    const toBuild = processed.filter(g => !completed.has(g));
    if (dryRun) {
      console.log(`Would build ${toBuild.length} packages (dry-run):`);
      for (const g of toBuild) {
        console.log(`  waiting_${g}.7z`);
      }
      process.exit(0);
    }
    let built = 0;
    let failed = 0;
    for (const gameid of toBuild) {
      try {
        build7zForGame(gameid, false, buildOptions);
        console.log(`Built upload/waiting_${gameid}.7z`);
        built++;
      } catch (e) {
        console.error(`Failed ${gameid}: ${e.message}`);
        failed++;
      }
    }
    console.log(`\nBuilt: ${built}, Failed: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
  }

  if (gameIdArg) {
    if (completed.has(gameIdArg)) {
      console.log(`Skipping ${gameIdArg}: already in completed registry`);
      process.exit(0);
    }
    try {
      build7zForGame(gameIdArg, dryRun, buildOptions);
      if (dryRun) {
        console.log(`Would build upload/waiting_${gameIdArg}.7z`);
      } else {
        console.log(`Built upload/waiting_${gameIdArg}.7z`);
      }
    } catch (e) {
      console.error(`Failed: ${e.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  console.error('Error: provide <GAMEID> or --all');
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { build7zForGame, loadCompletedRegistry, getProcessedGameIds, CONFIG };
