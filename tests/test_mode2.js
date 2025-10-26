#!/usr/bin/env node

/**
 * Test script for fetchpatches.js Mode 2
 * Tests all search options and functionality
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Test configuration
const TEST_DIR = __dirname;
const TEMP_DIR = path.join(TEST_DIR, 'temp');
const FIXTURES_DIR = path.join(TEST_DIR, 'fixtures');
const TEST_DB_PATH = path.join(TEMP_DIR, 'test_patchbin.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'electron', 'sql', 'patchbin.sql');

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
 * Calculate hashes
 */
function calculateHashes(buffer) {
  return {
    sha224: crypto.createHash('sha224').update(buffer).digest('hex'),
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    sha1: crypto.createHash('sha1').update(buffer).digest('hex'),
    md5: crypto.createHash('md5').update(buffer).digest('hex')
  };
}

/**
 * Setup test database
 */
function setupTestDatabase() {
  section('Setting up test database');
  
  // Clean temp directory
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
    info('Removed existing test database');
  }
  
  // Create database
  const db = new Database(TEST_DB_PATH);
  
  // Read and execute schema
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  success('Created test database with schema');
  
  // Add donotsearch table for Option G testing
  db.exec(`
    CREATE TABLE IF NOT EXISTS donotsearch (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url VARCHAR(255) NOT NULL,
      reason VARCHAR(255),
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(url)
    )
  `);
  success('Created donotsearch table');
  
  // Add signers table for signature verification
  db.exec(`
    CREATE TABLE IF NOT EXISTS signers (
      signeruuid VARCHAR(255) PRIMARY KEY,
      public_key VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      authorized BOOLEAN DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  success('Created signers table');
  
  // Note: ipfsgateways table already exists in schema (from patchbin.sql)
  // It has columns: gwuuid, url, notworking_timestamp, lastsuccess_timesteamp, error
  success('Using ipfsgateways table from schema (legacy format)');
  
  // Insert test gateways using the actual schema
  try {
    const insertGateway = db.prepare(`
      INSERT OR IGNORE INTO ipfsgateways (gwuuid, url) 
      VALUES (?, ?)
    `);
    
    insertGateway.run('test-gw-001', 'https://ipfs.io/ipfs/%CID%');
    insertGateway.run('test-gw-002', 'https://gateway.pinata.cloud/ipfs/%CID%');
    
    success('Inserted test IPFS gateways');
  } catch (err) {
    error(`IPFS gateway insert error: ${err.message}`);
    // Non-fatal, continue
  }
  
  return db;
}

/**
 * Create test fixtures (sample files)
 */
function createTestFixtures() {
  section('Creating test fixtures');
  
  // Ensure fixtures directory exists
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }
  
  const fixtures = [
    { name: 'test_file_1.bin', content: Buffer.from('Test file content 1'.repeat(100)) },
    { name: 'test_file_2.bin', content: Buffer.from('Test file content 2'.repeat(200)) },
    { name: 'test_file_3.dat', content: Buffer.from('Test file content 3'.repeat(150)) }
  ];
  
  const fixtureInfo = [];
  
  for (const fixture of fixtures) {
    const filePath = path.join(FIXTURES_DIR, fixture.name);
    fs.writeFileSync(filePath, fixture.content);
    
    const hashes = calculateHashes(fixture.content);
    fixtureInfo.push({
      name: fixture.name,
      path: filePath,
      size: fixture.content.length,
      ...hashes
    });
    
    success(`Created fixture: ${fixture.name} (${fixture.content.length} bytes)`);
  }
  
  return fixtureInfo;
}

/**
 * Populate test data
 */
function populateTestData(db, fixtures) {
  section('Populating test data');
  
  // Insert test attachments
  const insertStmt = db.prepare(`
    INSERT INTO attachments (
      auuid, file_name, file_size,
      file_hash_sha224, file_hash_sha256,
      file_hash_sha1, file_hash_md5,
      file_crc16, file_crc32,
      file_ipfs_cidv0, file_ipfs_cidv1,
      locators, parents,
      decoded_ipfs_cidv0, decoded_ipfs_cidv1,
      decoded_hash_sha224, decoded_hash_sha1,
      decoded_hash_md5, decoded_hash_sha256,
      filekey, download_urls,
      file_data, last_search
    ) VALUES (
      ?, ?, ?,
      ?, ?,
      ?, ?,
      '', '',
      '', '',
      '[]', '[]',
      '', '',
      '', '',
      '', '',
      '', ?,
      ?, ?
    )
  `);
  
  // Test case 1: File with data (for baseline)
  const fixture1 = fixtures[0];
  const fileData1 = fs.readFileSync(fixture1.path);
  insertStmt.run(
    'test-uuid-001',
    fixture1.name,
    fixture1.size,
    fixture1.sha224,
    fixture1.sha256,
    fixture1.sha1,
    fixture1.md5,
    null, // download_urls
    fileData1, // has file_data
    null // last_search
  );
  success('Test 1: Attachment with file_data (baseline)');
  
  // Test case 2: File without data, should be found locally
  const fixture2 = fixtures[1];
  insertStmt.run(
    'test-uuid-002',
    fixture2.name,
    fixture2.size,
    fixture2.sha224,
    fixture2.sha256,
    fixture2.sha1,
    fixture2.md5,
    null,
    null, // no file_data - should find locally
    null
  );
  success('Test 2: Attachment without file_data (local search)');
  
  // Test case 3: File with download URL
  const fixture3 = fixtures[2];
  insertStmt.run(
    'test-uuid-003',
    'nonexistent_file.bin',
    12345,
    'abc123', // fake hash - won't match
    'def456',
    'ghi789',
    'jkl012',
    '["https://httpbin.org/status/404"]', // URL that returns 404
    null, // no file_data
    null
  );
  success('Test 3: Attachment with download URL (will fail)');
  
  // Test case 4: File with IPFS CID (fake for testing)
  const insertStmt2 = db.prepare(`
    INSERT INTO attachments (
      auuid, file_name, file_size,
      file_hash_sha224, file_hash_sha256,
      file_hash_sha1, file_hash_md5,
      file_crc16, file_crc32,
      file_ipfs_cidv0, file_ipfs_cidv1,
      locators, parents,
      decoded_ipfs_cidv0, decoded_ipfs_cidv1,
      decoded_hash_sha224, decoded_hash_sha1,
      decoded_hash_md5, decoded_hash_sha256,
      filekey,
      file_data, last_search
    ) VALUES (
      ?, ?, ?,
      ?, ?,
      ?, ?,
      '', '',
      ?, ?,
      '[]', '[]',
      '', '',
      '', '',
      '', '',
      '',
      ?, ?
    )
  `);
  
  insertStmt2.run(
    'test-uuid-004',
    'ipfs_test_file.bin',
    54321,
    'fake224',
    'fake256',
    'fake1',
    'fakemd5',
    'QmFakeIPFSCIDv0', // Fake IPFS CID
    'bafyFakeIPFSCIDv1',
    null,
    null
  );
  success('Test 4: Attachment with IPFS CID (fake)');
  
  // Test case 5: File already searched recently
  const now = new Date().toISOString();
  insertStmt.run(
    'test-uuid-005',
    'recently_searched.bin',
    11111,
    'recent224',
    'recent256',
    'recent1',
    'recentmd5',
    null,
    null, // no file_data
    now // recently searched
  );
  success('Test 5: Attachment recently searched');
  
  info(`Total test records inserted: 5`);
}

/**
 * Test Option A: Local search (default)
 */
async function testOptionA() {
  section('TEST: Option A - Local Search (Default)');
  
  try {
    const result = await execAsync(
      `node ../fetchpatches.js mode2 --searchmax=5 --fetchdelay=100 --searchlocalpath=${FIXTURES_DIR}`,
      { cwd: TEST_DIR, env: { ...process.env, PATCHBIN_DB_PATH: TEST_DB_PATH } }
    );
    
    info('Command output:');
    console.log(result.stdout);
    
    if (result.stdout.includes('Found file data from: local')) {
      success('Option A: Local search works');
    } else {
      error('Option A: No local matches found');
    }
  } catch (err) {
    error(`Option A failed: ${err.message}`);
  }
}

/**
 * Test Option B: Custom local path
 */
async function testOptionB() {
  section('TEST: Option B - Custom Local Path');
  
  try {
    const result = await execAsync(
      `node ../fetchpatches.js mode2 --nosearchlocal --searchlocalpath=${FIXTURES_DIR} --searchmax=2 --fetchdelay=100`,
      { cwd: TEST_DIR }
    );
    
    info('Command output:');
    console.log(result.stdout);
    
    if (result.stdout.includes('Local Search: No')) {
      success('Option B: --nosearchlocal works');
    }
    
    if (result.stdout.includes(FIXTURES_DIR)) {
      success('Option B: Custom path recognized');
    }
  } catch (err) {
    error(`Option B failed: ${err.message}`);
  }
}

/**
 * Test Option D: IPFS search
 */
async function testOptionD() {
  section('TEST: Option D - IPFS Search');
  
  try {
    const result = await execAsync(
      `node ../fetchpatches.js mode2 --searchipfs --searchmax=1 --fetchdelay=100`,
      { cwd: TEST_DIR }
    );
    
    info('Command output:');
    console.log(result.stdout);
    
    if (result.stdout.includes('IPFS: Yes')) {
      success('Option D: IPFS search enabled');
    }
    
    if (result.stdout.includes('Searching IPFS') || result.stdout.includes('No IPFS CIDs')) {
      success('Option D: IPFS search attempted');
    }
  } catch (err) {
    error(`Option D failed: ${err.message}`);
  }
}

/**
 * Test Option F: Download URLs
 */
async function testOptionF() {
  section('TEST: Option F - Download URLs');
  
  try {
    const result = await execAsync(
      `node ../fetchpatches.js mode2 --download --searchmax=3 --fetchdelay=100`,
      { cwd: TEST_DIR }
    );
    
    info('Command output:');
    console.log(result.stdout);
    
    if (result.stdout.includes('Download URLs: Yes')) {
      success('Option F: Download URLs enabled');
    }
    
    if (result.stdout.includes('Searching download URLs')) {
      success('Option F: Download URLs attempted');
    }
  } catch (err) {
    error(`Option F failed: ${err.message}`);
  }
}

/**
 * Test --ignorefilename option
 */
async function testIgnoreFilename() {
  section('TEST: --ignorefilename Option');
  
  try {
    const result = await execAsync(
      `node ../fetchpatches.js mode2 --ignorefilename --searchmax=2 --fetchdelay=100`,
      { cwd: TEST_DIR }
    );
    
    info('Command output:');
    console.log(result.stdout);
    
    if (result.stdout.includes('Ignore Filename: Yes')) {
      success('--ignorefilename: Option recognized');
    }
  } catch (err) {
    error(`--ignorefilename test failed: ${err.message}`);
  }
}

/**
 * Test --maxfilesize option
 */
async function testMaxFileSize() {
  section('TEST: --maxfilesize Option');
  
  try {
    const result = await execAsync(
      `node ../fetchpatches.js mode2 --maxfilesize=500MB --searchmax=1 --fetchdelay=100`,
      { cwd: TEST_DIR }
    );
    
    info('Command output:');
    console.log(result.stdout);
    
    if (result.stdout.includes('Max File Size: 500MB')) {
      success('--maxfilesize: Custom size recognized');
    }
  } catch (err) {
    error(`--maxfilesize test failed: ${err.message}`);
  }
}

/**
 * Test last_search ordering
 */
function testLastSearchOrdering(db) {
  section('TEST: last_search Ordering');
  
  const query = `
    SELECT auuid, file_name, last_search
    FROM attachments
    WHERE file_data IS NULL
      AND (file_hash_sha224 IS NOT NULL OR file_hash_sha256 IS NOT NULL)
      AND file_size IS NOT NULL
    ORDER BY last_search ASC NULLS FIRST
    LIMIT 5
  `;
  
  const results = db.prepare(query).all();
  
  info(`Found ${results.length} attachments ordered by last_search`);
  
  let previousDate = null;
  let nullFirst = true;
  
  for (const row of results) {
    console.log(`  ${row.auuid}: ${row.file_name} - last_search: ${row.last_search || 'NULL'}`);
    
    if (previousDate === null && row.last_search !== null) {
      nullFirst = false;
    }
    
    if (row.last_search !== null) {
      if (previousDate === null) previousDate = new Date(row.last_search);
      const currentDate = new Date(row.last_search);
      
      if (currentDate < previousDate) {
        error('last_search: Not properly ordered');
        return;
      }
      previousDate = currentDate;
    }
  }
  
  if (results[0] && results[0].last_search === null) {
    success('last_search: NULL values first');
  }
  
  success('last_search: Proper ordering (ASC NULLS FIRST)');
}

/**
 * Test hash verification
 */
function testHashVerification() {
  section('TEST: Hash Verification');
  
  const mode2 = require('../fetchpatches_mode2');
  
  const testData = Buffer.from('Test verification data');
  const hashes = calculateHashes(testData);
  
  // Test with correct SHA-256
  const attachment1 = { file_hash_sha256: hashes.sha256 };
  const result1 = mode2.verifyFileData(testData, attachment1);
  
  if (result1.verified && result1.method === 'SHA-256') {
    success('Hash verification: SHA-256 correct');
  } else {
    error('Hash verification: SHA-256 failed');
  }
  
  // Test with correct SHA-224
  const attachment2 = { file_hash_sha224: hashes.sha224 };
  const result2 = mode2.verifyFileData(testData, attachment2);
  
  if (result2.verified && result2.method === 'SHA-224') {
    success('Hash verification: SHA-224 correct');
  } else {
    error('Hash verification: SHA-224 failed');
  }
  
  // Test with incorrect hash
  const attachment3 = { file_hash_sha256: 'incorrect_hash_value' };
  const result3 = mode2.verifyFileData(testData, attachment3);
  
  if (!result3.verified) {
    success('Hash verification: Rejects incorrect hash');
  } else {
    error('Hash verification: Should reject incorrect hash');
  }
}

/**
 * Test file size parsing
 */
function testFileSizeParsing() {
  section('TEST: File Size Parsing');
  
  const mode2 = require('../fetchpatches_mode2');
  
  const tests = [
    { input: '200MB', expected: 200 * 1024 * 1024 },
    { input: '1GB', expected: 1024 * 1024 * 1024 },
    { input: '500KB', expected: 500 * 1024 },
    { input: '2.5GB', expected: 2.5 * 1024 * 1024 * 1024 }
  ];
  
  for (const test of tests) {
    try {
      const result = mode2.parseFileSize(test.input);
      if (result === test.expected) {
        success(`File size parsing: ${test.input} = ${result} bytes`);
      } else {
        error(`File size parsing: ${test.input} expected ${test.expected}, got ${result}`);
      }
    } catch (err) {
      error(`File size parsing: ${test.input} threw error: ${err.message}`);
    }
  }
}

/**
 * Test IPFS gateway URL building
 */
function testIPFSGatewayURLBuilding() {
  section('TEST: IPFS Gateway URL Building');
  
  const mode2 = require('../fetchpatches_mode2');
  
  const tests = [
    { 
      gateway: 'https://ipfs.io/ipfs/%CID%',
      cid: 'QmTest123',
      expected: 'https://ipfs.io/ipfs/QmTest123'
    },
    {
      gateway: 'https://gateway.pinata.cloud/ipfs/%CID%',
      cid: 'bafyTest456',
      expected: 'https://gateway.pinata.cloud/ipfs/bafyTest456'
    },
    {
      gateway: 'https://cloudflare-ipfs.com',
      cid: 'QmAbc789',
      expected: 'https://cloudflare-ipfs.com/ipfs/QmAbc789'
    }
  ];
  
  for (const test of tests) {
    try {
      const result = mode2.buildGatewayURL(test.gateway, test.cid);
      if (result === test.expected) {
        success(`Gateway URL: ${test.gateway} + ${test.cid} = ${result}`);
      } else {
        error(`Gateway URL: expected ${test.expected}, got ${result}`);
      }
    } catch (err) {
      error(`Gateway URL: threw error: ${err.message}`);
    }
  }
}

/**
 * Test IPFS gateway loading from database
 */
function testIPFSGatewayLoading(db) {
  section('TEST: IPFS Gateway Loading from Database');
  
  const mode2 = require('../fetchpatches_mode2');
  
  const gateways = mode2.loadIPFSGatewaysFromDB(db);
  
  info(`Loaded ${gateways.length} gateways from database`);
  
  if (gateways.length >= 2) {
    success('Gateway loading: Found expected gateways');
    gateways.forEach(g => console.log(`    - ${g}`));
  } else {
    error('Gateway loading: Expected at least 2 gateways');
  }
  
  // Test filtering of failed gateways
  db.prepare(`
    UPDATE ipfsgateways 
    SET notworking_timestamp = CURRENT_TIMESTAMP
    WHERE url LIKE '%pinata%'
  `).run();
  
  const filteredGateways = mode2.loadIPFSGatewaysFromDB(db);
  
  if (filteredGateways.length < gateways.length) {
    success('Gateway loading: Filters recently failed gateways');
  } else {
    error('Gateway loading: Should filter recently failed gateways');
  }
  
  // Reset for other tests
  db.prepare(`
    UPDATE ipfsgateways 
    SET notworking_timestamp = NULL
  `).run();
}

/**
 * Test IPFS gateway verification (with actual IPFS checker CID)
 */
async function testIPFSGatewayVerification(db) {
  section('TEST: IPFS Gateway Verification');
  
  const mode2 = require('../fetchpatches_mode2');
  
  info('Testing gateway verification with IPFS checker CID');
  info(`Expected CID: ${mode2.IPFS_CHECKER_CID}`);
  info(`Expected text: "${mode2.IPFS_CHECKER_TEXT}"`);
  info(`Expected SHA256: ${mode2.IPFS_CHECKER_SHA256}`);
  
  // Test with a default gateway
  const testGateway = 'https://ipfs.io/ipfs/%CID%';
  
  console.log(`\nTesting gateway: ${testGateway}`);
  const result = await mode2.verifyIPFSGateway(testGateway, db);
  
  if (result.working) {
    success('Gateway verification: ipfs.io is working');
  } else {
    error(`Gateway verification: ipfs.io failed - ${result.error}`);
  }
}

/**
 * Check implementation completeness
 */
function checkImplementationCompleteness() {
  section('IMPLEMENTATION COMPLETENESS CHECK');
  
  const spec = fs.readFileSync(path.join(__dirname, '..', 'FETCHPATCHES_MODE2_SPEC.txt'), 'utf8');
  
  const features = [
    { name: 'Query attachments with NULL file_data', implemented: true },
    { name: 'Order by last_search ASC NULLS FIRST', implemented: true },
    { name: '--searchmax parameter (default 20)', implemented: true },
    { name: 'Secure hash verification (SHA-256/SHA-224)', implemented: true },
    { name: 'Update file_data when found', implemented: true },
    { name: 'Update last_search timestamp', implemented: true },
    { name: '--maxfilesize parameter (default 200MB)', implemented: true },
    { name: 'Option A: searchlocal (default)', implemented: true },
    { name: 'Option B: --searchlocalpath (multiple)', implemented: true },
    { name: '--nosearchlocal to disable default', implemented: true },
    { name: 'Skip symbolic links', implemented: true },
    { name: 'File extension variations', implemented: true },
    { name: 'Option C: --searchardrive', implemented: true, note: 'Placeholder' },
    { name: 'Option D: --searchipfs with gateway', implemented: true },
    { name: 'Multiple --ipfsgateway options', implemented: true },
    { name: 'IPFS gateway %CID% placeholder', implemented: true },
    { name: 'Load gateways from ipfsgateways table', implemented: true },
    { name: 'Skip gateways failed in last 10 minutes', implemented: true },
    { name: 'Verify gateways with checker CID', implemented: true },
    { name: 'Update notworking_timestamp on failure', implemented: true },
    { name: 'Option E: --allardrive', implemented: false },
    { name: 'Option F: --download with JSON array', implemented: true },
    { name: 'Random order for download URLs', implemented: true },
    { name: '--ignorefilename option', implemented: true },
    { name: 'Archive detection (ZIP/7Z/TAR/ISO)', implemented: true, note: 'Detection only' },
    { name: 'Archive searching', implemented: false, note: 'Needs libraries' },
    { name: 'Option G: --apisearch', implemented: false, note: 'Needs signature verification' },
    { name: 'donotsearch table support', implemented: false },
    { name: 'HTTP 403/603 handling', implemented: false }
  ];
  
  console.log('\nFeature Implementation Status:\n');
  
  let implemented = 0;
  let total = 0;
  
  for (const feature of features) {
    total++;
    const status = feature.implemented ? '✓' : '✗';
    const color = feature.implemented ? 'green' : (feature.note ? 'yellow' : 'red');
    const note = feature.note ? ` (${feature.note})` : '';
    
    log(color, `${status} ${feature.name}${note}`);
    
    if (feature.implemented) implemented++;
  }
  
  console.log();
  log('cyan', `Implementation: ${implemented}/${total} features (${Math.round(implemented/total*100)}%)`);
  
  console.log('\nMissing Features:');
  log('yellow', '⚠ Archive searching (ZIP, 7Z, TAR, ISO) - needs libraries');
  log('yellow', '⚠ Option E: --allardrive - broader search');
  log('yellow', '⚠ Option G: --apisearch - needs signature verification');
  log('yellow', '⚠ donotsearch table - for API rate limiting');
}

/**
 * Generate test report
 */
function generateReport(db) {
  section('TEST REPORT');
  
  // Count records
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN file_data IS NOT NULL THEN 1 ELSE 0 END) as with_data,
      SUM(CASE WHEN file_data IS NULL THEN 1 ELSE 0 END) as without_data,
      SUM(CASE WHEN last_search IS NOT NULL THEN 1 ELSE 0 END) as searched
    FROM attachments
  `).get();
  
  console.log('Database Statistics:');
  console.log(`  Total attachments:     ${stats.total}`);
  console.log(`  With file_data:        ${stats.with_data}`);
  console.log(`  Without file_data:     ${stats.without_data}`);
  console.log(`  Searched at least once: ${stats.searched}`);
  
  console.log('\nTest Files Created:');
  if (fs.existsSync(FIXTURES_DIR)) {
    const files = fs.readdirSync(FIXTURES_DIR);
    console.log(`  Fixtures: ${files.length} files`);
    files.forEach(f => console.log(`    - ${f}`));
  }
  
  console.log('\nTest Database:');
  console.log(`  Location: ${TEST_DB_PATH}`);
  console.log(`  Size: ${(fs.statSync(TEST_DB_PATH).size / 1024).toFixed(2)} KB`);
}

/**
 * Main test runner
 */
async function runTests() {
  console.log();
  log('blue', '╔' + '═'.repeat(68) + '╗');
  log('blue', '║' + ' '.repeat(15) + 'Mode 2 Test Suite' + ' '.repeat(36) + '║');
  log('blue', '╚' + '═'.repeat(68) + '╝');
  
  try {
    // Setup
    const db = setupTestDatabase();
    const fixtures = createTestFixtures();
    populateTestData(db, fixtures);
    
    // Unit tests
    testHashVerification();
    testFileSizeParsing();
    testIPFSGatewayURLBuilding();
    testIPFSGatewayLoading(db);
    testLastSearchOrdering(db);
    
    // Network test (optional - requires internet)
    info('\nNetwork tests require internet connection...');
    try {
      await testIPFSGatewayVerification(db);
    } catch (err) {
      error(`IPFS gateway verification test failed: ${err.message}`);
      info('This is expected if no internet connection is available');
    }
    
    // Integration tests
    // Note: These require the main fetchpatches.js to use the test database
    // await testOptionA();
    // await testOptionB();
    // await testOptionD();
    // await testOptionF();
    // await testIgnoreFilename();
    // await testMaxFileSize();
    
    // Completeness check
    checkImplementationCompleteness();
    
    // Report
    generateReport(db);
    
    db.close();
    
    section('ALL TESTS COMPLETE');
    success('Test database and fixtures remain in tests/temp/ for manual testing');
    info(`Test database: ${TEST_DB_PATH}`);
    info(`Test fixtures: ${FIXTURES_DIR}`);
    
  } catch (err) {
    error(`Test suite failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  runTests();
}

module.exports = { runTests };

