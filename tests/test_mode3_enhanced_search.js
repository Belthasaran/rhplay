#!/usr/bin/env node

/**
 * Test Mode 3 Enhanced Search functionality
 * Tests multi-criteria search, fuzzy/exact/regex matching, date/number comparisons
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const TEST_DIR = path.join(__dirname, 'test_data');
const TEST_PATCHBIN_DB = path.join(TEST_DIR, 'test_mode3_enhanced_patchbin.db');
const TEST_RHDATA_DB = path.join(TEST_DIR, 'test_mode3_enhanced_rhdata.db');

console.log('='.repeat(70));
console.log('Mode 3 Enhanced Search Test Setup');
console.log('='.repeat(70));
console.log();

// Clean up previous test databases
if (fs.existsSync(TEST_PATCHBIN_DB)) {
  fs.unlinkSync(TEST_PATCHBIN_DB);
}
if (fs.existsSync(TEST_RHDATA_DB)) {
  fs.unlinkSync(TEST_RHDATA_DB);
}

// Create test databases
const patchbinDb = new Database(TEST_PATCHBIN_DB);
const rhdataDb = new Database(TEST_RHDATA_DB);

try {
  // Create schemas
  console.log('Creating test database schemas...');
  
  patchbinDb.exec(`
    CREATE TABLE patchblobs (
      pbuuid VARCHAR(255) PRIMARY KEY,
      auuid VARCHAR(255),
      pbkey VARCHAR(255),
      pbiv VARCHAR(255),
      decoded_hash_sha256 VARCHAR(255)
    );
    
    CREATE TABLE attachments (
      auuid VARCHAR(255) PRIMARY KEY,
      pbuuid VARCHAR(255),
      gvuuid VARCHAR(255),
      file_name VARCHAR(255),
      file_size INTEGER,
      file_hash_sha256 VARCHAR(255),
      file_data BLOB
    );
  `);
  
  rhdataDb.exec(`
    CREATE TABLE gameversions (
      gvuuid VARCHAR(255) PRIMARY KEY,
      gameid VARCHAR(255),
      name VARCHAR(255),
      version INTEGER,
      pbuuid VARCHAR(255),
      gametype VARCHAR(255),
      author VARCHAR(255),
      authors VARCHAR(255),
      difficulty VARCHAR(255),
      added VARCHAR(255),
      section VARCHAR(255),
      demo VARCHAR(255),
      length VARCHAR(255),
      tags TEXT
    );
  `);
  
  console.log('✓ Created schemas');
  
  // Create test data
  console.log('\nCreating test data...');
  
  const testGames = [
    {
      name: 'Super Kaizo World',
      gameid: 'kaizo_world_001',
      version: 1,
      gametype: 'Kaizo',
      author: 'KT',
      authors: 'KT, TestAuthor',
      difficulty: 'Hard',
      added: '2024-01-15',
      section: 'Kaizo: Hard',
      demo: 'No',
      length: '73 exits',
      tags: JSON.stringify(['kaizo', 'hard', 'complete'])
    },
    {
      name: 'Super Kaizo World',
      gameid: 'kaizo_world_001',
      version: 2,
      gametype: 'Kaizo',
      author: 'KT',
      authors: 'KT, TestAuthor',
      difficulty: 'Hard',
      added: '2024-03-20',
      section: 'Kaizo: Hard',
      demo: 'No',
      length: '73 exits',
      tags: JSON.stringify(['kaizo', 'hard', 'complete', 'updated'])
    },
    {
      name: 'Easy Vanilla Hack',
      gameid: 'vanilla_easy_001',
      version: 1,
      gametype: 'Standard',
      author: 'VanillaAuthor',
      authors: 'VanillaAuthor',
      difficulty: 'Easy',
      added: '2023-06-10',
      section: 'Standard: Easy',
      demo: 'Yes',
      length: '5 exits',
      tags: JSON.stringify(['vanilla', 'easy', 'demo'])
    },
    {
      name: 'Medium Puzzle Hack',
      gameid: 'puzzle_medium_001',
      version: 1,
      gametype: 'Puzzle',
      author: 'PuzzleMaster',
      authors: 'PuzzleMaster',
      difficulty: 'Medium',
      added: '2024-12-01',
      section: 'Puzzle: Medium',
      demo: 'No',
      length: '12 exits',
      tags: JSON.stringify(['puzzle', 'medium'])
    },
    {
      name: 'Another Kaizo Adventure',
      gameid: 'kaizo_adv_001',
      version: 1,
      gametype: 'Kaizo',
      author: 'KaizoFan',
      authors: 'KaizoFan',
      difficulty: 'Extreme',
      added: '2024-10-15',
      section: 'Kaizo: Extreme',
      demo: 'No',
      length: '96 exits',
      tags: JSON.stringify(['kaizo', 'extreme', 'full-hack'])
    },
    {
      name: 'Old Hack From 2022',
      gameid: 'old_hack_001',
      version: 1,
      gametype: 'Standard',
      author: 'OldAuthor',
      authors: 'OldAuthor',
      difficulty: 'Easy',
      added: '2022-05-20',
      section: 'Standard: Easy',
      demo: 'No',
      length: '8 exits',
      tags: JSON.stringify(['standard', 'classic'])
    }
  ];
  
  for (const game of testGames) {
    const gvuuid = crypto.randomUUID();
    const pbuuid = crypto.randomUUID();
    const auuid = crypto.randomUUID();
    
    // Insert game version
    rhdataDb.prepare(`
      INSERT INTO gameversions (
        gvuuid, gameid, name, version, pbuuid,
        gametype, author, authors, difficulty, added,
        section, demo, length, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      gvuuid, game.gameid, game.name, game.version, pbuuid,
      game.gametype, game.author, game.authors, game.difficulty, game.added,
      game.section, game.demo, game.length, game.tags
    );
    
    // Create patch data
    const testPatchData = Buffer.from(`Patch data for ${game.name} v${game.version}`);
    const pbkey = crypto.randomBytes(32).toString('hex');
    const pbiv = crypto.randomBytes(16).toString('hex');
    
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(pbkey, 'hex'), Buffer.from(pbiv, 'hex'));
    const encryptedPatch = Buffer.concat([cipher.update(testPatchData), cipher.final()]);
    
    const fileHashSha256 = crypto.createHash('sha256').update(encryptedPatch).digest('hex');
    const decodedHashSha256 = crypto.createHash('sha256').update(testPatchData).digest('hex');
    
    // Insert patchblob
    patchbinDb.prepare(`
      INSERT INTO patchblobs (pbuuid, auuid, pbkey, pbiv, decoded_hash_sha256)
      VALUES (?, ?, ?, ?, ?)
    `).run(pbuuid, auuid, pbkey, pbiv, decodedHashSha256);
    
    // Insert attachment
    patchbinDb.prepare(`
      INSERT INTO attachments (
        auuid, pbuuid, gvuuid, file_name, file_size, file_hash_sha256, file_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      auuid, pbuuid, gvuuid,
      `patch_${game.gameid}_v${game.version}.bin`,
      encryptedPatch.length,
      fileHashSha256,
      encryptedPatch
    );
    
    console.log(`  ✓ Created: ${game.name} v${game.version}`);
  }
  
  console.log();
  console.log('='.repeat(70));
  console.log('Test data created! Try these test commands:');
  console.log('='.repeat(70));
  console.log();
  
  console.log('# Test 1: Fuzzy search by name (should find both Kaizo games)');
  console.log(`node fetchpatches.js mode3 -b name Kaizo \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  
  console.log('# Test 2: Multi-criteria search (demo=No AND author=KT AND length=73)');
  console.log(`node fetchpatches.js mode3 -b demo No -b authors KT --exact -b length "73" \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  
  console.log('# Test 3: Date comparison (added in 2024)');
  console.log(`node fetchpatches.js mode3 -b added 2024 \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  
  console.log('# Test 4: Date comparison with operator (added after 2023)');
  console.log(`node fetchpatches.js mode3 -b added ">2023" \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  
  console.log('# Test 5: Numeric comparison (length less than 10 exits)');
  console.log(`node fetchpatches.js mode3 -b length "<10" \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  
  console.log('# Test 6: Regex search (names starting with "Super")');
  console.log(`node fetchpatches.js mode3 --regex -b name "^Super" \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  
  console.log('# Test 7: Tag search (find games with "kaizo" tag)');
  console.log(`node fetchpatches.js mode3 -b tags kaizo \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  
  console.log('# Test 8: Multiple tags (kaizo AND hard)');
  console.log(`node fetchpatches.js mode3 -b tags kaizo -b tags hard \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  
  console.log('# Test 9: All versions of a game (--versions)');
  console.log(`node fetchpatches.js mode3 -b gameid kaizo_world_001 --versions \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  
  console.log('# Test 10: First version only (--matchversion=first)');
  console.log(`node fetchpatches.js mode3 -b gameid kaizo_world_001 --matchversion=first \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  
  console.log('# Test 11: Previous version (--matchversion=previous)');
  console.log(`node fetchpatches.js mode3 -b gameid kaizo_world_001 --matchversion=previous \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  
  console.log('# Test 12: Multi search with highest version per gameid (--multi)');
  console.log(`node fetchpatches.js mode3 -b gametype Kaizo --multi \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  
  console.log('# Test 13: Complex multi-criteria with exact match');
  console.log(`node fetchpatches.js mode3 -b section "Kaizo: Hard" --exact -b difficulty Hard \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  
  console.log('# Test 14: Search by added date range (2024-10 or later)');
  console.log(`node fetchpatches.js mode3 -b added ">2024-09" \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  
  console.log('# Expected Results Summary:');
  console.log('# Test 1: Should find 2 games (Super Kaizo World v2, Another Kaizo Adventure)');
  console.log('# Test 2: Should find 1 game (Super Kaizo World v2)');
  console.log('# Test 3: Should find 4 games (all added in 2024)');
  console.log('# Test 4: Should find 5 games (all except Old Hack From 2022)');
  console.log('# Test 5: Should find 2 games (Easy Vanilla Hack with 5, Old Hack with 8)');
  console.log('# Test 6: Should find 2 games (both starting with "Super")');
  console.log('# Test 7: Should find 2 games (with kaizo tag)');
  console.log('# Test 8: Should find 2 games (with both kaizo and hard tags)');
  console.log('# Test 9: Should find 2 versions of kaizo_world_001');
  console.log('# Test 10: Should find version 1 of kaizo_world_001');
  console.log('# Test 11: Should find version 1 of kaizo_world_001 (previous to v2)');
  console.log('# Test 12: Should find 2 games (highest version of each Kaizo game)');
  console.log('# Test 13: Should find 2 versions of Super Kaizo World (exact section match)');
  console.log('# Test 14: Should find 2 games (Medium Puzzle and Another Kaizo Adventure)');
  console.log();
  
} catch (error) {
  console.error('✗ Error:', error.message);
  process.exit(1);
} finally {
  patchbinDb.close();
  rhdataDb.close();
}

