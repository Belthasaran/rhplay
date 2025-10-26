# SMW ROM Analysis Tools - Quick Start Guide

## Overview

This guide shows you how to use the SMW ROM analysis tools to extract information from Super Mario World ROM files.

## Prerequisites

- Python 3.x
- A vanilla SMW ROM file (recommended: `smw.sfc`)
- One or more ROM hacks to analyze

## Basic Usage Examples

### 1. Find Which Levels Have Been Modified

Compare a ROM hack against vanilla SMW to see which levels changed:

```bash
./smw_level_analyzer.py --list rom/myhack.sfc --vanilla smw.sfc --filter-vanilla
```

Output:
```
Modified levels in myhack.sfc (compared to vanilla):
Total: 83 levels
0x001, 0x002, 0x007, 0x00A, 0x00C, 0x00D, 0x014, ...
```

**NEW:** Show with English level names:

```bash
./smw_level_analyzer.py --list rom/myhack.sfc --vanilla smw.sfc --filter-vanilla --show-names
```

Output:
```
Modified levels in myhack.sfc (compared to vanilla):
Total: 83 levels

Level ID | Level Name
--------------------------------------------------
  1 (0x001) | VANILLA SECRET 2
  2 (0x002) | VANILLA SECRET 3
  7 (0x007) | (2 MORTON'S CASTLE
...
```

### 2. Compare Two Versions of a Hack

Find what levels changed between two versions of the same hack:

```bash
./smw_level_analyzer.py --compare rom/version1.sfc rom/version2.sfc
```

Output:
```
Comparing version1.sfc vs version2.sfc:
Total changed levels: 5

Changed level IDs:
0x105, 0x106, 0x107, 0x10A, 0x10B

First 5 changes (detailed):
  Level 0x105:
    version1.sfc: Layer1=DD8806, Layer2=00D9FF
    version2.sfc: Layer1=A1B92A, Layer2=F3C12A
```

### 3. Extract Detailed Level Information

Export all level data to JSON for further analysis:

```bash
./smw_level_analyzer.py --extract rom/myhack.sfc --vanilla smw.sfc --output levels.json
```

This creates a JSON file with:
- Level IDs (hex and decimal)
- Layer 1, Layer 2, and Sprite pointers
- Level settings (vertical/horizontal, no-yoshi intro, etc.)

### 4. Extract Level Names

Get the level names as they appear on the overworld:

```bash
./smw_level_names.py rom/myhack.sfc --list
```

Output:
```
Level names in myhack.sfc:
Total: 93 names

    0 (0x00):    
    1 (0x01): VANILLA SECRET 2
    2 (0x02): VANILLA SECRET 3
    4 (0x04): DONUT GHOST HOUSE
    ...
```

**Note**: Correctly decodes standard vanilla SMW level names (A-Z, spaces, numbers). Custom graphics show as hex codes.

### 5. Compare Level Names Between ROMs

**NEW:** Find which level names changed between two ROM versions:

```bash
./smw_compare_names.py rom/version1.sfc rom/version2.sfc
```

Output:
```
Comparing level names:
  ROM 1: version1.sfc
  ROM 2: version2.sfc

Changed level names: 3

Level   5 (0x05)
  version1.sfc: DONUT PLAINS 3
  version2.sfc: KAIZO PLAINS 3

Level   7 (0x07)
  version1.sfc: (2 MORTON'S CASTLE
  version2.sfc: (2 BOWSER'S CASTLE
...
```

### 5. Verify ROM Structure (Advanced)

Empirically verify that ROM offsets are correct:

```bash
./smw_empirical_analysis.py --verify-offsets smw.sfc rom/myhack.sfc
```

This performs ground truth analysis by comparing documented offsets against actual ROM data.

## Common Workflows

### Workflow 1: Find All Custom Levels in a Hack

```bash
# List all modified levels
./smw_level_analyzer.py --list rom/myhack.sfc --filter-vanilla --format both

# Extract to JSON for programmatic use
./smw_level_analyzer.py --extract rom/myhack.sfc --output myhack_levels.json
```

### Workflow 2: Track Changes During Development

```bash
# Save current state
./smw_level_analyzer.py --extract rom/current.sfc --output snapshot1.json

# ... make changes in Lunar Magic ...

# Compare against snapshot
./smw_level_analyzer.py --compare rom/current.sfc rom/previous.sfc
```

### Workflow 3: Batch Analysis of Multiple Hacks

```bash
# Analyze all ROMs in rom/ directory
for rom in rom/*.sfc; do
    echo "=== $rom ==="
    ./smw_level_analyzer.py --list "$rom" --filter-vanilla --format hex
done
```

## Environment Variables

Set a custom vanilla ROM path:

```bash
export SMW_VANILLA_ROM=/path/to/custom/vanilla.sfc
./smw_level_analyzer.py --list rom/myhack.sfc --filter-vanilla
```

## Output Formats

### Text Format (Default)

Simple comma-separated lists of level IDs:
```
0x001, 0x002, 0x007, 0x00A
```

### JSON Format

Structured data for programmatic use:
```json
{
  "rom_file": "myhack.sfc",
  "total_levels": 83,
  "levels": {
    "0x001": {
      "level_id": 1,
      "level_id_hex": "0x001",
      "layer1_pointer": "64812A",
      "layer2_pointer": "E3842A",
      "sprite_pointer": "A5C4",
      "settings": {
        "raw": "0x01",
        "no_yoshi_intro": false,
        "vertical_level": false,
        "entrance_screen": 1
      }
    }
  }
}
```

## Tips and Tricks

### Tip 1: Header Detection

The tools automatically detect 512-byte copier headers. You don't need to worry about this!

### Tip 2: Finding Specific Level Types

Extract to JSON, then use `jq` to filter:

```bash
# Find all vertical levels
./smw_level_analyzer.py --extract rom/hack.sfc --output levels.json
jq '.levels | to_entries[] | select(.value.settings.vertical_level == true)' levels.json
```

### Tip 3: Comparing Multiple Hacks

```bash
# Find levels that are modified in hack2 but not in hack1
./smw_level_analyzer.py --list rom/hack1.sfc --vanilla smw.sfc --output h1.json
./smw_level_analyzer.py --list rom/hack2.sfc --vanilla smw.sfc --output h2.json
# Then use diff or custom script to compare
```

## Understanding Level IDs

### Hex vs Decimal

- **0x105** (hex) = **261** (decimal)
- Hex is more common in ROM hacking community
- Tools support both formats

### Vanilla SMW Level Ranges

- `0x000 - 0x024`: Primary levels (Yoshi's Island through Special World)
- `0x101 - 0x13B`: Sublevels and bonus rooms
- All other slots (up to `0x1FF`): Available for custom levels

### Special Levels

- `0x000`: Bonus game (1-UP chances)
- `0x100`: Bonus game (1-UP chances, alternate)
- `0x0C5`: Intro message level
- `0x0C7`: Title screen level
- `0x0C8`: Yoshi Wing level
- `0x104`: Yoshi's house (used in credits)
- `0x1C8`: Yoshi Wing level (alternate)

## Troubleshooting

### "ROM not found" Error

Make sure the path is correct and the file exists:
```bash
ls -lh rom/myhack.sfc
```

### No Modified Levels Found

- Verify you're using the correct vanilla ROM
- Check if the hack actually modified levels (some hacks only change graphics/music)
- Try without `--filter-vanilla` to see all non-zero levels

### Level Names Look Wrong or Show Hex Codes

The tool decodes most vanilla SMW level names correctly (A-Z, spaces, numbers). However, you may see:

- **Hex codes like `[38]`** - Special graphics tiles (circled numbers, custom symbols)
- **Symbols like `(2`** - Boss castle graphics that vary by hack
- **Garbled text** - Hacks using completely custom fonts/GFX

For completely custom hacks, use `--raw` to see the actual tile values:

```bash
./smw_level_names.py rom/hack.sfc --list --raw
```

## Further Reading

- **devdocs/SMW_ROM_STRUCTURE.md** - Technical documentation of ROM structure
- **devdocs/LUNAR_MAGIC_ANALYSIS_SUMMARY.md** - Empirical analysis findings
- **docs/PROGRAMS.MD** - Complete tool reference

## Support

For issues or questions, refer to the documentation or examine the source code:
- `smw_level_analyzer.py` - Level data extraction
- `smw_level_names.py` - Name extraction  
- `smw_empirical_analysis.py` - Empirical verification

The code is well-commented and includes detailed docstrings.

