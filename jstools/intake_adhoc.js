#!/usr/bin/env node

/**
 * intake_adhoc.js - Orchestrate ad-hoc catalog intake for contests and one-off hacks
 *
 * Routes BPS/ZIP/SFC folders through the appropriate intake pipeline.
 * For BPS: optionally run intake_bps_metadata, then patch_cwd_bps_files, then process_arcsfc_runner.
 * For SFC: run process_arcsfc_runner (creates 7z per SFC if missing).
 * For ZIP: extract BPS, then same as BPS path.
 *
 * Usage:
 *   enode.sh ~/rhplay/jstools/intake_adhoc.js --input-dir <dir> --mode bps|zip|sfc [options]
 *
 * Options:
 *   --input-dir <dir>   Directory containing BPS, ZIP, or SFC files
 *   --mode bps|zip|sfc  Source type (default: auto-detect)
 *   --metadata-script   Run intake_bps_metadata before processing (BPS/ZIP only)
 *   --dry-run           Report what would run, do not execute
 *   --help              Show this help message
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');

const CONFIG = {
  JSTOOLS_DIR: __dirname,
  PYTOOLS_DIR: path.join(__dirname, '..', 'pytools'),
  PROJECT_ROOT: path.resolve(__dirname, '..')
};

function detectMode(inputDir) {
  const files = fs.readdirSync(inputDir);
  const hasBps = files.some(f => /\.bps$/i.test(f));
  const hasSfc = files.some(f => /\.sfc$/i.test(f));
  const hasZip = files.some(f => /\.zip$/i.test(f));
  if (hasBps && !hasSfc) return 'bps';
  if (hasSfc && !hasBps) return 'sfc';
  if (hasZip && !hasBps && !hasSfc) return 'zip';
  if (hasBps) return 'bps';
  if (hasSfc) return 'sfc';
  if (hasZip) return 'zip';
  return null;
}

function runMetadataScript(inputDir, dryRun) {
  const scriptPath = path.join(CONFIG.JTOOLS_DIR, 'intake_bps_metadata.js');
  const enode = path.join(CONFIG.PROJECT_ROOT, 'enode.sh');
  const args = ['--input-dir', inputDir, '--interactive'];
  if (dryRun) args.push('--dry-run');
  console.log('Running intake_bps_metadata.js (interactive)...');
  const result = spawnSync(enode, [scriptPath, ...args], {
    cwd: CONFIG.PROJECT_ROOT,
    stdio: 'inherit',
    env: process.env
  });
  return result.status;
}

function runPatchCwdBps(inputDir, dryRun) {
  const scriptPath = path.join(CONFIG.PYTOOLS_DIR, 'patch_cwd_bps_files.py');
  console.log('Running patch_cwd_bps_files.py...');
  if (dryRun) {
    console.log('  (dry-run: would create SFC+7z from BPS in', inputDir, ')');
    return 0;
  }
  const result = spawnSync('python3', [scriptPath], {
    cwd: inputDir,
    stdio: 'inherit',
    env: { ...process.env, PATH_BASE_ROM: process.env.PATH_BASE_ROM || process.env.PATH_BASE_ROM }
  });
  return result.status;
}

function runProcessArcsfc(inputDir, dryRun) {
  const scriptPath = path.join(CONFIG.JTOOLS_DIR, 'process_arcsfc_runner.js');
  const enode = path.join(CONFIG.PROJECT_ROOT, 'enode.sh');
  console.log('Running process_arcsfc_runner.js...');
  if (dryRun) {
    console.log('  (dry-run: would process SFC+7z pairs in', inputDir, ')');
    return 0;
  }
  const result = spawnSync(enode, [scriptPath], {
    cwd: inputDir,
    stdio: 'inherit',
    env: process.env
  });
  return result.status;
}

function ensure7zForSfc(inputDir, dryRun) {
  const files = fs.readdirSync(inputDir);
  const sfcFiles = files.filter(f => /\.sfc$/i.test(f));
  let created = 0;
  for (const sfc of sfcFiles) {
    const base = path.basename(sfc, path.extname(sfc));
    const zip7z = base + '.7z';
    const zipPath = path.join(inputDir, zip7z);
    if (!fs.existsSync(zipPath)) {
      if (dryRun) {
        console.log('  Would create', zip7z, 'for', sfc);
        created++;
      } else {
        const sfcPath = path.join(inputDir, sfc);
        const result = spawnSync('7z', ['a', '-t7z', '-y', zip7z, sfc], {
          cwd: inputDir,
          stdio: 'pipe',
          encoding: 'utf8'
        });
        if (result.status === 0) {
          console.log('  Created', zip7z);
          created++;
        } else {
          console.warn('  Failed to create', zip7z);
        }
      }
    }
  }
  return created;
}

function extractBpsFromZips(inputDir) {
  const files = fs.readdirSync(inputDir);
  const zipFiles = files.filter(f => /\.zip$/i.test(f));
  const extracted = [];
  for (const zipFile of zipFiles) {
    const zipPath = path.join(inputDir, zipFile);
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      if (/\.bps$/i.test(entry.entryName)) {
        const bpsName = path.basename(entry.entryName);
        const bpsPath = path.join(inputDir, bpsName);
        const data = zip.readFile(entry);
        if (data && !fs.existsSync(bpsPath)) {
          fs.writeFileSync(bpsPath, data);
          extracted.push(bpsName);
        }
      }
    }
  }
  return extracted;
}

function main() {
  const argv = process.argv.slice(2);
  let inputDir = null;
  let mode = null;
  let metadataScript = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input-dir' && i + 1 < argv.length) {
      inputDir = argv[++i];
    } else if (argv[i] === '--mode' && i + 1 < argv.length) {
      mode = argv[++i];
    } else if (argv[i] === '--metadata-script') {
      metadataScript = true;
    } else if (argv[i] === '--dry-run') {
      dryRun = true;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`
Usage: enode.sh intake_adhoc.js --input-dir <dir> [options]

Orchestrate ad-hoc catalog intake for contests and one-off hacks.

Options:
  --input-dir <dir>   Directory containing BPS, ZIP, or SFC files
  --mode bps|zip|sfc  Source type (default: auto-detect)
  --metadata-script   Run intake_bps_metadata before processing (BPS/ZIP only)
  --dry-run           Report what would run, do not execute
  --help              Show this help message

Examples:
  enode.sh intake_adhoc.js --input-dir ./contest_bps --mode bps --metadata-script
  enode.sh intake_adhoc.js --input-dir ./contest_zips --mode zip
  enode.sh intake_adhoc.js --input-dir ./contest_sfc --mode sfc
`);
      process.exit(0);
    }
  }

  if (!inputDir) {
    console.error('Error: --input-dir required');
    process.exit(1);
  }

  inputDir = path.resolve(inputDir);
  if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    console.error('Error: input-dir must be an existing directory');
    process.exit(1);
  }

  if (!mode) {
    mode = detectMode(inputDir);
    if (!mode) {
      console.error('Error: could not auto-detect mode (no BPS/ZIP/SFC files). Use --mode explicitly.');
      process.exit(1);
    }
    console.log('Auto-detected mode:', mode);
  }

  if (mode === 'zip') {
    console.log('Extracting BPS from ZIP files...');
    if (!dryRun) {
      const extracted = extractBpsFromZips(inputDir);
      console.log('Extracted', extracted.length, 'BPS files');
    }
    mode = 'bps';
  }

  if (mode === 'bps') {
    if (metadataScript) {
      const status = runMetadataScript(inputDir, dryRun);
      if (status !== 0) process.exit(1);
    }
    const status1 = runPatchCwdBps(inputDir, dryRun);
    if (status1 !== 0) process.exit(1);
  }

  if (mode === 'sfc') {
    ensure7zForSfc(inputDir, dryRun);
  }

  const status2 = runProcessArcsfc(inputDir, dryRun);
  if (status2 !== 0) process.exit(1);

  console.log('\nIntake complete. Output in', path.join(inputDir, 'output'), '(from process_arcsfc).');
  console.log('Next: run intake_pack_and_index.js on arcsfcXX_json and arcsfcXX_bps.');
}

if (require.main === module) {
  main();
}

module.exports = { main, detectMode, runMetadataScript, runPatchCwdBps, runProcessArcsfc, CONFIG };
