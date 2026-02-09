#!/usr/bin/env node

/**
 * promote_catalog_to_db.js - Promote search catalog item to main database
 *
 * Creates RHPAK (or uses existing) and adds records to rhdata.db, patchbin.db, etc.
 *
 * Usage:
 *   enode.sh ~/rhplay/jstools/promote_catalog_to_db.js --from-json <path> --bps-path <path> [options]
 *
 * Options:
 *   --from-json <path>    Index7z JSON file (required)
 *   --bps-path <path>     Path to BPS file (required)
 *   --metadata-file <path> Extra JSON to merge into gameversion
 *   --add-screenshots <dir> Add screenshots from directory
 *   --skip-rhpak          Use existing skeleton.json (skip RHPAK creation)
 *   --skeleton <path>     Path to prepared skeleton.json (with --skip-rhpak)
 *   --help                Show this help message
 *
 * Environment:
 *   RHDATA_DB_PATH        Override rhdata.db path (for tests)
 *   PATCHBIN_DB_PATH      Override patchbin.db path (for tests)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createRhpak } = require('./promote_catalog_to_rhpak');

const CONFIG = {
  JSTOOLS_DIR: __dirname,
  PROJECT_ROOT: path.resolve(__dirname, '..'),
  RHDATA_DB: process.env.RHDATA_DB_PATH || path.join(__dirname, '..', 'electron', 'rhdata.db'),
  PATCHBIN_DB: process.env.PATCHBIN_DB_PATH || path.join(__dirname, '..', 'electron', 'patchbin.db')
};

function main() {
  const argv = process.argv.slice(2);
  let fromJson = null;
  let bpsPath = null;
  let metadataFile = null;
  let addScreenshots = null;
  let skipRhpak = false;
  let skeletonPath = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from-json' && i + 1 < argv.length) fromJson = argv[++i];
    else if (argv[i] === '--bps-path' && i + 1 < argv.length) bpsPath = argv[++i];
    else if (argv[i] === '--metadata-file' && i + 1 < argv.length) metadataFile = argv[++i];
    else if (argv[i] === '--add-screenshots' && i + 1 < argv.length) addScreenshots = argv[++i];
    else if (argv[i] === '--skip-rhpak') skipRhpak = true;
    else if (argv[i] === '--skeleton' && i + 1 < argv.length) skeletonPath = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`
Usage: enode.sh promote_catalog_to_db.js --from-json <path> --bps-path <path> [options]

Promote search catalog item to main database (rhdata.db, patchbin.db, etc.).

Options:
  --from-json <path>     Index7z JSON file (required unless --skip-rhpak)
  --bps-path <path>      Path to BPS file (required unless --skip-rhpak)
  --metadata-file <path> Extra JSON to merge into gameversion
  --add-screenshots <dir> Add screenshots from directory
  --skip-rhpak           Use existing skeleton (skip RHPAK creation)
  --skeleton <path>      Path to prepared skeleton.json (with --skip-rhpak)
  --help                 Show this help message

Environment:
  RHDATA_DB_PATH   Override rhdata.db path
  PATCHBIN_DB_PATH Override patchbin.db path
`);
      process.exit(0);
    }
  }

  if (!skipRhpak && (!fromJson || !bpsPath)) {
    console.error('Error: --from-json and --bps-path required (or use --skip-rhpak --skeleton)');
    process.exit(1);
  }

  if (skipRhpak) {
    if (!skeletonPath || !fs.existsSync(skeletonPath)) {
      console.error('Error: --skeleton required with --skip-rhpak');
      process.exit(1);
    }
    const baseDir = path.dirname(skeletonPath);
    const enode = path.join(CONFIG.PROJECT_ROOT, 'enode.sh');
    const newgamePath = path.join(CONFIG.JSTOOLS_DIR, 'newgame.js');
    console.log('Running newgame.js --add...');
    const result = spawnSync(enode, [newgamePath, skeletonPath, '--add'], {
      cwd: CONFIG.PROJECT_ROOT,
      stdio: 'inherit',
      env: { ...process.env, RHDATA_DB_PATH: CONFIG.RHDATA_DB, PATCHBIN_DB_PATH: CONFIG.PATCHBIN_DB }
    });
    process.exit(result.status || 0);
  }

  fromJson = path.resolve(fromJson);
  bpsPath = path.resolve(bpsPath);

  if (!fs.existsSync(fromJson)) {
    console.error('Error: JSON file not found:', fromJson);
    process.exit(1);
  }
  if (!fs.existsSync(bpsPath)) {
    console.error('Error: BPS file not found:', bpsPath);
    process.exit(1);
  }

  const itemJson = JSON.parse(fs.readFileSync(fromJson, 'utf8'));
  const tempRhpak = path.join(require('os').tmpdir(), `promote-db-${Date.now()}.rhpak`);

  createRhpak(itemJson, bpsPath, { metadataFile, addScreenshots, output: tempRhpak })
    .then(rhpakPath => {
      const enode = path.join(CONFIG.PROJECT_ROOT, 'enode.sh');
      const newgamePath = path.join(CONFIG.JSTOOLS_DIR, 'newgame.js');
      const result = spawnSync(enode, [newgamePath, rhpakPath, '--import'], {
        cwd: CONFIG.PROJECT_ROOT,
        stdio: 'inherit',
        env: { ...process.env, RHDATA_DB_PATH: CONFIG.RHDATA_DB, PATCHBIN_DB_PATH: CONFIG.PATCHBIN_DB }
      });
      if (result.status !== 0) throw new Error('newgame --import failed');
    })
    .then(() => {
      try { fs.unlinkSync(tempRhpak); } catch (e) {}
      console.log('Promoted to main database');
    })
    .catch(e => {
      console.error('Failed:', e.message);
      process.exit(1);
    });
}

if (require.main === module) {
  main();
}

module.exports = { main, CONFIG };
