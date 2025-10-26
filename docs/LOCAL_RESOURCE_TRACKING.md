# Local Resource Tracking - Schema Documentation

## Overview

The `gameversions` table includes three new fields (`local_resource_*`) to track downloaded ZIP files and enable efficient change detection without unnecessary re-downloads.

## Purpose

These fields solve three critical problems:

1. **Efficient Change Detection**: Use HTTP HEAD requests to check if files changed before downloading
2. **Versioned Storage**: Preserve old ZIP versions when files are updated
3. **Duplicate Prevention**: Avoid re-downloading identical files

---

## Schema Fields

### local_resource_etag (VARCHAR 255)

**Purpose**: Store the HTTP ETag header from the download response

**Source**: `ETag` HTTP response header when downloading the ZIP file

**Usage**:
- Compare ETags before downloading to detect changes
- If ETag matches, skip download (file unchanged)
- More reliable than Last-Modified for change detection

**Example Values**:
```
"33a64df551425fcc55e4d42a148795d9f25f89d4"
"W/"5f8c7b6a-1a2b3c""
```

**When Populated**:
- Set when ZIP file is downloaded
- Updated if file is re-downloaded for new version
- NULL if ETag header not provided by server

---

### local_resource_lastmodified (TIMESTAMP)

**Purpose**: Store the HTTP Last-Modified header from the download response

**Source**: `Last-Modified` HTTP response header when downloading the ZIP file

**Usage**:
- Alternative change detection if ETag not available
- Compare Last-Modified dates before downloading
- If date unchanged, skip download

**Example Values**:
```
2024-10-20 15:30:45
2025-01-10 08:22:33
```

**When Populated**:
- Set when ZIP file is downloaded
- Updated if file is re-downloaded for new version
- NULL if Last-Modified header not provided by server

---

### local_resource_filename (VARCHAR 500)

**Purpose**: Store the local filesystem path where the ZIP file was saved

**Source**: Computed by the downloader based on gameid and version

**Format**:
- **Version 1**: `zips/<GAMEID>.zip`
- **Version 2+**: `zips/<GAMEID>_<VERSION>.zip`

**Example Values**:
```
zips/39116.zip          (version 1)
zips/39116_2.zip        (version 2)
zips/39116_3.zip        (version 3)
zips/12345.zip          (version 1)
zips/12345_2.zip        (version 2)
```

**When Populated**:
- Set when ZIP file is downloaded
- Each version has unique filename
- Enables preserving old versions

---

## COMPUTED COLUMNS Classification

### ⚠️ CRITICAL REQUIREMENT

These fields are **COMPUTED COLUMNS** - they are managed by the `updategames.js` script and must **NOT** be updated from external JSON data.

When importing JSON data (via `loaddata.js` or other scripts), these fields must be **EXCLUDED** from the import process.

### Complete List of Computed Columns

| Column | Managed By | Source | Can Import? |
|--------|------------|--------|-------------|
| `local_resource_etag` | updategames.js | HTTP response | ❌ NO |
| `local_resource_lastmodified` | updategames.js | HTTP response | ❌ NO |
| `local_resource_filename` | updategames.js | Computed | ❌ NO |
| `combinedtype` | Scripts | Computed | ❌ NO |
| `gvimport_time` | Database | Auto-generated | ❌ NO |
| `version` | Database | Auto-incremented | ❌ NO |
| `gvuuid` | Database | UUID generator | ❌ NO |

### Implementation in Scripts

**loaddata.js** - Add to excluded fields:
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

// When building INSERT query, skip computed columns
const GAMEVERSION_FIELDS = [...].filter(f => !COMPUTED_COLUMNS.includes(f));
```

**updategames.js** - Already handles these correctly:
- Sets `local_resource_*` fields from HTTP responses and computed values
- Sets `combinedtype` via computation
- Database auto-generates `gvimport_time`, `version`, `gvuuid`

---

## Change Detection Workflow

### 1. URL Change Detected

```
Old: dl.smwcentral.net/39116/Binary%20World%201.0.11.zip
New: dl.smwcentral.net/39116/Binary%20World%201.0.12.zip
                                       ^^^^  Filename changed
```

**Action**: URL path/filename changed → **MAJOR CHANGE**

### 2. HEAD Request Optimization

```javascript
// Before downloading large file
const headResponse = await fetch(downloadUrl, { method: 'HEAD' });

// Check ETag
if (oldETag === headResponse.headers.get('ETag')) {
  // File unchanged, skip download
  return { download: false, reason: 'etag_match' };
}

// Check Last-Modified
if (oldLastModified === headResponse.headers.get('Last-Modified')) {
  // File unchanged, skip download
  return { download: false, reason: 'lastmodified_match' };
}

// File changed, download needed
return { download: true };
```

### 3. Versioned Storage

```javascript
// Determine filename based on version
const version = 2;
const filename = `zips/${gameid}_${version}.zip`;

// Check for duplicates
const hash = calculateHash(zipData);
const existingVersions = findZipsByGameId(gameid);

for (const existing of existingVersions) {
  if (calculateHash(existing) === hash) {
    console.log('Identical ZIP found, reusing');
    // Link to existing patchblobs, don't create duplicates
    return existing.path;
  }
}

// Save new version
fs.writeFileSync(filename, zipData);
return filename;
```

---

## Use Cases

### Use Case 1: File Updated on Server

**Scenario**: Game author uploads version 1.0.12 to replace 1.0.11

```
Step 1: Fetch metadata from SMWC
  - New download_url detected: .../Binary%20World%201.0.12.zip
  - Old was: .../Binary%20World%201.0.11.zip

Step 2: Detect major change
  - extractPathAndFilename() shows filename changed
  - Result: MAJOR CHANGE

Step 3: HEAD request
  - Content-Length: 850000 (was 800000)
  - ETag: different from stored value
  - Result: Download needed

Step 4: Download and process
  - Download to: zips/39116_2.zip (version 2)
  - Extract patches, create new patchblobs
  - Store HTTP headers:
    - local_resource_etag: "new-etag-value"
    - local_resource_lastmodified: "2025-10-12 10:30:00"
    - local_resource_filename: "zips/39116_2.zip"

Step 5: Create new version record
  - gameversions version 2 created
  - Points to zips/39116_2.zip
  - Old version 1 still points to zips/39116.zip (preserved!)
```

### Use Case 2: Server Migration (No File Change)

**Scenario**: SMWC moves files to new CDN

```
Step 1: Fetch metadata
  - New download_url: dl2.smwcentral.net/39116/file.zip
  - Old was: dl.smwcentral.net/39116/file.zip

Step 2: Detect minor change
  - extractPathAndFilename() shows same path: /39116/file.zip
  - Only hostname changed
  - Result: MINOR CHANGE (ignore for versioning)

Step 3: Update stats only
  - Update gameversion_stats table
  - No new version created
  - No download needed
```

### Use Case 3: Large File Optimization

**Scenario**: 10 MB file, check before downloading

```
Step 1: URL change detected
  - Filename changed in URL

Step 2: Check file size
  - New size: 10,500,000 bytes (>5 MB threshold)
  - Result: Use HEAD request

Step 3: HEAD request
  - GET headers only (no download yet)
  - ETag: matches stored value
  - Result: File unchanged, skip download

Step 4: Update metadata only
  - Update download_url in gameversion_stats
  - Don't create new version
  - Save bandwidth and time
```

---

## Database Queries

### Get Resource Tracking Info

```sql
SELECT 
  gameid,
  version,
  local_resource_filename,
  local_resource_etag,
  local_resource_lastmodified,
  size
FROM gameversions
WHERE gameid = '39116'
ORDER BY version;
```

### Find Games with Multiple ZIP Versions

```sql
SELECT 
  gameid,
  COUNT(*) as version_count,
  GROUP_CONCAT(local_resource_filename, ', ') as zip_files
FROM gameversions
WHERE local_resource_filename IS NOT NULL
GROUP BY gameid
HAVING version_count > 1
ORDER BY version_count DESC;
```

### Find Games Needing Re-check

```sql
-- Games where URL changed but ETag not checked yet
SELECT 
  gv1.gameid,
  gv1.download_url as old_url,
  gvs.gvjsondata as new_metadata
FROM gameversions gv1
JOIN gameversion_stats gvs ON gv1.gameid = gvs.gameid
WHERE gv1.version = (SELECT MAX(version) FROM gameversions WHERE gameid = gv1.gameid)
  AND gv1.local_resource_etag IS NULL
  AND gv1.download_url IS NOT NULL;
```

---

## Implementation Guidelines

### For updategames.js

#### 1. On Download

```javascript
async function downloadWithHeaders(url) {
  const response = await fetch(url);
  const zipData = await response.arrayBuffer();
  
  return {
    data: Buffer.from(zipData),
    etag: response.headers.get('ETag'),
    lastModified: response.headers.get('Last-Modified'),
    contentLength: response.headers.get('Content-Length')
  };
}
```

#### 2. On Save

```javascript
function saveWithTracking(gameid, version, downloadResult) {
  const filename = version === 1 
    ? `zips/${gameid}.zip` 
    : `zips/${gameid}_${version}.zip`;
  
  // Save ZIP
  fs.writeFileSync(filename, downloadResult.data);
  
  // Return tracking data for database
  return {
    local_resource_filename: filename,
    local_resource_etag: downloadResult.etag,
    local_resource_lastmodified: downloadResult.lastModified
  };
}
```

#### 3. On Version Creation

```javascript
function createGameVersionRecord(metadata, trackingData) {
  const data = {
    // ... other fields ...
    local_resource_etag: trackingData.local_resource_etag,
    local_resource_lastmodified: trackingData.local_resource_lastmodified,
    local_resource_filename: trackingData.local_resource_filename
  };
  
  db.prepare(`INSERT INTO gameversions (...) VALUES (...)`).run(data);
}
```

### For loaddata.js

#### Exclude from JSON Import

```javascript
// When loading JSON files, DO NOT import these fields
const COMPUTED_COLUMNS = [
  'local_resource_etag',
  'local_resource_lastmodified',
  'local_resource_filename',
  'combinedtype',
  'gvimport_time',
  'version',
  'gvuuid'
];

// Filter out computed columns
const GAMEVERSION_FIELDS = ALL_FIELDS.filter(f => 
  !COMPUTED_COLUMNS.includes(f)
);
```

---

## Migration

### SQL Migration (004)

```sql
ALTER TABLE gameversions ADD COLUMN local_resource_etag VARCHAR(255);
ALTER TABLE gameversions ADD COLUMN local_resource_lastmodified TIMESTAMP;
ALTER TABLE gameversions ADD COLUMN local_resource_filename VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_gameversions_local_filename 
  ON gameversions(local_resource_filename);
CREATE INDEX IF NOT EXISTS idx_gameversions_local_etag 
  ON gameversions(local_resource_etag);
```

**File**: `electron/sql/migrations/004_add_local_resource_tracking.sql`

### Backfill (Optional)

For existing records, backfill local_resource_filename:

```javascript
// Backfill script (optional)
const records = db.prepare(`
  SELECT gvuuid, gameid, version 
  FROM gameversions 
  WHERE local_resource_filename IS NULL
`).all();

for (const record of records) {
  const filename = record.version === 1
    ? `zips/${record.gameid}.zip`
    : `zips/${record.gameid}_${record.version}.zip`;
  
  // Only set if file actually exists
  if (fs.existsSync(filename)) {
    db.prepare(`
      UPDATE gameversions 
      SET local_resource_filename = ?
      WHERE gvuuid = ?
    `).run(filename, record.gvuuid);
  }
}
```

---

## Benefits

### 1. Bandwidth Savings
- HEAD requests are tiny (~500 bytes) vs full downloads (MBs)
- Skip downloads when files unchanged
- Estimated savings: 90%+ for update checks

### 2. Time Savings
- HEAD request: ~500ms
- Full download: ~30 seconds (5 MB file)
- Skip unnecessary processing

### 3. Storage Efficiency
- Preserve old ZIP versions
- Avoid duplicate storage
- Hash-based deduplication

### 4. Accurate Change Detection
- ETags are cryptographic hashes (server-generated)
- More reliable than size/date comparisons
- Catches subtle file changes

---

## Examples

### Example 1: ETag-Based Skip

```
Version 1:
  local_resource_etag: "abc123"
  local_resource_filename: "zips/39116.zip"

Update Check:
  HEAD request to new URL
  Response ETag: "abc123" (MATCH!)
  Action: Skip download, update stats only
```

### Example 2: ETag Change - Download Needed

```
Version 1:
  local_resource_etag: "abc123"
  local_resource_filename: "zips/39116.zip"

Update Check:
  HEAD request to new URL
  Response ETag: "def456" (CHANGED!)
  Action: Download new file, create version 2
  
Version 2:
  local_resource_etag: "def456"
  local_resource_filename: "zips/39116_2.zip"
```

### Example 3: Duplicate ZIP Detection

```
Version 1:
  ZIP hash: a1b2c3d4
  local_resource_filename: "zips/39116.zip"

Version 2 Download:
  ZIP hash: a1b2c3d4 (SAME!)
  Action: Reuse version 1 ZIP and patchblobs
  local_resource_filename: "zips/39116.zip" (same)
  Note: Don't create duplicate file or records
```

---

## URL Change Detection Examples

### Major Changes (Create New Version)

```javascript
// Example 1: Filename version changed
OLD: "dl.smwcentral.net/39116/Binary%20World%201.0.11.zip"
NEW: "dl.smwcentral.net/39116/Binary%20World%201.0.12.zip"
extractPathAndFilename(OLD): "/39116/Binary%20World%201.0.11.zip"
extractPathAndFilename(NEW): "/39116/Binary%20World%201.0.12.zip"
Result: NOT EQUAL → MAJOR CHANGE ✓

// Example 2: Path changed
OLD: "dl.smwcentral.net/39116/game.zip"
NEW: "dl.smwcentral.net/39117/game.zip"
extractPathAndFilename(OLD): "/39116/game.zip"
extractPathAndFilename(NEW): "/39117/game.zip"
Result: NOT EQUAL → MAJOR CHANGE ✓

// Example 3: Size changed >5%
OLD: size="500000"
NEW: size="600000"
Change: 100000 / 500000 * 100 = 20%
Result: >5% → MAJOR CHANGE ✓
```

### Minor Changes (Ignore)

```javascript
// Example 1: Hostname only
OLD: "dl.smwcentral.net/39116/file.zip"
NEW: "dl2.smwcentral.net/39116/file.zip"
extractPathAndFilename(OLD): "/39116/file.zip"
extractPathAndFilename(NEW): "/39116/file.zip"
Result: EQUAL → MINOR CHANGE (ignore) ✓

// Example 2: Protocol only
OLD: "http://dl.smwcentral.net/39116/file.zip"
NEW: "https://dl.smwcentral.net/39116/file.zip"
extractPathAndFilename(OLD): "/39116/file.zip"
extractPathAndFilename(NEW): "/39116/file.zip"
Result: EQUAL → MINOR CHANGE (ignore) ✓

// Example 3: Size changed <5%
OLD: size="500000"
NEW: size="510000"
Change: 10000 / 500000 * 100 = 2%
Result: <5% → MINOR CHANGE (ignore) ✓
```

---

## Configuration

### Thresholds

```javascript
const CONFIG = {
  // Size change threshold for major change
  SIZE_CHANGE_THRESHOLD_PERCENT: 5,
  
  // File size threshold for HEAD request optimization
  HEAD_REQUEST_SIZE_THRESHOLD: 5 * 1024 * 1024, // 5 MB
  
  // ZIP storage
  ZIP_STORAGE_PATTERN_V1: 'zips/{gameid}.zip',
  ZIP_STORAGE_PATTERN_V2PLUS: 'zips/{gameid}_{version}.zip'
};
```

---

## Best Practices

### For Developers

1. **Always set tracking fields** when downloading
2. **Always use HEAD request** for large files (>5 MB)
3. **Never overwrite old ZIP versions**
4. **Check for duplicates** before saving
5. **Exclude from JSON imports** - These are computed!

### For Curators

1. **Don't manually edit** local_resource_* fields
2. **Preserve old ZIP files** - Don't delete versioned files
3. **Check local_resource_filename** to find physical files

### For System Administrators

1. **Backup zips/ directory** regularly
2. **Monitor disk space** - Versioned files accumulate
3. **Implement cleanup policy** for very old versions (optional)

---

## Troubleshooting

### local_resource_filename points to missing file

**Cause**: ZIP file was deleted or moved  
**Solution**: Re-download if needed, or mark record

### ETag is NULL for all records

**Cause**: Server doesn't provide ETag headers  
**Fallback**: Use Last-Modified or size comparison

### Multiple versions point to same ZIP file

**Cause**: Duplicate detection found identical files  
**Expected**: This is correct behavior (saves space)

### Version 2 saved as zips/39116.zip instead of zips/39116_2.zip

**Cause**: Bug in filename determination  
**Fix**: Check version number is correctly passed to filename function

---

## Schema Definition

```sql
CREATE TABLE gameversions (
  -- ... existing fields ...
  
  -- Local Resource Tracking (Computed Columns)
  local_resource_etag VARCHAR(255),
  local_resource_lastmodified TIMESTAMP,
  local_resource_filename VARCHAR(500),
  
  -- ... other fields ...
);

CREATE INDEX idx_gameversions_local_filename ON gameversions(local_resource_filename);
CREATE INDEX idx_gameversions_local_etag ON gameversions(local_resource_etag);
```

---

## Related Documentation

- **Phase 2 Spec**: `docs/NEW_UPDATE_SCRIPT_PHASE2_SPEC.md` - Complete change detection specification
- **Schema Reference**: `docs/GAMEVERSIONS_TABLE_SCHEMA.md` - All gameversions fields
- **Computed Columns**: This document - Local resource tracking details

---

## Summary

The `local_resource_*` fields enable efficient, intelligent change detection that:

- ✅ Minimizes unnecessary downloads (HEAD request optimization)
- ✅ Preserves old file versions (versioned storage)
- ✅ Prevents duplicate storage (hash-based deduplication)
- ✅ Tracks HTTP metadata (ETag, Last-Modified)
- ✅ Enables accurate change detection

**Classification**: **COMPUTED COLUMNS** - Managed by updategames.js, not importable from JSON.

---

**Document Version**: 1.0  
**Date**: October 12, 2025  
**Status**: Specification Complete ✅

