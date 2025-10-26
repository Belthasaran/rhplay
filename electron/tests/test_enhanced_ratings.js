#!/usr/bin/env node

/**
 * Test script for enhanced ratings and run system (Migration 002)
 * 
 * Tests:
 * - Dual rating system (difficulty + review)
 * - Version-specific annotations
 * - Random exclusion flags
 * - Run system basics
 * 
 * Run: node electron/tests/test_enhanced_ratings.js
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Configuration
const TEST_DIR = path.join(__dirname, '..', 'test_data');
const TEST_CLIENT_DB = path.join(TEST_DIR, 'test_clientdata_enhanced.db');
const MIGRATION_PATH = path.join(__dirname, '..', 'sql', 'migrations', '002_clientdata_enhanced_ratings_and_runs.sql');

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
 * Setup test database
 */
function setupTestDatabase() {
  // Create test directory
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
  
  // Remove existing test database
  if (fs.existsSync(TEST_CLIENT_DB)) {
    fs.unlinkSync(TEST_CLIENT_DB);
  }
  
  log('\n=== Setting up test database ===', 'cyan');
  const db = new Database(TEST_CLIENT_DB);
  
  // Create base tables (from migration 001)
  db.exec(`
    CREATE TABLE user_game_annotations (
      gameid VARCHAR(255) PRIMARY KEY,
      status VARCHAR(50) DEFAULT 'Default',
      user_rating INTEGER CHECK (user_rating IS NULL OR (user_rating >= 1 AND user_rating <= 5)),
      hidden INTEGER DEFAULT 0,
      user_notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE user_stage_annotations (
      stage_key VARCHAR(510) PRIMARY KEY,
      gameid VARCHAR(255) NOT NULL,
      exit_number VARCHAR(255) NOT NULL,
      user_rating INTEGER CHECK (user_rating IS NULL OR (user_rating >= 1 AND user_rating <= 5)),
      user_notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(gameid, exit_number)
    );
    
    CREATE TABLE game_stages (
      stage_key VARCHAR(510) PRIMARY KEY,
      gameid VARCHAR(255) NOT NULL,
      exit_number VARCHAR(255) NOT NULL,
      description TEXT,
      public_rating DECIMAL(3,2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(gameid, exit_number)
    );
  `);
  
  log('✓ Created base tables', 'green');
  
  // Apply migration 002
  const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
  db.exec(migration);
  
  log('✓ Applied migration 002', 'green');
  
  return db;
}

/**
 * Test dual rating system
 */
function testDualRatings(db) {
  log('\n=== Test 1: Dual Rating System ===', 'cyan');
  
  // Insert with both ratings
  db.prepare(`
    INSERT INTO user_game_annotations 
      (gameid, user_difficulty_rating, user_review_rating, status)
    VALUES (?, ?, ?, ?)
  `).run('12345', 4, 5, 'In Progress');
  
  const game = db.prepare(`
    SELECT gameid, user_difficulty_rating, user_review_rating, status
    FROM user_game_annotations WHERE gameid = ?
  `).get('12345');
  
  assert(game.user_difficulty_rating === 4, 'Difficulty rating saved');
  assert(game.user_review_rating === 5, 'Review rating saved');
  assert(game.status === 'In Progress', 'Status saved');
  
  // Test separate updates
  db.prepare(`
    UPDATE user_game_annotations SET user_difficulty_rating = ? WHERE gameid = ?
  `).run(5, '12345');
  
  const updated = db.prepare(`
    SELECT user_difficulty_rating, user_review_rating
    FROM user_game_annotations WHERE gameid = ?
  `).get('12345');
  
  assert(updated.user_difficulty_rating === 5, 'Difficulty updated independently');
  assert(updated.user_review_rating === 5, 'Review rating unchanged');
  
  log('✓ Dual rating system works', 'green');
}

/**
 * Test version-specific annotations
 */
function testVersionSpecific(db) {
  log('\n=== Test 2: Version-Specific Annotations ===', 'cyan');
  
  // Set game-wide rating
  db.prepare(`
    INSERT OR REPLACE INTO user_game_annotations 
      (gameid, user_difficulty_rating, user_review_rating)
    VALUES (?, ?, ?)
  `).run('67890', 4, 5);
  
  // Set version-specific rating
  db.prepare(`
    INSERT INTO user_game_version_annotations 
      (annotation_key, gameid, version, user_difficulty_rating, user_review_rating)
    VALUES (?, ?, ?, ?, ?)
  `).run('67890-2', '67890', 2, 3, 5);
  
  // Get version-specific
  const v2 = db.prepare(`
    SELECT user_difficulty_rating, user_review_rating
    FROM user_game_version_annotations WHERE gameid = ? AND version = ?
  `).get('67890', 2);
  
  assert(v2.user_difficulty_rating === 3, 'Version 2 has different difficulty');
  assert(v2.user_review_rating === 5, 'Version 2 has same review');
  
  // Verify game-wide still exists
  const gameWide = db.prepare(`
    SELECT user_difficulty_rating FROM user_game_annotations WHERE gameid = ?
  `).get('67890');
  
  assert(gameWide.user_difficulty_rating === 4, 'Game-wide rating unchanged');
  
  log('✓ Version-specific annotations work', 'green');
}

/**
 * Test exclusion flags
 */
function testExclusionFlags(db) {
  log('\n=== Test 3: Exclusion Flags ===', 'cyan');
  
  // Set exclude_from_random
  db.prepare(`
    INSERT INTO user_game_annotations (gameid, exclude_from_random)
    VALUES (?, ?)
  `).run('99999', 1);
  
  const excluded = db.prepare(`
    SELECT exclude_from_random FROM user_game_annotations WHERE gameid = ?
  `).get('99999');
  
  assert(excluded.exclude_from_random === 1, 'Game excluded from random');
  
  // Test view includes new column
  const fromView = db.prepare(`
    SELECT exclude_from_random FROM v_games_with_annotations WHERE gameid = ?
  `).get('99999');
  
  assert(fromView.exclude_from_random === 1, 'View includes exclude_from_random');
  
  log('✓ Exclusion flags work', 'green');
}

/**
 * Test run system basics
 */
function testRunSystem(db) {
  log('\n=== Test 4: Run System ===', 'cyan');
  
  // Create run
  const runUuid = 'test-run-' + Date.now();
  db.prepare(`
    INSERT INTO runs (run_uuid, run_name, status)
    VALUES (?, ?, 'preparing')
  `).run(runUuid, 'Test Run');
  
  const run = db.prepare(`
    SELECT run_uuid, run_name, status FROM runs WHERE run_uuid = ?
  `).get(runUuid);
  
  assert(run.run_name === 'Test Run', 'Run created');
  assert(run.status === 'preparing', 'Run status is preparing');
  
  // Add plan entry (specific game)
  db.prepare(`
    INSERT INTO run_plan_entries 
      (run_uuid, sequence_number, entry_type, gameid, count)
    VALUES (?, ?, 'game', ?, 1)
  `).run(runUuid, 1, '12345');
  
  // Add plan entry (random)
  db.prepare(`
    INSERT INTO run_plan_entries 
      (run_uuid, sequence_number, entry_type, count, filter_type, filter_seed)
    VALUES (?, ?, 'random_game', 3, 'Kaizo', 'testseed')
  `).run(runUuid, 2);
  
  const entries = db.prepare(`
    SELECT COUNT(*) as count FROM run_plan_entries WHERE run_uuid = ?
  `).get(runUuid);
  
  assert(entries.count === 2, 'Plan entries added');
  
  // Start run
  db.prepare(`
    UPDATE runs SET status = 'active', started_at = CURRENT_TIMESTAMP WHERE run_uuid = ?
  `).run(runUuid);
  
  const activeRun = db.prepare(`
    SELECT status, started_at FROM runs WHERE run_uuid = ?
  `).get(runUuid);
  
  assert(activeRun.status === 'active', 'Run started');
  assert(activeRun.started_at !== null, 'Start time recorded');
  
  // Add result
  db.prepare(`
    INSERT INTO run_results 
      (run_uuid, sequence_number, gameid, game_name, status)
    VALUES (?, ?, ?, ?, 'success')
  `).run(runUuid, 1, '12345', 'Test Game');
  
  const results = db.prepare(`
    SELECT COUNT(*) as count FROM run_results WHERE run_uuid = ?
  `).get(runUuid);
  
  assert(results.count === 1, 'Result recorded');
  
  log('✓ Run system basics work', 'green');
}

/**
 * Test stage dual ratings
 */
function testStageDualRatings(db) {
  log('\n=== Test 5: Stage Dual Ratings ===', 'cyan');
  
  // Add stage with both ratings
  db.prepare(`
    INSERT INTO user_stage_annotations 
      (stage_key, gameid, exit_number, user_difficulty_rating, user_review_rating)
    VALUES (?, ?, ?, ?, ?)
  `).run('12345-01', '12345', '01', 5, 3);
  
  const stage = db.prepare(`
    SELECT user_difficulty_rating, user_review_rating
    FROM user_stage_annotations WHERE stage_key = ?
  `).get('12345-01');
  
  assert(stage.user_difficulty_rating === 5, 'Stage difficulty rating saved');
  assert(stage.user_review_rating === 3, 'Stage review rating saved');
  
  log('✓ Stage dual ratings work', 'green');
}

/**
 * Test views
 */
function testViews(db) {
  log('\n=== Test 6: Views ===', 'cyan');
  
  // Test v_games_with_annotations
  const games = db.prepare(`
    SELECT * FROM v_games_with_annotations
  `).all();
  
  assert(games.length > 0, 'v_games_with_annotations returns data');
  assert('user_difficulty_rating' in games[0], 'View includes difficulty rating');
  assert('user_review_rating' in games[0], 'View includes review rating');
  assert('exclude_from_random' in games[0], 'View includes exclude flag');
  
  // Test v_active_run (should be empty in this test)
  const activeRuns = db.prepare(`
    SELECT * FROM v_active_run
  `).all();
  
  // Note: activeRuns might be empty or have 1 depending on test data
  log(`  Active runs: ${activeRuns.length}`, 'yellow');
  
  log('✓ Views work correctly', 'green');
}

/**
 * Cleanup
 */
function cleanup() {
  log('\n=== Cleanup ===', 'cyan');
  if (fs.existsSync(TEST_CLIENT_DB)) {
    fs.unlinkSync(TEST_CLIENT_DB);
    log('✓ Removed test database', 'green');
  }
}

/**
 * Main test runner
 */
async function runTests() {
  log('\n╔═════════════════════════════════════════════════╗', 'cyan');
  log('║  Enhanced Ratings & Run System Tests          ║', 'cyan');
  log('╚═════════════════════════════════════════════════╝', 'cyan');
  
  let db;
  
  try {
    // Setup
    db = setupTestDatabase();
    
    // Run tests
    testDualRatings(db);
    testVersionSpecific(db);
    testExclusionFlags(db);
    testRunSystem(db);
    testStageDualRatings(db);
    testViews(db);
    
    // Success
    log('\n╔═════════════════════════════════════════════════╗', 'green');
    log('║            ALL TESTS PASSED! ✓                 ║', 'green');
    log('╚═════════════════════════════════════════════════╝', 'green');
    log('\nMigration 002 schema is working correctly.', 'green');
    log('Ready for GUI integration.\n', 'green');
    
  } catch (err) {
    log(`\n✗ ERROR: ${err.message}`, 'red');
    log(err.stack, 'red');
    process.exit(1);
  } finally {
    if (db) {
      db.close();
    }
    cleanup();
  }
}

// Run tests
runTests().catch(err => {
  log(`Fatal error: ${err.message}`, 'red');
  process.exit(1);
});

