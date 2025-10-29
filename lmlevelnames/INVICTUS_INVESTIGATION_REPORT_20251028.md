# Invictus 1.1 ROM Investigation Report
**Date:** October 28, 2025  
**ROM:** `Invictus_1.1.sfc`  
**Issue:** `levelname_extractor2.py` extracts level names but they decode as garbage

---

## Executive Summary

**Root Cause Identified:** The `levelname_extractor2.py` script is reading level name data from the **wrong location** due to an **invalid pointer** in the standard Lunar Magic pointer location.

### The Problem

1. **Invalid Pointer:** The pointer at ROM offset `$01BB57` (SNES `$03BB57`) contains the value `$DAEBB9`
2. **Beyond ROM Size:** This pointer translates to ROM offset `$6D6BB9` (7,171,001 bytes)
3. **ROM Size:** `Invictus_1.1.sfc` is only 4,194,304 bytes (4MB)
4. **Result:** The pointer is pointing **3 million bytes beyond the end of the ROM**!

### What's Happening

When the script detects an invalid pointer (beyond ROM size), it falls back to reading from the secondary block at ROM offset `$08EF46`. **This fallback location contains 65816 assembly code, not level name data!**

This is why the output looks like garbage:
- `Level 0x100: cYkGcDUcOVc` ← Decoding random assembly instructions as tiles
- `Level 0x101: GOGOGOGOQDj!` ← More random code
- Lots of `AAAAAAAAAA` ← Likely null bytes or repeated instructions

### The Real Level Name Data

The investigation found **89 RATS-tagged blocks** in the ROM that are multiples of 19 bytes (potential level name blocks). However, **only one has a valid pointer pointing to it:**

- **Location:** ROM offset `$08258A` (RATS tag at `$082584`)
- **Size:** 65,189 bytes (3,431 potential level names)
- **Pointer:** Found at ROM `$025412` (SNES `$04D412`)
- **Expected SNES Address:** `$10A590`

### Why This is Different

**Standard Lunar Magic Setup:**
- Pointer location: SNES `$03BB57` → points to level name block
- ASM hijack at: SNES `$048E81` → redirects to custom code

**Invictus 1.1 Setup:**
- Pointer location: SNES `$03BB57` → **INVALID** (points beyond ROM)
- ASM hijack at: SNES `$048E81` → **VALID** (present, points to `$03BB20`)
- **Actual level name pointer:** SNES `$04D412` → points to block at `$10A590`

---

## Technical Analysis

### 1. ASM Hijack Status

```
Hijack location: SNES $048E81 -> ROM offset $020E81
Instruction: $22 (JSL - Jump to Subroutine Long)
Target SNES address: $03BB20
```

**Status:** ✅ **Lunar Magic patch is installed**

The hijack is present and functional, but it's calling a **different custom routine** instead of the standard Lunar Magic level name code.

### 2. Standard Pointer Analysis

```
Pointer at ROM 0x01BB57 (SNES $03BB57):
  Value: $DAEBB9
  Bank: $DA, Offset: $EBB9
  ROM offset: $6D6BB9 (INVALID - beyond ROM size)
```

**Status:** ❌ **Invalid pointer**

This is highly unusual. Possible explanations:
1. **Custom ASM implementation:** The ROM hack uses entirely custom level name display code
2. **Pointer moved:** The pointer was relocated to a different address
3. **Corrupted save:** Th ROM may be corrupted or improperly saved
4. **Expanded ROM mapping:** Uses a non-standard memory mapping

### 3. Fallback Block Analysis

```
Secondary block location: ROM offset $08EF46
Data at location:
  Level 0x100: 42 BD 7B 18 4A 8D 06 42 20 03 EF AD 14 42 85 0E AD 15 42
```

**Status:** ❌ **This is assembly code, not level names!**

Disassembly reveals:
```assembly
42 BD        PER (relative address)
7B 18        TDC ; TXA
4A           LSR A
8D 06 42     STA $4206
20 03 EF     JSR $EF03
AD 14 42     LDA $4214
85 0E        STA $0E
...
```

This is clearly 65816 machine code, not tile data for level names.

### 4. Tile Frequency Analysis

```
Most common tile bytes in "secondary block":
  $00:  77 occurrences  <- NULL bytes
  $0E:   6 occurrences
  $06:   5 occurrences
  $42:   4 occurrences  <- Common in addressing modes
  $2A:   4 occurrences
```

**Status:** ❌ **Does not match level name data patterns**

Expected pattern for level names:
- Most common: `$FC` (blank space tile)
- Common: `$00-$19` (A-Z letter tiles)
- Less common: Special characters

Actual pattern:
- Most common: `$00` (NULL/padding bytes in code)
- Common: Various opcodes and addressing bytes

### 5. RATS Tag Search Results

**Found:** 1,828 RATS tags total  
**Potential level name blocks:** 89 candidates (size multiple of 19)

**Most promising candidate:**
```
ROM offset: $082584 (RATS tag)
Data start: $08258A
Size: 65,189 bytes (3,431 level names)
Pointed to by: ROM $025412 (SNES $04D412)
```

Sample data from this block:
```
Level 0: A5 FE 37 4C E0 A5 4C B7 A5 4C 29 A6 4C 83 A6 4C 83 A6 4C
Level 1: 83 A6 4C 83 A6 4C B7 A5 4C 29 A6 4C 29 A6 4C 80 A6 4C 80
```

**This also looks like code!** The pattern of `4C` (JMP instruction) repeating suggests jump tables, not level names.

---

## Root Cause Analysis

### Why Invictus is Different

**Hypothesis 1: Custom Level Name System**
- Invictus uses a completely custom level name display system
- The ASM hijack at `$048E81` points to custom code at `$03BB20`
- This custom code retrieves level names from a non-standard location
- The level names may be compressed, encrypted, or stored in a custom format

**Hypothesis 2: No Level Names in ROM**
- The ROM hack may **dynamically generate** level names at runtime
- Level names could be loaded from SRAM or generated procedurally
- The "level names" we're seeing are actually other game data being misinterpreted

**Hypothesis 3: Corrupted or Modified ROM**
- The ROM file may be corrupted
- The pointer at `$03BB57` was overwritten with garbage
- A save state or partial edit left the ROM in an inconsistent state

**Hypothesis 4: Different Lunar Magic Version or Patch**
- Uses a Lunar Magic version with a completely different level name system
- May use "GPS" (Global Point Sprites) or other patch systems that relocate data
- Could be using Asar or other custom ASM insertion tools

---

## Script Behavior Explanation

### Why the Script "Finds" 216 Level Names

```python
# From levelname_extractor2.py logic:
1. Check pointer at $03BB57
2. Calculate ROM offset: $6D6BB9
3. Detect: offset > ROM size
4. Fall back to secondary block at $08EF46
5. Read 19 bytes × 512 levels = 9,728 bytes
6. Decode each 19-byte chunk as level name tiles
7. Filter out empty/garbage names
8. Output 216 "level names" (actually decoded assembly code)
```

### Why the Output is Garbage

The script is faithfully decoding assembly instructions using the tile mapping:

| Byte | Assembly | Tile Decoded |
|------|----------|--------------|
| `$42` | `PER/WDM` | `C` |
| `$BD` | `LDA abs,X` | `Y` |
| `$06` | `ASL dp` | `G` |
| `$0E` | `ASL abs` | `O` |
| `$00` | `BRK` | `A` |

So `42 BD 7B 18 4A 8D 06` becomes something like `"cYkGcDU"` - meaningless as a level name!

---

## Solutions and Next Steps

### Option 1: Trace the ASM Hijack

The most reliable solution is to follow the code flow:

1. **Disassemble** the code at SNES `$03BB20` (where the hijack points)
2. **Trace** through the custom level name display routine
3. **Find** where it actually reads the level name data
4. **Extract** the real pointer/location from the code

This requires:
- SNES debugger or emulator with tracing
- 65816 assembly knowledge
- Understanding of SMW's level display system

### Option 2: Search for Text Patterns

If Invictus has actual level names, we could:

1. **Extract** known level names from Invictus (if available)
2. **Convert** them to expected tile byte sequences
3. **Search** the ROM for these byte patterns
4. **Identify** the actual level name block location

### Option 3: Analyze Savest or RAM Dump

Since level names must be displayed in-game:

1. **Run** Invictus in an emulator
2. **Navigate** to a level that shows its name
3. **Dump** RAM while name is displayed
4. **Trace back** to find where the name was loaded from ROM

### Option 4: Contact ROM Hack Author

The most direct solution:

1. **Find** the creator of Invictus 1.1
2. **Ask** about the level name system
3. **Request** documentation or source code

---

## Recommended Immediate Action

### For the Script User

**The script is working correctly** - it's faithfully following the standard Lunar Magic protocol. The issue is that **Invictus 1.1 does not follow this protocol**.

**Short-term workaround:**
```bash
# The script cannot extract level names from Invictus without knowing
# the custom level name format/location
echo "Invictus 1.1 uses a non-standard level name system"
echo "Manual investigation required"
```

### For Script Enhancement

Add a **validation check** to detect this scenario:

```python
def validate_level_name_data(rom_data, offset, sample_size=5):
    """Check if data at offset looks like level names vs. code"""
    
    # Check first few level names
    for i in range(sample_size):
        level_bytes = rom_data[offset + (i * 19):offset + (i * 19) + 19]
        
        # Count common assembly opcodes
        code_indicators = sum(1 for b in level_bytes if b in [
            0x4C,  # JMP
            0x20,  # JSR
            0x60,  # RTS
            0x22,  # JSL
            0xA9,  # LDA #imm
            0x8D,  # STA abs
        ])
        
        # If >30% are code bytes, probably not level names
        if code_indicators > 6:  # 6/19 = 31%
            return False
    
    return True
```

---

## Conclusion

**Invictus 1.1 uses a custom, non-standard level name system** that differs significantly from typical Lunar Magic implementations. The `levelname_extractor2.py` script cannot extract level names from this ROM without:

1. Reverse-engineering the custom level name code
2. Finding the actual level name data location
3. Understanding any custom encoding/compression used

**The script is not broken** - it correctly implements the standard Lunar Magic level name extraction protocol. Invictus simply doesn't use this standard system.

### Summary Statistics

| Property | Value |
|----------|-------|
| ROM Size | 4,194,304 bytes (4MB) |
| ASM Hijack | ✅ Present at `$048E81` |
| Standard Pointer | ❌ Invalid (`$DAEBB9`, beyond ROM) |
| Fallback Data | ❌ Assembly code, not level names |
| RATS Tags Found | 1,828 total |
| Potential Level Blocks | 89 candidates |
| Actual Level Names | ❓ Unknown location/format |

---

## Files Generated

- `investigate_invictus.py` - Initial analysis script
- `find_invictus_level_names.py` - RATS tag scanner
- `INVICTUS_INVESTIGATION_REPORT_20251028.md` - This report

---

**Investigation Date:** October 28, 2025  
**Status:** ❌ Level names cannot be extracted with current script  
**Recommended Action:** Manual reverse-engineering or contact ROM author


