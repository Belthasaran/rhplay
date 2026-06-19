#!/usr/bin/env node

/**
 * Tests for gameversions27zfolder.js helpers and game_zip_resolver
 *
 * Usage:
 *   node tests/test_gameversions27zfolder.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const fernet = require('fernet');
const { findGameZip, resolveGameZip, collectFilenameCandidates } = require('../lib/game_zip_resolver');
const { metadataFromGameversionRow } = require('../lib/smwc_catalog_export');
const {
  findScreenshotRecord,
  decryptScreenshotBlob,
  resolveScreenshotBytes,
  tryLoadScreenshotFromDb,
  openScreenshotDb,
  clearScreenshotCache,
  sha256Hex
} = require('../lib/screenshot_db_reader');

const TEST_ROOT = path.join(__dirname, 'test_data', `gv27z_${process.pid}`);

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function test(description, testFn) {
  totalTests++;
  try {
    testFn();
    passedTests++;
    console.log(`✓ Test ${totalTests}: ${description}`);
  } catch (error) {
    failedTests++;
    console.error(`✗ Test ${totalTests}: ${description}`);
    console.error(`  Error: ${error.message}`);
  }
}

async function testAsync(description, testFn) {
  totalTests++;
  try {
    await testFn();
    passedTests++;
    console.log(`✓ Test ${totalTests}: ${description}`);
  } catch (error) {
    failedTests++;
    console.error(`✗ Test ${totalTests}: ${description}`);
    console.error(`  Error: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function setup() {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
}

function teardown() {
  clearScreenshotCache();
  try {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
}

function fernetTokenToBuffer(token) {
  let base64 = token.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64');
}

function encryptBuffer(buffer, providedKey = null) {
  const UrlBase64 = require('urlsafe-base64');
  const key = providedKey || UrlBase64.encode(crypto.randomBytes(32)).toString();
  const secret = new fernet.Secret(key);
  const token = new fernet.Token({ secret, ttl: 0 });
  const payload = buffer.toString('base64');
  const tokenString = token.encode(payload);
  const tokenBuffer = fernetTokenToBuffer(tokenString);
  return {
    key,
    tokenBuffer,
    decodedSha256: crypto.createHash('sha256').update(buffer).digest('hex')
  };
}

function createScreenshotDbFixture() {
  const dbPath = path.join(TEST_ROOT, 'screenshot.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE res_screenshots (
      rsuuid TEXT PRIMARY KEY,
      gameid TEXT,
      gvuuid TEXT,
      rhpakuuid TEXT,
      source_url TEXT,
      file_name TEXT,
      file_ext TEXT,
      screenshot_type TEXT,
      kind TEXT,
      encrypted_data BLOB,
      fernet_key TEXT,
      decoded_sha256 TEXT,
      file_sha256 TEXT,
      encoded_sha256 TEXT,
      storage_path TEXT,
      source_path TEXT,
      sequence_no INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE gameversion_screenshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gameid TEXT NOT NULL,
      rsuuid TEXT NOT NULL,
      sequence_no INTEGER,
      source_url TEXT,
      file_name TEXT
    );
  `);
  db.close();
  return dbPath;
}

async function runTests() {
  console.log('Running gameversions27zfolder tests...\n');
  setup();

  test('findGameZip locates gameid.zip in nested subfolder', () => {
    const nested = path.join(TEST_ROOT, 'zips_25');
    fs.mkdirSync(nested, { recursive: true });
    const zipPath = path.join(nested, '42550.zip');
    fs.writeFileSync(zipPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
    const found = findGameZip(TEST_ROOT, '42550', {}, {});
    assert(found === zipPath, `Expected ${zipPath}, got ${found}`);
  });

  test('findGameZip locates ZIP by original download filename', () => {
    const sub = path.join(TEST_ROOT, 'byname_only');
    fs.mkdirSync(sub, { recursive: true });
    const zipPath = path.join(sub, 'Dreadful Mario.zip');
    fs.writeFileSync(zipPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
    const metadata = { original_download_filename: 'Dreadful Mario.zip' };
    const row = { download_url: 'https://dl.smwcentral.net/42550/Dreadful%20Mario.zip' };
    const found = findGameZip(sub, '42550', metadata, row);
    assert(found === zipPath, `Expected ${zipPath}, got ${found}`);
  });

  test('collectFilenameCandidates includes gameid.zip and download basename', () => {
    const names = collectFilenameCandidates('12345', {
      original_download_filename: 'MyHack.zip',
      download_url: 'https://example.test/12345/MyHack.zip'
    }, {
      local_resource_filename: 'zips/12345.zip',
      download_url: 'https://example.test/12345/MyHack.zip'
    });
    assert(names.includes('12345.zip'));
    assert(names.includes('MyHack.zip'));
  });

  test('metadataFromGameversionRow merges gvjsondata with DB columns', () => {
    const row = {
      gameid: '42550',
      section: 'smwhacks',
      name: 'DB Name',
      download_url: 'https://dl.smwcentral.net/42550/Test.zip',
      url: 'https://www.smwcentral.net/?p=section&a=details&id=42550',
      authors: 'Author A',
      time: '1781723276',
      fields_type: 'Kaizo',
      gvjsondata: JSON.stringify({
        images: ['https://dl.smwcentral.net/image/1.png'],
        tags: ['kaizo'],
        description: 'From gvjson'
      })
    };
    const meta = metadataFromGameversionRow(row);
    assert(meta.gameid === '42550');
    assert(meta.section === 'smwhacks');
    assert(meta.name === 'DB Name');
    assert(meta.download_url === row.download_url);
    assert(Array.isArray(meta.images) && meta.images.length === 1);
    assert(Array.isArray(meta.tags) && meta.tags.includes('kaizo'));
    assert(meta.description === 'From gvjson');
  });

  await testAsync('resolveGameZip returns null when missing and no download', async () => {
    const emptyRoot = path.join(TEST_ROOT, 'empty_zips');
    fs.mkdirSync(emptyRoot, { recursive: true });
    const result = await resolveGameZip({
      sourceRoot: emptyRoot,
      gameid: '99999',
      metadata: {},
      row: {},
      downloadDir: path.join(TEST_ROOT, 'dl'),
      allowDownload: false,
      logFn: () => {}
    });
    assert(result.zipPath === null);
    assert(result.error);
  });

  test('findScreenshotRecord matches source_url', () => {
    const records = [
      { source_url: 'https://dl.smwcentral.net/image/119578.png', rsuuid: 'a' },
      { source_url: 'https://example.test/other.png', rsuuid: 'b' }
    ];
    const match = findScreenshotRecord(records, 'https://dl.smwcentral.net/image/119578.png');
    assert(match && match.rsuuid === 'a');
    assert(findScreenshotRecord(records, 'https://missing.test/x.png') === null);
  });

  test('decryptScreenshotBlob round-trip with findscreenshots-style encrypt', () => {
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const enc = encryptBuffer(imageBytes);
    const decrypted = decryptScreenshotBlob(enc.tokenBuffer, enc.key);
    assert(decrypted.equals(imageBytes));
    assert(sha256Hex(decrypted) === enc.decodedSha256);
  });

  test('resolveScreenshotBytes reads verified file from storage_path', () => {
    const dataDir = path.join(TEST_ROOT, 'screenshot_data');
    const relPath = path.join('42550', '119578.png');
    const fullPath = path.join(dataDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const imageBytes = Buffer.from('fake png bytes');
    fs.writeFileSync(fullPath, imageBytes);
    const record = {
      storage_path: relPath,
      decoded_sha256: sha256Hex(imageBytes)
    };
    const result = resolveScreenshotBytes(record, dataDir);
    assert(result.ok === true);
    assert(result.source === 'db-file');
    assert(result.buffer.equals(imageBytes));
  });

  test('tryLoadScreenshotFromDb returns buffer without HTTP when DB row exists', () => {
    clearScreenshotCache();
    const dbPath = createScreenshotDbFixture();
    const dataDir = path.join(TEST_ROOT, 'ss_data');
    const imageUrl = 'https://dl.smwcentral.net/image/119578.png';
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const enc = encryptBuffer(imageBytes);

    const db = new Database(dbPath);
    db.prepare(`
      INSERT INTO res_screenshots (
        rsuuid, gameid, source_url, file_name, encrypted_data, fernet_key, decoded_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('rs-1', '42550', imageUrl, '119578.png', enc.tokenBuffer, enc.key, enc.decodedSha256);
    db.prepare(`
      INSERT INTO gameversion_screenshots (gameid, rsuuid, sequence_no, source_url, file_name)
      VALUES (?, ?, ?, ?, ?)
    `).run('42550', 'rs-1', 1, imageUrl, '119578.png');
    db.close();

    const screenshotDb = openScreenshotDb(dbPath);
    try {
      const result = tryLoadScreenshotFromDb(screenshotDb, '42550', imageUrl, dataDir);
      assert(result.ok === true);
      assert(result.source === 'db-blob');
      assert(result.buffer.equals(imageBytes));
    } finally {
      screenshotDb.close();
    }
  });

  teardown();

  console.log('\n==================================================');
  console.log(`  Passed: ${passedTests}/${totalTests}`);
  console.log(`  Failed: ${failedTests}/${totalTests}`);
  console.log('==================================================\n');

  if (failedTests > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  teardown();
  process.exit(1);
});
