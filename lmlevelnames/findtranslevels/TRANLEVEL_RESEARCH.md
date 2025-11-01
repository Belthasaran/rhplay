# Translevel Detection - Research Notes

## Overview
Translevels are a separate numbering system from level IDs (translevel numbers vs. level numbers). They are used in the overworld to map 16x16 tiles to level data.

## Key Findings from OverworldTables.asm

### Translevel Table Location
- **Vanilla**: Not explicitly mentioned, but likely at a fixed location
- **LM Hijacked**: If `read1($04D807) == $A9`, then translevel table is at:
  - Address: `(read1($04D808)<<16)|read2($04D803)`
  - Format: Compressed with LC_LZ2 or LC_LZ3

### Initial Level Flags Table
- **Vanilla**: `$009EE0` (16 bytes) - pairs of bytes: [translevel, overworld_level_settings]
- **LM Modified**: `$05DDA0` (96 bytes) - one byte per translevel for initial flags

### Overworld Layer 1 Structure
- Layer 1 tilemap contains 16x16 tiles that map to translevels
- Each tile in the overworld tilemap references a translevel number
- Translevels then map to actual level numbers (level IDs)

## Translevel to Level Number Mapping
The compressed translevel table (if hijacked) or vanilla structure contains the mapping from translevel numbers to actual level numbers.

## Overworld Tile to Translevel Mapping
- Each 16x16 tile on the overworld Layer 1 tilemap contains a translevel reference
- Overworld maps are organized by submaps
- Event data (Layer 1 event data) may also reference translevels

## Research Questions
1. How are translevel numbers stored in the overworld Layer 1 tilemap?
2. What is the range of valid translevel numbers (smaller than 0x200 level IDs)?
3. How do we map translevel -> level number?
4. How do we extract overworld tile positions and submap information?

## Next Steps
1. Use OverworldTables.asm to detect translevel table location
2. Decompress translevel table if compressed (LC_LZ2/LC_LZ3)
3. Parse overworld Layer 1 tilemap to find all translevel references
4. Map translevels to level numbers
5. Map translevels to overworld tile positions and submaps

