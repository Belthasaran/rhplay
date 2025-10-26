/**
 * Test USB2SNES MakeDir() followed by PutFile()
 * 
 * This replicates the exact scenario from run upload:
 * 1. MakeDir to create subdirectory
 * 2. PutFile multiple files to that subdirectory
 * 
 * Tests whether the connection survives MakeDir+List operations
 * 
 * Usage: node tests/test_usb2snes_mkdir_then_upload.js
 * 
 * WARNING: Creates test directory and files on your SNES device
 */

const { SNESWrapper } = require('../electron/main/usb2snes/SNESWrapper');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testMakeDirThenUpload() {
  const wrapper = new SNESWrapper();
  
  console.log('=== USB2SNES MakeDir + PutFile Test ===\n');
  
  // Create 3 test files
  const tmpDir = os.tmpdir();
  const timestamp = Date.now();
  const testFiles = [];
  
  for (let i = 1; i <= 3; i++) {
    const filename = `test${String(i).padStart(2, '0')}.sfc`;
    const filepath = path.join(tmpDir, filename);
    const data = Buffer.alloc(1024 * 256, i);  // 256KB per file
    fs.writeFileSync(filepath, data);
    testFiles.push({ local: filepath, name: filename, size: data.length });
  }
  console.log(`Created ${testFiles.length} test files (256KB each)\n`);
  
  try {
    // Connect
    console.log('1. Connecting to USB2SNES...');
    const connectResult = await wrapper.fullConnect('usb2snes_a', 'ws://localhost:64213');
    console.log('✓ Connected:', connectResult.device);
    console.log('   State:', wrapper.getState(), 'isAttached:', wrapper.isAttached());
    console.log('');
    
    // Test: Create directory and upload files
    const testSubDir = `/work/rhtools_test_${timestamp}`;
    
    console.log(`2. Creating directory: ${testSubDir}`);
    const startTime1 = Date.now();
    try {
      await wrapper.MakeDir(testSubDir);
      const elapsed1 = Date.now() - startTime1;
      console.log(`✓ MakeDir completed (${elapsed1}ms)`);
    } catch (error) {
      const elapsed1 = Date.now() - startTime1;
      console.log(`⚠ MakeDir failed (${elapsed1}ms):`, error.message);
      console.log('   Continuing anyway (directory might exist)...');
    }
    console.log('');
    
    // Critical: Check if connection is still alive after MakeDir
    console.log('3. Checking connection after MakeDir...');
    console.log('   State:', wrapper.getState(), 'isAttached:', wrapper.isAttached());
    console.log('   Socket:', wrapper.impl?.socket?.readyState === 1 ? 'OPEN' : 'CLOSED/UNDEFINED');
    
    if (!wrapper.isAttached()) {
      console.log('✗ CONNECTION LOST AFTER MAKEDIR!');
      throw new Error('Connection lost after MakeDir - this is the bug!');
    }
    console.log('✓ Connection still alive');
    console.log('');
    
    // Small delay to let device settle
    console.log('4. Waiting 1 second for device to settle...');
    await sleep(1000);
    console.log('');
    
    // Upload files
    console.log(`5. Uploading ${testFiles.length} files to ${testSubDir}...`);
    for (let i = 0; i < testFiles.length; i++) {
      const file = testFiles[i];
      const destPath = `${testSubDir}/${file.name}`;
      
      console.log(`   [${i + 1}/${testFiles.length}] Uploading ${file.name}...`);
      const startTime = Date.now();
      
      const result = await wrapper.PutFile(file.local, destPath, (transferred, total, percent) => {
        if (percent % 25 === 0) {
          console.log(`      ${percent}% (${transferred}/${total} bytes)`);
        }
      });
      
      const elapsed = Date.now() - startTime;
      
      if (result === false) {
        console.log(`   ✗ Upload failed (${elapsed}ms)`);
        throw new Error(`Upload failed for ${file.name}`);
      }
      
      console.log(`   ✓ Upload succeeded (${elapsed}ms)`);
    }
    console.log('');
    
    // Verify all files uploaded
    console.log('6. Verifying all files uploaded...');
    const startTime5 = Date.now();
    try {
      const files = await wrapper.List(testSubDir);
      const elapsed5 = Date.now() - startTime5;
      console.log(`✓ Directory listing (${elapsed5}ms)`);
      console.log('   Files:', files);
      
      const uploadedFiles = files.filter(f => f.startsWith('test') && f.endsWith('.sfc'));
      if (uploadedFiles.length === testFiles.length) {
        console.log(`✓ All ${testFiles.length} files verified!`);
      } else {
        console.log(`⚠ Only ${uploadedFiles.length}/${testFiles.length} files found`);
      }
    } catch (error) {
      const elapsed5 = Date.now() - startTime5;
      console.log(`✗ Verification failed (${elapsed5}ms):`, error.message);
    }
    console.log('');
    
    // Cleanup local files
    testFiles.forEach(file => {
      if (fs.existsSync(file.local)) {
        fs.unlinkSync(file.local);
      }
    });
    console.log(`✓ Cleaned up ${testFiles.length} local test files`);
    console.log('');
    
    // Disconnect
    console.log('7. Disconnecting...');
    await wrapper.disconnect();
    console.log('✓ Disconnected');
    
    console.log('\n=== All Tests Complete ===');
    console.log('\nNOTE: Test directory created on SNES:', testSubDir);
    console.log('You can manually delete it if desired.');
    process.exit(0);
    
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    
    // Cleanup local files
    testFiles.forEach(file => {
      if (fs.existsSync(file.local)) {
        fs.unlinkSync(file.local);
      }
    });
    
    process.exit(1);
  }
}

testMakeDirThenUpload();

