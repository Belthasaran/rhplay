# CARL Module Loader - Technical Documentation

## Current Working Implementation (98% functional)

### Overview
The CARL module loader successfully injects custom ASM code into Super Mario World by hijacking a RAM-based routine that's called every frame.

### Hook Location: `$7F8000`
SMW creates a RAM routine at `$7F8000` during initialization (ROM address `$008027`). This routine is called frequently with `JSL $7F8000` and is responsible for **moving all sprites offscreen** by setting their Y coordinates to `$F0` (240 pixels, below the 224px screen height).

### The Original Routine
```asm
; Created by ROM at $008027-$00804E
$7F8000:  LDA #$F0        ; Load $F0 into accumulator (2 bytes: $A9 $F0)
$7F8002:  STA $0201       ; Store to OAM_ExtendedDispY (3 bytes: $8D $01 $02)
$7F8005:  STA $0205       ; Store to next sprite Y position
$7F8008:  STA $0209       ; ... continues for all sprites
...
$7F8182:  RTL             ; Return from subroutine (1 byte: $6B)
```

**CRITICAL**: This routine is called **many times per frame** by ROM code!

### Our Patch
We replace the first 4 bytes at `$7F8000` with a `JSL` to our trampoline:

```asm
$7F8000:  JSL $7F8300     ; Jump to trampoline (4 bytes: $22 $00 $83 $7F)
```

### Race Condition & Solution

**Problem**: SMW executes `JSL $7F8000` many times per frame. If it calls it while we're writing our 4-byte patch, it could jump to partial data → crash.

**Solution - Automatic Pause**: 
1. Upload trampoline and hook code **first** (so they're ready before we redirect)
2. **Set `$13D4` (SMW pause flag) to 1** to freeze game execution
3. Wait 100ms for pause to take effect
4. Write the patch with verification and retry (up to 3 attempts):
   - Write 4 bytes
   - Wait 50ms
   - Read back and verify
   - Retry if corrupted (should be rare now)
5. **Restore original `$13D4` value** (preserve user's pause state)

**Why This Works**:
- When `$13D4 = 1`, SMW enters pause mode and stops executing `JSL $7F8000`
- This creates a safe window to patch the code without race conditions
- The user doesn't see anything - pause/unpause happens automatically
- Original pause state is preserved (if user had game paused, it stays paused)

**Result**: Near 100% success rate on first attempt!

**Problem:** This overwrites:
- `LDA #$F0` (2 bytes)
- First 2 bytes of `STA $0201` (the opcode and low address byte)

### Trampoline at `$7F8300`
```asm
$7F8300:  JSL $7F8200     ; Call CARL module hook (all loaded modules)
$7F8304:  JSL $7F8004     ; Call original routine starting at byte 5
$7F8308:  RTL             ; Return to ROM
```

**Problem:** By jumping to `$7F8004`, we skip the first `STA $0201` instruction, which means the first extended sprite slot (OAM extended slot 0) never gets initialized to $F0. This causes **sprite artifacts** - sprites that should be hidden offscreen are visible.

### Memory Map Details

**Overwritten bytes:** `$A9 $F0 $8D $01`
- `$A9 $F0` = LDA #$F0
- `$8D $01 $02` = STA $0201 (we skip the `02` byte at position 4)

**Skipped instruction:** Setting `$0201` (OAM_ExtendedDispY slot 0) to $F0

**Impact:** Minor visual artifacts - one sprite slot is not properly initialized as offscreen

### RAM Addresses Used by CARL

| Address | Purpose | Size | Notes |
|---------|---------|------|-------|
| `$7F8000-$7F8182` | SMW's sprite-hiding routine (PATCHED at start) | ~386 bytes | **DO NOT OVERLAP** |
| `$7F8190` | CARL_INITIALIZED_FLAG (per-module init flags) | Variable | Moved to avoid conflict |
| `$7F81C0` | CARL_MODULE_TABLE (module address table) | Variable | Moved to avoid conflict |
| `$7F8200` | CARL hook code (JSL chain to modules) | Variable | Safe |
| `$7F8300` | CARL trampoline (our hook injector) | 15 bytes | Safe |
| `$7FA000+` | Loaded CARL modules | Up to 24KB | Safe |

**Critical**: The SMW routine at `$7F8000-$7F8182` must not be overwritten except for the initial 4-byte JSL patch at `$7F8000`!

### Flow Diagram

```
ROM code
  ↓ JSL $7F8000
  │ Stack: [ROM_return]
  ↓
$7F8000: JSL $7F8300 (our patch - jump to trampoline)
  │ Stack: [ROM_return, $7F8004]  ⚠️ But byte 4 is middle of STA!
  ↓
$7F8300 (Trampoline):
  ├─ JSL $7F8200 (CARL hook - all loaded modules)
  │   └─ RTL (back to trampoline)
  ├─ LDA #$F0, STA $0201 (execute overwritten instruction)
  ├─ SEP #$20 (set 8-bit accumulator)
  ├─ PLA (pull $04), INC A (→ $05), PHA (push $05)
  │   Stack: [ROM_return, $7F8005]  ✓ Adjusted to valid instruction!
  └─ RTL (pops $7F8005 from stack, jumps there)
      │ Stack: [ROM_return]
      ↓
$7F8005: STA $0205 (continue original routine - VALID instruction!)
  │ (STA $0209, STA $020D, ... all remaining sprite Y positions)
  ↓
$7F8182: RTL (pops ROM_return, back to ROM)
  │ Stack: []
  ↓
ROM code continues
```

### The 2% Problem: Sprite Artifacts

**Root Cause:** The instruction `STA $0201` is never executed because we skip from byte 0 to byte 5.

**Effect:** OAM extended sprite slot 0's Y position is not initialized to $F0 (offscreen), so sprites may appear when they shouldn't.

**Frequency:** Happens once per frame when `RAM_7F8000` is called.

**Severity:** Minor visual glitch - sprites occasionally appear in incorrect positions.

## Proposed Solutions

### Solution 1: Execute Skipped Instruction + Adjust Return Address (IMPLEMENTED)
**Complexity:** Medium
**Compatibility:** High

Add the skipped instruction to our trampoline, then adjust the return address on the stack before RTL:

```asm
$7F8300:  JSL $7F8200     ; Call CARL modules
$7F8304:  LDA #$F0        ; \
$7F8306:  STA $0201       ; / Execute the skipped instruction
$7F8309:  SEP #$20        ; Set 8-bit accumulator mode
$7F830B:  PLA             ; Pull return address low byte ($04)
$7F830C:  INC A           ; Increment to $05
$7F830D:  PHA             ; Push back
$7F830E:  RTL             ; Return to $7F8005 (next valid instruction!)
```

**Why the adjustment?**
- JSL pushes return address $7F8004 (PC + 3 after 4-byte instruction)
- But byte 4 is `$02` - the middle of the `STA $0201` instruction!
- Original instruction was 5 bytes: `LDA #$F0` (2) + `STA $0201` (3)
- Next valid instruction starts at byte 5: `STA $0205`
- Stack manipulation increments return address from $04 to $05

**Pros:**
- Correct execution flow - no invalid opcodes
- Preserves exact original behavior
- Stack handling is correct: ROM → [$7F8004] → adjusted to [$7F8005] → continues cleanly
- Only 15 bytes total

**Cons:**
- Hardcoded memory address ($0201) - but this is SMW-specific anyway
- Slightly more complex than simple RTL

**Status:** ✅ IMPLEMENTED - This is the current solution, fixes intermittent crashes

### Solution 2: Restore Accumulator and Jump to Byte 2
**Complexity:** Low
**Compatibility:** High

```asm
$7F8300:  JSL $7F8200     ; Call CARL modules
$7F8304:  LDA #$F0        ; Restore accumulator state
$7F8306:  JML $7F8002     ; Jump to the STA instruction
```

**Pros:**
- Only 8 bytes total
- Preserves register state
- No hardcoded STA target

**Cons:**
- Uses JML instead of JSL (different return behavior)
- May have stack issues

### Solution 3: Read and Execute Original Bytes
**Complexity:** High
**Compatibility:** Medium

Read the original 128 bytes, back them up to `$7F8400`, and JSL to the backup instead of `$7F8004`.

**Pros:**
- No skipped instructions
- Works even if routine changes between SMW versions

**Cons:**
- Uses 128 bytes of RAM
- More complex
- Slower (extra JSL overhead)
- **Already tried - caused screen blanking issues**

### Solution 4: Do Nothing (Current State)
**Complexity:** None
**Compatibility:** Perfect

Accept the minor sprite artifacts as a limitation.

**Pros:**
- Already working
- Simple and stable
- 98% functional

**Cons:**
- Visual artifacts during gameplay

## Recommendation

**Implement Solution 1** - it's the safest, most compatible approach that fully restores original behavior with minimal complexity.

## Implementation Notes

### ASAR Assembly Integration
Modules are assembled using ASAR with the following wrapper:

```asm
freedata
JSL module
module:
    ; User's module code here
    RTL
```

The assembler output is parsed to extract:
1. The JSL instruction location (identifies entry point)
2. The actual module code (after the JSL)
3. ASAR metadata is stripped (11-byte "STAR" header)

### USB2SNES Address Translation
WRAM addresses must be converted for USB2SNES protocol:
- `$7E0000-$7EFFFF` → `$F50000-$F5FFFF`
- `$7F0000-$7FFFFF` → `$F60000-$F6FFFF`

### Module Storage
Modules are loaded at `$7FA000` and up, with each module's address stored for the hook chain.

