/**
 * Test USB2SNES List() function
 * 
 * Tests directory listing at various paths to ensure
 * the device responds correctly and doesn't timeout
 * 
 * Usage: node tests/test_usb2snes_list.js
 */

const { SNESWrapper } = require('../electron/main/usb2snes/SNESWrapper');

async function testList() {
  const wrapper = new SNESWrapper();
  
  console.log('=== USB2SNES List() Test ===\n');
  
  try {
    // Connect
    console.log('1. Connecting to USB2SNES...');
    const connectResult = await wrapper.fullConnect('usb2snes_a', 'ws://localhost:64213');
    console.log('✓ Connected:', connectResult.device);
    console.log('');
    
    // Test 1: List /work
    console.log('2. Testing List("/work")...');
    const startTime1 = Date.now();
    const files1 = await wrapper.List('/work');
    const elapsed1 = Date.now() - startTime1;
    console.log(`✓ List succeeded (${elapsed1}ms)`);
    console.log(`   Found ${files1 ? files1.length : 0} items:`, files1);
    console.log('');
    
    // Test 2: List non-existent directory
    console.log('3. Testing List("/work/nonexistent")...');
    const startTime2 = Date.now();
    try {
      const files2 = await wrapper.List('/work/nonexistent');
      const elapsed2 = Date.now() - startTime2;
      console.log(`✓ List returned (${elapsed2}ms):`, files2);
    } catch (error) {
      const elapsed2 = Date.now() - startTime2;
      console.log(`⚠ List failed (${elapsed2}ms):`, error.message);
    }
    console.log('');
    
    // Test 3: List root
    console.log('4. Testing List("/")...');
    const startTime3 = Date.now();
    try {
      const files3 = await wrapper.List('/');
      const elapsed3 = Date.now() - startTime3;
      console.log(`✓ List succeeded (${elapsed3}ms)`);
      console.log(`   Found ${files3 ? files3.length : 0} items:`, files3);
    } catch (error) {
      const elapsed3 = Date.now() - startTime3;
      console.log(`⚠ List failed (${elapsed3}ms):`, error.message);
    }
    console.log('');
    
    // Disconnect
    console.log('5. Disconnecting...');
    await wrapper.disconnect();
    console.log('✓ Disconnected');
    
    console.log('\n=== All List() Tests Complete ===');
    process.exit(0);
    
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  }
}

testList();

