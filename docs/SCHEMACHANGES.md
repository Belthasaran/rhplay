# Database Schema Changes Log

## Purpose
This document tracks all database schema changes made to the rhtools project databases (rhdata.db, patchbin.db, and clientdata.db) as required by project rules.

---

## 2025-11-07: Nostr Relay Catalog (clientdata.db)

### Date
November 7, 2025

### Description
Created `nostr_relays` table in `clientdata.db` to store a managed catalog of Nostr relay endpoints along with category tags, priority, health telemetry, and read/write flags. This supports client-managed preload relays, user-added relays, and admin-published relay lists signed via trust declarations.

### Rationale
- **Relay Management**: Persist a curated list of relays the client should connect to.
- **Categorization**: Allow users to opt into relay categories (trusted-core, ratings, profiles, etc.).
- **Health Tracking**: Record last success/failure timestamps and consecutive failure counts for adaptive relay selection.
- **Extensibility**: Support admin-published relay bundles and user overrides without code changes.

### Tables/Columns Affected

**Database**: `clientdata.db`

**New Table**: `nostr_relays`

| Column | Type | Notes |
| --- | --- | --- |
| `relay_url` | TEXT PRIMARY KEY | Fully-qualified Nostr relay URL |
| `label` | TEXT | Optional human-readable name |
| `categories` | TEXT | JSON array of category tags |
| `priority` | INTEGER | Higher values sorted first |
| `auth_required` | INTEGER | 1 if relay requires auth (NIP-42, NIP-111) |
| `read` | INTEGER | 1 if client should subscribe/read |
| `write` | INTEGER | 1 if client should publish/write |
| `added_by` | TEXT | `system`, `user`, or `admin-published` |
| `health_score` | REAL | Running score (-1.0 to 1.0) |
| `last_success` | INTEGER | Unix timestamp of last successful interaction |
| `last_failure` | INTEGER | Unix timestamp of last failure |
| `consecutive_failures` | INTEGER | Counter of successive failures |
| `created_at` | TIMESTAMP | Defaults to CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | Updated via trigger |

### Constraints & Indexes
- Primary key on `relay_url`.
- Trigger `trg_nostr_relays_updated` keeps `updated_at` current.
- Indexes on `priority` (descending) and `added_by` for filtering and sorting.

### Migration File
- `electron/sql/migrations/030_clientdata_nostr_relays.sql`

### Related Code
- `electron/utils/NostrLocalDBManager.js` now provides CRUD helpers, category preference storage, resource limit defaults, and relay health tracking using this table.

---

## 2025-10-12: Upload Status Tracking Table (patchbin.db)

### Date
October 12, 2025

### Description
Added `upload_status` table to `patchbin.db` to track which blob files have been uploaded to various cloud storage providers (IPFS, Arweave, ArDrive, etc.).

### Rationale
- **Multi-Provider Support**: Track uploads across multiple storage providers independently
- **Deduplication**: Avoid re-uploading files that are already available
- **Metadata Storage**: Store provider-specific identifiers (CIDs, transaction IDs, file IDs)
- **Audit Trail**: Maintain timestamps of when files were uploaded
- **Extensibility**: Support additional providers without schema changes

### Tables/Columns Affected

**Database**: `patchbin.db`

**New Table**: `upload_status`

**Columns**:
1. `file_name` (TEXT PRIMARY KEY)
   - References blob file name from attachments table
   - Format: pblob_GAMEID_HASH or rblob_GAMEID_HASH
   
2. `uploaded_ipfs` (INTEGER DEFAULT 0)
   - Boolean flag: 1 = uploaded to IPFS, 0 = not uploaded
   
3. `uploaded_arweave` (INTEGER DEFAULT 0)
   - Boolean flag: 1 = uploaded to Arweave, 0 = not uploaded
   
4. `uploaded_ardrive` (INTEGER DEFAULT 0)
   - Boolean flag: 1 = uploaded to ArDrive, 0 = not uploaded
   
5. `ipfs_uploaded_time` (TIMESTAMP NULL)
   - When file was uploaded to IPFS
   
6. `arweave_uploaded_time` (TIMESTAMP NULL)
   - When file was uploaded to Arweave
   
7. `ardrive_uploaded_time` (TIMESTAMP NULL)
   - When file was uploaded to ArDrive
   
8. `ipfs_cid` (TEXT NULL)
   - IPFS Content Identifier (CIDv1)
   
9. `arweave_txid` (TEXT NULL)
   - Arweave transaction ID
   
10. `ardrive_file_id` (TEXT NULL)
    - ArDrive file ID
    
11. `notes` (TEXT NULL)
    - Additional metadata or custom provider info
    
12. `created_time` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
    - When record was created
    
13. `updated_time` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
    - When record was last updated

### Data Type Changes
None - new table

### Constraints
- PRIMARY KEY on `file_name`
- ON CONFLICT(file_name) DO UPDATE support for upsert operations

### Related Scripts
- `list-unuploaded-blobs.js` - Lists files not yet uploaded
- `mark-upload-done.js` - Marks files as uploaded

### Documentation
- `docs/UPLOAD_TRACKING.md` - Complete upload tracking documentation
- Table auto-created by scripts on first run

---

## 2025-01-XX: Contest and Racelevel Columns (Migration 010)

### Date
January XX, 2025

### Description
Added `contest` and `racelevel` columns to the `gameversions` table for enhanced game categorization.

### Rationale
- **Game Categorization**: Support for contest and race level attributes from JSON data
- **Data Extraction**: Extract contest and racelevel from gvjsondata JSON field
- **Query Performance**: Enable filtering and searching by contest and race level

### Tables/Columns Affected

**Database**: `rhdata.db`

**Table**: `gameversions`

**New Columns**:
1. `contest` (VARCHAR(255)): Contest information extracted from JSON data
2. `racelevel` (VARCHAR(255)): Race level information extracted from JSON data

**Indexes Created**:
- `idx_gameversions_contest` on `contest` column
- `idx_gameversions_racelevel` on `racelevel` column

### Data Migration
A separate JavaScript migration script (`011_populate_contest_racelevel_from_json.js`) populates these columns by parsing the `gvjsondata` JSON field.

---

## 2025-01-XX: Skill Rating When Beat (Migration 013)

### Date
January XX, 2025

### Description
Added `user_skill_rating_when_beat` column to `user_game_annotations` and `user_game_version_annotations` tables to track skill level when the game was beaten.

### Rationale
- **Skill Tracking**: Separate skill rating for when the game was beaten vs when it was rated
- **Progress Tracking**: Allows users to track their skill progression

## 2025-01-XX: Rating Comment Columns (Migration 014)

### Date
January XX, 2025

### Description
Added comment text columns for all rating components to `user_game_annotations` and `user_game_version_annotations` tables, allowing users to add optional comments for each rating dimension.

### Rationale
- **Detailed Feedback**: Users can provide context and explanations for their ratings
- **Optional Comments**: Comments are optional and don't interfere with rating-only usage
- **Rating Context**: Helps users remember why they gave specific ratings

### Tables/Columns Affected

**Database**: `clientdata.db`

**Tables**: `user_game_annotations`, `user_game_version_annotations`

**New Columns**:
- `user_review_comment` (TEXT)
- `user_recommendation_comment` (TEXT)
- `user_importance_comment` (TEXT)
- `user_technical_quality_comment` (TEXT)
- `user_gameplay_design_comment` (TEXT)
- `user_originality_comment` (TEXT)
- `user_visual_aesthetics_comment` (TEXT)
- `user_story_comment` (TEXT)
- `user_soundtrack_graphics_comment` (TEXT)

### Data Type Changes
- All comment columns are TEXT type, allowing unlimited length comments
- NULL values are allowed (comments are optional)

---

## 2025-01-XX: Extended Rating Columns (Migration 012)

### Date
January XX, 2025

### Description
Added extended rating columns to `user_game_annotations` and `user_game_version_annotations` tables for detailed game reviews.

### Rationale
- **Detailed Reviews**: Support multiple rating dimensions beyond overall review
- **Comprehensive Feedback**: Allow users to rate games on various aspects
- **Data Analysis**: Enable filtering and analysis by specific rating criteria

### Tables/Columns Affected

**Database**: `clientdata.db`

**Tables**: `user_game_annotations`, `user_game_version_annotations`

**New Columns** (applied to both tables):
1. `user_recommendation_rating` (INTEGER): Recommendation level (0-5)
2. `user_importance_rating` (INTEGER): Importance/influence rating (0-5)
3. `user_technical_quality_rating` (INTEGER): Technical quality rating (0-5)
4. `user_gameplay_design_rating` (INTEGER): Gameplay design rating (0-5)
5. `user_originality_rating` (INTEGER): Originality/creativity rating (0-5)
6. `user_visual_aesthetics_rating` (INTEGER): Visual aesthetics rating (0-5)
7. `user_story_rating` (INTEGER): Story rating (0-5)
8. `user_soundtrack_graphics_rating` (INTEGER): Soundtrack and graphics rating (0-5)

**Constraints**: All rating columns allow NULL or values 0-5

**Indexes Created**: Indexes created on all new rating columns for query performance

---

## 2025-10-12: Local Resource Tracking Fields (Migration 004)

### Date
October 12, 2025

### Description
Added three new columns to the `gameversions` table to support intelligent change detection and versioned ZIP file storage for Phase 2 of updategames.js implementation.

### Rationale
- **Efficiency**: Enable HTTP HEAD requests to check if files changed before downloading (saves bandwidth)
- **Versioning**: Preserve old ZIP file versions when games are updated (zips/GAMEID_VERSION.zip pattern)
- **Deduplication**: Prevent duplicate downloads and storage of identical files
- **Tracking**: Maintain HTTP metadata (ETag, Last-Modified) for accurate change detection

### Tables/Columns Affected

**Table**: `gameversions`

**New Columns**:
1. `local_resource_etag` (VARCHAR 255)
   - Stores HTTP ETag header from download response
   - Used for efficient change detection
   - NULL if server doesn't provide ETag

2. `local_resource_lastmodified` (TIMESTAMP)
   - Stores HTTP Last-Modified header from download response
   - Alternative change detection method
   - NULL if server doesn't provide Last-Modified

3. `local_resource_filename` (VARCHAR 500)
   - Stores local filesystem path where ZIP was saved
   - Format: zips/GAMEID.zip (v1) or zips/GAMEID_VERSION.zip (v2+)
   - Always populated when file is downloaded

**Indexes Created**:
- `idx_gameversions_local_filename` on `local_resource_filename`
- `idx_gameversions_local_etag` on `local_resource_etag`

### Data Type Changes
None - all new columns

### Constraints
None - all columns nullable

### Migration File
`electron/sql/migrations/004_add_local_resource_tracking.sql`

### Computed Columns Classification
These fields are classified as **COMPUTED COLUMNS** and must not be updated from external JSON imports:
- `local_resource_etag`
- `local_resource_lastmodified`
- `local_resource_filename`

Also previously classified as computed:
- `combinedtype` (computed from other fields)
- `gvimport_time` (database auto-generated)
- `version` (database auto-incremented)
- `gvuuid` (database auto-generated)

**Requirement**: Scripts importing JSON data (loaddata.js, updategames.js) must exclude these fields from JSON imports.

### Documentation
- `docs/LOCAL_RESOURCE_TRACKING.md` - Complete feature documentation
- `docs/NEW_UPDATE_SCRIPT_PHASE2_SPEC.md` - Phase 2 specification (updated)
- `docs/GAMEVERSIONS_TABLE_SCHEMA.md` - Updated with new fields

---

## 2025-01-10: Locked Attributes System (Migration 003)

### Date
January 10, 2025

### Description
Added `legacy_type` column and implemented locked attributes system

### Rationale
Allow curators to set manual classifications that persist across version updates without being overwritten by external data imports.

### Tables/Columns Affected

**Table**: `gameversions`

**New Column**:
- `legacy_type` (VARCHAR 255)
  - User-curated type classification
  - Locked attribute - preserved across versions
  - NULL by default, set manually by curators

### Migration File
Manual ALTER TABLE (documented in previous schema changes)

### Documentation
- `docs/LOCKED_ATTRIBUTES.md`
- `docs/GV_LOCKED_ATTRIBUTES_IMPLEMENTATION.md`

---

## 2025-01-10: Combined Type Field (Migration 002)

### Date
January 10, 2025

### Description
Added `combinedtype` computed column that combines all type and difficulty fields into a single human-readable string.

### Rationale
- Simplify display of complete type/difficulty information
- Enable efficient filtering by combined classification
- Support search across all type indicators in single field

### Tables/Columns Affected

**Table**: `gameversions`

**New Column**:
- `combinedtype` (VARCHAR 255)
  - Computed from: fields_type, difficulty, raw_difficulty, raw_fields.type
  - Format: "[fields_type]: [difficulty] (raw_difficulty) (raw_fields.type)"
  - Example: "Kaizo: Advanced (diff_4) (kaizo)"

**Index Created**:
- `idx_gameversions_combinedtype` on `combinedtype`

### Migration File
`electron/sql/migrations/002_add_combinedtype.sql`

### Backfill
`electron/sql/migrations/003_backfill_combinedtype.js` - Backfilled 2,913 existing records

### Documentation
- `docs/GV_COMBINEDTYPE_UPDATE.md`
- `docs/MIGRATION_003_BACKFILL_COMBINEDTYPE.md`

---

## 2025-01-10: New Schema Fields Support (Migration 001)

### Date
January 10, 2025

### Description
Added support for new JSON schema format from SMWC with nested type and difficulty fields.

### Rationale
- Support new JSON schema from external data sources
- Extract more granular type/difficulty information
- Maintain backward compatibility with old format

### Tables/Columns Affected

**Table**: `gameversions`

**New Columns**:
1. `fields_type` (VARCHAR 255)
   - Extracted from `fields.type` in new JSON format
   - More specific type classification
   - NULL for old format data

2. `raw_difficulty` (VARCHAR 255)
   - Extracted from `raw_fields.difficulty`
   - Raw difficulty code (diff_1 through diff_6)
   - NULL for old format data

**Indexes Created**:
- `idx_gameversions_fields_type` on `fields_type`
- `idx_gameversions_raw_difficulty` on `raw_difficulty`

### Data Type Changes
None - all new columns

### Migration File
`electron/sql/migrations/001_add_fields_type_raw_difficulty.sql`

### Code Changes
- Updated `loaddata.js` with field extraction logic
- Added boolean normalization (true→"1", false→"0")

### Documentation
- `docs/GV_SCHEMA_UPDATE_SUMMARY.md`
- `docs/GV_BUGFIX_LOADDATA.md`

---

## Original Schema (Pre-2025)

### Description
Initial `gameversions` table with core fields for game metadata, authorship, difficulty, and patch references.

### Core Fields
- gvuuid (primary key)
- gameid, version (unique constraint)
- name, author, authors
- gametype, difficulty
- description, tags
- download_url, url
- patchblob1_name, pat_sha224
- gvjsondata (full JSON backup)
- gvimport_time

### Documentation
- Original `electron/sql/rhdata.sql`

---

## Summary of All Schema Changes

| Date | Migration | Changes | Reason |
|------|-----------|---------|--------|
| Pre-2025 | Initial | Original schema | Core functionality |
| 2025-01-10 | 001 | fields_type, raw_difficulty | New JSON schema support |
| 2025-01-10 | 002 | combinedtype | Computed type display |
| 2025-01-10 | 003 | legacy_type | Locked attributes |
| 2025-10-12 | 004 | local_resource_* (3 fields) | Resource tracking & versioning |

**Total New Columns**: 7  
**Total New Indexes**: 6  
**Migrations Created**: 4  
**Backfill Scripts**: 1

---

## Migration Status

| Migration | File | Status | Records Affected |
|-----------|------|--------|------------------|
| 001 | 001_add_fields_type_raw_difficulty.sql | ✅ Complete | All (nullable) |
| 002 | 002_add_combinedtype.sql | ✅ Complete | All (nullable) |
| 003 | 003_backfill_combinedtype.js | ✅ Complete | 2,913 backfilled |
| 004 | 004_add_local_resource_tracking.sql | ✅ Ready | N/A (new feature) |

---

## Applying Migrations

### Complete Migration Sequence

```bash
# From project root
cd /home/main/proj/rhtools

# 001: New schema fields
sqlite3 electron/rhdata.db < electron/sql/migrations/001_add_fields_type_raw_difficulty.sql

# 002: Combined type
sqlite3 electron/rhdata.db < electron/sql/migrations/002_add_combinedtype.sql

# 003: Backfill combinedtype (optional, for existing data)
node electron/sql/migrations/003_backfill_combinedtype.js

# 004: Local resource tracking
sqlite3 electron/rhdata.db < electron/sql/migrations/004_add_local_resource_tracking.sql
```

### Verification

```bash
# Check schema
sqlite3 electron/rhdata.db "PRAGMA table_info(gameversions);" | grep -E "fields_type|raw_difficulty|combinedtype|legacy_type|local_resource"

# Expected output shows all 7 new columns:
# 34|fields_type|VARCHAR(255)|0||0
# 35|legacy_type|VARCHAR(255)|0||0
# 36|raw_difficulty|VARCHAR(255)|0||0
# 37|combinedtype|VARCHAR(255)|0||0
# 38|local_resource_etag|VARCHAR(255)|0||0
# 39|local_resource_lastmodified|TIMESTAMP|0||0
# 40|local_resource_filename|VARCHAR(500)|0||0
```

---

## Related Documentation

- **Schema Reference**: `docs/GAMEVERSIONS_TABLE_SCHEMA.md` - Complete field documentation
- **Locked Attributes**: `docs/LOCKED_ATTRIBUTES.md` - Locked attributes guide
- **Resource Tracking**: `docs/LOCAL_RESOURCE_TRACKING.md` - local_resource_* fields guide
- **Phase 2 Spec**: `docs/NEW_UPDATE_SCRIPT_PHASE2_SPEC.md` - Change detection specification

---

## 2025-10-12: User Annotations Tables (clientdata.db)

### Date
October 12, 2025

### Description
Added three new tables to `clientdata.db` for storing user-specific annotations for games and stages, including ratings, status tracking, notes, and stage metadata.

### Rationale
- **User Privacy**: Each user maintains their own ratings and notes in their local clientdata.db
- **Stage-Level Tracking**: Support per-stage ratings and notes for games with documented stages
- **Progress Tracking**: Track game completion status (Default/In Progress/Finished)
- **Flexible Organization**: Hidden flag for organizing personal game library
- **Rating System**: 1-5 difficulty rating scale at both game and stage level

### Tables/Columns Affected

**Database**: `clientdata.db`

#### New Table: `user_game_annotations`

**Purpose**: Store user-specific data for each game

**Columns**:
1. `gameid` (VARCHAR 255 PRIMARY KEY)
   - References gameid from rhdata.db gameversions table
   
2. `status` (VARCHAR 50 DEFAULT 'Default')
   - User's progress status: 'Default', 'In Progress', 'Finished'
   
3. `user_rating` (INTEGER)
   - User's personal difficulty rating (1-5 scale)
   - NULL if not rated
   - CHECK constraint: (user_rating IS NULL OR (user_rating >= 1 AND user_rating <= 5))
   
4. `hidden` (INTEGER DEFAULT 0)
   - Boolean flag: 0 = visible, 1 = hidden from main list
   
5. `user_notes` (TEXT)
   - User's personal notes about the game
   
6. `created_at` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
   - When annotation was created
   
7. `updated_at` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
   - When annotation was last modified

**Indexes**:
- `idx_user_game_status` ON status
- `idx_user_game_hidden` ON hidden
- `idx_user_game_rating` ON user_rating

**Triggers**:
- `trigger_user_game_updated` - Auto-updates updated_at on modification

#### New Table: `game_stages`

**Purpose**: Store stage/exit metadata for games

**Columns**:
1. `stage_key` (VARCHAR 510 PRIMARY KEY)
   - Format: "gameid-exitnumber" (e.g., "12345-01")
   
2. `gameid` (VARCHAR 255 NOT NULL)
   - References the game
   
3. `exit_number` (VARCHAR 255 NOT NULL)
   - Stage/exit number (e.g., "0x01", "1", "105")
   
4. `description` (TEXT)
   - Stage description/name
   
5. `public_rating` (DECIMAL(3,2))
   - Community average rating for this stage
   
6. `created_at` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
7. `updated_at` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)

**Indexes**:
- `idx_game_stages_gameid` ON gameid
- `idx_game_stages_exit` ON exit_number

**Constraints**:
- UNIQUE(gameid, exit_number)

**Triggers**:
- `trigger_game_stages_updated` - Auto-updates updated_at on modification

#### New Table: `user_stage_annotations`

**Purpose**: Store user-specific annotations for individual stages

**Columns**:
1. `stage_key` (VARCHAR 510 PRIMARY KEY)
   - Format: "gameid-exitnumber"
   
2. `gameid` (VARCHAR 255 NOT NULL)
   - References the game
   
3. `exit_number` (VARCHAR 255 NOT NULL)
   - References the specific stage
   
4. `user_rating` (INTEGER)
   - User's personal difficulty rating for this stage (1-5)
   - NULL if not rated
   - CHECK constraint: (user_rating IS NULL OR (user_rating >= 1 AND user_rating <= 5))
   
5. `user_notes` (TEXT)
   - User's personal notes about this stage
   
6. `created_at` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
7. `updated_at` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)

**Indexes**:
- `idx_user_stage_gameid` ON gameid
- `idx_user_stage_rating` ON user_rating

**Constraints**:
- UNIQUE(gameid, exit_number)

**Triggers**:
- `trigger_user_stage_updated` - Auto-updates updated_at on modification

#### New Views

**v_games_with_annotations**:
- Convenience view for querying games with user annotations
- Includes all fields from user_game_annotations
- Uses COALESCE for default values

**v_stages_with_annotations**:
- Convenience view joining game_stages with user_stage_annotations
- Shows both stage metadata and user annotations
- LEFT JOIN preserves stages without user annotations

### Data Type Changes
None - all new tables

### Migration File
`electron/sql/migrations/001_clientdata_user_annotations.sql`

### Related Files Updated
- `electron/sql/clientdata.sql` - Updated with new schema for fresh installs

### Usage Notes

**Rating Scale**: 1-5 where:
- 1 = Very Easy
- 2 = Easy  
- 3 = Normal
- 4 = Hard
- 5 = Very Hard
- NULL = Not rated

**Status Values**:
- 'Default' - Not started or no status set
- 'In Progress' - Currently playing
- 'Finished' - Completed

**Stage Keys**: Format is "gameid-exitnumber"
- Examples: "12345-01", "9999-0xFF", "test-105"
- Ensures unique identification across games

**Important**: 
- Not all games have documented stages - the stage tables are optional
- Each user should have their own clientdata.db
- This database should NOT be synced or shared between users
- Scripts should support CLIENTDATA_DB_PATH environment variable

### Documentation
- Migration script: `electron/sql/migrations/001_clientdata_user_annotations.sql`
- Commands: `docs/DBMIGRATE.md` (updated)
- This file: `docs/SCHEMACHANGES.md` (this entry)

---

## 2025-10-12: Enhanced Ratings and Run System (clientdata.db - Migration 002)

### Date
October 12, 2025

### Description
Major enhancement adding dual rating system (difficulty + review), version-specific annotations, random exclusion controls, and complete run system for planning and executing challenge runs.

### Rationale
- **Dual Ratings**: Users need to rate both difficulty AND quality/recommendation separately
- **Version-Specific**: Different game versions may warrant different ratings
- **Random Exclusion**: Users and curators need control over random game selection
- **Run System**: Support planned challenge runs with timing and tracking

### Tables/Columns Affected

**Database**: `clientdata.db`

#### Enhanced Table: user_game_annotations

**New Columns**:
1. `user_difficulty_rating` (INTEGER 1-5 or NULL)
   - Replaces/augments user_rating
   - How hard the user finds the game
   
2. `user_review_rating` (INTEGER 1-5 or NULL)
   - NEW: How much user recommends the game
   - 1=Not Recommended, 5=Highly Recommended
   
3. `exclude_from_random` (INTEGER DEFAULT 0)
   - User flag to exclude from random selection
   - 0=eligible, 1=excluded

**Note**: `user_rating` kept for backwards compatibility

#### New Table: user_game_version_annotations

**Purpose**: Store version-specific ratings that override game-wide ratings

**Columns**:
1. `annotation_key` (VARCHAR 510 PRIMARY KEY) - "gameid-version"
2. `gameid` (VARCHAR 255)
3. `version` (INTEGER)
4. `user_difficulty_rating` (INTEGER 1-5 or NULL)
5. `user_review_rating` (INTEGER 1-5 or NULL)
6. `status` (VARCHAR 50) - Override game-wide status
7. `user_notes` (TEXT)
8. `created_at`, `updated_at` (TIMESTAMP)

**Indexes**:
- `idx_user_gv_gameid` ON gameid
- `idx_user_gv_version` ON version
- `idx_user_gv_status` ON status

**Constraints**:
- UNIQUE(gameid, version)

**Triggers**:
- `trigger_user_game_version_updated` - Auto-updates updated_at

#### Enhanced Table: user_stage_annotations

**New Columns**:
1. `user_difficulty_rating` (INTEGER 1-5 or NULL)
2. `user_review_rating` (INTEGER 1-5 or NULL)

#### New Table: runs

**Purpose**: Store planned and executed challenge runs

**Columns**:
1. `run_uuid` (VARCHAR 255 PRIMARY KEY)
2. `run_name` (VARCHAR 255)
3. `run_description` (TEXT)
4. `status` (VARCHAR 50) - 'preparing', 'active', 'completed', 'cancelled'
5. `created_at`, `started_at`, `completed_at`, `updated_at` (TIMESTAMP)
6. `total_challenges`, `completed_challenges`, `skipped_challenges` (INTEGER)
7. `config_json` (TEXT)

**Indexes**:
- `idx_runs_status` ON status
- `idx_runs_created` ON created_at

#### New Table: run_plan_entries

**Purpose**: Store planned challenges in a run

**Columns**:
1. `entry_uuid` (VARCHAR 255 PRIMARY KEY)
2. `run_uuid` (VARCHAR 255) - References runs
3. `sequence_number` (INTEGER)
4. `entry_type` (VARCHAR 50) - 'game', 'stage', 'random_game', 'random_stage'
5. `gameid`, `exit_number` (VARCHAR 255) - For specific challenges
6. `count` (INTEGER) - Repeat count
7. `filter_difficulty`, `filter_type`, `filter_pattern`, `filter_seed` (VARCHAR 255) - For random
8. `entry_notes` (TEXT)
9. `created_at` (TIMESTAMP)

**Indexes**:
- `idx_run_plan_run` ON run_uuid
- `idx_run_plan_sequence` ON (run_uuid, sequence_number)
- `idx_run_plan_type` ON entry_type

**Constraints**:
- UNIQUE(run_uuid, sequence_number)

#### New Table: run_results

**Purpose**: Store actual execution results (expanded from plan)

**Columns**:
1. `result_uuid` (VARCHAR 255 PRIMARY KEY)
2. `run_uuid` (VARCHAR 255) - References runs
3. `plan_entry_uuid` (VARCHAR 255) - References run_plan_entries
4. `sequence_number` (INTEGER)
5. `gameid`, `game_name`, `exit_number`, `stage_description` (VARCHAR 255)
6. `was_random`, `revealed_early` (BOOLEAN)
7. `status` (VARCHAR 50) - 'pending', 'success', 'ok', 'skipped', 'failed'
8. `started_at`, `completed_at` (TIMESTAMP)
9. `duration_seconds` (INTEGER)
10. `result_notes` (TEXT)

**Indexes**:
- `idx_run_results_run` ON run_uuid
- `idx_run_results_sequence` ON (run_uuid, sequence_number)
- `idx_run_results_status` ON status
- `idx_run_results_game` ON gameid

**Constraints**:
- UNIQUE(run_uuid, sequence_number)

#### New Table: run_archive

**Purpose**: Archive metadata for completed runs

**Columns**:
1. `archive_uuid` (VARCHAR 255 PRIMARY KEY)
2. `run_uuid` (VARCHAR 255) - References runs
3. `archived_at` (TIMESTAMP)
4. `archive_notes` (TEXT)
5. `total_time_seconds` (INTEGER)
6. `success_rate` (DECIMAL 5,2)

**Indexes**:
- `idx_run_archive_date` ON archived_at

**Constraints**:
- UNIQUE(run_uuid)

#### Updated Views

**v_games_with_annotations** - Now includes:
- user_difficulty_rating
- user_review_rating
- exclude_from_random

**v_stages_with_annotations** - Now includes:
- user_difficulty_rating
- user_review_rating

**New Views**:
- `v_active_run` - Current active run summary
- `v_run_progress` - Current run progress details

### Migration File
`electron/sql/migrations/002_clientdata_enhanced_ratings_and_runs.sql`

---

## 2025-10-12: Local Run Exclusion (rhdata.db - Migration 005)

### Date
October 12, 2025

### Description
Added curator-controlled flag to exclude games from random selection in rhdata.db gameversions table.

### Rationale
Curators need ability to exclude games from random selection (broken games, inappropriate content, duplicates, etc.) independent of user preferences.

### Tables/Columns Affected

**Database**: `rhdata.db`

**Table**: `gameversions`

**New Column**:
1. `local_runexcluded` (INTEGER DEFAULT 0)
   - Curator-controlled exclusion from random selection
   - 0=eligible, 1=excluded
   - This is a **COMPUTED COLUMN** - do not import from JSON

**Indexes**:
- `idx_gameversions_runexcluded` ON local_runexcluded

### Migration File
`electron/sql/migrations/005_add_local_runexcluded.sql`

### Important
This field is classified as a **COMPUTED COLUMN** along with:
- combinedtype
- gvimport_time
- version
- gvuuid
- local_resource_etag
- local_resource_lastmodified
- local_resource_filename

Scripts importing JSON data must exclude these fields.

---

## 2025-01-XX: Admin Keypair Profile UUID (Migration 018)

### Date
January XX, 2025

### Description
Added `profile_uuid` column to the `admin_keypairs` table to distinguish between global admin keypairs (NULL) and User Op keys (bound to a specific profile).

### Rationale
- **Conceptual Separation**: Distinguish between system-wide admin keypairs and profile-specific admin keypairs (User Op keys)
- **Profile Binding**: Allow admin keypairs to be bound to specific user profiles
- **Query Efficiency**: Enable efficient filtering by profile UUID
- **Terminology**: "User Op Keys" are admin keypairs bound to a specific profile, while "Global Admin Keypairs" are system-wide

### Tables/Columns Affected

**Database**: `clientdata.db`

**Table**: `admin_keypairs`

**New Column**:
- `profile_uuid` (TEXT): UUID of the profile that owns this keypair, or NULL for global admin keypairs

**Index Created**:
- `idx_admin_keypairs_profile_uuid` on `profile_uuid` column

### Data Type Changes
- New nullable TEXT column
- NULL indicates global admin keypair
- Non-NULL value indicates User Op key bound to that profile

### Constraints
- No foreign key constraint (allows NULL for global admin keypairs)
- Index created for efficient profile-based queries

### Related Code Changes
- `online:admin-keypairs:list` IPC handler now filters to only return global admin keypairs (`WHERE profile_uuid IS NULL`)
- `online:admin-keypair:create` and `online:admin-keypair:add` set `profile_uuid` to NULL for global admin keypairs
- Future IPC handlers will support creating User Op keys with `profile_uuid` set to the profile's UUID

### Terminology
- **Global Admin Keypairs**: System-wide admin keypairs with `profile_uuid IS NULL`
- **User Op Keys**: Admin keypairs bound to a specific profile with `profile_uuid = <profile UUID>`

---

*Last Updated: January 2025*  
*Next Migration: TBD*


## 2025-10-12: Fix run_results gameid NULL Constraint (clientdata.db - Migration 004)

### Date
October 12, 2025

### Description
Fixed the `run_results.gameid` column to allow NULL values for unresolved random challenges. Previously, the column had a NOT NULL constraint which caused failures when creating runs with random game/stage challenges that haven't been resolved yet.

### Rationale
- **Support Random Challenges**: Random game/stage challenges don't have a gameid until they are resolved at runtime
- **Database Integrity**: Allows proper storage of pending random challenges
- **Flexibility**: Permits name masking ("???") until challenge is attempted
- **Consistency**: Aligns with run system design where random selections are resolved lazily

### Tables/Columns Affected

**Database**: `clientdata.db`

**Modified Table**: `run_results`

**Column Changed**:
- `gameid VARCHAR(255)` - Changed from `NOT NULL` to nullable
  - NULL value indicates an unresolved random challenge
  - Non-NULL value indicates a specific or resolved challenge

**Impact**:
- Random game/stage challenges can now be properly stored in the database
- `game_name` field stores "???" for masked/unresolved challenges
- `was_random` flag indicates if challenge was randomly selected
- `revealed_early` flag tracks if name was revealed before attempt

### Data Type Changes
No data type changes, only constraint modification (removed NOT NULL).

### Migration Script
`electron/sql/migrations/004_clientdata_fix_run_results_gameid.sql`

**Method**: Table recreation (required for SQLite constraint changes)
1. Backup existing data
2. Drop old table
3. Create new table with nullable gameid
4. Restore data
5. Recreate indexes

**Safety**: Data is preserved via backup table during migration.

---



## 2025-10-12: Seed Mappings Table (clientdata.db - Migration 006)

### Date
October 12, 2025

### Description
Added `seedmappings` table to support deterministic random game selection across different installations. This enables reproducible random challenges for competitive runs and run sharing.

### Rationale
- **Reproducibility**: Same seed should select same games across different player installations
- **Competitive Support**: Enable fair races with identical random challenges
- **Game Snapshot**: Freeze available games at specific point in time
- **Import/Export**: Share runs with seed compatibility validation
- **Custom Challenges**: Allow players to create custom game lists for random selection

### Tables/Columns Affected

**Database**: `clientdata.db`

**New Table**: `seedmappings`

**Columns**:
1. `mapid` (VARCHAR(20) PRIMARY KEY) - Mapping identifier (first 5 chars of seed, e.g., "A7K9M")
2. `mappingdata` (TEXT NOT NULL) - JSON object mapping gameid to version for all candidate games
3. `game_count` (INTEGER NOT NULL) - Number of games in this mapping
4. `mapping_hash` (VARCHAR(64)) - SHA-256 hash of mappingdata for verification
5. `created_at` (TIMESTAMP) - When mapping was created
6. `description` (TEXT) - Optional description

**Indexes**:
- `idx_seedmappings_count` ON game_count DESC (find largest mapping)
- `idx_seedmappings_created` ON created_at DESC (find newest mapping)

### Data Type Changes
None - new table only.

### Impact
- Enables deterministic random game selection
- Seeds have format: "MAPID-SUFFIX" (e.g., "A7K9M-XyZ3q")
- Same seed + same mapping = same game selections
- Import validation ensures compatibility
- Players can share runs and compete fairly

### Migration Script
`electron/sql/migrations/006_clientdata_seed_mappings.sql`

### Related Systems
- Run system: random_game and random_stage entry types
- Export/Import: Run sharing with seed compatibility
- Random selection: Deterministic algorithm using seed + challenge index

---

## 2025-10-14: SNES Contents Cache (clientdata.db - Migration 008)

### Date
October 14, 2025

### Description
Added `snes_contents` table to cache files present on SNES device (SD2SNES) for quick launch access and management.

### Rationale
- **Quick Launch**: Provide fast access to recently uploaded games
- **File Management**: Track which files are on the SNES device
- **Metadata Linking**: Associate SNES files with game database entries
- **User Organization**: Pin, dismiss, or mark files as finished
- **Auto-Sync**: Automatically update cache after uploads
- **Cleanup Tracking**: Remove entries for files deleted from device

### Tables/Columns Affected

**Database**: `clientdata.db`

**New Table**: `snes_contents`

**Columns**:
1. `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
   - Unique identifier for each file entry
   
2. `filename` (TEXT NOT NULL)
   - Just the filename (e.g., "smw12345_1.sfc")
   
3. `fullpath` (TEXT NOT NULL UNIQUE)
   - Full path on SNES (e.g., "/work/smw12345_1.sfc")
   - UNIQUE constraint ensures no duplicates
   
4. `gameid` (TEXT)
   - Game ID if known (extracted from filename or provided on upload)
   - NULL for unknown/non-game files
   
5. `version` (INTEGER)
   - Game version if known
   - NULL for unknown files
   
6. `gamename` (TEXT)
   - Human-readable game name from database
   - NULL for unknown files
   
7. `gametype` (TEXT)
   - Game type/category from database
   - NULL for unknown files
   
8. `difficulty` (TEXT)
   - Public difficulty rating from database
   - NULL for unknown files
   
9. `combinedtype` (TEXT)
   - Combined type classification from database
   - NULL for unknown files
   
10. `part_of_a_run` (INTEGER DEFAULT 0)
    - Boolean: Was this file uploaded as part of a challenge run
    - 0=standalone, 1=part of run
    
11. `launched_yet` (INTEGER DEFAULT 0)
    - Boolean: Has user launched this file on SNES
    - Helps track which games have been played
    
12. `dismissed` (INTEGER DEFAULT 0)
    - Boolean: User dismissed this from quick launch list
    - Hidden by default unless "Show All" enabled
    
13. `pinned` (INTEGER DEFAULT 0)
    - Boolean: Pinned to top of list
    - Pinned files always shown first
    
14. `finished` (INTEGER DEFAULT 0)
    - Boolean: User marked as finished/completed
    - For progress tracking
    
15. `upload_timestamp` (INTEGER)
    - Unix timestamp when file was uploaded
    - NULL for files detected but not uploaded by us
    
16. `detected_timestamp` (INTEGER)
    - Unix timestamp when file was first detected
    - Auto-set on insert
    
17. `last_seen_timestamp` (INTEGER)
    - Unix timestamp when file was last seen during sync
    - Updated on every sync
    
18. `created_at` (INTEGER)
    - Record creation timestamp
    
19. `updated_at` (INTEGER)
    - Record last update timestamp

**Indexes**:
- `idx_snes_contents_upload_timestamp` ON upload_timestamp DESC
- `idx_snes_contents_pinned_dismissed` ON (pinned DESC, dismissed ASC, upload_timestamp DESC)
- `idx_snes_contents_gameid` ON gameid
- `idx_snes_contents_fullpath` ON fullpath

### Auto-Sync Behavior

**When files are uploaded:**
1. Upload completes successfully
2. System lists /work/ directory on SNES
3. Compares with cache to find:
   - New files → Insert into cache
   - Missing files → Delete from cache
   - Existing files → Update last_seen_timestamp
4. Uploaded file gets full metadata populated
5. Re-uploading same file resets dismissed=0

**File Detection:**
- Only .sfc files are tracked
- Files detected on device (not uploaded by us) have:
  - NULL upload_timestamp
  - No game metadata
  - Shown last in list

### UI Integration

**SNES Files Dropdown** (📁 button in toolbar):
- Shows files sorted by: pinned → uploaded → detected
- Each file shows:
  - Filename
  - Game name (if known) or "Unknown file"
  - Upload timestamp
  - Pin indicator (📌)
  
**Actions**:
- 🚀 Launch - Boot file on SNES, mark launched_yet=1
- 📌 Pin - Toggle pinned status (pinned files at top)
- ✖ Dismiss - Hide from default view (dismissed=1)
- 🔍 Find Game - Select game in main list (if gameid known)

**Show All Checkbox**:
- Unchecked: Hide dismissed files (default)
- Checked: Show all files including dismissed

### Migration File
`electron/sql/migrations/008_clientdata_snes_contents_cache.sql`

### Related Files
- `electron/main/SnesContentsManager.js` - Cache management logic
- `electron/renderer/src/App.vue` - UI implementation
- `electron/ipc-handlers.js` - IPC handlers for cache operations

### IPC Channels
- `snesContents:sync` - Sync cache with SNES device
- `snesContents:getList` - Get file list for display
- `snesContents:updateStatus` - Update file flags
- `snesContents:delete` - Remove file from cache

### Benefits
- ✅ Quick access to recently uploaded games
- ✅ One-click launch from dropdown
- ✅ No searching through folders
- ✅ Track which games you've played
- ✅ Pin favorites to top
- ✅ Dismiss completed games
- ✅ Link files back to game database
- ✅ Auto-cleanup when files deleted from device

---

## 2025-10-26: Run Results SNES File Path Tracking (clientdata.db)

### Date
October 26, 2025

### Description
Added `sfcpath` column to `run_results` table in `clientdata.db` to track the USB2SNES file path for each game in a run, enabling direct launch buttons during run execution.

### Rationale
- **USB2SNES Integration**: When a run is uploaded to USB2SNES, files are placed in subdirectories like `/work/run251025_2307/` instead of directly in `/work/`
- **Launch Functionality**: Store the relative path (e.g., `run251025_2307/02.sfc`) so the UI can show "Launch" buttons for each challenge
- **File Organization**: Support better file organization on the SNES device with run-specific folders
- **Persistence**: Path survives app restarts when resuming runs

### Tables/Columns Affected

**Database**: `clientdata.db`

**Table**: `run_results`

**New Column**:
- `sfcpath` (TEXT NULL)
  - Relative path to the SFC file on USB2SNES device
  - Format: `runYYMMDD_HHMM/filename.sfc` (e.g., `run251025_2307/02.sfc`)
  - NULL if run hasn't been uploaded to USB2SNES yet
  - Updated when "Upload to USB2SNES" is clicked in staging success dialog

### Data Type Changes
None (new column only)

### Migration Command
```sql
ALTER TABLE run_results ADD COLUMN sfcpath TEXT NULL;
```

---

## 2025-02-XX: Admin Keypairs Nostr Publishing Fields (clientdata.db)

### Date
February 2025

### Description
Added `nostr_event_id` and `nostr_status` columns to the `admin_keypairs` table to support publishing admin keypair records as Nostr events.

### Rationale
- **Nostr Publishing**: Track which admin keypairs have been published to the Nostr network
- **Event Tracking**: Store the Nostr event ID for each published keypair
- **Status Management**: Track publishing status (pending, published, failed, retrying)
- **Network Distribution**: Enable distribution of admin keypair metadata via Nostr relays

### Tables/Columns Affected

**Database**: `clientdata.db`

**Table**: `admin_keypairs`

**New Columns**:
1. `nostr_event_id` (VARCHAR(64) NULL)
   - Stores the Nostr event ID when a keypair is published
   - NULL if not yet published
   - Indexed for efficient lookups

2. `nostr_status` (VARCHAR(50) DEFAULT 'pending')
   - Publishing status: 'pending', 'published', 'failed', 'retrying'
   - Defaults to 'pending' for existing records
   - Indexed for efficient status queries

### Data Type Changes
- New nullable columns added
- Existing records have `nostr_status = 'pending'` and `nostr_event_id = NULL`

### Migration Command
```sql
ALTER TABLE admin_keypairs ADD COLUMN nostr_event_id VARCHAR(64);
ALTER TABLE admin_keypairs ADD COLUMN nostr_status VARCHAR(50) DEFAULT 'pending';
CREATE INDEX IF NOT EXISTS idx_admin_keypairs_nostr_event_id ON admin_keypairs(nostr_event_id);
CREATE INDEX IF NOT EXISTS idx_admin_keypairs_nostr_status ON admin_keypairs(nostr_status);
```

---

## 2025-11-07: Ratings Database (ratings.db)

### Date
November 7, 2025

### Description
Introduced a dedicated `ratings.db` SQLite database to store incoming Nostr rating (kind 31001) events and aggregated summaries. The database captures per-rater ratingcards and maintains summary statistics for each game across different trust tiers.

### Rationale
- **Decoupled storage**: Keep crowd-sourced ratings separate from core client data tables while retaining the ability to republish ratings.
- **Aggregation support**: Provide pre-computed averages/medians/stddevs per rating dimension to power public rating displays.
- **Trust segmentation**: Track ratings by unverified, fully verified, and highly trusted raters to support future moderation workflows.

### Tables/Columns Affected

**Database**: `ratings.db`

**New Table**: `rating_events`
- `rater_pubkey` (TEXT, part of PK)
- `gameid` (TEXT, part of PK)
- `gvuuid` (TEXT)
- `version` (INTEGER)
- `status` (TEXT)
- `rating_json` (TEXT)
- `user_notes` (TEXT)
- `overall_rating` (REAL)
- `difficulty_rating` (REAL)
- `created_at_ts` (INTEGER)
- `updated_at_ts` (INTEGER)
- `published_at` (INTEGER)
- `received_at` (INTEGER)
- `trust_level` (INTEGER)
- `trust_tier` (TEXT)
- `event_id` (TEXT)
- `signature` (TEXT)
- `tags_json` (TEXT)

**New Table**: `rating_summaries`
- `gameid` (TEXT, part of PK)
- `rating_category` (TEXT, part of PK)
- `trust_tier` (TEXT, part of PK)
- `rating_count` (INTEGER)
- `rating_average` (REAL)
- `rating_median` (REAL)
- `rating_stddev` (REAL)
- `updated_at` (INTEGER)

**New Table**: `trust_assignments`
- `assignment_id` (INTEGER, PK)
- `pubkey` (TEXT)
- `assigned_trust_level` (INTEGER)
- `trust_limit` (INTEGER)
- `assigned_by_pubkey` (TEXT)
- `assigned_by_trust_level` (INTEGER)
- `scope` (TEXT)
- `source` (TEXT)
- `reason` (TEXT)
- `expires_at` (INTEGER)
- `created_at` (INTEGER)

**Indexes**
- `idx_rating_events_gameid`
- `idx_rating_events_trust_tier`
- `idx_rating_events_event_id`
- `idx_rating_summaries_gameid`
- `idx_trust_assignments_pubkey`
- `idx_trust_assignments_assigned_by`

### Migration File
- `electron/sql/ratings.sql`

### Related Code
- `electron/main/NostrRuntimeService.js` now ingests kind 31001 events into `rating_events`, maintains `trust_assignments`-aware trust levels, and updates `rating_summaries` after each publication.

---

## 2025-11-07: Moderation Database (moderation.db)

### Date
November 7, 2025

### Description
Created `moderation.db` to store moderator/admin actions (blocks, freezes, warnings) and associated audit logs.

### Rationale
- **Persistent moderation**: Ensure moderation directives (e.g., user blocks, channel freezes) can be enforced across clients and persisted for auditing.
- **Auditability**: Track creation, revocation, and expiration events for each moderation action.
- **Integration**: Provide a central data source that `PermissionHelper`/`ModerationManager` can read from when evaluating scope and permissions.

### Tables/Columns Affected

**Database**: `moderation.db`

**New Table**: `moderation_actions`
- `action_id` (TEXT, PK)
- `action_type` (TEXT)
- `target_type` (TEXT)
- `target_identifier` (TEXT)
- `scope_type` (TEXT)
- `scope_identifier` (TEXT)
- `content_json` (TEXT)
- `reason` (TEXT)
- `issued_by_pubkey` (TEXT)
- `issued_by_trust_level` (INTEGER)
- `issued_at` (INTEGER)
- `expires_at` (INTEGER)
- `trust_level` (INTEGER)
- `trust_tier` (TEXT)
- `event_id` (TEXT)
- `signature` (TEXT)
- `status` (TEXT)
- `revoked_by_pubkey` (TEXT)
- `revoked_at` (INTEGER)

**New Table**: `moderation_logs`
- `log_id` (INTEGER, PK)
- `action_id` (TEXT)
- `log_type` (TEXT)
- `details_json` (TEXT)
- `created_at` (INTEGER)

### Indexes
- `idx_moderation_actions_target`
- `idx_moderation_actions_status`
- `idx_moderation_actions_event_id`
- `idx_moderation_logs_action_id`

### Migration File
- `electron/sql/moderation.sql`

### Related Code
- `electron/utils/PermissionHelper.js` and upcoming moderation IPC handlers rely on this schema for enforcing scope-aware moderation.

---

## 2025-11-08: Admin Declaration Target Hex Column

### Date
November 8, 2025

### Description
Added `target_keypair_public_hex` column to the `admindeclarations` table so trust declarations explicitly store the subject’s hex-encoded public key in addition to the canonical name and fingerprint fields.

### Rationale
- Trust declarations were previously only capturing a local UUID and optional fingerprint, making it impossible to reliably match declarations to subject keys across machines.
- Storing the canonical name (`npub…`) plus the raw hex public key guarantees deterministic matching for Nostr keys (and can be extended to other key types).

### Tables/Columns Affected

**Database**: `clientdata.db`

**Updated Table**: `admindeclarations`
- Added column `target_keypair_public_hex VARCHAR(128)` (nullable).
- Existing rows are backfilled where `target_keypair_fingerprint` already contained a 64-character hex string.

### Migration File
- `electron/sql/migrations/031_clientdata_admindeclarations_target_hex.sql`

### Related Code
- `electron/ipc-handlers.js` (`online:admin-declaration:save`) now persists canonical name and hex for targets.
- `electron/renderer/src/App.vue` trust declaration wizard populates canonical/hex fields for local profiles, selected keypairs, and manually entered Nostr keys.

---

