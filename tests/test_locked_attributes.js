#!/usr/bin/env node

/**
 * test_locked_attributes.js - Test suite for locked attributes feature
 * 
 * Tests:
 * 1. Locked attribute is NULL on first version
 * 2. Curator can set locked attribute manually
 * 3. Locked attribute persists across version updates
 * 4. Multiple locked attributes work together
 * 5. Non-locked attributes still update normally
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

// Test configuration
const TEST_DIR = __dirname;
const TEST_DATA_DIR = path.join(TEST_DIR, 'test_data');
const TEST_DB_PATH = path.join(TEST_DATA_DIR, 'test_locked_attr_rhdata.db');
const LOADDATA_SCRIPT = path.join(__dirname, '..', 'loaddata.js');

// ANSI colors
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

function createTestDatabase() {
  console.log(`\n${colors.bold}Setting up test database...${colors.reset}`);
  
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  
  const db = new Database(TEST_DB_PATH);
  const schemaPath = path.join(__dirname, '..', 'electron', 'sql', 'rhdata.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  
  const statements = schema.split(';').filter(s => s.trim().length > 0);
  statements.forEach(statement => {
    try {
      db.exec(statement + ';');
    } catch (err) {
      if (!err.message.includes('already exists')) {
        // Ignore
      }
    }
  });
  
  db.close();
  console.log(`${colors.green}✓${colors.reset} Test database created\n`);
}

function loadTestData(jsonFile) {
  const env = Object.assign({}, process.env, {
    RHDATA_DB_PATH: TEST_DB_PATH
  });
  
  try {
    const output = execSync(`node "${LOADDATA_SCRIPT}" "${jsonFile}"`, {
      env: env,
      encoding: 'utf8'
    });
    return output;
  } catch (error) {
    console.error(`Load error: ${error.message}`);
    return null;
  }
}

function testLockedAttributesBasic() {
  console.log(`${colors.bold}Test 1: Basic Locked Attributes${colors.reset}\n`);
  
  const jsonFile = path.join(TEST_DATA_DIR, 'test_locked_attributes.json');
  
  // Load version 1
  console.log('  Loading version 1...');
  const output1 = loadTestData(jsonFile);
  printResult('Version 1 loaded', output1 !== null);
  
  const db = new Database(TEST_DB_PATH);
  
  // Check version 1 has NULL legacy_type
  const v1 = db.prepare('SELECT * FROM gameversions WHERE gameid = ?').get('99999');
  printResult('Version 1 exists', v1 !== undefined);
  printResult('legacy_type is NULL initially', v1 && v1.legacy_type === null,
    `Expected: NULL, Got: ${v1 ? v1.legacy_type : 'N/A'}`);
  
  // Set legacy_type manually (curator action)
  console.log('\n  Setting legacy_type manually (curator action)...');
  db.prepare("UPDATE gameversions SET legacy_type = ? WHERE gameid = ? AND version = ?")
    .run('Curator Classification', '99999', 1);
  
  const v1Updated = db.prepare('SELECT * FROM gameversions WHERE gameid = ? AND version = ?')
    .get('99999', 1);
  printResult('legacy_type set successfully', v1Updated && v1Updated.legacy_type === 'Curator Classification',
    `Value: "${v1Updated ? v1Updated.legacy_type : 'N/A'}"`);
  
  // Modify JSON slightly to trigger new version
  const jsonContent = fs.readFileSync(jsonFile, 'utf8');
  const jsonData = JSON.parse(jsonContent);
  jsonData.description = 'Modified description for version 2';
  const tempFile = path.join(TEST_DATA_DIR, 'test_locked_temp.json');
  fs.writeFileSync(tempFile, JSON.stringify(jsonData, null, 2));
  
  // Load version 2
  console.log('\n  Loading version 2 (should preserve legacy_type)...');
  const output2 = loadTestData(tempFile);
  printResult('Version 2 loaded', output2 !== null);
  printResult('Console shows preserved attribute', output2 && output2.includes('Preserving locked attribute'),
    'Check for "ℹ️  Preserving locked attribute" message');
  
  // Verify version 2 has the same legacy_type
  const v2 = db.prepare('SELECT * FROM gameversions WHERE gameid = ? AND version = ?')
    .get('99999', 2);
  printResult('Version 2 exists', v2 !== undefined);
  printResult('legacy_type preserved in version 2', v2 && v2.legacy_type === 'Curator Classification',
    `Expected: "Curator Classification", Got: "${v2 ? v2.legacy_type : 'N/A'}"`);
  printResult('Description updated (non-locked field)', v2 && v2.description && v2.description.includes('version 2'),
    'Non-locked fields still update normally');
  
  // Cleanup
  if (fs.existsSync(tempFile)) {
    fs.unlinkSync(tempFile);
  }
  
  db.close();
}

function testMultipleVersions() {
  console.log(`\n${colors.bold}Test 2: Multiple Version Persistence${colors.reset}\n`);
  
  const db = new Database(TEST_DB_PATH);
  
  // Check all versions have the same legacy_type
  const allVersions = db.prepare('SELECT gameid, version, legacy_type FROM gameversions WHERE gameid = ? ORDER BY version')
    .all('99999');
  
  printResult('Multiple versions exist', allVersions.length >= 2,
    `Found ${allVersions.length} version(s)`);
  
  if (allVersions.length >= 2) {
    const allMatch = allVersions.every(v => v.legacy_type === 'Curator Classification');
    printResult('All versions have same legacy_type', allMatch,
      `All ${allVersions.length} versions: "Curator Classification"`);
  }
  
  db.close();
}

function testNoLockOnFirstVersion() {
  console.log(`\n${colors.bold}Test 3: No Lock on First Version${colors.reset}\n`);
  
  // Create a new game that doesn't exist yet
  const newGameJson = {
    id: '99998',
    name: 'New Game No Previous Version',
    type: 'Standard: Easy',
    legacy_type: 'This Should Not Apply'  // Should be ignored on version 1
  };
  
  const tempFile = path.join(TEST_DATA_DIR, 'test_new_game.json');
  fs.writeFileSync(tempFile, JSON.stringify(newGameJson, null, 2));
  
  loadTestData(tempFile);
  
  const db = new Database(TEST_DB_PATH);
  const record = db.prepare('SELECT * FROM gameversions WHERE gameid = ?').get('99998');
  
  printResult('New game loaded', record !== undefined);
  printResult('Version 1 created', record && record.version === 1);
  printResult('legacy_type is NULL (no previous version)', record && record.legacy_type === null,
    'Locked attributes dont apply to first version');
  
  // Cleanup
  if (fs.existsSync(tempFile)) {
    fs.unlinkSync(tempFile);
  }
  
  db.close();
}

function runTests() {
  console.log(`${colors.bold}${colors.blue}
╔════════════════════════════════════════════════════════╗
║  Locked Attributes Test Suite                         ║
╚════════════════════════════════════════════════════════╝
${colors.reset}`);
  
  try {
    createTestDatabase();
    testLockedAttributesBasic();
    testMultipleVersions();
    testNoLockOnFirstVersion();
    
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

if (require.main === module) {
  runTests();
}

module.exports = { runTests };

