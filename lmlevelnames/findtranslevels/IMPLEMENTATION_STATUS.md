# Translevel Finder - Implementation Status

## Current Status

### ✅ Working Components

1. **Table Location Detection**: Successfully uses `OverworldTables.asm` to detect:
   - Initial flags table location (`$009EE0` for vanilla)
   - Layer 1 event data location (varies)
   - Translevel hijack status

2. **Basic Script Structure**: Framework is in place with:
   - SNES address conversion
   - Header detection
   - JSON output format

### 🔨 In Progress

1. **Translevel Table Location**: 
   - Hijacked location detection works
   - **Missing**: Vanilla translevel table location (when hijack not applied)
   - **Missing**: LC_LZ2/LC_LZ3 decompression support

2. **Overworld Tilemap Parsing**:
   - Not yet implemented
   - Need to understand:
     - How Layer 1 tilemaps store translevel references
     - Tilemap data structure
     - Submap organization

3. **Translevel -> Level Mapping**:
   - Table location detection works
   - **Missing**: Table parsing and mapping logic

## Test Results

Tested on `testrom2/temp_lm361_13836.sfc`:

```json
{
  "tables": {
    "translevel_hijacked": false,
    "initial_flags": "009EE0",
    "layer1_event_data": "363636"
  }
}
```

**Findings:**
- Translevel hijack is NOT applied (uses vanilla location)
- Initial flags table found at vanilla location `$009EE0`
- Layer 1 event data found at `$363636` (SNES address)
- Translevel table location not detected (vanilla location unknown)

## Research Needed

### 1. Vanilla Translevel Table Location

**Question**: Where is the translevel table stored in an unmodified SMW ROM?

**Possible Locations**:
- May be embedded in the overworld loading code
- Could be a fixed table at a known SNES address
- May be compressed at a specific location

**Research Methods**:
- Analyze vanilla SMW ROM structure
- Check SMW documentation/wikis
- Look for patterns in ROM data
- Check if `OverworldTables.asm` can detect it (may need enhancement)

### 2. Translevel -> Level Number Mapping Format

**Question**: How is the mapping between translevel numbers and level numbers stored?

**Possible Formats**:
- Direct byte table: `translevel_id -> level_id`
- Indexed table with offsets
- Compressed format (LC_LZ2/LC_LZ3)

**Research Methods**:
- Analyze translevel table data (once location is found)
- Compare known translevel/level pairs from game
- Check SMW ROM documentation

### 3. Overworld Layer 1 Tilemap Structure

**Question**: How do overworld tiles reference translevel numbers?

**Possible Methods**:
- Tile value directly = translevel number
- Tile value indexes into translevel lookup table
- Separate table maps tile positions to translevels

**Known Information**:
- Layer 1 event data at detected location
- 16x16 tiles on overworld maps
- Multiple submaps exist

**Research Methods**:
- Parse Layer 1 event data structure
- Analyze overworld tilemap format
- Map known level positions to tile coordinates
- Check SMW ROM documentation

### 4. LC_LZ2/LC_LZ3 Decompression

**Question**: How to decompress Lunar Magic's LC_LZ2/LC_LZ3 format?

**Status**: Not implemented

**Research Methods**:
- Find existing decompression libraries
- Check SMW hacking community resources
- Implement based on format documentation

### 5. Submap Detection

**Question**: How to identify which submap a tile belongs to?

**Known Information**:
- Multiple submaps exist in SMW
- Submap switching is handled by game code
- May be stored in overworld data structures

**Research Methods**:
- Analyze submap switching code
- Check overworld data structures
- Map known level submaps to tile positions

## Next Steps

1. **Research vanilla translevel table location**
   - Priority: HIGH (blocks table reading)
   - Check SMW documentation and ROM structure

2. **Implement LC_LZ2/LC_LZ3 decompression**
   - Priority: HIGH (needed for compressed tables)
   - Find or implement decompression algorithm

3. **Research overworld tilemap structure**
   - Priority: HIGH (needed for finding translevels)
   - Analyze Layer 1 event data and tilemap format

4. **Implement translevel -> level mapping**
   - Priority: MEDIUM (needed for complete output)
   - Parse mapping table once location is known

5. **Implement submap detection**
   - Priority: MEDIUM (enhances output)
   - Add submap information to output

## Files Created

1. **`find_translevels.py`**: Main script framework
2. **`README.md`**: Documentation
3. **`TRANLEVEL_RESEARCH.md`**: Research notes
4. **`IMPLEMENTATION_STATUS.md`**: This file

## References

- `OverworldTables.asm`: ASM script for table detection
- `../leveldetector/`: Related level detection scripts
- SMW ROM structure documentation (to be researched)

