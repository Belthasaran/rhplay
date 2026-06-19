#!/usr/bin/env node

/**
 * Tests for gameversions27zfolder.js helpers and game_zip_resolver
 *
 * Usage:
 *   node tests/test_gameversions27zfolder.js
 */

const fs = require('fs');
const path = require('path');
const { findGameZip, resolveGameZip, collectFilenameCandidates } = require('../lib/game_zip_resolver');
const { metadataFromGameversionRow } = require('../lib/smwc_catalog_export');

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
  try {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
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
