# Update Script Phase 2 Specification - Change Detection & Version Management

## Document Version
Version: 1.1  
Date: October 12, 2025 (Updated)  
Purpose: Detect and manage updates to existing game records  
Prerequisite: Phase 1 implementation must be completed

---

## 1. Executive Summary

### 1.1 Overview

Phase 2 extends the `updategames.js` script to detect and appropriately handle changes to existing games in the database. While Phase 1 focuses on adding new games, Phase 2 implements intelligent change detection that distinguishes between:

- **Major Changes**: Significant updates requiring a new version record (name change, patch update, author correction, download URL/file changes, etc.)
- **Minor Changes**: Statistical/metadata updates tracked separately (download counts, ratings, comments)
- **Resource Changes**: File version updates detected via URL changes, size changes, and HTTP headers (ETag, Last-Modified)

### 1.2 Goals

1. **Smart Change Detection**: Compare fetched metadata with existing records
2. **Version Control**: Create new gameversion records only for significant changes
3. **Statistics Tracking**: Maintain current status of minor attributes without version bloat
4. **Efficiency**: Minimize database growth while preserving important history
5. **Auditability**: Clear record of what changed and when

### 1.3 Key Features

- Configurable classification of major vs minor fields
- Automatic detection of field additions/removals
- Timestamp-based tracking of statistics
- Backward compatibility with existing version tracking
- Optional notification of major changes

---

## 2. Resource Versioning & Change Detection

### 2.1 Local Resource Tracking (New Schema Fields)

Three new fields added to the `gameversions` table to track downloaded resources:

#### 2.1.1 local_resource_etag (VARCHAR 255)
- **Purpose**: Store HTTP ETag header from download response
- **Source**: `ETag` HTTP response header
- **Usage**: Efficient change detection via HTTP HEAD requests
- **Example**: `"33a64df551425fcc55e4d42a148795d9f25f89d4"`
- **Classification**: **COMPUTED COLUMN** - Not updated from JSON imports

#### 2.1.2 local_resource_lastmodified (TIMESTAMP)
- **Purpose**: Store HTTP Last-Modified header from download response
- **Source**: `Last-Modified` HTTP response header
- **Usage**: Alternative change detection mechanism
- **Example**: `"2024-10-20 15:30:45"`
- **Classification**: **COMPUTED COLUMN** - Not updated from JSON imports

#### 2.1.3 local_resource_filename (VARCHAR 500)
- **Purpose**: Local filesystem path where ZIP was saved
- **Source**: Computed by downloader
- **Format**: 
  - Version 1: `zips/<GAMEID>.zip`
  - Version 2+: `zips/<GAMEID>_<VERSION>.zip`
- **Example**: `"zips/39116_2.zip"`
- **Classification**: **COMPUTED COLUMN** - Not updated from JSON imports

### 2.2 Computed Columns List

**IMPORTANT**: These columns are managed by the updategames script and must **NOT** be updated from external JSON data:

- `local_resource_etag`
- `local_resource_lastmodified`
- `local_resource_filename`
- `combinedtype` (computed from other fields)
- `gvimport_time` (auto-generated timestamp)
- `version` (auto-incremented)

Scripts importing JSON data (loaddata.js, updategames.js) must skip these fields when processing external data.

### 2.3 Download URL Change Detection

#### 2.3.1 Major Download Changes (Trigger New Version)

Changes to the download URL that indicate a new file version:

**Filename Changes** (MAJOR):
```
OLD: dl.smwcentral.net/39116/Binary%20World%201.0.11.zip
NEW: dl.smwcentral.net/39116/Binary%20World%201.0.12.zip
                                    ^^^^^^^^  Version changed in filename
Result: MAJOR CHANGE - Download and process new file
```

**Path Changes** (MAJOR):
```
OLD: dl.smwcentral.net/39116/Original.zip
NEW: dl.smwcentral.net/39117/Updated.zip
                      ^^^^^  Path component changed
Result: MAJOR CHANGE - Download and process new file
```

**Size Changes** (MAJOR):
```
OLD: size: "500000"
NEW: size: "750000"
     Size increased significantly
Result: MAJOR CHANGE - Download and process new file
```

#### 2.3.2 Minor Download Changes (Ignore)

Changes that do NOT indicate a new file version:

**Hostname Changes** (MINOR - IGNORE):
```
OLD: dl.smwcentral.net/39116/Binary%20World%201.0.11.zip
NEW: dl2.smwcentral.net/39116/Binary%20World%201.0.11.zip
     ^^^  Server hostname changed
Result: MINOR - Same file, different CDN endpoint
```

**Protocol Changes** (MINOR - IGNORE):
```
OLD: http://dl.smwcentral.net/39116/file.zip
NEW: https://dl.smwcentral.net/39116/file.zip
     ^^ Protocol upgrade
Result: MINOR - Same file, secure protocol
```

**Relative vs Absolute** (MINOR - IGNORE):
```
OLD: //dl.smwcentral.net/39116/file.zip
NEW: https://dl.smwcentral.net/39116/file.zip
Result: MINOR - Same file, different URL format
```

#### 2.3.3 URL Comparison Algorithm

```javascript
function isSignificantUrlChange(oldUrl, newUrl, oldSize, newSize) {
  // 1. Normalize URLs (remove protocol, hostname)
  const oldPath = extractPathAndFilename(oldUrl);
  const newPath = extractPathAndFilename(newUrl);
  
  // 2. Compare paths and filenames
  if (oldPath !== newPath) {
    return true; // MAJOR: Path or filename changed
  }
  
  // 3. Compare sizes
  const sizeDiff = Math.abs(parseInt(newSize) - parseInt(oldSize));
  const sizeChangePercent = sizeDiff / parseInt(oldSize) * 100;
  
  if (sizeChangePercent > 5) {
    return true; // MAJOR: Size changed by more than 5%
  }
  
  // 4. No significant change
  return false; // MINOR: Only hostname/protocol changed
}

function extractPathAndFilename(url) {
  // Remove protocol
  let path = url.replace(/^https?:\/\//, '').replace(/^\/\//, '');
  
  // Remove hostname
  path = path.substring(path.indexOf('/'));
  
  return path;
}
```

### 2.4 HTTP HEAD Request Optimization

Before downloading a file that appears to have changed, use HTTP HEAD request to check if file actually changed:

#### 2.4.1 HEAD Request Logic

```javascript
async function shouldDownloadFile(gameversion, newMetadata, downloadUrl) {
  // 1. Check if URL changed significantly
  const urlChanged = isSignificantUrlChange(
    gameversion.download_url,
    newMetadata.download_url,
    gameversion.size,
    newMetadata.size
  );
  
  if (!urlChanged) {
    return { download: false, reason: 'url_unchanged' };
  }
  
  // 2. If size is large, do HEAD request first
  const estimatedSize = parseInt(newMetadata.size) || 0;
  const SIZE_THRESHOLD = 5 * 1024 * 1024; // 5 MB
  
  if (estimatedSize > SIZE_THRESHOLD) {
    const headResponse = await makeHeadRequest(downloadUrl);
    
    if (headResponse.success) {
      // 3. Compare ETag if available
      if (gameversion.local_resource_etag && headResponse.etag) {
        if (gameversion.local_resource_etag === headResponse.etag) {
          return { download: false, reason: 'etag_match' };
        }
      }
      
      // 4. Compare Last-Modified if available
      if (gameversion.local_resource_lastmodified && headResponse.lastModified) {
        const oldTime = new Date(gameversion.local_resource_lastmodified).getTime();
        const newTime = new Date(headResponse.lastModified).getTime();
        
        if (oldTime === newTime) {
          return { download: false, reason: 'lastmodified_match' };
        }
      }
      
      // 5. Compare size from HEAD response
      if (headResponse.contentLength) {
        const oldSize = parseInt(gameversion.size);
        const newSize = headResponse.contentLength;
        
        if (oldSize === newSize) {
          return { download: false, reason: 'size_match' };
        }
      }
    }
  }
  
  // 6. Download needed
  return { download: true, reason: 'change_detected' };
}

async function makeHeadRequest(url) {
  try {
    const response = await fetch(url, { 
      method: 'HEAD',
      headers: { 'User-Agent': CONFIG.USER_AGENT }
    });
    
    return {
      success: response.ok,
      etag: response.headers.get('ETag'),
      lastModified: response.headers.get('Last-Modified'),
      contentLength: parseInt(response.headers.get('Content-Length'))
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

### 2.5 Versioned ZIP Storage

#### 2.5.1 Filename Convention

```javascript
function determineZipFilename(gameid, version) {
  if (version === 1) {
    return `zips/${gameid}.zip`;
  } else {
    return `zips/${gameid}_${version}.zip`;
  }
}
```

**Examples**:
- Version 1: `zips/39116.zip`
- Version 2: `zips/39116_2.zip`
- Version 3: `zips/39116_3.zip`

#### 2.5.2 Duplicate Prevention

Before saving a ZIP file:

1. **Check if file already exists** at target path
2. **Calculate hash** of downloaded content
3. **Compare with existing files** for same gameid
4. **Reuse existing** if hash matches (avoid duplicate storage)

```javascript
async function saveZipFile(gameid, version, zipData) {
  const targetPath = determineZipFilename(gameid, version);
  
  // 1. Check if exact file already exists
  if (fs.existsSync(targetPath)) {
    const existingHash = calculateFileHash(targetPath);
    const newHash = calculateBufferHash(zipData);
    
    if (existingHash === newHash) {
      console.log(`  ⓘ File already exists with same content: ${targetPath}`);
      return targetPath;
    }
    
    // File exists but different - this shouldn't happen with versioning
    throw new Error(`File exists with different content: ${targetPath}`);
  }
  
  // 2. Check if any other version has same hash (deduplication)
  const duplicatePath = findDuplicateZipByHash(gameid, zipData);
  if (duplicatePath) {
    console.log(`  ⓘ Identical ZIP found: ${duplicatePath}`);
    // Don't create duplicate, reuse existing patchblobs
    return duplicatePath;
  }
  
  // 3. Save new file
  const tempPath = `${targetPath}.new`;
  fs.writeFileSync(tempPath, zipData);
  fs.renameSync(tempPath, targetPath);
  
  console.log(`  ✓ Saved: ${targetPath}`);
  return targetPath;
}
```

## 2.6 Change Classification System

### 2.6.1 Major Changes

These changes warrant creating a new version record in the `gameversions` table:

#### 2.6.1.1 Critical Metadata Changes
- **name**: Game title change
- **author** / **authors**: Author information change
- **description**: Description text change
- **difficulty**: Difficulty classification change
- **length**: Length classification change
- **gametype** / **type**: Game type change

#### 2.6.1.2 Download/Patch-Related Changes (CRITICAL)
- **download_url**: Download URL path/filename change (not just hostname)
- **name_href**: Alternative download URL path/filename change
- **size**: ZIP file size change (>5% variation)
- **patchblob1_name**: Primary patch blob change
- **pat_sha224**: Patch hash change

**URL Change Detection**:
```
MAJOR: /39116/Binary%20World%201.0.11.zip → /39116/Binary%20World%201.0.12.zip
MAJOR: /39116/file.zip → /39117/file.zip (path changed)
MAJOR: size: "500000" → size: "600000" (>5% change)
MINOR: dl.smwcentral.net → dl2.smwcentral.net (hostname only)
MINOR: http:// → https:// (protocol only)
```

#### 2.6.1.3 Status Changes
- **removed**: Game removal status change
- **obsoleted**: Obsolescence status change
- **obsoleted_by**: Obsoleting game ID change
- **moderated**: Moderation status change

#### 2.6.1.4 Structural Changes
- **demo**: Demo status change
- **featured**: Featured status change
- **tags**: Tag list changes (additions/removals)

### 2.6.2 Minor Changes

These changes are tracked in `gameversion_stats` only:

#### 2.6.2.1 Statistical Data
- Download counts
- View counts
- Comment counts
- Rating values
- Rating counts
- Favorite counts

#### 2.6.2.2 Volatile Metadata
- **images**: Image URLs or image metadata
- **comments**: Comment content (tracked by count only)
- **hof** (Hall of Fame): HOF status indicators
- **rom**: ROM file paths (internal tracking)
- **romblob_name**: ROM blob name (internal)
- **romblob_salt**: ROM blob salt (internal)
- **local_resource_*** fields: Computed columns (managed by script)

#### 2.6.2.3 Unknown Fields
- Any new fields introduced by SMWC that aren't in our classification lists
- Tracked to prevent loss but don't trigger versions

### 2.6.3 Ignored Changes

These changes are not tracked at all (computed/derived values):

- Timestamps (added, time) if only difference
- URL formatting variations (trailing slashes, protocol changes)
- Whitespace-only changes
- Empty string vs NULL equivalence

---

## 3. Database Schema Additions

### 3.1 New Table: `gameversion_stats`

Maintains current statistics for each game (one record per gameid):

```sql
CREATE TABLE gameversion_stats (
  gvstatuuid varchar(255) primary key DEFAULT (uuid()),
  gameid varchar(255) NOT NULL UNIQUE,
  gvuuid varchar(255) REFERENCES gameversions(gvuuid),  -- Latest version
  
  -- Statistics (extracted from gvjsondata for quick access)
  download_count INTEGER,
  view_count INTEGER,
  comment_count INTEGER,
  rating_value REAL,
  rating_count INTEGER,
  favorite_count INTEGER,
  
  -- HOF/Featured tracking
  hof_status varchar(50),
  featured_status varchar(50),
  
  -- Full current JSON data
  gvjsondata text NOT NULL,
  
  -- Change tracking
  previous_gvjsondata text,         -- Previous state for comparison
  last_major_change TIMESTAMP,      -- When last version was created
  last_minor_change TIMESTAMP,      -- When stats were last updated
  change_count INTEGER DEFAULT 0,   -- Number of minor updates
  
  -- Metadata
  first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(gameid)
);

CREATE INDEX idx_gvstats_gameid ON gameversion_stats(gameid);
CREATE INDEX idx_gvstats_gvuuid ON gameversion_stats(gvuuid);
CREATE INDEX idx_gvstats_last_updated ON gameversion_stats(last_updated);
```

### 3.2 New Table: `change_detection_log`

Audit log of detected changes:

```sql
CREATE TABLE change_detection_log (
  loguuid varchar(255) primary key DEFAULT (uuid()),
  gameid varchar(255) NOT NULL,
  gvuuid varchar(255) REFERENCES gameversions(gvuuid),
  
  change_type varchar(50) NOT NULL,  -- 'major', 'minor', 'none'
  detection_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- What changed
  changed_fields text,               -- JSON array of field names
  field_changes text,                -- JSON object with old/new values
  
  -- Action taken
  action_taken varchar(100),         -- 'created_version', 'updated_stats', 'ignored'
  new_gvuuid varchar(255),          -- If version created, its UUID
  
  -- Metadata
  metadata jsonb                     -- Additional context
);

CREATE INDEX idx_cdlog_gameid ON change_detection_log(gameid);
CREATE INDEX idx_cdlog_type ON change_detection_log(change_type);
CREATE INDEX idx_cdlog_time ON change_detection_log(detection_time);
```

### 3.3 New Table: `change_detection_config`

Configurable classification of fields:

```sql
CREATE TABLE change_detection_config (
  cfguuid varchar(255) primary key DEFAULT (uuid()),
  field_name varchar(255) NOT NULL UNIQUE,
  classification varchar(50) NOT NULL,  -- 'major', 'minor', 'ignored'
  weight INTEGER DEFAULT 1,             -- For threshold-based detection
  notes text,
  active BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Initial configuration data
INSERT INTO change_detection_config (field_name, classification, weight, notes) VALUES
  ('name', 'major', 10, 'Game title'),
  ('author', 'major', 8, 'Primary author'),
  ('authors', 'major', 8, 'Author list'),
  ('description', 'major', 7, 'Game description'),
  ('difficulty', 'major', 6, 'Difficulty classification'),
  ('length', 'major', 6, 'Length classification'),
  ('gametype', 'major', 6, 'Game type'),
  ('type', 'major', 6, 'Game type (alternate)'),
  ('download_url', 'major', 9, 'Download URL'),
  ('patchblob1_name', 'major', 10, 'Patch blob identifier'),
  ('pat_sha224', 'major', 10, 'Patch hash'),
  ('size', 'major', 5, 'File size'),
  ('removed', 'major', 8, 'Removal status'),
  ('obsoleted', 'major', 8, 'Obsolescence status'),
  ('obsoleted_by', 'major', 7, 'Obsoleting game'),
  ('moderated', 'major', 6, 'Moderation status'),
  ('demo', 'major', 5, 'Demo status'),
  ('featured', 'major', 4, 'Featured status'),
  ('tags', 'major', 5, 'Tag list'),
  ('download_count', 'minor', 1, 'Download statistics'),
  ('downloads', 'minor', 1, 'Download statistics (alternate)'),
  ('views', 'minor', 1, 'View statistics'),
  ('comments', 'minor', 1, 'Comment data'),
  ('comment_count', 'minor', 1, 'Comment count'),
  ('rating', 'minor', 1, 'Rating value'),
  ('rating_count', 'minor', 1, 'Rating count'),
  ('favorites', 'minor', 1, 'Favorite count'),
  ('hof', 'minor', 1, 'Hall of Fame status'),
  ('images', 'minor', 1, 'Image URLs'),
  ('screenshots', 'minor', 1, 'Screenshot data'),
  ('rom', 'ignored', 0, 'Internal ROM path'),
  ('romblob_name', 'ignored', 0, 'Internal ROM blob'),
  ('romblob_salt', 'ignored', 0, 'Internal ROM salt'),
  ('time', 'ignored', 0, 'Timestamp field'),
  ('added', 'ignored', 0, 'Added timestamp');
```

---

## 4. Change Detection Logic

### 4.1 Comparison Algorithm

```javascript
class ChangeDetector {
  constructor(dbManager) {
    this.dbManager = dbManager;
    this.config = this.loadConfiguration();
  }
  
  /**
   * Load field classification configuration
   */
  loadConfiguration() {
    const rows = this.dbManager.db.prepare(`
      SELECT field_name, classification, weight 
      FROM change_detection_config 
      WHERE active = 1
    `).all();
    
    const config = {
      major: new Map(),
      minor: new Map(),
      ignored: new Set()
    };
    
    for (const row of rows) {
      if (row.classification === 'major') {
        config.major.set(row.field_name, row.weight);
      } else if (row.classification === 'minor') {
        config.minor.set(row.field_name, row.weight);
      } else if (row.classification === 'ignored') {
        config.ignored.add(row.field_name);
      }
    }
    
    return config;
  }
  
  /**
   * Detect changes between old and new game data
   * Returns: { type: 'major'|'minor'|'none', changes: [...], score: number }
   */
  detectChanges(oldRecord, newMetadata) {
    // Parse JSON data
    const oldData = typeof oldRecord.gvjsondata === 'string' 
      ? JSON.parse(oldRecord.gvjsondata) 
      : oldRecord.gvjsondata;
    
    const newData = this.normalizeMetadata(newMetadata);
    
    // Find all changed fields
    const changes = this.compareObjects(oldData, newData);
    
    if (changes.length === 0) {
      return { type: 'none', changes: [], score: 0 };
    }
    
    // Classify changes
    const classification = this.classifyChanges(changes);
    
    return classification;
  }
  
  /**
   * Normalize metadata from SMWC (equivalent to fix_hentry)
   */
  normalizeMetadata(raw) {
    const normalized = { ...raw };
    
    // Apply same normalization as Phase 1
    if (!normalized.added && normalized.time) {
      const date = new Date(parseInt(normalized.time) * 1000);
      normalized.added = date.toISOString();
    }
    
    if (normalized.difficulty && !normalized.type) {
      normalized.type = normalized.difficulty;
    }
    
    if (!normalized.name_href && normalized.download_url) {
      normalized.name_href = normalized.download_url;
    }
    
    if (!normalized.download_url && normalized.name_href) {
      normalized.download_url = normalized.name_href;
    }
    
    if (!normalized.author && normalized.authors) {
      if (typeof normalized.authors === 'string') {
        normalized.author = normalized.authors;
      } else if (Array.isArray(normalized.authors)) {
        normalized.author = normalized.authors.map(a => a.name).join(', ');
        normalized.authors = normalized.author;
      }
    }
    
    return normalized;
  }
  
  /**
   * Compare two objects and find changed fields
   */
  compareObjects(oldObj, newObj) {
    const changes = [];
    
    // Get union of all keys
    const allKeys = new Set([
      ...Object.keys(oldObj),
      ...Object.keys(newObj)
    ]);
    
    for (const key of allKeys) {
      // Skip ignored fields
      if (this.config.ignored.has(key)) {
        continue;
      }
      
      const oldVal = oldObj[key];
      const newVal = newObj[key];
      
      // Normalize for comparison
      const oldNorm = this.normalizeValue(oldVal);
      const newNorm = this.normalizeValue(newVal);
      
      // Compare
      if (!this.valuesEqual(oldNorm, newNorm)) {
        changes.push({
          field: key,
          oldValue: oldVal,
          newValue: newVal,
          changeType: this.getChangeType(oldVal, newVal)
        });
      }
    }
    
    return changes;
  }
  
  /**
   * Normalize value for comparison
   */
  normalizeValue(val) {
    // Treat null, undefined, empty string as equivalent
    if (val === null || val === undefined || val === '') {
      return null;
    }
    
    // Trim strings
    if (typeof val === 'string') {
      return val.trim();
    }
    
    // Sort arrays for comparison
    if (Array.isArray(val)) {
      return JSON.stringify([...val].sort());
    }
    
    // Stringify objects
    if (typeof val === 'object') {
      return JSON.stringify(val);
    }
    
    return val;
  }
  
  /**
   * Check if two normalized values are equal
   */
  valuesEqual(val1, val2) {
    if (val1 === val2) return true;
    
    // Both null-ish
    if (!val1 && !val2) return true;
    
    // Deep equality for objects/arrays (already stringified)
    if (typeof val1 === 'string' && typeof val2 === 'string') {
      return val1 === val2;
    }
    
    return false;
  }
  
  /**
   * Determine type of change
   */
  getChangeType(oldVal, newVal) {
    if (oldVal === null || oldVal === undefined || oldVal === '') {
      return 'added';
    }
    if (newVal === null || newVal === undefined || newVal === '') {
      return 'removed';
    }
    return 'modified';
  }
  
  /**
   * Classify changes as major or minor
   */
  classifyChanges(changes) {
    let majorScore = 0;
    let minorScore = 0;
    const majorChanges = [];
    const minorChanges = [];
    const unknownChanges = [];
    
    for (const change of changes) {
      const field = change.field;
      
      if (this.config.major.has(field)) {
        const weight = this.config.major.get(field);
        majorScore += weight;
        majorChanges.push(change);
      } else if (this.config.minor.has(field)) {
        const weight = this.config.minor.get(field);
        minorScore += weight;
        minorChanges.push(change);
      } else {
        // Unknown field - treat as minor but log it
        unknownChanges.push(change);
        minorScore += 1;
        console.log(`  ⓘ Unknown field detected: ${field}`);
      }
    }
    
    // Determine overall classification
    let type = 'none';
    if (majorScore > 0) {
      type = 'major';
    } else if (minorScore > 0 || unknownChanges.length > 0) {
      type = 'minor';
    }
    
    return {
      type,
      score: majorScore > 0 ? majorScore : minorScore,
      majorChanges,
      minorChanges,
      unknownChanges,
      totalChanges: changes.length
    };
  }
  
  /**
   * Create human-readable change summary
   */
  formatChangeSummary(classification) {
    const lines = [];
    
    if (classification.majorChanges.length > 0) {
      lines.push('Major changes:');
      for (const change of classification.majorChanges) {
        const oldStr = this.formatValue(change.oldValue);
        const newStr = this.formatValue(change.newValue);
        lines.push(`  - ${change.field}: ${change.changeType}`);
        lines.push(`      Old: ${oldStr}`);
        lines.push(`      New: ${newStr}`);
      }
    }
    
    if (classification.minorChanges.length > 0) {
      lines.push('Minor changes:');
      for (const change of classification.minorChanges) {
        lines.push(`  - ${change.field}: ${change.changeType}`);
      }
    }
    
    if (classification.unknownChanges.length > 0) {
      lines.push('Unknown fields:');
      for (const change of classification.unknownChanges) {
        lines.push(`  - ${change.field}: ${change.changeType}`);
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Format value for display
   */
  formatValue(val) {
    if (val === null || val === undefined || val === '') {
      return '(empty)';
    }
    
    if (typeof val === 'string') {
      return val.length > 100 ? val.substring(0, 97) + '...' : val;
    }
    
    if (Array.isArray(val)) {
      return `[${val.length} items]`;
    }
    
    if (typeof val === 'object') {
      return JSON.stringify(val).substring(0, 100);
    }
    
    return String(val);
  }
}
```

### 4.2 Statistics Extractor

```javascript
class StatisticsExtractor {
  /**
   * Extract statistics from JSON data
   */
  extractStats(jsonData) {
    const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    
    return {
      download_count: this.extractNumber(data, ['downloads', 'download_count']),
      view_count: this.extractNumber(data, ['views', 'view_count']),
      comment_count: this.extractNumber(data, ['comment_count', 'comments.count']),
      rating_value: this.extractNumber(data, ['rating', 'rating.value']),
      rating_count: this.extractNumber(data, ['rating_count', 'rating.count']),
      favorite_count: this.extractNumber(data, ['favorites', 'favorite_count']),
      hof_status: this.extractValue(data, ['hof', 'hall_of_fame']),
      featured_status: this.extractValue(data, ['featured'])
    };
  }
  
  /**
   * Extract numeric value from multiple possible paths
   */
  extractNumber(obj, paths) {
    for (const path of paths) {
      const val = this.getNestedValue(obj, path);
      if (val !== null && val !== undefined) {
        const num = Number(val);
        if (!isNaN(num)) {
          return num;
        }
      }
    }
    return null;
  }
  
  /**
   * Extract value from multiple possible paths
   */
  extractValue(obj, paths) {
    for (const path of paths) {
      const val = this.getNestedValue(obj, path);
      if (val !== null && val !== undefined) {
        return String(val);
      }
    }
    return null;
  }
  
  /**
   * Get nested value using dot notation
   */
  getNestedValue(obj, path) {
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return null;
      }
    }
    
    return current;
  }
}
```

---

## 5. Update Workflow

### 5.1 Main Update Process

```javascript
class UpdateProcessor {
  constructor(dbManager) {
    this.dbManager = dbManager;
    this.changeDetector = new ChangeDetector(dbManager);
    this.statsExtractor = new StatisticsExtractor();
  }
  
  /**
   * Process updates for existing games
   */
  async processExistingGames(fetchedGames) {
    console.log('\n[Update Detection] Processing existing games...');
    
    const existingIds = new Set(this.dbManager.getExistingGameIds());
    const existingGames = fetchedGames.filter(game => 
      existingIds.has(String(game.id))
    );
    
    console.log(`  Found ${existingGames.length} existing games to check`);
    
    let majorUpdates = 0;
    let minorUpdates = 0;
    let noChange = 0;
    let errors = 0;
    
    for (const game of existingGames) {
      const gameid = String(game.id);
      
      try {
        const result = await this.processGameUpdate(gameid, game);
        
        if (result.type === 'major') {
          majorUpdates++;
          console.log(`  [${gameid}] ✓ Major update - created version ${result.version}`);
        } else if (result.type === 'minor') {
          minorUpdates++;
          console.log(`  [${gameid}] ⓘ Minor update - stats refreshed`);
        } else {
          noChange++;
        }
      } catch (error) {
        errors++;
        console.error(`  [${gameid}] ✗ Error: ${error.message}`);
      }
    }
    
    console.log('\nUpdate Summary:');
    console.log(`  Major updates:    ${majorUpdates}`);
    console.log(`  Minor updates:    ${minorUpdates}`);
    console.log(`  No changes:       ${noChange}`);
    console.log(`  Errors:           ${errors}`);
    
    return {
      majorUpdates,
      minorUpdates,
      noChange,
      errors
    };
  }
  
  /**
   * Process update for a single game
   */
  async processGameUpdate(gameid, newMetadata) {
    // Get latest version
    const latestVersion = this.dbManager.getLatestVersionForGame(gameid);
    
    if (!latestVersion) {
      // Should not happen (existing game should have record)
      throw new Error(`No existing version found for game ${gameid}`);
    }
    
    // Detect changes
    const classification = this.changeDetector.detectChanges(
      latestVersion,
      newMetadata
    );
    
    if (classification.type === 'none') {
      return { type: 'none', gameid };
    }
    
    // Log changes
    const changeSummary = this.changeDetector.formatChangeSummary(classification);
    console.log(`\n  Game ${gameid} - ${newMetadata.name}:`);
    console.log(changeSummary);
    
    // Log to database
    this.logChangeDetection(gameid, latestVersion.gvuuid, classification);
    
    // Handle based on type
    if (classification.type === 'major') {
      return await this.handleMajorUpdate(gameid, latestVersion, newMetadata, classification);
    } else {
      return await this.handleMinorUpdate(gameid, latestVersion, newMetadata, classification);
    }
  }
  
  /**
   * Handle major update - create new version
   */
  async handleMajorUpdate(gameid, latestVersion, newMetadata, classification) {
    console.log(`  → Creating new version record...`);
    
    this.dbManager.beginTransaction();
    
    try {
      // Create new gameversion record (similar to Phase 1)
      const newVersion = this.createGameVersionFromUpdate(
        gameid,
        latestVersion,
        newMetadata,
        classification
      );
      
      // Update stats table
      this.updateGameStats(gameid, newVersion.gvuuid, newMetadata, true);
      
      // Update change log
      this.dbManager.db.prepare(`
        UPDATE change_detection_log 
        SET action_taken = 'created_version',
            new_gvuuid = ?
        WHERE loguuid = (
          SELECT loguuid FROM change_detection_log 
          WHERE gameid = ? 
          ORDER BY detection_time DESC 
          LIMIT 1
        )
      `).run(newVersion.gvuuid, gameid);
      
      this.dbManager.commit();
      
      return {
        type: 'major',
        gameid,
        gvuuid: newVersion.gvuuid,
        version: newVersion.version
      };
      
    } catch (error) {
      this.dbManager.rollback();
      throw error;
    }
  }
  
  /**
   * Handle minor update - update stats only
   */
  async handleMinorUpdate(gameid, latestVersion, newMetadata, classification) {
    console.log(`  → Updating statistics...`);
    
    // Update stats table
    this.updateGameStats(gameid, latestVersion.gvuuid, newMetadata, false);
    
    // Update change log
    this.dbManager.db.prepare(`
      UPDATE change_detection_log 
      SET action_taken = 'updated_stats'
      WHERE loguuid = (
        SELECT loguuid FROM change_detection_log 
        WHERE gameid = ? 
        ORDER BY detection_time DESC 
        LIMIT 1
      )
    `).run(gameid);
    
    return {
      type: 'minor',
      gameid,
      gvuuid: latestVersion.gvuuid
    };
  }
  
  /**
   * Create new gameversion record from update
   */
  createGameVersionFromUpdate(gameid, latestVersion, newMetadata, classification) {
    // Get next version number
    const nextVersion = (latestVersion.version || 0) + 1;
    
    // Create new record with updated data
    const data = {
      gvuuid: this.generateUUID(),
      gameid: gameid,
      version: nextVersion,
      section: newMetadata.section || latestVersion.section,
      gametype: newMetadata.type || newMetadata.gametype || latestVersion.gametype,
      name: newMetadata.name || latestVersion.name,
      time: newMetadata.time || latestVersion.time,
      added: newMetadata.added || latestVersion.added,
      moderated: newMetadata.moderated || latestVersion.moderated,
      author: newMetadata.author || latestVersion.author,
      authors: newMetadata.authors || latestVersion.authors,
      submitter: newMetadata.submitter || latestVersion.submitter,
      demo: newMetadata.demo || latestVersion.demo,
      featured: newMetadata.featured || latestVersion.featured,
      length: newMetadata.length || latestVersion.length,
      difficulty: newMetadata.difficulty || latestVersion.difficulty,
      url: newMetadata.url || latestVersion.url,
      download_url: newMetadata.download_url || latestVersion.download_url,
      name_href: newMetadata.name_href || latestVersion.name_href,
      author_href: newMetadata.author_href || latestVersion.author_href,
      obsoleted_by: newMetadata.obsoleted_by || latestVersion.obsoleted_by,
      size: newMetadata.size || latestVersion.size,
      description: newMetadata.description || latestVersion.description,
      tags: Array.isArray(newMetadata.tags) 
        ? JSON.stringify(newMetadata.tags) 
        : (newMetadata.tags || latestVersion.tags),
      tags_href: newMetadata.tags_href || latestVersion.tags_href,
      gvjsondata: JSON.stringify(newMetadata),
      gvchange_attributes: JSON.stringify(
        classification.majorChanges.map(c => c.field)
      ),
      removed: newMetadata.removed || latestVersion.removed,
      obsoleted: newMetadata.obsoleted || latestVersion.obsoleted
    };
    
    // Insert into database
    this.dbManager.createGameVersion(data);
    
    return data;
  }
  
  /**
   * Update gameversion_stats table
   */
  updateGameStats(gameid, gvuuid, metadata, isMajorUpdate) {
    const stats = this.statsExtractor.extractStats(metadata);
    const jsonData = JSON.stringify(metadata);
    
    // Check if stats record exists
    const existing = this.dbManager.db.prepare(`
      SELECT * FROM gameversion_stats WHERE gameid = ?
    `).get(gameid);
    
    if (existing) {
      // Update existing record
      const updateData = {
        gvuuid: gvuuid,
        download_count: stats.download_count,
        view_count: stats.view_count,
        comment_count: stats.comment_count,
        rating_value: stats.rating_value,
        rating_count: stats.rating_count,
        favorite_count: stats.favorite_count,
        hof_status: stats.hof_status,
        featured_status: stats.featured_status,
        previous_gvjsondata: existing.gvjsondata,
        gvjsondata: jsonData,
        last_updated: new Date().toISOString(),
        change_count: existing.change_count + 1
      };
      
      if (isMajorUpdate) {
        updateData.last_major_change = new Date().toISOString();
      } else {
        updateData.last_minor_change = new Date().toISOString();
      }
      
      const fields = Object.keys(updateData);
      const setClause = fields.map(f => `${f} = @${f}`).join(', ');
      
      this.dbManager.db.prepare(`
        UPDATE gameversion_stats 
        SET ${setClause}
        WHERE gameid = @gameid
      `).run({ ...updateData, gameid });
      
    } else {
      // Create new record
      const insertData = {
        gvstatuuid: this.generateUUID(),
        gameid: gameid,
        gvuuid: gvuuid,
        download_count: stats.download_count,
        view_count: stats.view_count,
        comment_count: stats.comment_count,
        rating_value: stats.rating_value,
        rating_count: stats.rating_count,
        favorite_count: stats.favorite_count,
        hof_status: stats.hof_status,
        featured_status: stats.featured_status,
        gvjsondata: jsonData,
        previous_gvjsondata: null,
        last_major_change: isMajorUpdate ? new Date().toISOString() : null,
        last_minor_change: !isMajorUpdate ? new Date().toISOString() : null,
        change_count: 0
      };
      
      const fields = Object.keys(insertData);
      const placeholders = fields.map(f => `@${f}`).join(', ');
      
      this.dbManager.db.prepare(`
        INSERT INTO gameversion_stats (${fields.join(', ')})
        VALUES (${placeholders})
      `).run(insertData);
    }
  }
  
  /**
   * Log change detection to database
   */
  logChangeDetection(gameid, gvuuid, classification) {
    const data = {
      loguuid: this.generateUUID(),
      gameid: gameid,
      gvuuid: gvuuid,
      change_type: classification.type,
      changed_fields: JSON.stringify(
        [...classification.majorChanges, ...classification.minorChanges]
          .map(c => c.field)
      ),
      field_changes: JSON.stringify({
        major: classification.majorChanges,
        minor: classification.minorChanges,
        unknown: classification.unknownChanges
      }),
      action_taken: 'pending',
      metadata: JSON.stringify({
        score: classification.score,
        totalChanges: classification.totalChanges
      })
    };
    
    const fields = Object.keys(data);
    const placeholders = fields.map(f => `@${f}`).join(', ');
    
    this.dbManager.db.prepare(`
      INSERT INTO change_detection_log (${fields.join(', ')})
      VALUES (${placeholders})
    `).run(data);
  }
  
  generateUUID() {
    return require('crypto').randomUUID();
  }
}
```

---

## 6. Integration with Phase 1

### 6.1 Main Script Updates

Add to `updategames.js`:

```javascript
// Command line options
.option('check-updates', {
  description: 'Check for updates to existing games',
  type: 'boolean',
  default: true
})
.option('update-stats-only', {
  description: 'Only update statistics, skip version creation',
  type: 'boolean',
  default: false
})
.option('since', {
  description: 'Only check games updated since date (YYYY-MM-DD)',
  type: 'string'
})

// In main()
async function main() {
  // ... existing Phase 1 code ...
  
  // Step 6: Process updates to existing games (Phase 2)
  if (argv['check-updates']) {
    console.log('[Step 6/7] Checking for updates to existing games...');
    
    const updateProcessor = new UpdateProcessor(dbManager);
    await updateProcessor.processExistingGames(gamesList);
  }
  
  // ... rest of code ...
}
```

### 6.2 Initialization

On first run with Phase 2, initialize stats table:

```javascript
/**
 * Initialize gameversion_stats table from existing data
 */
async function initializeStatsTable(dbManager) {
  console.log('Initializing gameversion_stats table...');
  
  const games = dbManager.db.prepare(`
    SELECT gameid, gvuuid, gvjsondata, gvimport_time
    FROM gameversions gv
    WHERE version = (
      SELECT MAX(version) 
      FROM gameversions 
      WHERE gameid = gv.gameid
    )
  `).all();
  
  console.log(`  Processing ${games.length} games...`);
  
  const statsExtractor = new StatisticsExtractor();
  
  for (const game of games) {
    const stats = statsExtractor.extractStats(game.gvjsondata);
    
    dbManager.db.prepare(`
      INSERT OR REPLACE INTO gameversion_stats (
        gvstatuuid, gameid, gvuuid, 
        download_count, view_count, comment_count,
        rating_value, rating_count, favorite_count,
        hof_status, featured_status,
        gvjsondata, last_major_change, first_seen
      ) VALUES (
        @gvstatuuid, @gameid, @gvuuid,
        @download_count, @view_count, @comment_count,
        @rating_value, @rating_count, @favorite_count,
        @hof_status, @featured_status,
        @gvjsondata, @last_major_change, @first_seen
      )
    `).run({
      gvstatuuid: crypto.randomUUID(),
      gameid: game.gameid,
      gvuuid: game.gvuuid,
      download_count: stats.download_count,
      view_count: stats.view_count,
      comment_count: stats.comment_count,
      rating_value: stats.rating_value,
      rating_count: stats.rating_count,
      favorite_count: stats.favorite_count,
      hof_status: stats.hof_status,
      featured_status: stats.featured_status,
      gvjsondata: game.gvjsondata,
      last_major_change: game.gvimport_time,
      first_seen: game.gvimport_time
    });
  }
  
  console.log('  ✓ Stats table initialized');
}

// Add to main() on first Phase 2 run
if (!dbManager.tableExists('gameversion_stats')) {
  await initializeStatsTable(dbManager);
}
```

---

## 7. Reporting & Analytics

### 7.1 Change Report Generator

```javascript
class ChangeReporter {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }
  
  /**
   * Generate change report for a time period
   */
  generateReport(startDate, endDate) {
    const report = {
      period: { start: startDate, end: endDate },
      summary: this.getSummary(startDate, endDate),
      majorChanges: this.getMajorChanges(startDate, endDate),
      minorChanges: this.getMinorChanges(startDate, endDate),
      topChangedGames: this.getTopChangedGames(startDate, endDate),
      newFields: this.getNewFields(startDate, endDate)
    };
    
    return report;
  }
  
  /**
   * Get summary statistics
   */
  getSummary(startDate, endDate) {
    const row = this.dbManager.db.prepare(`
      SELECT 
        COUNT(*) as total_changes,
        SUM(CASE WHEN change_type = 'major' THEN 1 ELSE 0 END) as major_count,
        SUM(CASE WHEN change_type = 'minor' THEN 1 ELSE 0 END) as minor_count,
        COUNT(DISTINCT gameid) as games_affected
      FROM change_detection_log
      WHERE detection_time BETWEEN ? AND ?
    `).get(startDate, endDate);
    
    return row;
  }
  
  /**
   * Get major changes detail
   */
  getMajorChanges(startDate, endDate) {
    return this.dbManager.db.prepare(`
      SELECT 
        cdl.*,
        gv.name as game_name
      FROM change_detection_log cdl
      JOIN gameversions gv ON cdl.gameid = gv.gameid
      WHERE cdl.change_type = 'major'
        AND cdl.detection_time BETWEEN ? AND ?
      ORDER BY cdl.detection_time DESC
    `).all(startDate, endDate);
  }
  
  /**
   * Get minor changes summary
   */
  getMinorChanges(startDate, endDate) {
    return this.dbManager.db.prepare(`
      SELECT 
        gameid,
        COUNT(*) as update_count,
        MAX(detection_time) as last_update
      FROM change_detection_log
      WHERE change_type = 'minor'
        AND detection_time BETWEEN ? AND ?
      GROUP BY gameid
      ORDER BY update_count DESC
      LIMIT 20
    `).all(startDate, endDate);
  }
  
  /**
   * Get games with most changes
   */
  getTopChangedGames(startDate, endDate) {
    return this.dbManager.db.prepare(`
      SELECT 
        gvs.gameid,
        gv.name as game_name,
        gvs.change_count,
        gvs.last_major_change,
        gvs.last_minor_change
      FROM gameversion_stats gvs
      JOIN gameversions gv ON gvs.gvuuid = gv.gvuuid
      WHERE gvs.last_updated BETWEEN ? AND ?
      ORDER BY gvs.change_count DESC
      LIMIT 20
    `).all(startDate, endDate);
  }
  
  /**
   * Detect new fields that appeared
   */
  getNewFields(startDate, endDate) {
    const logs = this.dbManager.db.prepare(`
      SELECT DISTINCT field_changes
      FROM change_detection_log
      WHERE detection_time BETWEEN ? AND ?
    `).all(startDate, endDate);
    
    const allFields = new Set();
    
    for (const log of logs) {
      const changes = JSON.parse(log.field_changes);
      
      for (const change of [...changes.major, ...changes.minor, ...changes.unknown]) {
        if (change.changeType === 'added') {
          allFields.add(change.field);
        }
      }
    }
    
    return Array.from(allFields);
  }
  
  /**
   * Format report as text
   */
  formatReport(report) {
    const lines = [];
    
    lines.push('='.repeat(60));
    lines.push('Change Detection Report');
    lines.push('='.repeat(60));
    lines.push('');
    lines.push(`Period: ${report.period.start} to ${report.period.end}`);
    lines.push('');
    
    lines.push('Summary:');
    lines.push(`  Total changes:    ${report.summary.total_changes}`);
    lines.push(`  Major changes:    ${report.summary.major_count}`);
    lines.push(`  Minor changes:    ${report.summary.minor_count}`);
    lines.push(`  Games affected:   ${report.summary.games_affected}`);
    lines.push('');
    
    if (report.majorChanges.length > 0) {
      lines.push('Recent Major Changes:');
      for (const change of report.majorChanges.slice(0, 10)) {
        lines.push(`  [${change.gameid}] ${change.game_name}`);
        lines.push(`    Time: ${change.detection_time}`);
        lines.push(`    Fields: ${change.changed_fields}`);
      }
      lines.push('');
    }
    
    if (report.topChangedGames.length > 0) {
      lines.push('Most Frequently Updated Games:');
      for (const game of report.topChangedGames.slice(0, 10)) {
        lines.push(`  [${game.gameid}] ${game.game_name}: ${game.change_count} updates`);
      }
      lines.push('');
    }
    
    if (report.newFields.length > 0) {
      lines.push('New Fields Detected:');
      for (const field of report.newFields) {
        lines.push(`  - ${field}`);
      }
      lines.push('');
    }
    
    lines.push('='.repeat(60));
    
    return lines.join('\n');
  }
}
```

### 7.2 Report Command

Add to CLI:

```bash
node updategames.js --report --since=2025-10-01
```

---

## 8. Testing Strategy

### 8.1 Test Cases

#### 8.1.1 Major Change Detection
- Change game name
- Change author
- Change description
- Change download URL (new patch)
- Change difficulty/length classification
- Change obsolescence status

#### 8.1.2 Minor Change Detection
- Update download count
- Update rating
- Update comment count
- Update featured status
- Add/remove screenshots

#### 8.1.3 Mixed Changes
- Major + minor changes in same update
- Multiple major changes
- Multiple minor changes

#### 8.1.4 Edge Cases
- NULL to value transitions
- Value to NULL transitions
- Empty string vs NULL
- Whitespace-only changes
- Array reordering (should not trigger change)

### 8.2 Test Data

Create test fixtures with known changes:

```javascript
const testCases = [
  {
    name: 'Name change',
    old: { id: '12345', name: 'Old Name', author: 'Author' },
    new: { id: '12345', name: 'New Name', author: 'Author' },
    expected: 'major'
  },
  {
    name: 'Download count change',
    old: { id: '12345', name: 'Game', downloads: 100 },
    new: { id: '12345', name: 'Game', downloads: 150 },
    expected: 'minor'
  },
  {
    name: 'No change',
    old: { id: '12345', name: 'Game', author: 'Author' },
    new: { id: '12345', name: 'Game', author: 'Author' },
    expected: 'none'
  }
];
```

### 8.3 Validation

- Verify version numbers increment correctly
- Verify stats table updates
- Verify change logs are created
- Verify no duplicate versions for minor changes
- Verify gvchange_attributes correctly lists changed fields

---

## 9. Performance Optimization

### 9.1 Batch Processing

Process updates in batches to improve performance:

```javascript
async function processBatch(games, batchSize = 100) {
  for (let i = 0; i < games.length; i += batchSize) {
    const batch = games.slice(i, i + batchSize);
    await Promise.all(batch.map(game => processGameUpdate(game)));
  }
}
```

### 9.2 Indexing

Ensure proper indexes exist:

```sql
CREATE INDEX IF NOT EXISTS idx_gv_gameid_version 
  ON gameversions(gameid, version DESC);
  
CREATE INDEX IF NOT EXISTS idx_gvstats_updated 
  ON gameversion_stats(last_updated);
  
CREATE INDEX IF NOT EXISTS idx_cdlog_gameid_time 
  ON change_detection_log(gameid, detection_time DESC);
```

### 9.3 Caching

Cache configuration and latest versions:

```javascript
class CachedDbManager extends DatabaseManager {
  constructor(dbPath) {
    super(dbPath);
    this.latestVersionCache = new Map();
    this.configCache = null;
  }
  
  getLatestVersionCached(gameid) {
    if (!this.latestVersionCache.has(gameid)) {
      const version = this.getLatestVersionForGame(gameid);
      this.latestVersionCache.set(gameid, version);
    }
    return this.latestVersionCache.get(gameid);
  }
  
  clearCache() {
    this.latestVersionCache.clear();
    this.configCache = null;
  }
}
```

---

## 10. Configuration Management

### 10.1 Field Classification Updates

Add command to update field classifications:

```bash
node updategames.js --config-field name=major weight=10
node updategames.js --config-field downloads=minor weight=1
node updategames.js --config-list
```

### 10.2 Thresholds

Allow configurable thresholds for change detection:

```javascript
const THRESHOLDS = {
  // Create version if score exceeds this
  majorChangeThreshold: 5,
  
  // Minimum number of major fields that must change
  majorFieldCountThreshold: 1,
  
  // Size change percentage to consider major
  sizeChangePercentage: 10,
  
  // Days between checks (for scheduled runs)
  updateCheckInterval: 7
};
```

---

## 11. Migration & Rollout

### 11.1 Migration Steps

1. **Schema Update**: Apply new table definitions
2. **Configuration**: Initialize `change_detection_config` table
3. **Stats Initialization**: Run `initializeStatsTable()`
4. **Test Run**: Use `--dry-run` on subset of games
5. **Full Run**: Process all existing games
6. **Validation**: Verify no unwanted versions created

### 11.2 Rollback Plan

If issues arise:

1. Keep original `gameversions` table intact
2. Drop new version records by timestamp
3. Drop `gameversion_stats` table
4. Restore from backup if necessary

### 11.3 Monitoring

- Monitor version count growth
- Alert on unexpected major version creation
- Review change detection logs regularly
- Validate stats updates are occurring

---

## 12. Example Usage

### 12.1 Standard Update Run

```bash
# Fetch new games and check for updates
node updategames.js

# Only check updates (skip new games)
node updategames.js --no-process-new --check-updates

# Update stats only (don't create versions)
node updategames.js --update-stats-only

# Generate report for last 30 days
node updategames.js --report --since=2025-09-12
```

### 12.2 Specific Game Update

```bash
# Check specific games for updates
node updategames.js --game-ids=12345,12346 --check-updates
```

### 12.3 Configuration

```bash
# List current field configuration
node updategames.js --config-list

# Add new field classification
node updategames.js --config-add screenshots=minor weight=1

# Update field classification
node updategames.js --config-update downloads=ignored
```

---

## 13. Future Enhancements (Phase 3)

Potential additions for future phases:

1. **Automated Change Review**: UI for reviewing detected changes before version creation
2. **Smart Thresholds**: Machine learning to classify changes
3. **Rollback Capability**: Undo incorrect version creation
4. **Change Notifications**: Email/webhook when major changes detected
5. **Diff Viewer**: Visual comparison of old vs new data
6. **Bulk Operations**: Batch update classifications
7. **API Integration**: REST API for change detection queries
8. **Statistics Dashboard**: Web UI showing update trends

---

## Appendix A: SQL Query Reference

### Get Games Needing Update Check

```sql
SELECT gv.gameid, gv.name, gvs.last_updated
FROM gameversions gv
LEFT JOIN gameversion_stats gvs ON gv.gameid = gvs.gameid
WHERE gv.version = (
  SELECT MAX(version) FROM gameversions WHERE gameid = gv.gameid
)
AND (gvs.last_updated IS NULL OR gvs.last_updated < datetime('now', '-7 days'))
ORDER BY gvs.last_updated ASC NULLS FIRST;
```

### Get Recent Major Changes

```sql
SELECT 
  cdl.gameid,
  gv.name,
  cdl.changed_fields,
  cdl.detection_time,
  cdl.new_gvuuid
FROM change_detection_log cdl
JOIN gameversions gv ON cdl.new_gvuuid = gv.gvuuid
WHERE cdl.change_type = 'major'
  AND cdl.detection_time > datetime('now', '-30 days')
ORDER BY cdl.detection_time DESC;
```

### Get Statistics Trends

```sql
SELECT 
  gameid,
  download_count,
  rating_value,
  comment_count,
  last_updated
FROM gameversion_stats
WHERE last_updated > datetime('now', '-7 days')
ORDER BY download_count DESC
LIMIT 50;
```

### Get Version History

```sql
SELECT 
  version,
  gvchange_attributes,
  gvimport_time
FROM gameversions
WHERE gameid = '12345'
ORDER BY version ASC;
```

---

## Appendix B: Change Classification Examples

### Example 1: Major Change (Name)

```json
{
  "type": "major",
  "score": 10,
  "majorChanges": [
    {
      "field": "name",
      "oldValue": "Super Mario World: The Adventure",
      "newValue": "Super Mario World: The Grand Adventure",
      "changeType": "modified"
    }
  ],
  "minorChanges": [],
  "action": "create_version"
}
```

### Example 2: Minor Change (Stats)

```json
{
  "type": "minor",
  "score": 3,
  "majorChanges": [],
  "minorChanges": [
    {
      "field": "downloads",
      "oldValue": 1500,
      "newValue": 1653,
      "changeType": "modified"
    },
    {
      "field": "rating",
      "oldValue": 4.5,
      "newValue": 4.6,
      "changeType": "modified"
    }
  ],
  "action": "update_stats"
}
```

### Example 3: Mixed Changes

```json
{
  "type": "major",
  "score": 15,
  "majorChanges": [
    {
      "field": "description",
      "oldValue": "A short description",
      "newValue": "A much longer and more detailed description...",
      "changeType": "modified"
    },
    {
      "field": "difficulty",
      "oldValue": "Normal",
      "newValue": "Hard",
      "changeType": "modified"
    }
  ],
  "minorChanges": [
    {
      "field": "downloads",
      "oldValue": 500,
      "newValue": 550,
      "changeType": "modified"
    }
  ],
  "action": "create_version"
}
```

---

## Document Approval

This Phase 2 specification should be reviewed after successful Phase 1 implementation. Key considerations:

1. Change classification rules are appropriate
2. Version creation triggers are acceptable
3. Statistics tracking meets reporting needs
4. Performance characteristics are adequate
5. Migration from Phase 1 is feasible

---

**End of Phase 2 Specification Document**

