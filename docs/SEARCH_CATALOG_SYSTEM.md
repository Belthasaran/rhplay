# Search Catalog System - Complete Documentation

**Version**: 1.0  
**Last Updated**: December 2025  
**Purpose**: Comprehensive documentation for the SMW hack search catalog system

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Stage 1: Ingest and Normalize](#stage-1-ingest-and-normalize)
4. [Stage 2: Entity Resolution and Grouping](#stage-2-entity-resolution-and-grouping)
5. [Search Tool](#search-tool)
6. [Database Schema](#database-schema)
7. [Usage Examples](#usage-examples)
8. [Workflow](#workflow)

---

## Overview

The Search Catalog System provides a fast, efficient way to search through ~29,000 SMW ROM hack master JSON files without unpacking gigabytes of data. The system:

- **Ingests** all master JSON files and normalizes them into a compact database
- **Groups** related hacks (versions, same author, series) using deterministic and probabilistic methods
- **Indexes** content for fast full-text search using SQLite FTS5
- **Packages** original JSON files in a compressed ZIP archive
- **Searches** efficiently using a command-line tool (proof of concept)

### Key Benefits

- **Fast Search**: FTS5 full-text search across 29K+ items in milliseconds
- **Group-First Results**: Shows hack groups (e.g., "Invictus") with all versions
- **Compact Storage**: Database ~100MB, ZIP archive ~1GB compressed
- **Rebuildable**: Index is derived from source JSON files, fully reproducible
- **Portable**: Single SQLite database + ZIP file for distribution

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────┐
│              Master JSON Files (index7z/)                │
│         ~29,000 JSON files, ~1GB uncompressed           │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│           Stage 1: search_build1.js                     │
│  - Scan and normalize JSON files                        │
│  - Extract standard fields                              │
│  - Create items table                                   │
│  - Package JSON in ZIP                                  │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              rhsearch_cat.db (SQLite)                   │
│  - items table (normalized records)                     │
│  - rhsearch.zip (compressed JSON archive)              │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│           Stage 2: search_build2.js                     │
│  - Deterministic grouping (gameid, title+author)        │
│  - Probabilistic merges (similarity-based)              │
│  - Create groups and edges tables                       │
│  - Build FTS5 search index                              │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              Enhanced rhsearch_cat.db                    │
│  - items table                                          │
│  - groups table                                         │
│  - items_groups table                                   │
│  - edges table                                          │
│  - items_fts (FTS5 virtual table)                      │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│           search_smwhacks.js (Search Tool)              │
│  - FTS5 full-text search                                │
│  - Display formatted results                            │
│  - Show group information                               │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Master JSON Files** → Raw source of truth (index7z folder)
2. **Stage 1** → Normalize into `items` table, package in ZIP
3. **Stage 2** → Group items, create relationships, build FTS5 index
4. **Search Tool** → Query FTS5 index, display results

---

## Stage 1: Ingest and Normalize

### Script: `search_build1.js`

**Purpose**: Ingest all raw JSON, normalize into compact canonical records

### What It Does

1. **Scans** index7z folder recursively for all `.json` files
2. **Loads** each JSON file and validates structure
3. **Normalizes** data:
   - Extracts standard fields (title, author, version, tags, etc.)
   - Normalizes strings (casefold, punctuation, whitespace)
   - Parses version info (V1.0, 1.1, etc.)
   - Extracts dates from multiple sources
   - Truncates descriptions to ~1K characters
4. **Stores** normalized records in `items` table
5. **Packages** original JSON files in ZIP archive

### Normalized Fields

#### Core Metadata
- `title` - Hack title (from gameversion.name, filename, etc.)
- `versioninfo` - Version string (V1.0, 1.1, etc.)
- `author` - Primary author
- `authors` - All authors (comma-separated)
- `tags` - JSON array of tags
- `brief` - Description snippet (~1K characters)
- `date_estimate` - Estimated date (YYYY-MM-DD)
- `upload_estimate` - Upload timestamp
- `folder_categories` - JSON array of categories

#### File Identifiers
- `sfc_rom_sha1_hash` - SHA1 hash of ROM (primary key)
- `sfc_rom_sha256_hash` - SHA256 hash of ROM
- `bps_filename` - BPS patch filename
- `bps_sha1_hash` - SHA1 hash of BPS file
- `bps_sha256_hash` - SHA256 hash of BPS file
- `sfc_rom_size` - ROM size in bytes
- `sfcsource_filename` - Original SFC filename

#### Metadata Flags
- `has_screenshots` - Boolean (0/1)
- `screenshot_count` - Number of screenshots
- `has_levelnames` - Boolean (0/1)
- `has_lmfilter` - Boolean (0/1)
- `has_translevel_data` - Boolean (0/1)
- `has_official_source` - Boolean (0/1)

### Usage

```bash
enode.sh search_build1.js <index7z folder> <bps7z folder> [options]
```

**Arguments**:
- `index7z folder` - Directory containing master JSON index files
- `bps7z folder` - Directory containing 7z archives (for reference, not used in Stage 1)

**Options**:
- `--rhsearchdb=FILE` - Path to search catalog database (default: `rhsearch_cat.db` in index7z parent)
- `--rhsearchzip=FILE` - Path to JSON ZIP archive (default: `rhsearch.zip` in index7z parent)

**Examples**:
```bash
# Basic usage
enode.sh search_build1.js ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/

# With custom paths
enode.sh search_build1.js ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/ \
  --rhsearchdb=~/rhplay/electron/rhsearch_cat.db \
  --rhsearchzip=~/rhplay/electron/rhsearch.zip
```

### Output

- **Database**: `rhsearch_cat.db` with `items` table
- **ZIP Archive**: `rhsearch.zip` containing all master JSON files (high compression)

### Processing Statistics

The script reports:
- Number of JSON files found
- Number of items processed
- Number of items skipped (invalid/missing data)
- Number of errors encountered

---

## Stage 2: Entity Resolution and Grouping

### Script: `search_build2.js`

**Purpose**: Resolve entities and generate groups clustering related items

### What It Does

1. **Loads** items from Stage 1 database
2. **Loads** JSON data from ZIP archive for detailed analysis
3. **Pass 1: Deterministic Grouping**
   - Groups by `gameid` (SMWCentral) - **confidence: 1.0**
   - Groups by `title + author` (from filename) - **confidence: 0.8**
   - Groups by `title + folder` - **confidence: 0.5**
4. **Pass 2: Probabilistic Merges**
   - Calculates similarity scores:
     - Title similarity (40% weight)
     - Author similarity (30% weight)
     - Levelname overlap (20% weight)
     - Lmfilter overlap (10% weight)
   - Merges groups with similarity ≥ 0.7
   - Creates relationship edges for groups with similarity ≥ 0.4
5. **Creates** database tables:
   - `groups` - Hack groups with canonical metadata
   - `items_groups` - Item-to-group relationships
   - `edges` - Group relationships
6. **Builds** FTS5 full-text search index

### Grouping Logic

#### Deterministic Grouping (Pass 1)

**Strong Key: SMWCentral gameid**
```sql
IF gameversion.gameid EXISTS:
  group_id = "smwcentral_{gameid}"
  confidence = 1.0
```

**Medium Key: Title + Author**
```sql
IF title AND author FROM filename:
  group_id = "title_author_{hash(title|author)}"
  confidence = 0.8
```

**Weak Key: Title + Folder**
```sql
IF title EXISTS:
  group_id = "title_{hash(title|folder)}"
  confidence = 0.5
```

#### Probabilistic Merges (Pass 2)

**Similarity Calculation**:
```
combined_score = (
  title_similarity * 0.4 +
  author_similarity * 0.3 +
  levelname_overlap * 0.2 +
  lmfilter_overlap * 0.1
)
```

**Merge Threshold**: `combined_score >= 0.7`

**Relationship Threshold**: `combined_score >= 0.4` (creates edge, doesn't merge)

### Usage

```bash
enode.sh search_build2.js <index7z folder> <bps7z folder> [options]
```

**Arguments**:
- `index7z folder` - Directory containing master JSON index files (for reference)
- `bps7z folder` - Directory containing 7z archives (for reference)

**Options**:
- `--rhsearchdb=FILE` - Path to search catalog database (must exist from Stage 1)
- `--rhsearchzip=FILE` - Path to JSON ZIP archive (must exist from Stage 1)

**Examples**:
```bash
# Basic usage (uses same database/ZIP from Stage 1)
enode.sh search_build2.js ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/

# With custom paths
enode.sh search_build2.js ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/ \
  --rhsearchdb=~/rhplay/electron/rhsearch_cat.db \
  --rhsearchzip=~/rhplay/electron/rhsearch.zip
```

### Output

- **Updated Database**: Adds `groups`, `items_groups`, `edges` tables
- **FTS5 Index**: Creates `items_fts` virtual table for fast searching

### Processing Statistics

The script reports:
- Number of items loaded
- Number of groups created
- Number of groups merged
- Number of edges created

---

## Search Tool

### Script: `search_smwhacks.js`

**Purpose**: Command-line search tool for SMW hacks (proof of concept)

### What It Does

1. **Loads** search catalog database and ZIP archive
2. **Builds** FTS5 query from search phrases
3. **Executes** full-text search
4. **Displays** formatted results with metadata
5. **Shows** group information for related hacks

### Search Features

- **Full-Text Search**: Searches across title, author, description, tags
- **Prefix Matching**: Single words match prefixes (e.g., "invic" matches "Invictus")
- **Phrase Matching**: Quoted phrases match exactly
- **Multiple Terms**: Space-separated terms are OR'd together
- **Group Information**: Shows related hacks in the same group

### Usage

```bash
enode.sh search_smwhacks.js <search phrases...> [options]
```

**Arguments**:
- `search phrases` - One or more search phrases

**Options**:
- `--rhsearchdb=FILE` - Path to search catalog database
- `--rhsearchzip=FILE` - Path to JSON ZIP archive
- `--help, -h` - Show help message

**Environment Variables**:
- `RHSEARCH_DB_PATH` - Path to search catalog database
- `RHSEARCH_ZIP_PATH` - Path to JSON ZIP archive

**Auto-Discovery**:
If `--rhsearchdb` and `--rhsearchzip` are not specified, the script looks for:
- `electron/rhsearch_cat.db`
- `electron/rhsearch.zip`

Or uses environment variables.

### Examples

```bash
# Search by title
enode.sh search_smwhacks.js invictus

# Search multiple terms
enode.sh search_smwhacks.js kaizo intermediate

# Search with phrase
enode.sh search_smwhacks.js "super mario world"

# Search with specific database
enode.sh search_smwhacks.js --rhsearchdb=search.db --rhsearchzip=search.zip invictus

# Search using environment variables
RHSEARCH_DB_PATH=search.db RHSEARCH_ZIP_PATH=search.zip \
  enode.sh search_smwhacks.js kaizo
```

### Output Format

```
======================================================================
Result 1 of 5
======================================================================
Title: Invictus
Author: juzcook
Version: 1.0
Group ID: smwcentral_18238
Description: Invictus is a chocolate kaizo hack with a touch of vanilla charm...
Tags: asm, bosses, chocolate, gimmick, music
Item ID: 6dd24c31b5d8c568aab0de6d68855f609cbe8f08
SHA1: 6dd24c31b5d8c568aab0de6d68855f609cbe8f08
Screenshots: 3
Has level names: Yes
Has level filter: Yes

======================================================================
Related Groups:
======================================================================
Group: Invictus
  Author: juzcook
  Versions: 2
```

---

## Database Schema

### items Table

Normalized item records with all searchable fields:

```sql
CREATE TABLE items (
  item_id TEXT PRIMARY KEY,              -- SHA1 hash of ROM
  json_path TEXT NOT NULL,               -- Path in ZIP archive
  title TEXT,                            -- Hack title
  versioninfo TEXT,                      -- Version string
  author TEXT,                           -- Primary author
  authors TEXT,                          -- All authors
  tags TEXT,                             -- JSON array of tags
  brief TEXT,                            -- Description snippet (~1K)
  date_estimate TEXT,                    -- YYYY-MM-DD
  upload_estimate TEXT,                  -- ISO timestamp
  folder_categories TEXT,                -- JSON array
  sfcsource_filename TEXT,
  sfc_rom_sha1_hash TEXT,
  sfc_rom_sha256_hash TEXT,
  bps_filename TEXT,
  bps_sha1_hash TEXT,
  bps_sha256_hash TEXT,
  bps_file_size INTEGER,
  sfc_rom_size INTEGER,
  has_screenshots INTEGER DEFAULT 0,
  screenshot_count INTEGER DEFAULT 0,
  has_levelnames INTEGER DEFAULT 0,
  has_lmfilter INTEGER DEFAULT 0,
  has_translevel_data INTEGER DEFAULT 0,
  has_official_source INTEGER DEFAULT 0,
  raw_json_hash TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Indexes**:
- `idx_items_title` - On `title`
- `idx_items_author` - On `author`
- `idx_items_date` - On `date_estimate`
- `idx_items_sfc_sha1` - On `sfc_rom_sha1_hash`
- `idx_items_bps_sha1` - On `bps_sha1_hash`

### groups Table

Hack groups with canonical metadata:

```sql
CREATE TABLE groups (
  group_id TEXT PRIMARY KEY,             -- Unique group identifier
  canonical_title TEXT,                   -- Best title for the group
  canonical_author TEXT,                 -- Best author for the group
  canonical_source TEXT,                 -- Source of grouping (smwcentral, filename, title)
  confidence REAL DEFAULT 1.0,           -- Confidence in grouping (0.0-1.0)
  version_count INTEGER DEFAULT 0,       -- Number of versions in group
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### items_groups Table

Many-to-many relationship between items and groups:

```sql
CREATE TABLE items_groups (
  item_id TEXT,
  group_id TEXT,
  version_label TEXT,                    -- Version string (V1.0, 1.1, etc.)
  version_sort_key TEXT,                 -- Sortable version key
  PRIMARY KEY (item_id, group_id),
  FOREIGN KEY (item_id) REFERENCES items(item_id),
  FOREIGN KEY (group_id) REFERENCES groups(group_id)
);
```

**Indexes**:
- `idx_items_groups_group` - On `group_id`
- `idx_items_groups_item` - On `item_id`

### edges Table

Group relationships:

```sql
CREATE TABLE edges (
  src_id TEXT,
  dst_id TEXT,
  edge_type TEXT,                        -- 'merged_into', 'related_to'
  weight REAL DEFAULT 1.0,               -- Similarity score (0.0-1.0)
  evidence_json TEXT,                    -- JSON with similarity details
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (src_id, dst_id, edge_type),
  FOREIGN KEY (src_id) REFERENCES groups(group_id),
  FOREIGN KEY (dst_id) REFERENCES groups(group_id)
);
```

**Indexes**:
- `idx_edges_src` - On `src_id`
- `idx_edges_dst` - On `dst_id`

### items_fts Table

FTS5 virtual table for full-text search:

```sql
CREATE VIRTUAL TABLE items_fts USING fts5(
  item_id UNINDEXED,
  group_id UNINDEXED,
  title,
  author,
  versioninfo,
  tags,
  brief,
  levelnames_keywords,
  content='items',
  content_rowid='rowid'
);
```

**Searchable Fields**:
- `title` - Hack title
- `author` - Author name
- `versioninfo` - Version string
- `tags` - Tag list
- `brief` - Description snippet
- `levelnames_keywords` - Keywords from level names (future)

**FTS5 Features**:
- Prefix matching: `term*` matches words starting with "term"
- Phrase matching: `"exact phrase"` matches exact phrase
- OR operator: `term1 OR term2` matches either term
- Automatic ranking (can be enhanced with BM25)

---

## Usage Examples

### Complete Workflow

```bash
# Step 1: Build initial catalog (Stage 1)
enode.sh search_build1.js ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/

# Step 2: Group and index (Stage 2)
enode.sh search_build2.js ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/

# Step 3: Search
enode.sh search_smwhacks.js invictus
```

### Custom Paths

```bash
# Stage 1 with custom paths
enode.sh search_build1.js ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/ \
  --rhsearchdb=~/rhplay/electron/rhsearch_cat.db \
  --rhsearchzip=~/rhplay/electron/rhsearch.zip

# Stage 2 with same paths
enode.sh search_build2.js ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/ \
  --rhsearchdb=~/rhplay/electron/rhsearch_cat.db \
  --rhsearchzip=~/rhplay/electron/rhsearch.zip

# Search with same paths
enode.sh search_smwhacks.js --rhsearchdb=~/rhplay/electron/rhsearch_cat.db \
  --rhsearchzip=~/rhplay/electron/rhsearch.zip invictus
```

### Environment Variables

```bash
# Set environment variables
export RHSEARCH_DB_PATH=~/rhplay/electron/rhsearch_cat.db
export RHSEARCH_ZIP_PATH=~/rhplay/electron/rhsearch.zip

# Use in scripts (auto-discovered)
enode.sh search_smwhacks.js kaizo intermediate
```

### Search Examples

```bash
# Search by title
enode.sh search_smwhacks.js invictus

# Search by author
enode.sh search_smwhacks.js author:juzcook

# Search by difficulty/type
enode.sh search_smwhacks.js kaizo intermediate

# Search with multiple terms
enode.sh search_smwhacks.js chocolate gimmick music

# Search with phrase
enode.sh search_smwhacks.js "super mario world"

# Search for hacks with screenshots
enode.sh search_smwhacks.js --rhsearchdb=search.db screenshot
```

---

## Workflow

### Initial Build

1. **Run Stage 1**: Ingest and normalize all master JSON files
   ```bash
   enode.sh search_build1.js index7z/ bps7z/
   ```
   - Creates `rhsearch_cat.db` with `items` table
   - Creates `rhsearch.zip` with all JSON files

2. **Run Stage 2**: Group items and build search index
   ```bash
   enode.sh search_build2.js index7z/ bps7z/
   ```
   - Adds `groups`, `items_groups`, `edges` tables
   - Creates FTS5 search index

3. **Test Search**: Verify search functionality
   ```bash
   enode.sh search_smwhacks.js invictus
   ```

### Incremental Updates

When new master JSON files are added:

1. **Re-run Stage 1**: Will update existing items and add new ones
   ```bash
   enode.sh search_build1.js index7z/ bps7z/
   ```

2. **Re-run Stage 2**: Will re-group all items (including new ones)
   ```bash
   enode.sh search_build2.js index7z/ bps7z/
   ```

### Distribution

For distribution to end users:

1. **Package**:
   - `rhsearch_cat.db` (~100MB)
   - `rhsearch.zip` (~1GB compressed)

2. **Place** in application data directory:
   - Development: `electron/rhsearch_cat.db`, `electron/rhsearch.zip`
   - Production: User data directory (auto-detected)

3. **Search** works immediately:
   ```bash
   enode.sh search_smwhacks.js <query>
   ```

---

## Future Enhancements

### Screenshot Analysis (Planned)

- Generate captions for screenshots using vision models
- Extract tags (cave, ghost house, forest, boss, etc.)
- Index captions and tags in FTS5
- Cluster similar screenshots

### Enrichment Pipeline (Planned)

- Local-first inference (filename parsing, cross-file propagation)
- Web enrichment for missing core fields (cached)
- Store enrichments as sidecar JSON files
- Mark provenance (official, parsed, inferred, generated)

### Advanced Search Features (Planned)

- Faceted search (category, tags, author, year, etc.)
- Related items suggestions
- Group-first results with version drilldown
- BM25 ranking for better relevance

---

## Troubleshooting

### Common Issues

#### Issue: "Database not found"
**Solution**: Run Stage 1 first to create the database

#### Issue: "FTS5 index not found"
**Solution**: Run Stage 2 to build the search index

#### Issue: "ZIP archive not found"
**Solution**: Run Stage 1 to create the ZIP archive

#### Issue: "No results found"
**Solution**: 
- Check that Stage 1 and Stage 2 completed successfully
- Try broader search terms
- Verify FTS5 index was created: `sqlite3 rhsearch_cat.db "SELECT COUNT(*) FROM items_fts;"`

### Debugging Tips

1. **Check database contents**:
   ```bash
   sqlite3 rhsearch_cat.db "SELECT COUNT(*) FROM items;"
   sqlite3 rhsearch_cat.db "SELECT COUNT(*) FROM groups;"
   sqlite3 rhsearch_cat.db "SELECT COUNT(*) FROM items_fts;"
   ```

2. **Inspect specific item**:
   ```bash
   sqlite3 rhsearch_cat.db "SELECT * FROM items WHERE item_id = '6dd24c31b5d8c568aab0de6d68855f609cbe8f08';"
   ```

3. **Check groups**:
   ```bash
   sqlite3 rhsearch_cat.db "SELECT * FROM groups WHERE canonical_title LIKE '%Invictus%';"
   ```

4. **Test FTS5 query**:
   ```bash
   sqlite3 rhsearch_cat.db "SELECT item_id, title FROM items_fts WHERE items_fts MATCH 'invictus' LIMIT 5;"
   ```

---

## Related Documentation

- `docs/PROGRAMS.MD` - Program listing and quick reference
- `docs/PROCESS_INDEX7ZS_SPEC.md` - Master JSON file specification
- `docs/PROCESS_ARCSFC.md` - Related ROM processing script

---

## Version History

### Version 1.0 (December 2025)
- Initial release
- Stage 1: Ingest and normalize
- Stage 2: Entity resolution and grouping
- Command-line search tool
- FTS5 full-text search index

---

*Last Updated: December 2025*
