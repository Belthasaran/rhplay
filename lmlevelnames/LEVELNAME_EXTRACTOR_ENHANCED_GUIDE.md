# Level Name Extractor Enhanced - Feature Guide
**Script:** `levelname_extractor_enhanced_2025_10_28.py`  
**Version:** 2025-10-28 Enhanced  
**Date Created:** October 28, 2025

---

## What's New in the Enhanced Version

The enhanced version adds three powerful filtering options to help you focus on the level names you care about:

### New Features

1. **`--editedonly`** - Show only custom edited levels
2. **`--novanilla`** - Filter out vanilla level names
3. **`--withwords`** - Show only names containing English words

---

## New Command-Line Options

### `--vanilla-rom FILE`
Specify a vanilla/unedited ROM file for comparison filtering.

**Default:** If not specified, uses `orig_lm333_noedits.sfc` in the current directory.

```bash
python levelname_extractor_enhanced_2025_10_28.py --romfile game.sfc --novanilla --vanilla-rom vanilla.sfc
```

### `--editedonly`
Only show levels that differ from the vanilla ROM.

**Use case:** Finding which levels have been customized in a ROM hack.

```bash
python levelname_extractor_enhanced_2025_10_28.py --romfile game.sfc --editedonly
```

**Example output:**
```
Level 0x001: Yoshi's Tree House    # Custom name (vanilla was "VANILLA SECRET 3")
Level 0x002: Delfino Shores         # Custom name (vanilla was "VANILLA SECRET 4")
# Skips levels with vanilla names
```

### `--novanilla`
Filter out any level names that match the vanilla ROM.

**Use case:** Removing vanilla level names from the output to see only custom content.

```bash
python levelname_extractor_enhanced_2025_10_28.py --romfile game.sfc --novanilla
```

**Difference from `--editedonly`:**
- `--editedonly`: Compares exact level IDs (shows levels where the name at that ID changed)
- `--novanilla`: Filters out any occurrence of vanilla names (even if at different level IDs)

### `--withwords`
Only show level names that contain recognizable English words.

**Use case:** Filtering out garbage data, test levels, or non-English names.

```bash
python levelname_extractor_enhanced_2025_10_28.py --romfile game.sfc --withwords
```

**How it works:**
1. Checks for common English words (secret, castle, house, bridge, etc.)
2. Verifies word patterns (vowels + consonants)
3. Filters out random character combinations

**Common words recognized:**
- Game-related: secret, area, castle, house, ghost, plains, island, mountain, bridge, lake, road, star, switch, palace, fortress, valley, forest, cave, etc.
- General: the, a, an, of, in, on, at, to, for, with, from
- Custom: Supports ROM hack specific words like "Yoshi", "Koopa", "Tubba", etc.

---

## Usage Examples

### Example 1: Find Custom Edited Levels Only
```bash
python levelname_extractor_enhanced_2025_10_28.py --romfile my_hack.sfc --editedonly --verbose
```

Output shows only levels that differ from vanilla, with statistics:
```
Extracted 150 level names
Loading vanilla ROM for comparison: orig_lm333_noedits.sfc
Loaded 259 vanilla level names
Filtering: 150 -> 35 level names

Level 0x001: My Custom Level
Level 0x103: Secret Area 2
...
```

### Example 2: Filter Out All Vanilla Names
```bash
python levelname_extractor_enhanced_2025_10_28.py --romfile mixed_hack.sfc --novanilla
```

This removes any level that has a vanilla name, even if it's at a different level ID.

### Example 3: Show Only Meaningful English Names
```bash
python levelname_extractor_enhanced_2025_10_28.py --romfile game.sfc --withwords --format csv -o meaningful_names.csv
```

Filters out:
- Random garbage: `xqzpklmn`
- Test names: `test123`
- Non-English text (unless it contains English words)

Keeps:
- `Yoshi's Tree House` ✓
- `The Gateway` ✓
- `Secret Castle 2` ✓

### Example 4: Combine Multiple Filters
```bash
python levelname_extractor_enhanced_2025_10_28.py --romfile game.sfc --novanilla --withwords --range 0x100 0x1FF
```

This shows only:
- Levels in range 0x100-0x1FF
- That aren't vanilla names
- That contain English words

### Example 5: Use Custom Vanilla ROM
```bash
python levelname_extractor_enhanced_2025_10_28.py --romfile game.sfc --editedonly --vanilla-rom my_vanilla_base.sfc
```

Useful if your ROM hack is based on a modified vanilla ROM.

---

## Filtering Logic

### How Filters Work Together

Filters are applied in sequence, and a level must pass **all** active filters to be included:

```
1. Extract all level names
2. If --editedonly: Keep only if different from vanilla at same level ID
3. If --novanilla: Keep only if name doesn't match any vanilla name
4. If --withwords: Keep only if contains English words
5. Output remaining levels
```

### Filter Comparison Table

| Filter | Compares | Keeps |
|--------|----------|-------|
| `--editedonly` | Same level ID | Level 0x005 with different name than vanilla 0x005 |
| `--novanilla` | Any vanilla name | Any level that doesn't have a vanilla name (regardless of ID) |
| `--withwords` | Text content | Names containing recognizable English words |

---

## Testing Results

### Test Case: `smw_lm2.sfc` (Partially Edited ROM)

| Filter Combination | Levels Extracted |
|-------------------|------------------|
| No filters | 32 levels |
| `--novanilla` | 20 levels |
| `--withwords` | 32 levels |
| `--novanilla --withwords` | 20 levels |

**Analysis:**
- 12 levels have vanilla names (filtered by `--novanilla`)
- All 32 level names contain English words
- When combining filters, only 20 custom levels remain

### Test Case: `Akogare_lm333_edited.sfc` (Fully Custom Hack)

| Filter Combination | Levels Extracted (0x001-0x020) |
|-------------------|-------------------------------|
| No filters | 8 levels |
| `--novanilla` | 8 levels |
| `--withwords` | 8 levels |
| All filters | 8 levels |

**Analysis:**
- No vanilla names present (fully custom)
- All names contain English words
- Filters don't remove any levels (as expected)

---

## Vanilla ROM Requirements

For filtering to work, you need a vanilla ROM file:

### Option 1: Automatic (Default)
Place `orig_lm333_noedits.sfc` in the same directory as the script.

### Option 2: Specify Path
Use `--vanilla-rom` to specify a different file:
```bash
--vanilla-rom path/to/vanilla.sfc
```

### Vanilla ROM Characteristics
The vanilla ROM should be:
- A clean SMW ROM that has been saved in Lunar Magic (to have the Level Names Patch)
- No custom level names edited
- Same version of Lunar Magic as your target ROM (ideally)

**Why Lunar Magic saved?**  
The script requires the Level Names Patch to be installed. A pure vanilla SMW ROM won't work. Use a ROM that's been opened and saved in Lunar Magic without making any edits.

---

## Advanced Usage

### Batch Processing with Filters
```bash
#!/bin/bash
# Extract custom names from multiple ROMs
for rom in *.sfc; do
    python levelname_extractor_enhanced_2025_10_28.py \
        --romfile "$rom" \
        --novanilla \
        --withwords \
        --format csv \
        --output "${rom%.sfc}_custom_names.csv"
done
```

### Find ROMs with Most Custom Content
```bash
# Count custom levels in each ROM
for rom in *.sfc; do
    count=$(python levelname_extractor_enhanced_2025_10_28.py \
        --romfile "$rom" --editedonly 2>/dev/null | wc -l)
    echo "$rom: $count custom levels"
done | sort -t: -k2 -rn
```

---

## Troubleshooting

### "Warning: Could not load vanilla ROM for comparison"

**Cause:** Vanilla ROM file not found or doesn't have Level Names Patch.

**Solutions:**
1. Ensure `orig_lm333_noedits.sfc` exists in the current directory
2. Specify path with `--vanilla-rom`
3. Make sure vanilla ROM has been saved in Lunar Magic

### Filters Not Working as Expected

**Issue:** `--novanilla` doesn't filter anything

**Cause:** Your ROM might be fully custom (no vanilla names).

**Verification:**
```bash
# Check without filter
python levelname_extractor_enhanced_2025_10_28.py --romfile game.sfc --range 0x001 0x010

# Check vanilla ROM
python levelname_extractor_enhanced_2025_10_28.py --romfile orig_lm333_noedits.sfc --range 0x001 0x010
```

Compare the output to see if any names match.

### `--withwords` Filters Too Much

**Issue:** Some valid names are being filtered out.

**Cause:** Names don't contain common English words or recognizable patterns.

**Solutions:**
1. Don't use `--withwords` for non-English ROMs
2. The word list can be customized in the script (edit `common_words` set)
3. Consider using `--novanilla` instead for a looser filter

---

## Performance Notes

- **Vanilla ROM Loading:** Adds ~0.5-1 second to execution time
- **Filtering:** Negligible performance impact (< 0.01 seconds)
- **Recommended:** Use `--range` with filters for faster testing

---

## Comparison: Original vs Enhanced

| Feature | Original | Enhanced |
|---------|----------|----------|
| Extract level names | ✓ | ✓ |
| Multiple formats | ✓ | ✓ |
| Custom tile mapping | ✓ | ✓ |
| Filter vanilla names | ✗ | ✓ |
| Filter by words | ✗ | ✓ |
| Compare to vanilla ROM | ✗ | ✓ |

---

## Future Enhancements

Potential additions for future versions:

1. **`--minlength N`** - Filter names shorter than N characters
2. **`--pattern REGEX`** - Filter by regular expression
3. **`--exclude-ids FILE`** - Exclude specific level IDs from a file
4. **`--similarity N`** - Filter by similarity threshold to vanilla (0-100%)
5. **`--language LANG`** - Support for other languages (Japanese, Spanish, etc.)

---

## Complete Example Session

```bash
# 1. Extract all names
python levelname_extractor_enhanced_2025_10_28.py --romfile my_hack.sfc -v
# Output: 150 levels

# 2. Filter to custom only
python levelname_extractor_enhanced_2025_10_28.py --romfile my_hack.sfc --editedonly -v
# Output: 35 custom levels

# 3. Export custom names to CSV
python levelname_extractor_enhanced_2025_10_28.py --romfile my_hack.sfc \
    --editedonly --withwords --format csv --output custom_levels.csv

# 4. Check specific level
python levelname_extractor_enhanced_2025_10_28.py --romfile my_hack.sfc --range 0x13B 0x13B
# Output: Level 0x13B: The Gateway
```

---

## Summary

The enhanced version provides powerful filtering capabilities while maintaining full compatibility with the original script. All original features work identically, and new filters can be combined for precise control over which level names are extracted.

**Key Benefits:**
- Find edited levels quickly
- Remove vanilla clutter from output
- Focus on meaningful English names
- Perfect for ROM hack documentation and analysis

**Backward Compatible:**
- If you don't use the new options, behavior is identical to the original
- All existing scripts and workflows continue to work

---

**Document Version:** 1.0  
**Last Updated:** October 28, 2025  
**Script Version:** levelname_extractor_enhanced_2025_10_28.py

