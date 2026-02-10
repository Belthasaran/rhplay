#!/usr/bin/env node

/**
 * intake_pack_and_index.js - Pack BPS into 7z and run process_index7zs + search_build
 *
 * Shards arcsfcXX_bps into 7z archives (~25MB, ~100 items each), runs process_index7zs,
 * then search_build1 and search_build2. Generates update_bpsarchives commands.
 *
 * Usage:
 *   enode.sh ~/rhplay/jstools/intake_pack_and_index.js --json-dir <dir> --bps-dir <dir> [options]
 *
 * Options:
 *   --json-dir <dir>    Directory with master JSON files (arcsfc output or arcsfcXX_json)
 *   --bps-dir <dir>     Directory with BPS files (arcsfc output or arcsfcXX_bps)
 *   --index7z <dir>     Master index directory (default: ../refmaterial/index7z or ./index7z)
 *   --bps7z <dir>       Output dir for new 7z archives (default: ./bps7z_new)
 *   --batch-prefix <s>  Prefix for 7z files (default: bpsxc_YYYYMMDD)
 *   --max-per-7z N      Max items per 7z (default: 100)
 *   --max-size-mb N     Target max size per 7z in MB (default: 25)
 *   --dry-run           Report what would run, do not execute
 *   --skip-search       Skip search_build1 and search_build2
 *   --no-extras         Do not include extras (text/README/images) from smwc_world/extras in 7z
 *   --extras-dir <dir>  Directory for extras (default: jstools/smwc_world/extras)
 *   --help              Show this help message
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { listExtrasUnder } = require('./smwc_world_extras');

const CONFIG = {
  JSTOOLS_DIR: __dirname,
  PROJECT_ROOT: path.resolve(__dirname, '..'),
  DEFAULT_INDEX7Z: path.join(__dirname, '..', 'refmaterial', 'index7z'),
  DEFAULT_BPS7Z: path.join(__dirname, 'bps7z_new'),
  DEFAULT_EXTRAS_DIR: path.join(__dirname, 'smwc_world', 'extras'),
  MAX_PER_7Z: 100,
  MAX_SIZE_MB: 25
};

function getBpsFiles(bpsDir) {
  if (!fs.existsSync(bpsDir)) return [];
  const files = fs.readdirSync(bpsDir);
  return files
    .filter(f => /\.bps$/i.test(f))
    .map(f => ({ name: f, path: path.join(bpsDir, f), size: fs.statSync(path.join(bpsDir, f)).size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function shardIntoBatches(files, maxPer7z, maxSizeBytes) {
  const batches = [];
  let current = [];
  let currentSize = 0;
  for (const f of files) {
    if (current.length >= maxPer7z || (currentSize + f.size > maxSizeBytes && current.length > 0)) {
      batches.push([...current]);
      current = [];
      currentSize = 0;
    }
    current.push(f);
    currentSize += f.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function create7zArchives(bpsDir, batches, bps7zDir, batchPrefix, dryRun, options = {}) {
  const extrasDir = options.extrasDir || null;
  const includeExtras = options.includeExtras !== false && extrasDir && fs.existsSync(extrasDir);
  const created = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const suffix = batches.length > 1 ? `_${i.toString(36)}` : '';
    const archiveName = `${batchPrefix}${suffix}.7z`;
    const archivePath = path.join(bps7zDir, archiveName);
    if (dryRun) {
      const extraCount = includeExtras ? batch.reduce((sum, f) => {
        const hash = f.name.replace(/\.bps$/i, '');
        const hash2 = hash.slice(0, 2);
        return sum + listExtrasUnder(extrasDir, path.join(hash2, hash)).length;
      }, 0) : 0;
      console.log('Would create', archivePath, `(${batch.length} BPS${extraCount ? ` + ${extraCount} extras` : ''})`);
      created.push(archivePath);
      continue;
    }
    fs.mkdirSync(bps7zDir, { recursive: true });
    let result;
    if (includeExtras) {
      const stagingDir = path.join(bps7zDir, `.staging_${batchPrefix}${suffix}_${Date.now()}`);
      fs.mkdirSync(stagingDir, { recursive: true });
      try {
        for (const f of batch) {
          fs.copyFileSync(f.path, path.join(stagingDir, path.basename(f.path)));
        }
        for (const f of batch) {
          const hash = f.name.replace(/\.bps$/i, '');
          const hash2 = hash.slice(0, 2);
          const subPath = path.join(hash2, hash);
          const files = listExtrasUnder(extrasDir, subPath);
          for (const rel of files) {
            const src = path.join(extrasDir, subPath, rel);
            const dest = path.join(stagingDir, 'extras', subPath, rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
          }
        }
        result = spawnSync('7z', ['a', '-t7z', '-y', '-mx=9', path.resolve(archivePath), '.'], {
          cwd: stagingDir,
          stdio: 'pipe',
          encoding: 'utf8'
        });
      } finally {
        try {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        } catch (_) {}
      }
    } else {
      const fileArgs = batch.map(f => f.path);
      result = spawnSync('7z', ['a', '-t7z', '-y', '-mx=9', archivePath, ...fileArgs], {
        cwd: path.dirname(archivePath),
        stdio: 'pipe',
        encoding: 'utf8'
      });
    }
    if (result.status !== 0) {
      throw new Error(`7z failed for ${archiveName}: ${result.stderr || result.stdout}`);
    }
    console.log('Created', archiveName);
    created.push(archivePath);
  }
  return created;
}

function runProcessIndex7zs(jsonDir, index7zDir, bps7zDir, dryRun) {
  const scriptPath = path.join(CONFIG.JSTOOLS_DIR, 'process_index7zs.js');
  const enode = path.join(CONFIG.PROJECT_ROOT, 'enode.sh');
  console.log('Running process_index7zs.js...');
  if (dryRun) {
    console.log('  enode.sh process_index7zs.js', jsonDir, index7zDir, bps7zDir);
    return 0;
  }
  const result = spawnSync(enode, [scriptPath, jsonDir, index7zDir, bps7zDir], {
    cwd: CONFIG.PROJECT_ROOT,
    stdio: 'inherit',
    env: process.env
  });
  return result.status;
}

function runSearchBuild1(index7zDir, bps7zDir, dryRun) {
  const scriptPath = path.join(CONFIG.JSTOOLS_DIR, 'search_build1.js');
  const enode = path.join(CONFIG.PROJECT_ROOT, 'enode.sh');
  console.log('Running search_build1.js...');
  if (dryRun) {
    console.log('  enode.sh search_build1.js', index7zDir, bps7zDir);
    return 0;
  }
  const result = spawnSync(enode, [scriptPath, index7zDir, bps7zDir], {
    cwd: CONFIG.PROJECT_ROOT,
    stdio: 'inherit',
    env: process.env
  });
  return result.status;
}

function runSearchBuild2(index7zDir, bps7zDir, dryRun) {
  const scriptPath = path.join(CONFIG.JSTOOLS_DIR, 'search_build2.js');
  const enode = path.join(CONFIG.PROJECT_ROOT, 'enode.sh');
  console.log('Running search_build2.js...');
  if (dryRun) {
    console.log('  enode.sh search_build2.js', index7zDir, bps7zDir);
    return 0;
  }
  const result = spawnSync(enode, [scriptPath, index7zDir, bps7zDir], {
    cwd: CONFIG.PROJECT_ROOT,
    stdio: 'inherit',
    env: process.env
  });
  return result.status;
}

function main() {
  const argv = process.argv.slice(2);
  let jsonDir = null;
  let bpsDir = null;
  let index7zDir = CONFIG.DEFAULT_INDEX7Z;
  let bps7zDir = CONFIG.DEFAULT_BPS7Z;
  let batchPrefix = `bpsxc_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  let maxPer7z = CONFIG.MAX_PER_7Z;
  let maxSizeMb = CONFIG.MAX_SIZE_MB;
  let dryRun = false;
  let skipSearch = false;
  let includeExtras = true;
  let extrasDir = CONFIG.DEFAULT_EXTRAS_DIR;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json-dir' && i + 1 < argv.length) jsonDir = argv[++i];
    else if (argv[i] === '--bps-dir' && i + 1 < argv.length) bpsDir = argv[++i];
    else if (argv[i] === '--index7z' && i + 1 < argv.length) index7zDir = argv[++i];
    else if (argv[i] === '--bps7z' && i + 1 < argv.length) bps7zDir = argv[++i];
    else if (argv[i] === '--batch-prefix' && i + 1 < argv.length) batchPrefix = argv[++i];
    else if (argv[i] === '--max-per-7z' && i + 1 < argv.length) maxPer7z = parseInt(argv[++i], 10);
    else if (argv[i] === '--max-size-mb' && i + 1 < argv.length) maxSizeMb = parseInt(argv[++i], 10);
    else if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--skip-search') skipSearch = true;
    else if (argv[i] === '--no-extras') includeExtras = false;
    else if (argv[i] === '--extras-dir' && i + 1 < argv.length) extrasDir = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`
Usage: enode.sh intake_pack_and_index.js --json-dir <dir> --bps-dir <dir> [options]

Pack BPS into 7z and run process_index7zs + search_build.
By default includes extras (text/README/images) from smwc_world/extras when building 7z.

Options:
  --json-dir <dir>    Directory with master JSON files
  --bps-dir <dir>     Directory with BPS files
  --index7z <dir>     Master index directory
  --bps7z <dir>       Output dir for new 7z archives
  --batch-prefix <s>  Prefix for 7z files
  --max-per-7z N      Max items per 7z (default: 100)
  --max-size-mb N     Target max size per 7z in MB (default: 25)
  --dry-run           Report what would run
  --skip-search       Skip search_build1 and search_build2
  --no-extras         Do not include extras in 7z archives
  --extras-dir <dir>  Extras root (default: jstools/smwc_world/extras)
  --help              Show this help message
`);
      process.exit(0);
    }
  }

  if (!jsonDir || !bpsDir) {
    console.error('Error: --json-dir and --bps-dir required');
    process.exit(1);
  }

  jsonDir = path.resolve(jsonDir);
  bpsDir = path.resolve(bpsDir);
  index7zDir = path.resolve(index7zDir);
  bps7zDir = path.resolve(bps7zDir);

  const files = getBpsFiles(bpsDir);
  if (files.length === 0) {
    console.error('No BPS files found in', bpsDir);
    process.exit(1);
  }

  const maxSizeBytes = maxSizeMb * 1024 * 1024;
  const batches = shardIntoBatches(files, maxPer7z, maxSizeBytes);
  console.log(`Sharded ${files.length} BPS files into ${batches.length} batch(es)`);

  extrasDir = path.resolve(extrasDir);
  const created = create7zArchives(bpsDir, batches, bps7zDir, batchPrefix, dryRun, {
    extrasDir,
    includeExtras
  });

  fs.mkdirSync(index7zDir, { recursive: true });
  const status1 = runProcessIndex7zs(jsonDir, index7zDir, bps7zDir, dryRun);
  if (status1 !== 0) process.exit(1);

  if (!skipSearch) {
    const status2 = runSearchBuild1(index7zDir, bps7zDir, dryRun);
    if (status2 !== 0) process.exit(1);
    const status3 = runSearchBuild2(index7zDir, bps7zDir, dryRun);
    if (status3 !== 0) process.exit(1);
  }

  console.log('\n--- Next: add archives to bpsarchives.json ---');
  for (const archivePath of created) {
    const base = path.basename(archivePath);
    console.log(`enode.sh jsutils/update_bpsarchives.js electron/bpsarchives.json --add-archive ${base}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, getBpsFiles, shardIntoBatches, create7zArchives, CONFIG };
