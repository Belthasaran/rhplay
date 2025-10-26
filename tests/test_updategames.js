#!/usr/bin/env node

/**
 * Test suite for updategames.js 
 * Tests for issues found in loaddata.js that should also be handled by updategames
 * 
 * Usage:
 *   node tests/test_updategames.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// Test configuration
const TEST_DB_PATH = path.join(__dirname, 'test_data', 'test_updategames.db');
const TEST_DATA_DIR = path.join(__dirname, 'test_data');

// Import the functions we need to test
const RecordCreator = require('../lib/record-creator');
const DatabaseManager = require('../lib/database');

// Test counters
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

/**
 * Test helper to track results
 */
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

/**
 * Assert helper
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

/**
 * Setup test database with schema
 */
function setupTestDatabase() {
  // Remove existing test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  
  // Ensure test_data directory exists
  if (!fs.existsSync(TEST_DATA_DIR)) {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
  
  const db = new Database(TEST_DB_PATH);
  
  // Create schema (from rhdata.sql with additions)
  db.exec(`
    CREATE TABLE IF NOT EXISTS gameversions (
      gvuuid varchar(255) primary key DEFAULT (lower(hex(randomblob(16)))),
      section varchar(255),
      gameid  varchar(255),
      version int,
      removed int default 0,
      obsoleted int default 0, 
      gametype varchar(255),
      name    varchar(255) NOT NULL,
      time    varchar(255),
      added   varchar(255),
      moderated varchar(255),
      author  varchar(255),
      authors varchar(255),
      submitter varchar(255),
      demo varchar(255),
      featured varchar(255),
      length varchar(255),
      difficulty varchar(255),
      url varchar(255),
      download_url varchar(255),  
      name_href varchar(255),
      author_href varchar(255),
      obsoleted_by varchar(255),
      patchblob1_name varchar(255),
      pat_sha224 varchar(255),
      size varchar(255),
      description text,
      gvjsondata text,
      gvchange_attributes text,
      gvchanges text,
      tags text,
      tags_href text,
      fields_type VARCHAR(255),
      raw_difficulty VARCHAR(255),
      combinedtype VARCHAR(255),
      legacy_type VARCHAR(255),
      local_resource_etag VARCHAR(255),
      local_resource_lastmodified TIMESTAMP,
      local_resource_filename VARCHAR(500),
      gvimport_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      siglistuuid varchar(255),
      UNIQUE(gameid, version)
    );

    CREATE TABLE IF NOT EXISTS patchblobs (
      pbuuid varchar(255) primary key DEFAULT (lower(hex(randomblob(16)))),
      gvuuid varchar(255) REFERENCES gameversions (gvuuid),
      patch_name varchar(255),
      pat_sha1 varchar(255),
      pat_sha224 varchar(255),
      pat_shake_128 varchar(255),
      patchblob1_key varchar(255),
      patchblob1_name varchar(255),
      patchblob1_sha224 varchar(255),
      result_sha1 varchar(255),
      result_sha224 varchar(255),
      result_shake1 varchar(255),
      pbjsondata text,
      pblobdata blob,
      pbimport_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      siglistuuid varchar(255),
      UNIQUE(patchblob1_name)
    );
    
    CREATE TABLE IF NOT EXISTS patchblobs_extended (
      pbuuid varchar(255) primary key REFERENCES patchblobs(pbuuid),
      patch_filename varchar(500),
      patch_type varchar(10),
      is_primary BOOLEAN DEFAULT 0,
      zip_source varchar(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  db.close();
  
  return TEST_DB_PATH;
}

/**
 * Test normalizeValueForSQLite function (indirectly through record creation)
 */
function testBooleanNormalization() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  
  // Create test metadata with boolean values
  const metadata = {
    id: 'test001',
    name: 'Test Game',
    moderated: true,
    featured: false,
    difficulty: 'Easy'
  };
  
  const primaryPatch = {
    pat_sha224: 'abc123'
  };
  
  const primaryBlobData = {
    patchblob1_name: 'test_blob'
  };
  
  const patchbinDbPath = dbPath; // Same DB for test
  const config = {};
  
  const recordCreator = new RecordCreator(dbManager, patchbinDbPath, config);
  
  // Should not throw SQLite binding error
  const gvuuid = recordCreator.createGameVersionRecord(
    'test001',
    metadata,
    primaryPatch,
    primaryBlobData
  );
  
  // Verify the record was created
  const result = dbManager.db.prepare(`
    SELECT * FROM gameversions WHERE gameid = 'test001'
  `).get();
  
  assert(result !== undefined, 'Record should be created');
  assert(result.moderated === '1', 'Boolean true should be stored as "1"');
  assert(result.featured === '0', 'Boolean false should be stored as "0"');
  
  recordCreator.close();
  dbManager.close();
}

/**
 * Test fields_type extraction
 */
function testFieldsTypeExtraction() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  
  const metadata = {
    id: 'test002',
    name: 'Test Kaizo Game',
    difficulty: 'Advanced',
    fields: {
      type: 'Kaizo'
    }
  };
  
  const primaryPatch = { pat_sha224: 'def456' };
  const primaryBlobData = { patchblob1_name: 'test_blob2' };
  const patchbinDbPath = dbPath;
  const config = {};
  
  const recordCreator = new RecordCreator(dbManager, patchbinDbPath, config);
  
  recordCreator.createGameVersionRecord(
    'test002',
    metadata,
    primaryPatch,
    primaryBlobData
  );
  
  const result = dbManager.db.prepare(`
    SELECT fields_type FROM gameversions WHERE gameid = 'test002'
  `).get();
  
  assert(result.fields_type === 'Kaizo', 'fields_type should be extracted from fields.type');
  
  recordCreator.close();
  dbManager.close();
}

/**
 * Test raw_difficulty extraction
 */
function testRawDifficultyExtraction() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  
  const metadata = {
    id: 'test003',
    name: 'Test Game with Raw Difficulty',
    difficulty: 'Advanced',
    raw_fields: {
      difficulty: 'diff_4'
    }
  };
  
  const primaryPatch = { pat_sha224: 'ghi789' };
  const primaryBlobData = { patchblob1_name: 'test_blob3' };
  const patchbinDbPath = dbPath;
  const config = {};
  
  const recordCreator = new RecordCreator(dbManager, patchbinDbPath, config);
  
  recordCreator.createGameVersionRecord(
    'test003',
    metadata,
    primaryPatch,
    primaryBlobData
  );
  
  const result = dbManager.db.prepare(`
    SELECT raw_difficulty FROM gameversions WHERE gameid = 'test003'
  `).get();
  
  assert(result.raw_difficulty === 'diff_4', 'raw_difficulty should be extracted');
  
  recordCreator.close();
  dbManager.close();
}

/**
 * Test combinedtype computation
 */
function testCombinedTypeComputation() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  
  const metadata = {
    id: 'test004',
    name: 'Complete Type Test',
    difficulty: 'Advanced',
    fields: {
      type: 'Kaizo'
    },
    raw_fields: {
      difficulty: 'diff_4',
      type: ['kaizo']
    }
  };
  
  const primaryPatch = { pat_sha224: 'jkl012' };
  const primaryBlobData = { patchblob1_name: 'test_blob4' };
  const patchbinDbPath = dbPath;
  const config = {};
  
  const recordCreator = new RecordCreator(dbManager, patchbinDbPath, config);
  
  recordCreator.createGameVersionRecord(
    'test004',
    metadata,
    primaryPatch,
    primaryBlobData
  );
  
  const result = dbManager.db.prepare(`
    SELECT combinedtype FROM gameversions WHERE gameid = 'test004'
  `).get();
  
  const expected = 'Kaizo: Advanced (diff_4) (kaizo)';
  assert(result.combinedtype === expected, `combinedtype should be "${expected}", got "${result.combinedtype}"`);
  
  recordCreator.close();
  dbManager.close();
}

/**
 * Test combinedtype with array types
 */
function testCombinedTypeWithArrayTypes() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  
  const metadata = {
    id: 'test005',
    name: 'Multi-Type Game',
    difficulty: 'Easy',
    fields: {
      type: 'Standard'
    },
    raw_fields: {
      difficulty: 'diff_2',
      type: ['standard', 'traditional']
    }
  };
  
  const primaryPatch = { pat_sha224: 'mno345' };
  const primaryBlobData = { patchblob1_name: 'test_blob5' };
  const patchbinDbPath = dbPath;
  const config = {};
  
  const recordCreator = new RecordCreator(dbManager, patchbinDbPath, config);
  
  recordCreator.createGameVersionRecord(
    'test005',
    metadata,
    primaryPatch,
    primaryBlobData
  );
  
  const result = dbManager.db.prepare(`
    SELECT combinedtype FROM gameversions WHERE gameid = 'test005'
  `).get();
  
  const expected = 'Standard: Easy (diff_2) (standard, traditional)';
  assert(result.combinedtype === expected, `combinedtype with array should be "${expected}"`);
  
  recordCreator.close();
  dbManager.close();
}

/**
 * Test locked attributes preservation
 */
function testLockedAttributesPreservation() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  
  const metadata1 = {
    id: 'test006',
    name: 'Game Version 1',
    difficulty: 'Easy'
  };
  
  const primaryPatch = { pat_sha224: 'pqr678' };
  const primaryBlobData = { patchblob1_name: 'test_blob6' };
  const patchbinDbPath = dbPath;
  const config = {};
  
  const recordCreator = new RecordCreator(dbManager, patchbinDbPath, config);
  
  // Create version 1
  const gvuuid1 = recordCreator.createGameVersionRecord(
    'test006',
    metadata1,
    primaryPatch,
    primaryBlobData
  );
  
  // Manually set locked attribute
  dbManager.db.prepare(`
    UPDATE gameversions 
    SET legacy_type = 'Competition Winner' 
    WHERE gvuuid = ?
  `).run(gvuuid1);
  
  // Create version 2 with different metadata
  const metadata2 = {
    id: 'test006',
    name: 'Game Version 2 Updated',
    difficulty: 'Advanced'
  };
  
  const primaryPatch2 = { pat_sha224: 'stu901' };
  const primaryBlobData2 = { patchblob1_name: 'test_blob6_v2' };
  
  recordCreator.createGameVersionRecord(
    'test006',
    metadata2,
    primaryPatch2,
    primaryBlobData2
  );
  
  // Verify version 2 has preserved locked attribute
  const result = dbManager.db.prepare(`
    SELECT legacy_type FROM gameversions 
    WHERE gameid = 'test006' AND version = 2
  `).get();
  
  assert(result.legacy_type === 'Competition Winner', 'Locked attribute should be preserved in version 2');
  
  recordCreator.close();
  dbManager.close();
}

/**
 * Test backward compatibility with old format (no new fields)
 */
function testBackwardCompatibility() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  
  const metadata = {
    id: 'test007',
    name: 'Old Format Game',
    type: 'Standard: Easy'
    // No fields, no raw_fields
  };
  
  const primaryPatch = { pat_sha224: 'vwx234' };
  const primaryBlobData = { patchblob1_name: 'test_blob7' };
  const patchbinDbPath = dbPath;
  const config = {};
  
  const recordCreator = new RecordCreator(dbManager, patchbinDbPath, config);
  
  recordCreator.createGameVersionRecord(
    'test007',
    metadata,
    primaryPatch,
    primaryBlobData
  );
  
  const result = dbManager.db.prepare(`
    SELECT fields_type, raw_difficulty, combinedtype FROM gameversions WHERE gameid = 'test007'
  `).get();
  
  assert(result.fields_type === null, 'fields_type should be NULL for old format');
  assert(result.raw_difficulty === null, 'raw_difficulty should be NULL for old format');
  assert(result.combinedtype === 'Standard: Easy', 'combinedtype should fall back to type field');
  
  recordCreator.close();
  dbManager.close();
}

/**
 * Test schema columns exist
 */
function testSchemaColumnsExist() {
  const dbPath = setupTestDatabase();
  const db = new Database(dbPath);
  
  const columns = db.prepare(`PRAGMA table_info(gameversions)`).all();
  const columnNames = columns.map(c => c.name);
  
  assert(columnNames.includes('fields_type'), 'fields_type column should exist');
  assert(columnNames.includes('raw_difficulty'), 'raw_difficulty column should exist');
  assert(columnNames.includes('combinedtype'), 'combinedtype column should exist');
  assert(columnNames.includes('legacy_type'), 'legacy_type column should exist');
  
  db.close();
}

/**
 * Run all tests
 */
function runTests() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  Updategames.js Test Suite - Schema Compatibility     ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  console.log('Running tests...\n');
  
  try {
    test('Schema columns exist (fields_type, raw_difficulty, combinedtype, legacy_type)', testSchemaColumnsExist);
    test('Boolean values are normalized for SQLite', testBooleanNormalization);
    test('fields_type is extracted from fields.type', testFieldsTypeExtraction);
    test('raw_difficulty is extracted from raw_fields.difficulty', testRawDifficultyExtraction);
    test('combinedtype is computed correctly', testCombinedTypeComputation);
    test('combinedtype handles array types correctly', testCombinedTypeWithArrayTypes);
    test('Locked attributes are preserved across versions', testLockedAttributesPreservation);
    test('Backward compatible with old JSON format', testBackwardCompatibility);
    
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

// Run the test suite
runTests();

