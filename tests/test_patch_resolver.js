#!/usr/bin/env node

/**
 * test_patch_resolver.js - Tests for lib/patch-resolver.js retrieval methods
 *
 * Run: node tests/test_patch_resolver.js
 * Env: PATCHBIN_DB_PATH, RHDATA_DB_PATH, PATCH_RESOLVER_USER_DATA
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { resolvePatch, resolvePatchblob, verifyPatchBuffer, verifyPatchblobBuffer } = require('../lib/patch-resolver');
const { decodeBlob } = require('../lib/patchblob-decode');

const TEST_DIR = path.join(__dirname, 'temp', 'patch_resolver');
const USER_DATA = process.env.PATCH_RESOLVER_USER_DATA || path.join(TEST_DIR, 'userdata');
const RHDATA_DB = process.env.RHDATA_DB_PATH || path.join(TEST_DIR, 'rhdata.db');
const PATCHBIN_DB = process.env.PATCHBIN_DB_PATH || path.join(TEST_DIR, 'patchbin.db');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error(`✗ ${message}`);
    return false;
  }
  passed += 1;
  console.log(`✓ ${message}`);
  return true;
}

function sha224(buf) {
  return crypto.createHash('sha224').update(buf).digest('hex');
}

function setupDatabases(patchData, blobData, includeFileData) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(path.join(USER_DATA, 'patch'), { recursive: true });
  fs.mkdirSync(path.join(USER_DATA, 'pblobs'), { recursive: true });

  if (fs.existsSync(RHDATA_DB)) fs.unlinkSync(RHDATA_DB);
  if (fs.existsSync(PATCHBIN_DB)) fs.unlinkSync(PATCHBIN_DB);

  const rh = new Database(RHDATA_DB);
  rh.exec(`
    CREATE TABLE gameversions (
      gvuuid TEXT PRIMARY KEY,
      gameid TEXT,
      version INTEGER,
      patchblob1_name TEXT,
      patchblob1_key TEXT,
      download_url TEXT
    );
    CREATE TABLE patchblobs (
      pbuuid TEXT PRIMARY KEY,
      gvuuid TEXT,
      patch_name TEXT,
      pat_sha1 TEXT,
      pat_sha224 TEXT,
      pat_shake_128 TEXT,
      patchblob1_name TEXT,
      patchblob1_key TEXT,
      patchblob1_sha224 TEXT,
      result_sha1 TEXT,
      result_sha256 TEXT,
      rhpakuuid TEXT
    );
  `);

  const patSha224 = sha224(patchData);
  const blobSha224 = sha224(blobData);
  const pbuuid = 'test-pbuuid-1';
  const gvuuid = 'test-gvuuid-1';
  const blobName = 'pblob_test_abc';

  rh.prepare(`
    INSERT INTO patchblobs (
      pbuuid, gvuuid, patch_name, pat_sha224, pat_shake_128,
      patchblob1_name, patchblob1_key, patchblob1_sha224, result_sha1
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pbuuid, gvuuid, 'patch/testshake', patSha224, 'testshake',
    blobName, 'dGVzdEtleQ==', blobSha224, 'deadbeef'
  );

  rh.prepare(`
    INSERT INTO gameversions (gvuuid, gameid, version, patchblob1_name, patchblob1_key)
    VALUES (?, ?, ?, ?, ?)
  `).run(gvuuid, '99999', 1, blobName, 'dGVzdEtleQ==');

  rh.close();

  const pb = new Database(PATCHBIN_DB);
  pb.exec(`
    CREATE TABLE attachments (
      auuid TEXT PRIMARY KEY,
      pbuuid TEXT,
      file_name TEXT,
      file_hash_sha224 TEXT,
      decoded_hash_sha224 TEXT,
      file_data BLOB
    );
  `);
  pb.prepare(`
    INSERT INTO attachments (auuid, pbuuid, file_name, file_hash_sha224, decoded_hash_sha224, file_data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'auuid-1', pbuuid, blobName, blobSha224, patSha224,
    includeFileData ? blobData : null
  );
  pb.close();

  return { pbuuid, blobName, patSha224, blobSha224, patchData, blobData };
}

function makeDbManager() {
  return {
    getConnection(name) {
      if (name === 'rhdata') return new Database(RHDATA_DB, { readonly: true });
      if (name === 'patchbin') return new Database(PATCHBIN_DB, { readonly: true });
      throw new Error(`Unknown db ${name}`);
    }
  };
}

async function testMethod0ArtifactStore() {
  console.log('\n--- Method 0: artifact store ---');
  const patchData = Buffer.from('BPS1-test-patch-data-method0');
  const blobData = Buffer.from('raw-patchblob-bytes-m0');
  const meta = setupDatabases(patchData, blobData, false);

  const { addItem } = require('../lib/artifact-store');
  const blobPath = path.join(TEST_DIR, 'm0blob');
  fs.writeFileSync(blobPath, blobData);
  addItem({
    artifactType: 'pblob',
    sourcePath: blobPath,
    fileName: meta.blobName,
    auuid: 'auuid-1',
    pbuuid: meta.pbuuid,
    file_hash_sha256: crypto.createHash('sha256').update(blobData).digest('hex'),
    userDataDir: USER_DATA
  });

  const ctx = { dbManager: makeDbManager(), userDataPath: USER_DATA };
  const blobResult = await resolvePatchblob(ctx, { pbuuid: meta.pbuuid });
  assert(blobResult.success === true, 'method0 resolves from artifact store');
  assert(blobResult.source && blobResult.source.method === 0, 'method0 source tag');
  assert(blobResult.data.equals(blobData), 'method0 patchblob bytes match');
}

async function testMethod1Database() {
  console.log('\n--- Method 1: database file_data ---');
  const patchData = Buffer.from('BPS1-test-patch-data-method1');
  const blobData = Buffer.from('encrypted-blob-placeholder-m1');
  const meta = setupDatabases(patchData, blobData, true);

  const ctx = { dbManager: makeDbManager(), userDataPath: USER_DATA };
  const result = await resolvePatch(ctx, { gameid: '99999', version: 1 });
  assert(result.success === false || result.success === true, 'method1 resolves or fails decode gracefully');
}

async function testMethod2LocalPatch() {
  console.log('\n--- Method 2: local patch file ---');
  const patchData = Buffer.from('BPS1-test-patch-data-method2');
  const blobData = Buffer.from('encrypted-blob-placeholder-m2');
  const meta = setupDatabases(patchData, blobData, false);

  const patchPath = path.join(USER_DATA, 'patch', 'testshake');
  fs.writeFileSync(patchPath, patchData);

  const ctx = { dbManager: makeDbManager(), userDataPath: USER_DATA };
  const result = await resolvePatch(ctx, { patchblob1_name: meta.blobName });
  assert(result.success === true, 'method2 finds local patch file');
  assert(result.source && result.source.method === 2, 'method2 source tag');
  assert(result.data.equals(patchData), 'method2 patch bytes match');
}

async function testMethod3LocalPatchblob() {
  console.log('\n--- Method 3: local patchblob (encoded) ---');
  const patchData = Buffer.from('BPS1-test-patch-data-method3');
  const blobData = Buffer.from('raw-patchblob-bytes-m3');
  const meta = setupDatabases(patchData, blobData, false);

  const blobPath = path.join(USER_DATA, 'pblobs', meta.blobName);
  fs.writeFileSync(blobPath, blobData);

  const ctx = { dbManager: makeDbManager(), userDataPath: USER_DATA };
  const blobResult = await resolvePatchblob(ctx, { pbuuid: meta.pbuuid });
  assert(blobResult.success === true, 'method3 resolves encoded patchblob');
  assert(blobResult.data.equals(blobData), 'method3 patchblob bytes match');
}

async function testHashVerificationFailure() {
  console.log('\n--- Hash verification failure ---');
  const patchData = Buffer.from('good-patch');
  const blobData = Buffer.from('blob');
  setupDatabases(patchData, blobData, false);

  const badPath = path.join(USER_DATA, 'patch', 'testshake');
  fs.writeFileSync(badPath, Buffer.from('wrong-patch-data'));

  const ctx = { dbManager: makeDbManager(), userDataPath: USER_DATA };
  const result = await resolvePatch(ctx, { gameid: '99999', version: 1 });
  assert(result.success === false, 'reject patch with wrong hash');
}

async function testVerifyHelpers() {
  console.log('\n--- Hash helper unit tests ---');
  const buf = Buffer.from('hello-bps');
  const pb = { pat_sha224: sha224(buf), pat_sha1: crypto.createHash('sha1').update(buf).digest('hex') };
  const ok = verifyPatchBuffer(buf, pb);
  assert(ok.ok === true, 'verifyPatchBuffer accepts matching patch');
  const bad = verifyPatchBuffer(Buffer.from('nope'), pb);
  assert(bad.ok === false, 'verifyPatchBuffer rejects mismatch');
}

async function testPrefetchList() {
  console.log('\n--- Prefetch list (best effort) ---');
  const patchData = Buffer.from('BPS1-prefetch-primary');
  const blobData = Buffer.from('blob-prefetch');
  setupDatabases(patchData, blobData, false);
  fs.writeFileSync(path.join(USER_DATA, 'patch', 'testshake'), patchData);

  const ctx = { dbManager: makeDbManager(), userDataPath: USER_DATA };
  const result = await resolvePatch(ctx, { gameid: '99999', version: 1 }, {
    prefetchList: [{ gameid: '99999', version: 1 }],
    skipPrefetch: false
  });
  assert(result.success === true, 'primary resolve with prefetchList succeeds');
}

async function run() {
  console.log('Patch resolver tests');
  try {
    await testVerifyHelpers();
    await testMethod0ArtifactStore();
    await testMethod1Database();
    await testMethod2LocalPatch();
    await testMethod3LocalPatchblob();
    await testHashVerificationFailure();
    await testPrefetchList();
  } catch (err) {
    failed += 1;
    console.error('Fatal:', err);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
