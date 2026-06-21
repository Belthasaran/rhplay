#!/usr/bin/env node

/**
 * find_waiting_notincluded.js - Find waiting-index CSV entries not in gameversions
 *
 * Reads a waiting index CSV, finds entries whose gameids are not in rhdata.db,
 * groups related submissions via BPS-hash and fuzzy name/author matching, and
 * reports stale waiting entries.
 *
 * Usage:
 *   enode.sh jstools/find_waiting_notincluded.js --index=jstools/smwc_world/waiting_index_ar.csv
 *   enode.sh jstools/find_waiting_notincluded.js --index=... --older-than=30 --json
 *
 * Options:
 *   --index=PATH           Required. Waiting index CSV path
 *   --rhdatadb=PATH        Override rhdata.db (default: RHDATA_DB_PATH or electron/rhdata.db)
 *   --older-than=N         Exclude rows newer than N days (keep stale entries only)
 *   --hidematches-all      Hide groups with any DB fuzzy match
 *   --hidematches-oldonly  Hide groups only when DB match is newer than latest CSV entry
 *   --json                 JSON output instead of human-readable
 *   --help                 Show help
 *
 * Environment:
 *   RHDATA_DB_PATH         Override default rhdata.db path
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const Papa = require('papaparse');

const DEFAULT_RHDATA_DB = path.join(__dirname, '..', 'electron', 'rhdata.db');

const CSV_COLS = [
  'moderated', 'time', 'date', 'gameid', 'name', 'demo', 'sa1', 'collab',
  'author', 'authors', 'submitter', 'combinedtype', 'length', 'fields_type',
  'difficulty', 'warnings', 'url', 'section', 'tags', 'bps_files', 'json_files',
  'data_txid',
];

const OUTPUT_FIELDS = [
  'rtype', 'all_matches', 'csv_matches', 'ac_matches',
  'time_utc_seconds', 'time_iso',
  'gameid', 'accepted_as', 'name', 'demo', 'sa1', 'collab',
  'author', 'authors', 'submitter', 'combinedtype', 'length', 'fields_type',
  'difficulty', 'warnings', 'url', 'section', 'tags', 'bps_files', 'data_txid',
];

const NAME_SIM_THRESHOLD = 0.7;
const AUTHOR_SIM_THRESHOLD = 0.7;
const SECONDS_PER_DAY = 86400;

function printHelp() {
  console.log(`find_waiting_notincluded.js - Find waiting entries not in gameversions

Usage:
  enode.sh jstools/find_waiting_notincluded.js --index=PATH [options]

Options:
  --index=PATH           Required. Waiting index CSV path
  --rhdatadb=PATH        Override rhdata.db location
  --older-than=N         Exclude rows newer than N days (keep stale only)
  --hidematches-all      Hide groups with any accepted DB match
  --hidematches-oldonly  Hide groups when DB match is newer than latest CSV entry
  --json                 Emit JSON instead of human-readable text
  --help                 Show this help

Environment:
  RHDATA_DB_PATH         Default rhdata.db path
`);
}

function parseArgs(argv) {
  const parsed = {
    index: null,
    rhdataDb: null,
    olderThan: null,
    hideMatchesAll: false,
    hideMatchesOldOnly: false,
    json: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--hidematches-all') {
      parsed.hideMatchesAll = true;
    } else if (arg === '--hidematches-oldonly') {
      parsed.hideMatchesOldOnly = true;
    } else if (arg.startsWith('--index=')) {
      parsed.index = arg.split('=').slice(1).join('=');
    } else if (arg.startsWith('--rhdatadb=')) {
      parsed.rhdataDb = path.normalize(arg.split('=').slice(1).join('='));
    } else if (arg.startsWith('--older-than=')) {
      const n = parseInt(arg.split('=')[1], 10);
      if (Number.isNaN(n) || n < 0) {
        throw new Error(`Invalid --older-than value: ${arg.split('=')[1]}`);
      }
      parsed.olderThan = n;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function resolveRhdataPath(cliPath) {
  return cliPath || process.env.RHDATA_DB_PATH || DEFAULT_RHDATA_DB;
}

function normalizeForComparison(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

function calculateSimilarity(str1, str2) {
  const norm1 = normalizeForComparison(str1);
  const norm2 = normalizeForComparison(str2);
  if (norm1 === norm2) return 1.0;
  if (norm1.length === 0 || norm2.length === 0) return 0.0;
  const tokens1 = new Set(norm1.split(/\s+/));
  const tokens2 = new Set(norm2.split(/\s+/));
  const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
  const union = new Set([...tokens1, ...tokens2]);
  return intersection.size / union.size;
}

function authorsString(row) {
  const authors = String(row.authors || '').trim();
  if (authors) return authors;
  return String(row.author || '').trim();
}

function parseBpsHashes(raw) {
  const hashes = new Set();
  if (!raw || typeof raw !== 'string') return hashes;
  const trimmed = raw.trim();
  if (!trimmed) return hashes;
  const re = /([a-f0-9]{40})\.(?:bps|json)/gi;
  let match;
  while ((match = re.exec(trimmed)) !== null) {
    hashes.add(match[1].toLowerCase());
  }
  return hashes;
}

function entryHashes(row) {
  const hashes = new Set();
  for (const h of parseBpsHashes(row.bps_files)) hashes.add(h);
  for (const h of parseBpsHashes(row.json_files)) hashes.add(h);
  if (row.bps_hashes) {
    for (const h of row.bps_hashes) hashes.add(h);
  }
  return hashes;
}

function parseFlexibleDate(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return Number.isFinite(n) ? n : null;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) {
    return Math.floor(parsed / 1000);
  }
  return null;
}

function entryTimestamp(row) {
  const timeVal = row.time;
  if (timeVal !== null && timeVal !== undefined && String(timeVal).trim() !== '') {
    const n = Number(timeVal);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return parseFlexibleDate(row.date);
}

function parseAdded(str) {
  return parseFlexibleDate(str);
}

function timestampToIso(seconds) {
  if (seconds === null || seconds === undefined) return '';
  return new Date(seconds * 1000).toISOString();
}

function isOlderThanDays(row, days, nowSeconds) {
  if (days === null || days === undefined) return true;
  const ts = entryTimestamp(row);
  if (ts === null) return true;
  const ageSeconds = nowSeconds - ts;
  return ageSeconds >= days * SECONDS_PER_DAY;
}

function parseIndexCsv(indexPath) {
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Index CSV not found: ${indexPath}`);
  }
  const content = fs.readFileSync(indexPath, 'utf8');
  const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });
  const rows = [];
  for (const raw of parsed.data) {
    const gameid = String(raw.gameid || '').trim();
    if (!gameid) continue;
    const row = { rtype: 'CSV' };
    for (const col of CSV_COLS) {
      row[col] = (raw[col] !== undefined && raw[col] !== null) ? String(raw[col]) : '';
    }
    row.gameid = gameid;
    rows.push(row);
  }
  return rows;
}

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Array(size).fill(0);
  }

  find(x) {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(a, b) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    if (this.rank[rootA] < this.rank[rootB]) {
      this.parent[rootA] = rootB;
    } else if (this.rank[rootA] > this.rank[rootB]) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA]++;
    }
  }
}

function hashesOverlap(a, b) {
  for (const h of a) {
    if (b.has(h)) return true;
  }
  return false;
}

function entriesMatch(a, b, sha1ToGameids) {
  if (a === b) return false;

  const hashesA = entryHashes(a);
  const hashesB = entryHashes(b);
  if (hashesA.size > 0 && hashesB.size > 0 && hashesOverlap(hashesA, hashesB)) {
    return true;
  }

  if (hashesA.size > 0 && b.rtype === 'DB') {
    for (const h of hashesA) {
      const gameids = sha1ToGameids.get(h);
      if (gameids && gameids.has(String(b.gameid))) return true;
    }
  }
  if (hashesB.size > 0 && a.rtype === 'DB') {
    for (const h of hashesB) {
      const gameids = sha1ToGameids.get(h);
      if (gameids && gameids.has(String(a.gameid))) return true;
    }
  }

  const nameSim = calculateSimilarity(a.name, b.name);
  if (nameSim < NAME_SIM_THRESHOLD) return false;

  const submitterA = normalizeForComparison(a.submitter);
  const submitterB = normalizeForComparison(b.submitter);
  if (submitterA && submitterB && submitterA === submitterB) {
    return true;
  }

  const authorA = normalizeForComparison(a.author);
  const authorB = normalizeForComparison(b.author);
  if (authorA && authorB && authorA === authorB) {
    return true;
  }

  const authorsSim = calculateSimilarity(authorsString(a), authorsString(b));
  if (authorsSim >= AUTHOR_SIM_THRESHOLD) {
    return true;
  }

  return false;
}

function loadDatabase(rhdataPath) {
  if (!fs.existsSync(rhdataPath)) {
    throw new Error(`rhdata.db not found: ${rhdataPath}`);
  }
  const db = new Database(rhdataPath, { readonly: true });

  const existingGameIds = new Set(
    db.prepare('SELECT DISTINCT gameid FROM gameversions').all().map(r => String(r.gameid))
  );

  const dbRows = db.prepare(`
    SELECT gv.*, pb.result_sha1 AS pb_result_sha1
    FROM gameversions gv
    INNER JOIN (
      SELECT gameid, MAX(version) AS max_version
      FROM gameversions
      GROUP BY gameid
    ) latest ON gv.gameid = latest.gameid AND gv.version = latest.max_version
    LEFT JOIN patchblobs pb ON gv.patchblob1_name = pb.patchblob1_name
  `).all();

  const sha1ToGameids = new Map();
  const hashRows = db.prepare(`
    SELECT pb.result_sha1, gv.gameid
    FROM patchblobs pb
    JOIN gameversions gv ON gv.patchblob1_name = pb.patchblob1_name
    WHERE pb.result_sha1 IS NOT NULL AND TRIM(pb.result_sha1) != ''
  `).all();

  for (const row of hashRows) {
    const sha1 = String(row.result_sha1).toLowerCase();
    if (!sha1ToGameids.has(sha1)) sha1ToGameids.set(sha1, new Set());
    sha1ToGameids.get(sha1).add(String(row.gameid));
  }

  const dbEntries = dbRows.map(row => {
    const entry = { rtype: 'DB' };
    for (const col of CSV_COLS) {
      if (col === 'json_files') {
        entry[col] = '';
        continue;
      }
      entry[col] = row[col] !== undefined && row[col] !== null ? String(row[col]) : '';
    }
    entry.gameid = String(row.gameid);
    entry.version = row.version;
    entry.added_raw = row.added || '';
    entry.bps_hashes = new Set();
    if (row.pb_result_sha1) {
      entry.bps_hashes.add(String(row.pb_result_sha1).toLowerCase());
    }
    if (row.patchblob1_name) {
      const m = String(row.patchblob1_name).match(/^([a-f0-9]{40})\./i);
      if (m) entry.bps_hashes.add(m[1].toLowerCase());
    }
    return entry;
  });

  db.close();
  return { existingGameIds, dbEntries, sha1ToGameids };
}

function computeMatchCountsWithIndex(allEntries, sha1ToGameids) {
  const counts = allEntries.map(() => ({ all: 0, csv: 0, ac: 0 }));
  for (let i = 0; i < allEntries.length; i++) {
    for (let j = i + 1; j < allEntries.length; j++) {
      if (entriesMatch(allEntries[i], allEntries[j], sha1ToGameids)) {
        counts[i].all++;
        counts[j].all++;
        if (allEntries[i].rtype === 'CSV' && allEntries[j].rtype === 'CSV') {
          counts[i].csv++;
          counts[j].csv++;
        }
        if (allEntries[i].rtype === 'DB' && allEntries[j].rtype === 'CSV') {
          counts[j].ac++;
        }
        if (allEntries[j].rtype === 'DB' && allEntries[i].rtype === 'CSV') {
          counts[i].ac++;
        }
      }
    }
  }
  return counts;
}

function findLatestDbMatch(csvEntry, dbEntries, sha1ToGameids) {
  let best = null;
  let bestScore = -1;
  for (const dbEntry of dbEntries) {
    if (!entriesMatch(csvEntry, dbEntry, sha1ToGameids)) continue;
    const addedTs = parseAdded(dbEntry.added_raw || dbEntry.added) || 0;
    const versionScore = (dbEntry.version || 0) * 1e-6;
    const score = addedTs + versionScore;
    if (score > bestScore) {
      bestScore = score;
      best = dbEntry;
    }
  }
  return best;
}

function buildResultGroups(csvRows, dbEntries, existingGameIds, sha1ToGameids, options) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const allEntries = [...csvRows, ...dbEntries];
  const csvCount = csvRows.length;

  const uf = new UnionFind(allEntries.length);
  for (let i = 0; i < allEntries.length; i++) {
    for (let j = i + 1; j < allEntries.length; j++) {
      if (entriesMatch(allEntries[i], allEntries[j], sha1ToGameids)) {
        uf.union(i, j);
      }
    }
  }

  const matchCounts = computeMatchCountsWithIndex(allEntries, sha1ToGameids);

  const seedIndices = new Set();
  for (let i = 0; i < csvCount; i++) {
    const row = csvRows[i];
    if (existingGameIds.has(String(row.gameid))) continue;
    if (!isOlderThanDays(row, options.olderThan, nowSeconds)) continue;
    seedIndices.add(i);
  }

  const groupsByRoot = new Map();
  for (let i = 0; i < allEntries.length; i++) {
    const root = uf.find(i);
    if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
    groupsByRoot.get(root).push(i);
  }

  const resultGroups = [];
  for (const indices of groupsByRoot.values()) {
    const hasSeed = indices.some(idx => seedIndices.has(idx));
    if (!hasSeed) continue;

    const dbIndices = indices.filter(idx => idx >= csvCount);
    const csvIndices = indices.filter(idx => idx < csvCount);

    dbIndices.sort((a, b) => {
      const ta = parseAdded(allEntries[a].added_raw || allEntries[a].added) || 0;
      const tb = parseAdded(allEntries[b].added_raw || allEntries[b].added) || 0;
      return ta - tb;
    });
    csvIndices.sort((a, b) => {
      const ta = entryTimestamp(allEntries[a]) || 0;
      const tb = entryTimestamp(allEntries[b]) || 0;
      return ta - tb;
    });

    const orderedIndices = [...dbIndices, ...csvIndices];
    const group = { db_results: [], csv_results: [] };

    for (const idx of orderedIndices) {
      const entry = allEntries[idx];
      const counts = matchCounts[idx];
      const ts = entry.rtype === 'CSV'
        ? entryTimestamp(entry)
        : (parseAdded(entry.added_raw || entry.added) || null);

      let acceptedAs = 'notfound';
      if (entry.rtype === 'CSV') {
        const match = findLatestDbMatch(entry, dbEntries, sha1ToGameids);
        acceptedAs = match ? String(match.gameid) : 'notfound';
      } else {
        acceptedAs = String(entry.gameid);
      }

      const result = {
        rtype: entry.rtype,
        all_matches: counts.all,
        csv_matches: counts.csv,
        ac_matches: counts.ac,
        time_utc_seconds: ts,
        time_iso: timestampToIso(ts),
        gameid: String(entry.gameid),
        accepted_as: acceptedAs,
        name: entry.name || '',
        demo: entry.demo || '',
        sa1: entry.sa1 || '',
        collab: entry.collab || '',
        author: entry.author || '',
        authors: entry.authors || '',
        submitter: entry.submitter || '',
        combinedtype: entry.combinedtype || '',
        length: entry.length || '',
        fields_type: entry.fields_type || '',
        difficulty: entry.difficulty || '',
        warnings: entry.warnings || '',
        url: entry.url || '',
        section: entry.section || '',
        tags: entry.tags || '',
        bps_files: entry.bps_files || '',
        data_txid: entry.data_txid || '',
      };

      if (entry.rtype === 'DB') {
        group.db_results.push(result);
      } else {
        group.csv_results.push(result);
      }
    }

    resultGroups.push(group);
  }

  resultGroups.sort((a, b) => {
    const tsA = earliestGroupTimestamp(a);
    const tsB = earliestGroupTimestamp(b);
    return tsA - tsB;
  });

  return resultGroups;
}

function earliestGroupTimestamp(group) {
  const times = [];
  for (const r of group.db_results) {
    if (r.time_utc_seconds !== null) times.push(r.time_utc_seconds);
  }
  for (const r of group.csv_results) {
    if (r.time_utc_seconds !== null) times.push(r.time_utc_seconds);
  }
  return times.length ? Math.min(...times) : 0;
}

function latestCsvTimestamp(group) {
  let latest = null;
  for (const r of group.csv_results) {
    if (r.time_utc_seconds === null) continue;
    if (latest === null || r.time_utc_seconds > latest) latest = r.time_utc_seconds;
  }
  return latest;
}

function latestCsvResult(group) {
  if (!group.csv_results.length) return null;
  return group.csv_results[group.csv_results.length - 1];
}

function groupHasDbMatch(group) {
  return group.db_results.length > 0 ||
    group.csv_results.some(r => r.ac_matches > 0);
}

function applyHideFilters(groups, existingGameIds, options) {
  if (!options.hideMatchesAll && !options.hideMatchesOldOnly) {
    return groups;
  }

  return groups.filter(group => {
    if (!groupHasDbMatch(group)) return true;

    if (options.hideMatchesAll) {
      return false;
    }

    if (options.hideMatchesOldOnly) {
      const latestCsv = latestCsvResult(group);
      if (!latestCsv) return true;
      if (!existingGameIds.has(String(latestCsv.gameid))) {
        return true;
      }
      const latestCsvTs = latestCsvTimestamp(group);
      if (latestCsvTs === null) return true;

      for (const db of group.db_results) {
        const dbTs = db.time_utc_seconds;
        if (dbTs !== null && dbTs > latestCsvTs) {
          return false;
        }
      }
      return true;
    }

    return true;
  });
}

function formatHuman(groups) {
  const lines = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    if (gi > 0) lines.push('');
    lines.push(`=== Group ${gi + 1} ===`);
    if (group.db_results.length) {
      lines.push(`Accepted match(es): ${group.db_results.map(r => r.gameid).join(', ')}`);
    }

    const allResults = [...group.db_results, ...group.csv_results];
    for (const result of allResults) {
      lines.push('---');
      for (const field of OUTPUT_FIELDS) {
        let val = result[field];
        if (val === null || val === undefined) val = '';
        lines.push(`${field}: ${val}`);
      }
    }
  }
  if (!lines.length) {
    lines.push('No matching waiting entries found.');
  }
  return lines.join('\n');
}

function formatJson(groups) {
  return JSON.stringify({ result_groups: groups }, null, 2);
}

function run(options) {
  const indexPath = path.resolve(options.index);
  const rhdataPath = resolveRhdataPath(options.rhdataDb);

  const csvRows = parseIndexCsv(indexPath);
  const { existingGameIds, dbEntries, sha1ToGameids } = loadDatabase(rhdataPath);

  let groups = buildResultGroups(csvRows, dbEntries, existingGameIds, sha1ToGameids, {
    olderThan: options.olderThan,
  });

  groups = applyHideFilters(groups, existingGameIds, {
    hideMatchesAll: options.hideMatchesAll,
    hideMatchesOldOnly: options.hideMatchesOldOnly,
  });

  if (options.json) {
    return formatJson(groups);
  }
  return formatHuman(groups);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.index) {
    console.error('Error: --index=PATH is required.');
    printHelp();
    process.exit(1);
  }
  if (args.hideMatchesAll && args.hideMatchesOldOnly) {
    console.error('Error: --hidematches-all and --hidematches-oldonly are mutually exclusive.');
    process.exit(1);
  }

  try {
    const output = run(args);
    console.log(output);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  resolveRhdataPath,
  parseIndexCsv,
  parseBpsHashes,
  entryTimestamp,
  parseAdded,
  normalizeForComparison,
  calculateSimilarity,
  entriesMatch,
  UnionFind,
  buildResultGroups,
  applyHideFilters,
  formatHuman,
  formatJson,
  run,
  OUTPUT_FIELDS,
  NAME_SIM_THRESHOLD,
};
