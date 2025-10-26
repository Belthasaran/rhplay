# fetchpatches.js Mode 3 - Output Formats

**Implementation Date:** October 11, 2025  
**Status:** ✅ Complete

## Overview

Mode 3 now supports multiple output formats for gameversions queries, with intelligent defaults based on search type. This enhancement provides a more user-friendly list format for attribute searches while maintaining JSON output for direct ID lookups.

## Output Format Options

### `-ot FORMAT` or `--output-type=FORMAT`

Supported formats:
- `json` - JSON array format (detailed metadata)
- `list` - Tabular list format (summary view)
- `binary` - Binary data (for file queries)

## Output Format Defaults

### Automatic Format Selection

The output format is automatically selected based on the search type:

| Search Type | Query Type | Default Format | Default Multi |
|-------------|------------|----------------|---------------|
| Attribute search | gameversions | `list` | `true` |
| Direct ID search | gameversions | `json` | `false` |
| File data | rawpblob/patch | `binary` | N/A |

### Attribute Searches

Searches on attributes like name, gametype, authors, difficulty, added, section, tags, etc.

**Default behavior:**
- Output format: `list`
- Multi mode: `true` (returns highest version per gameid)

**Example:**
```bash
node fetchpatches.js mode3 -b name Kaizo
```

Output:
```
Game ID          Name                            Type          Difficulty  
===========================================================================
kaizo_world_001  Super Kaizo World               Kaizo         Hard        
kaizo_adv_001    Another Kaizo Adventure         Kaizo         Extreme     
```

### Direct ID Searches

Searches by gameid, gvuuid, pbuuid, or file_name.

**Default behavior:**
- Output format: `json`
- Multi mode: `false` (returns specific record)

**Example:**
```bash
node fetchpatches.js mode3 -b gameid kaizo_world_001
```

Output:
```json
[
  {
    "gvuuid": "...",
    "gameid": "kaizo_world_001",
    "name": "Super Kaizo World",
    "version": 2,
    ...
  }
]
```

## List Output Format

### Features

- **Compact display:** One record per line
- **Column alignment:** Automatic padding with spaces (no tabs)
- **Key fields:** gameid, name, gametype, difficulty
- **Header row:** Column names with separator line

### Column Widths

Columns automatically adjust to fit content with minimum widths:
- Game ID: min 10 characters
- Name: min 30 characters
- Type: min 12 characters
- Difficulty: min 12 characters

### Example Output

```
Game ID          Name                            Type          Difficulty  
===========================================================================
kaizo_world_001  Super Kaizo World               Kaizo         Hard        
kaizo_adv_001    Another Kaizo Adventure         Kaizo         Extreme     
puzzle_med_001   Medium Puzzle Hack              Puzzle        Medium      
vanilla_easy_001 Easy Vanilla Hack               Standard      Easy        
```

### Similar to `python3 search.py`

The list format is designed to match the output style of the Python search utility for consistency across tools.

## JSON Output Format

### Features

- **Complete metadata:** All gameversions fields included
- **Pretty printed:** 2-space indentation
- **Array format:** Always returns array (even for single result)
- **Machine readable:** Easy to parse programmatically

### Example Output

```json
[
  {
    "gvuuid": "c17e3f10-2c0a-4698-9ee3-9a1644081758",
    "gameid": "kaizo_world_001",
    "name": "Super Kaizo World",
    "version": 2,
    "pbuuid": "42a26fde-2bbb-4f43-bc2e-277046c3e5b0",
    "gametype": "Kaizo",
    "author": "KT",
    "authors": "KT, TestAuthor",
    "difficulty": "Hard",
    "added": "2024-03-20",
    "section": "Kaizo: Hard",
    "demo": "No",
    "length": "73 exits",
    "tags": "[\"kaizo\",\"hard\",\"complete\",\"updated\"]"
  }
]
```

## Multi Mode Options

### `--multi` (default for attribute searches)

Returns all matching entries, but only the highest version per gameid.

**Example:**
```bash
node fetchpatches.js mode3 -b gametype Kaizo
```

Result: Highest version of each Kaizo game.

### `--nomulti`

Restricts results to entries from only one gameid (the first match).

**Example:**
```bash
node fetchpatches.js mode3 -b gametype Kaizo --nomulti
```

Result: Only entries from the first matching gameid.

**Note:** When `--nomulti` is used, the output format defaults to `json` instead of `list`.

## Overriding Defaults

### Force JSON for Attribute Search

```bash
node fetchpatches.js mode3 -b name Kaizo -ot json
```

### Force List for Direct ID Search

```bash
node fetchpatches.js mode3 -b gameid kaizo_world_001 -ot list
```

### Combine with Other Options

```bash
# List format with all versions
node fetchpatches.js mode3 -b gameid kaizo_world_001 --versions -ot list

# JSON format without multi mode
node fetchpatches.js mode3 -b name Kaizo --nomulti -ot json
```

## Usage Examples

### Example 1: Browse All Kaizo Games

```bash
node fetchpatches.js mode3 -b gametype Kaizo
```

Output: List format showing all Kaizo games (highest version each).

### Example 2: Search by Difficulty with JSON

```bash
node fetchpatches.js mode3 -b difficulty Hard -ot json
```

Output: JSON format with complete metadata.

### Example 3: Find Games by Author

```bash
node fetchpatches.js mode3 -b authors KT
```

Output: List format showing all games by KT.

### Example 4: Multi-Criteria Search

```bash
node fetchpatches.js mode3 -b gametype Kaizo -b difficulty Extreme
```

Output: List format showing Kaizo games with Extreme difficulty.

### Example 5: Get Specific Game Details

```bash
node fetchpatches.js mode3 -b gameid kaizo_world_001
```

Output: JSON format with full metadata for specified game.

### Example 6: Restrict to One Game

```bash
node fetchpatches.js mode3 -b added ">2024" --nomulti
```

Output: JSON format showing only the first matching gameid.

## When to Use Each Format

### Use List Format When:

- Browsing/searching for games
- Need quick overview of multiple results
- Want human-readable output
- Comparing games side-by-side
- Terminal display is the end goal

### Use JSON Format When:

- Need complete metadata
- Piping to other tools/scripts
- Processing results programmatically
- Need all fields (not just summary)
- Working with single specific record

### Use Binary Format When:

- Querying for file data (rawpblob, patch)
- Extracting actual patch files
- Need binary content for processing

## Format Selection Logic

The following flowchart shows how the output format is determined:

```
1. Is --output-type/-ot specified?
   YES → Use specified format
   NO  → Continue to step 2

2. What is the query type?
   - rawpblob/patch → Use 'binary'
   - gameversions → Continue to step 3

3. What type of search criteria?
   - Direct ID (gameid/gvuuid/pbuuid/file_name) → Use 'json'
   - Attribute search (name/gametype/etc.) →
       Is --multi enabled?
       YES → Use 'list'
       NO  → Use 'json'
```

## Output Configuration Display

The search configuration output shows the selected format:

```
Search Configuration:
  Search Criteria:
    -b name "Kaizo"
  Query Type:   gameversions
  Output:       auto
  Output Format: list         ← Automatically selected
  Multi:        Highest version per gameid
```

## Performance Considerations

### List Format

- **Fast:** String formatting only
- **Compact:** Less data in output
- **Memory efficient:** No JSON serialization

### JSON Format

- **Slower:** JSON serialization overhead
- **Larger:** Complete metadata for each record
- **More memory:** Full object representation

For large result sets (100+ records), list format is significantly faster and more readable.

## Compatibility

### With Existing Scripts

The automatic format selection ensures backward compatibility:

- Old commands using direct IDs still get JSON by default
- New attribute searches get the more appropriate list format

### Explicit Format Override

Always use `-ot` to ensure consistent behavior in scripts:

```bash
# Script that relies on JSON output
node fetchpatches.js mode3 -b gametype Kaizo -ot json | jq '.[]'
```

## Summary

The enhanced output format system provides:

✅ **Intelligent Defaults** - Automatic format selection based on search type  
✅ **List Format** - Clean, readable tabular output for browsing  
✅ **JSON Format** - Complete metadata for programmatic use  
✅ **Multi Mode Control** - Flexible result filtering with --multi/--nomulti  
✅ **Manual Override** - `-ot` option to force specific format  
✅ **Backward Compatible** - Existing commands work as before  

**Status:** ✅ Fully implemented and tested!

