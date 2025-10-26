/**
 * Code Execution Demonstration
 * 
 * Shows how to use the CodeExecutor to run custom 65816 assembly on SNES
 * 
 * Prerequisites:
 * - QUsb2snes or USB2SNES server running
 * - SMW ROM loaded on console (or any SNES game)
 * - SD2SNES/FXPak Pro (for CMD space execution)
 */

const { SNESWrapper } = require('../electron/main/usb2snes/SNESWrapper');
const CodeExecutor = require('../electron/main/usb2snes/CodeExecutor');

async function demonstrateCodeExecution() {
  console.log('=== Code Execution Demonstration ===\n');
  
  // Connect
  console.log('Connecting to USB2SNES...');
  const snes = new SNESWrapper();
  
  try {
    await snes.fullConnect('usb2snes_a', 'ws://localhost:64213');
    console.log('✓ Connected!\n');
  } catch (error) {
    console.error('✗ Connection failed:', error.message);
    process.exit(1);
  }
  
  // Create code executor
  const executor = new CodeExecutor(snes);
  
  // ========================================
  // Demo 1: Assembly Templates
  // ========================================
  console.log('--- Demo 1: Assembly Templates ---\n');
  
  // Write byte template
  console.log('Creating write byte code...');
  const writeCode = executor.createWriteByteCode(0x7E0019, 0x02);
  console.log('Generated code:', writeCode);
  console.log('Disassembly:');
  executor.disassemble(writeCode).forEach(inst => console.log(`  ${inst}`));
  console.log();
  
  // Memory fill template
  console.log('Creating memory fill code...');
  const fillCode = executor.createMemoryFillCode(0x7F8000, 0xFF, 256);
  console.log(`Generated ${fillCode.length} bytes of code`);
  console.log('First few instructions:');
  executor.disassemble(fillCode).slice(0, 5).forEach(inst => console.log(`  ${inst}`));
  console.log();
  
  // Memory copy template
  console.log('Creating memory copy code...');
  const copyCode = executor.createMemoryCopyCode(0x7E0000, 0x7F8000, 128);
  console.log(`Generated ${copyCode.length} bytes of code`);
  console.log();
  
  // ========================================
  // Demo 2: Simple Assembler
  // ========================================
  console.log('--- Demo 2: Simple Assembler ---\n');
  
  const instructions = [
    'LDA #$02',
    'STA $0019',
    'RTS'
  ];
  
  console.log('Assembling instructions:');
  instructions.forEach(inst => console.log(`  ${inst}`));
  
  const assembled = executor.assembleInstructions(instructions);
  console.log('\nMachine code:', assembled);
  console.log('Hex:', Array.from(assembled).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
  console.log();
  
  // ========================================
  // Demo 3: Disassembler
  // ========================================
  console.log('--- Demo 3: Disassembler ---\n');
  
  const code = Buffer.from([0xA9, 0x03, 0x8D, 0x19, 0x00, 0xA9, 0x63, 0x8D, 0xBE, 0x0D, 0x60]);
  
  console.log('Machine code:', code);
  console.log('\nDisassembly:');
  executor.disassemble(code).forEach(inst => console.log(`  ${inst}`));
  console.log('\nThis code does:');
  console.log('  - Set powerup to 3 (fire flower)');
  console.log('  - Set lives to 99');
  console.log('  - Return');
  console.log();
  
  // ========================================
  // Demo 4: Upload to CMD Space
  // ========================================
  console.log('--- Demo 4: Upload to CMD Space ---\n');
  console.log('WARNING: This will upload code to console memory!');
  console.log('Press Ctrl+C to cancel, or wait 3 seconds...\n');
  
  await sleep(3000);
  
  const simpleCode = Buffer.from([
    0xA9, 0x02,        // LDA #$02
    0x8D, 0x19, 0x00,  // STA $0019
    0x60               // RTS
  ]);
  
  console.log('Uploading code to CMD space (0x002C00)...');
  await executor.executeInCMDSpace(simpleCode);
  console.log('✓ Code uploaded!');
  console.log('  (Code is now in CMD space, waiting for trigger)');
  console.log();
  
  // ========================================
  // Demo 5: Upload to RAM
  // ========================================
  console.log('--- Demo 5: Upload to RAM ---\n');
  
  const ramCode = Buffer.from([
    0xA9, 0x63,        // LDA #$63 (99)
    0x8D, 0xBE, 0x0D,  // STA $0DBE (lives)
    0x60               // RTS
  ]);
  
  console.log('Uploading code to free RAM...');
  const addr = await executor.uploadToRAM(ramCode, 0x7F8000);
  console.log(`✓ Code uploaded to 0x${addr.toString(16).toUpperCase()}`);
  console.log('  (Code is now in RAM, callable via hijack)');
  console.log();
  
  // ========================================
  // Demo 6: High-Level Helpers
  // ========================================
  console.log('--- Demo 6: High-Level Helpers ---\n');
  
  console.log('Using executeWrite helper...');
  console.log('  (Generates, uploads, and executes write code)');
  await executor.executeWrite(0x7E0019, 0x02);
  console.log('✓ Executed write: address=0x7E0019, value=0x02');
  console.log();
  
  console.log('Using executeFill helper...');
  await executor.executeFill(0x7F8000, 0x00, 512);
  console.log('✓ Executed fill: 512 bytes at 0x7F8000 with 0x00');
  console.log();
  
  console.log('Using executeCopy helper...');
  await executor.executeCopy(0x7E0000, 0x7F8100, 256);
  console.log('✓ Executed copy: 256 bytes from 0x7E0000 to 0x7F8100');
  console.log();
  
  // ========================================
  // Demo 7: Template Showcase
  // ========================================
  console.log('--- Demo 7: All Templates ---\n');
  
  const templates = {
    'Write Byte': executor.createWriteByteCode(0x7E0019, 0x02),
    'Write Word': executor.createWriteWordCode(0x7E0DB6, 99),
    'Memory Copy': executor.createMemoryCopyCode(0x7E0000, 0x7F8000, 16),
    'Memory Fill': executor.createMemoryFillCode(0x7F8000, 0xFF, 16),
    'Add to Address': executor.createAddToAddressCode(0x7E0DBE, 10),
    'Conditional Write': executor.createConditionalWriteCode(0x7E0100, 0x14, 0x7E0019, 0x02)
  };
  
  for (const [name, code] of Object.entries(templates)) {
    console.log(`${name}:`);
    console.log(`  Size: ${code.length} bytes`);
    console.log(`  First instruction: ${executor.disassemble(code)[0]}`);
  }
  console.log();
  
  // ========================================
  // Summary
  // ========================================
  console.log('=== Demo Complete! ===\n');
  console.log('Code Execution system provides:');
  console.log('  ✓ CMD space execution (SD2SNES/FXPak Pro)');
  console.log('  ✓ RAM code execution (any hardware)');
  console.log('  ✓ 6 assembly templates');
  console.log('  ✓ 3 high-level helpers');
  console.log('  ✓ Simple assembler');
  console.log('  ✓ Disassembler');
  console.log('\nSee devdocs/CODE_EXECUTION_GUIDE.md for complete documentation.');
  
  process.exit(0);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run demonstration
demonstrateCodeExecution().catch(error => {
  console.error('\n✗ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});

