#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');

const {
  loadProvindex,
  executeProvindex,
  isBundleSpec
} = require('../lib/provision-bundle');
const artifactStore = require('../lib/artifact-store');

function buildZipBundle(dir, files) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
  }
  const out = path.join(dir, 'bundle.zip');
  zip.writeZip(out);
  return out;
}

async function run() {
  assert.strictEqual(isBundleSpec({ type: 'bundle', format: 'zip' }), true);
  assert.strictEqual(isBundleSpec({ format: 'xz' }), false);
  console.log('✓ isBundleSpec');

  const tmp = fs.mkdtempSync(path.join(__dirname, 'test_data', 'provision_bundle_'));
  process.env.ARTIFACT_STORE_DIR = path.join(tmp, 'artifacts');
  const bundleDir = path.join(tmp, 'unpacked');
  fs.mkdirSync(bundleDir, { recursive: true });

  const sql = 'CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1);';
  const blobData = Buffer.from('bundle-pblob');
  const auuid = crypto.randomUUID();
  const pbuuid = crypto.randomUUID();
  const provindex = [
    { type: 'SQL_PATCH', source: 'patch.sql' },
    {
      type: 'ADDITEM',
      artifact_type: 'pblob',
      source: 'pblob/ab/blob.bin',
      auuid,
      pbuuid,
      file_hash_sha256: crypto.createHash('sha256').update(blobData).digest('hex')
    },
    { type: 'CLEANUP', artifact_type: 'pblob', auuid: '00000000-0000-4000-8000-000000000099' }
  ];
  fs.writeFileSync(path.join(bundleDir, 'provindex.json'), JSON.stringify(provindex));
  fs.writeFileSync(path.join(bundleDir, 'patch.sql'), sql);
  fs.mkdirSync(path.join(bundleDir, 'pblob', 'ab'), { recursive: true });
  fs.writeFileSync(path.join(bundleDir, 'pblob', 'ab', 'blob.bin'), blobData);

  const instructions = loadProvindex(bundleDir);
  assert.strictEqual(instructions.length, 3);
  console.log('✓ loadProvindex');

  const dbPath = path.join(tmp, 'test.db');
  fs.writeFileSync(dbPath, '');
  const db = new Database(dbPath);
  db.close();

  await executeProvindex({
    instructions,
    bundleDir,
    dbPath,
    userDataDir: tmp,
    onLog: () => {}
  });

  const checkDb = new Database(dbPath, { readonly: true });
  assert.strictEqual(checkDb.prepare('SELECT id FROM t').get().id, 1);
  checkDb.close();

  const resolved = artifactStore.resolvePblobPath({ pbuuid, userDataDir: tmp });
  assert.ok(resolved);
  console.log('✓ executeProvindex SQL_PATCH + ADDITEM + CLEANUP');

  const zipPath = buildZipBundle(tmp, {
    'provindex.json': JSON.stringify([{ type: 'SQL_PATCH', source: 'p.sql' }]),
    'p.sql': 'CREATE TABLE z (v TEXT); INSERT INTO z VALUES (\'ok\');'
  });
  const zipBundleDir = path.join(tmp, 'zipbundle');
  fs.mkdirSync(zipBundleDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(zipBundleDir, true);
  const db2 = path.join(tmp, 'test2.db');
  fs.writeFileSync(db2, '');
  await executeProvindex({
    instructions: loadProvindex(zipBundleDir),
    bundleDir: zipBundleDir,
    dbPath: db2
  });
  const check2 = new Database(db2, { readonly: true });
  assert.strictEqual(check2.prepare('SELECT v FROM z').get().v, 'ok');
  check2.close();
  console.log('✓ zip bundle SQL patch');

  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ARTIFACT_STORE_DIR;
  console.log('✓ provision-bundle tests passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
