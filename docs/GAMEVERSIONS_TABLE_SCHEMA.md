# GameVersions Table Schema Documentation

## Overview
The `gameversions` table stores metadata about game ROM hacks, including versioning information, authorship, difficulty ratings, and references to associated patch files. This table is the central component of the rhdata.db database and tracks both current and historical versions of game entries.

## Table Structure

### Primary Key
- **gvuuid** (VARCHAR(255)): UUID v4 identifier for each game version record. Generated automatically.

### Core Game Identification
| Column | Type | Description | Example |
|--------|------|-------------|---------|
| **gameid** | VARCHAR(255) | Unique identifier for the game (not version-specific) | "38660", "10012" |
| **version** | INTEGER | Version number, auto-incremented for each gameid | 1, 2, 3 |
| **section** | VARCHAR(255) | Section/category of the game | "smwhacks" |
| **name** | VARCHAR(255) | Display name of the game (NOT NULL) | "Super Mario World 2" |

**Unique Constraint**: `UNIQUE(gameid, version)` - Each game can only have one record per version number.

### Game Type and Difficulty

#### Legacy Fields
| Column | Type | Description | Example |
|--------|------|-------------|---------|
| **gametype** | VARCHAR(255) | High-level type/difficulty classification | "Standard: Easy", "Kaizo", "Advanced" |
| **difficulty** | VARCHAR(255) | Human-readable difficulty level | "Advanced", "Beginner", "Expert" |

#### New Schema Fields (Added 2025-01-10)
| Column | Type | Description | Source | Example |
|--------|------|-------------|--------|---------|
| **fields_type** | VARCHAR(255) | Extracted from `fields.type` in new JSON format | `record.fields.type` | "Kaizo", "Standard", "Puzzle" |
| **raw_difficulty** | VARCHAR(255) | Difficulty code from raw metadata | `record.raw_fields.difficulty` | "diff_4", "diff_2", "diff_1" |

**Note**: The new schema fields support improved granularity:
- `fields_type`: Provides the standardized type classification
- `raw_difficulty`: Stores the raw difficulty code (e.g., "diff_4" = Advanced difficulty level)
- These fields coexist with legacy `gametype` and `difficulty` for backward compatibility

#### Computed/Derived Fields

##### combinedtype (VARCHAR(255))
**Added**: 2025-01-10 (v1.2)  
**Purpose**: Combines all type and difficulty fields into a single human-readable string for display and filtering.

**Computation Logic**:
```
Format: [fields_type]: [difficulty] (raw_difficulty) (raw_fields.type)
```

The `combinedtype` field is automatically computed by `loaddata.js` using the following algorithm:

1. **Start with empty string**
2. **Add `fields.type`** (if present) with colon and space: `"Kaizo: "`
3. **Add `difficulty`** (main difficulty field): `"Advanced"`
4. **Add `raw_fields.difficulty`** (if present) in parentheses: `" (diff_4)"`
5. **Add `raw_fields.type`** (if present) in parentheses:
   - If array: join with commas: `" (kaizo, standard)"`
   - If string: add as-is: `" (kaizo)"`

**Examples**:

| fields.type | difficulty | raw_difficulty | raw_fields.type | combinedtype |
|-------------|------------|----------------|-----------------|--------------|
| "Kaizo" | "Advanced" | "diff_4" | ["kaizo"] | "Kaizo: Advanced (diff_4) (kaizo)" |
| "Standard" | "Easy" | "diff_2" | ["standard", "traditional"] | "Standard: Easy (diff_2) (standard, traditional)" |
| NULL | "Advanced" | "diff_4" | ["kaizo"] | "Advanced (diff_4) (kaizo)" |
| "Puzzle" | "Normal" | NULL | ["puzzle"] | "Puzzle: Normal (puzzle)" |
| "Kaizo" | "Expert" | "diff_5" | NULL | "Kaizo: Expert (diff_5)" |
| NULL | "Easy" | NULL | NULL | "Easy" |

**Omission Rules**:
- If `fields.type` is missing → Start directly with difficulty (no colon)
- If `raw_difficulty` is missing → Omit the `(diff_X)` portion
- If `raw_fields.type` is missing → Omit the `(type)` portion
- If all components are missing → Result is NULL

**Use Cases**:
- **Display**: Show comprehensive type/difficulty in UI
- **Filtering**: Query by complete type classification
- **Sorting**: Order games by combined characteristics
- **Search**: Full-text search across all type fields

**Query Examples**:
```sql
-- Find all Kaizo Advanced games
SELECT * FROM gameversions 
WHERE combinedtype LIKE 'Kaizo: Advanced%';

-- Find games with specific difficulty code
SELECT * FROM gameversions 
WHERE combinedtype LIKE '%(diff_4)%';

-- Find multi-type games
SELECT * FROM gameversions 
WHERE combinedtype LIKE '%,%';

-- Group by combined type
SELECT combinedtype, COUNT(*) as count 
FROM gameversions 
WHERE combinedtype IS NOT NULL
GROUP BY combinedtype
ORDER BY count DESC;
```

**Indexed**: Yes (`idx_gameversions_combinedtype`) for efficient querying.

### Authorship and Attribution
| Column | Type | Description | Example |
|--------|------|-------------|---------|
| **author** | VARCHAR(255) | Primary author name | "xMANGRAVYx" |
| **authors** | VARCHAR(255) | Comma-separated list of authors | "John, Jane, Bob" |
| **submitter** | VARCHAR(255) | Person who submitted the entry | "username123" |
| **author_href** | VARCHAR(255) | Link to author's profile | "/?p=profile&id=3726" |

### Timestamps
| Column | Type | Description | Example |
|--------|------|-------------|---------|
| **time** | VARCHAR(255) | Unix timestamp of game creation/update | "1729469201" |
| **added** | VARCHAR(255) | Human-readable date added | "2024-10-20 07:06:41 PM" |
| **gvimport_time** | TIMESTAMP | Auto-generated timestamp when record was imported | "2025-01-10 12:34:56" |

### Status Flags
| Column | Type | Description | Values |
|--------|------|-------------|--------|
| **moderated** | VARCHAR(255) | Moderation status (stored as 0/1 from boolean) | "1" (true), "0" (false), NULL |
| **featured** | VARCHAR(255) | Featured status (stored as 0/1 from boolean) | "1" (true), "0" (false), NULL |
| **demo** | VARCHAR(255) | Is this a demo version? | "Yes", "No" |
| **removed** | INTEGER | Soft-delete flag | 0 (active), 1 (removed) |
| **obsoleted** | INTEGER | Obsoleted by newer version | 0 (current), 1 (obsoleted) |
| **obsoleted_by** | VARCHAR(255) | Reference to newer version | "38661" |

### Content Metadata
| Column | Type | Description | Example |
|--------|------|-------------|---------|
| **length** | VARCHAR(255) | Number of exits/levels | "8 exit(s)", "96 exit(s)" |
| **size** | VARCHAR(255) | File size in bytes | "661966" |
| **description** | TEXT | Full description with HTML formatting | "This rom hack was designed..." |
| **url** | VARCHAR(255) | External URL for the game | "https://www.smwcentral.net/..." |
| **download_url** | VARCHAR(255) | Direct download link | "https://dl.smwcentral.net/..." |
| **name_href** | VARCHAR(255) | Link to the game page | "https://dl.smwcentral.net/38660/..." |

### Tags and Categorization
| Column | Type | Description | Format |
|--------|------|-------------|--------|
| **tags** | TEXT | JSON array of tags | `["exgfx", "music", "kaizo"]` |
| **tags_href** | TEXT | Link to tag search | "/?p=section&s=smwhacks&f%5Btags%5D=exgfx" |

### Patch References
| Column | Type | Description | Example |
|--------|------|-------------|---------|
| **patchblob1_name** | VARCHAR(255) | Reference to patchblob record | "pblob_38660_9df5c33963" |
| **pat_sha224** | VARCHAR(255) | SHA-224 hash of patch file | "e4201955135a2e5e1adfe..." |

### JSON Storage
| Column | Type | Description | Purpose |
|--------|------|-------------|---------|
| **gvjsondata** | TEXT | Complete JSON record (optimized) | Full backup of source data |
| **gvchange_attributes** | TEXT | JSON array of changed fields | Version tracking |
| **gvchanges** | TEXT | Detailed change log | Audit trail |

### Digital Signatures
| Column | Type | Description | Purpose |
|--------|------|-------------|---------|
| **siglistuuid** | VARCHAR(255) | Reference to signature list | Cryptographic verification |

### Curator-Managed Fields (Locked Attributes)

These fields are **locked** and preserved across version updates. They cannot be overwritten by incoming JSON data and can only be changed through manual SQL updates. This allows curators to set values that persist even when new versions of a game are imported.

| Column | Type | Description | Locked | Example |
|--------|------|-------------|--------|---------|
| **legacy_type** | VARCHAR(255) | User-curated type classification | 🔒 YES | "Historical - First Kaizo", "VLDC9 Competition Entry" |

**Locking Behavior**:
- ✅ When loading a new version (v2+), locked values are copied from the previous version
- ✅ Locked values override any values from the incoming JSON data
- ✅ Console notification shows which attributes are preserved
- ❌ Does NOT lock on first version (no previous version to copy from)
- ❌ Does NOT lock if previous version has NULL value

**Usage Example**:
```sql
-- Curator sets legacy_type manually
UPDATE gameversions 
SET legacy_type = 'Competition Winner 2024'
WHERE gameid = '38660' AND version = 2;

-- Future imports will preserve this value
-- Version 3, 4, 5... will all have legacy_type = 'Competition Winner 2024'
```

**See**: `docs/LOCKED_ATTRIBUTES.md` for complete documentation of this feature.

### Script-Managed Fields (Computed Columns)

These fields are **computed** or **managed** by the update scripts and must **NOT** be updated from external JSON data imports.

| Column | Type | Description | Managed By | Example |
|--------|------|-------------|------------|---------|
| **local_resource_etag** | VARCHAR(255) | HTTP ETag header from ZIP download | updategames.js | "33a64df551425..." |
| **local_resource_lastmodified** | TIMESTAMP | HTTP Last-Modified header from download | updategames.js | "2024-10-20 15:30:45" |
| **local_resource_filename** | VARCHAR(500) | Local path where ZIP was saved | updategames.js | "zips/39116_2.zip" |
| **combinedtype** | VARCHAR(255) | Computed from type/difficulty fields | loaddata.js, updategames.js | "Kaizo: Advanced (diff_4)" |
| **gvimport_time** | TIMESTAMP | Auto-generated on record creation | Database | "2025-01-10 12:34:56" |
| **version** | INTEGER | Auto-incremented per gameid | Database trigger | 1, 2, 3 |
| **gvuuid** | VARCHAR(255) | UUID v4 primary key | Database | Auto-generated |

**IMPORTANT**: When importing JSON data, these fields must be excluded or skipped. They are populated by:
- Database triggers (version, gvuuid, gvimport_time)
- Script computation (combinedtype)
- HTTP download process (local_resource_*)

**Purpose of local_resource_* Fields**:
- **Efficient change detection**: Use HTTP HEAD requests to check if files changed before downloading
- **Versioned storage**: Preserve old ZIP versions (zips/GAMEID_VERSION.zip format)
- **Duplicate prevention**: Avoid re-downloading identical files
- **HTTP metadata tracking**: Store ETag and Last-Modified for comparison

**See**: `docs/LOCAL_RESOURCE_TRACKING.md` for complete documentation of resource tracking.

**Implementation in loaddata.js**:
```javascript
const COMPUTED_COLUMNS = [
  'local_resource_etag',
  'local_resource_lastmodified',
  'local_resource_filename',
  'combinedtype',
  'gvimport_time',
  'version',
  'gvuuid'
];

// Exclude when building INSERT from JSON
const GAMEVERSION_FIELDS = ALL_FIELDS.filter(f => !COMPUTED_COLUMNS.includes(f));
```

## Schema Evolution

### Version 1.0 (Original)
- Basic fields for game metadata
- Legacy `gametype` and `difficulty` fields
- Boolean values not explicitly supported

### Version 1.1 (2025-01-10)
- ✅ Added `fields_type` column for `fields.type` extraction
- ✅ Added `raw_difficulty` column for `raw_fields.difficulty` extraction
- ✅ Boolean value normalization (true→"1", false→"0")
- ✅ Backward compatible with old JSON schemas
- ✅ Indexes on `fields_type` and `raw_difficulty` for performance

### Version 1.2 (2025-01-10)
- ✅ Added `combinedtype` computed column
- ✅ Combines all 4 type/difficulty fields into single string
- ✅ Automatic computation during data import
- ✅ Index on `combinedtype` for efficient querying
- ✅ Supports multi-value raw_fields.type arrays

### Version 1.3 (2025-01-10)
- ✅ Added locked attributes feature
- ✅ Added `legacy_type` as first locked attribute
- ✅ Locked attributes are preserved across version updates
- ✅ Cannot be overwritten by JSON imports
- ✅ Curator-managed fields for manual classification

### Version 1.4 (2025-10-12) - Current
- ✅ Added `local_resource_etag` column - HTTP ETag tracking
- ✅ Added `local_resource_lastmodified` column - HTTP Last-Modified tracking
- ✅ Added `local_resource_filename` column - Local ZIP file path
- ✅ Versioned ZIP storage (zips/GAMEID_VERSION.zip)
- ✅ HTTP HEAD request optimization for large files
- ✅ Duplicate ZIP detection and prevention
- ✅ Computed columns classification system

**Purpose**: Enable efficient change detection and preserve old file versions.

**See**: `docs/LOCAL_RESOURCE_TRACKING.md` for complete documentation.

## Data Sources and Mapping

### Old JSON Format (Pre-2025)
```json
{
  "id": "10012",
  "name": "Super Mario World: Hunt for the Dragon Coins",
  "type": "Standard: Easy",
  "demo": "Yes",
  "length": "7 exit(s)",
  "author": "JDC"
}
```
**Mapping:**
- `id` → `gameid`
- `type` → `gametype`
- `fields_type` → NULL (not present)
- `raw_difficulty` → NULL (not present)

### New JSON Format (2025+)
```json
{
  "id": "38660",
  "name": "The Stinky Black Banana Peel",
  "type": "Advanced",
  "moderated": true,
  "demo": "No",
  "fields": {
    "type": "Kaizo",
    "hof": "No",
    "sa1": "No"
  },
  "raw_fields": {
    "difficulty": "diff_4",
    "length": 8,
    "demo": false,
    "type": ["kaizo"]
  }
}
```
**Mapping:**
- `id` → `gameid`
- `type` → `gametype` (legacy: "Advanced")
- `fields.type` → `fields_type` (new: "Kaizo")
- `raw_fields.difficulty` → `raw_difficulty` (new: "diff_4")
- `moderated: true` → `moderated: 1` (boolean normalization)

## Difficulty Codes Reference

| Code | Difficulty Level | Description |
|------|------------------|-------------|
| diff_1 | Beginner | Easy for newcomers |
| diff_2 | Easy | Simple challenges |
| diff_3 | Normal | Moderate difficulty |
| diff_4 | Advanced | Requires skill |
| diff_5 | Expert | Very challenging |
| diff_6 | Kaizo | Extremely difficult |

## Querying Examples

### Find all Kaizo games
```sql
SELECT gameid, name, fields_type, raw_difficulty
FROM gameversions
WHERE fields_type = 'Kaizo'
  AND removed = 0
ORDER BY added DESC;
```

### Find games by difficulty code
```sql
SELECT gameid, name, fields_type, raw_difficulty, difficulty
FROM gameversions
WHERE raw_difficulty = 'diff_4'
  AND removed = 0;
```

### Get latest version of each game
```sql
SELECT gv.*
FROM gameversions gv
INNER JOIN (
  SELECT gameid, MAX(version) as max_version
  FROM gameversions
  WHERE removed = 0
  GROUP BY gameid
) latest ON gv.gameid = latest.gameid AND gv.version = latest.max_version;
```

### Compare type classifications
```sql
SELECT 
  gametype as legacy_type,
  fields_type as new_type,
  raw_difficulty,
  COUNT(*) as count
FROM gameversions
WHERE fields_type IS NOT NULL
GROUP BY gametype, fields_type, raw_difficulty
ORDER BY count DESC;
```

## Indexes

### Existing Indexes
- Primary key on `gvuuid`
- Unique constraint on `(gameid, version)`

### New Indexes (Added 2025-01-10)
- `idx_gameversions_fields_type` - Improves queries filtering by `fields_type`
- `idx_gameversions_raw_difficulty` - Improves queries filtering by `raw_difficulty`

## Related Tables

### rhpatches
Links game versions to their patch files:
- `gameid` references `gameversions.gameid`

### patchblobs
Stores encrypted patch blob data:
- `gvuuid` references `gameversions.gvuuid`
- `patchblob1_name` matches `gameversions.patchblob1_name`

## Migration Notes

### Applying the Schema Update
To add the new columns to an existing database:

```bash
sqlite3 electron/rhdata.db < electron/sql/migrations/001_add_fields_type_raw_difficulty.sql
```

### Data Population
The `loaddata.js` script automatically extracts and populates these fields when importing new JSON data:

```bash
# Default database path
node loaddata.js tempj/38660

# Custom database path
RHDATA_DB_PATH=/path/to/test.db node loaddata.js data.json
```

## Best Practices

1. **Always check version numbers** when querying to avoid duplicate entries
2. **Use the latest version** unless specifically querying historical data
3. **Check the `removed` flag** to filter out deleted entries
4. **Prefer `fields_type` over `gametype`** for new queries (more accurate classification)
5. **Use `raw_difficulty` codes** for consistent difficulty filtering across all games
6. **Maintain backward compatibility** by keeping both old and new fields populated

## Backward Compatibility

The schema update maintains full backward compatibility:
- ✅ Old JSON files without `fields` or `raw_fields` work normally
- ✅ New columns default to NULL for old data
- ✅ Legacy `gametype` and `difficulty` fields remain functional
- ✅ Existing queries continue to work unchanged
- ✅ Boolean values are normalized to 0/1 for SQLite compatibility

## Future Enhancements

Potential future additions:
- Structured fields for images array
- Enhanced version diffing
- Automated tag extraction and normalization
- Multi-language description support
- Rating and review data integration

