# updategames.js - Consolidated Game Update Script

## Overview

`updategames.js` is a comprehensive JavaScript script that consolidates the functionality of multiple legacy Python scripts into a single, maintainable solution for updating the game versions database.

This script replaces the following legacy workflow:
1. `legacy/do_fetch_smwclist.py` - Fetch metadata from SMWC
2. `legacy/findnew_enhanced.py` - Identify new games
3. `legacy/runid_enhanced.py` - Orchestrate downloads
4. `legacy/smwcfetchrand_enhanced.py` - Download ZIP files
5. `legacy/extractpatch_enhanced.py` - Extract and test patches
6. `legacy/mkblob.py` - Create encrypted blobs
7. `loaddata.js` - Import to database
8. `attachblobs.js` - Create attachments

## Quick Start

### Prerequisites

Before running `updategames.js`, ensure you have:

1. **Node.js** (v16 or higher)
2. **smw.sfc** - Base Super Mario World ROM in project root
   - SHA-224: `fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08`
3. **flips** utility - For applying patches
   - Download from: https://github.com/Alcaro/Flips
   - Place in project root or system PATH

### Installation

```bash
# Install dependencies (includes adm-zip which was added)
npm install

# Run database migration (first time only)
sqlite3 electron/rhdata.db < electron/sql/rhdata_phase1_migration.sql
```

### Basic Usage

```bash
# Fetch new games and process them
npm run updategames

# Or directly with node
node updategames.js
```

## Command Line Options

### General Options

- `--help`, `-h` - Show help message
- `--dry-run` - Simulate operations without making database changes
- `--resume` - Resume from a previous interrupted run

### Processing Options

- `--all-patches` - Process all patch files in each ZIP, not just the primary one
- `--no-fetch-metadata` - Skip fetching metadata from SMWC server
- `--no-process-new` - Skip processing new games

### Filtering Options

- `--game-ids=<ids>` - Process only specific game IDs (comma-separated)
  - Example: `--game-ids=12345,12346,12347`
- `--limit=<n>` - Limit the number of games to process
  - Example: `--limit=10`

## Examples

### Standard Operations

```bash
# Standard update - fetch and process new games
npm run updategames

# Process all patches (not just primary)
npm run updategames:all
# Or: node updategames.js --all-patches

# Test run (no database changes, limit to 5 games)
npm run updategames:test
# Or: node updategames.js --dry-run --limit=5

# Resume interrupted run
npm run updategames:resume
# Or: node updategames.js --resume
```

### Advanced Usage

```bash
# Process specific games only
node updategames.js --game-ids=12345,12346

# Skip metadata fetch, just process queued games
node updategames.js --no-fetch-metadata

# Fetch metadata only, don't process
node updategames.js --no-process-new

# Dry run with all patches for first 3 games
node updategames.js --dry-run --all-patches --limit=3
```

## Workflow

The script executes in 5 main steps:

### Step 1: Fetch Metadata
- Connects to SMWC server
- Fetches complete game list
- Respects rate limiting (60+ seconds between requests)
- Caches responses to minimize server load

### Step 2: Identify New Games
- Compares fetched games with database
- Identifies games not yet in `gameversions` table
- Applies command-line filters if specified

### Step 3: Process Games
For each new game:
- Downloads ZIP file to `zips/` directory
- Extracts patch files (.bps and .ips)
- Scores patches using heuristics to identify primary
- Tests each patch with flips utility
- Calculates verification hashes (SHA-1, SHA-224, SHAKE-128)
- Saves results to working tables

### Step 4: Create Blobs
- Compresses patches with LZMA
- Encrypts with Fernet (PBKDF2-derived keys)
- Creates patchblobs and romblobs
- Saves to `blobs/` directory

### Step 5: Create Records
- Creates `gameversions` records
- Creates `patchblobs` records (with deduplication)
- Creates `attachments` records in patchbin.db
- Links all records together

## Database Tables

### New Tables (Phase 1)

The script uses several new tables added by the migration:

- **update_status** - Tracks update operations
- **game_fetch_queue** - Queue of games to process
- **patch_files_working** - Working table for patch processing
- **smwc_metadata_cache** - Cached SMWC responses
- **patchblobs_extended** - Extended patchblob metadata

### Existing Tables Updated

- **gameversions** - New game records added
- **patchblobs** - New patchblob records added
- **attachments** (in patchbin.db) - New attachment records added

## Rate Limiting

The script respects SMWC server rate limits:

- **60+ seconds** between page requests
- Additional 10 second buffer
- Cached responses used when available
- Progress displayed during waits

## File Structure

```
rhtools/
├── updategames.js          # Main script
├── lib/                    # Library modules
│   ├── database.js         # Database operations
│   ├── smwc-fetcher.js     # SMWC API client
│   ├── game-downloader.js  # ZIP downloader
│   ├── patch-processor.js  # Patch extraction/testing
│   ├── blob-creator.js     # Blob encryption
│   └── record-creator.js   # Database record creation
├── electron/
│   ├── rhdata.db           # Main database
│   ├── patchbin.db         # Attachments database
│   └── sql/
│       └── rhdata_phase1_migration.sql
├── zips/                   # Downloaded ZIP files
├── patch/                  # Extracted patches
├── rom/                    # Patched ROMs
├── blobs/                  # Encrypted blobs
├── temp/                   # Temporary files
├── hacks/                  # Game metadata
├── meta/                   # Metadata files
├── pat_meta/               # Patch metadata
└── rom_meta/               # ROM metadata
```

## Configuration

Configuration is in `updategames.js` at the top of the file:

```javascript
const CONFIG = {
  SMWC_REQUEST_DELAY: 60000,    // 60 seconds
  SMWC_EXTRA_DELAY: 10000,      // Extra 10 seconds
  DOWNLOAD_RETRY_MAX: 3,
  DOWNLOAD_TIMEOUT: 120000,     // 2 minutes
  BASE_ROM_SHA224: 'fdc4c00e...',
  PBKDF2_ITERATIONS: 390000,
  // ... paths and other settings
};
```

## Troubleshooting

### Base ROM Not Found

```
Error: Base ROM not found: /path/to/smw.sfc
```

**Solution**: Place your Super Mario World ROM as `smw.sfc` in the project root directory.

### Base ROM Hash Mismatch

```
⚠ Base ROM hash mismatch!
```

**Solution**: Ensure you have the correct version of the SMW ROM. The script will still attempt to continue but patches may fail.

### Flips Utility Not Found

```
Error: Flips utility not found
```

**Solution**: 
- Download flips from https://github.com/Alcaro/Flips
- Place `flips` (or `flips.exe` on Windows) in project root
- Or install to system PATH

### Network Errors

```
Network error: Cannot connect to SMWC server
```

**Solution**: 
- Check internet connection
- Wait and retry - SMWC may be temporarily unavailable
- Use `--resume` to continue after network is restored

### Patch Application Failed

Some patches may fail to apply. This is normal and the script will:
- Log the error
- Continue with other patches
- Mark the patch as failed in the database

### Database Locked

```
Error: database is locked
```

**Solution**: Close any other applications accessing the database (including Electron app).

## Resuming Interrupted Runs

If the script is interrupted (Ctrl+C, network error, crash), you can resume:

```bash
npm run updategames:resume
# Or: node updategames.js --resume
```

The script will:
- Check queue for incomplete items
- Skip already-downloaded ZIPs
- Continue from where it left off

## Dry Run Mode

Test the script without making changes:

```bash
npm run updategames:test
# Or: node updategames.js --dry-run --limit=5
```

Dry run mode:
- Downloads and processes normally
- Creates blobs
- Does NOT insert database records
- Shows what would be created

## All Patches Mode

By default, only the primary (highest-scored) patch is processed. To process all patches:

```bash
npm run updategames:all
# Or: node updategames.js --all-patches
```

This will:
- Process all .bps and .ips files in each ZIP
- Create patchblobs for each
- Link multiple patches to same game version
- Enable future cataloging of alternate patches

### Patch Scoring Heuristics

Primary patch selection uses these heuristics:
- **+100** points: File in root directory
- **+50** points: .bps file (vs .ips)
- **+0-50** points: File size (larger is better)
- **+20** points: Contains "hack" in name
- **+30** points: Contains "main" in name
- **-100** points: Contains "readme"
- **-50** points: Contains "optional"
- **-30** points: Contains "alternate" or "music"

## Performance

Expected runtime for 100 new games:
- **Metadata Fetch**: ~120 minutes (rate limiting)
- **Download**: ~30 minutes (network dependent)
- **Processing**: ~45 minutes (patch testing)
- **Blob Creation**: ~20 minutes (encryption)
- **Records**: ~5 minutes (database)

**Total**: ~3.5 hours

## Output Example

```
==================================================
       rhtools - Update Games Script v1.0        
==================================================

Initializing...
  ✓ Base ROM verified
  ✓ Flips utility found
  ✓ Database opened

[Step 1/5] Fetching metadata from SMWC...
  Page 1: Fetching from server...
  Rate limiting: waiting 70 seconds...
  ✓ Fetched 50 games
  Page 2: Using cached data (50 games)
  ...
  Total games fetched: 2500
  ✓ Fetched 2500 games

[Step 2/5] Identifying new games...
  Existing games in database: 2450
  New games found: 50
  ✓ Found 50 new games

[Step 3/5] Processing games...

[1/50] Game 12345: Super Mario World: The Adventure
  Downloading from: https://...
  ✓ Downloaded: zips/12345.zip (2,458,123 bytes)
  Analyzing ZIP file...
  Found 2 patch file(s):
    ★ hack.bps (BPS, 54321 bytes, score: 200)
      optional.bps (BPS, 12345 bytes, score: 50)
  Processing primary patch only...

    Processing: hack.bps (PRIMARY)
      Patch SHA-224: abc123...
      ✓ Patch applied successfully
      Result SHA-224: def456...
  Completed: 1/1 patches successful
  ✓ Completed: 1/1 patches successful

[2/50] Game 12346: ...

[Step 4/5] Creating encrypted blobs...
  Processing 50 games for blob creation

  Game 12345:
    Creating encrypted blob...
      ✓ Patchblob: pblob_12345_abc1234567
      Creating ROM blob...
      ✓ ROM blob: rblob_12345_def7654321

[Step 5/5] Creating database records...
  Creating records for 50 games

Game 12345:
  Creating records for game 12345...
    ✓ Gameversion created: uuid-123...
    ✓ Patchblob created: uuid-456...
    ✓ Attachment created for pblob_12345_abc1234567
    ✓ All records created successfully

  Record Creation Summary:
    Created: 50
    Skipped: 0
    Errors:  0

==================================================
              Update Complete!                    
==================================================
```

## Integration with Legacy Scripts

The script is fully compatible with existing database schema and blob format. You can:

- Use legacy scripts and new script interchangeably
- Gradually migrate to new script
- Keep legacy scripts as backup

## Future Enhancements (Phase 2)

See `docs/NEW_UPDATE_SCRIPT_PHASE2_SPEC.md` for planned Phase 2 features:
- Smart change detection for existing games
- Statistics tracking without version bloat
- Update detection and notification
- Field classification configuration

## Support

For issues or questions:
1. Check this README
2. See `docs/NEW_UPDATE_SCRIPT_SPEC.md` for detailed specification
3. Review error messages and troubleshooting section
4. Check logs in database `update_status` table

## License

Same license as parent rhtools project.

