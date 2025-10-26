/**
 * Test USB2SNES MakeDir() function
 * 
 * Tests directory creation and verifies it doesn't
 * cause timeouts or connection closures
 * 
 * Usage: node tests/test_usb2snes_mkdir.js
 * 
 * WARNING: Creates test directories on your SNES device
 * Cleanup: Remove /work/rhtools_test_* directories after running
 */

const { SNESWrapper } = require('../electron/main/usb2snes/SNESWrapper');

async function testMakeDir() {
  const wrapper = new SNESWrapper();
  
  console.log('=== USB2SNES MakeDir() Test ===\n');
  
  try {
    // Connect
    console.log('1. Connecting to USB2SNES...');
    const connectResult = await wrapper.fullConnect('usb2snes_a', 'ws://localhost:64213');
    console.log('✓ Connected:', connectResult.device);
    console.log('');
    
    // Generate unique test directory name
    const timestamp = Date.now();
    const testDir = `/work/rhtools_test_${timestamp}`;
    
    // Test 1: Create directory WITHOUT verification
    console.log(`2. Creating test directory (no verify): ${testDir}`);
    const startTime1 = Date.now();
    try {
      await wrapper.MakeDir(testDir, false);  // verify = false
      const elapsed1 = Date.now() - startTime1;
      console.log(`✓ MakeDir succeeded (${elapsed1}ms)`);
    } catch (error) {
      const elapsed1 = Date.now() - startTime1;
      console.log(`✗ MakeDir failed (${elapsed1}ms):`, error.message);
      throw error;
    }
    console.log('');
    
    // Test 2: Verify directory was created by listing it
    console.log(`3. Verifying directory exists: ${testDir}`);
    const startTime2 = Date.now();
    try {
      const files = await wrapper.List(testDir);
      const elapsed2 = Date.now() - startTime2;
      console.log(`✓ Directory exists (${elapsed2}ms)`);
      console.log('   Contents:', files);
    } catch (error) {
      const elapsed2 = Date.now() - startTime2;
      console.log(`⚠ Verification failed (${elapsed2}ms):`, error.message);
    }
    console.log('');
    
    // Test 3: Try creating same directory again WITH verification
    console.log(`4. Creating same directory again WITH verification: ${testDir}`);
    const startTime3 = Date.now();
    try {
      await wrapper.MakeDir(testDir, true);  // verify = true
      const elapsed3 = Date.now() - startTime3;
      console.log(`✓ MakeDir with verification succeeded (${elapsed3}ms)`);
    } catch (error) {
      const elapsed3 = Date.now() - startTime3;
      console.log(`⚠ MakeDir failed (${elapsed3}ms):`, error.message);
    }
    console.log('');
    
    // Test 4: Check connection is still alive
    console.log(`5. Checking connection still alive...`);
    const startTime4 = Date.now();
    try {
      const files = await wrapper.List('/work');
      const elapsed4 = Date.now() - startTime4;
      
      if (files === null) {
        console.log(`✗ List returned null (${elapsed4}ms) - connection may be dead`);
        console.log('   State:', wrapper.getState(), 'isAttached:', wrapper.isAttached());
        throw new Error('List returned null - connection lost after MakeDir');
      }
      
      console.log(`✓ Connection alive (${elapsed4}ms), found ${files.length} items in /work`);
    } catch (error) {
      const elapsed4 = Date.now() - startTime4;
      console.log(`✗ Connection dead (${elapsed4}ms):`, error.message);
      throw error;
    }
    console.log('');
    
    // Disconnect
    console.log('6. Disconnecting...');
    await wrapper.disconnect();
    console.log('✓ Disconnected');
    
    console.log('\n=== All MakeDir() Tests Complete ===');
    console.log('\nNOTE: Test directory created at:', testDir);
    console.log('You can manually delete it if desired.');
    process.exit(0);
    
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  }
}

testMakeDir();

