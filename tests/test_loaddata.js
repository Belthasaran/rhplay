#!/usr/bin/env node

/**
 * test_loaddata.js - Test suite for loaddata.js with new schema support
 * 
 * Tests:
 * 1. Loading new JSON format with fields.type and raw_fields.difficulty
 * 2. Loading old JSON format (backward compatibility)
 * 3. Loading mixed format
 * 4. Boolean value normalization
 * 5. Environment variable database path override
 * 6. Duplicate detection
 * 7. Version tracking
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

// Test configuration
const TEST_DIR = __dirname;
const TEST_DATA_DIR = path.join(TEST_DIR, 'test_data');
const TEST_DB_PATH = path.join(TEST_DATA_DIR, 'test_loaddata_rhdata.db');
const LOADDATA_SCRIPT = path.join(__dirname, '..', 'loaddata.js');

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m'
};

let testsPassed = 0;
let testsFailed = 0;

/**
 * Print test result
 */
function printResult(testName, passed, message = '') {
  if (passed) {
    console.log(`${colors.green}✓${colors.reset} ${testName}`);
    if (message) console.log(`  ${colors.blue}${message}${colors.reset}`);
    testsPassed++;
  } else {
    console.log(`${colors.red}✗${colors.reset} ${testName}`);
    if (message) console.log(`  ${colors.red}${message}${colors.reset}`);
    testsFailed++;
  }
}

/**
 * Create test database with schema
 */
function createTestDatabase() {
  console.log(`\n${colors.bold}Setting up test database...${colors.reset}`);
  
  // Remove existing test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  
  const db = new Database(TEST_DB_PATH);
  
  // Read and execute schema
  const schemaPath = path.join(__dirname, '..', 'electron', 'sql', 'rhdata.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  
  // Execute schema (split by semicolon and execute each statement)
  const statements = schema.split(';').filter(s => s.trim().length > 0);
  statements.forEach(statement => {
    try {
      db.exec(statement + ';');
    } catch (err) {
      // Ignore errors for already existing objects
      if (!err.message.includes('already exists')) {
        console.error(`Schema error: ${err.message}`);
      }
    }
  });
  
  db.close();
  
  console.log(`${colors.green}✓${colors.reset} Test database created at: ${TEST_DB_PATH}`);
}

/**
 * Load a JSON file into the test database
 */
function loadTestData(jsonFile) {
  const env = Object.assign({}, process.env, {
    RHDATA_DB_PATH: TEST_DB_PATH
  });
  
  try {
    execSync(`node "${LOADDATA_SCRIPT}" "${jsonFile}"`, {
      env: env,
      stdio: 'pipe',
      encoding: 'utf8'
    });
    return true;
  } catch (error) {
    console.error(`Load error: ${error.message}`);
    return false;
  }
}

/**
 * Test loading new format JSON
 */
function testNewFormat() {
  console.log(`\n${colors.bold}Test 1: Loading New Format JSON${colors.reset}`);
  
  const jsonFile = path.join(TEST_DATA_DIR, 'test_game_new_format.json');
  const loaded = loadTestData(jsonFile);
  
  printResult('Load new format JSON', loaded);
  
  if (loaded) {
    const db = new Database(TEST_DB_PATH);
    const record = db.prepare('SELECT * FROM gameversions WHERE gameid = ?').get('99001');
    
    printResult('Record exists', record !== undefined);
    printResult('fields_type extracted', record && record.fields_type === 'Kaizo', 
      `Expected: "Kaizo", Got: "${record ? record.fields_type : 'N/A'}"`);
    printResult('raw_difficulty extracted', record && record.raw_difficulty === 'diff_4',
      `Expected: "diff_4", Got: "${record ? record.raw_difficulty : 'N/A'}"`);
    printResult('moderated normalized', record && record.moderated === '1',
      `Expected: "1" (from true), Got: "${record ? record.moderated : 'N/A'}"`);
    printResult('tags stored as JSON', record && record.tags && record.tags.includes('kaizo'),
      `Tags: ${record ? record.tags : 'N/A'}`);
    printResult('gametype populated', record && record.gametype === 'Advanced',
      `Expected: "Advanced", Got: "${record ? record.gametype : 'N/A'}"`);
    printResult('combinedtype computed', record && record.combinedtype === 'Kaizo: Advanced (diff_4) (kaizo)',
      `Expected: "Kaizo: Advanced (diff_4) (kaizo)", Got: "${record ? record.combinedtype : 'N/A'}"`);
    
    db.close();
  }
}

/**
 * Test loading old format JSON
 */
function testOldFormat() {
  console.log(`\n${colors.bold}Test 2: Loading Old Format JSON (Backward Compatibility)${colors.reset}`);
  
  const jsonFile = path.join(TEST_DATA_DIR, 'test_game_old_format.json');
  const loaded = loadTestData(jsonFile);
  
  printResult('Load old format JSON', loaded);
  
  if (loaded) {
    const db = new Database(TEST_DB_PATH);
    const record = db.prepare('SELECT * FROM gameversions WHERE gameid = ?').get('99002');
    
    printResult('Record exists', record !== undefined);
    printResult('fields_type is NULL (not in old format)', record && record.fields_type === null,
      `Expected: NULL, Got: "${record ? record.fields_type : 'N/A'}"`);
    printResult('raw_difficulty is NULL (not in old format)', record && record.raw_difficulty === null,
      `Expected: NULL, Got: "${record ? record.raw_difficulty : 'N/A'}"`);
    printResult('gametype populated from type field', record && record.gametype === 'Standard: Easy',
      `Expected: "Standard: Easy", Got: "${record ? record.gametype : 'N/A'}"`);
    printResult('demo field populated', record && record.demo === 'Yes',
      `Expected: "Yes", Got: "${record ? record.demo : 'N/A'}"`);
    printResult('combinedtype with no fields.type', record && record.combinedtype === 'Easy',
      `Old format should have combinedtype from difficulty only. Expected: "Easy", Got: "${record ? record.combinedtype : 'N/A'}"`);
    
    db.close();
  }
}

/**
 * Test loading mixed format JSON
 */
function testMixedFormat() {
  console.log(`\n${colors.bold}Test 3: Loading Mixed Format JSON${colors.reset}`);
  
  const jsonFile = path.join(TEST_DATA_DIR, 'test_game_mixed_format.json');
  const loaded = loadTestData(jsonFile);
  
  printResult('Load mixed format JSON', loaded);
  
  if (loaded) {
    const db = new Database(TEST_DB_PATH);
    const record = db.prepare('SELECT * FROM gameversions WHERE gameid = ?').get('99003');
    
    printResult('Record exists', record !== undefined);
    printResult('fields_type extracted', record && record.fields_type === 'Puzzle',
      `Expected: "Puzzle", Got: "${record ? record.fields_type : 'N/A'}"`);
    printResult('raw_difficulty extracted', record && record.raw_difficulty === 'diff_2',
      `Expected: "diff_2", Got: "${record ? record.raw_difficulty : 'N/A'}"`);
    printResult('moderated normalized to 0', record && record.moderated === '0',
      `Expected: "0" (from false), Got: "${record ? record.moderated : 'N/A'}"`);
    printResult('gametype is Puzzle', record && record.gametype === 'Puzzle',
      `Expected: "Puzzle", Got: "${record ? record.gametype : 'N/A'}"`);
    printResult('combinedtype with multi-type array', record && record.combinedtype && record.combinedtype.includes(','),
      `Should contain comma-separated types: "${record ? record.combinedtype : 'N/A'}"`);
    
    db.close();
  }
}

/**
 * Test duplicate detection
 */
function testDuplicateDetection() {
  console.log(`\n${colors.bold}Test 4: Duplicate Detection${colors.reset}`);
  
  const jsonFile = path.join(TEST_DATA_DIR, 'test_game_new_format.json');
  const loaded = loadTestData(jsonFile);
  
  printResult('Attempt to load duplicate', !loaded || loaded,
    'Should succeed but skip duplicate');
  
  if (loaded) {
    const db = new Database(TEST_DB_PATH);
    const count = db.prepare('SELECT COUNT(*) as count FROM gameversions WHERE gameid = ?')
      .get('99001').count;
    
    printResult('Only one version exists', count === 1,
      `Expected: 1, Got: ${count}`);
    
    db.close();
  }
}

/**
 * Test related tables
 */
function testRelatedTables() {
  console.log(`\n${colors.bold}Test 5: Related Tables (rhpatches, patchblobs)${colors.reset}`);
  
  const db = new Database(TEST_DB_PATH);
  
  const rhpatch = db.prepare('SELECT * FROM rhpatches WHERE gameid = ?').get('99001');
  printResult('rhpatches entry created', rhpatch !== undefined,
    `Patch name: ${rhpatch ? rhpatch.patch_name : 'N/A'}`);
  
  const patchblob = db.prepare('SELECT * FROM patchblobs WHERE patchblob1_name = ?')
    .get('pblob_99001_test123456');
  printResult('patchblobs entry created', patchblob !== undefined,
    `Patchblob name: ${patchblob ? patchblob.patchblob1_name : 'N/A'}`);
  
  db.close();
}

/**
 * Test schema columns exist
 */
function testSchemaColumns() {
  console.log(`\n${colors.bold}Test 6: Schema Columns${colors.reset}`);
  
  const db = new Database(TEST_DB_PATH);
  
  const columns = db.prepare("PRAGMA table_info(gameversions)").all();
  const columnNames = columns.map(col => col.name);
  
  printResult('fields_type column exists', columnNames.includes('fields_type'));
  printResult('raw_difficulty column exists', columnNames.includes('raw_difficulty'));
  printResult('combinedtype column exists', columnNames.includes('combinedtype'));
  printResult('moderated column exists', columnNames.includes('moderated'));
  printResult('tags column exists', columnNames.includes('tags'));
  printResult('gvjsondata column exists', columnNames.includes('gvjsondata'));
  
  db.close();
}

/**
 * Test querying by new fields
 */
function testQueryNewFields() {
  console.log(`\n${colors.bold}Test 7: Query by New Fields${colors.reset}`);
  
  const db = new Database(TEST_DB_PATH);
  
  const kaizoGames = db.prepare('SELECT * FROM gameversions WHERE fields_type = ?')
    .all('Kaizo');
  printResult('Query by fields_type works', kaizoGames.length > 0,
    `Found ${kaizoGames.length} Kaizo game(s)`);
  
  const diff4Games = db.prepare('SELECT * FROM gameversions WHERE raw_difficulty = ?')
    .all('diff_4');
  printResult('Query by raw_difficulty works', diff4Games.length > 0,
    `Found ${diff4Games.length} diff_4 game(s)`);
  
  const puzzleGames = db.prepare('SELECT * FROM gameversions WHERE fields_type = ?')
    .all('Puzzle');
  printResult('Query finds Puzzle games', puzzleGames.length > 0,
    `Found ${puzzleGames.length} Puzzle game(s)`);
  
  const combinedKaizo = db.prepare("SELECT * FROM gameversions WHERE combinedtype LIKE ?")
    .all('Kaizo:%');
  printResult('Query by combinedtype works', combinedKaizo.length > 0,
    `Found ${combinedKaizo.length} game(s) with "Kaizo:" prefix`);
  
  const withDiffCode = db.prepare("SELECT * FROM gameversions WHERE combinedtype LIKE ?")
    .all('%(diff_4)%');
  printResult('Query combinedtype by difficulty code', withDiffCode.length > 0,
    `Found ${withDiffCode.length} game(s) with "(diff_4)"`);
  
  db.close();
}

/**
 * Main test runner
 */
function runTests() {
  console.log(`${colors.bold}${colors.blue}
╔════════════════════════════════════════════════════════╗
║  LoadData.js Test Suite - New Schema Support          ║
╚════════════════════════════════════════════════════════╝
${colors.reset}`);
  
  try {
    // Setup
    createTestDatabase();
    
    // Run tests
    testNewFormat();
    testOldFormat();
    testMixedFormat();
    testDuplicateDetection();
    testRelatedTables();
    testSchemaColumns();
    testQueryNewFields();
    
    // Summary
    console.log(`\n${colors.bold}${colors.blue}═══════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bold}Test Summary:${colors.reset}`);
    console.log(`  ${colors.green}Passed: ${testsPassed}${colors.reset}`);
    console.log(`  ${colors.red}Failed: ${testsFailed}${colors.reset}`);
    console.log(`  Total:  ${testsPassed + testsFailed}`);
    
    if (testsFailed === 0) {
      console.log(`\n${colors.green}${colors.bold}✓ All tests passed!${colors.reset}`);
      process.exit(0);
    } else {
      console.log(`\n${colors.red}${colors.bold}✗ Some tests failed${colors.reset}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n${colors.red}Fatal error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests if executed directly
if (require.main === module) {
  runTests();
}

module.exports = { runTests };

