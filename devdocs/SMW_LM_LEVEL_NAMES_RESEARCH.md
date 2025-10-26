# Lunar Magic Level Names - Research Needed

## Discovery

**User Report**: `smw_level_names.py` doesn't work with ANY Lunar Magic-modified hacks

**Finding**: Lunar Magic **completely rewrites** the level name system

## What We Know

### From LM Documentation (help file)

> "The original setup Nintendo used for this was rather annoying to work with, so **the game has been recoded** to allow each overworld level to have a completely separate name."

Key facts:
- **0x60 (96) entries** instead of vanilla's 93
- **Game code is modified** to use new system
- Completely separate name for each level
- Easier to edit in LM

### What We Found

1. ✅ **Vanilla data still exists** at 0x21AC5 (unchanged)
2. ✅ **Game displays custom names** on overworld ("Bullet Promenade", etc.)
3. ❌ **Custom names NOT in vanilla location**
4. ❌ **Custom names NOT searchable as text** in ROM
5. ❌ **LM pointer location unknown**

### Why Current Tool Doesn't Work

`smw_level_names.py` reads from vanilla locations:
- 0x21AC5 - Name tile data
- 0x220FC - Name assembly index
- 0x21C91/CCF/CED - Chunk pointers

**Problem**: Lunar Magic doesn't use these for display!
- LM modifies the ASM code that reads level names
- LM stores names in a new location
- LM uses a different format (96 entries, simpler structure)

## What Would Be Needed

### To Support LM Level Names

1. **Find LM's code modifications**
   - Where does LM patch the name display routine?
   - What new addressing does it use?

2. **Find the pointer to new data**
   - Similar to read3($0DE191) for secondary entrances
   - Must be stored somewhere in ROM

3. **Find the new data format**
   - How are 96 names stored?
   - What's the structure?
   - What encoding?

4. **Reverse engineer LM's system**
   - Analyze lm.exe binary
   - Find name editing/saving code
   - Trace where it writes data

### Estimated Effort

- **Research**: 2-3 days (analyze LM binary, trace code modifications)
- **Implementation**: 1-2 days (once format is known)
- **Testing**: 1 day (test on 127 sample ROMs)
- **Total**: ~5-7 days

## Current Status

### What Works

- ✅ Tool works perfectly for **vanilla SMW**
- ✅ Reads standard overworld name data
- ✅ Decodes SMW character encoding correctly
- ✅ Chunk assembly works properly

### What Doesn't Work

- ❌ **All Lunar Magic 2.5+ hacks** show vanilla names
- ❌ LM's relocated data location unknown
- ❌ LM's new format unknown

## Workarounds

### Option 1: Manual Documentation

For each hack, create a JSON file:
```json
{
  "hack_id": "18612",
  "level_names": {
    "0x103": "Bullet Promenade",
    "0x002": "Delfino Shores",
    "0x007": "The Watcher's Keep",
    ...
  }
}
```

### Option 2: Extract from LM Editor

1. Open ROM in Lunar Magic
2. Go to "Edit Level Names" dialog
3. Copy/paste each name
4. Save to file

### Option 3: Future Tool Enhancement

Research and implement LM level name extraction:
- Find LM's data format
- Update tool to support both vanilla and LM systems
- Auto-detect which system is in use

## Similar Successful Research

We successfully found and documented:
- ✅ Level pointer tables (verified against LM binary)
- ✅ Character encoding (fixed and working)
- ✅ ROM structure (empirically verified)

**This same methodology can work for level names**, but requires more time.

## Recommended Approach

### Short Term (Now)

1. **Document limitation** in tool
2. **Update help text** to note LM 2.5+ incompatibility
3. **Provide workarounds** for users
4. **Tool still works** for vanilla/pre-LM2.5 hacks

### Long Term (Future Enhancement)

1. **Analyze LM 3.61 binary** (`lm.exe`)
   - Find level name save routine
   - Find pointer storage location
   - Document new format

2. **Test on sample ROMs**
   - 127 ROMs available
   - Find patterns
   - Verify findings

3. **Implement LM support**
   - Detect LM version
   - Read from correct location
   - Support both vanilla and LM formats

## Files to Update

1. `smw_level_names.py` - Add note about LM limitation
2. `devdocs/SMW_LEVEL_NAMES_LIMITATIONS.md` - Document LM issue
3. `docs/PROGRAMS.MD` - Note compatibility

## Conclusion

**Current situation**:
- Tool works for vanilla format
- LM 2.5+ uses completely different system
- Would require significant research to support

**Decision needed**:
- Accept limitation and document it?
- Or invest 5-7 days to research and implement LM support?

Given that ALL modern hacks use Lunar Magic, LM support would be very valuable but requires dedicated reverse engineering effort.

## References

- **LM Help**: `refmaterial/Lunar_Magic_lm361/Lunar Magic.chm`
- **LM Binary**: `refmaterial/Lunar_Magic_lm361/x64/lm.exe`
- **Sample ROMs**: `refmaterial/samplerom/` (127 ROMs for testing)
- **ROM Map**: `legacy/smwc_rommap_index.json`

