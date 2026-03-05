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
 * Optional ArDrive stage (enabled by default): creates/updates waiting_index_ar.csv,
 * a clone of waiting_index.csv with an extra data_txid column. Scans ArDrive waiting
 * folder to resolve data_txid for waiting_<GAMEID>.7z files. Preserves existing
 * non-blank data_txid values in waiting_index_ar.csv.
 *
 * Usage:
 *   enode.sh ~/rhplay/jstools/update_waiting_index.js [options]
 *
 * Options:
 *   --full-rebuild       Overwrite CSV from scratch (like make_waiting_index.py)
 *   --no-copy            Do not copy CSV to upload/
 *   --no-ardrive         Skip ArDrive stage (do not update waiting_index_ar.csv)
 *   --ardrive-drive-id   ArDrive drive ID (default: d3338fab-d24c-4d75-9e78-d3024befc225)
 *   --ardrive-folder-id  ArDrive folder ID (default: 2ef50675-a5bb-45a7-aea8-21cb5603eff6)
 *   --help               Show this help message
 */

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const DEFAULT_ARDRIVE_DRIVE_ID = 'd3338fab-d24c-4d75-9e78-d3024befc225';
const DEFAULT_ARDRIVE_FOLDER_ID = '2ef50675-a5bb-45a7-aea8-21cb5603eff6';

const COLS = [
  'moderated', 'time', 'date', 'gameid', 'name', 'demo', 'sa1', 'collab',
  'author', 'authors', 'submitter', 'combinedtype', 'length', 'fields_type',
  'difficulty', 'warnings', 'url', 'section', 'tags', 'bps_files', 'json_files', ''
];

const COLS_AR = [...COLS.filter(c => c !== ''), 'data_txid', ''];

const CONFIG = {
  OUTPUT_DIR: path.join(__dirname, 'smwc_world'),
  GAMES_DIR: path.join(__dirname, 'smwc_world', 'games'),
  CSV_PATH: path.join(__dirname, 'smwc_world', 'waiting_index.csv'),
  CSV_AR_PATH: path.join(__dirname, 'smwc_world', 'waiting_index_ar.csv'),
  UPLOAD_DIR: path.join(__dirname, 'smwc_world', 'upload'),
  UPLOAD_CSV_PATH: path.join(__dirname, 'smwc_world', 'upload', 'waiting_index.csv'),
  UPLOAD_CSV_AR_PATH: path.join(__dirname, 'smwc_world', 'upload', 'waiting_index_ar.csv')
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

/** Parse existing waiting_index_ar.csv and return Map of gameid -> data_txid */
function parseExistingCsvAr() {
  if (!fs.existsSync(CONFIG.CSV_AR_PATH)) return new Map();
  const content = fs.readFileSync(CONFIG.CSV_AR_PATH, 'utf8');
  const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });
  if (!parsed.meta.fields || parsed.data.length === 0) return new Map();
  const map = new Map();
  for (const row of parsed.data) {
    const gameid = String(row.gameid || '').trim();
    if (!gameid) continue;
    const dataTxid = String(row.data_txid ?? '').trim();
    if (dataTxid) map.set(gameid, dataTxid);
  }
  return map;
}

/** Fetch ArDrive file index for a folder (Map of filename -> file) */
async function fetchArdriveFileIndex(folderId) {
  const arweave = require('arweave');
  const arDriveCore = require('ardrive-core-js');
  //const arweaveUrl = new URL('https://arweave.net:443');
  const   arweaveUrl = new URL('https://ardrive.net:443');
  const arweaveClient = arweave.init({
    host: arweaveUrl.hostname,
    protocol: arweaveUrl.protocol.replace(':', ''),
    port: arweaveUrl.port || 443,
    timeout: 60000
  });
  const arDrive = await arDriveCore.arDriveAnonymousFactory({ arweave: arweaveClient });
  const folderEid = arDriveCore.EID(folderId);
  console.log(`arDrive.listPublicFolder({ folderId: ${folderId}  eid ${folderEid}, maxdepth: 10 })`)
  const items = await arDrive.listPublicFolder({ folderId: folderEid, maxDepth: 10 });
  const files = items.filter(item => item.entityType === 'file');
  const index = new Map();
  for (const file of files) {
    console.log(`index.set(file.name, ${JSON.stringify(file)})`)
    console.log(`FILE_ENTRY   path=${file.path}  dataTxId=${file.dataTxId}  txIdPath=${file.txIdPath}`)
    index.set(file.name, file);
  }
  return index;
}

function isNonBlankDataTxid(val) {
  const s = String(val ?? '').trim();
  return s.length > 0 && s !== '0';
}

/** Update waiting_index_ar.csv from waiting_index.csv + ArDrive. Preserves existing data_txid. */
async function updateWaitingIndexAr(options = {}) {
  const driveId = options.ardriveDriveId || DEFAULT_ARDRIVE_DRIVE_ID;
  const folderId = options.ardriveFolderId || DEFAULT_ARDRIVE_FOLDER_ID;

  if (!fs.existsSync(CONFIG.CSV_PATH)) {
    console.warn('waiting_index.csv not found, skipping ArDrive stage');
    return { resolved: 0, preserved: 0, total: 0 };
  }

  const baseRows = parseExistingCsv();
  if (baseRows.length === 0) {
    console.warn('waiting_index.csv has no rows, skipping ArDrive stage');
    return { resolved: 0, preserved: 0, total: 0 };
  }

  const existingDataTxid = parseExistingCsvAr();
  let ardriveIndex;
  try {
    ardriveIndex = await fetchArdriveFileIndex(folderId);
  } catch (e) {
    console.warn(`ArDrive fetch failed: ${e.message}`);
    ardriveIndex = new Map();
  }

  const arRows = [];
  let resolved = 0;
  let preserved = 0;

  for (const { gameid, row } of baseRows) {
    const arRow = { ...row };
    let dataTxid = '';
    if (isNonBlankDataTxid(existingDataTxid.get(gameid))) {
      dataTxid = existingDataTxid.get(gameid);
      preserved++;
    } else {
      const filename = `waiting_${gameid}.7z`;
      const file = ardriveIndex.get(filename);
      if (file) {
        dataTxid = String(file.dataTxId || file.dataTxID || '').trim();
        if (dataTxid) resolved++;
      }
    }
    arRow.data_txid = dataTxid;
    arRow[''] = '';
    arRows.push(arRow);
  }

  fs.mkdirSync(path.dirname(CONFIG.CSV_AR_PATH), { recursive: true });
  const header = COLS_AR.map(escapeCsvCell).join(',');
  const body = arRows.map(r => COLS_AR.map(c => escapeCsvCell(r[c] ?? '')).join(','));
  fs.writeFileSync(CONFIG.CSV_AR_PATH, [header, ...body].join('\n') + '\n', 'utf8');

  if (!options.noCopy) {
    fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true });
    fs.copyFileSync(CONFIG.CSV_AR_PATH, CONFIG.UPLOAD_CSV_AR_PATH);
  }

  return { resolved, preserved, total: arRows.length };
}

function copyArToUpload() {
  if (!fs.existsSync(CONFIG.CSV_AR_PATH)) return;
  fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true });
  fs.copyFileSync(CONFIG.CSV_AR_PATH, CONFIG.UPLOAD_CSV_AR_PATH);
}

async function main() {
  const argv = process.argv.slice(2);
  let fullRebuildMode = false;
  let noCopy = false;
  let noArdrive = false;
  let ardriveDriveId = DEFAULT_ARDRIVE_DRIVE_ID;
  let ardriveFolderId = DEFAULT_ARDRIVE_FOLDER_ID;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--full-rebuild') fullRebuildMode = true;
    else if (argv[i] === '--no-copy') noCopy = true;
    else if (argv[i] === '--no-ardrive') noArdrive = true;
    else if (argv[i] === '--ardrive-drive-id' && i + 1 < argv.length) ardriveDriveId = argv[++i];
    else if (argv[i] === '--ardrive-folder-id' && i + 1 < argv.length) ardriveFolderId = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`
Usage: enode.sh update_waiting_index.js [options]

Update waiting_index.csv for SMWC Waiting pipeline. By default, non-destructively
merges new or changed entries from games/*.json. Copies result to upload/.
Optionally updates waiting_index_ar.csv with data_txid from ArDrive waiting folder.

Options:
  --full-rebuild        Overwrite CSV from scratch (like make_waiting_index.py)
  --no-copy             Do not copy CSV to upload/
  --no-ardrive          Skip ArDrive stage (do not update waiting_index_ar.csv)
  --ardrive-drive-id    ArDrive drive ID (default: ${DEFAULT_ARDRIVE_DRIVE_ID})
  --ardrive-folder-id   ArDrive folder ID (default: ${DEFAULT_ARDRIVE_FOLDER_ID})
  --help                Show this help message

Examples:
  enode.sh update_waiting_index.js
  enode.sh update_waiting_index.js --full-rebuild
  enode.sh update_waiting_index.js --no-ardrive
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

  if (!noArdrive) {
    try {
      const arResult = await updateWaitingIndexAr({
        ardriveDriveId,
        ardriveFolderId,
        noCopy
      });
      console.log(`waiting_index_ar.csv: ${arResult.resolved} resolved from ArDrive, ${arResult.preserved} preserved, ${arResult.total} total rows`);
      if (!noCopy) console.log('Copied waiting_index_ar.csv to upload/');
    } catch (e) {
      console.warn(`ArDrive stage failed: ${e.message}`);
    }
  }
}

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {
  appendUpdate,
  fullRebuild,
  copyToUpload,
  updateWaitingIndexAr,
  copyArToUpload,
  COLS,
  COLS_AR,
  CONFIG
};
