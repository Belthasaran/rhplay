# Translevel Finder

## Overview

This directory contains scripts to find and map all accessible translevels in Super Mario World ROM overworld maps.

## What are Translevels?

Translevels are a separate numbering system from level IDs (level numbers). They are used in the overworld to map 16x16 tiles to level data.

### Key Differences

- **Translevels**: Smaller range (< 256 typically), used by overworld tilemaps to reference levels
- **Level IDs**: Full range (0x000-0x1FF or more), the actual level numbers used by the game engine

### Mapping Flow

```
Overworld Tile (16x16 position)
  → Translevel Number (via Layer 1 tilemap)
    → Level Number (via translevel -> level mapping table)
```

## Current Implementation Status

### ✅ Completed

- **Basic structure**: Script framework for finding translevels
- **Table detection**: Uses `OverworldTables.asm` to locate translevel table location
- **Initial flags parsing**: Detects initial level flags table location
- **Translevel -> Level mapping**: Formula implemented (00-24 -> 000-024, 25-5F -> 101-13B)
- **JSON output structure**: Complete format defined and implemented
- **Research**: Comprehensive analysis of SMW-DataG/Disassembly ASM files
- **Vanilla ROM support**: Fully working tilemap scanning (CODE_04D7F9 method)
- **LC_LZ2/LC_LZ3 decompression**: Wrapper created for Lunar Compress DLL/decomp.exe

### 🔨 In Progress

- **LC_LZ2/LC_LZ3 decompression**: Wrapper available, needs testing on hijacked ROMs
- **LevelNumberMap parsing**: Basic implementation, needs format verification
- **Event parsing**: Not yet implemented

### ❌ TODO

1. **Event parsing**: Parse Layer 1 event positions and map events to translevels
2. **Testing**: Test LC_LZ2 decompression on ROMs with hijacked LevelNumberMap

## Scripts

### `find_translevels.py`

Main script to find all accessible translevels in a ROM.

**Usage:**
```bash
python find_translevels.py --romfile path/to/rom.sfc [--output output.json] [--verbose]
```

**Features:**
- Automatically detects vanilla vs. LM hijacked ROMs
- For vanilla ROMs: Scans Layer 1 tilemap (CODE_04D7F9 method)
- For LM hijacked ROMs: Decompresses and parses LevelNumberMap
- Maps translevels to level numbers
- Extracts tile positions, submaps, exit paths

**Output Format:**
```json
{
  "rom_file": "path/to/rom.sfc",
  "tables": {
    "translevel_hijacked": false,
    "initial_flags": "009EE0",
    "layer1_event_data": "363636"
  },
  "translevels": [
    {
      "translevel": 1,
      "level_number": 1,
      "locations": [
        {
          "submap": 0,
          "tile_x": 16,
          "tile_y": 0,
          "source": "tilemap",
          "tile_value": 103,
          "exit_path": 192
        }
      ],
      "events": []
    }
  ]
}
```

### `lc_decompress.py`

Wrapper for Lunar Compress DLL/decomp.exe for LC_LZ2/LC_LZ3 decompression.

**Requirements:**
- Lunar Compress DLL (`lc190/Lunar Compress.dll` or `lc190/x64/Lunar Compress.dll`)
- OR `lc190/decomp.exe` (or `lc190/x64/decomp.exe`)

**Usage:**
```python
from lc_decompress import decompress_lc_lz2, decompress_lc_lz3

# Decompress LC_LZ2 data
decompressed = decompress_lc_lz2(rom_data, rom_offset, max_size=0x10000)

# Decompress LC_LZ3 data
decompressed = decompress_lc_lz3(rom_data, rom_offset, max_size=0x10000)
```

The wrapper automatically:
- Searches for DLL in common locations
- Falls back to `decomp.exe` if DLL cannot be loaded
- Handles both 32-bit and 64-bit DLLs (prefers x64)

## Research Notes

### Vanilla ROM Behavior (CODE_04D7F9)

In vanilla SMW, translevels are **generated dynamically** by scanning the Layer 1 tilemap:

1. **Source**: Layer 1 tilemap at SNES $0CF7DF (ROM offset varies)
2. **Level Tile Range**: Tiles with values $56-$80 (inclusive) are level tiles
3. **Assignment**: Translevels assigned sequentially (1, 2, 3, ...) as level tiles are found
4. **Exit Paths**: Looked up from DATA_04D678 table (SNES $04D678)

See `VANILLA_BEHAVIOR.md` for detailed analysis.

### LM Hijacked ROM Behavior

Lunar Magic hijacks CODE_04D7F9 and replaces it with:

1. **LevelNumberMap**: Compressed table (LC_LZ2/LC_LZ3) stored in ROM
2. **Location**: Found via OverworldTables.asm (dynamic)
3. **Decompression**: Decompressed to RAM $7ED000 at runtime
4. **Format**: Maps tile positions to translevel numbers + exit path directions

See `TRANLEVEL_FINDINGS.md` for detailed analysis.

## Key Findings

### Translevel -> Level Number Mapping

```python
def translevel_to_level(translevel: int) -> int:
    if translevel < 0x25:
        return translevel  # 0x00-0x18 -> 0x000-0x018
    else:
        return (translevel - 0x24) + 0x100  # 0x19-0x5F -> 0x101-0x13B
```

### LevelNumberMap Structure
- **Purpose**: Maps overworld tile positions to translevel numbers + exit path directions
- **Location**: Found via OverworldTables.asm (if hijacked) or vanilla location
- **Compression**: LC_LZ2 (if hijacked)
- **Decompressed to**: RAM $7ED000

### Overworld Structure
- **Tilemap**: 32x32 tiles per submap
- **Submaps**: Typically 2 (main map and submap)
- **Events**: Can create/modify level tiles dynamically

## Files

### Scripts
- **`find_translevels.py`** - Main script
- **`lc_decompress.py`** - Lunar Compress wrapper

### Documentation
- **`README.md`** - This file
- **`TRANLEVEL_RESEARCH.md`** - Initial research notes
- **`TRANLEVEL_FINDINGS.md`** - Key findings from ASM files
- **`VANILLA_BEHAVIOR.md`** - Vanilla ROM analysis (CODE_04D7F9)
- **`IMPLEMENTATION_STATUS.md`** - Status tracking
- **`SUMMARY.md`** - Implementation summary

## Test Results

Tested on `testrom2/temp_lm361_13836.sfc` (vanilla ROM):
- ✅ Table detection works
- ✅ Vanilla tilemap scanning implemented
- ✅ Found 96 translevels (maximum)
- ✅ Correct translevel -> level number mapping
- ✅ Tile positions, submaps, exit paths included
- ✅ JSON output complete

**Sample Output:**
- Translevels 1-36: Levels 1-36 (0x001-0x024)
- Translevels 37+: Levels 257+ (0x101+) - correctly mapped
- All translevels include: submap, tile_x, tile_y, tile_value, exit_path

## Dependencies

- **Python 3.x**
- **asar.exe** - For running OverworldTables.asm
- **Lunar Compress DLL** (optional) - For LC_LZ2/LC_LZ3 decompression
  - Located in `lc190/Lunar Compress.dll` or `lc190/x64/Lunar Compress.dll`
- **decomp.exe** (fallback) - If DLL cannot be loaded
  - Located in `lc190/decomp.exe` or `lc190/x64/decomp.exe`

## References

- `OverworldTables.asm`: ASM script to detect overworld table locations
- `../leveldetector/`: Related level detection scripts
- `SMW-DataG/Disassembly/LM/`: ASM source files for analysis
- SMW ROM structure documentation

## Next Steps

1. Test LC_LZ2 decompression on ROMs with hijacked LevelNumberMap
2. Implement event parsing (Layer 1 event positions)
3. Verify LevelNumberMap format on hijacked ROMs
4. Add support for expanded overworlds (> 2 submaps)
