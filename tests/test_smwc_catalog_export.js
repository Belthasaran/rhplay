#!/usr/bin/env node

/**
 * Tests for lib/smwc_catalog_export.js
 *
 * Usage:
 *   node tests/test_smwc_catalog_export.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const catalogExport = require('../lib/smwc_catalog_export');

const TEST_ROOT = path.join(__dirname, 'test_data', 'catalog_export_' + process.pid);

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
  console.log('Running smwc_catalog_export tests...\n');
  setup();

  test('resolveCatalogDir uses SMWC_CATALOG_DIR environment override', () => {
    const prev = process.env.SMWC_CATALOG_DIR;
    process.env.SMWC_CATALOG_DIR = path.join(TEST_ROOT, 'env_catalog');
    try {
      const dir = catalogExport.resolveCatalogDir({});
      assert(dir === path.join(TEST_ROOT, 'env_catalog'), `Expected env path, got ${dir}`);
    } finally {
      if (prev === undefined) delete process.env.SMWC_CATALOG_DIR;
      else process.env.SMWC_CATALOG_DIR = prev;
    }
  });

  test('resolveCatalogDir uses --target-7zfolder when set', () => {
    const prev = process.env.SMWC_CATALOG_DIR;
    delete process.env.SMWC_CATALOG_DIR;
    try {
      const custom = path.join(TEST_ROOT, 'custom7z');
      const dir = catalogExport.resolveCatalogDir({ 'target-7zfolder': custom });
      assert(dir === custom, `Expected ${custom}, got ${dir}`);
    } finally {
      if (prev !== undefined) process.env.SMWC_CATALOG_DIR = prev;
    }
  });

  test('resolveCatalogDir default uses $HOME/proj/smwcgamesYYYYMMDD', () => {
    const prev = process.env.SMWC_CATALOG_DIR;
    delete process.env.SMWC_CATALOG_DIR;
    const home = process.env.HOME || os.homedir();
    const ts = catalogExport.formatDateStamp();
    try {
      const dir = catalogExport.resolveCatalogDir({});
      assert(dir === path.join(home, 'proj', `smwcgames${ts}`), `Unexpected default: ${dir}`);
    } finally {
      if (prev !== undefined) process.env.SMWC_CATALOG_DIR = prev;
    }
  });

  test('shouldUseFullCatalogExport detects pat_sha224 change', () => {
    assert(catalogExport.shouldUseFullCatalogExport('aaa', 'bbb') === true);
    assert(catalogExport.shouldUseFullCatalogExport('same', 'same') === false);
    assert(catalogExport.shouldUseFullCatalogExport(null, null) === false);
  });

  test('buildBpsIndexJson includes smwc_smwhacks and sfc_rom_sha224_hash', () => {
    const game = {
      gameid: '42550',
      name: 'Test Hack',
      section: 'smwhacks',
      url: 'https://example.test/42550',
      download_url: 'https://example.test/42550.zip',
      authors: 'Author One'
    };
    const { indexJson } = catalogExport.buildBpsIndexJson({
      game,
      enhancedGameName: 'Test Hack [SMWC 2026-06-18]',
      gameDate: '2026-06-18',
      bpsFile: { filename: 'patch.bps' },
      bpsFilename: 'deadbeef.bps',
      indexJsonFilename: 'deadbeef.json',
      resultHash: 'deadbeef',
      resultSha256: 'a'.repeat(64),
      resultSha224: 'b'.repeat(56),
      resultDataLength: 4194304,
      smcRomSha1: 'ccc',
      smc2RomSha256: 'd'.repeat(64),
      bpsSha1: 'eee',
      bpsSha256: 'f'.repeat(64),
      originalFilename: 'Test.zip',
      uploadEstimate: '2026-06-18T00:00:00.000Z',
      zipContentTimestamp: '2026-06-18T00:00:00',
      detectedLanguages: new Set(['English']),
      levelnames: null,
      lmFilterData: null,
      translevelData: null,
      syntheticSfcFilename: 'Test Hack [SMWC 2026-06-18] by Author One [2026-06-18] (SMW Hack).sfc',
      titleWithLang: 'Test Hack [SMWC 2026-06-18]',
      firstAuthor: 'Author One',
      typeMapping: { fields_type: 'Kaizo', difficulty: 'Casual', legacy_type: 'Kaizo' },
      estimatedLanguage: 'English',
      languageTag: ''
    });

    assert(indexJson.smwc_smwhacks, 'Missing smwc_smwhacks key');
    assert(indexJson.smwc_smwhacks.gameid === '42550');
    assert(indexJson.sfc_rom_sha224_hash === 'b'.repeat(56));
    assert(indexJson.sfc_filename_title.includes('[SMWC 2026-06-18]'));
    assert(!indexJson.smwc_waiting, 'Should not use smwc_waiting key');
  });

  test('enhanceGameNameForCatalog adds SMWC tag not SMWC-Waiting', () => {
    const name = catalogExport.enhanceGameNameForCatalog({ name: 'My Hack' }, '2026-06-18');
    assert(name.includes('[SMWC 2026-06-18]'));
    assert(!name.includes('SMWC-Waiting'));
  });

  test('resolveCatalogImageFilename keeps URL extension when present', () => {
    const url = 'https://dl.smwcentral.net/image/119578.png';
    assert(catalogExport.resolveCatalogImageFilename(url) === '119578.png');
  });

  test('resolveCatalogImageFilename adds .png from PNG buffer', () => {
    const url = 'https://dl.smwcentral.net/image/25714';
    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    assert(catalogExport.resolveCatalogImageFilename(url, { buffer: pngHeader }) === '25714.png');
  });

  test('resolveCatalogImageFilename adds .jpg from JPEG buffer', () => {
    const url = 'https://dl.smwcentral.net/image/25714';
    const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    assert(catalogExport.resolveCatalogImageFilename(url, { buffer: jpegHeader }) === '25714.jpg');
  });

  test('resolveCatalogImageFilename leaves bare basename when type unknown', () => {
    const url = 'https://dl.smwcentral.net/image/25714';
    const unknown = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    assert(catalogExport.resolveCatalogImageFilename(url, { buffer: unknown }) === '25714');
  });

  test('resolveCatalogImageFilename uses fileExt hint before buffer', () => {
    const url = 'https://dl.smwcentral.net/image/25714';
    assert(catalogExport.resolveCatalogImageFilename(url, { fileExt: 'gif' }) === '25714.gif');
  });

  test('findExistingCatalogImagePath finds legacy extensionless file', () => {
    const dir = path.join(TEST_ROOT, 'images_legacy');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '25714'), Buffer.from([0x89, 0x50, 0x4E, 0x47]));
    const found = catalogExport.findExistingCatalogImagePath(dir, '25714');
    assert(found && found.filename === '25714');
    assert(found.path === path.join(dir, '25714'));
  });

  await testAsync('verifyCatalogWritable succeeds on writable temp directory', async () => {
    const prevHome = process.env.HOME;
    process.env.HOME = TEST_ROOT;
    try {
      const catalogDir = path.join(TEST_ROOT, 'writable_catalog');
      catalogExport.verifyCatalogWritable(catalogDir, { skip7zCheck: true });
      assert(fs.existsSync(path.join(catalogDir, 'bps')));
      assert(fs.existsSync(catalogDir + '.build'));
    } finally {
      process.env.HOME = prevHome;
    }
  });

  await testAsync('writeAbbreviatedUpdateJson creates games/GAMEID_updateTS.json', async () => {
    const catalogDir = path.join(TEST_ROOT, 'abbrev_catalog');
    const result = catalogExport.writeAbbreviatedUpdateJson({
      catalogDir,
      gameid: '99999',
      metadata: { name: 'Updated Name', url: 'https://example.test' },
      version: 2,
      latestVersion: { version: 1, pat_sha224: 'unchanged' },
      changedFields: { name: true },
      dryRun: false,
      logFn: () => {}
    });
    assert(result.ok);
    assert(fs.existsSync(result.path));
    const data = JSON.parse(fs.readFileSync(result.path, 'utf8'));
    assert(data.update_type === 'metadata');
    assert(data.gameid === '99999');
    assert(data.pat_sha224 === 'unchanged');
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
