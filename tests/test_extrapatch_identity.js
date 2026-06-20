#!/usr/bin/env node

/**
 * test_extrapatch_identity.js
 *
 * Verifies stable usage/definition hashes and patch identity snapshot helpers.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
  computePatchUsageHash,
  computePatchDefinitionHash,
  computeUsageHashesForPatchCodes,
  resolveBasePatchIdentity,
  buildPatchIdentitySnapshot
} = require('../lib/extrapatch-identity');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createRhdataDb(dbPath) {
  const db = new Database(dbPath);
  db.exec(fs.readFileSync(path.join(__dirname, '../electron/sql/migrations/033_rhdata_extrapatches.sql'), 'utf8'));
  db.exec('ALTER TABLE extrapatches ADD COLUMN is_playlevel INTEGER DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS gameversions (
      gameid TEXT NOT NULL,
      version INTEGER NOT NULL,
      patchblob1_name TEXT,
      pat_sha224 TEXT,
      PRIMARY KEY (gameid, version)
    );
    CREATE TABLE IF NOT EXISTS patchblobs (
      patchblob1_name TEXT PRIMARY KEY,
      pat_sha1 TEXT,
      result_sha1 TEXT,
      result_sha224 TEXT
    );
  `);
  return db;
}

function samplePatchRow(overrides = {}) {
  return {
    epuuid: 'ep-1',
    patch_code: '2lvno',
    patch_type: 'asar',
    file_data: null,
    template_text: 'print "hello"',
    parameter_mappings: '{"glevelnum":{"output":"${level}"}}',
    restrictions: null,
    conflicts: null,
    dependencies: null,
    priority: 50,
    is_playlevel: 1,
    requires_parameters: 0,
    ...overrides
  };
}

function testUsageAndDefinitionHashStability() {
  const row = samplePatchRow();
  const usage1 = computePatchUsageHash(row);
  const usage2 = computePatchUsageHash({ ...row });
  assert(usage1 === usage2, 'Usage hash should be stable');
  assert(usage1.length === 64, 'Usage hash should be sha256 hex');

  const def1 = computePatchDefinitionHash(row);
  const def2 = computePatchDefinitionHash({ ...row, patch_code: 'other' });
  assert(def1 !== def2, 'Definition hash should change when patch_code changes');

  const usageWithBlob = computePatchUsageHash(samplePatchRow({ file_data: Buffer.from('abc') }));
  const usageNoBlob = computePatchUsageHash(samplePatchRow({ file_data: null }));
  assert(usageWithBlob !== usageNoBlob, 'file_data should affect usage hash');
}

function testUsageHashesForPatchCodes() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extrapatch-id-'));
  const db = createRhdataDb(path.join(tmpDir, 'rhdata.db'));
  db.prepare(`
    INSERT INTO extrapatches (epuuid, patch_code, name, patch_type, template_text, priority, is_playlevel)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('ep-a', 'alpha', 'Alpha', 'asar', 'a', 10, 0);
  db.prepare(`
    INSERT INTO extrapatches (epuuid, patch_code, name, patch_type, template_text, priority, is_playlevel)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('ep-b', 'beta', 'Beta', 'asar', 'b', 20, 0);

  const out = computeUsageHashesForPatchCodes(db, ['beta', 'alpha']);
  assert(out.hashes.length === 2, 'Expected two usage hashes');
  assert(out.csv.split(',').length === 2, 'Expected csv with two hashes');
  assert(out.appliedPatchCodes.length === 2, 'Expected ordered patch codes');

  db.close();
}

function testResolveBasePatchIdentity() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extrapatch-id-'));
  const db = createRhdataDb(path.join(tmpDir, 'rhdata.db'));
  db.prepare(`
    INSERT INTO gameversions (gameid, version, patchblob1_name, pat_sha224)
    VALUES (?, ?, ?, ?)
  `).run('12345', 1, 'pb1', 'pat224abc');
  db.prepare(`
    INSERT INTO patchblobs (patchblob1_name, pat_sha1, result_sha1, result_sha224)
    VALUES (?, ?, ?, ?)
  `).run('pb1', 'pat1abc', 'res1abc', 'res224abc');

  const base = resolveBasePatchIdentity(db, '12345', 1);
  assert(base.pat_sha224 === 'pat224abc', 'Expected pat_sha224');
  assert(base.pat_sha1 === 'pat1abc', 'Expected pat_sha1');
  assert(base.result_sha1 === 'res1abc', 'Expected result_sha1');

  db.close();
}

function testBuildPatchIdentitySnapshotFromRomFallback() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extrapatch-id-'));
  const db = createRhdataDb(path.join(tmpDir, 'rhdata.db'));
  const romPath = path.join(tmpDir, 'initial.sfc');
  fs.writeFileSync(romPath, Buffer.from('fake-rom-bytes'));

  db.prepare(`
    INSERT INTO gameversions (gameid, version, patchblob1_name, pat_sha224)
    VALUES (?, ?, ?, ?)
  `).run('999', 1, 'pb-empty', 'gv224');
  db.prepare(`
    INSERT INTO patchblobs (patchblob1_name, pat_sha1, result_sha1, result_sha224)
    VALUES (?, ?, ?, ?)
  `).run('pb-empty', 'pb1', null, null);
  db.prepare(`
    INSERT INTO extrapatches (epuuid, patch_code, name, patch_type, template_text, priority, is_playlevel)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('ep-x', 'xpatch', 'X', 'asar', 'x', 5, 0);

  const snap = buildPatchIdentitySnapshot(db, {
    gameid: '999',
    gameVersion: 1,
    patchCodes: ['xpatch'],
    initialSfcPath: romPath
  });

  assert(snap.pat_sha224 === 'gv224', 'Expected gameversion pat_sha224');
  assert(snap.result_sha1 && snap.result_sha1.length === 40, 'Expected rom fallback result_sha1');
  assert(snap.patchdb_template_hashes.length === 64, 'Expected single usage hash in csv');
  assert(!snap.patchdb_template_hashes.includes(','), 'Single patch csv has no comma');

  db.close();
}

function main() {
  testUsageAndDefinitionHashStability();
  testUsageHashesForPatchCodes();
  testResolveBasePatchIdentity();
  testBuildPatchIdentitySnapshotFromRomFallback();
  console.log('✅ test_extrapatch_identity passed');
}

main();
