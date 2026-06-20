#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const {
  resolveSha1ToGame,
  normalizeLevelHex,
  findStageRow,
  buildPlanFromShareCode,
} = require('../lib/mt-share-code-resolver');
const { encodeIk1ShareCode } = require('../electron/shared/mt-share-code');

const SHA1_A = 'a'.repeat(40);
const SHA1_B = 'b'.repeat(40);

function createRhdataDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE gameversions (
      gameid TEXT, version INTEGER, name TEXT, patchblob1_name TEXT,
      download_url TEXT, url TEXT
    );
    CREATE TABLE patchblobs (
      patchblob1_name TEXT, result_sha1 TEXT
    );
    CREATE TABLE gamestages (
      stage_uuid TEXT PRIMARY KEY, gameid TEXT, levelnumber TEXT, levelname TEXT,
      translevel_13bf TEXT
    );
  `);
  return db;
}

function seedGame(db, { gameid, version, sha1, patchblob, name }) {
  db.prepare(`INSERT INTO gameversions VALUES (?, ?, ?, ?, NULL, NULL)`)
    .run(gameid, version, name, patchblob);
  db.prepare(`INSERT INTO patchblobs VALUES (?, ?)`)
    .run(patchblob, sha1);
}

function testResolveSha1PicksHighestVersion() {
  const db = createRhdataDb();
  seedGame(db, { gameid: '100', version: 1, sha1: SHA1_A, patchblob: 'pb-v1', name: 'G v1' });
  seedGame(db, { gameid: '100', version: 2, sha1: SHA1_A, patchblob: 'pb-v2', name: 'G v2' });
  const resolved = resolveSha1ToGame(db, SHA1_A);
  assert.strictEqual(resolved.gameid, '100');
  assert.strictEqual(resolved.version, 2);
  db.close();
}

function testStageVsRawCode() {
  const db = createRhdataDb();
  seedGame(db, { gameid: '200', version: 1, sha1: SHA1_A, patchblob: 'pb', name: 'Hack' });
  db.prepare(`INSERT INTO gamestages VALUES (?, ?, ?, ?, ?)`)
    .run('s1', '200', '105', 'Known Level', null);
  db.prepare(`INSERT INTO gamestages VALUES (?, ?, ?, ?, ?)`)
    .run('s2', '200', '13B', 'Other', null);

  assert.ok(findStageRow(db, '200', '105'));
  assert.ok(!findStageRow(db, '200', '999'));
  db.close();
}

async function testBuildPlanStageEntry() {
  const db = createRhdataDb();
  seedGame(db, { gameid: '300', version: 1, sha1: SHA1_A, patchblob: 'pb', name: 'My Hack' });
  db.prepare(`INSERT INTO gamestages VALUES (?, ?, ?, ?, ?)`)
    .run('s1', '300', '105', 'Level 105', null);

  const parsed = {
    ok: true,
    name: 'Test Run',
    flags: { switchPalaces: false, freePlay: false },
    entries: [{ source: 'legacy', sha1: SHA1_A, levels: ['105', '13B'] }],
  };

  const result = await buildPlanFromShareCode(parsed, { rhdataDb: db });
  assert.strictEqual(result.plan.entries.length, 2);
  assert.strictEqual(result.plan.entries[0].entryType, 'stage');
  assert.strictEqual(result.plan.entries[1].entryType, 'raw_code');
  assert.strictEqual(result.plan.entries[1].rawLevelCode, '13B');
  db.close();
}

function testNormalizeLevelHex() {
  assert.strictEqual(normalizeLevelHex('13B'), '13B');
  assert.strictEqual(normalizeLevelHex('013b'), '13B');
}

async function main() {
  testResolveSha1PicksHighestVersion();
  testStageVsRawCode();
  await testBuildPlanStageEntry();
  testNormalizeLevelHex();
  console.log('test_mt_share_code_resolver: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
