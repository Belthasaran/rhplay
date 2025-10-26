# Super Mario World ROM Structure Documentation

## Overview

This document describes the internal structure of Super Mario World (SMW) ROM files (.SFC/.SMC format) as they relate to level data and level names. This information is primarily relevant for analyzing ROMs edited with Lunar Magic.

## ROM Format

SMW uses the **LoROM** mapping format. SNES addresses must be converted to file offsets:

### LoROM Address Conversion

For SNES addresses in the format `$BB:AAAA` (Bank:Address):
- **File Offset** = `((Bank & 0x7F) × 0x8000) + (Address & 0x7FFF)`

Example:
- SNES Address `$05:E000`
- File Offset = `(0x05 × 0x8000) + (0xE000 & 0x7FFF)` = `0x28000 + 0x6000` = `0x2E000`

### Header Considerations

Some ROM files have a 512-byte copier header. To detect:
- Check if `(file_size % 1024) == 512`
- If yes, add 512 bytes to all file offsets
- Modern tools often remove the header, but always check

## Level Data Structure

### Level Count
SMW supports **512 levels** (0x000 to 0x1FF), though not all are used in vanilla SMW.

### Level Data Pointer Tables

Each level has three separate pointer tables for different data:

| Data Type | SNES Address | File Offset (no header) | Size | Entry Size |
|-----------|--------------|-------------------------|------|------------|
| **Layer 1** | `$05:E000` | `0x2E000` | 1536 bytes | 3 bytes per level |
| **Layer 2** | `$05:E600` | `0x2E600` | 1536 bytes | 3 bytes per level |
| **Sprites** | `$05:EC00` | `0x2EC00` | 1024 bytes | 2 bytes per level |

#### Layer 1/2 Pointer Format (3 bytes)

Each 3-byte pointer is stored in little-endian format and points to compressed level data:

```
Byte 0: Low byte of pointer
Byte 1: Middle byte of pointer  
Byte 2: High byte (often contains bank info)
```

The pointer is a 24-bit SNES address pointing to the compressed level data.

#### Detecting Modified Levels

To find which levels have been modified in a ROM hack:
1. Compare the 3-byte pointer at offset `0x2E000 + (level_id × 3)` against vanilla SMW
2. If the pointers differ, the level has been modified
3. Check all three pointer tables (Layer 1, Layer 2, Sprites) for complete analysis

### Level Properties Table

| Property | SNES Address | File Offset | Size | Format |
|----------|--------------|-------------|------|--------|
| **Level settings** | `$05:F600` | `0x2F600` | 512 bytes | `iuveeeee` format |

Format breakdown:
- `i` = disable No Yoshi Intro flag
- `u` = unknown vertical level positioning flag
- `v` = vertical level positioning flag
- `eeeee` = screen # that the primary entrance is on

### Secondary Entrance Tables

| Table | SNES Address | File Offset | Size | Description |
|-------|--------------|-------------|------|-------------|
| **Destination level (low byte)** | `$05:F800` | `0x2F800` | 512 bytes | Low byte of destination level number |
| **Position/screen** | `$05:FA00` | `0x2FA00` | 512 bytes | Y position + FG/BG initial position |
| **Action/flags** | `$05:FE00` | `0x2FE00` | 512 bytes | Mario action + level high bit + slippery flag |

**Note:** As of Lunar Magic v2.50+, these tables may be dynamically relocated. Check the pointers at:
- `$0DE191` (read 3 bytes) for secondary entrance low byte table
- `$0DE198` (read 3 bytes) for position table
- `$05DC81` (read 3 bytes) for action/flags table

## Level Names

Level names in SMW are stored in a compressed, chunk-based format for the overworld display.

### Level Name Data Structures

| Structure | SNES Address | File Offset | Size | Description |
|-----------|--------------|-------------|------|-------------|
| **Level name tile data** | `$04:9AC5` | `0x21AC5` | 460 bytes | Raw tilemap data for level names |
| **Name assembly index** | `$04:A0FC` | `0x220FC` | 186 bytes | Index describing how to assemble names from chunks |
| **Chunk pointer table 1** | `$04:9C91` | `0x21C91` | varies | Pointers to first chunks |
| **Chunk pointer table 2** | `$04:9CCF` | `0x21CCF` | varies | Pointers to second chunks |
| **Chunk pointer table 3** | `$04:9CED` | `0x21CED` | varies | Pointers to third chunks |
| **OW name position** | `$04:9D22` | `0x21D22` | 2 bytes | Screen position for level names |

### Level Name Format

Level names are stored as SNES tilemap data (almost raw VRAM format) but without the `YXPCCCTT` format. The data is split into small chunks that must be assembled:

1. **Name Assembly Index** (`0x220FC`): 16-bit entries (2 bytes each)
   - Byte 0 (low): Upper 4 bits = offset to second chunk, Lower 4 bits = offset to third chunk
   - Byte 1 (high): 7 bits = offset to first chunk (bit 7 unused)

2. **Chunk Pointer Tables**: Each entry points into the tile data at `0x21AC5`

3. **Tile Data** (`0x21AC5`): 
   - Each byte is a tile number
   - If bit 7 is set, clear it and treat as end-of-area marker
   - Tiles use the SNES font/graphics loaded for the overworld

### Extracting Level Names (Pseudocode)

```python
def extract_level_name(rom_data, level_id):
    # Read assembly index
    index_offset = 0x220FC + (level_id * 2)
    byte0 = rom_data[index_offset]
    byte1 = rom_data[index_offset + 1]
    
    # Parse offsets
    chunk3_offset = byte0 & 0x0F
    chunk2_offset = (byte0 >> 4) & 0x0F
    chunk1_offset = byte1 & 0x7F
    
    # Read chunk pointers (16-bit each)
    ptr1 = read_16bit(rom_data, 0x21C91 + chunk1_offset * 2)
    ptr2 = read_16bit(rom_data, 0x21CCF + chunk2_offset * 2)
    ptr3 = read_16bit(rom_data, 0x21CED + chunk3_offset * 2)
    
    # Each pointer is relative to 0x21AC5
    name_bytes = []
    for ptr in [ptr1, ptr2, ptr3]:
        offset = 0x21AC5 + ptr
        while True:
            tile = rom_data[offset]
            if tile & 0x80:  # End marker
                name_bytes.append(tile & 0x7F)
                break
            name_bytes.append(tile)
            offset += 1
    
    return name_bytes  # Convert to string using SNES charset
```

## Level Name Positioning

The overworld level name position is stored at `$04:9D22` (`0x21D22`):
- Increase/decrease by 1: moves right/left
- Increase/decrease by 20 (0x14): moves down/up
- Note: `#$8B` should be considered the low byte, not `#$50`

## Vanilla SMW Level Usage

Not all 512 level slots are used in vanilla SMW. The commonly used ranges are:

- `0x000 - 0x024`: Primary levels (Yoshi's Island through Special World)
- `0x101 - 0x13B`: Sublevels and bonus rooms
- Other slots: Available for custom levels in ROM hacks

## Practical Analysis Techniques

### Finding Modified Levels

```python
def find_modified_levels(hack_rom, vanilla_rom):
    modified_levels = []
    
    for level_id in range(512):
        offset = 0x2E000 + (level_id * 3)
        
        hack_ptr = hack_rom[offset:offset+3]
        vanilla_ptr = vanilla_rom[offset:offset+3]
        
        if hack_ptr != vanilla_ptr:
            modified_levels.append(level_id)
    
    return modified_levels
```

### Comparing Two ROM Hacks

```python
def compare_level_changes(rom_a, rom_b):
    changed_levels = []
    
    for level_id in range(512):
        # Check Layer 1
        offset_l1 = 0x2E000 + (level_id * 3)
        if rom_a[offset_l1:offset_l1+3] != rom_b[offset_l1:offset_l1+3]:
            changed_levels.append(level_id)
            continue
            
        # Check Layer 2
        offset_l2 = 0x2E600 + (level_id * 3)
        if rom_a[offset_l2:offset_l2+3] != rom_b[offset_l2:offset_l2+3]:
            changed_levels.append(level_id)
            continue
            
        # Check Sprites
        offset_spr = 0x2EC00 + (level_id * 2)
        if rom_a[offset_spr:offset_spr+2] != rom_b[offset_spr:offset_spr+2]:
            changed_levels.append(level_id)
    
    return changed_levels
```

## References

- **Lunar Magic**: The primary SMW level editor (refmaterial/Lunar_Magic_lm361/)
- **SMW Central ROM Map**: Comprehensive ROM address documentation (legacy/smwc_rommap_index.json)
- **Existing Tools**: See `legacy/findlevels.py` for a basic level detection script

## Notes for Tool Development

1. Always check for ROM headers (512-byte offset)
2. Consider that Lunar Magic 2.50+ can relocate some tables dynamically
3. Level data is compressed using the Nintendo LZ compression format
4. Level names use the SNES character encoding (not ASCII)
5. The actual level graphics/tiles are separate from the level structure data

## Limitations

This documentation covers the most commonly modified aspects. SMW ROMs contain much more data:
- Graphics/GFX data
- Music and sound effects
- Sprite properties and AI
- Palette data
- Overworld structure
- Message boxes and text

Refer to the full ROM map at `legacy/smwc_rommap_index.json` for comprehensive coverage.

