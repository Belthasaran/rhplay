# SMW Level Loading Analysis

## Problem Statement

Based on `asm1.py`, we have ASM patches that can force a specific level, but they have issues:

### What Works
- Can set level on initial entry from overworld
- Skips intro successfully
- Works with some hacks

### What Doesn't Work
1. **Death/Respawn**: When Mario dies, he enters a different level
2. **Midway Point**: Respawning from midway uses wrong level
3. **Instant Retry**: Some hacks have retry systems that bypass the patch
4. **Level ID Calculation**: The level ID depends on which overworld world Mario is in

## RAM Addresses (from asm1.py)

### Critical Level Addresses

| Address | Purpose | Notes |
|---------|---------|-------|
| `$13BF` | Current level number (low byte) | Main level ID |
| `$17BB` | Level number backup/copy | Used in some routines |
| `$0E` | Level-related value | Purpose unclear |
| `$19B8` | Level number array (32 bytes) | Array indexed by something |
| `$19D8` | Level high byte array (32 bytes) | High bits + flags |
| `$0109` | Unknown level-related | Used in patch C |
| `$0DBE` | Lives counter | Can be zeroed for testing |
| `$1F27-$1F2A` | Switch palace flags | Red, Yellow, Green, Blue |

### Level ID Calculation

From the patches, level IDs appear to be calculated as:
```
Full Level ID = (high_byte << 8) | low_byte

Where high_byte includes:
- Actual high bit of level number (0x100-0x1FF vs 0x000-0x0FF)
- World/submap information
- Additional flags (bit 0x04 is ORed in some patches)
```

## Hook Points (from asm1.py)

### Patch Variation A (pids 1-7)

**Hook**: `$05DCDD`
```asm
org $05DCDD
    autoclean JSL Main
    NOP
```

**Sets**:
- `$13BF` = level low byte
- `$17BB` = level low byte (backup)
- Array fill at `$19B8` and `$19D8`

### Patch Variation B (pids 8-13)

**Primary Hook**: `$05DCDD`
**Secondary Hook**: `$00A28A`  
**Additional**: `$00A2EA`, `$05D842`, `$0DA415`

**More sophisticated**:
- Fills level arrays properly
- Sets multiple related addresses
- Handles SA-1 ROMs
- Sets `$71` register

### Patch Variation C (pid 20)

**Hook**: `$85D856`
```asm
org $85d856
    JSR Main
    BNE $3
    JMP $d8a5
```

**Very different approach**:
- Hooks at different location
- Simpler logic
- Only sets `$13BF` when `CPX #$03`

## The Problem: Missing Respawn Hooks

All patches hook into **level entry** but NOT **respawn** points.

### Where Mario Can Enter a Level

1. **From Overworld** ← Patches hook this ✓
2. **From Death** ← NOT hooked ✗
3. **From Midway Point** ← NOT hooked ✗
4. **From Instant Retry** ← NOT hooked ✗
5. **From Continue Screen** ← NOT hooked ✗

## Solution Approach

Need to find and hook **ALL** level load points:

### Entry Points to Hook

1. **Main Level Init** (`$05DCDD`) ← Already done
2. **Death Respawn**  
   - Need to find where game loads level after death
   - Probably near lives decrement code
3. **Midway Respawn**
   - Where midway point data is read
   - Where it sets spawn position
4. **Game Mode Changes**
   - When game mode switches to "level" mode
   - Universal hook point

### Ideal Solution: Hook Game Mode

Instead of hooking specific routines, hook the **game mode system**:

```asm
; When game mode changes to "level mode"
; ALWAYS set our desired level ID
; This catches ALL entry methods
```

## RAM Addresses to Research

From SMW Central ROM Map, need to find:

- **Game Mode**: Address that controls current game state
- **Level Load Routine**: Main routine that loads any level
- **Spawn Type**: How to determine entry vs respawn
- **Midway Data**: Where midway information is stored

## Testing Strategy

With 127 sample ROMs in `refmaterial/samplerom/`:

1. **Test each patch variant** on 10-20 diverse ROMs
2. **Identify which ROMs use which variant**
3. **Find commonalities** in working vs broken cases
4. **Extract patterns** for robust universal patch

## Next Steps

1. ✅ Analyze existing patches (this document)
2. Search ROM map for respawn/death routines
3. Find game mode addresses
4. Create comprehensive hook that catches ALL entry points
5. Test on sample ROMs
6. Iterate based on failures

## File References

- **asm1.py**: Existing patch generator
- **refmaterial/samplerom/**: 127 test ROMs
- **legacy/smwc_rommap_index.json**: ROM address documentation

