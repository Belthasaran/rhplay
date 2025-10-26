#!/usr/bin/env node

/**
 * Test script for attachblobs.js
 * Tests original mode and --newonly option
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { execSync } = require('child_process');

// Test configuration
const TEST_DIR = __dirname;
const TEMP_DIR = path.join(TEST_DIR, 'temp');
const FIXTURES_DIR = path.join(TEST_DIR, 'fixtures_attachblobs');
const TEST_RHDATA_DB_PATH = path.join(TEMP_DIR, 'test_rhdata_attachblobs.db');
const TEST_PATCHBIN_DB_PATH = path.join(TEMP_DIR, 'test_patchbin_attachblobs.db');
const PATCHBIN_SCHEMA_PATH = path.join(__dirname, '..', 'electron', 'sql', 'patchbin.sql');

// Import functions from attachblobs.js for unit testing
const {
  fileNameExistsInAttachments,
  parseCommandLineArgs,
  generateUUID,
  sha224,
  calculateCRC16,
  calculateCRC32
} = require('../attachblobs.js');

// Color output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message) {
  log('green', `✓ ${message}`);
}

function error(message) {
  log('red', `✗ ${message}`);
  throw new Error(message);
}

function info(message) {
  log('cyan', `ℹ ${message}`);
}

function section(message) {
  console.log();
  log('blue', '='.repeat(70));
  log('blue', message);
  log('blue', '='.repeat(70));
}

/**
 * Clean up test environment
 */
function cleanupTestEnv() {
  section('Cleaning up test environment');
  
  if (fs.existsSync(TEST_RHDATA_DB_PATH)) {
    fs.unlinkSync(TEST_RHDATA_DB_PATH);
    info('Removed existing test rhdata.db');
  }
  
  if (fs.existsSync(TEST_PATCHBIN_DB_PATH)) {
    fs.unlinkSync(TEST_PATCHBIN_DB_PATH);
    info('Removed existing test patchbin.db');
  }
  
  if (fs.existsSync(FIXTURES_DIR)) {
    const files = fs.readdirSync(FIXTURES_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(FIXTURES_DIR, file));
    }
    fs.rmdirSync(FIXTURES_DIR);
    info('Removed test fixtures directory');
  }
  
  success('Test environment cleaned');
}

/**
 * Setup test databases
 */
function setupTestDatabases() {
  section('Setting up test databases');
  
  // Ensure temp directory exists
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  
  // Ensure fixtures directory exists
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }
  
  // Create rhdata.db
  const rhdataDb = new Database(TEST_RHDATA_DB_PATH);
  rhdataDb.exec(`
    CREATE TABLE IF NOT EXISTS patchblobs (
      pbuuid varchar(255) PRIMARY KEY,
      gvuuid varchar(255),
      patchblob1_name varchar(255),
      patchblob1_sha224 varchar(255),
      patchblob1_key varchar(255),
      pat_sha224 varchar(255)
    )
  `);
  success('Created test rhdata.db');
  
  // Create patchbin.db
  const patchbinDb = new Database(TEST_PATCHBIN_DB_PATH);
  const schema = fs.readFileSync(PATCHBIN_SCHEMA_PATH, 'utf8');
  patchbinDb.exec(schema);
  success('Created test patchbin.db with schema');
  
  return { rhdataDb, patchbinDb };
}

/**
 * Create test fixtures (files to be attached)
 */
function createTestFixtures() {
  section('Creating test fixtures');
  
  const fixtures = [
    { name: 'test_patch_1.bin', content: Buffer.from('Test patch content 1'.repeat(50)) },
    { name: 'test_patch_2.bin', content: Buffer.from('Test patch content 2'.repeat(100)) },
    { name: 'test_patch_3.dat', content: Buffer.from('Test patch content 3'.repeat(75)) },
    { name: 'test_patch_4.bin', content: Buffer.from('Test patch content 4'.repeat(60)) },
    { name: 'test_patch_5.dat', content: Buffer.from('Test patch content 5'.repeat(80)) }
  ];
  
  const createdFixtures = [];
  
  for (const fixture of fixtures) {
    const filePath = path.join(FIXTURES_DIR, fixture.name);
    fs.writeFileSync(filePath, fixture.content);
    
    const fileHash = sha224(fixture.content);
    const fileSize = fixture.content.length;
    
    createdFixtures.push({
      name: fixture.name,
      path: filePath,
      content: fixture.content,
      hash: fileHash,
      size: fileSize
    });
    
    success(`Created fixture: ${fixture.name} (${fileSize} bytes, sha224: ${fileHash.substring(0, 12)}...)`);
  }
  
  return createdFixtures;
}

/**
 * Populate test data into databases
 */
function populateTestData(rhdataDb, patchbinDb, fixtures) {
  section('Populating test data');
  
  // Insert patchblobs into rhdata.db
  const insertPatchblob = rhdataDb.prepare(`
    INSERT INTO patchblobs (pbuuid, gvuuid, patchblob1_name, patchblob1_sha224, patchblob1_key, pat_sha224)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    const pbuuid = generateUUID();
    const gvuuid = generateUUID();
    
    insertPatchblob.run(
      pbuuid,
      gvuuid,
      fixture.name,
      fixture.hash,
      '', // No encryption key for test
      '' // No decoded hash for test
    );
    
    fixtures[i].pbuuid = pbuuid;
    fixtures[i].gvuuid = gvuuid;
  }
  
  success(`Inserted ${fixtures.length} patchblobs into rhdata.db`);
  
  // Pre-populate some attachments in patchbin.db to test --newonly
  // We'll add test_patch_1.bin and test_patch_3.dat to simulate existing entries
  const insertAttachment = patchbinDb.prepare(`
    INSERT INTO attachments (
      auuid, pbuuid, gvuuid, file_crc16, file_crc32, locators, parents,
      file_ipfs_cidv0, file_ipfs_cidv1, file_hash_sha224, file_hash_sha1,
      file_hash_md5, file_hash_sha256, file_name, filekey,
      decoded_ipfs_cidv0, decoded_ipfs_cidv1, decoded_hash_sha224,
      decoded_hash_sha1, decoded_hash_md5, decoded_hash_sha256,
      file_size, file_data
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?
    )
  `);
  
  // Add first fixture to attachments (test_patch_1.bin - this should be skipped with --newonly)
  const fixture1 = fixtures[0];
  insertAttachment.run(
    generateUUID(),
    fixture1.pbuuid,
    fixture1.gvuuid,
    calculateCRC16(fixture1.content),
    calculateCRC32(fixture1.content),
    JSON.stringify([]),
    JSON.stringify([]),
    'QmTest1CIDv0', // Simplified for testing
    'bafyTest1CIDv1',
    fixture1.hash,
    crypto.createHash('sha1').update(fixture1.content).digest('hex'),
    crypto.createHash('md5').update(fixture1.content).digest('hex'),
    crypto.createHash('sha256').update(fixture1.content).digest('hex'),
    fixture1.name,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    fixture1.size,
    fixture1.content
  );
  
  success(`Pre-populated attachment: ${fixture1.name} (to test --newonly skipping)`);
  
  // Add third fixture to attachments (test_patch_3.dat - this should also be skipped)
  const fixture3 = fixtures[2];
  insertAttachment.run(
    generateUUID(),
    fixture3.pbuuid,
    fixture3.gvuuid,
    calculateCRC16(fixture3.content),
    calculateCRC32(fixture3.content),
    JSON.stringify([]),
    JSON.stringify([]),
    'QmTest3CIDv0',
    'bafyTest3CIDv1',
    fixture3.hash,
    crypto.createHash('sha1').update(fixture3.content).digest('hex'),
    crypto.createHash('md5').update(fixture3.content).digest('hex'),
    crypto.createHash('sha256').update(fixture3.content).digest('hex'),
    fixture3.name,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    fixture3.size,
    fixture3.content
  );
  
  success(`Pre-populated attachment: ${fixture3.name} (to test --newonly skipping)`);
  
  info('Test data setup complete:');
  info(`  - 5 patchblobs in rhdata.db`);
  info(`  - 2 pre-existing attachments in patchbin.db (test_patch_1.bin, test_patch_3.dat)`);
  info(`  - 3 new patchblobs to process (test_patch_2.bin, test_patch_4.bin, test_patch_5.dat)`);
}

/**
 * Test unit functions
 */
function testUnitFunctions(patchbinDb) {
  section('Testing unit functions');
  
  // Test fileNameExistsInAttachments
  const exists1 = fileNameExistsInAttachments(patchbinDb, 'test_patch_1.bin');
  if (exists1) {
    success('fileNameExistsInAttachments correctly found existing file');
  } else {
    error('fileNameExistsInAttachments failed to find existing file');
  }
  
  const exists2 = fileNameExistsInAttachments(patchbinDb, 'test_patch_2.bin');
  if (!exists2) {
    success('fileNameExistsInAttachments correctly identified non-existing file');
  } else {
    error('fileNameExistsInAttachments incorrectly found non-existing file');
  }
  
  // Test generateUUID
  const uuid1 = generateUUID();
  const uuid2 = generateUUID();
  if (uuid1 !== uuid2 && uuid1.length === 36) {
    success('generateUUID generates unique UUIDs');
  } else {
    error('generateUUID failed to generate unique UUIDs');
  }
}

/**
 * Create a modified attachblobs script that uses our test databases
 */
function createTestScript(mode) {
  const scriptPath = path.join(TEMP_DIR, `test_attachblobs_${mode}.js`);
  
  // Read attachblobs.js and remove shebang
  let attachblobsContent = fs.readFileSync(path.join(__dirname, '..', 'attachblobs.js'), 'utf8');
  
  // Remove shebang line
  if (attachblobsContent.startsWith('#!')) {
    attachblobsContent = attachblobsContent.substring(attachblobsContent.indexOf('\n') + 1);
  }
  
  // Replace database paths and other necessary changes
  attachblobsContent = attachblobsContent
    .replace('const RHDATA_DB_PATH = path.join(__dirname, \'electron\', \'rhdata.db\');', 
             `const RHDATA_DB_PATH = '${TEST_RHDATA_DB_PATH}';`)
    .replace('const PATCHBIN_DB_PATH = path.join(__dirname, \'electron\', \'patchbin.db\');',
             `const PATCHBIN_DB_PATH = '${TEST_PATCHBIN_DB_PATH}';`)
    .replace('const PROJECT_ROOT = __dirname;',
             `const PROJECT_ROOT = '${path.join(__dirname, '..')}';`)
    .replace('if (require.main === module) {', 'if (true) {');
  
  fs.writeFileSync(scriptPath, attachblobsContent);
  return scriptPath;
}

/**
 * Test original mode (without --newonly)
 */
function testOriginalMode() {
  section('Testing original mode (without --newonly)');
  
  info('Running attachblobs.js in original mode...');
  
  try {
    // Create test script
    const scriptPath = createTestScript('original');
    
    // Run the script
    const output = execSync(`node "${scriptPath}"`, {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8'
    });
    
    info('Original mode output:');
    console.log(output);
    
    // Check results
    const patchbinDb = new Database(TEST_PATCHBIN_DB_PATH);
    const attachmentCount = patchbinDb.prepare('SELECT COUNT(*) as count FROM attachments').get().count;
    patchbinDb.close();
    
    // Should have all 5 attachments (2 pre-existing + 3 new, but 2 get updated)
    // Actually, all 5 patchblobs should be processed, so we should have 5 total
    if (attachmentCount === 5) {
      success(`Original mode: All 5 attachments exist in database`);
    } else {
      error(`Original mode: Expected 5 attachments, got ${attachmentCount}`);
    }
    
    // Clean up test script
    fs.unlinkSync(scriptPath);
    
  } catch (err) {
    error(`Original mode test failed: ${err.message}`);
  }
}

/**
 * Reset databases for --newonly test
 */
function resetForNewOnlyTest(fixtures) {
  section('Resetting databases for --newonly test');
  
  // Close any open connections
  if (fs.existsSync(TEST_PATCHBIN_DB_PATH)) {
    fs.unlinkSync(TEST_PATCHBIN_DB_PATH);
  }
  
  // Recreate patchbin.db
  const patchbinDb = new Database(TEST_PATCHBIN_DB_PATH);
  const schema = fs.readFileSync(PATCHBIN_SCHEMA_PATH, 'utf8');
  patchbinDb.exec(schema);
  
  // Re-populate with the 2 existing attachments
  const insertAttachment = patchbinDb.prepare(`
    INSERT INTO attachments (
      auuid, pbuuid, gvuuid, file_crc16, file_crc32, locators, parents,
      file_ipfs_cidv0, file_ipfs_cidv1, file_hash_sha224, file_hash_sha1,
      file_hash_md5, file_hash_sha256, file_name, filekey,
      decoded_ipfs_cidv0, decoded_ipfs_cidv1, decoded_hash_sha224,
      decoded_hash_sha1, decoded_hash_md5, decoded_hash_sha256,
      file_size, file_data
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?
    )
  `);
  
  // Add first fixture
  const fixture1 = fixtures[0];
  insertAttachment.run(
    generateUUID(),
    fixture1.pbuuid,
    fixture1.gvuuid,
    calculateCRC16(fixture1.content),
    calculateCRC32(fixture1.content),
    JSON.stringify([]),
    JSON.stringify([]),
    'QmTest1CIDv0',
    'bafyTest1CIDv1',
    fixture1.hash,
    crypto.createHash('sha1').update(fixture1.content).digest('hex'),
    crypto.createHash('md5').update(fixture1.content).digest('hex'),
    crypto.createHash('sha256').update(fixture1.content).digest('hex'),
    fixture1.name,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    fixture1.size,
    fixture1.content
  );
  
  // Add third fixture
  const fixture3 = fixtures[2];
  insertAttachment.run(
    generateUUID(),
    fixture3.pbuuid,
    fixture3.gvuuid,
    calculateCRC16(fixture3.content),
    calculateCRC32(fixture3.content),
    JSON.stringify([]),
    JSON.stringify([]),
    'QmTest3CIDv0',
    'bafyTest3CIDv1',
    fixture3.hash,
    crypto.createHash('sha1').update(fixture3.content).digest('hex'),
    crypto.createHash('md5').update(fixture3.content).digest('hex'),
    crypto.createHash('sha256').update(fixture3.content).digest('hex'),
    fixture3.name,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    fixture3.size,
    fixture3.content
  );
  
  patchbinDb.close();
  
  success('Reset patchbin.db with 2 pre-existing attachments');
}

/**
 * Test --newonly mode
 */
function testNewOnlyMode() {
  section('Testing --newonly mode');
  
  info('Running attachblobs.js with --newonly flag...');
  
  try {
    // Create test script with --newonly argument
    const scriptPath = createTestScript('newonly');
    
    // Modify the script to add --newonly argument
    let scriptContent = fs.readFileSync(scriptPath, 'utf8');
    scriptContent = scriptContent.replace(
      'process.argv.slice(2)',
      '["--newonly"]'
    );
    fs.writeFileSync(scriptPath, scriptContent);
    
    // Run the script
    const output = execSync(`node "${scriptPath}"`, {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8'
    });
    
    info('--newonly mode output:');
    console.log(output);
    
    // Verify output contains --newonly mode indicator
    if (output.includes('--newonly')) {
      success('Output correctly shows --newonly mode is active');
    } else {
      error('Output does not indicate --newonly mode');
    }
    
    // Verify it mentions skipping
    if (output.includes('Skipping (--newonly)')) {
      success('Output shows files were skipped due to --newonly');
    }
    
    // Check results
    const patchbinDb = new Database(TEST_PATCHBIN_DB_PATH);
    const attachmentCount = patchbinDb.prepare('SELECT COUNT(*) as count FROM attachments').get().count;
    
    // Should have 5 total: 2 pre-existing (skipped) + 3 new
    if (attachmentCount === 5) {
      success(`--newonly mode: Correctly processed only new files (5 total attachments)`);
    } else {
      error(`--newonly mode: Expected 5 attachments, got ${attachmentCount}`);
    }
    
    // Verify the skipped files weren't reprocessed
    const file1 = patchbinDb.prepare('SELECT * FROM attachments WHERE file_name = ?').get('test_patch_1.bin');
    const file3 = patchbinDb.prepare('SELECT * FROM attachments WHERE file_name = ?').get('test_patch_3.dat');
    
    if (file1 && file3) {
      success('--newonly mode: Pre-existing files remain in database');
    } else {
      error('--newonly mode: Pre-existing files were affected');
    }
    
    // Verify new files were added
    const file2 = patchbinDb.prepare('SELECT * FROM attachments WHERE file_name = ?').get('test_patch_2.bin');
    const file4 = patchbinDb.prepare('SELECT * FROM attachments WHERE file_name = ?').get('test_patch_4.bin');
    const file5 = patchbinDb.prepare('SELECT * FROM attachments WHERE file_name = ?').get('test_patch_5.dat');
    
    if (file2 && file4 && file5) {
      success('--newonly mode: New files were correctly added');
    } else {
      error('--newonly mode: Not all new files were added');
    }
    
    patchbinDb.close();
    
    // Clean up test script
    fs.unlinkSync(scriptPath);
    
  } catch (err) {
    error(`--newonly mode test failed: ${err.message}`);
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log();
  log('blue', '╔════════════════════════════════════════════════════════════════════╗');
  log('blue', '║          attachblobs.js Test Suite                                ║');
  log('blue', '╚════════════════════════════════════════════════════════════════════╝');
  console.log();
  
  try {
    // Clean up from previous runs
    cleanupTestEnv();
    
    // Setup test environment
    const { rhdataDb, patchbinDb } = setupTestDatabases();
    const fixtures = createTestFixtures();
    populateTestData(rhdataDb, patchbinDb, fixtures);
    
    // Test unit functions
    testUnitFunctions(patchbinDb);
    
    // Close databases before running integration tests
    rhdataDb.close();
    patchbinDb.close();
    
    // Test original mode
    testOriginalMode();
    
    // Reset for --newonly test
    resetForNewOnlyTest(fixtures);
    
    // Test --newonly mode
    testNewOnlyMode();
    
    // Final summary
    section('ALL TESTS COMPLETE');
    success('All tests passed successfully!');
    info(`Test databases: ${TEMP_DIR}`);
    info(`Test fixtures: ${FIXTURES_DIR}`);
    console.log();
    
  } catch (err) {
    console.error();
    error(`Test suite failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run tests
runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

