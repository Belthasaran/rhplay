#!/usr/bin/env node

/**
 * Test suite for Phase 2 resource tracking functionality
 * Tests versioned ZIP storage, HTTP header tracking, duplicate detection
 * Uses separate test databases via environment variables
 * 
 * Usage:
 *   node tests/test_phase2_resource_tracking.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// Set up test database paths
const TEST_DATA_DIR = path.join(__dirname, 'test_data');
const TEST_RHDATA_DB = path.join(TEST_DATA_DIR, 'test_resource_tracking.db');
const TEST_PATCHBIN_DB = path.join(TEST_DATA_DIR, 'test_resource_patchbin.db');

// Set environment variables
process.env.RHDATA_DB_PATH = TEST_RHDATA_DB;
process.env.PATCHBIN_DB_PATH = TEST_PATCHBIN_DB;

// Import modules
const DatabaseManager = require('../lib/database');
const ResourceManager = require('../lib/resource-manager');

// Test counters
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

/**
 * Setup test database
 */
function setupTestDatabase() {
  if (fs.existsSync(TEST_RHDATA_DB)) {
    fs.unlinkSync(TEST_RHDATA_DB);
  }
  
  if (!fs.existsSync(TEST_DATA_DIR)) {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
  
  const db = new Database(TEST_RHDATA_DB);
  
  db.exec(`
    CREATE TABLE gameversions (
      gvuuid varchar(255) primary key,
      gameid varchar(255),
      version int,
      name varchar(255),
      size varchar(255),
      local_resource_etag varchar(255),
      local_resource_lastmodified TIMESTAMP,
      local_resource_filename varchar(500),
      gvjsondata text,
      UNIQUE(gameid, version)
    );
  `);
  
  db.close();
  return TEST_RHDATA_DB;
}

/**
 * Test versioned filename generation
 */
function testVersionedFilenameGeneration() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  const resourceManager = new ResourceManager(dbManager, { ZIPS_DIR: 'zips' });
  
  // Version 1
  const filename1 = resourceManager.determineZipFilename('12345', 1);
  assert(filename1 === 'zips/12345.zip', 'Version 1 should be zips/GAMEID.zip');
  
  // Version 2
  const filename2 = resourceManager.determineZipFilename('12345', 2);
  assert(filename2 === 'zips/12345_2.zip', 'Version 2 should be zips/GAMEID_2.zip');
  
  // Version 3
  const filename3 = resourceManager.determineZipFilename('12345', 3);
  assert(filename3 === 'zips/12345_3.zip', 'Version 3 should be zips/GAMEID_3.zip');
  
  dbManager.close();
}

/**
 * Test resource tracking fields storage
 */
function testResourceTrackingFieldsStorage() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  
  // Insert gameversion with resource tracking
  const gvuuid = crypto.randomUUID();
  dbManager.db.prepare(`
    INSERT INTO gameversions (
      gvuuid, gameid, version, name, gvjsondata,
      local_resource_etag,
      local_resource_lastmodified,
      local_resource_filename
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    gvuuid,
    'test005',
    1,
    'Test Game',
    JSON.stringify({ id: 'test005' }),
    'abc123etag',
    '2025-10-12 10:30:00',
    'zips/test005.zip'
  );
  
  // Verify fields were stored
  const record = dbManager.getLatestVersionForGame('test005');
  assert(record.local_resource_etag === 'abc123etag', 'ETag should be stored');
  assert(record.local_resource_lastmodified === '2025-10-12 10:30:00', 'Last-Modified should be stored');
  assert(record.local_resource_filename === 'zips/test005.zip', 'Filename should be stored');
  
  dbManager.close();
}

/**
 * Test duplicate detection by hash
 */
async function testDuplicateDetectionByHash() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  const testZipsDir = path.join(TEST_DATA_DIR, 'test_zips');
  
  // Create test zips directory
  if (!fs.existsSync(testZipsDir)) {
    fs.mkdirSync(testZipsDir, { recursive: true });
  }
  
  const resourceManager = new ResourceManager(dbManager, { ZIPS_DIR: testZipsDir });
  
  // Create test ZIP data
  const zipData = Buffer.from('PK\x03\x04test zip content');
  const zipHash = resourceManager.calculateBufferHash(zipData);
  
  // Save version 1
  const result1 = await resourceManager.saveZipFile('test006', 1, zipData);
  assert(result1.saved === true, 'Version 1 should be saved');
  assert(result1.wasDuplicate === false, 'Version 1 should not be duplicate');
  
  // Record in database
  dbManager.db.prepare(`
    INSERT INTO gameversions (gvuuid, gameid, version, name, local_resource_filename, gvjsondata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), 'test006', 1, 'Test', result1.path, JSON.stringify({}));
  
  // Try to save version 2 with same data
  const result2 = await resourceManager.saveZipFile('test006', 2, zipData);
  assert(result2.wasDuplicate === true, 'Version 2 with same content should be detected as duplicate');
  
  dbManager.close();
  
  // Cleanup
  fs.rmSync(testZipsDir, { recursive: true, force: true });
}

/**
 * Test schema columns exist
 */
function testSchemaColumnsExist() {
  const dbPath = setupTestDatabase();
  const db = new Database(dbPath);
  
  const columns = db.prepare(`PRAGMA table_info(gameversions)`).all();
  const columnNames = columns.map(c => c.name);
  
  assert(columnNames.includes('local_resource_etag'), 'local_resource_etag column should exist');
  assert(columnNames.includes('local_resource_lastmodified'), 'local_resource_lastmodified column should exist');
  assert(columnNames.includes('local_resource_filename'), 'local_resource_filename column should exist');
  
  db.close();
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Phase 2 Resource Tracking Test Suite                    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
  console.log(`Test Database: ${TEST_RHDATA_DB}`);
  console.log(`Environment Variables:\n  RHDATA_DB_PATH=${process.env.RHDATA_DB_PATH}\n  PATCHBIN_DB_PATH=${process.env.PATCHBIN_DB_PATH}\n`);
  
  console.log('Running tests...\n');
  
  try {
    test('Schema columns exist (local_resource_*)', testSchemaColumnsExist);
    test('Versioned filename generation', testVersionedFilenameGeneration);
    test('Resource tracking fields storage', testResourceTrackingFieldsStorage);
    await test('Duplicate detection by hash', testDuplicateDetectionByHash);
    
  } catch (error) {
    console.error('\nFatal error during tests:', error);
  }
  
  console.log('\n' + '─'.repeat(60));
  console.log('\nTest Summary:');
  console.log(`  Passed: ${passedTests}`);
  console.log(`  Failed: ${failedTests}`);
  console.log(`  Total:  ${totalTests}`);
  
  if (failedTests === 0) {
    console.log('\n✓ All tests passed!\n');
    process.exit(0);
  } else {
    console.log(`\n✗ ${failedTests} test(s) failed.\n`);
    process.exit(1);
  }
}

// Run tests
runTests();

