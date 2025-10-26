# SMW Level ID Calculation and RAM Addresses

## Overview

Based on analysis of `asm1.py` and the SMW ROM map, this document explains how level IDs are calculated and stored in SMW.

## The Problem

Level IDs in SMW are **not simple numbers**. The actual level depends on multiple RAM addresses and bit flags.

### Why It's Complex

SMW was designed for the original game with ~96 levels. ROM hackers expanded this to 512 levels (0x000-0x1FF), but the original RAM structure wasn't designed for this. Therefore:

1. Level ID split across multiple bytes
2. Additional bits encode world/submap information
3. Different addresses used in different contexts

## Critical RAM Addresses

### Primary Level Addresses

| Address | Size | Purpose | Notes |
|---------|------|---------|-------|
| `$13BF` | 1 byte | **Current level number (low byte)** | Main level ID (0x00-0xFF) |
| `$17BB` | 1 byte | Level number backup/copy | Must match `$13BF` |
| `$0E` | 1 byte | Level-related value | Used in some load routines |
| `$19B8` | 32 bytes | Level number array | Indexed array, fill with same value |
| `$19D8` | 32 bytes | Level high byte + flags array | High bits and control flags |

### Level ID Calculation

```
Full Level ID = (high_byte & 0x01) << 8 | low_byte

Where:
  low_byte  = $13BF          (0x00-0xFF)
  high_byte = $19D8[index]   (bit 0 = high bit of level number)
  
Effective range:
  0x000-0x0FF: When high bit = 0
  0x100-0x1FF: When high bit = 1
```

### High Byte Flags

The high byte in `$19D8` contains:
- **Bit 0** (`0x01`): High bit of level number (0x100+)
- **Bit 2** (`0x04`): Common flag (purpose unclear, but often set)
- Other bits: Unknown purpose

**Common pattern in patches**:
```asm
LDA #!hib           ; High byte (0 or 1)
ORA #$04            ; Set bit 2
STA $19D8,x         ; Store to array
```

## Level Load Entry Points

### Where Mario Can Enter a Level

| Entry Type | Hook Point | Status in asm1.py |
|------------|------------|-------------------|
| **Overworld Entry** | `$05DCDD` | ✓ Hooked |
| **Level Data Load** | `$05D796` | ✗ Not hooked |
| **Level Init** | `$00A635` | ✗ Not hooked |
| **Death/Respawn** | After `$00F606` | ✗ Not hooked |
| **Midway Respawn** | `$00F2CD` area | ✗ Not hooked |
| **Continue Screen** | Via game mode | ✗ Not hooked |
| **Instant Retry** | Hack-specific | ✗ Not hooked |

### Why asm1.py Fails

**Problem**: Only hooks `$05DCDD` (one specific routine)

**What happens**:
1. ✓ Entering from overworld → Works (hooked)
2. ✗ Death → Loads different level (not hooked)
3. ✗ Midway respawn → Loads different level (not hooked)
4. ✗ Instant retry → Loads different level (not hooked)

## Solution: Hook ALL Entry Points

### Universal Hook Strategy

Hook the **main level data loading routine** at `$05D796`:
- This is called for ALL level loads
- Catches: initial entry, death, midway, continue, retry
- Most universal solution

### Additional Hooks for Robustness

1. **Level Init** (`$00A635`): Catches level initialization
2. **Game Mode Handler** (`$008222`): Catches game mode changes
3. **Pre-Death** (before `$00F606`): Ensures level is set before death

## Game Modes

Game modes control what the game is doing:

| Mode | Purpose | Notes |
|------|---------|-------|
| 0x03 | Title screen | |
| 0x0E | Overworld | |
| 0x10 | Black screen (OW → Level) | |
| 0x11 | "Mario Start!" message | |
| 0x14 | In level (playing) | Main gameplay |

**Hook**: When mode changes to 0x14, ensure level is set correctly

## Midway Point Data

| Offset | Size | Purpose |
|--------|------|---------|
| `$05F400` | 512 bytes | Midway entrance data (mmmmffbb format) |
| `$05D730` | varies | Mario Y-Position (main and midway) |
| `$05D740` | varies | Mario Y-Subscreen Positions |
| `$05D750` | varies | Mario X-Positions |
| `$05D758` | varies | Mario X-Subscreen Positions |

**Format** (mmmmffbb):
- `mmmm` = screen for midway entrance (4 bits)
- `ff` = FG initial position (2 bits)
- `bb` = BG initial position (2 bits)

## Switch Palace Flags

Some hacks need switch palaces enabled:

| Address | Switch | Value |
|---------|--------|-------|
| `$1F27` | Red | 0x01 = pressed |
| `$1F28` | Yellow | 0x01 = pressed |
| `$1F29` | Green | 0x01 = pressed |
| `$1F2A` | Blue | 0x01 = pressed |

## SA-1 ROM Detection

Many modern hacks use SA-1 chip:

```asm
if read1($00FFD5) == $23
    sa1rom
    !addr = $6000
else
    lorom
    !addr = $0000
endif
```

This changes RAM addressing - critical for compatibility!

## Lessons from asm1.py

### What Works

1. ✓ Skipping intro (`org $9CB1: db $00`)
2. ✓ Short timer for testing (`org $00A09C: db $10`)
3. ✓ Setting `$13BF` and `$17BB` together
4. ✓ Filling arrays `$19B8` and `$19D8`
5. ✓ SA-1 detection

### What Doesn't Work

1. ✗ Only hooking one entry point
2. ✗ Not handling death respawns
3. ✗ Not handling midway respawns
4. ✗ Not handling instant retry systems

### Patch Variations in asm1.py

**Patch A** (pids 1-7): Basic hook at `$05DCDD`
**Patch B** (pids 8-13): More sophisticated, multiple hooks
**Patch C** (pid 20): Different hook location (`$85D856`)

None handle ALL entry points comprehensively.

## Improved Strategy

### Hook Points for Complete Coverage

1. **Primary**: `$05D796` - Main level data loading routine
   - Called for ALL level loads
   - Most universal hook point

2. **Secondary**: `$00A635` - Level initialization
   - Catches level setup
   - Backup hook

3. **Tertiary**: Game mode handler
   - Ensures level is correct when entering gameplay mode
   - Catches edge cases

4. **Quaternary**: Pre-death hook
   - Sets level before death occurs
   - Ensures respawn goes to correct level

## Testing Requirements

### Must Test On

1. **Vanilla SMW** - Baseline
2. **Simple hacks** - Basic Lunar Magic edits
3. **SA-1 hacks** - Different addressing
4. **Kaizo hacks** - Often have instant retry
5. **Hacks with custom ASM** - May override our hooks

### Test Scenarios

For each ROM, test:
1. ✓ Initial entry
2. ✓ Death → respawn
3. ✓ Midway point → death → respawn
4. ✓ Exit → re-entry
5. ✓ Continue screen

## Sample ROMs for Testing

Available at `refmaterial/samplerom/`: **127 ROMs**

Good test candidates:
- Mix of old and new hacks
- Variety of difficulty levels (likely different mechanics)
- Different sizes (some use more ROM space = more features)

## Implementation in smw_level_force.py

The new tool (`smw_level_force.py`) implements:

✓ Universal patch (hooks main load routine)  
✓ Aggressive patch (hooks multiple points)  
✓ SA-1 detection  
✓ Proper level ID calculation  
✓ Array filling for compatibility  

## References

- **asm1.py**: Original patch generator (partial implementation)
- **ROM Map**: `legacy/smwc_rommap_index.json`
- **Sample ROMs**: `refmaterial/samplerom/` (127 test cases)
- **asar**: `refmaterial/asar-1.91/` (assembler)

## Next Steps

1. Test `smw_level_force.py` on sample ROMs
2. Identify failure cases
3. Refine hook points based on results
4. Document which patch type works for which ROM types

