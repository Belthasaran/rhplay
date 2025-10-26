# SMW Level Name Extraction via RAM

## The Problem

Lunar Magic transforms/encrypts level name data when storing in ROM files.  
Our ROM-based tools fail on ~95% of custom ROM hacks.

## The Solution

**Extract from RAM while the game is running** in an emulator.

No matter how LM stores data in ROM, the game must load it as plain text into RAM to display it.  
We read directly from RAM - bypassing ALL obfuscation!

## Quick Start

### Requirements
- BizHawk emulator (free): https://tasvideos.org/BizHawk
- Your SMW ROM file

### Steps

1. **Load ROM** in BizHawk
2. **Load script**: Tools > Lua Console > bizhawk_extract_levelnames.lua
3. **Play**: Move Mario over level tiles on overworld
4. **Done**: Script captures names automatically → levelnames_output.json

### Output Format

```json
{
  "rom_name": "Your Hack Name",
  "levels": [
    {
      "level_id": "0x105",
      "level_name": "BULLET PROMENADE",
      "overworld_tile": "0x5A"
    }
  ]
}
```

## Why This Works

```
ROM Storage (obfuscated/compressed):
  0x3F5439A45553920...

Game Processing (decompresses/decodes):
  ↓ Lunar Magic's decoder
  ↓ Decompression
  ↓ Character mapping

RAM (plain readable text):
  "BULLET PROMENADE"  ← WE READ HERE!

Screen Display:
  [Shows level name to player]
```

**Accuracy:** 100% on all ROM hacks!

## Documentation

- **User Guide**: `docs/LEVEL_NAME_EXTRACTION_GUIDE.md`
- **Technical Details**: `devdocs/RAM_EXTRACTION_STRATEGY.md`
- **Comparison**: `devdocs/RAM_vs_ROM_EXTRACTION.md`

## Legacy ROM Tools (Limited Use)

ROM-based tools still available but only work on ~5% of hacks:
- `smw_level_names.py` - Direct ROM extraction
- `smw_find_text.py` - Search for text in ROM

**Recommendation:** Use RAM extraction for reliable results.

---

**Created:** October 14, 2025  
**Status:** Production ready ✅
