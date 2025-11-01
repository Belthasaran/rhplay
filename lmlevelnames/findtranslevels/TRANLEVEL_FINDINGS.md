# Translevel Structure - Key Findings from ASM Files

## Critical Discoveries

### 1. Translevel -> Level Number Mapping

From `Level Number.asm` (lines 41-52):

**Mapping Formula:**
- **Translevel 00-24 (0x00-0x18)** → **Level 000-024 (0x000-0x018)**
- **Translevel 25-5F (0x19-0x5F)** → **Level 101-13B (0x101-0x13B)**

**Code Logic:**
```asm
.noOverride:  	; get high bit based on translevel ID; 00-24 = 000-024, 25-5F = 101-13B
    TAY
    LDA $13BF|!addr  ; translevel number
    CMP #$25
    BCC .below100
    SBC #$24
    INY
.below100:
    STA $17BB|!addr
    STA $0E
    TYA
    RTL
```

**Python Implementation:**
```python
def translevel_to_level(translevel: int) -> int:
    """Convert translevel number to level number."""
    if translevel < 0x25:
        return translevel  # 0x00-0x18 -> 0x000-0x018
    else:
        return (translevel - 0x24) + 0x100  # 0x19-0x5F -> 0x101-0x13B
```

### 2. LevelNumberMap Table

From `Overworld Tilemaps.asm` (line 290):

**Description:**
- **Name**: `LevelNumberMap`
- **Content**: "translevel numbers + exit path directions for each tile"
- **Compression**: LC_LZ2
- **Decompressed to**: RAM `$7ED000` (`!RAM_OWLevelNums`)
- **Source Location**: Found via OverworldTables.asm (if hijacked) or vanilla location

**Structure:**
- This table maps each overworld tile position to a translevel number
- Also contains exit path direction information
- Format: Each tile in the overworld tilemap has an entry

### 3. Overworld Layer 1 Tilemap Structure

From `Overworld Tilemaps.asm`:

**RAM Locations:**
- `!RAM_OWLevelNums = $7ED000` - Level number map (translevels + exit paths)
- `!RAM_OWLayer1L = $7EC800` - Layer 1 tilemap low bytes
- `!RAM_OWLayer1H = $7FC800` - Layer 1 tilemap high bytes

**Tilemap Dimensions:**
- Overworld maps are organized as grids of 16x16 tiles
- Multiple submaps exist (typically 2: main map and submap)

### 4. Layer 1 Events

From `Overworld Tilemaps.asm`:

**Event System:**
- `Layer1EventPositions` - Table of positions for event tiles
- Events can create/change level tiles
- Silent events can reveal tiles after beating levels
- Destruction events can remove level tiles

**Event Count:**
- Default: 0x78 (120) events
- With overworld expansion: 0xFF (255) events

### 5. Initial Level Flags

From `Initial Level Flags.asm`:

**Table Locations:**
- **Vanilla**: `$05DDA0` (96 bytes, one byte per translevel)
- **With Expansion**: `$03BE80` (256 bytes, one byte per translevel)

**Purpose:**
- Stores initial flags for each translevel
- Loaded when creating a new save file
- One byte per translevel

### 6. Secondary Entrances

From `Secondary Entrances.asm`:

**Tables:**
- `$05F800` - Byte 1
- `$05FA00` - Byte 2
- `$05FC00` - Byte 3
- `$05FE00` - Byte 4
- Extended bytes 5/6 via hijack

**Purpose:**
- Maps secondary entrance indices to level data
- Can reference translevels

## Implementation Plan

### Step 1: Find and Decompress LevelNumberMap

1. Use OverworldTables.asm to locate `LevelNumberMap` source
2. If compressed (LC_LZ2), decompress it
3. Parse the decompressed data to extract translevel numbers per tile

### Step 2: Parse Overworld Tilemap

1. Locate Layer 1 tilemap data (low/high bytes)
2. Map tile positions (X, Y) to translevel numbers via LevelNumberMap
3. Identify which submap each tile belongs to

### Step 3: Extract Event Data

1. Parse `Layer1EventPositions` table
2. Identify event tiles and their translevel references
3. Map events to tile positions

### Step 4: Build Translevel Map

1. For each translevel found:
   - Convert to level number using mapping formula
   - List all tile positions where it appears
   - List submap information
   - List any events that reference it

## Data Structures

### Translevel Entry (JSON)

```json
{
  "translevel": 0x01,
  "level_number": 0x001,
  "locations": [
    {
      "submap": 0,
      "tile_x": 5,
      "tile_y": 3,
      "source": "tilemap"
    }
  ],
  "events": [
    {
      "event_id": 0x05,
      "tile_x": 8,
      "tile_y": 4,
      "event_type": "silent"
    }
  ]
}
```

## Notes

- Translevel range: 0x00-0x5F (96 translevels total)
- Level number range: 0x000-0x13B (extended by LM)
- Each overworld tile position can reference one translevel
- Events can modify tiles dynamically (reveal/change/destroy)

