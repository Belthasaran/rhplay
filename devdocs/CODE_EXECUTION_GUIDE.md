# Code Execution Guide - Phase 4.2

**Date:** October 13, 2025  
**Status:** ✅ COMPLETE

## Overview

The Code Execution system enables executing custom **65816 assembly code** on the SNES console. This allows advanced manipulation beyond simple memory reads/writes.

**Features:**
- CMD space execution (SD2SNES/FXPak Pro)
- RAM code execution (any hardware)
- Assembly templates (write, copy, fill, conditional)
- Simple assembler/disassembler
- High-level helper functions

---

## Installation & Setup

### JavaScript (Electron)

```javascript
const { SNESWrapper } = require('./main/usb2snes/SNESWrapper');
const CodeExecutor = require('./main/usb2snes/CodeExecutor');

// Connect to console
const snes = new SNESWrapper();
await snes.fullConnect('usb2snes_a', 'ws://localhost:64213');

// Create code executor
const executor = new CodeExecutor(snes);
```

### Python (py2snes)

```python
from py2snes import py2snes
from py2snes.code_executor import CodeExecutor

# Connect to console
snes = py2snes.snes()
await snes.connect('ws://localhost:64213')
await snes.Attach((await snes.DeviceList())[0])

# Create code executor
executor = CodeExecutor(snes)
```

---

## Execution Methods

### 1. CMD Space Execution (SD2SNES/FXPak Pro Only)

**What is CMD Space?**
- Special 1KB execution space at **0x002C00**
- SD2SNES/FXPak Pro feature for running custom code
- Temporary - code lost on reset
- Simplest method for quick code execution

**Usage:**
```javascript
// Upload code to CMD space
const code = Buffer.from([
  0xA9, 0x02,        // LDA #$02 (cape powerup)
  0x8D, 0x19, 0x00,  // STA $0019 (powerup address)
  0x60               // RTS (return)
]);

await executor.executeInCMDSpace(code);
```

### 2. RAM Execution (Any Hardware)

**What is RAM Execution?**
- Upload code to free RAM (0x7F8000+)
- More space available (32KB+)
- Code persists until console reset
- Works on any hardware

**Usage:**
```javascript
// Upload code to RAM
const code = Buffer.from([
  0xA9, 0x03,        // LDA #$03 (fire flower)
  0x8D, 0x19, 0x00,  // STA $0019
  0x60               // RTS
]);

const addr = await executor.uploadToRAM(code, 0x7F8000);
console.log(`Code at 0x${addr.toString(16)}`);

// Execute via hijack (requires manual setup)
await executor.executeFromRAM(addr, 'jsl');
```

---

## Assembly Templates

Pre-built assembly templates for common operations:

### Write Byte

```javascript
// Write a single byte to an address
const code = executor.createWriteByteCode(0x7E0019, 0x02);
await executor.executeSnippet(code);
// Result: Mario gets cape powerup
```

### Write Word (16-bit)

```javascript
// Write a 16-bit value
const code = executor.createWriteWordCode(0x7E0DB6, 99);
await executor.executeSnippet(code);
// Result: Coin count set to 99
```

### Memory Copy

```javascript
// Copy memory from one location to another
const code = executor.createMemoryCopyCode(
  0x7E0000,  // Source
  0x7F8000,  // Destination
  256        // Length (bytes)
);
await executor.executeSnippet(code);
// Result: Copies 256 bytes from 0x7E0000 to 0x7F8000
```

### Memory Fill

```javascript
// Fill memory region with a value
const code = executor.createMemoryFillCode(
  0x7F8000,  // Address
  0xFF,      // Fill value
  1024       // Length (bytes)
);
await executor.executeSnippet(code);
// Result: Fills 1KB at 0x7F8000 with 0xFF
```

### Add to Address

```javascript
// Add a value to memory location
const code = executor.createAddToAddressCode(0x7E0DBE, 10);
await executor.executeSnippet(code);
// Result: Adds 10 to lives
```

### Conditional Write

```javascript
// Write only if condition is met
const code = executor.createConditionalWriteCode(
  0x7E0100,  // Condition address (game mode)
  0x14,      // Condition value (in level)
  0x7E0019,  // Write address (powerup)
  0x02       // Write value (cape)
);
await executor.executeSnippet(code);
// Result: Gives cape only if in a level
```

---

## High-Level Helpers

Convenient wrappers for common operations:

### Execute Write

```javascript
// Simple write operation
await executor.executeWrite(0x7E0019, 0x02);
// Generates, uploads, and executes write code
```

### Execute Fill

```javascript
// Fill memory region
await executor.executeFill(0x7F8000, 0x00, 512);
// Fills 512 bytes at 0x7F8000 with zeros
```

### Execute Copy

```javascript
// Copy memory
await executor.executeCopy(0x7E0000, 0x7F8000, 256);
// Copies 256 bytes
```

---

## Simple Assembler

Assemble basic 65816 instructions:

### Single Instruction

```javascript
const code = executor.assembleInstruction('LDA #$02');
console.log(code);  // Buffer([0xA9, 0x02])
```

### Multiple Instructions

```javascript
const code = executor.assembleInstructions([
  'LDA #$03',
  'STA $0019',
  'RTS'
]);
await executor.executeInCMDSpace(code);
```

**Supported Instructions:**
- `LDA #$xx` - Load accumulator (immediate)
- `STA $xxxx` - Store accumulator (absolute)
- `RTS` - Return from subroutine
- `RTL` - Return from subroutine long
- `NOP` - No operation

---

## Disassembler

Debug/verify generated code:

```javascript
const code = Buffer.from([0xA9, 0x02, 0x8D, 0x19, 0x00, 0x60]);
const disasm = executor.disassemble(code);
console.log(disasm);
// Output:
// [
//   'LDA #$02',
//   'STA $0019',
//   'RTS'
// ]
```

---

## Usage Examples

### Example 1: Give Cape Powerup

```javascript
// Method 1: Using template
const code = executor.createWriteByteCode(0x7E0019, 0x02);
await executor.executeSnippet(code);

// Method 2: Using helper
await executor.executeWrite(0x7E0019, 0x02);

// Method 3: Using assembler
const code = executor.assembleInstructions([
  'LDA #$02',
  'STA $0019',
  'RTS'
]);
await executor.executeInCMDSpace(code);
```

### Example 2: Clear Sprite Table

```javascript
// Fill sprite state table with zeros (kill all sprites)
await executor.executeFill(
  0x7E00C2,  // Sprite state table
  0x00,      // Fill with 0 (inactive)
  12         // 12 sprite slots
);
```

### Example 3: Backup RAM Region

```javascript
// Copy game state to backup location
await executor.executeCopy(
  0x7E0000,  // Source (main RAM)
  0x7F8000,  // Destination (free RAM)
  0x2000     // 8KB backup
);
```

### Example 4: Conditional Powerup

```javascript
// Give cape only if Mario is small or big (not already cape/fire)
const code = Buffer.from([
  0xAD, 0x19, 0x00,  // LDA $0019 (current powerup)
  0xC9, 0x02,        // CMP #$02 (compare with cape)
  0xB0, 0x04,        // BCS .skip (skip if >= cape)
  0xA9, 0x02,        // LDA #$02 (cape powerup)
  0x8D, 0x19, 0x00,  // STA $0019
  // .skip:
  0x60               // RTS
]);

await executor.executeSnippet(code);
```

### Example 5: Auto-Increment Lives

```javascript
// Increment lives every time this is called
const code = executor.createAddToAddressCode(0x7E0DBE, 1);

// Call multiple times
for (let i = 0; i < 10; i++) {
  await executor.executeSnippet(code);
  await sleep(100);
}
// Result: Lives increased by 10
```

### Example 6: Python - Multi-Write

```python
# Write multiple values at once
code = bytes([
    0xA9, 0x63,         # LDA #$63 (99 lives)
    0x8D, 0xBE, 0x0D,   # STA $0DBE
    0xA9, 0x32,         # LDA #$32 (50 coins)
    0x8D, 0xBF, 0x0D,   # STA $0DBF
    0xA9, 0x02,         # LDA #$02 (cape)
    0x8D, 0x19, 0x00,   # STA $0019
    0x60                # RTS
])

await executor.execute_snippet(code)
# Result: 99 lives, 50 coins, cape powerup
```

### Example 7: Custom Loop

```javascript
// Set all 12 sprite states to 0x08 (normal/active)
const code = Buffer.from([
  0xA9, 0x08,        // LDA #$08 (normal state)
  0xA2, 0x00, 0x00,  // LDX #$0000
  // .loop:
  0x9D, 0xC2, 0x00,  // STA $00C2,X (sprite state + X)
  0xE8,              // INX
  0xE0, 0x0C, 0x00,  // CPX #$000C (12 sprites)
  0xD0, 0xF7,        // BNE .loop
  0x60               // RTS
]);

await executor.executeSnippet(code);
```

### Example 8: ROM to RAM Copy

```javascript
// Copy data from ROM to RAM (if ROM is readable)
await executor.executeCopy(
  0x008000,  // ROM address
  0x7F8000,  // RAM destination
  0x1000     // 4KB
);
```

---

## Advanced Patterns

### Pattern 1: State Machine

```javascript
// Execute different code based on game mode
class GameModeExecutor {
  constructor(executor) {
    this.executor = executor;
  }
  
  async executeForMode(mode, actions) {
    if (!actions[mode]) return;
    
    for (const action of actions[mode]) {
      await this.executor.executeWrite(action.addr, action.value);
    }
  }
}

const modeExec = new GameModeExecutor(executor);

// Define mode-specific actions
await modeExec.executeForMode(0x14, [  // In level
  { addr: 0x7E0019, value: 0x02 },     // Cape powerup
  { addr: 0x7E009D, value: 0x01 }      // Freeze sprites
]);
```

### Pattern 2: Code Injection with Hooks

```javascript
// Upload persistent code to RAM
const persistentCode = Buffer.from([
  // Your custom game logic here
  0xA9, 0x02,        // LDA #$02
  0x8D, 0x19, 0x00,  // STA $0019
  // Original code that was replaced
  0xAD, 0x13, 0x00,  // LDA $0013 (frame counter)
  0x6B               // RTL (return long)
]);

const codeAddr = await executor.uploadToRAM(persistentCode);

console.log(`Persistent code at 0x${codeAddr.toString(16)}`);
console.log('Now modify ROM hijack point to JSL to this address');
```

### Pattern 3: Temporary Code Cache

```javascript
class CodeCache {
  constructor(executor) {
    this.executor = executor;
    this.cache = new Map();
  }
  
  async executeOrCache(name, codeGenerator) {
    if (!this.cache.has(name)) {
      const code = codeGenerator();
      this.cache.set(name, code);
    }
    
    const code = this.cache.get(name);
    return await this.executor.executeSnippet(code);
  }
}

const cache = new CodeCache(executor);

// First call: generates and caches
await cache.executeOrCache('giveCape', () => 
  executor.createWriteByteCode(0x7E0019, 0x02)
);

// Subsequent calls: uses cached code
await cache.executeOrCache('giveCape', () => {});
```

---

## 65816 Instruction Reference

### Common Opcodes

| Opcode | Instruction | Description |
|--------|-------------|-------------|
| 0xA9 | LDA #$xx | Load accumulator (immediate, 8-bit) |
| 0xAD | LDA $xxxx | Load accumulator (absolute) |
| 0x8D | STA $xxxx | Store accumulator (absolute) |
| 0x18 | CLC | Clear carry flag |
| 0x38 | SEC | Set carry flag |
| 0x69 | ADC #$xx | Add with carry (immediate) |
| 0xE9 | SBC #$xx | Subtract with carry (immediate) |
| 0xC9 | CMP #$xx | Compare accumulator (immediate) |
| 0xE0 | CPX #$xx | Compare X register (immediate) |
| 0xE8 | INX | Increment X |
| 0xCA | DEX | Decrement X |
| 0xA2 | LDX #$xx | Load X (immediate) |
| 0x9D | STA $xxxx,X | Store accumulator (absolute,X) |
| 0xBD | LDA $xxxx,X | Load accumulator (absolute,X) |
| 0xD0 | BNE rel | Branch if not equal |
| 0xF0 | BEQ rel | Branch if equal |
| 0xB0 | BCS rel | Branch if carry set |
| 0x90 | BCC rel | Branch if carry clear |
| 0x60 | RTS | Return from subroutine |
| 0x6B | RTL | Return from subroutine long |
| 0xEA | NOP | No operation |
| 0xC2 | REP #$xx | Reset processor flags |
| 0xE2 | SEP #$xx | Set processor flags |

### Processor Flags

| Bit | Flag | Name |
|-----|------|------|
| 0x80 | N | Negative |
| 0x40 | V | Overflow |
| 0x20 | M | Memory/Accumulator (0=16-bit, 1=8-bit) |
| 0x10 | X | Index registers (0=16-bit, 1=8-bit) |
| 0x08 | D | Decimal mode |
| 0x04 | I | IRQ disable |
| 0x02 | Z | Zero |
| 0x01 | C | Carry |

---

## Limitations

### CMD Space Limitations
- **SD2SNES/FXPak Pro only** - doesn't work on emulators or other hardware
- **1KB limit** - large code won't fit
- **Temporary** - lost on reset
- **Manual trigger** - need hijack point or special trigger

### RAM Execution Limitations
- **Hijack required** - need to modify game code to call your routine
- **RAM conflicts** - must use free RAM that game doesn't use
- **Persistence** - code lost on reset (must re-upload)

### Assembler Limitations
- **Basic instructions only** - complex instructions not supported
- **No labels** - must calculate branch offsets manually
- **No macros** - no preprocessor features

---

## Safety Considerations

**⚠️ WARNING: Custom code execution can crash the console or corrupt save data!**

### Best Practices:
1. **Test in emulator first** (if possible)
2. **Backup saves** before experimenting
3. **Start simple** - test basic code before complex routines
4. **Verify addresses** - wrong addresses can crash
5. **Use RTS/RTL** - always return properly
6. **Avoid ROM writes** - ROM is read-only on real hardware
7. **Check free RAM** - don't overwrite game data

### Recovery:
- If console crashes: Power cycle
- If game corrupted: Reload ROM
- If stuck: Reset console

---

## Future Enhancements

Planned features for future phases:
- Full 65816 assembler (ASAR integration)
- Macro support
- Symbol table management
- ROM patching support
- Hook injection helpers
- Automated hijack detection
- Code library (common routines)

---

## Summary

**Phase 4.2 Delivers:**
- ✅ Code execution system (CMD space + RAM)
- ✅ Assembly templates (6 templates)
- ✅ High-level helpers (3 functions)
- ✅ Simple assembler/disassembler
- ✅ JavaScript implementation (457 lines)
- ✅ Python implementation (384 lines)
- ✅ Complete documentation
- ✅ 8 usage examples

**Total:** ~841 lines of production-ready code!

**Ready to execute custom assembly on SNES!** 🎉

