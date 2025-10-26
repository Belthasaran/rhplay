# SMW Overworld Modification Project - Status

## Goal

Create tools to:
1. Determine Mario's exact starting position on the overworld and which level ID it corresponds to
2. Create a modified ROM where Mario starts at a specified level ID
3. Disable overworld events after level clear
4. Lock the player on one overworld square (prevent movement)

## Current Status

### ✅ Completed

1. **smw_overworld_analyzer.py** - Basic framework created
   - Reads initial overworld position data from ROM (offset 0x09EF0)
   - Detects ROM headers automatically
   - Parses Mario/Luigi starting positions
   
2. **smw_create_test_rom.py** - Basic framework created
   - Can modify ROM files
   - Tracks all modifications made
   - Can skip intro level
   - Framework for setting starting level

3. **Research Completed**
   - Found initial overworld position offset: `$009EF0` (22 bytes)
   - Found intro level setting: `$009CB1`
   - Identified relevant ROM map entries for overworld data

### ⚠️ Partially Implemented

1. **Overworld Position Reading**
   - Can read raw position data
   - Structure interpretation needs refinement
   - Need to map positions to actual overworld tiles

2. **Level Starting**
   - Basic intro skip implemented
   - Need proper level-to-overworld mapping
   - Need to understand translevel numbers vs level IDs

### ❌ Not Yet Implemented

1. **Overworld Tile to Level Mapping**
   - Need to find where overworld tiles map to level IDs
   - In Lunar Magic ROMs, this may be in dynamically allocated areas
   - Critical for determining which tile contains which level

2. **Overworld Path Modification**
   - Need to find path data tables
   - ROM map shows paths at `$0393A4` and `$0393EF` but need more details
   - Need to zero out directions to lock player in place

3. **Overworld Event Disabling**
   - Event data at `$04E453` (layer 2 events)
   - Event tiles at `$04E5E6`
   - Need to disable/modify these to prevent post-level events

## Technical Challenges

### Challenge 1: Overworld Structure Complexity

The overworld in SMW is complex:
- **Layer 1**: Actual walkable tiles
- **Layer 2**: Events and decorations
- **Tile to Level Mapping**: Not a simple 1:1 array
- **Path System**: Directional movement rules per tile
- **Events**: Triggered after level completion

### Challenge 2: Lunar Magic Modifications

Lunar Magic modifies ROM structure:
- Initial flags moved from `$009EE0` to `$05DDA0`
- Some tables dynamically relocated
- Need to detect LM modifications and handle both vanilla and LM ROMs

### Challenge 3: Level ID vs Translevel Number

SMW uses different numbering systems:
- **Level ID**: 0x000-0x1FF (what we use)
- **Translevel Number**: Different encoding used in some tables
- **Level + 0x24**: Used in some ROM locations
- Need to convert between these properly

## Required Research

### 1. Overworld Tile to Level Mapping

**What we need to find:**
- Table that maps overworld tile positions to level IDs
- Format: likely X/Y coordinates or tile numbers → level IDs
- Location: Unknown, may be in LM-modified area

**How to find it:**
- Analyze Lunar Magic binary for references
- Compare vanilla vs modified ROMs
- Trace overworld entry code in emulator debugger

### 2. Overworld Path Data Structure

**What we know:**
- `$0393A4`: Path for brown blocks in submaps
- `$0393EF`: Path for brown blocks on main overworld
- `$049078`: List of levels with hard-coded paths

**What we need:**
- Full path table structure
- How directions are encoded (up/down/left/right)
- How to disable all directions for a tile

### 3. Overworld Event System

**What we know:**
- `$04E453`: Loads layer 2 events
- `$04E5E6`: Tiles that trigger save prompt after events
- `$04DA1D`: Tiles that change into other tiles (22 bytes)

**What we need:**
- How to disable specific events
- Format of event data
- How to prevent any events from triggering

## Recommended Approach

### Phase 1: Direct Level Entry (Simpler)

Instead of modifying overworld, bypass it entirely:

1. **Skip Intro** ✓ (Already done)
   ```
   Offset: $009CB1
   Set to: 0x00
   ```

2. **Direct Level Start**
   - Modify game mode to skip overworld entirely
   - Jump directly to level load
   - Return to title screen on exit (not overworld)

**Advantages:**
- Simpler to implement
- No overworld complications
- Works for level testing

**Disadvantages:**
- No overworld at all
- Can't see Mario's starting position visually

### Phase 2: Overworld Modification (Complex)

Full overworld modification as originally requested:

1. Find overworld tile → level mapping
2. Modify starting position to desired tile
3. Lock paths (zero all directions)
4. Disable events

**Advantages:**
- Keeps overworld functional
- Visual confirmation of position
- More like regular SMW gameplay

**Disadvantages:**
- Requires extensive reverse engineering
- Complex to implement correctly
- May break in different ROM hacks

## Next Steps

### Immediate (Can Do Now)

1. ✅ Create framework tools (Done)
2. Implement Phase 1 (Direct Level Entry)
   - Bypass overworld completely
   - Direct to level
   - Simple exit handling

### Short Term (Needs Research)

1. Analyze overworld code in emulator debugger
2. Find tile → level mapping tables
3. Document path data structure
4. Test modifications on vanilla SMW

### Long Term (Full Implementation)

1. Implement Phase 2 (Full Overworld Modification)
2. Support both vanilla and Lunar Magic ROMs
3. Create GUI tool for easy test ROM creation
4. Add options for different test scenarios

## Tools Created

### smw_overworld_analyzer.py

**Status**: Framework complete, needs refinement

**What it does:**
- Reads initial overworld position (offset 0x09EF0)
- Shows Mario/Luigi starting positions
- Exports to JSON

**What it needs:**
- Better position interpretation
- Tile to level ID lookup
- Support for finding which tile contains a specific level

**Usage:**
```bash
./smw_overworld_analyzer.py rom.sfc --read-start
```

### smw_create_test_rom.py

**Status**: Framework complete, core features need implementation

**What it does:**
- Modifies ROM files
- Skips intro
- Tracks modifications

**What it needs:**
- Actual level starting implementation
- Overworld path locking
- Event disabling

**Usage:**
```bash
./smw_create_test_rom.py input.sfc --level 0x105 --output test.sfc
```

## Alternative Solutions

### Option A: Use Existing Tools

**Lunar Magic** already has some test features:
- Can test levels directly
- Has "Test From Here" option
- May be sufficient for testing

### Option B: Emulator Cheats/Patches

Use emulator features:
- Set RAM addresses directly
- Warp to specific levels
- Disable overworld mechanics
- No ROM modification needed

### Option C: ASM Hack Approach

Create a small ASM patch:
- Hook into level init code
- Force specific level
- Simpler than full ROM structure modification

## Conclusion

The tools are partially implemented. To complete this project, we need:

1. **More Research**: Overworld data structures
2. **Debugger Analysis**: Trace actual code execution
3. **Testing**: Verify modifications work correctly

**Recommendation**: Start with Phase 1 (Direct Level Entry) which bypasses the overworld entirely. This is simpler and achieves the core goal of testing specific levels.

For full overworld modification (Phase 2), significant additional reverse engineering is required.

## References

- **ROM Map**: `legacy/smwc_rommap_index.json`
- **Lunar Magic**: `refmaterial/Lunar_Magic_lm361/`
- **Initial Position**: Offset `0x09EF0` (22 bytes)
- **Intro Level**: Offset `0x09CB1` (1 byte)

## Files Created

- `smw_overworld_analyzer.py` - Position analysis tool
- `smw_create_test_rom.py` - ROM modification framework
- `devdocs/SMW_OVERWORLD_PROJECT_STATUS.md` - This document

