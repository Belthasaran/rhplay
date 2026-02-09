#!/usr/bin/env node

/**
 * update_waiting_index.js - Update waiting_index.csv for SMWC Waiting pipeline
 *
 * By default (append/update mode): non-destructively merges new or changed
 * entries from games/*.json into existing waiting_index.csv. Preserves rows
 * for gameids not in games/ (historic data). Deduplicates: never adds an
 * identical row. New users typically start with empty games/ and only have
 * files we upload; the CSV accumulates as we process and upload.
 *
 * Full rebuild mode (--full-rebuild): overwrites waiting_index.csv from scratch
 * using all games/*.json (same behavior as make_waiting_index.py).
 *
 * After updating, copies waiting_index.csv to upload/ for distribution.
 *
 * Usage:
 *   enode.sh ~/rhplay/jstools/update_waiting_index.js [options]
 *
 * Options:
 *   --full-rebuild   Overwrite CSV from scratch (like make_waiting_index.py)
 *   --no-copy        Do not copy CSV to upload/
 *   --help           Show this help message
 */

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const COLS = [
  'moderated', 'time', 'date', 'gameid', 'name', 'demo', 'sa1', 'collab',
  'author', 'authors', 'submitter', 'combinedtype', 'length', 'fields_type',
  'difficulty', 'warnings', 'url', 'section', 'tags', 'bps_files', 'json_files', ''
];

const CONFIG = {
  OUTPUT_DIR: path.join(__dirname, 'smwc_world'),
  GAMES_DIR: path.join(__dirname, 'smwc_world', 'games'),
  CSV_PATH: path.join(__dirname, 'smwc_world', 'waiting_index.csv'),
  UPLOAD_DIR: path.join(__dirname, 'smwc_world', 'upload'),
  UPLOAD_CSV_PATH: path.join(__dirname, 'smwc_world', 'upload', 'waiting_index.csv')
};

/** Serialize array for CSV like Python str([...]) for compatibility */
function serializeValue(val) {
  if (Array.isArray(val)) {
    return "[" + val.map(v => "'" + String(v).replace(/'/g, "\\'") + "'").join(', ') + "]";
  }
  if (val === null || val === undefined) return '';
  return String(val);
}

/** Build a row object from game JSON for CSV output */
function rowFromGame(j) {
  const row = {};
  for (const k of COLS) {
    if (k === '') continue;
    if (Object.prototype.hasOwnProperty.call(j, k)) {
      let v = j[k];
      if (k === 'url' && typeof v === 'string') {
        v = v.replace('https://www.smwcentral.net/', '/');
      }
      row[k] = serializeValue(v);
    } else {
      row[k] = '';
    }
  }
  row[''] = '';
  return row;
}

/** Produce a canonical string for deduplication (same content => same string) */
function rowKey(row) {
  const parts = COLS.filter(c => c !== '').map(c => String(row[c] ?? ''));
  return parts.join('\t');
}

/** Parse existing CSV into array of { gameid, row, key } */
function parseExistingCsv() {
  if (!fs.existsSync(CONFIG.CSV_PATH)) return [];
  const content = fs.readFileSync(CONFIG.CSV_PATH, 'utf8');
  const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });
  if (!parsed.meta.fields || parsed.data.length === 0) return [];
  const results = [];
  for (const row of parsed.data) {
    const gameid = String(row.gameid || '').trim();
    if (!gameid) continue;
    const normalized = {};
    for (const k of COLS) {
      normalized[k] = (row[k] !== undefined && row[k] !== null) ? String(row[k]) : '';
    }
    results.push({ gameid, row: normalized, key: rowKey(normalized) });
  }
  return results;
}

/** Escape and format a cell for CSV output */
function escapeCsvCell(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Write rows to CSV file */
function writeCsv(rows) {
  fs.mkdirSync(path.dirname(CONFIG.CSV_PATH), { recursive: true });
  const header = COLS.map(escapeCsvCell).join(',');
  const body = rows.map(r => COLS.map(c => escapeCsvCell(r[c] ?? '')).join(','));
  fs.writeFileSync(CONFIG.CSV_PATH, [header, ...body].join('\n') + '\n', 'utf8');
}

/** Full rebuild: overwrite from all games/*.json */
function fullRebuild() {
  const gamesDir = CONFIG.GAMES_DIR;
  if (!fs.existsSync(gamesDir)) {
    writeCsv([]);
    return { added: 0, updated: 0, total: 0 };
  }
  const files = fs.readdirSync(gamesDir).filter(f => /\.json$/.test(f));
  const rows = [];
  for (const f of files) {
    const p = path.join(gamesDir, f);
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      rows.push(rowFromGame(j));
    } catch (e) {
      console.warn(`Warning: skip ${f}: ${e.message}`);
    }
  }
  writeCsv(rows);
  return { added: 0, updated: 0, total: rows.length };
}

/** Append/update: merge new or changed entries, deduplicate */
function appendUpdate() {
  const existing = parseExistingCsv();
  const byGameid = new Map();
  const seenKeys = new Set();
  for (const { gameid, row, key } of existing) {
    byGameid.set(gameid, row);
    seenKeys.add(key);
  }

  const gamesDir = CONFIG.GAMES_DIR;
  if (!fs.existsSync(gamesDir)) {
    const rows = existing.map(e => e.row);
    writeCsv(rows);
    return { added: 0, updated: 0, total: rows.length };
  }

  const files = fs.readdirSync(gamesDir).filter(f => /\.json$/.test(f));
  let added = 0;
  let updated = 0;

  for (const f of files) {
    const m = f.match(/^(\d+)\.json$/);
    if (!m) continue;
    const gameid = m[1];
    const p = path.join(gamesDir, f);
    let j;
    try {
      j = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      console.warn(`Warning: skip ${f}: ${e.message}`);
      continue;
    }
    const row = rowFromGame(j);
    const key = rowKey(row);
    if (seenKeys.has(key)) continue;
    const prev = byGameid.get(gameid);
    if (!prev) {
      byGameid.set(gameid, row);
      seenKeys.add(key);
      added++;
    } else if (rowKey(prev) !== key) {
      byGameid.set(gameid, row);
      seenKeys.delete(rowKey(prev));
      seenKeys.add(key);
      updated++;
    }
  }

  const sorted = [...byGameid.entries()].sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
  const rows = sorted.map(([, r]) => r);
  writeCsv(rows);
  return { added, updated, total: rows.length };
}

function copyToUpload() {
  if (!fs.existsSync(CONFIG.CSV_PATH)) return;
  fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true });
  fs.copyFileSync(CONFIG.CSV_PATH, CONFIG.UPLOAD_CSV_PATH);
}

function main() {
  const argv = process.argv.slice(2);
  let fullRebuildMode = false;
  let noCopy = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--full-rebuild') fullRebuildMode = true;
    else if (argv[i] === '--no-copy') noCopy = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`
Usage: enode.sh update_waiting_index.js [options]

Update waiting_index.csv for SMWC Waiting pipeline. By default, non-destructively
merges new or changed entries from games/*.json. Copies result to upload/.

Options:
  --full-rebuild   Overwrite CSV from scratch (like make_waiting_index.py)
  --no-copy        Do not copy CSV to upload/
  --help           Show this help message

Examples:
  enode.sh update_waiting_index.js
  enode.sh update_waiting_index.js --full-rebuild
`);
      process.exit(0);
    }
  }

  let result;
  if (fullRebuildMode) {
    result = fullRebuild();
    console.log(`Full rebuild: ${result.total} rows written to waiting_index.csv`);
  } else {
    result = appendUpdate();
    console.log(`Append/update: ${result.added} added, ${result.updated} updated, ${result.total} total rows`);
  }

  if (!noCopy) {
    copyToUpload();
    console.log('Copied waiting_index.csv to upload/');
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  appendUpdate,
  fullRebuild,
  copyToUpload,
  COLS,
  CONFIG
};
