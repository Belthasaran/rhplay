# fetchpatches.js Mode 3 - Enhanced Search Features

## Overview

Mode 3 has been enhanced with powerful multi-criteria search capabilities, including fuzzy/exact/regex matching, date and number comparisons, and advanced version filtering.

**Implementation Date:** October 11, 2025

## New Features

### 1. Multiple Search Criteria

You can now specify multiple `-b` options to narrow down results using AND logic:

```bash
node fetchpatches.js mode3 -b demo No -b authors KT -b length "73"
```

All criteria must match for a record to be included in results.

### 2. Search Types

Enhanced search types for gameversions queries:

| Type | Description | Example |
|------|-------------|---------|
| `name` | Game name | `-b name "Kaizo"` |
| `gametype` | Game type | `-b gametype "Kaizo"` |
| `authors` | Author or authors field | `-b authors "KT"` |
| `difficulty` | Difficulty level | `-b difficulty "Hard"` |
| `added` | Date added | `-b added "2024"` |
| `section` | Section category | `-b section "Kaizo: Hard"` |
| `version` | Version number | `-b version "1"` |
| `tags` | Tags (can repeat) | `-b tags "kaizo"` |
| `demo` | Demo status | `-b demo "No"` |
| `length` | Level count | `-b length "73"` |
| `gameid` | Game ID | `-b gameid "game_123"` |
| `gvuuid` | Game version UUID | `-b gvuuid "<uuid>"` |
| `pbuuid` | Patch blob UUID | `-b pbuuid "<uuid>"` |
| `file_name` | Attachment filename | `-b file_name "patch.bin"` |

### 3. Matching Modes

#### Fuzzy Matching (Default)

Case-insensitive substring matching:

```bash
# Finds "Super Kaizo World", "Kaizo Adventure", etc.
node fetchpatches.js mode3 -b name Kaizo
```

#### Exact Matching

Use `--exact` flag before the search criterion:

```bash
# Only finds exact match "Kaizo: Hard"
node fetchpatches.js mode3 --exact -b section "Kaizo: Hard"
```

#### Regex Matching

Use `--regex` flag to interpret search value as regular expression:

```bash
# Find names starting with "Super" and ending with "World"
node fetchpatches.js mode3 --regex -b name "^Super.*World$"
```

### 4. Date and Number Comparisons

Use `>` or `<` operators for comparisons:

```bash
# Games added after 2023
node fetchpatches.js mode3 -b added ">2023"

# Games added before 2024
node fetchpatches.js mode3 -b added "<2024"

# Games with less than 10 exits
node fetchpatches.js mode3 -b length "<10"

# Games with more than 50 exits
node fetchpatches.js mode3 -b length ">50"

# Specific month or later
node fetchpatches.js mode3 -b added ">2024-09"
```

### 5. Version Filtering Options

#### `--versions` (formerly `--multiple`)

Include all versions for each matching gameid:

```bash
node fetchpatches.js mode3 -b gameid "game_123" --versions
```

Returns: All versions of the game.

#### `--multi`

Return all matching entries, but only highest version per gameid:

```bash
node fetchpatches.js mode3 -b gametype Kaizo --multi
```

Returns: Latest version of each game matching the criteria.

#### `--matchversion=TYPE`

Control which version to match when filtering:

| Value | Description | Example |
|-------|-------------|---------|
| `latest` | Highest version (default) | `--matchversion=latest` |
| `first` | Lowest version | `--matchversion=first` |
| `previous` | Second highest version | `--matchversion=previous` |
| `all` | All versions | `--matchversion=all` |

```bash
# Get the first version that matches criteria
node fetchpatches.js mode3 -b gameid "game_123" --matchversion=first

# Get the previous version (second highest)
node fetchpatches.js mode3 -b gameid "game_123" --matchversion=previous
```

## Usage Examples

### Example 1: Simple Fuzzy Search

Find all games with "Kaizo" in the name:

```bash
node fetchpatches.js mode3 -b name Kaizo
```

### Example 2: Multi-Criteria Search

Find games that are:
- Not demos
- By author "KT" (exact match)
- Have 73 exits

```bash
node fetchpatches.js mode3 -b demo No -b authors KT --exact -b length "73"
```

### Example 3: Date Range Search

Find all games added in 2024:

```bash
node fetchpatches.js mode3 -b added 2024
```

Find all games added after 2023:

```bash
node fetchpatches.js mode3 -b added ">2023"
```

### Example 4: Numeric Comparison

Find short hacks (less than 10 exits):

```bash
node fetchpatches.js mode3 -b length "<10"
```

### Example 5: Regex Search

Find games with names matching a pattern:

```bash
# Names starting with "Super"
node fetchpatches.js mode3 --regex -b name "^Super"

# Names containing "World" or "Adventure"
node fetchpatches.js mode3 --regex -b name "(World|Adventure)"
```

### Example 6: Tag Search

Find games with specific tags:

```bash
# Single tag
node fetchpatches.js mode3 -b tags kaizo

# Multiple tags (must have both)
node fetchpatches.js mode3 -b tags kaizo -b tags hard
```

### Example 7: Version Filtering

```bash
# Get latest version only (default)
node fetchpatches.js mode3 -b gameid "game_123"

# Get all versions
node fetchpatches.js mode3 -b gameid "game_123" --versions

# Get first version
node fetchpatches.js mode3 -b gameid "game_123" --matchversion=first

# Get previous version (second highest)
node fetchpatches.js mode3 -b gameid "game_123" --matchversion=previous
```

### Example 8: Complex Multi-Criteria

Find Kaizo games:
- Added in October 2024 or later
- With hard difficulty
- With at least 50 exits

```bash
node fetchpatches.js mode3 \
  -b gametype Kaizo \
  -b added ">2024-09" \
  -b difficulty Hard \
  -b length ">50"
```

### Example 9: Section and Type

Find games in specific section:

```bash
node fetchpatches.js mode3 --exact -b section "Kaizo: Hard" -b gametype Kaizo
```

### Example 10: Author Search

Find all games by a specific author (checks both author and authors fields):

```bash
node fetchpatches.js mode3 -b authors "KT"
```

## Command-Line Syntax

### Basic Syntax

```bash
node fetchpatches.js mode3 [search-options] [query-options] [output-options]
```

### Search Options

```
-b TYPE VALUE          Search by field (can be used multiple times)
--exact                Use exact matching for next -b
--regex                Use regex matching for next -b
```

### Query Options

```
-q TYPE                Query type: gameversions, rawpblob, patch
```

### Version Filtering Options

```
--versions             Include all versions for each gameid
--multi                Return all entries, highest version per gameid
--matchversion=TYPE    Version to match: all, first, latest, previous
```

### Output Options

```
-p, --print            Print to stdout
-o FILE                Save to file
```

## Matching Behavior Details

### Fuzzy Matching Rules

1. Case-insensitive substring matching
2. Partial matches are allowed
3. Works for all text fields

**Example:**
- Search: `kaizo`
- Matches: "Kaizo", "Super Kaizo World", "My Kaizo Hack"

### Exact Matching Rules

1. Case-insensitive full string match
2. No partial matches
3. Must match entire field value

**Example:**
- Search: `--exact -b name "Super Kaizo World"`
- Matches: "Super Kaizo World", "super kaizo world"
- Does NOT match: "Super Kaizo World 2", "The Super Kaizo World"

### Regex Matching Rules

1. Case-insensitive (regex flag `i` is used)
2. Standard JavaScript regex syntax
3. Must be valid regex pattern

**Example:**
```bash
# Match names starting with "Super"
--regex -b name "^Super"

# Match multiple patterns
--regex -b name "(Kaizo|Hard|Extreme)"

# Match specific format
--regex -b added "^2024-(0[1-6])"  # First 6 months of 2024
```

### Date Comparison Rules

1. String comparison for dates
2. Use ISO date format: `YYYY-MM-DD` or `YYYY-MM` or `YYYY`
3. Operators: `>` (after), `<` (before)

**Example:**
```bash
# Year comparison
-b added ">2023"     # After 2023
-b added "<2024"     # Before 2024

# Month comparison
-b added ">2024-06"  # After June 2024
-b added "2024-10"   # In October 2024 (fuzzy match)
```

### Number Comparison Rules

1. Extracts numbers from strings (e.g., "73 exits" → 73)
2. Operators: `>` (greater than), `<` (less than)

**Example:**
```bash
-b length "<10"      # Less than 10 exits
-b length ">50"      # More than 50 exits
```

## Version Filtering Logic

### Default Behavior (latest)

For queries without version options, returns only the highest version per gameid that matches criteria:

```bash
node fetchpatches.js mode3 -b gametype Kaizo
# Returns: Highest version of each Kaizo game that matches
```

### `--versions` Option

Returns all versions that match criteria:

```bash
node fetchpatches.js mode3 -b gameid "game_123" --versions
# Returns: All versions of game_123
```

### `--multi` Option

Returns highest version per gameid for all matching entries:

```bash
node fetchpatches.js mode3 -b difficulty Hard --multi
# Returns: Highest version of each game with Hard difficulty
```

### `--matchversion=first`

Returns lowest version number per gameid:

```bash
node fetchpatches.js mode3 -b gameid "game_123" --matchversion=first
# Returns: Version 1 of game_123 (if it exists)
```

### `--matchversion=previous`

Returns second highest version per gameid:

```bash
node fetchpatches.js mode3 -b gameid "game_123" --matchversion=previous
# Returns: Second highest version (e.g., v1 if latest is v2)
```

### `--matchversion=all`

Same as `--versions`, returns all matching versions.

## Tags Matching

Tags can be stored as JSON arrays or strings. The search works with both:

### JSON Array Format

```json
["kaizo", "hard", "complete"]
```

### String Format

```
kaizo, hard, complete
```

### Multiple Tag Criteria

Use multiple `-b tags` options to require all tags:

```bash
# Must have both "kaizo" AND "hard" tags
node fetchpatches.js mode3 -b tags kaizo -b tags hard
```

## Performance Considerations

### Query Performance

- **Direct ID lookups** (gvuuid, pbuuid, file_name): Very fast
- **Fuzzy searches**: Fast (full table scan with filtering)
- **Regex searches**: Slower for complex patterns
- **Multi-criteria**: Performance depends on number of records

### Memory Usage

All matching gameversions are loaded into memory for filtering. For very large databases, consider:

1. Using more specific criteria to reduce results
2. Using direct ID lookups when possible
3. Using `--multi` instead of `--versions` to limit results

## Error Handling

### Invalid Regex Pattern

```bash
$ node fetchpatches.js mode3 --regex -b name "[invalid"
Invalid regex pattern: [invalid
```

### Unknown Search Type

```bash
$ node fetchpatches.js mode3 -b unknown_field "value"
Unknown search type: unknown_field
```

### Invalid matchversion Value

```bash
$ node fetchpatches.js mode3 --matchversion=invalid
Error: Invalid --matchversion value: invalid
Valid values: all, first, latest, previous
```

## Testing

A comprehensive test suite is available:

```bash
# Create test data
node tests/test_mode3_enhanced_search.js

# Run test queries (examples provided by test script)
```

Test coverage includes:
- Fuzzy, exact, and regex matching
- Date and number comparisons
- Multiple criteria (AND logic)
- Tag matching
- Version filtering (all, first, latest, previous)
- Multi-criteria combinations

## Backward Compatibility

The enhanced search maintains backward compatibility with the original Mode 3 syntax:

```bash
# Old syntax (still works)
node fetchpatches.js mode3 "Super Mario World" -b gameid --multiple

# New equivalent syntax
node fetchpatches.js mode3 -b gameid "Super Mario World" --versions
```

Note: `--multiple` is now an alias for `--versions`.

## Use Cases

### 1. Find Latest Kaizo Hacks

```bash
node fetchpatches.js mode3 -b gametype Kaizo -b added ">2024-06" --multi
```

### 2. Find Short, Easy Hacks for Beginners

```bash
node fetchpatches.js mode3 -b difficulty Easy -b length "<15" -b demo No
```

### 3. Find All Versions of a Specific Game

```bash
node fetchpatches.js mode3 -b gameid "game_123" --versions
```

### 4. Find Games by Multiple Authors

```bash
# Find games with "KT" in authors field
node fetchpatches.js mode3 -b authors KT
```

### 5. Find Games in Specific Section with Tags

```bash
node fetchpatches.js mode3 -b section "Kaizo: Hard" -b tags complete
```

### 6. Find Old Hacks for Archival

```bash
node fetchpatches.js mode3 -b added "<2020"
```

### 7. Complex Search for Specific Criteria

```bash
node fetchpatches.js mode3 \
  -b gametype Kaizo \
  -b difficulty Extreme \
  -b length ">90" \
  -b demo No \
  -b added ">2024" \
  --multi
```

## Summary

The enhanced Mode 3 search provides:

✅ **Multiple Search Criteria** - Combine unlimited search conditions  
✅ **Fuzzy/Exact/Regex Matching** - Choose the right matching mode  
✅ **Date/Number Comparisons** - Use operators for range queries  
✅ **Advanced Version Filtering** - Control which versions to return  
✅ **Tag Support** - Search by tags with multiple criteria  
✅ **Backward Compatible** - All old commands still work  
✅ **Comprehensive Testing** - Full test suite included  

**Status:** ✅ Fully implemented and ready for use!

