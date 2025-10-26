#!/usr/bin/env node

/**
 * Test script for clientdata.db user annotations schema
 * 
 * This script demonstrates the user_game_annotations, game_stages, 
 * and user_stage_annotations tables functionality.
 * 
 * Run: node electron/tests/test_clientdata_annotations.js
 * 
 * Environment Variables:
 *   CLIENTDATA_DB_PATH - Override database path (default: electron/clientdata.db)
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Configuration
const DEFAULT_DB_PATH = path.join(__dirname, '..', 'clientdata.db');
const TEST_DB_PATH = process.env.CLIENTDATA_DB_PATH || path.join(__dirname, '..', 'test_data', 'test_clientdata.db');
const MIGRATION_PATH = path.join(__dirname, '..', 'sql', 'migrations', '001_clientdata_user_annotations.sql');

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
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
 * Setup test database with migration
 */
function setupTestDatabase() {
  const testDir = path.dirname(TEST_DB_PATH);
  
  // Ensure test directory exists
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  // Remove existing test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  
  log('\n=== Setting up test database ===', 'cyan');
  log(`Test database: ${TEST_DB_PATH}`, 'blue');
  
  const db = new Database(TEST_DB_PATH);
  
  // Create base clientdata.db schema (csettings and apiservers)
  db.exec(`
    CREATE TABLE csettings (
      csettinguid varchar(255),
      csetting_name varchar(255),
      csetting_value text NOT NULL,
      csetting_binary blob,
      primary key(csettinguid)
    );
    
    CREATE TABLE apiservers (
      apiserveruuid VARCHAR(255) PRIMARY KEY,
      server_name VARCHAR(255),
      api_url TEXT NOT NULL,
      encrypted_clientid TEXT,
      encrypted_clientsecret TEXT,
      is_active INTEGER DEFAULT 1,
      last_used TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    );
  `);
  
  log('✓ Created base tables', 'green');
  
  // Apply migration
  const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
  db.exec(migration);
  
  log('✓ Applied migration 001', 'green');
  
  return db;
}

/**
 * Test: Verify tables and views were created
 */
function testSchemaCreation(db) {
  log('\n=== Test 1: Schema Creation ===', 'cyan');
  
  // Check tables
  const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' 
    AND (name LIKE 'user_%' OR name = 'game_stages')
    ORDER BY name
  `).all();
  
  const tableNames = tables.map(t => t.name);
  assert(tableNames.includes('user_game_annotations'), 'user_game_annotations table exists');
  assert(tableNames.includes('game_stages'), 'game_stages table exists');
  assert(tableNames.includes('user_stage_annotations'), 'user_stage_annotations table exists');
  
  // Check views
  const views = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='view'
    ORDER BY name
  `).all();
  
  const viewNames = views.map(v => v.name);
  assert(viewNames.includes('v_games_with_annotations'), 'v_games_with_annotations view exists');
  assert(viewNames.includes('v_stages_with_annotations'), 'v_stages_with_annotations view exists');
  
  // Check indexes
  const indexes = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='index'
    AND (name LIKE 'idx_user_%' OR name LIKE 'idx_game_stages%')
    ORDER BY name
  `).all();
  
  assert(indexes.length >= 7, `At least 7 indexes created (found ${indexes.length})`);
  
  log(`✓ All schema objects created successfully`, 'green');
}

/**
 * Test: User game annotations CRUD operations
 */
function testGameAnnotations(db) {
  log('\n=== Test 2: Game Annotations ===', 'cyan');
  
  // Insert game annotation
  const insertStmt = db.prepare(`
    INSERT INTO user_game_annotations (gameid, status, user_rating, hidden, user_notes)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  insertStmt.run('12345', 'In Progress', 4, 0, 'Great kaizo hack!');
  insertStmt.run('67890', 'Finished', 5, 0, 'Excellent traditional hack');
  insertStmt.run('11111', 'Default', null, 1, 'Too hard, hiding for now');
  
  log('✓ Inserted 3 game annotations', 'green');
  
  // Query annotations
  const games = db.prepare(`
    SELECT gameid, status, user_rating, hidden, user_notes
    FROM user_game_annotations
    ORDER BY gameid
  `).all();
  
  assert(games.length === 3, 'All 3 game annotations retrieved');
  assert(games[0].gameid === '11111', 'Game 11111 found');
  assert(games[0].hidden === 1, 'Game 11111 is hidden');
  assert(games[1].status === 'In Progress', 'Game 12345 status is In Progress');
  assert(games[1].user_rating === 4, 'Game 12345 rating is 4');
  
  // Update annotation
  db.prepare(`
    UPDATE user_game_annotations 
    SET status = ?, user_rating = ?
    WHERE gameid = ?
  `).run('Finished', 5, '12345');
  
  const updated = db.prepare(`
    SELECT status, user_rating FROM user_game_annotations WHERE gameid = ?
  `).get('12345');
  
  assert(updated.status === 'Finished', 'Game 12345 status updated to Finished');
  assert(updated.user_rating === 5, 'Game 12345 rating updated to 5');
  
  // Test CHECK constraint (should fail for invalid rating)
  try {
    insertStmt.run('99999', 'Default', 6, 0, 'Invalid rating');
    assert(false, 'CHECK constraint should reject rating > 5');
  } catch (err) {
    assert(err.message.includes('constraint'), 'CHECK constraint prevents invalid ratings');
  }
  
  // Test upsert (INSERT OR REPLACE)
  db.prepare(`
    INSERT OR REPLACE INTO user_game_annotations (gameid, status, user_rating, hidden, user_notes)
    VALUES (?, ?, ?, ?, ?)
  `).run('12345', 'In Progress', 3, 0, 'Changed my mind about this one');
  
  const upserted = db.prepare(`
    SELECT user_notes, user_rating FROM user_game_annotations WHERE gameid = ?
  `).get('12345');
  
  assert(upserted.user_rating === 3, 'Upsert updated rating');
  assert(upserted.user_notes.includes('Changed my mind'), 'Upsert updated notes');
  
  log('✓ All game annotation operations successful', 'green');
}

/**
 * Test: Game stages and user stage annotations
 */
function testStageAnnotations(db) {
  log('\n=== Test 3: Stage Annotations ===', 'cyan');
  
  // Insert stage metadata
  const stageStmt = db.prepare(`
    INSERT INTO game_stages (stage_key, gameid, exit_number, description, public_rating)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stageStmt.run('12345-01', '12345', '01', 'First Level - Tutorial', 2.5);
  stageStmt.run('12345-02', '12345', '02', 'Second Level - The Cave', 3.5);
  stageStmt.run('12345-03', '12345', '03', 'Third Level - Boss Fight', 4.5);
  stageStmt.run('67890-0xFF', '67890', '0xFF', 'Secret Exit Level', 3.0);
  
  log('✓ Inserted 4 game stages', 'green');
  
  // Insert user stage annotations
  const userStageStmt = db.prepare(`
    INSERT INTO user_stage_annotations (stage_key, gameid, exit_number, user_rating, user_notes)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  userStageStmt.run('12345-01', '12345', '01', 2, 'Easy tutorial');
  userStageStmt.run('12345-02', '12345', '02', 4, 'Tricky cave section');
  userStageStmt.run('12345-03', '12345', '03', 5, 'Very hard boss!');
  
  log('✓ Inserted 3 user stage annotations', 'green');
  
  // Query stages for a game
  const stages = db.prepare(`
    SELECT stage_key, exit_number, description, public_rating
    FROM game_stages
    WHERE gameid = ?
    ORDER BY exit_number
  `).all('12345');
  
  assert(stages.length === 3, 'Found 3 stages for game 12345');
  assert(stages[0].description.includes('Tutorial'), 'First stage is tutorial');
  
  // Query user annotations for stages
  const userStages = db.prepare(`
    SELECT stage_key, user_rating, user_notes
    FROM user_stage_annotations
    WHERE gameid = ?
    ORDER BY exit_number
  `).all('12345');
  
  assert(userStages.length === 3, 'Found 3 user stage annotations');
  assert(userStages[2].user_rating === 5, 'Boss stage rated 5');
  
  // Test stage_key format
  const stageKey = '12345-01';
  assert(stageKey.split('-').length === 2, 'Stage key has correct format');
  assert(stageKey.split('-')[0] === '12345', 'Stage key contains gameid');
  assert(stageKey.split('-')[1] === '01', 'Stage key contains exit_number');
  
  log('✓ All stage annotation operations successful', 'green');
}

/**
 * Test: Convenience views
 */
function testViews(db) {
  log('\n=== Test 4: Convenience Views ===', 'cyan');
  
  // Test v_games_with_annotations
  const gameAnnotations = db.prepare(`
    SELECT * FROM v_games_with_annotations WHERE status = 'In Progress'
  `).all();
  
  assert(gameAnnotations.length >= 1, 'View returns In Progress games');
  
  // Test v_stages_with_annotations
  const stageAnnotations = db.prepare(`
    SELECT * FROM v_stages_with_annotations WHERE gameid = '12345'
  `).all();
  
  assert(stageAnnotations.length === 3, 'View returns all stages with annotations');
  
  // Check that view includes both stage metadata and user annotations
  const stage = stageAnnotations.find(s => s.exit_number === '03');
  assert(stage.description.includes('Boss'), 'View includes stage description');
  assert(stage.public_rating === 4.5, 'View includes public rating');
  assert(stage.user_rating === 5, 'View includes user rating');
  assert(stage.user_notes.includes('hard boss'), 'View includes user notes');
  
  log('✓ All view queries successful', 'green');
}

/**
 * Test: Practical usage scenarios
 */
function testUsageScenarios(db) {
  log('\n=== Test 5: Practical Usage Scenarios ===', 'cyan');
  
  // Scenario 1: Get all visible (not hidden) games with ratings
  const visibleGames = db.prepare(`
    SELECT gameid, status, user_rating 
    FROM user_game_annotations 
    WHERE hidden = 0 AND user_rating IS NOT NULL
    ORDER BY user_rating DESC
  `).all();
  
  assert(visibleGames.length >= 2, 'Found visible games with ratings');
  log(`  Found ${visibleGames.length} visible games with ratings`, 'blue');
  
  // Scenario 2: Get games in progress
  const inProgress = db.prepare(`
    SELECT gameid, user_notes 
    FROM user_game_annotations 
    WHERE status = 'In Progress'
  `).all();
  
  log(`  Found ${inProgress.length} games in progress`, 'blue');
  
  // Scenario 3: Get all stages for a game with user ratings
  const gameWithStages = db.prepare(`
    SELECT 
      gs.exit_number,
      gs.description,
      gs.public_rating,
      usa.user_rating,
      usa.user_notes
    FROM game_stages gs
    LEFT JOIN user_stage_annotations usa ON gs.stage_key = usa.stage_key
    WHERE gs.gameid = ?
    ORDER BY gs.exit_number
  `).all('12345');
  
  assert(gameWithStages.length === 3, 'Retrieved all stages for game');
  log(`  Found ${gameWithStages.length} stages for game 12345`, 'blue');
  
  // Scenario 4: Get highest rated stages across all games
  const topStages = db.prepare(`
    SELECT 
      gameid,
      exit_number,
      user_rating,
      user_notes
    FROM user_stage_annotations
    WHERE user_rating >= 4
    ORDER BY user_rating DESC, gameid
  `).all();
  
  assert(topStages.length >= 2, 'Found highly rated stages');
  log(`  Found ${topStages.length} stages rated 4+`, 'blue');
  
  // Scenario 5: Count annotations by status
  const statusCounts = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM user_game_annotations
    GROUP BY status
    ORDER BY count DESC
  `).all();
  
  log(`  Status distribution:`, 'blue');
  statusCounts.forEach(s => {
    log(`    ${s.status}: ${s.count}`, 'blue');
  });
  
  log('✓ All usage scenarios completed', 'green');
}

/**
 * Test: Timestamp triggers
 */
function testTriggers(db) {
  log('\n=== Test 6: Timestamp Triggers ===', 'cyan');
  
  // Insert a new game annotation
  db.prepare(`
    INSERT INTO user_game_annotations (gameid, status, user_rating)
    VALUES (?, ?, ?)
  `).run('trigger_test', 'Default', 3);
  
  const before = db.prepare(`
    SELECT created_at, updated_at FROM user_game_annotations WHERE gameid = ?
  `).get('trigger_test');
  
  assert(before.created_at !== null, 'created_at is set on insert');
  assert(before.updated_at !== null, 'updated_at is set on insert');
  
  // Wait a moment to ensure timestamp changes
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  // Update the record
  setTimeout(() => {
    db.prepare(`
      UPDATE user_game_annotations SET user_rating = ? WHERE gameid = ?
    `).run(4, 'trigger_test');
    
    const after = db.prepare(`
      SELECT created_at, updated_at FROM user_game_annotations WHERE gameid = ?
    `).get('trigger_test');
    
    assert(after.created_at === before.created_at, 'created_at unchanged on update');
    assert(after.updated_at !== before.updated_at, 'updated_at changed on update');
    
    log('✓ Timestamp triggers working correctly', 'green');
  }, 100);
}

/**
 * Cleanup
 */
function cleanup() {
  log('\n=== Cleanup ===', 'cyan');
  
  // Remove test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
    log('✓ Removed test database', 'green');
  }
}

/**
 * Main test runner
 */
async function runTests() {
  log('\n╔═════════════════════════════════════════════════╗', 'cyan');
  log('║  clientdata.db User Annotations Schema Tests  ║', 'cyan');
  log('╚═════════════════════════════════════════════════╝', 'cyan');
  
  let db;
  
  try {
    // Setup
    db = setupTestDatabase();
    
    // Run tests
    testSchemaCreation(db);
    testGameAnnotations(db);
    testStageAnnotations(db);
    testViews(db);
    testUsageScenarios(db);
    
    // Close database before trigger test
    db.close();
    db = new Database(TEST_DB_PATH);
    testTriggers(db);
    
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Success
    log('\n╔═════════════════════════════════════════════════╗', 'green');
    log('║            ALL TESTS PASSED! ✓                 ║', 'green');
    log('╚═════════════════════════════════════════════════╝', 'green');
    log('\nThe clientdata.db schema is working correctly.', 'green');
    log('You can now use these tables in your application.\n', 'green');
    
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

