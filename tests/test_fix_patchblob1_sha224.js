#!/usr/bin/env node

/**
 * Tests for fix-patchblob1-sha224.js and newgame.js encoded hash resolution.
 *
 * Usage:
 *   node tests/test_fix_patchblob1_sha224.js
 *
 * Environment:
 *   Uses isolated temp databases under tests/test_data/
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const {
  findMismatches,
  applyFixes
} = require('../jstools/fix-patchblob1-sha224');
const { resolveEncodedPatchblobSha224 } = require('../jstools/newgame');

const TEST_DIR = path.join(__dirname, 'test_data', 'fix_patchblob1_sha224');

let total = 0;
let passed = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}: ${error.message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function sha224Hex(buffer) {
  return crypto.createHash('sha224').update(buffer).digest('hex');
}

function setupDatabases() {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const rhdataPath = path.join(TEST_DIR, 'rhdata.db');
  const patchbinPath = path.join(TEST_DIR, 'patchbin.db');
  for (const dbPath of [rhdataPath, patchbinPath]) {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  }

  const rhdata = new Database(rhdataPath);
  rhdata.exec(`
    CREATE TABLE patchblobs (
      pbuuid TEXT PRIMARY KEY,
      patchblob1_name TEXT UNIQUE,
      patchblob1_sha224 TEXT,
      pat_sha224 TEXT
    );
  `);

  const patchbin = new Database(patchbinPath);
  patchbin.exec(`
    CREATE TABLE attachments (
      auuid TEXT PRIMARY KEY,
      pbuuid TEXT,
      file_name TEXT,
      file_hash_sha224 TEXT
    );
  `);

  return { rhdata, patchbin, rhdataPath, patchbinPath };
}

function main() {
  test('resolveEncodedPatchblobSha224 prefers blobMetadata', () => {
    const encoded = 'encoded_outer_sha224';
    const artifact = {
      patSha224: 'decoded_pat_sha224',
      blobMetadata: { patchblob1_sha224: encoded },
      attachmentMeta: { file_sha224: 'attachment_sha224' }
    };
    assertEqual(resolveEncodedPatchblobSha224(artifact), encoded);
  });

  test('resolveEncodedPatchblobSha224 falls back to attachmentMeta', () => {
    const artifact = {
      patSha224: 'decoded_pat_sha224',
      blobMetadata: {},
      attachmentMeta: { file_sha224: 'attachment_sha224' }
    };
    assertEqual(resolveEncodedPatchblobSha224(artifact), 'attachment_sha224');
  });

  test('resolveEncodedPatchblobSha224 returns null without encoded sources', () => {
    const artifact = { patSha224: 'decoded_only', blobMetadata: {}, attachmentMeta: {} };
    assertEqual(resolveEncodedPatchblobSha224(artifact), null);
  });

  test('findMismatches detects pat_sha224 wrongly stored as patchblob1_sha224', () => {
    const { rhdata, patchbin } = setupDatabases();
    const decoded = sha224Hex(Buffer.from('bps-patch-bytes'));
    const encoded = sha224Hex(Buffer.from('encoded-blob-bytes'));
    rhdata.prepare(`
      INSERT INTO patchblobs (pbuuid, patchblob1_name, patchblob1_sha224, pat_sha224)
      VALUES ('pb1', 'pblob_test.bin', ?, ?)
    `).run(decoded, decoded);
    patchbin.prepare(`
      INSERT INTO attachments (auuid, pbuuid, file_name, file_hash_sha224)
      VALUES ('au1', 'pb1', 'pblob_test.bin', ?)
    `).run(encoded);

    const { mismatches } = findMismatches(rhdata, patchbin);
    assertEqual(mismatches.length, 1);
    assertEqual(mismatches[0].expected, encoded);
    assertEqual(mismatches[0].wrongLooksLikePat, true);
    rhdata.close();
    patchbin.close();
  });

  test('findMismatches ignores rows already matching attachment hash', () => {
    const { rhdata, patchbin } = setupDatabases();
    const encoded = sha224Hex(Buffer.from('encoded-blob-bytes'));
    rhdata.prepare(`
      INSERT INTO patchblobs (pbuuid, patchblob1_name, patchblob1_sha224, pat_sha224)
      VALUES ('pb1', 'pblob_test.bin', ?, 'decoded')
    `).run(encoded);
    patchbin.prepare(`
      INSERT INTO attachments (auuid, pbuuid, file_name, file_hash_sha224)
      VALUES ('au1', 'pb1', 'pblob_test.bin', ?)
    `).run(encoded);

    const { mismatches } = findMismatches(rhdata, patchbin);
    assertEqual(mismatches.length, 0);
    rhdata.close();
    patchbin.close();
  });

  test('applyFixes updates rhdata when attachment matches patchblob1_name', () => {
    const { rhdata, patchbin } = setupDatabases();
    const decoded = sha224Hex(Buffer.from('bps'));
    const encoded = sha224Hex(Buffer.from('blob'));
    rhdata.prepare(`
      INSERT INTO patchblobs (pbuuid, patchblob1_name, patchblob1_sha224, pat_sha224)
      VALUES ('pb1', 'pblob_fallback.bin', ?, ?)
    `).run(decoded, decoded);
    patchbin.prepare(`
      INSERT INTO attachments (auuid, pbuuid, file_name, file_hash_sha224)
      VALUES ('au1', 'pb1', 'pblob_fallback.bin', ?)
    `).run(encoded);

    const { mismatches } = findMismatches(rhdata, patchbin);
    applyFixes(rhdata, mismatches);
    const row = rhdata.prepare('SELECT patchblob1_sha224 FROM patchblobs WHERE pbuuid = ?').get('pb1');
    assertEqual(row.patchblob1_sha224, encoded);
    rhdata.close();
    patchbin.close();
  });

  test('findMismatches prefers file_name over ambiguous pbuuid', () => {
    const { rhdata, patchbin } = setupDatabases();
    const encodedA = sha224Hex(Buffer.from('blob-a'));
    const encodedB = sha224Hex(Buffer.from('blob-b'));
    rhdata.prepare(`
      INSERT INTO patchblobs (pbuuid, patchblob1_name, patchblob1_sha224, pat_sha224)
      VALUES ('pb1', 'pblob_a.bin', 'wrong', 'pat-a')
    `).run();
    patchbin.prepare(`
      INSERT INTO attachments (auuid, pbuuid, file_name, file_hash_sha224)
      VALUES ('au1', 'pb1', 'pblob_a.bin', ?)
    `).run(encodedA);
    patchbin.prepare(`
      INSERT INTO attachments (auuid, pbuuid, file_name, file_hash_sha224)
      VALUES ('au2', 'pb1', 'pblob_b.bin', ?)
    `).run(encodedB);

    const { mismatches } = findMismatches(rhdata, patchbin);
    assertEqual(mismatches.length, 1);
    assertEqual(mismatches[0].expected, encodedA);
    assertEqual(mismatches[0].matchedBy, 'file_name');
    rhdata.close();
    patchbin.close();
  });

  console.log(`\n${passed}/${total} tests passed`);
  process.exit(passed === total ? 0 : 1);
}

main();
