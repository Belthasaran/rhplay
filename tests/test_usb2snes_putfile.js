/**
 * Test USB2SNES PutFile() function
 * 
 * Tests file upload with directory creation and verifies
 * connection stability during and after upload
 * 
 * Usage: node tests/test_usb2snes_putfile.js
 * 
 * WARNING: Creates test files on your SNES device
 * Cleanup: Remove /work/rhtools_test_* files/directories after running
 */

const { SNESWrapper } = require('../electron/main/usb2snes/SNESWrapper');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function testPutFile() {
  const wrapper = new SNESWrapper();
  
  console.log('=== USB2SNES PutFile() Test ===\n');
  
  // Create test file
  const tmpDir = os.tmpdir();
  const testFileName = `test_${Date.now()}.sfc`;
  const testFilePath = path.join(tmpDir, testFileName);
  const testData = Buffer.alloc(1024 * 512, 0xFF);  // 512KB test file
  fs.writeFileSync(testFilePath, testData);
  console.log(`Created test file: ${testFilePath} (${testData.length} bytes)\n`);
  
  try {
    // Connect
    console.log('1. Connecting to USB2SNES...');
    const connectResult = await wrapper.fullConnect('usb2snes_a', 'ws://localhost:64213');
    console.log('✓ Connected:', connectResult.device);
    console.log('');
    
    // Test 1: Upload to /work (no subdirectory)
    console.log('2. Uploading to /work (no subdirectory)...');
    const destPath1 = `/work/${testFileName}`;
    const startTime1 = Date.now();
    try {
      const result1 = await wrapper.PutFile(testFilePath, destPath1, (transferred, total, percent) => {
        if (percent % 20 === 0) {  // Log every 20%
          console.log(`   Progress: ${percent}% (${transferred}/${total} bytes)`);
        }
      });
      const elapsed1 = Date.now() - startTime1;
      console.log(`✓ Upload succeeded (${elapsed1}ms), result:`, result1);
    } catch (error) {
      const elapsed1 = Date.now() - startTime1;
      console.log(`✗ Upload failed (${elapsed1}ms):`, error.message);
      throw error;
    }
    console.log('');
    
    // Test 2: Upload to subdirectory (directory auto-create)
    const timestamp = Date.now();
    const testSubDir = `/work/rhtools_test_${timestamp}`;
    const destPath2 = `${testSubDir}/${testFileName}`;
    
    console.log(`3. Uploading to subdirectory: ${destPath2}`);
    console.log('   (Should auto-create directory via preemptiveDirCreate)');
    const startTime2 = Date.now();
    try {
      const result2 = await wrapper.PutFile(testFilePath, destPath2, (transferred, total, percent) => {
        if (percent % 20 === 0) {  // Log every 20%
          console.log(`   Progress: ${percent}% (${transferred}/${total} bytes)`);
        }
      });
      const elapsed2 = Date.now() - startTime2;
      console.log(`✓ Upload succeeded (${elapsed2}ms), result:`, result2);
    } catch (error) {
      const elapsed2 = Date.now() - startTime2;
      console.log(`✗ Upload failed (${elapsed2}ms):`, error.message);
      throw error;
    }
    console.log('');
    
    // Test 3: Verify connection still alive after uploads
    console.log('4. Testing connection after uploads...');
    const startTime3 = Date.now();
    try {
      const files = await wrapper.List('/work');
      const elapsed3 = Date.now() - startTime3;
      console.log(`✓ Connection alive (${elapsed3}ms)`);
      console.log(`   Found ${files.length} items in /work`);
      const ourFiles = files.filter(f => f.includes('rhtools_test') || f === testFileName);
      console.log(`   Test files:`, ourFiles);
    } catch (error) {
      const elapsed3 = Date.now() - startTime3;
      console.log(`✗ Connection check failed (${elapsed3}ms):`, error.message);
      throw error;
    }
    console.log('');
    
    // Cleanup local test file
    fs.unlinkSync(testFilePath);
    console.log(`✓ Cleaned up local test file: ${testFilePath}`);
    console.log('');
    
    // Disconnect
    console.log('5. Disconnecting...');
    await wrapper.disconnect();
    console.log('✓ Disconnected');
    
    console.log('\n=== All PutFile() Tests Complete ===');
    console.log('\nNOTE: Test files created on SNES:');
    console.log(`  - ${destPath1}`);
    console.log(`  - ${destPath2}`);
    console.log('You can manually delete these if desired.');
    process.exit(0);
    
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    
    // Cleanup
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    
    process.exit(1);
  }
}

testPutFile();

