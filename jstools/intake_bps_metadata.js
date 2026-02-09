#!/usr/bin/env node

/**
 * intake_bps_metadata.js - Interactive BPS metadata enrichment for ad-hoc intake
 *
 * Steps user through renaming BPS files with metadata for search catalog intake.
 * Output format: "Name by Author [YYYY-MM-DD] (SMW Hack).bps"
 *
 * Usage:
 *   enode.sh ~/rhplay/jstools/intake_bps_metadata.js --input-dir <dir> [options]
 *
 * Options:
 *   --input-dir <dir>   Directory containing BPS files
 *   --interactive       Step through each BPS, show suggested name, allow edit (default)
 *   --batch             Apply pattern, output CSV of original->new for review (no rename)
 *   --apply             Apply renames from batch CSV (use with --batch output)
 *   --output-dir <dir>  Copy/rename to different directory (default: same dir)
 *   --dry-run           Show what would happen, do not rename
 *   --help              Show this help message
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CONFIG = {
  DEFAULT_DATE: new Date().toISOString().slice(0, 10)
};

// Common contest filename patterns: [regex, (match) => { name, author, date }]
const PATTERNS = [
  // 72hoQLDC_1234_authorname.bps
  [
    /^(\w+)_(\d+)_([^\.]+)\.bps$/i,
    (m) => ({ name: `${m[1]} E${m[2]}`, author: m[3].trim(), date: CONFIG.DEFAULT_DATE })
  ],
  // CLDC_entry_01_Name - author.bps
  [
    /^CLDC_entry_(\d+)_([^-]+)\s*-\s*([^\.]+)\.bps$/i,
    (m) => ({ name: `CLDC E${m[1]} ${m[2].trim()}`, author: m[3].trim(), date: CONFIG.DEFAULT_DATE })
  ],
  // 58_Faro-Minta's Winter Escapade V1.1.bps
  [
    /^(\d+)_([^\.]+)\.bps$/i,
    (m) => ({ name: `Entry ${m[1]} ${m[2].trim()}`, author: 'Unknown', date: CONFIG.DEFAULT_DATE })
  ],
  // Name by Author [2022-01-01] (SMW Hack).bps - already formatted
  [
    /^(.+)\s+by\s+(.+?)\s+\[(\d{4}-\d{2}-\d{2})\]\s*\(SMW Hack\)\.bps$/i,
    (m) => ({ name: m[1].trim(), author: m[2].trim(), date: m[3] })
  ]
];

function suggestNewName(filename) {
  const base = path.basename(filename);
  for (const [regex, fn] of PATTERNS) {
    const m = base.match(regex);
    if (m) {
      const { name, author, date } = fn(m);
      return `${name} by ${author} [${date}] (SMW Hack).bps`;
    }
  }
  const stem = base.replace(/\.bps$/i, '');
  return `${stem} by Unknown [${CONFIG.DEFAULT_DATE}] (SMW Hack).bps`;
}

function getBpsFiles(inputDir) {
  if (!fs.existsSync(inputDir)) return [];
  const files = fs.readdirSync(inputDir);
  return files
    .filter(f => /\.bps$/i.test(f))
    .map(f => path.join(inputDir, f))
    .filter(p => fs.statSync(p).isFile());
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function runInteractive(inputDir, outputDir, dryRun) {
  const files = getBpsFiles(inputDir);
  if (files.length === 0) {
    console.log('No BPS files found');
    return;
  }
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const filename = path.basename(filePath);
    const suggested = suggestNewName(filename);
    console.log(`\n[${i + 1}/${files.length}] ${filename}`);
    console.log(`  Suggested: ${suggested}`);
    const answer = await prompt('  New name (Enter=use suggested, q=quit): ');
    if (answer.toLowerCase() === 'q') break;
    const newName = answer.trim() || suggested;
    const destDir = outputDir || inputDir;
    const destPath = path.join(destDir, newName);
    if (!dryRun) {
      fs.mkdirSync(destDir, { recursive: true });
      if (path.resolve(filePath) !== path.resolve(destPath)) {
        if (path.dirname(filePath) === path.dirname(destPath)) {
          fs.renameSync(filePath, destPath);
        } else {
          fs.copyFileSync(filePath, destPath);
          fs.unlinkSync(filePath);
        }
      }
    }
    results.push({ original: filename, new: newName });
    console.log(dryRun ? `  Would write: ${destPath}` : `  Written: ${destPath}`);
  }
  return results;
}

function runBatch(inputDir, outputDir, dryRun) {
  const files = getBpsFiles(inputDir);
  const rows = [];
  for (const filePath of files) {
    const filename = path.basename(filePath);
    const suggested = suggestNewName(filename);
    rows.push({ original: filename, suggested });
  }
  const csvLines = ['original,suggested'];
  for (const r of rows) {
    csvLines.push(`"${r.original.replace(/"/g, '""')}","${r.suggested.replace(/"/g, '""')}"`);
  }
  const csvPath = path.join(inputDir, 'intake_rename_plan.csv');
  if (!dryRun) {
    fs.writeFileSync(csvPath, csvLines.join('\n'));
    console.log(`Wrote ${csvPath} (${rows.length} rows)`);
  } else {
    console.log('Would write CSV:');
    console.log(csvLines.join('\n'));
  }
  return rows;
}

function applyBatchCsv(inputDir, csvPath, dryRun) {
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }
  const content = fs.readFileSync(csvPath, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  const header = lines[0];
  if (!/original.*suggested/i.test(header)) {
    console.error('CSV must have header: original,suggested');
    process.exit(1);
  }
  let applied = 0;
  for (let i = 1; i < lines.length; i++) {
    const match = lines[i].match(/^"([^"]*(?:""[^"]*)*)","([^"]*(?:""[^"]*)*)"$/);
    if (!match) continue;
    const original = match[1].replace(/""/g, '"');
    const newName = match[2].replace(/""/g, '"');
    const srcPath = path.join(inputDir, original);
    const destPath = path.join(inputDir, newName);
    if (!fs.existsSync(srcPath)) {
      console.warn(`Skip (not found): ${original}`);
      continue;
    }
    if (!dryRun) {
      fs.renameSync(srcPath, destPath);
    }
    console.log(dryRun ? `Would rename: ${original} -> ${newName}` : `Renamed: ${original} -> ${newName}`);
    applied++;
  }
  return applied;
}

function main() {
  const argv = process.argv.slice(2);
  let inputDir = null;
  let outputDir = null;
  let interactive = true;
  let batch = false;
  let apply = false;
  let csvPath = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input-dir' && i + 1 < argv.length) {
      inputDir = argv[++i];
    } else if (argv[i] === '--output-dir' && i + 1 < argv.length) {
      outputDir = argv[++i];
    } else if (argv[i] === '--interactive') {
      interactive = true;
      batch = false;
    } else if (argv[i] === '--batch') {
      batch = true;
      interactive = false;
    } else if (argv[i] === '--apply') {
      apply = true;
    } else if (argv[i] === '--csv' && i + 1 < argv.length) {
      csvPath = argv[++i];
    } else if (argv[i] === '--dry-run') {
      dryRun = true;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`
Usage: enode.sh intake_bps_metadata.js --input-dir <dir> [options]

Interactive BPS metadata enrichment for ad-hoc intake. Output format:
  "Name by Author [YYYY-MM-DD] (SMW Hack).bps"

Options:
  --input-dir <dir>   Directory containing BPS files
  --output-dir <dir>  Copy/rename to different directory (default: same)
  --interactive       Step through each BPS (default)
  --batch             Output CSV of original->suggested, no rename
  --apply             Apply renames from CSV (use with --csv)
  --csv <path>        Path to CSV from --batch (for --apply)
  --dry-run           Show what would happen, do not rename
  --help              Show this help message

Examples:
  enode.sh intake_bps_metadata.js --input-dir ./contest_bps --interactive
  enode.sh intake_bps_metadata.js --input-dir ./contest_bps --batch
  enode.sh intake_bps_metadata.js --input-dir ./contest_bps --apply --csv ./contest_bps/intake_rename_plan.csv
`);
      process.exit(0);
    }
  }

  if (!inputDir) {
    console.error('Error: --input-dir required');
    process.exit(1);
  }

  inputDir = path.resolve(inputDir);
  outputDir = outputDir ? path.resolve(outputDir) : inputDir;

  if (apply) {
    const csv = csvPath || path.join(inputDir, 'intake_rename_plan.csv');
    applyBatchCsv(inputDir, csv, dryRun);
    process.exit(0);
  }

  if (batch) {
    runBatch(inputDir, outputDir, dryRun);
    process.exit(0);
  }

  runInteractive(inputDir, outputDir, dryRun).then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

if (require.main === module) {
  main();
}

module.exports = { suggestNewName, getBpsFiles, runInteractive, runBatch, applyBatchCsv, PATTERNS };
