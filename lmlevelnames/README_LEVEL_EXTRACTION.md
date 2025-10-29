# Level Name Extraction System

This system extracts level names from Super Mario World ROMs edited with Lunar Magic and stores them in the rhdata.db database.

## Overview

The system consists of several components:

1. **Database Schema**: New tables in `rhdata.db` for storing level names
2. **Extraction Scripts**: Tools to extract level names from ROMs and save as JSON
3. **Import Scripts**: Tools to import JSON level data into the database
4. **Migration Scripts**: Database schema updates

## Database Schema

### Tables Added

#### `levelnames` table
- `lvluuid` (varchar, primary key): Unique identifier for each level name
- `gameid` (varchar): Game ID this level belongs to
- `levelid` (varchar): Level ID in hex format (e.g., "0x001")
- `levelname` (varchar): The actual level name
- `created_time` (timestamp): When the record was created
- `updated_time` (timestamp): When the record was last updated

#### `gameversion_levelnames` table (Junction table)
- `gvlvuuid` (varchar, primary key): Unique identifier for the relationship
- `gvuuid` (varchar): References gameversions.gvuuid
- `lvluuid` (varchar): References levelnames.lvluuid
- `created_time` (timestamp): When the relationship was created

### Constraints
- A gameversion cannot have two levels with the same levelid
- All levels linked to a specific levelname record must have the same gameid
- Foreign key constraints ensure data integrity

## Scripts

### 1. `extract_all_levels.sh`
Extracts level names for all gameids in the gameversions table.

**Usage:**
```bash
cd lmlevelnames
./extract_all_levels.sh
```

**What it does:**
- Queries rhdata.db for all unique gameids
- For each gameid, gets the highest version
- Fetches the patch using fetchpatches.js mode3
- Applies the patch to create a patched ROM
- Extracts level names and saves as JSON in `temp/<gameid>_levelids.json`

### 2. `levelname_extractor_json.py`
Modified version of the level name extractor that outputs in the required JSON format.

**Usage:**
```bash
python3 levelname_extractor_json.py --romfile <rom.sfc> --output <output.json> --gameid <gameid> --version <version> [--levelsonly] [--verbose]
```

**Output format:**
```json
{
  "26252": {
    "version": "1",
    "levelnames": {
      "0x001": "Canterbury Woods",
      "0x002": "Oak Hill",
      "0x003": "Stonebridge"
    }
  }
}
```

### 3. `import_levelnames.py`
Imports level names from JSON files into the database.

**Usage:**
```bash
python3 import_levelnames.py <json_file> [--db <db_path>] [--verbose]
```

**Features:**
- Prevents duplicate level IDs for the same gameversion
- Updates existing level names if they change
- Cleans up orphaned levelname records
- Handles foreign key constraints properly

### 4. `apply_levelnames_migration.py`
Applies the database migration to add the levelnames tables.

**Usage:**
```bash
python3 apply_levelnames_migration.py
```

## Workflow

### Initial Setup
1. Apply the database migration:
   ```bash
   python3 apply_levelnames_migration.py
   ```

### Extract Level Names for All Games
1. Run the extraction script:
   ```bash
   ./extract_all_levels.sh
   ```

### Import Specific JSON File
1. Import a specific JSON file:
   ```bash
   python3 import_levelnames.py temp/26252_levelids.json --verbose
   ```

### Import All JSON Files
```bash
for json_file in temp/*_levelids.json; do
    python3 import_levelnames.py "$json_file" --verbose
done
```

## Dependencies

- Python 3
- SQLite3
- Wine (for Lunar Magic)
- flips (for applying patches)
- snesheader.exe (for adding SMC headers)
- fetchpatches.js (for fetching patches)

## File Structure

```
lmlevelnames/
├── extract_all_levels.sh          # Main extraction script
├── levelname_extractor_json.py    # JSON output extractor
├── import_levelnames.py           # Database import script
├── apply_levelnames_migration.py  # Database migration
├── levelname_extractor3.py        # Original extractor
├── temp/                          # Temporary files and JSON output
│   ├── <gameid>_levelids.json     # Extracted level names
│   └── temp.sfc                   # Temporary ROM files
└── README_LEVEL_EXTRACTION.md     # This documentation
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

### Count level names per game
```sql
SELECT gv.gameid, gv.name, COUNT(ln.lvluuid) as level_count
FROM gameversions gv
LEFT JOIN gameversion_levelnames gvl ON gv.gvuuid = gvl.gvuuid
LEFT JOIN levelnames ln ON gvl.lvluuid = ln.lvluuid
GROUP BY gv.gameid, gv.name
ORDER BY level_count DESC;
```

## Error Handling

The system includes comprehensive error handling:

- **Missing patches**: Skips games without available patches
- **Patch application failures**: Continues with next game
- **Database constraints**: Prevents duplicate level IDs
- **Foreign key violations**: Properly handles UUID generation
- **Orphaned records**: Automatically cleans up unused level names

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
4. **Foreign key constraint failures**: Ensure gameversion exists before importing

### Debug Mode

Use `--verbose` flag with import script for detailed output:
```bash
python3 import_levelnames.py temp/26252_levelids.json --verbose
```
