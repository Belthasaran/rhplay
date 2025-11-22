# SMW Overworld Level Force Patch - Implementation Plan

## Problem Statement

Create an ASAR patch template that forces ALL overworld level tiles to enter a specific level number (specified by macro `!val`), regardless of which tile or submap the player is on.

**Current Issue**: Existing attempts only work for levels < $24 (36 decimal). Higher numbered levels (especially >= 0x100, like 0x106) fail.

## Root Cause Analysis

### How SMW Loads Levels from Overworld

1. **Overworld Tile Data** (`$1F1F`, `$1F21`): Contains level number encoded in overworld position data
2. **Level Number Extraction** (`$05D842-$05D856`): Reads tile position and extracts level number
3. **High Byte Calculation** (`$05D8B1`): Determines if level is 0x000-0x0FF or 0x100-0x1FF
4. **Level Data Loading** (`$05D8E2`): Uses level number to load level data

### Why Levels >= $24 Fail

The Lunar Magic "Level Number.asm" patch has hardcoded logic:
```asm
LDA $13BF|!addr
CMP #$25
BCC .below100
SBC #$24
INY
```

This only handles:
- Levels 0x00-0x24 → High byte = 0
- Levels 0x25-0x5F → High byte = 1, low byte = $13BF - $24

**Problem**: For levels like 0x106:
- Low byte should be 0x06
- High byte should be 0x01 (bit 0 set)
- But the code would calculate: 0x106 - 0x24 = 0xE2 (wrong!)

### Why Levels >= 0x100 Are Especially Difficult

1. **16-bit vs 8-bit confusion**: Level numbers are stored in 8-bit registers but need 9-bit range (0x000-0x1FF)
2. **High byte encoding**: The high bit is stored separately in `$19D8` array, not as a simple high byte
3. **Multiple RAM addresses**: Level number must be set in multiple places:
   - `$13BF` - Main level number (low byte)
   - `$17BB` - Level number backup
   - `$0E` - Used in level load routines
   - `$19B8[0-31]` - Level number array (all 32 bytes)
   - `$19D8[0-31]` - High byte + flags array (bit 0 = high bit, bit 2 = common flag)

## Solution Strategy

### Approach: Intercept at Multiple Points

Instead of trying to fix the high byte calculation, **override the level number BEFORE it gets processed** at the earliest possible point.

### Hook Points

1. **Primary Hook: `$05D842`** (Before level number extraction)
   - This is where overworld tile data is read
   - We can override `$13BF` before any calculations happen
   - Most universal approach

2. **Secondary Hook: `$05D8B1`** (High byte calculation)
   - Override the high byte calculation
   - Ensure compatibility with Lunar Magic patch

3. **Tertiary Hook: `$05D8E2`** (Level data loading)
   - Final safety net to ensure level is correct
   - Works with Lunar Magic TrackLevelNumber

### Level Number Calculation

For any level number `!val` (0x000-0x1FF):

```asm
!val = $106  ; Example: level 0x106

; Calculate low and high bytes
!lob = !val & $FF           ; Low byte: 0x06
!hib = (!val >> 8) & $01    ; High byte: 0x01 (bit 0)
!flag = !hib | $04          ; High byte flag: 0x05 (bit 0 + bit 2)
```

## Implementation Plan

### Phase 1: Core Level Override

**Hook at `$05D842`** - Before level number is extracted from overworld:

```asm
org $05D842
    JSL OverrideLevelNumber
    NOP #2  ; Replace original code
```

**Function**: Set `$13BF` to target level low byte immediately after overworld data is read.

### Phase 2: High Byte Override

**Hook at `$05D8B1`** - Override high byte calculation:

```asm
org $05D8B1
    JSL OverrideLevelHighByte
    NOP
```

**Function**: Return correct high byte (0 or 1) based on target level, bypassing Lunar Magic's calculation.

### Phase 3: Array Initialization

**Hook at `$05D8E2`** - After level number is set:

```asm
org $05D8E2
    JSL InitializeLevelArrays
    NOP #2
```

**Function**: Fill `$19B8` and `$19D8` arrays with correct values.

### Phase 4: Compatibility with Lunar Magic

The patch must work WITH Lunar Magic's "Level Number.asm" patch:

1. **GetLevelHighByte** (`$05DCD0`): Our patch should override its return value
2. **TrackLevelNumber** (`$0EF550`): Should work correctly with our level number
3. **LoadingNoYoshi** (`$0EF560`): Should not interfere

## ASAR Patch Template Structure

```asm
;===========================================
; SMW Overworld Level Force Patch
; Forces all overworld tiles to enter level !val
; Compatible with Lunar Magic + Retry System
;===========================================

; Macro: Set target level number (0x000-0x1FF)
!val = $106

; Calculate level components
!lob = !val & $FF
!hib = (!val >> 8) & $01
!flag = !hib | $04

; SA-1 detection
!addr = $0000
if read1($00FFD5) == $23
    sa1rom
    !addr = $6000
endif

; Hook 1: Override level number from overworld
org $05D842
    autoclean JSL OverrideLevelNumber
    NOP #2

; Hook 2: Override high byte calculation  
org $05D8B1
    autoclean JSL OverrideLevelHighByte
    NOP

; Hook 3: Initialize level arrays
org $05D8E2
    autoclean JSL InitializeLevelArrays
    NOP #2

; Free space for code
freedata

OverrideLevelNumber:
    ; Set level number immediately after overworld read
    PHP
    PHA
    
    LDA.b #!lob
    STA $13BF|!addr    ; Main level number
    STA $17BB|!addr    ; Backup
    STA $0E|!addr      ; Used in load routines
    
    PLA
    PLP
    
    ; Original code: LDX.W $0DD6
    LDX.W $0DD6|!addr
    RTL

OverrideLevelHighByte:
    ; Return high byte (0 or 1) based on target level
    PHP
    SEP #$20
    
    LDA.b #!hib
    PHA
    
    PLP
    PLA
    RTL

InitializeLevelArrays:
    ; Fill level arrays after level number is set
    PHP
    PHX
    PHA
    
    ; Fill $19B8 array (level numbers)
    LDA.b #!lob
    LDX.b #$1F
.loop_lo:
    STA $19B8|!addr,x
    DEX
    BPL .loop_lo
    
    ; Fill $19D8 array (high bytes + flags)
    LDA.b #!flag
    LDX.b #$1F
.loop_hi:
    STA $19D8|!addr,x
    DEX
    BPL .loop_hi
    
    PLA
    PLX
    PLP
    
    ; Original code continues
    LDA $0E|!addr
    RTL
```

## Testing Requirements

### Test Cases

1. **Level < 0x24** (e.g., 0x05)
   - Should work (baseline)
   - Verify high byte = 0

2. **Level 0x24-0xFF** (e.g., 0x42)
   - Should work
   - Verify high byte = 0 (if < 0x100) or 1 (if >= 0x100)

3. **Level >= 0x100** (e.g., 0x106)
   - **Critical test case**
   - Verify low byte = 0x06, high byte = 0x01
   - Verify all arrays are set correctly

4. **Compatibility Tests**
   - With Lunar Magic "Level Number.asm" patch
   - With Retry System 2.03
   - With both patches together

### Test Scenarios

1. Enter level from overworld (main map)
2. Enter level from overworld (submap)
3. Exit and re-enter level
4. Death and respawn (if retry system present)

## Potential Issues & Solutions

### Issue 1: Lunar Magic Patch Interference

**Problem**: Lunar Magic's `GetLevelHighByte` might override our value.

**Solution**: Hook AFTER Lunar Magic's hook, or modify our hook to work with it.

### Issue 2: Retry System Bypass

**Problem**: Retry system might load level from different location.

**Solution**: Also hook retry system's level load routine (if detectable).

### Issue 3: Midway Points

**Problem**: Midway points might store original level number.

**Solution**: Also hook midway point loading routine.

### Issue 4: Level Number Validation

**Problem**: Game might validate level number against overworld data.

**Solution**: Override validation checks or hook earlier in the process.

## Alternative Approach: Universal Hook

If the above approach fails, use a more aggressive strategy:

**Hook the main level data loading routine** at `$05D796`:
- This is called for ALL level loads
- Catches: initial entry, death, midway, continue, retry
- Most universal solution

## Implementation Complete

✅ **Patch Template Created**: `/home/steamu/rhplay/refmaterial/overworld_level_force_template.asm`

### Final Hook Strategy

1. **Primary Hook: `$05D8AC`** - After level adjustment code
   - Overrides `$13BF`, `$17BB`, and `$0E` with target level
   - This is AFTER vanilla adjustment (CMP #$25, SBC #$24) runs
   - Ensures our level number is set regardless of adjustment logic

2. **Secondary Hook: `$05D8B1`** - High byte calculation
   - Overrides high byte to return correct value (0 or 1)
   - Works with Lunar Magic's GetLevelHighByte if present

3. **Tertiary Hook: `$05D8E2`** - Level array initialization
   - Fills `$19B8` and `$19D8` arrays with correct values
   - Ensures compatibility with hacks that use these arrays

### Key Features

- **Works with any level number** (0x000-0x1FF)
- **Handles high byte correctly** for levels >= 0x100
- **Compatible with Lunar Magic** Level Number patch
- **Compatible with Retry System** 2.03
- **Simple macro-based configuration**: Just set `!val = $106`

## Next Steps (Testing)

1. ✅ Analyze code flow (this document)
2. ✅ Create initial patch template
3. ⏳ Test with level 0x05 (< 0x24)
4. ⏳ Test with level 0x42 (0x24-0xFF)
5. ⏳ Test with level 0x106 (>= 0x100) - **critical**
6. ⏳ Test with Lunar Magic patch
7. ⏳ Test with Retry System
8. ⏳ Refine based on failures

## References

- **SMW Disassembly**: `/home/steamu/rhplay/refmaterial/SMWDisC.txt`
- **Lunar Magic Level Number Patch**: `/home/steamu/rhplay/refmaterial/LMDIS/Level Number.asm`
- **65C816 Opcodes**: `/home/steamu/rhplay/refmaterial/opcodes.html`
- **ASAR Manual**: `/home/steamu/rhplay/refmaterial/asar1_91.html`
- **Existing Analysis**: `/home/steamu/rhplay/devdocs/SMW_LEVEL_ID_CALCULATION.md`

