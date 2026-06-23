#!/usr/bin/env node

/**
 * Tests for lib/migrate-artifacts.js (manifest migrate_artifacts post-step)
 *
 * Usage:
 *   node tests/test_migrate_artifacts.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const fernet = require('fernet');
const UrlBase64 = require('urlsafe-base64');

const {
  isMigrateArtifactsEnabled,
  maybeMigrateArtifacts,
  migrateArtifactsForDatabase,
  sha224Hex,
  sha256Hex
} = require('../lib/migrate-artifacts');
const { resolvePblobPath, getArtifactStoreRoot } = require('../lib/artifact-store');

const TEST_ROOT = path.join(__dirname, 'test_data', 'migrate_artifacts');

function fernetTokenToBuffer(token) {
  let base64 = token.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64');
}

function encryptBuffer(buffer) {
  const key = UrlBase64.encode(crypto.randomBytes(32)).toString();
  const secret = new fernet.Secret(key);
  const token = new fernet.Token({ secret, ttl: 0 });
  const tokenString = token.encode(buffer.toString('base64'));
  return {
    key,
    tokenBuffer: fernetTokenToBuffer(tokenString),
    encodedSha256: sha256Hex(fernetTokenToBuffer(tokenString)),
    decodedSha256: sha256Hex(buffer)
  };
}

function createPatchbinDb(dbPath, { blob, sha224, sha256, auuid = '00000000-0000-4000-8000-000000000099' } = {}) {
  const data = blob || Buffer.from('patchblob-payload');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE attachments (
      auuid TEXT PRIMARY KEY,
      pbuuid TEXT,
      gvuuid TEXT,
      file_name TEXT NOT NULL,
      file_hash_sha224 TEXT,
      file_hash_sha256 TEXT,
      file_hash_sha1 TEXT,
      file_hash_md5 TEXT,
      decoded_hash_sha256 TEXT,
      file_data BLOB
    );
  `);
  db.prepare(`
    INSERT INTO attachments (
      auuid, pbuuid, gvuuid, file_name,
      file_hash_sha224, file_hash_sha256, file_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    auuid,
    '00000000-0000-4000-8000-000000000001',
    null,
    'pblob_test.bin',
    sha224 || sha224Hex(data),
    sha256 || sha256Hex(data),
    data
  );
  db.close();
}

function createResourceDb(dbPath, { encrypted, key, encodedSha, decodedSha, rauuid = '00000000-0000-4000-8000-000000000010' } = {}) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE res_attachments (
      rauuid TEXT PRIMARY KEY,
      file_name TEXT,
      encoded_sha256 TEXT,
      decoded_sha256 TEXT,
      file_sha256 TEXT,
      encrypted_data BLOB,
      fernet_key TEXT
    );
  `);
  db.prepare(`
    INSERT INTO res_attachments (
      rauuid, file_name, encoded_sha256, decoded_sha256, file_sha256, encrypted_data, fernet_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    rauuid,
    `${rauuid}.rbin`,
    encodedSha,
    decodedSha,
    decodedSha,
    encrypted,
    key
  );
  db.close();
}

function setupUserData() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  const userDataDir = path.join(TEST_ROOT, 'userdata');
  const artifactDir = path.join(userDataDir, 'artifacts');
  process.env.ARTIFACT_STORE_DIR = artifactDir;
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  return userDataDir;
}

async function run() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });

  assert.strictEqual(isMigrateArtifactsEnabled({ migrate_artifacts: true }), true);
  assert.strictEqual(isMigrateArtifactsEnabled({ migrate_artifacts: 'true' }), true);
  assert.strictEqual(isMigrateArtifactsEnabled({}), false);
  console.log('✓ isMigrateArtifactsEnabled');

  const skipped = await maybeMigrateArtifacts({
    spec: {},
    dbPath: path.join(TEST_ROOT, 'missing.db'),
    dbName: 'patchbin.db',
    userDataDir: setupUserData()
  });
  assert.strictEqual(skipped, null);
  console.log('✓ maybeMigrateArtifacts skips when flag unset');

  const userDataDir = setupUserData();
  const patchbinPath = path.join(TEST_ROOT, 'patchbin_ok.db');
  const blob = Buffer.from('valid-patchblob');
  createPatchbinDb(patchbinPath, { blob });
  const result = migrateArtifactsForDatabase({
    dbPath: patchbinPath,
    dbName: 'patchbin.db',
    userDataDir
  });
  assert.strictEqual(result.totals.migrated, 1);
  const db1 = new Database(patchbinPath);
  const row1 = db1.prepare('SELECT file_data FROM attachments').get();
  db1.close();
  assert.strictEqual(row1.file_data, null);
  const resolved = resolvePblobPath({
    pbuuid: '00000000-0000-4000-8000-000000000001',
    userDataDir
  });
  assert.ok(resolved && fs.existsSync(resolved.filePath));
  console.log('✓ patchbin attachment migrates to artifact store and NULLs file_data');

  const userDataDir2 = setupUserData();
  const patchbinBad = path.join(TEST_ROOT, 'patchbin_bad.db');
  createPatchbinDb(patchbinBad, {
    blob: Buffer.from('bad-hash'),
    sha224: '0'.repeat(56),
    auuid: '00000000-0000-4000-8000-000000000088'
  });
  const badResult = migrateArtifactsForDatabase({
    dbPath: patchbinBad,
    dbName: 'patchbin.db',
    userDataDir: userDataDir2
  });
  assert.strictEqual(badResult.totals.failed, 1);
  assert.strictEqual(badResult.totals.migrated, 0);
  const db2 = new Database(patchbinBad);
  const row2 = db2.prepare('SELECT length(file_data) AS n FROM attachments').get();
  db2.close();
  assert.ok(row2.n > 0);
  console.log('✓ patchbin hash mismatch leaves blob column intact');

  const userDataDir3 = setupUserData();
  const resourcePath = path.join(TEST_ROOT, 'resource_ok.db');
  const plain = Buffer.from('resource-plain');
  const enc = encryptBuffer(plain);
  createResourceDb(resourcePath, {
    encrypted: enc.tokenBuffer,
    key: enc.key,
    encodedSha: enc.encodedSha256,
    decodedSha: enc.decodedSha256
  });
  const resourceResult = migrateArtifactsForDatabase({
    dbPath: resourcePath,
    dbName: 'resource.db',
    userDataDir: userDataDir3
  });
  assert.strictEqual(resourceResult.totals.migrated, 1);
  const db3 = new Database(resourcePath);
  const row3 = db3.prepare('SELECT encrypted_data FROM res_attachments').get();
  db3.close();
  assert.strictEqual(row3.encrypted_data, null);
  const artifactRoot = getArtifactStoreRoot(userDataDir3);
  const resourceIndex = fs.readFileSync(path.join(artifactRoot, 'resource', 'resource_index.csv'), 'utf8');
  assert.match(resourceIndex, /00000000-0000-4000-8000-000000000010/);
  console.log('✓ resource encrypted_data migrates with fernet validation');

  const unsupported = migrateArtifactsForDatabase({
    dbPath: patchbinPath,
    dbName: 'rhdata.db',
    userDataDir,
    onLog: () => {}
  });
  assert.strictEqual(unsupported.skipped, true);
  console.log('✓ unsupported database name skips migration');

  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  delete process.env.ARTIFACT_STORE_DIR;
  console.log('✓ migrate-artifacts tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
