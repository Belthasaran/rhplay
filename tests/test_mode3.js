#!/usr/bin/env node

/**
 * Test Mode 3 functionality
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const TEST_DIR = path.join(__dirname, 'test_data');
const TEST_PATCHBIN_DB = path.join(TEST_DIR, 'test_patchbin.db');
const TEST_RHDATA_DB = path.join(TEST_DIR, 'test_rhdata.db');

console.log('='.repeat(70));
console.log('Mode 3 Test Setup');
console.log('='.repeat(70));
console.log();

// Check test environment
if (!fs.existsSync(TEST_PATCHBIN_DB) || !fs.existsSync(TEST_RHDATA_DB)) {
  console.error('✗ Test databases not found. Run: npm run test:setup');
  process.exit(1);
}

// Add test data for Mode 3
const patchbinDb = new Database(TEST_PATCHBIN_DB);
const rhdataDb = new Database(TEST_RHDATA_DB);

try {
  // Create test game version
  const gvuuid = crypto.randomUUID();
  const pbuuid = crypto.randomUUID();
  const auuid = crypto.randomUUID();
  
  console.log('Creating test data...');
  
  // Insert game version (using actual schema column names)
  rhdataDb.prepare(`
    INSERT INTO gameversions (gvuuid, name, gameid, version, pbuuid)
    VALUES (?, ?, ?, ?, ?)
  `).run(gvuuid, 'Test Game', 'test_game_123', 1, pbuuid);
  
  console.log('✓ Created game version');
  console.log(`  gvuuid: ${gvuuid}`);
  console.log(`  gameid: test_game_123`);
  
  // Create test patch data
  const testPatchData = Buffer.from('This is test patch content for testing Mode 3');
  const pbkey = crypto.randomBytes(32).toString('hex');
  const pbiv = crypto.randomBytes(16).toString('hex');
  
  // Encrypt the patch data
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(pbkey, 'hex'), Buffer.from(pbiv, 'hex'));
  const encryptedPatch = Buffer.concat([cipher.update(testPatchData), cipher.final()]);
  
  // Calculate hashes
  const fileHashSha256 = crypto.createHash('sha256').update(encryptedPatch).digest('hex');
  const decodedHashSha256 = crypto.createHash('sha256').update(testPatchData).digest('hex');
  
  // Insert patchblob
  patchbinDb.prepare(`
    INSERT INTO patchblobs (pbuuid, auuid, pbkey, pbiv, decoded_hash_sha256)
    VALUES (?, ?, ?, ?, ?)
  `).run(pbuuid, auuid, pbkey, pbiv, decodedHashSha256);
  
  console.log('✓ Created patchblob');
  console.log(`  pbuuid: ${pbuuid}`);
  
  // Insert attachment with file_data
  patchbinDb.prepare(`
    INSERT INTO attachments (
      auuid, pbuuid, gvuuid,
      file_name, file_size, file_hash_sha256,
      file_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    auuid,
    pbuuid,
    gvuuid,
    'test_mode3_patch.bin',
    encryptedPatch.length,
    fileHashSha256,
    encryptedPatch
  );
  
  console.log('✓ Created attachment with file_data');
  console.log(`  auuid: ${auuid}`);
  console.log(`  file_name: test_mode3_patch.bin`);
  
  // Save test info
  const testInfo = {
    gvuuid,
    pbuuid,
    auuid,
    gameid: 'test_game_123',
    file_name: 'test_mode3_patch.bin',
    original_content: testPatchData.toString(),
    decoded_hash_sha256: decodedHashSha256
  };
  
  fs.writeFileSync(
    path.join(TEST_DIR, 'test_mode3_data.json'),
    JSON.stringify(testInfo, null, 2)
  );
  
  console.log('✓ Saved test info to test_mode3_data.json');
  
  console.log();
  console.log('='.repeat(70));
  console.log('Test data created! Try these commands:');
  console.log('='.repeat(70));
  console.log();
  console.log('# View game metadata');
  console.log(`node fetchpatches.js mode3 "test_game_123" -b gameid \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  console.log('# Get raw patchblob');
  console.log(`node fetchpatches.js mode3 "test_mode3_patch.bin" -b file_name -q rawpblob \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB} \\`);
  console.log('  -o test_output_raw.bin');
  console.log();
  console.log('# Get decoded patch');
  console.log(`node fetchpatches.js mode3 "test_game_123" -b gameid -q patch \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB} \\`);
  console.log('  -o test_output_decoded.bin');
  console.log();
  console.log('# Print decoded patch');
  console.log(`node fetchpatches.js mode3 "${auuid}" -b gvuuid -q patch -p \\`);
  console.log(`  --patchbindb=${TEST_PATCHBIN_DB} \\`);
  console.log(`  --rhdatadb=${TEST_RHDATA_DB}`);
  console.log();
  
} catch (error) {
  console.error('✗ Error:', error.message);
  process.exit(1);
} finally {
  patchbinDb.close();
  rhdataDb.close();
}

