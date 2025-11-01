# Level Name Extraction System

This system extracts level names and related metadata from Super Mario World ROMs edited with Lunar Magic and stores them in the `rhdata.db` database.

## Overview

The system consists of several components:

1. **Database Schema**: Tables and columns in `rhdata.db` for storing level metadata
2. **Extraction Scripts**: Tools to extract level information from ROMs and save artifacts to disk
3. **Import Scripts**: Tools to import JSON/CSV data into the database
4. **Migration Script**: Applies the schema changes required for the workflow

## Database Schema

### Tables / Columns Added

#### `levelnames` table
- `lvluuid` (varchar, primary key): Unique identifier for each level name
- `gameid` (varchar): Game ID this level belongs to
- `levelid` (varchar): Level ID in hex format (e.g., `0x001`)
- `levelname` (varchar): The actual level name
- `created_time` (timestamp): When the record was created
- `updated_time` (timestamp): When the record was last updated

#### `gameversion_levelnames` table (Junction table)
- `gvlvuuid` (varchar, primary key): Unique identifier for the relationship
- `gvuuid` (varchar): References `gameversions.gvuuid`
- `lvluuid` (varchar): References `levelnames.lvluuid`
- `created_time` (timestamp): When the relationship was created

#### `gameversions` table (new columns)
- `lmlevels` (text): JSON array of level IDs reported by the extractor (if available)
- `detectedlevels` (text): JSON array of level IDs detected via the CSV output

#### `gameversions_translevels` table
- `gvtuuid` (varchar, primary key): Unique identifier for each translevel record
- `gvuuid` (varchar): References `gameversions.gvuuid`
- `translevel` (text): Translevel identifier (as reported by the analyzer)
- `level_number` (text): Associated level number (optional)
- `locations` (text): JSON-encoded array of location objects
- `events` (text): JSON-encoded array of event objects
- `created_time` / `updated_time`: Timestamps for auditing

### Constraints
- A gameversion cannot have two levels with the same `levelid`
- All levels linked to a specific levelname record must have the same `gameid`
- Translevels are unique per `(gvuuid, translevel)`
- Foreign key constraints ensure data integrity

## Extraction Artifacts

For each processed game the extractor now produces three files under `lmlevelnames/temp/`:

1. `<gameid>_levelids.json` – Level names and optional level lists
2. `<gameid>_detect.csv` – Comma-separated list of detected level IDs
3. `<gameid>_translevs.json` – Translevel metadata (locations, events, etc.)

## Scripts

### 1. `extract_all_levels.sh`
Extracts level information for the configured game IDs.

**Usage:**
```bash
cd lmlevelnames
./extract_all_levels.sh
```

**What it does:**
- Queries `rhdata.db` for target game IDs (currently edited in the script)
- For each game ID, gets the highest version (or specified version)
- Fetches the patch using `fetchpatches.js mode3`
- Applies the patch to create a patched ROM
- Runs the level extractor and translevel analyzer
a- Saves artifacts to `temp/<gameid>_levelids.json`, `temp/<gameid>_detect.csv`, `temp/<gameid>_translevs.json`

### 2. `levelname_extractor_json.py`
Wrapper around the original extractor that outputs JSON suitable for database import.

**Usage:**
```bash
python3 levelname_extractor_json.py --romfile <rom.sfc> --output <output.json> --gameid <gameid> --version <version> [--levelsonly] [--verbose]
```

**Output format:**
```json
{
  "26252": {
    "version": "1",
    "levels": ["0x001", "0x002"],
    "levelnames": {
      "0x001": "Canterbury Woods",
      "0x002": "Oak Hill"
    }
  }
}
```

### 3. Import scripts

| Script | Purpose | Example |
|--------|---------|---------|
| `import_levelids.py` | Imports `<gameid>_levelids.json` (levelnames + `lmlevels`) | `python3 import_levelids.py temp/26252_levelids.json --verbose` |
| `import_detectlevels.py` | Imports `<gameid>_detect.csv` into `detectedlevels` | `python3 import_detectlevels.py temp/26252_detect.csv` |
| `import_translevels.py` | Imports `<gameid>_translevs.json` into `gameversions_translevels` | `python3 import_translevels.py temp/26252_translevs.json` |

All import scripts accept `--version N` to override the default “highest version” behaviour, `--db` to point at a different database, and `--verbose` for additional output. Re-importing the same file is safe and will replace the previous data for the targeted gameversion.

### 4. `apply_levelnames_migration.py`
Applies (or re-applies) the database schema changes.

**Usage:**
```bash
python3 apply_levelnames_migration.py
```

## Workflow

### Initial Setup
1. Apply/refresh the database schema:
   ```bash
   python3 apply_levelnames_migration.py
   ```

### Extract Level Data
1. Run the extraction script to generate JSON/CSV artifacts:
   ```bash
   ./extract_all_levels.sh
   ```

### Import Level Metadata
1. Level names (`lmlevels` + `levelnames` table):
   ```bash
   python3 import_levelids.py temp/26252_levelids.json --verbose
   ```
2. Detected levels CSV:
   ```bash
   python3 import_detectlevels.py temp/26252_detect.csv
   ```
3. Translevel metadata:
   ```bash
   python3 import_translevels.py temp/26252_translevs.json
   ```

### Bulk Import Helper
- Automated: `./bulk_import_levels.sh [--db PATH] [--version N] [--verbose]`
- Manual loops (if you need per-step control):
```bash
for json_file in temp/*_levelids.json; do
    python3 import_levelids.py "$json_file"
done
for csv_file in temp/*_detect.csv; do
    python3 import_detectlevels.py "$csv_file"
done
for json_file in temp/*_translevs.json; do
    python3 import_translevels.py "$json_file"
done
```

## Dependencies

- Python 3
- SQLite3
- Wine (for Lunar Magic)
- `flips` (for applying BPS patches)
- `snesheader.exe` (for adding SMC headers)
- `fetchpatches.js` (to fetch patches from the databases)

## File Structure

```
lmlevelnames/
├── extract_all_levels.sh             # Main extraction script
├── levelname_extractor_json.py       # JSON output extractor
├── import_levelids.py                # Imports levelnames + lmlevels
├── import_detectlevels.py            # Imports detected level lists
├── import_translevels.py             # Imports translevel metadata
├── apply_levelnames_migration.py     # Ensures schema is up to date
├── levelname_extractor3.py           # Original extractor logic
├── temp/                             # Temporary files and exports
│   ├── <gameid>_levelids.json        # Level name data
│   ├── <gameid>_detect.csv           # Detected level list
│   ├── <gameid>_translevs.json       # Translevel metadata
│   └── temp.sfc                      # Working ROM files
└── README_LEVEL_EXTRACTION.md        # This documentation
```

## Database Queries

### Get all level names for a specific game
```sql
SELECT ln.levelid, ln.levelname
FROM levelnames ln
JOIN gameversion_levelnames gvl ON ln.lvluuid = gvl.lvluuid
JOIN gameversions gv ON gvl.gvuuid = gv.gvuuid
WHERE gv.gameid = '26252'
ORDER BY ln.levelid;
```

### Get level names for a specific game version
```sql
SELECT ln.levelid, ln.levelname
FROM levelnames ln
JOIN gameversion_levelnames gvl ON ln.lvluuid = gvl.lvluuid
WHERE gvl.gvuuid = 'e7caedb6-05a5-4669-ab93-dc0974045f06'
ORDER BY ln.levelid;
```

### Get translevels for a specific game version
```sql
SELECT translevel, level_number, locations, events
FROM gameversions_translevels
WHERE gvuuid = 'e7caedb6-05a5-4669-ab93-dc0974045f06'
ORDER BY translevel;
```

## Error Handling

- **Missing patches**: Skips games without available patches
- **Patch application failures**: Continues with next game
- **Database constraints**: Prevents duplicate level IDs or translevels
- **Foreign key violations**: Properly handles UUID generation and references
- **Re-import safety**: Import scripts fully replace previous data for the targeted gameversion

## Performance Considerations

- Uses database transactions for atomicity
- Creates indexes for better query performance
- Processes games sequentially to avoid resource conflicts
- Cleans up temporary files after each game

## Troubleshooting

### Common Issues

1. **Wine display errors**: Set `export DISPLAY=:1` before running
2. **Missing dependencies**: Ensure all required tools are installed
3. **Database locked**: Check for other processes using the database
4. **Foreign key constraint failures**: Ensure the gameversion exists before importing

### Debug Mode

Use `--verbose` with the import scripts for detailed output, for example:
```bash
python3 import_levelids.py temp/26252_levelids.json --verbose
```
