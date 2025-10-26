#!/usr/bin/env node

/**
 * Test suite for Phase 2 change detection functionality
 * Uses separate test databases via environment variables
 * 
 * Usage:
 *   node tests/test_phase2_change_detection.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

// Set up test database paths via environment variables
const TEST_DATA_DIR = path.join(__dirname, 'test_data');
const TEST_RHDATA_DB = path.join(TEST_DATA_DIR, 'test_phase2_rhdata.db');
const TEST_PATCHBIN_DB = path.join(TEST_DATA_DIR, 'test_phase2_patchbin.db');

// Set environment variables for modules to use
process.env.RHDATA_DB_PATH = TEST_RHDATA_DB;
process.env.PATCHBIN_DB_PATH = TEST_PATCHBIN_DB;

// Import modules AFTER setting env vars
const DatabaseManager = require('../lib/database');
const ChangeDetector = require('../lib/change-detector');
const UpdateProcessor = require('../lib/update-processor');
const StatsManager = require('../lib/stats-manager');
const UrlComparator = require('../lib/url-comparator');

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
 * Setup test database with full schema
 */
function setupTestDatabase() {
  // Remove existing
  if (fs.existsSync(TEST_RHDATA_DB)) {
    fs.unlinkSync(TEST_RHDATA_DB);
  }
  
  if (!fs.existsSync(TEST_DATA_DIR)) {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
  
  const db = new Database(TEST_RHDATA_DB);
  
  // Create schema
  db.exec(`
    CREATE TABLE gameversions (
      gvuuid varchar(255) primary key DEFAULT (lower(hex(randomblob(16)))),
      gameid varchar(255),
      version int,
      name varchar(255),
      difficulty varchar(255),
      author varchar(255),
      description text,
      download_url varchar(255),
      size varchar(255),
      gvjsondata text,
      local_resource_etag varchar(255),
      local_resource_lastmodified TIMESTAMP,
      local_resource_filename varchar(500),
      fields_type varchar(255),
      raw_difficulty varchar(255),
      combinedtype varchar(255),
      legacy_type varchar(255),
      gvimport_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(gameid, version)
    );
    
    CREATE TABLE gameversion_stats (
      gvstatuuid varchar(255) primary key DEFAULT (lower(hex(randomblob(16)))),
      gameid varchar(255) NOT NULL UNIQUE,
      gvuuid varchar(255),
      download_count INTEGER,
      view_count INTEGER,
      comment_count INTEGER,
      rating_value REAL,
      rating_count INTEGER,
      favorite_count INTEGER,
      hof_status varchar(50),
      featured_status varchar(50),
      gvjsondata text NOT NULL,
      previous_gvjsondata text,
      last_major_change TIMESTAMP,
      last_minor_change TIMESTAMP,
      change_count INTEGER DEFAULT 0,
      first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE change_detection_log (
      loguuid varchar(255) primary key DEFAULT (lower(hex(randomblob(16)))),
      gameid varchar(255) NOT NULL,
      gvuuid varchar(255),
      change_type varchar(50) NOT NULL,
      detection_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      changed_fields text,
      field_changes text,
      action_taken varchar(100),
      new_gvuuid varchar(255),
      metadata text
    );
    
    CREATE TABLE change_detection_config (
      cfguuid varchar(255) primary key DEFAULT (lower(hex(randomblob(16)))),
      field_name varchar(255) NOT NULL UNIQUE,
      classification varchar(50) NOT NULL,
      weight INTEGER DEFAULT 1,
      notes text,
      active BOOLEAN DEFAULT 1
    );
    
    -- Insert test configuration
    INSERT INTO change_detection_config (field_name, classification, weight) VALUES
      ('name', 'major', 10),
      ('author', 'major', 8),
      ('description', 'major', 7),
      ('difficulty', 'major', 6),
      ('download_url', 'major', 9),
      ('size', 'major', 5),
      ('downloads', 'minor', 1),
      ('rating', 'minor', 1),
      ('views', 'minor', 1);
  `);
  
  db.close();
  return TEST_RHDATA_DB;
}

/**
 * Test URL comparison - major vs minor changes
 */
function testUrlComparison() {
  const urlComp = new UrlComparator({ SIZE_CHANGE_THRESHOLD_PERCENT: 5 });
  
  // Test 1: Filename version change (MAJOR)
  const result1 = urlComp.isSignificantUrlChange(
    'dl.smwcentral.net/39116/Binary%20World%201.0.11.zip',
    'dl.smwcentral.net/39116/Binary%20World%201.0.12.zip',
    '500000',
    '500000'
  );
  assert(result1.significant === true, 'Filename version change should be MAJOR');
  assert(result1.reason === 'path_changed', 'Reason should be path_changed');
  
  // Test 2: Hostname change only (MINOR)
  const result2 = urlComp.isSignificantUrlChange(
    'dl.smwcentral.net/39116/file.zip',
    'dl2.smwcentral.net/39116/file.zip',
    '500000',
    '500000'
  );
  assert(result2.significant === false, 'Hostname change only should be MINOR');
  
  // Test 3: Size change >5% (MAJOR)
  const result3 = urlComp.isSignificantUrlChange(
    'dl.smwcentral.net/39116/file.zip',
    'dl.smwcentral.net/39116/file.zip',
    '500000',
    '600000'
  );
  assert(result3.significant === true, 'Size change >5% should be MAJOR');
  assert(result3.reason === 'size_changed', 'Reason should be size_changed');
}

/**
 * Test change detection - major changes
 */
function testMajorChangeDetection() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  
  // Insert existing game
  const oldMetadata = {
    id: 'test001',
    name: 'Old Name',
    author: 'Author',
    difficulty: 'Easy',
    downloads: 100
  };
  
  dbManager.db.prepare(`
    INSERT INTO gameversions (gvuuid, gameid, version, name, author, difficulty, gvjsondata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    'test001',
    1,
    'Old Name',
    'Author',
    'Easy',
    JSON.stringify(oldMetadata)
  );
  
  // Detect changes with new metadata
  const changeDetector = new ChangeDetector(dbManager, {});
  const oldRecord = dbManager.getLatestVersionForGame('test001');
  
  const newMetadata = {
    id: 'test001',
    name: 'New Name',  // Changed
    author: 'Author',
    difficulty: 'Easy',
    downloads: 150     // Changed but minor
  };
  
  const classification = changeDetector.detectChanges(oldRecord, newMetadata);
  
  assert(classification.type === 'major', 'Name change should be classified as MAJOR');
  assert(classification.majorChanges.length > 0, 'Should have major changes');
  assert(classification.majorChanges.some(c => c.field === 'name'), 'Name should be in major changes');
  
  dbManager.close();
}

/**
 * Test change detection - minor changes only
 */
function testMinorChangeDetection() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  
  // Insert existing game
  const oldMetadata = {
    id: 'test002',
    name: 'Game Name',
    author: 'Author',
    downloads: 100,
    rating: 4.5
  };
  
  dbManager.db.prepare(`
    INSERT INTO gameversions (gvuuid, gameid, version, name, author, gvjsondata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    'test002',
    1,
    'Game Name',
    'Author',
    JSON.stringify(oldMetadata)
  );
  
  // Detect changes
  const changeDetector = new ChangeDetector(dbManager, {});
  const oldRecord = dbManager.getLatestVersionForGame('test002');
  
  const newMetadata = {
    id: 'test002',
    name: 'Game Name',  // Unchanged
    author: 'Author',   // Unchanged
    downloads: 150,     // Changed (minor)
    rating: 4.7         // Changed (minor)
  };
  
  const classification = changeDetector.detectChanges(oldRecord, newMetadata);
  
  assert(classification.type === 'minor', 'Only stats changes should be classified as MINOR');
  assert(classification.majorChanges.length === 0, 'Should have no major changes');
  assert(classification.minorChanges.length > 0, 'Should have minor changes');
  
  dbManager.close();
}

/**
 * Test stats extraction
 */
function testStatsExtraction() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  
  const statsManager = new StatsManager(dbManager);
  
  const metadata = {
    downloads: 250,
    views: 1000,
    rating: 4.5,
    comment_count: 15,
    hof: 'inducted'
  };
  
  const stats = statsManager.extractStats(metadata);
  
  assert(stats.download_count === 250, 'Should extract download count');
  assert(stats.view_count === 1000, 'Should extract view count');
  assert(stats.rating_value === 4.5, 'Should extract rating value');
  assert(stats.comment_count === 15, 'Should extract comment count');
  assert(stats.hof_status === 'inducted', 'Should extract HOF status');
  
  dbManager.close();
}

/**
 * Test gameversion_stats table operations
 */
function testStatsTableOperations() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  const statsManager = new StatsManager(dbManager);
  
  // Insert a game first
  const gvuuid = crypto.randomUUID();
  dbManager.db.prepare(`
    INSERT INTO gameversions (gvuuid, gameid, version, name, gvjsondata)
    VALUES (?, ?, ?, ?, ?)
  `).run(gvuuid, 'test003', 1, 'Test Game', JSON.stringify({ id: 'test003', name: 'Test Game' }));
  
  // Update stats
  const metadata = {
    id: 'test003',
    name: 'Test Game',
    downloads: 100,
    rating: 4.0
  };
  
  statsManager.updateGameStats('test003', gvuuid, metadata, false);
  
  // Verify stats were created
  const stats = statsManager.getGameStats('test003');
  assert(stats !== null, 'Stats should be created');
  assert(stats.gameid === 'test003', 'Stats gameid should match');
  assert(stats.download_count === 100, 'Download count should be 100');
  
  // Update again
  const metadata2 = {
    id: 'test003',
    name: 'Test Game',
    downloads: 150
  };
  
  statsManager.updateGameStats('test003', gvuuid, metadata2, false);
  
  // Verify stats were updated
  const stats2 = statsManager.getGameStats('test003');
  assert(stats2.download_count === 150, 'Download count should be updated to 150');
  assert(stats2.change_count === 1, 'Change count should increment');
  
  dbManager.close();
}

/**
 * Test change detection logging
 */
function testChangeDetectionLogging() {
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  
  // Insert game
  const gvuuid = crypto.randomUUID();
  dbManager.db.prepare(`
    INSERT INTO gameversions (gvuuid, gameid, version, name, gvjsondata)
    VALUES (?, ?, ?, ?, ?)
  `).run(gvuuid, 'test004', 1, 'Test Game', JSON.stringify({ id: 'test004', name: 'Old Name' }));
  
  // Detect changes
  const changeDetector = new ChangeDetector(dbManager, {});
  const oldRecord = dbManager.getLatestVersionForGame('test004');
  const newMetadata = {
    id: 'test004',
    name: 'New Name'
  };
  
  const classification = changeDetector.detectChanges(oldRecord, newMetadata);
  
  // Log the change
  dbManager.logChangeDetection({
    loguuid: crypto.randomUUID(),
    gameid: 'test004',
    gvuuid: gvuuid,
    change_type: classification.type,
    changed_fields: JSON.stringify(['name']),
    field_changes: JSON.stringify({ major: classification.majorChanges }),
    action_taken: 'pending',
    metadata: JSON.stringify({})
  });
  
  // Verify log was created
  const logs = dbManager.db.prepare(`
    SELECT * FROM change_detection_log WHERE gameid = 'test004'
  `).all();
  
  assert(logs.length === 1, 'Change detection log should be created');
  assert(logs[0].change_type === 'major', 'Change type should be major');
  
  dbManager.close();
}

/**
 * Test URL path extraction
 */
function testUrlPathExtraction() {
  const urlComp = new UrlComparator({});
  
  const tests = [
    {
      url: 'https://dl.smwcentral.net/39116/file.zip',
      expected: '/39116/file.zip'
    },
    {
      url: '//dl.smwcentral.net/39116/file.zip',
      expected: '/39116/file.zip'
    },
    {
      url: 'http://dl2.smwcentral.net/39116/file.zip',
      expected: '/39116/file.zip'
    }
  ];
  
  for (const test of tests) {
    const result = urlComp.extractPathAndFilename(test.url);
    assert(result === test.expected, `extractPathAndFilename("${test.url}") should be "${test.expected}", got "${result}"`);
  }
}

/**
 * Test environment variable database paths
 */
function testEnvironmentVariablePaths() {
  assert(process.env.RHDATA_DB_PATH === TEST_RHDATA_DB, 'RHDATA_DB_PATH should be set');
  assert(process.env.PATCHBIN_DB_PATH === TEST_PATCHBIN_DB, 'PATCHBIN_DB_PATH should be set');
  
  // Verify DatabaseManager uses env var
  const dbPath = setupTestDatabase();
  const dbManager = new DatabaseManager(dbPath);
  assert(dbManager.dbPath === dbPath, 'DatabaseManager should use provided path');
  dbManager.close();
}

/**
 * Run all tests
 */
function runTests() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Phase 2 Change Detection Test Suite                     ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
  console.log(`Test Database: ${TEST_RHDATA_DB}`);
  console.log(`Using environment variables:\n  RHDATA_DB_PATH=${process.env.RHDATA_DB_PATH}\n`);
  
  console.log('Running tests...\n');
  
  try {
    test('Environment variable database paths work', testEnvironmentVariablePaths);
    test('URL comparison - major vs minor changes', testUrlComparison);
    test('URL path extraction works correctly', testUrlPathExtraction);
    test('Major change detection (name change)', testMajorChangeDetection);
    test('Minor change detection (stats only)', testMinorChangeDetection);
    test('Statistics extraction from JSON', testStatsExtraction);
    test('gameversion_stats table operations', testStatsTableOperations);
    test('Change detection logging', testChangeDetectionLogging);
    
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

