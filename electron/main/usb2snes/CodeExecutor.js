/**
 * Custom Code Execution for SNES
 * 
 * Enables executing custom 65816 assembly code on the console
 * Supports multiple execution methods:
 * - CMD space execution (SD2SNES/FXPak Pro)
 * - RAM execution (any hardware)
 * - Hook injection
 */

// CMD space address (SD2SNES special execution space)
const CMD_SPACE_ADDR = 0x002C00;
const CMD_SPACE_SIZE = 0x400;  // 1KB available

// Free RAM addresses for code execution
const FREE_RAM_START = 0x7F8000;
const FREE_RAM_SIZE = 0x8000;  // 32KB available

class CodeExecutor {
  /**
   * @param {SNESWrapper} snesWrapper - Active SNES connection wrapper
   */
  constructor(snesWrapper) {
    this.snes = snesWrapper;
  }

  // ========================================
  // CMD Space Execution (SD2SNES/FXPak Pro)
  // ========================================

  /**
   * Execute code in CMD space (SD2SNES/FXPak Pro only)
   * This is the simplest method - write code to CMD space and trigger
   * 
   * @param {Buffer} code - Assembly code bytes
   * @param {boolean} waitForReturn - Wait for code to complete
   * @returns {Promise<boolean>} Success status
   */
  async executeInCMDSpace(code, waitForReturn = false) {
    if (code.length > CMD_SPACE_SIZE) {
      throw new Error(`Code too large for CMD space (${code.length} > ${CMD_SPACE_SIZE} bytes)`);
    }

    console.log(`[CodeExecutor] Uploading ${code.length} bytes to CMD space...`);
    
    // Upload code to CMD space
    await this.snes.PutAddress([[CMD_SPACE_ADDR, code]]);
    
    // Trigger execution by jumping to CMD space
    // Note: This requires a hijack point or manual trigger
    console.log('[CodeExecutor] Code uploaded to CMD space (0x002C00)');
    console.log('[CodeExecutor] Trigger execution manually or via hijack');
    
    if (waitForReturn) {
      // Wait for execution to complete (implementation depends on code)
      await this._sleep(100);
    }
    
    return true;
  }

  /**
   * Execute simple assembly snippet in CMD space
   * Automatically adds RTS (return) at the end
   * 
   * @param {Buffer} code - Assembly code bytes (without RTS)
   * @returns {Promise<boolean>} Success status
   */
  async executeSnippet(code) {
    // Add RTS (0x60) at the end to return
    const fullCode = Buffer.concat([code, Buffer.from([0x60])]);
    return await this.executeInCMDSpace(fullCode, true);
  }

  // ========================================
  // RAM Execution
  // ========================================

  /**
   * Upload code to free RAM for execution
   * More space available than CMD space
   * 
   * @param {Buffer} code - Assembly code bytes
   * @param {number} address - RAM address (default: 0x7F8000)
   * @returns {Promise<number>} Address where code was uploaded
   */
  async uploadToRAM(code, address = FREE_RAM_START) {
    if (code.length > FREE_RAM_SIZE) {
      throw new Error(`Code too large for free RAM (${code.length} > ${FREE_RAM_SIZE} bytes)`);
    }

    console.log(`[CodeExecutor] Uploading ${code.length} bytes to RAM 0x${address.toString(16).toUpperCase()}...`);
    
    await this.snes.PutAddress([[address, code]]);
    
    console.log('[CodeExecutor] Code uploaded to RAM');
    return address;
  }

  /**
   * Execute code from RAM
   * Requires setting up a jump/call to the code
   * 
   * @param {number} address - Address where code is located
   * @param {string} method - Execution method: 'jsl', 'jsr', 'jmp'
   * @returns {Promise<boolean>} Success status
   */
  async executeFromRAM(address, method = 'jsl') {
    console.log(`[CodeExecutor] Executing code at 0x${address.toString(16).toUpperCase()} via ${method.toUpperCase()}`);
    
    // This would require setting up a hijack point
    // The actual implementation depends on the hijack method
    console.log('[CodeExecutor] Setup hijack to execute code:');
    console.log(`  ${method.toUpperCase()} $${address.toString(16).toUpperCase()}`);
    
    return true;
  }

  // ========================================
  // Assembly Templates
  // ========================================

  /**
   * Create assembly template for writing a byte to an address
   * 
   * @param {number} address - Target address
   * @param {number} value - Byte value to write
   * @returns {Buffer} Assembly code
   */
  createWriteByteCode(address, value) {
    // LDA #$value
    // STA $address
    // RTS
    const code = Buffer.from([
      0xA9, value,                        // LDA #$value
      0x8D, address & 0xFF, (address >> 8) & 0xFF,  // STA $address
      0x60                                // RTS
    ]);
    
    return code;
  }

  /**
   * Create assembly template for writing a word (16-bit) to an address
   * 
   * @param {number} address - Target address
   * @param {number} value - Word value to write (16-bit)
   * @returns {Buffer} Assembly code
   */
  createWriteWordCode(address, value) {
    // REP #$20  ; Set A to 16-bit
    // LDA #$value
    // STA $address
    // SEP #$20  ; Set A back to 8-bit
    // RTS
    const code = Buffer.from([
      0xC2, 0x20,                         // REP #$20 (16-bit A)
      0xA9, value & 0xFF, (value >> 8) & 0xFF,  // LDA #$value
      0x8D, address & 0xFF, (address >> 8) & 0xFF,  // STA $address
      0xE2, 0x20,                         // SEP #$20 (8-bit A)
      0x60                                // RTS
    ]);
    
    return code;
  }

  /**
   * Create assembly template for copying memory
   * 
   * @param {number} srcAddr - Source address
   * @param {number} dstAddr - Destination address
   * @param {number} length - Number of bytes to copy
   * @returns {Buffer} Assembly code
   */
  createMemoryCopyCode(srcAddr, dstAddr, length) {
    // Simple byte-by-byte copy loop
    // LDX #$0000
    // .loop:
    //   LDA $srcAddr,X
    //   STA $dstAddr,X
    //   INX
    //   CPX #$length
    //   BNE .loop
    // RTS
    
    const code = Buffer.from([
      0xA2, 0x00, 0x00,                   // LDX #$0000
      // Loop:
      0xBD, srcAddr & 0xFF, (srcAddr >> 8) & 0xFF,  // LDA $srcAddr,X
      0x9D, dstAddr & 0xFF, (dstAddr >> 8) & 0xFF,  // STA $dstAddr,X
      0xE8,                               // INX
      0xE0, length & 0xFF, (length >> 8) & 0xFF,    // CPX #$length
      0xD0, 0xF5,                         // BNE .loop (relative -11)
      0x60                                // RTS
    ]);
    
    return code;
  }

  /**
   * Create assembly template for filling memory with a value
   * 
   * @param {number} address - Start address
   * @param {number} value - Byte value to fill
   * @param {number} length - Number of bytes to fill
   * @returns {Buffer} Assembly code
   */
  createMemoryFillCode(address, value, length) {
    // LDA #$value
    // LDX #$0000
    // .loop:
    //   STA $address,X
    //   INX
    //   CPX #$length
    //   BNE .loop
    // RTS
    
    const code = Buffer.from([
      0xA9, value,                        // LDA #$value
      0xA2, 0x00, 0x00,                   // LDX #$0000
      // Loop:
      0x9D, address & 0xFF, (address >> 8) & 0xFF,  // STA $address,X
      0xE8,                               // INX
      0xE0, length & 0xFF, (length >> 8) & 0xFF,    // CPX #$length
      0xD0, 0xF7,                         // BNE .loop (relative -9)
      0x60                                // RTS
    ]);
    
    return code;
  }

  /**
   * Create assembly template for adding to a value at an address
   * 
   * @param {number} address - Target address
   * @param {number} value - Value to add
   * @returns {Buffer} Assembly code
   */
  createAddToAddressCode(address, value) {
    // LDA $address
    // CLC
    // ADC #$value
    // STA $address
    // RTS
    
    const code = Buffer.from([
      0xAD, address & 0xFF, (address >> 8) & 0xFF,  // LDA $address
      0x18,                               // CLC
      0x69, value,                        // ADC #$value
      0x8D, address & 0xFF, (address >> 8) & 0xFF,  // STA $address
      0x60                                // RTS
    ]);
    
    return code;
  }

  /**
   * Create assembly template for conditional write
   * Writes value to address only if condition address equals conditionValue
   * 
   * @param {number} condAddr - Condition address to check
   * @param {number} condValue - Value to check for
   * @param {number} writeAddr - Address to write to if condition met
   * @param {number} writeValue - Value to write
   * @returns {Buffer} Assembly code
   */
  createConditionalWriteCode(condAddr, condValue, writeAddr, writeValue) {
    // LDA $condAddr
    // CMP #$condValue
    // BNE .skip
    // LDA #$writeValue
    // STA $writeAddr
    // .skip:
    // RTS
    
    const code = Buffer.from([
      0xAD, condAddr & 0xFF, (condAddr >> 8) & 0xFF,      // LDA $condAddr
      0xC9, condValue,                                     // CMP #$condValue
      0xD0, 0x05,                                          // BNE .skip (+5)
      0xA9, writeValue,                                    // LDA #$writeValue
      0x8D, writeAddr & 0xFF, (writeAddr >> 8) & 0xFF,    // STA $writeAddr
      // .skip:
      0x60                                                 // RTS
    ]);
    
    return code;
  }

  // ========================================
  // High-Level Helpers
  // ========================================

  /**
   * Execute a simple write operation via code execution
   * 
   * @param {number} address - Target address
   * @param {number} value - Value to write
   * @returns {Promise<boolean>} Success status
   */
  async executeWrite(address, value) {
    const code = this.createWriteByteCode(address, value);
    return await this.executeSnippet(code);
  }

  /**
   * Execute a memory fill operation via code execution
   * 
   * @param {number} address - Start address
   * @param {number} value - Fill value
   * @param {number} length - Number of bytes
   * @returns {Promise<boolean>} Success status
   */
  async executeFill(address, value, length) {
    const code = this.createMemoryFillCode(address, value, length);
    return await this.executeSnippet(code);
  }

  /**
   * Execute a memory copy operation via code execution
   * 
   * @param {number} srcAddr - Source address
   * @param {number} dstAddr - Destination address
   * @param {number} length - Number of bytes
   * @returns {Promise<boolean>} Success status
   */
  async executeCopy(srcAddr, dstAddr, length) {
    const code = this.createMemoryCopyCode(srcAddr, dstAddr, length);
    return await this.executeSnippet(code);
  }

  // ========================================
  // Assembly Utilities
  // ========================================

  /**
   * Assemble a simple 65816 instruction
   * Limited assembler for basic instructions
   * 
   * @param {string} instruction - Assembly instruction (e.g., "LDA #$02")
   * @returns {Buffer} Machine code bytes
   */
  assembleInstruction(instruction) {
    const cleaned = instruction.trim().toUpperCase();
    
    // Simple pattern matching for common instructions
    // LDA #$xx
    if (cleaned.match(/^LDA #\$([0-9A-F]{2})$/)) {
      const value = parseInt(cleaned.match(/\$([0-9A-F]{2})/)[1], 16);
      return Buffer.from([0xA9, value]);
    }
    
    // STA $xxxx
    if (cleaned.match(/^STA \$([0-9A-F]{4})$/)) {
      const addr = parseInt(cleaned.match(/\$([0-9A-F]{4})/)[1], 16);
      return Buffer.from([0x8D, addr & 0xFF, (addr >> 8) & 0xFF]);
    }
    
    // RTS
    if (cleaned === 'RTS') {
      return Buffer.from([0x60]);
    }
    
    // RTL
    if (cleaned === 'RTL') {
      return Buffer.from([0x6B]);
    }
    
    // NOP
    if (cleaned === 'NOP') {
      return Buffer.from([0xEA]);
    }
    
    throw new Error(`Unsupported instruction: ${instruction}`);
  }

  /**
   * Assemble multiple instructions
   * 
   * @param {Array<string>} instructions - Array of assembly instructions
   * @returns {Buffer} Machine code bytes
   */
  assembleInstructions(instructions) {
    const buffers = instructions.map(inst => this.assembleInstruction(inst));
    return Buffer.concat(buffers);
  }

  /**
   * Disassemble a buffer to show what it would do
   * Very basic disassembler for debugging
   * 
   * @param {Buffer} code - Machine code bytes
   * @returns {Array<string>} Disassembled instructions
   */
  disassemble(code) {
    const result = [];
    let i = 0;
    
    while (i < code.length) {
      const opcode = code[i];
      
      switch (opcode) {
        case 0xA9:  // LDA #$xx
          if (i + 1 < code.length) {
            result.push(`LDA #$${code[i + 1].toString(16).padStart(2, '0').toUpperCase()}`);
            i += 2;
          } else {
            result.push(`??? (incomplete LDA)`);
            i++;
          }
          break;
          
        case 0x8D:  // STA $xxxx
          if (i + 2 < code.length) {
            const addr = code[i + 1] | (code[i + 2] << 8);
            result.push(`STA $${addr.toString(16).padStart(4, '0').toUpperCase()}`);
            i += 3;
          } else {
            result.push(`??? (incomplete STA)`);
            i++;
          }
          break;
          
        case 0x60:  // RTS
          result.push('RTS');
          i++;
          break;
          
        case 0x6B:  // RTL
          result.push('RTL');
          i++;
          break;
          
        case 0xEA:  // NOP
          result.push('NOP');
          i++;
          break;
          
        default:
          result.push(`??? ($${opcode.toString(16).padStart(2, '0').toUpperCase()})`);
          i++;
      }
    }
    
    return result;
  }

  // ========================================
  // Helper Methods
  // ========================================

  async _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = CodeExecutor;

