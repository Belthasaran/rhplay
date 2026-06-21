#!/usr/bin/env node

/**
 * test_find_waiting_notincluded.js
 *
 * Tests find_waiting_notincluded.js with isolated temp DB and CSV fixtures.
 * Uses RHDATA_DB_PATH environment variable for non-production database.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { spawnSync } = require('child_process');
const {
  parseBpsHashes,
  entryTimestamp,
  calculateSimilarity,
  entriesMatch,
} = require('../jstools/find_waiting_notincluded');

const TEST_DIR = path.join(__dirname, 'test_data', 'find_waiting_notincluded');
const ENODE = path.join(__dirname, '..', 'enode.sh');
const SCRIPT = path.join(__dirname, '..', 'jstools', 'find_waiting_notincluded.js');

const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OLD_TS = 1540000000;
const RECENT_TS = Math.floor(Date.now() / 1000) - 86400;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function setupDb(dbPath, rows) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE gameversions (
      gvuuid TEXT PRIMARY KEY,
      gameid TEXT,
      version INTEGER,
      name TEXT,
      added TEXT,
      author TEXT,
      authors TEXT,
      submitter TEXT,
      demo TEXT,
      sa1 TEXT,
      collab TEXT,
      combinedtype TEXT,
      length TEXT,
      fields_type TEXT,
      difficulty TEXT,
      warnings TEXT,
      url TEXT,
      section TEXT,
      tags TEXT,
      patchblob1_name TEXT,
      UNIQUE(gameid, version)
    );
    CREATE TABLE patchblobs (
      pbuuid TEXT PRIMARY KEY,
      gvuuid TEXT,
      patchblob1_name TEXT UNIQUE,
      result_sha1 TEXT
    );
  `);

  const insGv = db.prepare(`
    INSERT INTO gameversions (
      gvuuid, gameid, version, name, added, author, authors, submitter,
      demo, sa1, collab, combinedtype, length, fields_type, difficulty,
      warnings, url, section, tags, patchblob1_name
    ) VALUES (
      @gvuuid, @gameid, @version, @name, @added, @author, @authors, @submitter,
      @demo, @sa1, @collab, @combinedtype, @length, @fields_type, @difficulty,
      @warnings, @url, @section, @tags, @patchblob1_name
    )
  `);
  const insPb = db.prepare(`
    INSERT INTO patchblobs (pbuuid, gvuuid, patchblob1_name, result_sha1)
    VALUES (@pbuuid, @gvuuid, @patchblob1_name, @result_sha1)
  `);

  for (const row of rows) {
    const params = {
      demo: '',
      sa1: '',
      collab: '',
      combinedtype: '',
      length: '',
      fields_type: '',
      difficulty: '',
      warnings: '',
      url: '',
      section: '',
      tags: '',
      patchblob1_name: '',
      ...row,
    };
    insGv.run(params);
    if (params.result_sha1) {
      insPb.run({
        pbuuid: `pb-${params.gameid}`,
        gvuuid: params.gvuuid,
        patchblob1_name: params.patchblob1_name,
        result_sha1: params.result_sha1,
      });
    }
  }
  db.close();
}

function writeCsv(csvPath, rows) {
  const header = [
    'moderated', 'time', 'date', 'gameid', 'name', 'demo', 'sa1', 'collab',
    'author', 'authors', 'submitter', 'combinedtype', 'length', 'fields_type',
    'difficulty', 'warnings', 'url', 'section', 'tags', 'bps_files', 'json_files', 'data_txid',
  ].join(',');
  const body = rows.map(r => header.split(',').map(col => {
    const val = r[col] ?? '';
    const s = String(val);
    return s.includes(',') ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(','));
  fs.writeFileSync(csvPath, [header, ...body].join('\n') + '\n', 'utf8');
}

function resetFixtures() {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function runCli(args, env) {
  return spawnSync('bash', [ENODE, SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function testParseBpsHashes() {
  const hashes = parseBpsHashes("['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bps', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json']");
  assert(hashes.has(HASH_A), 'Expected HASH_A');
  assert(hashes.has(HASH_B), 'Expected HASH_B');
}

function testEntryTimestamp() {
  assert(entryTimestamp({ time: '1540000000', date: '' }) === 1540000000, 'time field');
  const fromDate = entryTimestamp({ time: '', date: '13 Jan 2019' });
  assert(fromDate > 0, 'date field parses');
}

function testExactGameidFilter() {
  resetFixtures();
  const dbPath = path.join(TEST_DIR, 'rhdata.db');
  const csvPath = path.join(TEST_DIR, 'index.csv');
  setupDb(dbPath, [{
    gvuuid: 'gv-100',
    gameid: '100',
    version: 1,
    name: 'In DB',
    added: '2019-01-01',
    author: 'Alice',
    authors: 'Alice',
    submitter: 'Alice',
    patchblob1_name: '',
  }]);
  writeCsv(csvPath, [
    { gameid: '100', name: 'In DB', date: '13 Jan 2019', author: 'Alice', authors: 'Alice', submitter: 'Alice', bps_files: '' },
    { gameid: '200', name: 'Missing', date: '13 Jan 2019', author: 'Bob', authors: 'Bob', submitter: 'Bob', bps_files: '' },
  ]);

  const out = JSON.parse(runCli(['--index=' + csvPath, '--json'], { RHDATA_DB_PATH: dbPath }).stdout);
  const csvGameids = out.result_groups.flatMap(g => g.csv_results.map(r => r.gameid));
  assert(!csvGameids.includes('100'), 'gameid in DB should not seed output');
  assert(csvGameids.includes('200'), 'missing gameid should appear');
}

function testOlderThanFilter() {
  resetFixtures();
  const dbPath = path.join(TEST_DIR, 'rhdata.db');
  const csvPath = path.join(TEST_DIR, 'index.csv');
  setupDb(dbPath, []);
  writeCsv(csvPath, [
    { gameid: '300', name: 'Old Game', time: String(OLD_TS), author: 'X', authors: 'X', submitter: 'X', bps_files: '' },
    { gameid: '301', name: 'Recent Game', time: String(RECENT_TS), author: 'Y', authors: 'Y', submitter: 'Y', bps_files: '' },
  ]);

  const out = JSON.parse(runCli(['--index=' + csvPath, '--older-than=30', '--json'], { RHDATA_DB_PATH: dbPath }).stdout);
  const csvGameids = out.result_groups.flatMap(g => g.csv_results.map(r => r.gameid));
  assert(csvGameids.includes('300'), 'old row kept');
  assert(!csvGameids.includes('301'), 'recent row excluded');
}

function testBpsHashGrouping() {
  resetFixtures();
  const dbPath = path.join(TEST_DIR, 'rhdata.db');
  const csvPath = path.join(TEST_DIR, 'index.csv');
  setupDb(dbPath, [{
    gvuuid: 'gv-500',
    gameid: '500',
    version: 1,
    name: 'Accepted Game',
    added: '2020-06-01',
    author: 'Carol',
    authors: 'Carol',
    submitter: 'Carol',
    patchblob1_name: `${HASH_A}.bps`,
    result_sha1: HASH_A,
  }]);
  writeCsv(csvPath, [
    {
      gameid: '600',
      name: 'Waiting Resubmit',
      time: String(OLD_TS),
      author: 'Carol',
      authors: 'Carol',
      submitter: 'Carol',
      bps_files: `['${HASH_A}.bps']`,
    },
    {
      gameid: '601',
      name: 'Waiting Other',
      time: String(OLD_TS + 100),
      author: 'Carol',
      authors: 'Carol',
      submitter: 'Carol',
      bps_files: `['${HASH_A}.bps']`,
    },
  ]);

  const out = JSON.parse(runCli(['--index=' + csvPath, '--json'], { RHDATA_DB_PATH: dbPath }).stdout);
  assert(out.result_groups.length === 1, 'Expected one group');
  const group = out.result_groups[0];
  assert(group.db_results.length === 1, 'DB result at head');
  assert(group.db_results[0].gameid === '500', 'DB gameid');
  assert(group.csv_results.length === 2, 'Two CSV rows grouped');
  assert(group.csv_results[0].accepted_as === '500', 'accepted_as set');
}

function testFuzzyNameAuthorGrouping() {
  resetFixtures();
  const dbPath = path.join(TEST_DIR, 'rhdata.db');
  const csvPath = path.join(TEST_DIR, 'index.csv');
  setupDb(dbPath, []);
  writeCsv(csvPath, [
    {
      gameid: '700',
      name: 'Grand Poo World',
      time: String(OLD_TS),
      author: 'Dave',
      authors: 'Dave',
      submitter: 'Dave',
      bps_files: '',
    },
    {
      gameid: '701',
      name: 'Grand Poo World 2',
      time: String(OLD_TS + 50),
      author: 'Dave',
      authors: 'Dave',
      submitter: 'Dave',
      bps_files: '',
    },
  ]);

  const sim = calculateSimilarity('Grand Poo World', 'Grand Poo World 2');
  assert(sim >= 0.7, `Expected high similarity, got ${sim}`);

  const out = JSON.parse(runCli(['--index=' + csvPath, '--json'], { RHDATA_DB_PATH: dbPath }).stdout);
  assert(out.result_groups.length === 1, 'Typo variant grouped');
  assert(out.result_groups[0].csv_results.length === 2, 'Both CSV rows in group');
}

function testHideMatchesAll() {
  resetFixtures();
  const dbPath = path.join(TEST_DIR, 'rhdata.db');
  const csvPath = path.join(TEST_DIR, 'index.csv');
  setupDb(dbPath, [{
    gvuuid: 'gv-800',
    gameid: '800',
    version: 1,
    name: 'Accepted',
    added: '2020-01-01',
    author: 'Eve',
    authors: 'Eve',
    submitter: 'Eve',
    patchblob1_name: `${HASH_B}.bps`,
    result_sha1: HASH_B,
  }]);
  writeCsv(csvPath, [
    {
      gameid: '900',
      name: 'Waiting',
      time: String(OLD_TS),
      author: 'Eve',
      authors: 'Eve',
      submitter: 'Eve',
      bps_files: `['${HASH_B}.bps']`,
    },
  ]);

  const withoutHide = JSON.parse(runCli(['--index=' + csvPath, '--json'], { RHDATA_DB_PATH: dbPath }).stdout);
  assert(withoutHide.result_groups.length === 1, 'Group visible without hide');

  const withHide = JSON.parse(runCli(['--index=' + csvPath, '--hidematches-all', '--json'], { RHDATA_DB_PATH: dbPath }).stdout);
  assert(withHide.result_groups.length === 0, 'Group hidden with --hidematches-all');
}

function testHideMatchesOldOnly() {
  resetFixtures();
  const dbPath = path.join(TEST_DIR, 'rhdata.db');
  const csvPath = path.join(TEST_DIR, 'index.csv');
  setupDb(dbPath, [{
    gvuuid: 'gv-1000',
    gameid: '1000',
    version: 1,
    name: 'Old Accepted',
    added: '2018-01-01',
    author: 'Frank',
    authors: 'Frank',
    submitter: 'Frank',
    patchblob1_name: `${HASH_A}.bps`,
    result_sha1: HASH_A,
  }]);
  writeCsv(csvPath, [
    {
      gameid: '1000',
      name: 'Tower Of Glory 2',
      time: String(OLD_TS),
      author: 'Frank',
      authors: 'Frank',
      submitter: 'Frank',
      bps_files: `['${HASH_A}.bps']`,
    },
    {
      gameid: '1001',
      name: 'Tower Of Glory 2',
      time: String(OLD_TS + 100000),
      author: 'Frank',
      authors: 'Frank',
      submitter: 'Frank',
      bps_files: `['${HASH_B}.bps']`,
    },
  ]);

  const out = JSON.parse(runCli([
    '--index=' + csvPath,
    '--hidematches-oldonly',
    '--json',
  ], { RHDATA_DB_PATH: dbPath }).stdout);

  const allCsvIds = out.result_groups.flatMap(g => g.csv_results.map(r => r.gameid));
  assert(allCsvIds.includes('1001'), 'Latest CSV not in DB keeps group visible');
}

function testUnitEntriesMatch() {
  const csvA = { rtype: 'CSV', name: 'Test', author: 'A', authors: 'A', submitter: 'S', bps_files: `['${HASH_A}.bps']`, json_files: '' };
  const csvB = { rtype: 'CSV', name: 'Test', author: 'A', authors: 'A', submitter: 'S', bps_files: `['${HASH_A}.bps']`, json_files: '' };
  assert(entriesMatch(csvA, csvB, new Map()), 'BPS hash match');
}

function testCacheWriteOnFirstRun() {
  resetFixtures();
  const dbPath = path.join(TEST_DIR, 'rhdata.db');
  const csvPath = path.join(TEST_DIR, 'index.csv');
  const cachePath = path.join(TEST_DIR, 'waiting_cache_clusters.json');
  setupDb(dbPath, []);
  writeCsv(csvPath, [
    { gameid: '1100', name: 'Game A', time: String(OLD_TS), author: 'Z', authors: 'Z', submitter: 'Z', bps_files: `['${HASH_A}.bps']` },
    { gameid: '1101', name: 'Game A', time: String(OLD_TS + 1), author: 'Z', authors: 'Z', submitter: 'Z', bps_files: `['${HASH_A}.bps']` },
  ]);

  runCli(['--index=' + csvPath, '--json'], { RHDATA_DB_PATH: dbPath });
  assert(fs.existsSync(cachePath), 'Cache file created');
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert(cache.groups && Object.keys(cache.groups).length >= 1, 'At least one group');
  assert(cache.memberof[HASH_A], 'Hash in memberof');
  assert(cache.memberof['1100'] === cache.memberof['1101'], 'Same group for paired entries');
}

function testIncrementalSecondRun() {
  resetFixtures();
  const dbPath = path.join(TEST_DIR, 'rhdata.db');
  const csvPath = path.join(TEST_DIR, 'index.csv');
  const cachePath = path.join(TEST_DIR, 'waiting_cache_clusters.json');
  setupDb(dbPath, [{
    gvuuid: 'gv-1200',
    gameid: '1200',
    version: 1,
    name: 'Accepted',
    added: '2020-01-01',
    author: 'Merge',
    authors: 'Merge',
    submitter: 'Merge',
    patchblob1_name: `${HASH_A}.bps`,
    result_sha1: HASH_A,
  }]);
  writeCsv(csvPath, [
    { gameid: '1300', name: 'Waiting', time: String(OLD_TS), author: 'Merge', authors: 'Merge', submitter: 'Merge', bps_files: `['${HASH_A}.bps']` },
  ]);
  runCli(['--index=' + csvPath, '--json'], { RHDATA_DB_PATH: dbPath });
  const cache1 = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const groupCount1 = Object.keys(cache1.groups).length;

  writeCsv(csvPath, [
    { gameid: '1300', name: 'Waiting', time: String(OLD_TS), author: 'Merge', authors: 'Merge', submitter: 'Merge', bps_files: `['${HASH_A}.bps']` },
    { gameid: '1301', name: 'Waiting 2', time: String(OLD_TS + 10), author: 'Merge', authors: 'Merge', submitter: 'Merge', bps_files: `['${HASH_A}.bps']` },
  ]);
  runCli(['--index=' + csvPath, '--json'], { RHDATA_DB_PATH: dbPath });
  const cache2 = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert(Object.keys(cache2.groups).length >= groupCount1, 'Group still present after incremental');
  assert(cache2.memberof['1301'], 'New entry classified');
  assert(cache2.memberof['1301'] === cache2.memberof[HASH_A], 'New entry in hash group');
}

function testGroupMergeViaNewEntry() {
  resetFixtures();
  const dbPath = path.join(TEST_DIR, 'rhdata.db');
  const csvPath = path.join(TEST_DIR, 'index.csv');
  const cachePath = path.join(TEST_DIR, 'waiting_cache_clusters.json');
  setupDb(dbPath, []);
  writeCsv(csvPath, [
    { gameid: '1400', name: 'Alpha Game', time: String(OLD_TS), author: 'MergeTest', authors: 'MergeTest', submitter: 'MergeTest', bps_files: `['${HASH_A}.bps']` },
    { gameid: '1400b', name: 'Alpha Game', time: String(OLD_TS + 1), author: 'MergeTest', authors: 'MergeTest', submitter: 'MergeTest', bps_files: `['${HASH_A}.bps']` },
    { gameid: '1401', name: 'Beta Game', time: String(OLD_TS + 2), author: 'Other', authors: 'Other', submitter: 'Other', bps_files: `['${HASH_B}.bps']` },
    { gameid: '1401b', name: 'Beta Game', time: String(OLD_TS + 3), author: 'Other', authors: 'Other', submitter: 'Other', bps_files: `['${HASH_B}.bps']` },
  ]);
  runCli(['--index=' + csvPath, '--json'], { RHDATA_DB_PATH: dbPath });
  const cache1 = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert(Object.keys(cache1.groups).length >= 2, 'Two separate groups initially');
  const groupA = cache1.memberof['1400'];
  const groupB = cache1.memberof['1401'];
  assert(groupA !== groupB, 'Groups are distinct');

  writeCsv(csvPath, [
    { gameid: '1400', name: 'Alpha Game', time: String(OLD_TS), author: 'MergeTest', authors: 'MergeTest', submitter: 'MergeTest', bps_files: `['${HASH_A}.bps']` },
    { gameid: '1400b', name: 'Alpha Game', time: String(OLD_TS + 1), author: 'MergeTest', authors: 'MergeTest', submitter: 'MergeTest', bps_files: `['${HASH_A}.bps']` },
    { gameid: '1401', name: 'Beta Game', time: String(OLD_TS + 2), author: 'Other', authors: 'Other', submitter: 'Other', bps_files: `['${HASH_B}.bps']` },
    { gameid: '1401b', name: 'Beta Game', time: String(OLD_TS + 3), author: 'Other', authors: 'Other', submitter: 'Other', bps_files: `['${HASH_B}.bps']` },
    { gameid: '1402', name: 'Bridge Game', time: String(OLD_TS + 4), author: 'Bridge', authors: 'Bridge', submitter: 'Bridge', bps_files: `['${HASH_A}.bps', '${HASH_B}.bps']` },
  ]);
  runCli(['--index=' + csvPath, '--json'], { RHDATA_DB_PATH: dbPath });
  const cache2 = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert(cache2.memberof['1400'] === cache2.memberof['1401'], 'Groups merged via bridge entry');
}

function testSyncNewHashForKnownGameid() {
  resetFixtures();
  const dbPath = path.join(TEST_DIR, 'rhdata.db');
  const csvPath = path.join(TEST_DIR, 'index.csv');
  const cachePath = path.join(TEST_DIR, 'waiting_cache_clusters.json');
  setupDb(dbPath, []);
  writeCsv(csvPath, [
    { gameid: '1500', name: 'Resubmit', time: String(OLD_TS), author: 'HashSync', authors: 'HashSync', submitter: 'HashSync', bps_files: `['${HASH_A}.bps']` },
    { gameid: '1501', name: 'Resubmit', time: String(OLD_TS + 1), author: 'HashSync', authors: 'HashSync', submitter: 'HashSync', bps_files: `['${HASH_A}.bps']` },
  ]);
  runCli(['--index=' + csvPath, '--json'], { RHDATA_DB_PATH: dbPath });

  writeCsv(csvPath, [
    { gameid: '1500', name: 'Resubmit', time: String(OLD_TS), author: 'HashSync', authors: 'HashSync', submitter: 'HashSync', bps_files: `['${HASH_A}.bps', '${HASH_B}.bps']` },
    { gameid: '1501', name: 'Resubmit', time: String(OLD_TS + 1), author: 'HashSync', authors: 'HashSync', submitter: 'HashSync', bps_files: `['${HASH_A}.bps']` },
  ]);
  runCli(['--index=' + csvPath, '--json'], { RHDATA_DB_PATH: dbPath });
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const groupId = cache.memberof['1500'];
  assert(cache.groups[groupId].includes(HASH_B), 'New hash synced for known gameid');
}

function testRebuildCache() {
  resetFixtures();
  const dbPath = path.join(TEST_DIR, 'rhdata.db');
  const csvPath = path.join(TEST_DIR, 'index.csv');
  const cachePath = path.join(TEST_DIR, 'waiting_cache_clusters.json');
  setupDb(dbPath, []);
  writeCsv(csvPath, [
    { gameid: '1600', name: 'Rebuild A', time: String(OLD_TS), author: 'R', authors: 'R', submitter: 'R', bps_files: `['${HASH_A}.bps']` },
    { gameid: '1601', name: 'Rebuild B', time: String(OLD_TS + 1), author: 'R', authors: 'R', submitter: 'R', bps_files: `['${HASH_A}.bps']` },
  ]);
  runCli(['--index=' + csvPath, '--json'], { RHDATA_DB_PATH: dbPath });
  fs.writeFileSync(cachePath, '{"version":1,"corrupt":true}\n');

  runCli(['--index=' + csvPath, '--rebuild-cache', '--json'], { RHDATA_DB_PATH: dbPath });
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert(cache.groups && cache.memberof, 'Cache rebuilt');
  assert(cache.memberof['1600'], 'Entries present after rebuild');
}

function testSingletonNotCached() {
  resetFixtures();
  const dbPath = path.join(TEST_DIR, 'rhdata.db');
  const csvPath = path.join(TEST_DIR, 'index.csv');
  const cachePath = path.join(TEST_DIR, 'waiting_cache_clusters.json');
  setupDb(dbPath, []);
  writeCsv(csvPath, [
    { gameid: '1700', name: 'Lonely Game', time: String(OLD_TS), author: 'Solo', authors: 'Solo', submitter: 'Solo', bps_files: `['${HASH_A}.bps']` },
  ]);
  runCli(['--index=' + csvPath, '--json'], { RHDATA_DB_PATH: dbPath });
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert(!cache.memberof['1700'], 'Singleton gameid not cached');
  assert(!cache.memberof[HASH_A], 'Singleton hash not cached');
  assert(Object.keys(cache.groups).length === 0, 'No groups for singleton');
}

function csvStdoutGameids(stdout) {
  const lines = stdout.trim().split('\n').slice(1);
  return lines.filter(Boolean).map(line => line.split(',')[3]);
}

function testLatestWaitingCsvExportsNewestCsvRow() {
  resetFixtures();
  const dbPath = path.join(TEST_DIR, 'rhdata.db');
  const csvPath = path.join(TEST_DIR, 'index.csv');
  setupDb(dbPath, [{
    gvuuid: 'gv-1800',
    gameid: '1800',
    version: 1,
    name: 'Accepted Old',
    added: '2018-01-01',
    author: 'Exp',
    authors: 'Exp',
    submitter: 'Exp',
    patchblob1_name: `${HASH_A}.bps`,
    result_sha1: HASH_A,
  }]);
  writeCsv(csvPath, [
    { gameid: '1801', name: 'Waiting A', time: String(OLD_TS), author: 'Exp', authors: 'Exp', submitter: 'Exp', bps_files: `['${HASH_A}.bps']` },
    { gameid: '1802', name: 'Waiting B', time: String(OLD_TS + 500), author: 'Exp', authors: 'Exp', submitter: 'Exp', bps_files: `['${HASH_A}.bps']` },
  ]);

  const result = runCli(['--index=' + csvPath, '--latest-waiting-csv'], { RHDATA_DB_PATH: dbPath });
  const gameids = csvStdoutGameids(result.stdout);
  assert(gameids.length === 1, 'One row exported');
  assert(gameids[0] === '1802', 'Latest CSV row exported');
}

function testLatestWaitingCsvSkipsDbLatest() {
  resetFixtures();
  const dbPath = path.join(TEST_DIR, 'rhdata.db');
  const csvPath = path.join(TEST_DIR, 'index.csv');
  setupDb(dbPath, [{
    gvuuid: 'gv-1900',
    gameid: '1900',
    version: 1,
    name: 'Accepted New',
    added: '2030-06-01',
    author: 'Skip',
    authors: 'Skip',
    submitter: 'Skip',
    patchblob1_name: `${HASH_A}.bps`,
    result_sha1: HASH_A,
  }]);
  writeCsv(csvPath, [
    { gameid: '1901', name: 'Waiting Old', time: String(OLD_TS), author: 'Skip', authors: 'Skip', submitter: 'Skip', bps_files: `['${HASH_A}.bps']` },
  ]);

  const result = runCli(['--index=' + csvPath, '--latest-waiting-csv'], { RHDATA_DB_PATH: dbPath });
  const gameids = csvStdoutGameids(result.stdout);
  assert(gameids.length === 0, 'Group skipped when DB is latest');
}

function testLatestWaitingCsvRespectsHideMatchesAll() {
  resetFixtures();
  const dbPath = path.join(TEST_DIR, 'rhdata.db');
  const csvPath = path.join(TEST_DIR, 'index.csv');
  setupDb(dbPath, [{
    gvuuid: 'gv-2000',
    gameid: '2000',
    version: 1,
    name: 'Accepted',
    added: '2020-01-01',
    author: 'Hide',
    authors: 'Hide',
    submitter: 'Hide',
    patchblob1_name: `${HASH_B}.bps`,
    result_sha1: HASH_B,
  }]);
  writeCsv(csvPath, [
    {
      gameid: '2100',
      name: 'Waiting',
      time: String(OLD_TS),
      author: 'Hide',
      authors: 'Hide',
      submitter: 'Hide',
      bps_files: `['${HASH_B}.bps']`,
    },
  ]);

  const result = runCli([
    '--index=' + csvPath,
    '--latest-waiting-csv',
    '--hidematches-all',
  ], { RHDATA_DB_PATH: dbPath });
  const gameids = csvStdoutGameids(result.stdout);
  assert(gameids.length === 0, 'Hidden matched group excluded from CSV export');
}

function main() {
  testParseBpsHashes();
  testEntryTimestamp();
  testExactGameidFilter();
  testOlderThanFilter();
  testBpsHashGrouping();
  testFuzzyNameAuthorGrouping();
  testHideMatchesAll();
  testHideMatchesOldOnly();
  testUnitEntriesMatch();
  testCacheWriteOnFirstRun();
  testIncrementalSecondRun();
  testGroupMergeViaNewEntry();
  testSyncNewHashForKnownGameid();
  testRebuildCache();
  testSingletonNotCached();
  testLatestWaitingCsvExportsNewestCsvRow();
  testLatestWaitingCsvSkipsDbLatest();
  testLatestWaitingCsvRespectsHideMatchesAll();
  console.log('✅ test_find_waiting_notincluded passed');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`❌ test_find_waiting_notincluded failed: ${error.message}`);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

module.exports = { main };
