#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  ensureLayout,
  addItem,
  resolvePblobPath,
  appendCleanupHint,
  getArtifactStoreRoot,
  sha256Buffer
} = require('../lib/artifact-store');

function run() {
  const tmp = fs.mkdtempSync(path.join(__dirname, 'test_data', 'artifact_store_'));
  process.env.ARTIFACT_STORE_DIR = path.join(tmp, 'artifacts');

  const root = ensureLayout(tmp);
  assert.ok(fs.existsSync(path.join(root, 'README.txt')));
  assert.ok(fs.existsSync(path.join(root, 'pblob', 'README.txt')));
  assert.ok(fs.existsSync(path.join(root, 'pblob', 'pblob_index.csv')));
  console.log('✓ ensureLayout creates README and indexes');

  const auuid = crypto.randomUUID();
  const pbuuid = crypto.randomUUID();
  const blobPath = path.join(tmp, 'blob.bin');
  const blobData = Buffer.from('test-pblob-data');
  fs.writeFileSync(blobPath, blobData);
  const fileHash = sha256Buffer(blobData);

  addItem({
    artifactType: 'pblob',
    sourcePath: blobPath,
    fileName: 'pblob_test.bin',
    auuid,
    pbuuid,
    file_hash_sha256: fileHash,
    userDataDir: tmp
  });

  const resolved = resolvePblobPath({ pbuuid, userDataDir: tmp });
  assert.ok(resolved);
  assert.strictEqual(resolved.row.auuid, auuid);
  assert.ok(fs.existsSync(resolved.filePath));
  console.log('✓ addItem and resolvePblobPath');

  addItem({
    artifactType: 'pblob',
    sourcePath: blobPath,
    fileName: 'pblob_test.bin',
    auuid,
    pbuuid,
    file_hash_sha256: fileHash,
    userDataDir: tmp
  });
  const rows = fs.readFileSync(path.join(root, 'pblob', 'pblob_index.csv'), 'utf8').split('\n').filter(Boolean);
  assert.strictEqual(rows.length, 2, 'header + one row after upsert');
  console.log('✓ addItem upserts mapping without duplicate rows');

  appendCleanupHint({ artifactType: 'pblob', auuid, userDataDir: tmp });
  const hints = fs.readFileSync(path.join(root, 'cleanup_hints.csv'), 'utf8');
  assert.match(hints, new RegExp(auuid));
  console.log('✓ appendCleanupHint');

  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ARTIFACT_STORE_DIR;
  console.log('✓ artifact-store tests passed');
}

run();
