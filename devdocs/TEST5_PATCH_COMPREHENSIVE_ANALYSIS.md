# Test5.asm Patch: Comprehensive Analysis and Future Directions

## Executive Summary

This document provides a complete analysis of the `test5.asm` patch, which forces all overworld level tiles to enter a specific target level. It documents what we did, how it works, known issues, and future research directions for improving the patch and understanding SMW level data structures.

**Status**: Working for initial level entry, but may have issues with midway entrances when Retry System is not installed.

---

## Part 1: What We Did - The test5.asm Patch

### Overview

The `test5.asm` patch intercepts the level loading process at two critical points to force all overworld tiles to load a specific target level (configured via `!val` macro).

### Patch Strategy: Dual-Hook Approach

#### Hook 1: `$05D89B` - `GetTargetLevel`

**Location**: `$05D89B` in the original SMW ROM  
**Original Code**:
```asm
LDA.L $7ED000,X    ; Load level number from overworld tile data
STA.W $13BF        ; Store to level number register
```

**What We Do**:
- Replace `LDA.L $7ED000,X` with `JSL GetTargetLevel`
- Our routine returns a calculated value that accounts for SMW's internal `$24` subtraction logic
- Execute the `STA.W $13BF` instruction that was overwritten

**Why This Hook**:
- `$7ED000` is the RAM table that stores level numbers for each overworld tile
- This is the earliest point where the game reads which level to load from the overworld
- Intercepting here ensures we control the level before any other processing

**Key Calculation**:
```asm
; For levels >= $25, SMW subtracts $24 at $05D8A2
; So if we want level $106 (translevel $2A):
;   - We return $2A + $24 = $4E
;   - Game subtracts $24 → $2A (correct!)
;   - But $13BF is now $4E (wrong), so we fix it at Hook 2
```

#### Hook 2: `$05DCDD` - `OverrideLevel`

**Location**: `$05DCDD` (after Lunar Magic's `GetLevelHighByte`)  
**Original Code**: NOP (3 bytes)  
**What We Do**:
- Set `$13BF` to the final correct translevel number (`!anumber`)
- For extended levels (>= 0x100), set `$0F` (high byte) directly
- Avoid modifying `$1F11` to preserve submap information

**Why This Hook**:
- Runs after Lunar Magic's level number processing
- Ensures the level is set correctly even if something overrides it
- Same proven approach as `2lvno_test.asm`

### Level Number Calculation

SMW uses a complex "translevel" system:

```
Level ID Range    | Translevel Calculation
------------------|------------------------
0x000 - 0x024     | Use directly (no conversion)
0x025 - 0x05F     | Subtract $DC (translevel = level - $DC)
0x100 - 0x1FF     | Subtract $DC (translevel = level - $DC)
```

**Example for Level 0x106**:
- Full level ID: `0x106`
- Translevel: `0x106 - $DC = 0x2A`
- High byte flag: `0x01` (bit 0 of `$0F` or `$19D8`)

### Critical RAM Addresses

| Address | Purpose | How We Use It |
|---------|---------|---------------|
| `$13BF` | Current level number (low byte) | Set to `!anumber` (translevel) |
| `$17BB` | Level number backup | Set automatically by game code |
| `$0E` | Level-related value | Set automatically by game code |
| `$0F` | Level high byte | Set to `$01` for extended levels (>= 0x100) |
| `$1F11` | Submap number + high byte flag | **NOT modified** (preserves overworld location) |
| `$7ED000` | Overworld tile level data | Read by game, we intercept the read |
| `$19B8` | Level number array (32 bytes) | Not explicitly set (game handles) |
| `$19D8` | Level high byte array (32 bytes) | Not explicitly set (game handles) |

### Why We Don't Modify `$1F11`

**Problem**: `$1F11` stores both:
- Submap number (bits 0-3): 0 = main overworld, 1+ = submaps
- High byte flag (bit 4): Used to determine if level >= 0x100

**Previous Approach**: Set `$1F11` to `$01` for levels >= $25  
**Issue**: This changed the submap from 0 to 1, causing the player's overworld location to change after exiting the level

**Current Solution**: Set `$0F` directly for extended levels, leaving `$1F11` unchanged

### Compatibility

- ✅ **Lunar Magic**: Compatible (hooks after LM's `GetLevelHighByte`)
- ✅ **Retry System**: Compatible (doesn't interfere with retry hooks)
- ✅ **SA-1 ROMs**: Supported (detects SA-1 and adjusts `!addr`)
- ⚠️ **Midway Entrances**: May not work correctly (see Known Issues)

---

## Part 2: Known Issues and Limitations

### Issue 1: Midway Entrance Problem

**Symptom**: When Retry System is not installed, players may enter the level at the beginning instead of the checkpoint, even if they collected the checkpoint.

**Root Cause**: The patch forces the level number but doesn't preserve midway entrance state. The game's midway entrance logic depends on:
- Checkpoint collection flags (stored in `$1EA2` array)
- Midway entrance data tables (`$05F400` and Lunar Magic's expanded tables)
- Entrance type detection (main entrance vs. midway entrance)

**Why It Happens**:
1. Our patch sets `$13BF` to the target level
2. The game's midway entrance check may fail because:
   - The checkpoint flag is for the original level, not the forced level
   - The midway entrance data lookup uses the original level number
   - The entrance type detection doesn't account for our override

**Potential Solutions** (Future Work):
1. Hook midway entrance detection routines
2. Preserve and restore checkpoint flags for the forced level
3. Intercept midway entrance data table reads
4. Check entrance type before applying level override

### Issue 2: Level Arrays Not Explicitly Set

**Current State**: We don't explicitly fill `$19B8` and `$19D8` arrays  
**Impact**: Unknown - the game may handle this automatically, but some edge cases might fail

**Future Investigation**: Test if explicitly filling these arrays improves compatibility

---

## Part 3: Understanding Overworld and Level Data Structures

### Overworld Level Tile Data: `$7ED000`

**Location**: RAM address `$7ED000` (SA-1: `$40D000`)  
**Size**: 0x800 bytes (2048 tiles)  
**Format**: One byte per overworld tile, stores the level number

**Index Calculation**:
```asm
; X = tile index
; If on submap ($1F11 != 0):
;   X = X + 0x400
; Level number = $7ED000[X]
```

**How It Works**:
- Each overworld tile position has an index (0-0x3FF for main map, 0x400-0x7FF for submaps)
- The game reads `$7ED000[X]` to get the level number for that tile
- This is what we intercept at `$05D89B`

**Lunar Magic Modifications**:
- Lunar Magic may expand this table if overworld expansion is enabled
- Check `$04D807` for translevel hijack detection
- Expanded table location: `read1($04D808)<<16 | read2($04D803)`

### Translevel System

**What is a Translevel?**:
- SMW's internal level numbering system
- Levels 0x00-0x24: translevel = level number
- Levels 0x25+: translevel = level - 0xDC
- Used in many internal tables and calculations

**Translevel Tables** (from `OverworldTables.asm`):
- **Vanilla**: Various locations in bank 04
- **Lunar Magic**: May be relocated if expansion hijack is applied
- Check `$04D807` for hijack detection

### Level Data Tables

#### Secondary Level Header

**Purpose**: Stores level properties (slippery, water, scroll settings, etc.)

**Locations** (from `LevelTables.asm`):
- Byte 1: `$05F000` (Layer 2 scroll, low Y position bits)
- Byte 2: `$05F200` (Layer 3 setting, entrance action, low X position bits)
- Byte 3: `$05F400` (Midway entrance data - mmmmffbb format)
- Byte 4: `$05F600` (Various flags)
- Byte 5: `$05DE00` (Lunar Magic expansion) - Slippery, water, X/Y position 2, high X bits, smart spawn, sprite spawn range
- Byte 6: `$06FA00` (Lunar Magic expansion) - Auto-set number of screens flag (metadata only)
- Byte 7: `$06FC00` (Lunar Magic expansion) - High Y position bits, Layer 1 offset
- Byte 8: `$06FE00` (Lunar Magic expansion) - BG height, face left, Layer 2 relative to Layer 1

**Detection**:
```asm
; Check if byte 5 expansion is applied:
if read1($05D97D) == $22
    ; Hijacked - use expanded location
    org $05<<16+read2(read3($05D97E)+5)
else
    ; Not applied - byte 5 doesn't exist in vanilla
endif
```

#### Midway Entrance Data

**Location**: `$05F400` (512 bytes, one per level)  
**Format**: `mmmmffbb` (one byte per level)
- `mmmm` = Screen number for midway entrance (4 bits)
- `ff` = FG initial position (2 bits)
- `bb` = BG initial position (2 bits)

**Lunar Magic Expansion**:
- Byte 1: `read3(read3($05D9E4)+$0A)`
- Byte 2: `read3(read3($05D9E4)+$29)`
- Byte 3: `read3(read3($05D9E4)+$39)`

**Detection**:
```asm
if read1($05D9E3) == $22
    ; Hijacked - use expanded locations
else
    ; Not applied - only $05F400 exists
endif
```

#### Secondary Entrances

**Purpose**: Additional entrance points to levels (pipes, doors, etc.)

**Locations** (from `LevelTables.asm`):
- Byte 1: `$05F800` (Level number)
- Byte 2: `$05FA00` (Various settings)
- Byte 3: `$05FC00` (Various settings)
- Byte 4: `$05FE00` (Various settings)
- Byte 5: `read3($05DC86)` (Lunar Magic expansion)
- Byte 6: `read3($05DC8B)` (Lunar Magic expansion)

**Detection**:
```asm
if read1($05D7E3) == $22
    ; Hijacked - use expanded locations
else
    ; Vanilla locations
endif
```

### Level Pointer Tables

**Layer 1 Pointers**: `$05E000` (never moved)  
**Layer 2 Pointers**: `$05E600` (never moved)  
**Sprite Pointers**: `$05EC00` (never moved)

**Format**: 3 bytes per level (bank, high byte, low byte)

### Initial Level Flags

**Purpose**: Flags set when a new save file is created (which levels are beaten, etc.)

**Vanilla Location**: `$009EE0`  
**Lunar Magic Location**: `$05DDA0` (if hijack applied)

**Detection**:
```asm
if read1($009F19) == $22
    ; Hijacked - use $05DDA0
else
    ; Vanilla - use $009EE0
endif
```

**Size**: 96 bytes (vanilla) or 256 bytes (Lunar Magic expansion)

---

## Part 4: Future Research Directions

### Task 1: Preserve Midway Entrance Functionality

**Goal**: Ensure that when a player has collected a checkpoint, they enter at the midway point even with the level override.

**Research Needed**:
1. **Checkpoint Flag Storage**: Where are checkpoint flags stored?
   - Likely in `$1EA2` array (one byte per level)
   - Bit 6 (0x40) = checkpoint collected
   - Need to map original level → forced level for flag lookup

2. **Midway Entrance Detection**: How does the game determine if entering from midway?
   - Check game mode transitions
   - Check entrance type flags
   - Trace code path from death/respawn to level entry

3. **Midway Entrance Data Lookup**: How does the game read midway entrance data?
   - Intercept reads from `$05F400` or Lunar Magic's expanded tables
   - Map original level → forced level for data lookup

**Implementation Strategy**:
```asm
; Pseudo-code approach:
1. Before setting level override, check if checkpoint is collected
2. If checkpoint collected:
   a. Read midway entrance data for forced level (not original)
   b. Set entrance type to "midway"
   c. Apply midway entrance position/settings
3. Otherwise, use main entrance
```

**Hook Points to Investigate**:
- `$00F2CD` area: Midway respawn routine
- `$05D730-$05D758`: Mario position tables (main and midway)
- Checkpoint flag checks in level loading code

### Task 2: Create `getlevelinfo` CLI Tool

**Goal**: Create a tool that extracts all known information about a level from ROM data.

**Command**:
```bash
enode.sh ~/rhplay/jsutils/getlevelinfo --level <level_number>
enode.sh ~/rhplay/jsutils/getlevelinfo --translevel <translevel_number>
```

**Information to Extract**:

#### Level Type and Overworld Properties
- **Overworld Level Type**: Castle, Ghost House, Switch Palace, Yellow Dot, Red Dot, etc.
  - Location: Overworld event data tables (bank 04)
  - Need to trace overworld tile → level → event data lookup

- **Main Exit and Base Event**: Does level have a main exit?
  - Location: Exit path tables (`$049964`, `$0499AA`, `$0499F0` or Lunar Magic expanded)
  - Detection: `if read1($049A35) == $22` (hijacked)

- **Second Exit**: Does level have a second exit?
  - Location: Secret exits tables (bank 04)
  - Lunar Magic: `Secret Exits 2+3.asm` patch

- **"No Entry If Beaten" Flag**: Overworld flag preventing entry
  - Location: `$1EA2` array, bit 5 (0x20)
  - Checked by Lunar Magic's `Enterable Level.asm` at `$049199`

#### Music & Time Limit Settings
- **Music Setting**: 
  - Location: Secondary header byte 2 (`$05F200`), bits 0-2
  - Values: 02=Here we go, 06=Cave Drums, 01=Piano, 08=Castle, 07=Ghost House, 03=Water, 05=Boss Battle, 12=Switch Palace

- **Time Limit**:
  - Location: Secondary header byte 1 (`$05F000`), bits 4-7
  - Values: 0000, 0200, 0300, 0400, or custom (0-FFF)
  - "Force reset" flag: Unknown location (may be in byte 6 metadata)

#### Level Header Properties
- **Horizontal Level Mode**: 
  - Location: Secondary header byte 4 (`$05F600`), bits 5-6
  - Value: `($05F600[level] & 0x60) >> 5`

- **Allow Viewing Full Bottom Row**: 
  - Location: Secondary header byte 4 (`$05F600`), bit 7
  - Value: `($05F600[level] & 0x80) != 0`

- **Number of Screens**: 
  - Calculated from level data size
  - Or from byte 6 "auto-set" flag (metadata)

- **Item Memory Index**: 
  - Location: Unknown (need to research)

- **Disable No Yoshi Level Intro**: 
  - Location: Secondary header byte 8 (`$06FE00`), bit 7
  - Or `$13CD` RAM (set by Lunar Magic's `Secondary Header.asm`)

#### Main Entrance and Midway Data
- **Screen Number of Main Entrance**: 
  - Location: Secondary header byte 1 (`$05F000`), bits 0-3
  - Or secondary header byte 5 (`$05DE00`), if position method 2 is used

- **Slippery Level**: 
  - Location: Secondary header byte 5 (`$05DE00`), bit 7
  - Stored in `$192A` RAM, transferred to `$86` on level load

- **Water Level**: 
  - Location: Secondary header byte 5 (`$05DE00`), bit 6
  - Stored in `$192A` RAM, transferred to `$85` on level load

- **Screen Number of Midway Entrance**: 
  - Location: `$05F400[level]`, bits 4-7 (mmmm in mmmmffbb format)
  - Or Lunar Magic expanded tables if hijack applied

- **Midway Entrance Separate Settings**: 
  - Check if midway entrance uses separate slippery/water flags
  - Location: Unknown (need to research Lunar Magic's midway expansion)

- **Midway Entrance Redirect**: 
  - Does midway entrance redirect to another level?
  - Location: Unknown (may be in Lunar Magic's expanded midway data)

- **Midway Entrance X/Y Position**: 
  - Location: Secondary header bytes 1-2, or byte 5 if position method 2
  - Or Lunar Magic's expanded position data

#### Screen Exits
- **Set Screen Number Exits**: 
  - Location: Screen exits tables (bank 05)
  - Format: Per-screen exit data
  - Lunar Magic: `Screen Exits.asm` patch

- **Exit Destination**: 
  - Level destination or secondary exit number
  - Location: Screen exits data

- **Go to Midway Entrance Flag**: 
  - Location: Screen exits data
  - Requires "use separate settings for midway entrance" and no redirect

#### Secondary Entrances
- **Used Secondary Entrance Slots**: 
  - Location: Secondary entrance tables (`$05F800`, `$05FA00`, `$05FC00`, `$05FE00`)
  - Format: 8 bytes per secondary entrance (from MWL format)

- **Destination Level**: 
  - Location: Secondary entrance byte 1 (`$05F800[entrance_id]`)

- **Screen Number of Entrance**: 
  - Location: Secondary entrance bytes 2-4, or expanded bytes 5-6

#### Auto Scroll Settings
- **Auto Vertical Scroll**: 
  - Location: Secondary header byte 2 (`$05F200`), bits 3-5
  - Or Layer 2/3 scrolling tables

- **Auto Vertical Scroll Speed**: 
  - Location: Layer 2/3 scrolling data tables
  - Lunar Magic: `Layer 2 Scrolling.asm`, `Layer 3 Scrolling.asm`

- **Auto Horizontal Scroll**: 
  - Location: Secondary header byte 2 (`$05F200`), bits 6-7
  - Or Layer 2/3 scrolling tables

- **Auto Horizontal Scroll Speed**: 
  - Location: Layer 2/3 scrolling data tables

**Implementation Plan**:
1. Detect Lunar Magic hijacks using the detection methods from `LevelTables.asm` and `OverworldTables.asm`
2. Read all known tables for the specified level
3. Parse bit flags and format data according to documented structures
4. Output JSON or human-readable format with all discovered information
5. Include ROM addresses, file offsets (headered/unheadered), and bit positions for each piece of data

### Task 3: Learn to Edit Overworld Data Structures

**Goal**: Eventually modify overworld tile → level mappings directly in ROM data, rather than using ASM hijacks.

**Research Needed**:
1. **Overworld Tile to Level Mapping**: 
   - Find where `$7ED000` data is stored in ROM
   - May be compressed or in a special format
   - Need to understand overworld data structure

2. **Overworld Event Data**: 
   - Layer 1 event data: `read3($04EDBE)`
   - Layer 1 event VRAM data: `read3($04EDB8)`
   - Layer 2 event data: `read3($04E49F)`
   - How events are linked to level numbers

3. **Overworld Tile Types**: 
   - How are tile types (Castle, Ghost House, etc.) stored?
   - Location: Overworld sprite data table (`$04F625`)
   - Custom sprite data: `read3($0EF55D)` (if hijacked)

4. **Overworld Path System**: 
   - How are directional paths stored?
   - Location: Various tables in bank 04
   - Need to understand path encoding format

**Tools Needed**:
- ROM analysis tool to find data structures
- Comparison tool for vanilla vs. modified ROMs

---

## Part 5: Address and Offset Reference

### ROM Addresses for Level Data

#### Secondary Level Header
| Byte | Vanilla Address | Lunar Magic Detection | Expanded Address |
|------|----------------|----------------------|------------------|
| 1 | `$05F000` | Never moved | `$05F000` |
| 2 | `$05F200` | Never moved | `$05F200` |
| 3 | `$05F400` | Never moved | `$05F400` |
| 4 | `$05F600` | Never moved | `$05F600` |
| 5 | N/A | `read1($05D97D) == $22` | `$05<<16+read2(read3($05D97E)+5)` |
| 6 | N/A | `read1($05D97D) == $22` | `$06FA00` |
| 7 | N/A | `read1($05D97D) == $22` | `$06FC00` |
| 8 | N/A | `read1($05D97D) == $22` | `$06FE00` |

#### Midway Entrance Data
| Byte | Vanilla Address | Lunar Magic Detection | Expanded Address |
|------|----------------|----------------------|------------------|
| 1 | `$05F400[level]` | `read1($05D9E3) == $22` | `read3(read3($05D9E4)+$0A)` |
| 2 | N/A | `read1($05D9E3) == $22` | `read3(read3($05D9E4)+$29)` |
| 3 | N/A | `read1($05D9E3) == $22` | `read3(read3($05D9E4)+$39)` |

#### Secondary Entrances
| Byte | Vanilla Address | Lunar Magic Detection | Expanded Address |
|------|----------------|----------------------|------------------|
| 1 | `$05F800` | `read1($05D7E3) == $22` | `read3(read3($05D7E4)+1)` |
| 2 | `$05FA00` | `read1($05D7E3) == $22` | `read3(read3($05D7EC)+1)` |
| 3 | `$05FC00` | `read1($05D7E3) == $22` | `read3(read3($05D81E)+1)` |
| 4 | `$05FE00` | `read1($05D7E3) == $22` | `read3(read3($05D838)+1)` |
| 5 | N/A | `read1($05D7E3) == $22` | `read3($05DC86)` |
| 6 | N/A | `read1($05D7E3) == $22` | `read3($05DC8B)` |

### File Offset Conversion

**LoROM Mapping**:
```
ROM Address → File Offset:
- Bank = (Address >> 16) & 0xFF
- Offset = Address & 0xFFFF
- File Offset = (Bank * 0x8000) + (Offset & 0x7FFF)

For headered ROMs (+512 bytes):
- File Offset = (Bank * 0x8000) + (Offset & 0x7FFF) + 0x200
```

**Example**: `$05F000`
- Bank = 0x05
- Offset = 0xF000
- File Offset (unheadered) = (0x05 * 0x8000) + 0x7000 = 0x2F000
- File Offset (headered) = 0x2F000 + 0x200 = 0x2F200

### Bit Positions Reference

#### Secondary Header Byte 1 (`$05F000`)
- Bits 0-3: Low Y position bits (main entrance)
- Bits 4-7: Time limit selector

#### Secondary Header Byte 2 (`$05F200`)
- Bits 0-2: Music setting
- Bits 3-5: Auto vertical scroll setting
- Bits 6-7: Auto horizontal scroll setting

#### Secondary Header Byte 4 (`$05F600`)
- Bit 7: Allow viewing full bottom row
- Bits 5-6: Horizontal level mode
- Bit 0: Unknown flag

#### Secondary Header Byte 5 (`$05DE00` - Lunar Magic)
- Bit 7: Slippery level
- Bit 6: Water level
- Bits 4-5: X position bits (if position method 2)
- Bits 0-3: Y position bits (if position method 2)

#### Secondary Header Byte 8 (`$06FE00` - Lunar Magic)
- Bit 7: Disable No Yoshi level intro
- Bits 0-5: BG height
- Bit 6: Face left
- Bit 7: Layer 2 relative to Layer 1

#### Midway Entrance Data (`$05F400`)
- Bits 4-7: Screen number (mmmm)
- Bits 2-3: FG initial position (ff)
- Bits 0-1: BG initial position (bb)

---

## Part 6: Next Steps Summary

### Immediate (Short Term)

1. **Investigate Midway Entrance Issue**:
   - Trace checkpoint flag storage and lookup
   - Find midway entrance detection code
   - Test hooking midway entrance routines

2. **Create `getlevelinfo` Tool**:
   - Implement Lunar Magic hijack detection
   - Read all known level data tables
   - Parse and format level information
   - Output comprehensive level metadata

### Medium Term

3. **Improve test5.asm**:
   - Add midway entrance preservation
   - Explicitly set level arrays if needed
   - Test edge cases (all level ID ranges)

4. **Documentation**:
   - Complete level data structure documentation
   - Create reference for all bit flags
   - Document Lunar Magic table relocations

### Long Term

5. **Overworld Data Editing**:
   - Find ROM locations for overworld data
   - Understand overworld data format
   - Create tools to edit overworld tile → level mappings

6. **Advanced Features**:
   - Per-tile level override (not just global)
   - Conditional level loading
   - Integration with other patches

---

## References

- `extrapatches/test5.asm` - Current working patch
- `extrapatches/test5_working_backup.asm` - Backup before submap fix
- `refmaterial/LMDIS/Level Number.asm` - Lunar Magic level number handling
- `refmaterial/LMDIS/Midway Entances.asm` - Lunar Magic midway entrance expansion
- `refmaterial/LMDIS/Secondary Header.asm` - Secondary header implementation
- `refmaterial/LMDIS/Secondary Entrances.asm` - Secondary entrance implementation
- `refmaterial/LMDIS/Water and Slippery Flags.asm` - Water/slippery flag handling
- `refmaterial/SMW-Data/Misc/LevelTables.asm` - Level table location finder
- `refmaterial/SMW-Data/Misc/OverworldTables.asm` - Overworld table location finder
- `refmaterial/SMWDisC.txt` - Original SMW disassembly
- `devdocs/SMW_LEVEL_LOADING_ANALYSIS.md` - Previous level loading analysis
- `devdocs/SMW_LEVEL_ID_CALCULATION.md` - Level ID calculation documentation

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-XX  

