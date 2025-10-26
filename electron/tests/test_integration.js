#!/usr/bin/env node

/**
 * Integration Test for Database Manager and IPC Handlers
 * 
 * Tests the database integration without running Electron
 * Simulates the IPC calls to verify database access works
 */

const { DatabaseManager } = require('../database-manager');
const path = require('path');

// Color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function assert(condition, message) {
  if (!condition) {
    log(`✗ FAIL: ${message}`, 'red');
    process.exit(1);
  }
  log(`✓ PASS: ${message}`, 'green');
}

/**
 * Mock app.getPath for testing
 */
const mockApp = {
  getPath: (name) => {
    if (name === 'userData') {
      return path.join(__dirname, '..');
    }
    return path.join(__dirname, '..');
  }
};

// Override require for electron
require.cache[require.resolve('electron')] = {
  exports: { app: mockApp }
};

/**
 * Test database manager
 */
function testDatabaseManager() {
  log('\n=== Test 1: Database Manager ===', 'cyan');
  
  const dbManager = new DatabaseManager();
  
  // Check paths
  assert(dbManager.paths.rhdata, 'rhdata path exists');
  assert(dbManager.paths.clientdata, 'clientdata path exists');
  assert(dbManager.paths.patchbin, 'patchbin path exists');
  
  log(`  rhdata: ${dbManager.paths.rhdata}`, 'yellow');
  log(`  clientdata: ${dbManager.paths.clientdata}`, 'yellow');
  log(`  patchbin: ${dbManager.paths.patchbin}`, 'yellow');
  
  // Get connections
  const rhdataDb = dbManager.getConnection('rhdata');
  assert(rhdataDb, 'rhdata connection created');
  
  const clientdataDb = dbManager.getConnection('clientdata');
  assert(clientdataDb, 'clientdata connection created');
  
  log('✓ Database manager working', 'green');
  
  return dbManager;
}

/**
 * Test game data queries
 */
function testGameQueries(dbManager) {
  log('\n=== Test 2: Game Queries ===', 'cyan');
  
  const result = dbManager.withClientData('rhdata', (db) => {
    // Test getting games
    const games = db.prepare(`
      SELECT 
        gv.gameid as Id,
        gv.name as Name,
        gv.version as CurrentVersion,
        gv.combinedtype as Type
      FROM gameversions gv
      WHERE gv.removed = 0
        AND gv.version = (
          SELECT MAX(version) FROM gameversions gv2 
          WHERE gv2.gameid = gv.gameid
        )
      LIMIT 5
    `).all();
    
    return games;
  });
  
  assert(result.length > 0, `Found ${result.length} games`);
  assert(result[0].Id, 'Game has Id');
  assert(result[0].Name, 'Game has Name');
  
  log(`  Sample game: ${result[0].Name} (${result[0].Id})`, 'yellow');
  log(`  Type: ${result[0].Type || 'N/A'}`, 'yellow');
  
  log('✓ Game queries working', 'green');
}

/**
 * Test user annotations
 */
function testAnnotations(dbManager) {
  log('\n=== Test 3: User Annotations ===', 'cyan');
  
  const db = dbManager.getConnection('clientdata');
  
  // Insert test annotation
  db.prepare(`
    INSERT OR REPLACE INTO user_game_annotations
      (gameid, status, user_difficulty_rating, user_review_rating, user_skill_rating,
       hidden, exclude_from_random, user_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('test-integration', 'In Progress', 4, 5, 6, 0, 0, 'Integration test');
  
  // Retrieve it
  const annotation = db.prepare(`
    SELECT * FROM user_game_annotations WHERE gameid = ?
  `).get('test-integration');
  
  assert(annotation.gameid === 'test-integration', 'Annotation saved');
  assert(annotation.status === 'In Progress', 'Status correct');
  assert(annotation.user_difficulty_rating === 4, 'Difficulty rating correct');
  assert(annotation.user_review_rating === 5, 'Review rating correct');
  assert(annotation.user_skill_rating === 6, 'Skill rating correct');
  
  log('✓ Annotation save/load working', 'green');
  
  // Cleanup
  db.prepare(`DELETE FROM user_game_annotations WHERE gameid = ?`).run('test-integration');
}

/**
 * Test settings
 */
function testSettings(dbManager) {
  log('\n=== Test 4: Settings ===', 'cyan');
  
  const db = dbManager.getConnection('clientdata');
  const crypto = require('crypto');
  
  // Save a setting
  const uuid = crypto.randomUUID();
  db.prepare(`
    INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
    VALUES (?, ?, ?)
    ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
  `).run(uuid, 'test_setting', 'test_value');
  
  // Retrieve it
  const setting = db.prepare(`
    SELECT csetting_value FROM csettings WHERE csetting_name = ?
  `).get('test_setting');
  
  assert(setting.csetting_value === 'test_value', 'Setting saved and retrieved');
  
  log('✓ Settings working', 'green');
  
  // Cleanup
  db.prepare(`DELETE FROM csettings WHERE csetting_name = ?`).run('test_setting');
}

/**
 * Test with CLIENT DATA attachment
 */
function testCrossDatabase(dbManager) {
  log('\n=== Test 5: Cross-Database Queries ===', 'cyan');
  
  const db = dbManager.getConnection('clientdata');
  
  // Create test annotation
  db.prepare(`
    INSERT OR REPLACE INTO user_game_annotations
      (gameid, status, user_difficulty_rating)
    VALUES (?, ?, ?)
  `).run('10012', 'In Progress', 3);
  
  // Query with JOIN
  const result = dbManager.withClientData('rhdata', (rhdataDb) => {
    const game = rhdataDb.prepare(`
      SELECT 
        gv.gameid,
        gv.name,
        uga.status,
        uga.user_difficulty_rating
      FROM gameversions gv
      LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
      WHERE gv.gameid = '10012'
        AND gv.version = (SELECT MAX(version) FROM gameversions gv2 WHERE gv2.gameid = '10012')
    `).get();
    
    return game;
  });
  
  assert(result, 'Cross-database query succeeded');
  assert(result.status === 'In Progress', 'Joined annotation data');
  assert(result.user_difficulty_rating === 3, 'Rating from clientdata.db');
  
  log(`  Game: ${result.name}`, 'yellow');
  log(`  Status: ${result.status}`, 'yellow');
  log(`  Difficulty: ${result.user_difficulty_rating}`, 'yellow');
  
  log('✓ Cross-database queries working', 'green');
  
  // Cleanup
  db.prepare(`DELETE FROM user_game_annotations WHERE gameid = ?`).run('10012');
}

/**
 * Main test runner
 */
async function runTests() {
  log('\n╔═════════════════════════════════════════════════╗', 'cyan');
  log('║     Database Integration Tests                 ║', 'cyan');
  log('╚═════════════════════════════════════════════════╝', 'cyan');
  
  let dbManager;
  
  try {
    // Run tests
    dbManager = testDatabaseManager();
    testGameQueries(dbManager);
    testAnnotations(dbManager);
    testSettings(dbManager);
    testCrossDatabase(dbManager);
    
    // Success
    log('\n╔═════════════════════════════════════════════════╗', 'green');
    log('║         ALL INTEGRATION TESTS PASSED! ✓        ║', 'green');
    log('╚═════════════════════════════════════════════════╝', 'green');
    log('\nDatabase integration is working correctly.', 'green');
    log('Ready to run Electron app.\n', 'green');
    
  } catch (error) {
    log(`\n✗ ERROR: ${error.message}`, 'red');
    log(error.stack, 'red');
    process.exit(1);
  } finally {
    if (dbManager) {
      dbManager.closeAll();
    }
  }
}

// Run tests
runTests().catch(err => {
  log(`Fatal error: ${err.message}`, 'red');
  process.exit(1);
});

