# Database Migration Commands

## Purpose
This document lists all database migration scripts and maintenance commands that administrators should run, as required by project rules.

---

## Migration: Rhpak Package Tracking (rhdata.db, patchbin.db, resource.db, screenshot.db)

### Date Added
November 13, 2025

### Purpose
Add package-tracking columns (`rhpakuuid`) across all game/resource/screenshot tables and create the new `rhpakages` registry so prepared `.rhpak` bundles can be audited or uninstalled safely.

### Command
```bash
# Applies all pending migrations, including rhpak support, to default database paths
./enode.sh jsutils/migratedb.js

# Or specify custom locations
./enode.sh jsutils/migratedb.js \
  --rhdatadb=/path/to/rhdata.db \
  --patchbindb=/path/to/patchbin.db \
  --resourcedb=/path/to/resource.db \
  --screenshotdb=/path/to/screenshot.db
```

### What It Does
- Adds `rhpakuuid` columns to `gameversions`, `gameversion_stats`, `patchblobs`, `patchblobs_extended`, and `rhpatches` (`rhdata.db`).
- Creates the new `rhpakages` table with timestamps and update trigger (`rhdata.db`).
- Adds `rhpakuuid` to `attachments` (`patchbin.db`), `res_attachments` (`resource.db`), and `res_screenshots` (`screenshot.db`).

### Prerequisites
- The target databases should already exist (they are auto-created if missing).
- Recommended to back up each database before applying migrations.

### Expected Outcome
- All relevant tables gain the `rhpakuuid` column (defaults to `NULL` until populated by tooling).
- `rhpakages` table appears in `rhdata.db`, populated when `jstools/newgame.js --add` installs a package.
- `jsutils/migratedb.js` records the new migration IDs in each database’s `schema_migrations` table.

### Warnings
- Safe to run multiple times; `jsutils/migratedb.js` skips migrations that already applied.
- After applying, ensure `jstools/newgame.js --check` / `--add` use the updated paths if databases were relocated.

---

## Migration 030: Nostr Relay Catalog

### Date Added
November 7, 2025

### Purpose
Create the `nostr_relays` table in `clientdata.db` to persist a managed catalog of Nostr relays with category tags, priority, and health metadata. Supports preload relays, user-added relays, and admin-published relay bundles.

### Command
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/030_clientdata_nostr_relays.sql
```

### What It Does
- Creates `nostr_relays` table with metadata columns.
- Adds indexes on `priority` and `added_by`.
- Adds trigger `trg_nostr_relays_updated` to maintain `updated_at` timestamp.

### Prerequisites
- Prior migrations for `clientdata.db` should already be applied.
- Backup recommended before running.

### Expected Outcome
- `nostr_relays` table appears in `clientdata.db`.
- Default data can later be seeded by the application.

### Warnings
- Safe to run multiple times (uses `CREATE TABLE IF NOT EXISTS`).
- Does not populate any default relays; seeding handled by application logic.

---

## Migration 031: Admin Declaration Target Hex

### Date Added
November 8, 2025

### Purpose
Ensure every admin declaration records the subject’s public key in hex form so trust matching can be performed deterministically, even when the local UUID differs.

### Command
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/031_clientdata_admindeclarations_target_hex.sql
```

### What It Does
- Adds `target_keypair_public_hex` column to the `admindeclarations` table.
- Backfills the new column with any existing 64-character hex fingerprints.

### Prerequisites
- Prior `clientdata.db` migrations (027-030) should be applied.
- Backup recommended before running.

### Expected Outcome
- Trust declarations and other admin records store `target_keypair_public_hex`, enabling reliable matching against subjects’ public keys.
- Existing rows gain hex data where it can be inferred from the fingerprint field.

### Warnings
- Uses `ALTER TABLE`; safe to run once.
- Re-running after the column exists is a no-op (migration runner skips automatically).

---

## Migration 001: New Schema Fields Support

### Date Added
January 10, 2025

### Purpose
Add support for new JSON schema format from SMWC with nested type and difficulty fields.

### Command
```bash
sqlite3 electron/rhdata.db < electron/sql/migrations/001_add_fields_type_raw_difficulty.sql
```

### What It Does
- Adds `fields_type` column (VARCHAR 255)
- Adds `raw_difficulty` column (VARCHAR 255)
- Creates indexes for query performance

### Prerequisites
- Database electron/rhdata.db must exist
- Backup recommended before running

### Expected Outcome
- Two new columns appear in gameversions table
- Two new indexes created
- No data loss
- Existing queries continue to work

### Warnings
- Safe to run multiple times (uses IF NOT EXISTS)
- No existing data is modified

---

## Migration 002: Combined Type Field

### Date Added
January 10, 2025

### Purpose
Add computed `combinedtype` column that combines all type and difficulty fields into single human-readable string.

### Command
```bash
sqlite3 electron/rhdata.db < electron/sql/migrations/002_add_combinedtype.sql
```

### What It Does
- Adds `combinedtype` column (VARCHAR 255)
- Creates index for efficient querying

### Prerequisites
- Migration 001 must be run first
- Database must be accessible

### Expected Outcome
- combinedtype column appears in gameversions table
- Index created
- Column will be NULL for existing records until backfilled

### Warnings
- Safe to run multiple times
- Existing records have NULL combinedtype until backfill runs

---

## Migration 003: Backfill Combined Type (Optional)

### Date Added
January 10, 2025

### Purpose
Populate `combinedtype` column for all existing gameversions records by parsing stored JSON data.

### Command
```bash
node electron/sql/migrations/003_backfill_combinedtype.js
```

### What It Does
- Reads all gameversions records
- Parses gvjsondata for each record
- Computes combinedtype from stored data
- Updates records with computed values
- Reports progress and completion

### Prerequisites
- Migration 002 must be run first
- Node.js installed
- better-sqlite3 package installed

### Expected Outcome
- All existing records have combinedtype populated
- ~3 seconds for 2,913 records
- 100% coverage achieved
- No data loss

### Warnings
- Uses transaction (safe)
- Can take several minutes for large databases (>10,000 records)
- Safe to re-run (idempotent)

### Output Example
```
Backfilling combinedtype for 2,913 records...
Processing records... 
✓ Successfully updated 2,913 records
Coverage: 100%
```

---

## Migration 004: Local Resource Tracking

### Date Added
October 12, 2025

### Purpose
Add columns to track downloaded ZIP files with HTTP headers (ETag, Last-Modified) and local filenames for efficient change detection and versioned storage.

### Command
```bash
sqlite3 electron/rhdata.db < electron/sql/migrations/004_add_local_resource_tracking.sql
```

### What It Does
- Adds `local_resource_etag` column (VARCHAR 255)
- Adds `local_resource_lastmodified` column (TIMESTAMP)
- Adds `local_resource_filename` column (VARCHAR 500)
- Creates indexes for efficient querying

### Prerequisites
- Migrations 001-003 recommended (not strictly required)
- Database must be accessible

### Expected Outcome
- Three new columns in gameversions table
- Two new indexes created
- Columns NULL for existing records (will be populated by updategames.js on next run)

### Warnings
- Safe to run multiple times (uses IF NOT EXISTS)
- These are COMPUTED COLUMNS - do not import from JSON
- Managed exclusively by updategames.js script

### Important Notes
**COMPUTED COLUMNS**: These fields are managed by the updategames.js script and must NOT be updated from external JSON data:
- `local_resource_etag` - Set from HTTP headers during download
- `local_resource_lastmodified` - Set from HTTP headers during download
- `local_resource_filename` - Computed by downloader based on version
- `combinedtype` - Computed from other type/difficulty fields
- `gvimport_time` - Auto-generated by database
- `version` - Auto-incremented by database trigger
- `gvuuid` - Auto-generated by database

Scripts importing JSON must exclude these fields.

---

## Upload Status Tracking Table (patchbin.db)

### Date Added
October 12, 2025

### Purpose
Create `upload_status` table in `patchbin.db` to track which blob files have been uploaded to various cloud storage providers (IPFS, Arweave, ArDrive, etc.).

### Command
**Note**: Table is auto-created by `list-unuploaded-blobs.js` and `mark-upload-done.js` scripts on first run.

Manual creation (optional):
```bash
sqlite3 electron/patchbin.db << 'EOF'
CREATE TABLE IF NOT EXISTS upload_status (
  file_name TEXT PRIMARY KEY,
  uploaded_ipfs INTEGER DEFAULT 0,
  uploaded_arweave INTEGER DEFAULT 0,
  uploaded_ardrive INTEGER DEFAULT 0,
  ipfs_uploaded_time TIMESTAMP NULL,
  arweave_uploaded_time TIMESTAMP NULL,
  ardrive_uploaded_time TIMESTAMP NULL,
  ipfs_cid TEXT NULL,
  arweave_txid TEXT NULL,
  ardrive_file_id TEXT NULL,
  notes TEXT NULL,
  created_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
EOF
```

### What It Does
- Creates table to track upload status for multiple providers
- Tracks boolean flags for upload completion (uploaded_ipfs, uploaded_arweave, uploaded_ardrive)
- Stores provider-specific identifiers (CIDs, transaction IDs, file IDs)
- Maintains timestamps of when files were uploaded
- Supports extensibility via notes field for custom providers

### Prerequisites
- Database electron/patchbin.db must exist
- No other migrations required

### Expected Outcome
- `upload_status` table created in patchbin.db
- Used by list-unuploaded-blobs.js and mark-upload-done.js scripts
- Initially empty, populated as files are marked uploaded

### Warnings
- Safe to run multiple times (uses IF NOT EXISTS)
- Table is automatically created by upload management scripts
- No manual intervention typically required

### Related Scripts
```bash
# List files not uploaded to IPFS
node list-unuploaded-blobs.js --provider=ipfs

# Mark files as uploaded
node mark-upload-done.js --provider=ipfs pblob_123.bin pblob_456.bin

# Create archive of unuploaded files
node list-unuploaded-blobs.js --provider=arweave --create-archive
```

### Verification
```bash
# Check table was created
sqlite3 electron/patchbin.db "SELECT name FROM sqlite_master WHERE type='table' AND name='upload_status';"

# Check schema
sqlite3 electron/patchbin.db "PRAGMA table_info(upload_status);"

# Check records
sqlite3 electron/patchbin.db "SELECT COUNT(*) FROM upload_status;"
```

---

## Phase 1 Migration: updategames.js Support Tables

### Date Added
October 12, 2025

### Purpose
Create supporting tables for updategames.js script functionality (update tracking, queue management, patch processing, metadata caching).

### Command
```bash
sqlite3 electron/rhdata.db < electron/sql/rhdata_phase1_migration.sql
```

### What It Does
Creates 5 new tables:
1. `update_status` - Track update operations
2. `game_fetch_queue` - Queue for games to process
3. `patch_files_working` - Working table for patch processing
4. `smwc_metadata_cache` - Cache SMWC API responses
5. `patchblobs_extended` - Extended patchblob metadata

### Prerequisites
- Base rhdata.sql schema must be applied first
- Database must exist

### Expected Outcome
- 5 new tables created
- Multiple indexes created
- updategames.js script becomes functional

### Warnings
- Safe to run multiple times (uses IF NOT EXISTS)
- No impact on existing tables
- Required for updategames.js to function

---

## Complete Migration Sequence

### For New Database

```bash
# 1. Create base schema
sqlite3 electron/rhdata.db < electron/sql/rhdata.sql
sqlite3 electron/patchbin.db < electron/sql/patchbin.sql

# 2. Apply all migrations in order
sqlite3 electron/rhdata.db < electron/sql/migrations/001_add_fields_type_raw_difficulty.sql
sqlite3 electron/rhdata.db < electron/sql/migrations/002_add_combinedtype.sql
sqlite3 electron/rhdata.db < electron/sql/migrations/004_add_local_resource_tracking.sql
sqlite3 electron/rhdata.db < electron/sql/rhdata_phase1_migration.sql

# 3. (Optional) Backfill combinedtype if importing existing data
node electron/sql/migrations/003_backfill_combinedtype.js
```

### For Existing Database

```bash
# Check which migrations are needed
sqlite3 electron/rhdata.db "PRAGMA table_info(gameversions);" | grep -E "fields_type|combinedtype|local_resource"

# Apply missing migrations in order
# (Run commands above for migrations that show no results)

# Apply Phase 1 migration if using updategames.js
sqlite3 electron/rhdata.db "SELECT name FROM sqlite_master WHERE type='table' AND name='update_status';"
# If no result, run:
sqlite3 electron/rhdata.db < electron/sql/rhdata_phase1_migration.sql
```

---

## Verification Commands

### Check Schema Version

```bash
# List all columns in gameversions table
sqlite3 electron/rhdata.db "PRAGMA table_info(gameversions);"

# Check for specific new columns
sqlite3 electron/rhdata.db "PRAGMA table_info(gameversions);" | grep -E "fields_type|raw_difficulty|combinedtype|legacy_type|local_resource"
```

### Check Migration Status

```bash
# Check if Phase 1 tables exist
sqlite3 electron/rhdata.db "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('update_status', 'game_fetch_queue');"

# Check column counts
sqlite3 electron/rhdata.db "SELECT COUNT(*) FROM pragma_table_info('gameversions');"
# Should be 40+ columns (was 33 originally)

# Check indexes
sqlite3 electron/rhdata.db "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='gameversions';"
```

### Verify Data Integrity

```bash
# Check no data was lost
sqlite3 electron/rhdata.db "SELECT COUNT(*) FROM gameversions;"
# Should match pre-migration count

# Check new columns exist and have proper types
sqlite3 electron/rhdata.db "
  SELECT 
    COUNT(*) as total,
    COUNT(combinedtype) as with_combinedtype,
    COUNT(fields_type) as with_fields_type,
    COUNT(local_resource_filename) as with_local_filename
  FROM gameversions;
"
```

---

## Rollback Procedures

### For Migration 001-004

**No automated rollback** - These migrations add columns only.

Manual rollback (if necessary):
```sql
-- Remove columns (SQLite requires table recreation)
-- CAUTION: Backup first!

BEGIN TRANSACTION;

-- Create temp table without new columns
CREATE TABLE gameversions_backup AS 
SELECT 
  gvuuid, section, gameid, version, removed, obsoleted,
  gametype, name, time, added, moderated, author, authors,
  submitter, demo, featured, length, difficulty, url,
  download_url, name_href, author_href, obsoleted_by,
  patchblob1_name, pat_sha224, size, description,
  gvjsondata, gvchange_attributes, gvchanges, tags, tags_href,
  gvimport_time, siglistuuid
FROM gameversions;

-- Drop original
DROP TABLE gameversions;

-- Rename backup
ALTER TABLE gameversions_backup RENAME TO gameversions;

-- Recreate trigger and indexes
-- (see original rhdata.sql)

COMMIT;
```

**Recommendation**: Keep backups instead of rolling back.

### For Phase 1 Migration

```bash
# Drop Phase 1 tables
sqlite3 electron/rhdata.db << 'EOF'
DROP TABLE IF EXISTS update_status;
DROP TABLE IF EXISTS patch_files_working;
DROP TABLE IF EXISTS game_fetch_queue;
DROP TABLE IF EXISTS smwc_metadata_cache;
DROP TABLE IF EXISTS patchblobs_extended;
EOF
```

---

## Backup Procedures

### Before Any Migration

```bash
# Timestamp backup
cp electron/rhdata.db electron/rhdata.db.backup-$(date +%Y%m%d-%H%M%S)

# Verify backup
ls -lh electron/rhdata.db.backup-*
```

### Restore from Backup

```bash
# List backups
ls -lh electron/rhdata.db.backup-*

# Restore specific backup
cp electron/rhdata.db.backup-20251012-103000 electron/rhdata.db
```

---

## Maintenance Commands

### Clear Expired Cache (updategames.js)

```sql
-- Remove expired metadata cache entries
DELETE FROM smwc_metadata_cache 
WHERE cache_expires < datetime('now');

-- Vacuum to reclaim space
VACUUM;
```

### Clean Old Update Status Records

```sql
-- Keep only recent update status (last 30 days)
DELETE FROM update_status 
WHERE started_at < datetime('now', '-30 days');
```

### Archive Completed Queue Items

```sql
-- Optional: Clean up old completed queue items
DELETE FROM game_fetch_queue 
WHERE status = 'completed' 
  AND completed_at < datetime('now', '-90 days');

-- Also clean related patch files working records
DELETE FROM patch_files_working 
WHERE queueuuid NOT IN (SELECT queueuuid FROM game_fetch_queue);
```

---

## Database Statistics

### Check Database Size

```bash
ls -lh electron/rhdata.db
sqlite3 electron/rhdata.db "SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();"
```

### Table Statistics

```bash
sqlite3 electron/rhdata.db << 'EOF'
SELECT 
  'gameversions' as table_name, 
  COUNT(*) as records 
FROM gameversions

UNION ALL

SELECT 'patchblobs', COUNT(*) FROM patchblobs

UNION ALL

SELECT 'update_status', COUNT(*) FROM update_status

UNION ALL

SELECT 'game_fetch_queue', COUNT(*) FROM game_fetch_queue;
EOF
```

---

## Support

### If Migration Fails

1. **Check error message** carefully
2. **Verify prerequisites** (previous migrations, backups)
3. **Check database accessibility** (not open in other programs)
4. **Restore from backup** if necessary
5. **Review migration SQL** for syntax errors

### If Data Seems Wrong After Migration

1. **Check record counts** - Should match pre-migration
2. **Verify NULL handling** - New columns should be NULL for old records
3. **Run verification queries** (see above)
4. **Check documentation** for expected behavior

---

## Migration 001: User Annotations (clientdata.db)

### Date Added
October 12, 2025

### Purpose
Add tables to `clientdata.db` for storing user-specific game annotations (ratings, status, notes) and stage-level annotations.

### Command
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/001_clientdata_user_annotations.sql
```

### What It Does
Creates 3 new tables:
1. `user_game_annotations` - User-specific game data (status, rating, hidden flag, notes)
2. `game_stages` - Stage/exit metadata for games that have documented stages
3. `user_stage_annotations` - User-specific stage ratings and notes

Also creates:
- 2 convenience views for querying annotated data
- 3 triggers for auto-updating timestamps
- 7 indexes for query performance

### Prerequisites
- Database electron/clientdata.db must exist
- If migrating existing installation, backup recommended

### Expected Outcome
- Three new tables in clientdata.db
- Each user can now store:
  - Game status (Default/In Progress/Finished)
  - Personal difficulty ratings (1-5 scale)
  - Hidden flag for hiding games
  - Personal notes
  - Stage-specific ratings and notes

### Table Details

**user_game_annotations**:
- `gameid` - References game from rhdata.db (PRIMARY KEY)
- `status` - Default/In Progress/Finished
- `user_rating` - INTEGER 1-5 or NULL
- `hidden` - 0 or 1 (boolean)
- `user_notes` - TEXT
- `created_at`, `updated_at` - TIMESTAMP

**game_stages**:
- `stage_key` - Format: "gameid-exitnumber" (PRIMARY KEY)
- `gameid`, `exit_number` - Stage identification
- `description` - Stage description
- `public_rating` - Community rating (DECIMAL)
- `created_at`, `updated_at` - TIMESTAMP

**user_stage_annotations**:
- `stage_key` - Format: "gameid-exitnumber" (PRIMARY KEY)
- `gameid`, `exit_number` - References stage
- `user_rating` - INTEGER 1-5 or NULL
- `user_notes` - TEXT
- `created_at`, `updated_at` - TIMESTAMP

### Warnings
- Safe to run multiple times (uses IF NOT EXISTS)
- Each user installation should have their own clientdata.db
- This database should NOT be shared between users

### Environment Variable
Scripts can use `CLIENTDATA_DB_PATH` environment variable to override database path:
```bash
export CLIENTDATA_DB_PATH=/path/to/my/clientdata.db
```

### Verification
```bash
# Check tables were created
sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'user_%' OR name='game_stages';"

# Expected output:
# user_game_annotations
# game_stages
# user_stage_annotations

# Check views were created
sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='view';"

# Expected output:
# v_games_with_annotations
# v_stages_with_annotations
```

### Usage Examples

```sql
-- Set a game as "In Progress" with rating 4
INSERT OR REPLACE INTO user_game_annotations (gameid, status, user_rating, hidden, user_notes)
VALUES ('12345', 'In Progress', 4, 0, 'Really enjoying this one!');

-- Hide a game
UPDATE user_game_annotations SET hidden = 1 WHERE gameid = '12345';

-- Add stage information for a game
INSERT INTO game_stages (stage_key, gameid, exit_number, description, public_rating)
VALUES ('12345-01', '12345', '01', 'First Level', 3.5);

-- Rate a specific stage
INSERT OR REPLACE INTO user_stage_annotations (stage_key, gameid, exit_number, user_rating, user_notes)
VALUES ('12345-01', '12345', '01', 5, 'Fantastic level design!');

-- Query all user annotations for games
SELECT * FROM v_games_with_annotations WHERE status = 'In Progress';

-- Query stages with user ratings
SELECT * FROM v_stages_with_annotations WHERE user_rating >= 4;
```

---

## Migration 002: Enhanced Ratings and Run System (clientdata.db)

### Date Added
October 12, 2025

### Purpose
Add dual rating system (difficulty + review), version-specific annotations, random exclusion controls, and complete run system for planning/executing challenge runs.

### Command
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/002_clientdata_enhanced_ratings_and_runs.sql
```

### What It Does
Creates/enhances 9 components:

**Enhanced Tables**:
1. `user_game_annotations` - Adds user_difficulty_rating, user_review_rating, exclude_from_random
2. `user_stage_annotations` - Adds user_difficulty_rating, user_review_rating

**New Tables**:
3. `user_game_version_annotations` - Version-specific ratings/status/notes
4. `runs` - Run metadata and status tracking
5. `run_plan_entries` - Planned challenges in a run
6. `run_results` - Actual execution results
7. `run_archive` - Archived run metadata

**New Views**:
8. `v_active_run` - Current active run summary
9. `v_run_progress` - Current run progress details

Also updates existing views to include new rating fields.

### Key Features

**Dual Ratings**:
- `user_difficulty_rating` (1-5): How hard is it?
- `user_review_rating` (1-5): How much do you recommend it?

**Version-Specific Annotations**:
- Rate different versions of same game differently
- Override game-wide ratings for specific versions
- Example: v1 might be harder (difficulty=5) than v2 (difficulty=3)

**Random Exclusion**:
- User-level: `exclude_from_random` flag
- Curator-level: See Migration 005

**Run System**:
- Plan runs with specific games or random challenges
- Execute runs with timing and result tracking
- Support for 4 entry types: game, stage, random_game, random_stage
- Track success/skip/fail for each challenge
- Archive completed runs for history

### Prerequisites
- Migration 001 (user annotations) must be run first
- Database must be accessible

### Expected Outcome
- 4 new tables in clientdata.db
- 3 enhanced tables with new columns
- 2 new views for run tracking
- Dual rating system functional
- Version-specific annotations supported
- Run system ready for use

### Warnings
- Safe to run multiple times (uses IF NOT EXISTS and ALTER TABLE)
- Keeps `user_rating` column for backwards compatibility
- Applications should migrate to user_difficulty_rating
- Run system is complex - see docs/ENHANCED_RATINGS_AND_RUN_SYSTEM.md

### Verification
```bash
# Check new tables
sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%run%';"

# Expected output:
# runs
# run_plan_entries
# run_results
# run_archive

# Check new columns
sqlite3 electron/clientdata.db "PRAGMA table_info(user_game_annotations);" | grep -E "difficulty|review|exclude"

# Check new views
sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='view' AND name LIKE '%run%';"

# Expected output:
# v_active_run
# v_run_progress
```

### Usage Examples

```sql
-- Set both ratings for a game
INSERT OR REPLACE INTO user_game_annotations 
  (gameid, user_difficulty_rating, user_review_rating, status)
VALUES ('12345', 4, 5, 'In Progress');
-- Difficulty 4 (Hard), Review 5 (Highly Recommended)

-- Set version-specific rating
INSERT OR REPLACE INTO user_game_version_annotations 
  (annotation_key, gameid, version, user_difficulty_rating, user_review_rating)
VALUES ('12345-2', '12345', 2, 3, 5);
-- Version 2 is easier (3) but still great (5)

-- Exclude from random
UPDATE user_game_annotations SET exclude_from_random = 1 WHERE gameid = '12345';

-- Create a run
INSERT INTO runs (run_uuid, run_name, status)
VALUES (lower(hex(randomblob(16))), 'Morning Run', 'preparing');

-- Add specific game to run
INSERT INTO run_plan_entries 
  (run_uuid, sequence_number, entry_type, gameid, count)
VALUES ('abc123', 1, 'game', '12345', 1);

-- Add random kaizo challenges
INSERT INTO run_plan_entries 
  (run_uuid, sequence_number, entry_type, count, filter_type, filter_seed)
VALUES ('abc123', 2, 'random_game', 5, 'Kaizo', 'seed789');
```

---

## Migration 005: Local Run Exclusion (rhdata.db)

### Date Added
October 12, 2025

### Purpose
Add curator-controlled flag to exclude games from random selection in gameversions table.

### Command
```bash
sqlite3 electron/rhdata.db < electron/sql/migrations/005_add_local_runexcluded.sql
```

### What It Does
- Adds `local_runexcluded` column (INTEGER DEFAULT 0) to gameversions table
- Creates index on local_runexcluded for efficient filtering
- Marks field as COMPUTED COLUMN (do not import from JSON)

### Rationale
Curators need ability to exclude certain games from random selection independent of user preferences:
- Broken or buggy games
- Inappropriate content
- Test/demo games
- Duplicate entries
- Games with missing files

### Prerequisites
- Database must be accessible
- Backup recommended

### Expected Outcome
- gameversions table has new local_runexcluded column
- Index created for efficient queries
- All existing games default to 0 (not excluded)

### Warnings
- Safe to run multiple times (uses IF NOT EXISTS)
- This is a **COMPUTED COLUMN** - scripts must NOT import from JSON
- This field complements user-level exclude_from_random in clientdata.db

### COMPUTED COLUMNS
Fields that must NOT be imported from JSON:
- local_runexcluded (NEW)
- combinedtype
- gvimport_time
- version
- gvuuid
- local_resource_etag
- local_resource_lastmodified
- local_resource_filename

### Verification
```bash
# Check column exists
sqlite3 electron/rhdata.db "PRAGMA table_info(gameversions);" | grep runexcluded

# Expected output:
# 41|local_runexcluded|INTEGER|0|0|0

# Check index exists
sqlite3 electron/rhdata.db "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_gameversions_runexcluded';"

# Count excluded games
sqlite3 electron/rhdata.db "SELECT COUNT(*) FROM gameversions WHERE local_runexcluded = 1;"
```

### Usage Examples

```sql
-- Exclude a game from random selection
UPDATE gameversions SET local_runexcluded = 1 WHERE gameid = '12345';

-- Un-exclude a game
UPDATE gameversions SET local_runexcluded = 0 WHERE gameid = '12345';

-- Get eligible games for random selection (combining both exclusion flags)
ATTACH DATABASE 'electron/clientdata.db' AS clientdata;

SELECT gv.gameid, gv.name, gv.difficulty
FROM gameversions gv
LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
WHERE gv.removed = 0
  AND gv.obsoleted = 0
  AND gv.local_runexcluded = 0  -- Curator says OK
  AND (uga.exclude_from_random IS NULL OR uga.exclude_from_random = 0)  -- User says OK
  AND gv.version = (SELECT MAX(version) FROM gameversions WHERE gameid = gv.gameid)
ORDER BY RANDOM()
LIMIT 10;

DETACH DATABASE clientdata;
```

---

## Migration 003: Skill Rating and Conditions (clientdata.db)

### Date Added
October 12, 2025

### Purpose
Add skill rating columns (0-10 scale) and challenge conditions support to run system.

### Command
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/003_clientdata_skill_rating_and_conditions.sql
```

### What It Does
**Adds Skill Rating**:
- `user_skill_rating` column to `user_game_annotations` (0-10 scale)
- `user_skill_rating` column to `user_game_version_annotations` (0-10 scale)
- `user_skill_rating` column to `user_stage_annotations` (0-10 scale)

**Adds Challenge Conditions**:
- `global_conditions` column to `runs` table (JSON array)
- `conditions` column to `run_plan_entries` table (JSON array)
- `conditions` column to `run_results` table (JSON array)

**Updates Views**:
- `v_games_with_annotations` - Includes user_skill_rating
- `v_stages_with_annotations` - Includes user_skill_rating

### Skill Rating Scale (0-10)

| Rating | Label | Meaning |
|--------|-------|---------|
| 0 | Observer | Watched others play |
| 1 | Casual | Basic skills |
| 2 | Apprentice | Learning advanced techniques |
| 3 | Advanced | Comfortable with hard hacks |
| 4 | Expert | Can complete expert-level hacks |
| 5 | Master | Mastery of mechanics |
| 6 | Legend | Among the greats (Glitchcat7, Panga, etc.) |
| 7 | Champion | Beat legendary hacks (JUMP, Hackers Dragon) |
| 8 | Deity | Would replay legendary hacks |
| 9 | Speedrunner | Speedrun capable |
| 10 | Pro Speedrunner | Active speedrunner |

### Challenge Conditions

Available conditions (stored as JSON array):
- "Hitless" - No getting hit
- "Deathless" - No dying
- "No Coins" - Don't collect coins
- "No Powerups" - Don't use powerups
- "No Midway" - Don't use midway points

### Prerequisites
- Migration 001 and 002 must be run first
- Database must be accessible

### Expected Outcome
- 3 new skill_rating columns
- 3 new conditions columns in run tables
- Updated views include skill rating
- Ready for skill-based filtering

### Warnings
- Safe to run multiple times
- Note about rating constraints (existing remain 1-5, new accepts 0-5)
- Conditions stored as JSON - validate on read/write

### Verification
```bash
# Check skill rating column
sqlite3 electron/clientdata.db "PRAGMA table_info(user_game_annotations);" | grep skill

# Check conditions columns
sqlite3 electron/clientdata.db "PRAGMA table_info(runs);" | grep conditions

# Verify views updated
sqlite3 electron/clientdata.db "SELECT * FROM v_games_with_annotations LIMIT 1;"
```

---

*Last Updated: October 12, 2025*  
*Total Migrations: 9 (4 rhdata schema + 1 Phase 1 tables + 1 rhdata runexcluded + 3 clientdata)*
*Status: ALL MIGRATIONS APPLIED AND TESTED ✅*


## 2025-10-12: Apply Migration 004 - Fix run_results gameid NULL Constraint

### Date Added
October 12, 2025

### Purpose
Fix the `run_results.gameid` column to allow NULL values for unresolved random game/stage challenges.

### Command
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/004_clientdata_fix_run_results_gameid.sql
```

### Prerequisites
- clientdata.db exists
- Migrations 001-003 have been applied

### Expected Outcome
- `run_results.gameid` column now allows NULL values
- Random challenges can be stored without gameid
- Existing data preserved (if any)
- Indexes recreated

### Verification
```bash
# Check schema
sqlite3 electron/clientdata.db "PRAGMA table_info(run_results);"

# Look for gameid column - should NOT show 'NOT NULL' in notnull column
# Column info: cid|name|type|notnull|dflt_value|pk
# gameid should have notnull=0 (means nullable)

# Test with a query
sqlite3 electron/clientdata.db "SELECT gameid FROM run_results WHERE gameid IS NULL LIMIT 1;"
# Should not error (means NULL is allowed)
```

### Important Notes
- **Data Safety**: Migration preserves existing data via backup table
- **Table Recreation**: SQLite requires full table recreation to modify constraints
- **Indexes**: All indexes are recreated after table recreation
- **Impact**: Enables run system to work with random challenges

---



## 2025-10-12: Apply Migration 006 - Add Seed Mappings Table

### Date Added
October 12, 2025

### Purpose
Add `seedmappings` table to support deterministic random game selection with seed mappings for competitive runs and run sharing.

### Command
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/006_clientdata_seed_mappings.sql
```

### Prerequisites
- clientdata.db exists
- Migrations 001-005 have been applied

### Expected Outcome
- `seedmappings` table created
- Ready for seed generation
- No data populated yet (created on first use)

### Verification
```bash
# Check table exists
sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='table' AND name='seedmappings';"
# Should output: seedmappings

# Check schema
sqlite3 electron/clientdata.db "PRAGMA table_info(seedmappings);"
# Should show: mapid, mappingdata, game_count, mapping_hash, created_at, description

# Check indexes
sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='seedmappings';"
# Should show: idx_seedmappings_count, idx_seedmappings_created
```

### Important Notes
- **Automatic Creation**: First mapping created automatically when generating first seed
- **Game Snapshot**: Each mapping freezes list of candidate games at that time
- **Immutable**: Once created, mappings don't change (ensures reproducibility)
- **Import/Export**: Mappings are exported with runs for compatibility
- **Seed Format**: Seeds have format "MAPID-SUFFIX" (e.g., "A7K9M-XyZ3q")

---

## Migration 008: SNES Contents Cache (clientdata.db)

### Date Added
October 14, 2025

### Purpose
Create cache table for tracking files on SNES device (SD2SNES) to enable quick launch functionality and file management.

### Command
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/008_clientdata_snes_contents_cache.sql
```

### What It Does
- Creates `snes_contents` table with 19 columns
- Tracks files in /work/ folder on SNES device
- Stores game metadata for known files
- Supports pinning, dismissing, and status tracking
- Creates 4 indexes for performance

### Prerequisites
- clientdata.db exists
- USB2SNES functionality is enabled
- Previous clientdata migrations applied

### Expected Outcome
- `snes_contents` table created
- 4 indexes created
- Ready for auto-sync after uploads
- No data populated yet (syncs on first upload)

### Verification
```bash
# Check table exists
sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='table' AND name='snes_contents';"
# Should output: snes_contents

# Check schema
sqlite3 electron/clientdata.db "PRAGMA table_info(snes_contents);"
# Should show 19 columns

# Check indexes
sqlite3 electron/clientdata.db "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='snes_contents';"
# Should show 4 indexes
```

### How It Works

**Auto-Sync After Upload:**
1. User uploads file to SNES via Upload dialog or Quick Launch
2. Upload completes successfully
3. System lists /work/ directory on SNES
4. Compares with cache database:
   - New files → Insert into cache with metadata
   - Missing files → Delete from cache
   - Existing files → Update last_seen_timestamp
5. Uploaded file populated with game ID, name, type, difficulty

**File Detection:**
- Only tracks .sfc files (ROM files)
- Files detected but not uploaded by us:
  - Have NULL upload_timestamp
  - No game metadata
  - Shown last in UI list

**Re-Upload Behavior:**
- Uploading same file again resets dismissed=0
- Updates upload_timestamp
- Re-populates metadata

### UI Features

**📁 SNES Files Dropdown** in toolbar:
- Click to see files on SNES
- Sorted: Pinned → Recently Uploaded → Detected
- Shows filename, game name, upload time

**Actions Per File:**
- 🚀 Launch - Boot on SNES, mark launched
- 📌 Pin - Pin to top of list
- ✖ Dismiss - Hide from view
- 🔍 Find Game - Select in main list (if gameid known)

**Show All Checkbox:**
- Unchecked: Hide dismissed files (default)
- Checked: Show all files

### Important Notes
- **Automatic Sync**: Cache syncs automatically after every upload
- **Cleanup**: Files deleted from SNES are removed from cache on next sync
- **Metadata Extraction**: Filenames like "smw12345_1.sfc" auto-link to game database
- **Performance**: Indexes ensure fast queries even with many files
- **User-Specific**: Each user's cache in their own clientdata.db

### Related Files
- `electron/main/SnesContentsManager.js` - Cache logic
- `electron/ipc-handlers.js` - IPC handlers
- `electron/renderer/src/App.vue` - UI dropdown
- `docs/SCHEMACHANGES.md` - Detailed schema documentation

---

## Migration: Add sfcpath Column to run_results

### Date Added
October 26, 2025

### Purpose
Add `sfcpath` column to `run_results` table to track USB2SNES file paths for run games, enabling launch buttons during run execution.

### Command
```bash
sqlite3 electron/clientdata.db "ALTER TABLE run_results ADD COLUMN sfcpath TEXT NULL;"
```

### What It Does
- Adds `sfcpath` column to `run_results` table
- Stores relative path like `run251025_2307/02.sfc`
- Enables "Launch" buttons for each challenge during active runs

### Prerequisites
- Database `electron/clientdata.db` must exist
- `run_results` table must exist (created during app initialization)

### Expected Outcome
- New column `sfcpath` added to run_results table
- Existing rows will have NULL for sfcpath
- New uploads will populate sfcpath automatically

### Warnings
- Safe to run multiple times (SQLite will error if column exists, but won't corrupt data)
- Existing runs without sfcpath will still work (just won't have launch buttons)

---

## Migration 010: Add Contest and Racelevel Columns

### Date Added
January XX, 2025

### Purpose
Add `contest` and `racelevel` columns to the `gameversions` table for enhanced game categorization.

### Command
```bash
sqlite3 electron/rhdata.db < electron/sql/migrations/010_add_contest_racelevel_to_gameversions.sql
```

### What It Does
- Adds `contest` column (VARCHAR 255)
- Adds `racelevel` column (VARCHAR 255)
- Creates indexes for query performance

### Prerequisites
- Database electron/rhdata.db must exist
- Backup recommended before running

### Expected Outcome
- Two new columns appear in gameversions table
- Two new indexes created
- No data loss
- Existing queries continue to work

### Warnings
- Safe to run multiple times (uses IF NOT EXISTS checks)
- No existing data is modified (columns are empty after creation)

---

## Migration 011: Populate Contest and Racelevel from JSON

### Date Added
January XX, 2025

### Purpose
Populate `contest` and `racelevel` columns by extracting values from `gvjsondata` JSON field.

### Command
```bash
node electron/sql/migrations/011_populate_contest_racelevel_from_json.js
```

Or with custom database path:
```bash
RHDATA_DB_PATH=/path/to/rhdata.db node electron/sql/migrations/011_populate_contest_racelevel_from_json.js
```

### What It Does
- Reads all gameversions records with gvjsondata
- Parses JSON and extracts contest and racelevel attributes
- Updates the columns with extracted values

### Prerequisites
- Migration 010 must be run first (columns must exist)
- Database electron/rhdata.db must exist
- Node.js must be installed
- better-sqlite3 must be available

### Expected Outcome
- Contest and racelevel columns populated from JSON data
- Console output shows number of records processed and updated
- No data loss (only updates columns with new values)

### Warnings
- Safe to run multiple times (only updates if values differ)
- May take time on large databases
- Logs warnings for records with invalid JSON

---

## Migration 013: Add Skill Rating When Beat

### Date Added
January XX, 2025

### Purpose
Add `user_skill_rating_when_beat` column to track skill level when the game was beaten (separate from rating time).

### Command
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/013_add_skill_rating_when_beat.sql
```

### What It Does
- Adds `user_skill_rating_when_beat` column (INTEGER, 0-10) to both annotation tables
- Creates indexes for query performance

### Prerequisites
- Database electron/clientdata.db must exist
- Migration 012 must be applied first

### Expected Outcome
- New column appears in both `user_game_annotations` and `user_game_version_annotations` tables
- New indexes created
- No data loss
- Existing queries continue to work

### Warnings
- Safe to run multiple times (uses IF NOT EXISTS)
- No existing data is modified

---

## Migration 014: Add Rating Comment Columns

### Date Added
January XX, 2025

### Purpose
Add comment text columns for all rating components to allow users to add optional comments for each rating dimension (Review, Recommendation, Importance, Technical Quality, Gameplay Design, Originality, Visual Aesthetics, Story, Soundtrack and Graphics).

### Command
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/014_add_rating_comments_to_clientdata.sql
```

### What It Does
- Adds 9 comment columns (TEXT) to `user_game_annotations` table:
  - `user_review_comment`
  - `user_recommendation_comment`
  - `user_importance_comment`
  - `user_technical_quality_comment`
  - `user_gameplay_design_comment`
  - `user_originality_comment`
  - `user_visual_aesthetics_comment`
  - `user_story_comment`
  - `user_soundtrack_graphics_comment`
- Adds the same 9 comment columns to `user_game_version_annotations` table
- All comment columns are optional (NULL allowed)

### Prerequisites
- Database electron/clientdata.db must exist
- Migration 013 must be applied first

### Expected Outcome
- 9 new comment columns appear in both `user_game_annotations` and `user_game_version_annotations` tables
- No data loss
- Existing queries continue to work
- Users can now add comments to their ratings in the Rating Sheet modal

### Warnings
- Safe to run multiple times (uses IF NOT EXISTS)
- No existing data is modified
- Comments are optional - users can rate without commenting

---

## Migration 012: Add Extended Rating Columns

### Date Added
January XX, 2025

### Purpose
Add extended rating columns to `user_game_annotations` and `user_game_version_annotations` tables for detailed game reviews.

### Command
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/012_add_extended_ratings_to_clientdata.sql
```

### What It Does
- Adds 8 new rating columns to `user_game_annotations` table
- Adds 8 new rating columns to `user_game_version_annotations` table
- Creates indexes on all new rating columns for query performance
- All rating columns support 0-5 stars or NULL (empty)

### Prerequisites
- Database electron/clientdata.db must exist
- Backup recommended before running

### Expected Outcome
- 8 new columns added to each table (16 total columns)
- 16 new indexes created (8 per table)
- No data loss
- Existing queries continue to work
- New columns start as NULL (empty)

### Warnings
- Safe to run multiple times (SQLite will error if columns exist, but won't corrupt data)
- All new rating columns allow NULL values (0-5 stars or empty)
- Existing rating data is not affected

---

## Migration 015: Admin Keypairs Table (clientdata.db)

### Date Added
January 2025

### Purpose
Create `admin_keypairs` table in `clientdata.db` to store admin keypairs with public keys (public) and encrypted secret keys (private).

### Command
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/015_clientdata_admin_keypairs.sql
```

Or use the migration runner:
```bash
CLIENTDATA_DB_PATH=/path/to/clientdata.db
./enode.sh jsutils/migratedb.js --clientdata=/path/to/clientdata.db
```

### What It Does
Creates a new table `admin_keypairs` with:
- Keypair metadata (type, usage, storage status)
- Public keys (PEM and hex formats)
- Fingerprints for identification
- Encrypted private keys (encrypted with Profile Guard key)
- Trust levels and naming conventions

Also creates:
- 4 indexes for query performance
- 1 trigger for auto-updating timestamps

### Prerequisites
- Database `clientdata.db` must exist
- Profile Guard should be set up (for encrypting secret keys)
- If migrating existing installation, backup recommended

### Expected Outcome
- New `admin_keypairs` table in `clientdata.db`
- Admin keypairs can be stored with encrypted secret keys
- Public keys and trust status can be included in client program for end users

### Warnings
- Safe to run multiple times (uses IF NOT EXISTS)
- Secret keys are encrypted with Profile Guard key - ensure Profile Guard is unlocked when creating keypairs
- Public keys are stored unencrypted and can be distributed

---

## Migration 016: Admin Declarations Table (clientdata.db)

### Date Added
January 2025

### Purpose
Create `admindeclarations` table in `clientdata.db` to store admin declarations (trust declarations, privilege grants/revocations).

### Command
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/016_clientdata_admindeclarations.sql
```

Or use the migration runner:
```bash
CLIENTDATA_DB_PATH=/path/to/clientdata.db
./enode.sh jsutils/migratedb.js --clientdata=/path/to/clientdata.db
```

### What It Does
Creates a new table `admindeclarations` with:
- Declaration type and content (JSON)
- SHA256 hash of declaration content
- Digital signature
- Signing keypair information
- Target keypair or user profile information
- Validity period (start/end dates)

Also creates:
- 6 indexes for query performance
- 1 trigger for auto-updating timestamps

### Prerequisites
- Database `clientdata.db` must exist
- `admin_keypairs` table should exist (Migration 015)
- If migrating existing installation, backup recommended

### Expected Outcome
- New `admindeclarations` table in `clientdata.db`
- Admin declarations can be stored with signatures
- Trust declarations and privilege grants/revocations can be tracked

### Warnings
- Safe to run multiple times (uses IF NOT EXISTS)
- Declarations require valid signatures from trusted admin keypairs
- Multi-signature support requires at least 3 trusted keys

---

## Migration 017: Admin Keypair Name, Label, and Comments (clientdata.db)

### Date Added
January 2025

### Purpose
Add `name`, `label`, and `comments` columns to the `admin_keypairs` table to allow users to add custom names, labels, and comments to keypairs.

### Command
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/017_add_admin_keypair_name_label_comments.sql
```

Or use the migration runner:
```bash
CLIENTDATA_DB_PATH=/path/to/clientdata.db
./enode.sh jsutils/migratedb.js --clientdata=/path/to/clientdata.db
```

### What It Does
Adds three new columns to the `admin_keypairs` table:
- `name` (TEXT): User-friendly name for the keypair
- `label` (TEXT): Optional label for the keypair
- `comments` (TEXT): Optional comments/notes about the keypair

### Prerequisites
- Migration 015 (Admin Keypairs Table) must be run first
- Database must be accessible

### Expected Outcome
- Three new columns appear in `admin_keypairs` table
- Two new indexes created (`idx_admin_keypairs_name`, `idx_admin_keypairs_label`)
- Existing keypairs have NULL values for these fields (can be set later)
- No data loss

### Warnings
- Safe to run multiple times (uses IF NOT EXISTS)
- Existing records have NULL values until updated

---

## Migration 018: Admin Keypair Profile UUID (clientdata.db)

### Date Added
January 2025

### Purpose
Add `profile_uuid` column to the `admin_keypairs` table to distinguish between global admin keypairs (NULL) and User Op keys (bound to a specific profile).

### Command
```bash
sqlite3 electron/clientdata.db < electron/sql/migrations/018_add_admin_keypair_profile_uuid.sql
```

Or use the migration runner:
```bash
CLIENTDATA_DB_PATH=/path/to/clientdata.db
./enode.sh jsutils/migratedb.js --clientdata=/path/to/clientdata.db
```

### What It Does
Adds `profile_uuid` column to the `admin_keypairs` table:
- `profile_uuid` (TEXT): UUID of the profile that owns this keypair, or NULL for global admin keypairs
- Creates index `idx_admin_keypairs_profile_uuid` for efficient querying

**Distinction**:
- **Global Admin Keypairs**: `profile_uuid IS NULL` - These are system-wide admin keypairs not bound to any profile
- **User Op Keys**: `profile_uuid = <profile UUID>` - These are admin keypairs bound to a specific user profile

### Prerequisites
- Migration 015 (Admin Keypairs Table) must be run first
- Database must be accessible

### Expected Outcome
- New column `profile_uuid` appears in `admin_keypairs` table
- New index created for efficient profile-based queries
- Existing keypairs have NULL values (treated as global admin keypairs)
- No data loss

### Warnings
- Safe to run multiple times (uses IF NOT EXISTS)
- Existing records have NULL values (treated as global admin keypairs)
- The `online:admin-keypairs:list` IPC handler now filters to only return global admin keypairs (`WHERE profile_uuid IS NULL`)

---

## Migration 024: Admin Keypairs Nostr Publishing Fields

### Date Added
February 2025

### Purpose
Add Nostr event ID and status columns to `admin_keypairs` table to support publishing admin keypair records to the Nostr network.

### Command
```bash
./enode.sh jsutils/migratedb.js --clientdata=/path/to/clientdata.db
```

Or manually:
```sql
sqlite3 electron/clientdata.db < electron/sql/migrations/024_clientdata_admin_keypairs_nostr_fields.sql
```

### What It Does
- Adds `nostr_event_id` column (VARCHAR(64) NULL) to store the Nostr event ID when published
- Adds `nostr_status` column (VARCHAR(50) DEFAULT 'pending') to track publishing status
- Creates indexes on both columns for efficient queries
- Sets default status to 'pending' for existing records

### Prerequisites
- Database `clientdata.db` must exist
- `admin_keypairs` table must exist (from migration 015)
- Backup recommended before running

### Expected Outcome
- New columns `nostr_event_id` and `nostr_status` appear in `admin_keypairs` table
- Two new indexes created for query performance
- Existing keypairs have `nostr_status = 'pending'` and `nostr_event_id = NULL`
- No data loss

### Warnings
- Safe to run multiple times (uses IF NOT EXISTS)
- Existing records will have NULL `nostr_event_id` and 'pending' status
- Publishing to Nostr will update these fields when implemented

---

## Migration 031: Ratings Database Schema

### Date Added
November 7, 2025

### Purpose
Create the `ratings.db` schema used to store incoming Nostr rating events (`rating_events`) and aggregated summaries (`rating_summaries`).

### Command
```bash
sqlite3 electron/ratings.db < electron/sql/ratings.sql
```

### What It Does
- Creates `rating_events` table keyed by `(rater_pubkey, gameid)` to hold the latest ratingcard per user/game, including derived `trust_level`/`trust_tier` metadata.
- Creates `rating_summaries` table for per-game, per-trust-tier aggregates.
- Creates `trust_assignments` table capturing manual or delegated trust certifications (levels, limits, expiration).
- Adds supporting indexes for lookup performance.

### Prerequisites
- `ratings.db` should exist or be writable in the application data directory (created automatically on first run).
- No prior migration required (new database).

### Expected Outcome
- `ratings.db` contains the base schema ready for Nostr runtime ingestion.

### Warnings
- Safe to run multiple times (uses `CREATE TABLE IF NOT EXISTS`).
- Existing data is preserved; rerunning only ensures schema presence.

---

## Migration 032: Moderation Database Schema

### Date Added
November 7, 2025

### Purpose
Create the `moderation.db` schema used to track moderation actions (`moderation_actions`) and their audit logs (`moderation_logs`).

### Command
```bash
sqlite3 electron/moderation.db < electron/sql/moderation.sql
```

### What It Does
- Creates `moderation_actions` to persist signed moderation directives (blocks, freezes, warnings) along with issuer metadata and status.
- Creates `moderation_logs` to keep an audit trail (create/revoke/expire) for each action.
- Adds indexes to support lookup by target, status, and event ID.

### Prerequisites
- `moderation.db` should exist or be writable in the application data directory (created automatically on first run).

### Expected Outcome
- Moderation runtime helpers can read/write actions and logs for enforcement and auditing purposes.

### Warnings
- Safe to run multiple times (uses `CREATE TABLE IF NOT EXISTS`).
- Existing data is preserved; rerunning only ensures schema presence.

---


