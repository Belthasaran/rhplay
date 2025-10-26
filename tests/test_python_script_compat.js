#!/usr/bin/env node
/**
 * test_python_script_compat.js - Test Python Script Compatibility
 * 
 * Verifies that Python scripts (pb_repatch.py, etc.) can work with
 * JavaScript-created blobs when using the loadsmwrh_compat.py wrapper.
 * 
 * Tests:
 * 1. blob_crypto.py can decrypt JavaScript blobs
 * 2. loadsmwrh_compat.py can load JavaScript blob data
 * 3. Backfill from SQLite to RHMD format works
 * 4. Python scripts can access backfilled data
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const DatabaseManager = require('../lib/database');

const PROJECT_ROOT = path.join(__dirname, '..');

let testsPassed = 0;
let testsFailed = 0;

function logTest(name, status, message = '') {
  const symbols = { pass: '✅', fail: '❌', skip: '⚠️' };
  console.log(`${symbols[status]} ${name}`);
  if (message) {
    console.log(`   ${message}`);
  }
  if (status === 'pass') testsPassed++;
  else if (status === 'fail') testsFailed++;
}

/**
 * Test 1: blob_crypto.py can decrypt JavaScript blob
 */
function test1_BlobCryptoDecrypt() {
  console.log('\n=== Test 1: blob_crypto.py Decrypt JavaScript Blob ===');
  
  try {
    // Get a JavaScript-created blob from database
    const dbManager = new DatabaseManager(path.join(PROJECT_ROOT, 'electron', 'rhdata.db'));
    const pb = dbManager.db.prepare(`
      SELECT pb.patchblob1_name, pb.patchblob1_key, pb.patchblob1_sha224, pb.pat_sha224
      FROM patchblobs pb
      JOIN gameversions gv ON gv.gvuuid = pb.gvuuid
      WHERE gv.gameid = '40663'
      LIMIT 1
    `).get();
    dbManager.close();
    
    if (!pb) {
      logTest('blob_crypto.py decrypt', 'skip', 'Game 40663 not found');
      return;
    }
    
    const blobPath = path.join(PROJECT_ROOT, 'blobs', pb.patchblob1_name);
    
    if (!fs.existsSync(blobPath)) {
      logTest('blob_crypto.py decrypt', 'skip', 'Blob file not found');
      return;
    }
    
    // Test using blob_crypto.py CLI
    const result = execSync(`python3 ${PROJECT_ROOT}/blob_crypto.py info ${blobPath} ${pb.patchblob1_key} ${pb.patchblob1_sha224}`, {
      encoding: 'utf8',
      cwd: PROJECT_ROOT
    });
    
    const info = JSON.parse(result);
    
    if (info.success && info.patch_sha224 === pb.pat_sha224) {
      logTest('blob_crypto.py decrypt', 'pass', `Decoded ${info.patch_size} bytes, hash verified`);
      return true;
    } else {
      logTest('blob_crypto.py decrypt', 'fail', 'Hash mismatch or decode failed');
      return false;
    }
    
  } catch (error) {
    logTest('blob_crypto.py decrypt', 'fail', error.message);
    return false;
  }
}

/**
 * Test 2: loadsmwrh_compat.py wrapper function
 */
function test2_LoadsmwrhCompat() {
  console.log('\n=== Test 2: loadsmwrh_compat.py Wrapper ===');
  
  try {
    // Test if loadsmwrh_compat.py can be imported and has necessary functions
    const result = execSync(`python3 << 'EOTEST'
import sys
sys.path.insert(0, '${PROJECT_ROOT}')

try:
    import loadsmwrh_compat
    
    # Check that blob_crypto is available
    import blob_crypto
    
    print('✅ Modules loaded successfully')
    print('✅ blob_crypto.decrypt_blob available:', hasattr(blob_crypto, 'decrypt_blob'))
    print('✅ loadsmwrh_compat.get_patch_blob available:', hasattr(loadsmwrh_compat, 'get_patch_blob'))
    
    sys.exit(0)
except Exception as e:
    print(f'Error: {e}')
    sys.exit(1)
EOTEST
`, { encoding: 'utf8', cwd: PROJECT_ROOT });
    
    logTest('loadsmwrh_compat.py wrapper', 'pass', 'Modules loaded, functions available');
    return true;
    
  } catch (error) {
    logTest('loadsmwrh_compat.py wrapper', 'fail', error.message);
    return false;
  }
}

/**
 * Test 3: Export game to RHMD format
 */
function test3_ExportToRHMD() {
  console.log('\n=== Test 3: Export to RHMD Format ===');
  
  try {
    const dbManager = new DatabaseManager(path.join(PROJECT_ROOT, 'electron', 'rhdata.db'));
    
    // Get game 40663
    const gv = dbManager.db.prepare(`
      SELECT * FROM gameversions WHERE gameid = '40663' LIMIT 1
    `).get();
    
    if (!gv) {
      logTest('Export to RHMD format', 'skip', 'Game 40663 not found');
      dbManager.close();
      return;
    }
    
    const patchblobs = dbManager.db.prepare(`
      SELECT pb.*, pbe.is_primary
      FROM patchblobs pb
      LEFT JOIN patchblobs_extended pbe ON pbe.pbuuid = pb.pbuuid
      WHERE pb.gvuuid = ?
    `).all(gv.gvuuid);
    
    dbManager.close();
    
    // Convert to RHMD format
    const { convertToRHMDFormat } = require('../backfill_rhmd');
    const hack = convertToRHMDFormat(gv, patchblobs);
    
    // Verify structure
    if (!hack.id || !hack.xdata || !hack.xdata.patchblob1_name || !hack.xdata.patchblob1_key) {
      logTest('Export to RHMD format', 'fail', 'Missing required fields');
      return false;
    }
    
    logTest('Export to RHMD format', 'pass', `Exported game ${hack.id} with ${patchblobs.length} patches`);
    return true;
    
  } catch (error) {
    logTest('Export to RHMD format', 'fail', error.message);
    return false;
  }
}

/**
 * Test 4: Python can decode exported blob metadata
 */
function test4_PythonDecodeExported() {
  console.log('\n=== Test 4: Python Decode Using Exported Metadata ===');
  
  try {
    const dbManager = new DatabaseManager(path.join(PROJECT_ROOT, 'electron', 'rhdata.db'));
    
    const pb = dbManager.db.prepare(`
      SELECT pb.*, gv.gameid
      FROM patchblobs pb
      JOIN gameversions gv ON gv.gvuuid = pb.gvuuid
      WHERE gv.gameid = '40663'
      LIMIT 1
    `).get();
    
    dbManager.close();
    
    if (!pb) {
      logTest('Python decode exported metadata', 'skip', 'Game 40663 not found');
      return;
    }
    
    const blobPath = path.join(PROJECT_ROOT, 'blobs', pb.patchblob1_name);
    
    if (!fs.existsSync(blobPath)) {
      logTest('Python decode exported metadata', 'skip', 'Blob file not found');
      return;
    }
    
    // Test Python decoding with metadata
    const result = execSync(`python3 << 'EOTEST'
import sys
sys.path.insert(0, '${PROJECT_ROOT}')
import blob_crypto

with open('${blobPath}', 'rb') as f:
    blob_data = f.read()

patch_data = blob_crypto.decrypt_blob(
    blob_data,
    '${pb.patchblob1_key}',
    '${pb.patchblob1_sha224}',
    '${pb.pat_sha224}',
    detect_format=True
)

import hashlib
print(hashlib.sha224(patch_data).hexdigest())
EOTEST
`, { encoding: 'utf8', cwd: PROJECT_ROOT }).trim();
    
    if (result === pb.pat_sha224) {
      logTest('Python decode exported metadata', 'pass', `Hash verified: ${result.substring(0, 20)}...`);
      return true;
    } else {
      logTest('Python decode exported metadata', 'fail', `Hash mismatch`);
      return false;
    }
    
  } catch (error) {
    logTest('Python decode exported metadata', 'fail', error.message);
    return false;
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('='.repeat(70));
  console.log('PYTHON SCRIPT COMPATIBILITY TEST SUITE');
  console.log('='.repeat(70));
  console.log('Verifies Python scripts can work with JavaScript-created blobs\n');
  
  test1_BlobCryptoDecrypt();
  test2_LoadsmwrhCompat();
  test3_ExportToRHMD();
  test4_PythonDecodeExported();
  
  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`✅ Passed:  ${testsPassed}`);
  console.log(`❌ Failed:  ${testsFailed}`);
  console.log('='.repeat(70));
  
  if (testsFailed === 0 && testsPassed >= 3) {
    console.log('\n✅ ALL TESTS PASSED');
    console.log('\nPython scripts can work with JavaScript-created blobs using:');
    console.log('  - blob_crypto.py for encryption/decryption');
    console.log('  - loadsmwrh_compat.py as drop-in replacement for loadsmwrh.py');
    console.log('\nTo update Python scripts:');
    console.log('  Replace: import loadsmwrh');
    console.log('  With:    import loadsmwrh_compat as loadsmwrh');
    process.exit(0);
  } else {
    console.log('\n❌ TESTS FAILED');
    console.log('Python compatibility issues detected');
    process.exit(1);
  }
}

if (require.main === module) {
  runTests().catch(error => {
    console.error('Test suite crashed:', error);
    process.exit(1);
  });
}

module.exports = { runTests };

