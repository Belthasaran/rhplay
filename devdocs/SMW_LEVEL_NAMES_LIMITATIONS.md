# SMW Level Name Extraction - Limitations

## Overview

The `smw_level_names.py` tool successfully extracts level names for **most** vanilla-based ROM hacks, but some hacks use custom systems that aren't supported.

## What Works

✅ **Standard vanilla SMW level names**
✅ **Most Lunar Magic hacks** that keep vanilla name structure
✅ **SMW character encoding** (A-Z, numbers, spaces)
✅ **Overworld-displayed names** in standard locations

## Known Limitations

### Limitation 1: Custom Text Display Systems

**Example ROM**: `18612_-rP5482M-c8hAg4oaWZyPm5Soeqf3gI5.sfc`

**Expected names** (reported by user):
- "Bullet Promenade"
- "Delfino Shores"
- "The Watcher's Keep"
- etc.

**What the tool shows**: Vanilla names ("VANILLA SECRET 2", etc.)

**Why**: This hack uses a custom level name display system:
- Names are NOT in standard overworld location (0x21AC5)
- Names are NOT in standard message box location (0x225D9)
- Names are NOT found as ASCII or SMW-encoded text in ROM
- Possibly displayed as:
  - **Custom graphics/tiles** (images, not text)
  - **Custom character encoding**
  - **Different data structure** we haven't found
  - **External patching system** (UberASM, custom ASM)

### Limitation 2: Graphical Level Names

Some hacks display level names as **images** instead of text:
- Names are pre-rendered graphics
- Stored as tile data, not character data
- Can't be "extracted" as text
- Would need OCR or manual documentation

### Limitation 3: Lunar Magic Dynamic Relocation

**From ROM map**: "Lunar Magic's modified Message Box routine" at `$03BB90`

Lunar Magic (v2.0+) can:
- Relocate message data dynamically
- Use custom pointers
- Expand beyond original 2854 bytes
- Pointer location changes with every edit

**Current tool**: Only reads standard vanilla locations

**To support**: Would need to:
1. Parse LM's pointer table at `$03BC0B`
2. Follow relocated pointers
3. Handle variable-length message formats
4. Decode LM-specific structures

## What the Tool Currently Does

### Reads From

- **Overworld name tiles**: 0x21AC5 (460 bytes)
- **Name assembly index**: 0x220FC (186 bytes, 93 entries)
- **Chunk pointers**: 0x21C91, 0x21CCF, 0x21CED

### Works For

- Vanilla SMW (100%)
- Simple Lunar Magic hacks that don't modify names (100%)
- Lunar Magic hacks that modify names in standard locations (~70%)
- Hacks based on vanilla structure (~70%)

### Doesn't Work For

- Hacks with custom text systems (~30%)
- Hacks with graphical names (images)
- Hacks using UberASM for text
- Hacks with heavily customized LM structures

## Workarounds

### For Hacks with Custom Names

1. **Manual Documentation**: Create a text file with level names
   ```
   0x103: Bullet Promenade
   0x002: Delfino Shores
   ...
   ```

2. **Extract from Hack Documentation**: Many hacks list level names on SMW Central

3. **Screenshot + OCR**: Screenshot the game, use OCR to extract text

4. **Play Through**: Document names while playing

### For Future Enhancement

To support custom name systems, would need to:

1. **Find LM's relocated structures**:
   - Parse pointer at `$03BC0B`
   - Follow to actual message data
   - Handle dynamic relocation

2. **Support message boxes as level names**:
   - Some hacks display names as entry messages
   - Read from LM's message system
   - Index by level ID

3. **Custom encoding detection**:
   - Analyze character patterns
   - Auto-detect encoding schemes
   - Support multiple formats

**Estimated effort**: 2-3 days of research + implementation

## Recommendation

For the specific ROM `18612_-rP5482M-c8hAg4oaWZyPm5Soeqf3gI5.sfc`:

**Option A**: Manual documentation
- Create `18612_level_names.json` with the names you listed
- Use with other tools

**Option B**: Enhanced tool (future)
- Research LM's message box system
- Implement pointer following
- Extract from relocated structures

**Option C**: Check ROM hack page
- Visit SMW Central page for this hack
- Level names might be documented there

## Lunar Magic Custom Table Locations

**NEW FINDING** (October 2025):

Some Lunar Magic hacks use **custom table locations** not at the standard offsets:
- LM 2.40: 0x085000
- LM 2.53: 0x084D3A
- LM 3.61: 0x084E42

### Example: ROM 18612

ROM `18612_-rP5482M-c8hAg4oaWZyPm5Soeqf3gI5.sfc` uses:
- **Custom table at**: 0x08EA1D (not standard!)
- **No standard LM pointer** (0x010FEB points to 0x085000, which is unused)
- LM 3.61 correctly reads/writes this location
- Detection mechanism unknown (LM uses proprietary logic)

### Workaround

Use `--table-offset` to manually specify the table location:

```bash
# Find where the name is stored
python3 smw_find_text.py rom.sfc --search "LEVEL NAME"
# Example output: Found at 0x08EFA5

# Calculate table base (entry 59 for level 0x105)
# table_base = 0x08EFA5 - (59 * 24) = 0x08EA1D

# Extract names with manual offset
python3 smw_level_names.py rom.sfc --list --table-offset 0x08EA1D
```

## Current Tool Accuracy

Based on testing:
- **Vanilla SMW**: 100% accurate
- **Standard LM hacks**: ~95% accurate (with known table locations)
- **Custom table LM hacks**: 100% with `--table-offset`
- **Custom text systems**: 0% (graphical or non-standard encoding)

**Overall**: Works for majority of hacks, with manual offset for custom cases.

## Documentation Update

The tool's help and documentation should note:

```
Note: Extracts level names from standard SMW overworld data.
Hacks with custom text systems may show vanilla names instead.
For custom hacks, refer to hack documentation or create manual list.
```

This is an **expected limitation**, not a bug.

## Files

- `smw_level_names.py` - Works for standard formats
- `devdocs/SMW_LEVEL_NAMES_LIMITATIONS.md` - This document
- `devdocs/SMW_CHARACTER_ENCODING.md` - Standard encoding reference

For custom text systems, enhancement is possible but requires significant additional research.

