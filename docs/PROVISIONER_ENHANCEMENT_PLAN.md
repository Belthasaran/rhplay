# Database Provisioner Enhancement Plan

## Overview

This plan covers enhancements to the Electron app's database provisioning system to support:
1. Multiple download location search (user-friendly file discovery) in addition to workingdi/downloads directory.
2. URL-based downloads with priority ordering
3. Provisioned database tracking via `provisioned.json`
4. Version-based reprovisioning logic

## Current State

### Existing Components
- **Provisioner UI**: `electron/renderer/src/Provisioner.vue`
- **Provisioning Script**: `electron/installer/prepare_databases.js`
- **Manifest File**: `electron/dbmanifest.json`
- **Main App Integration**: `electron/main.js` (checks for missing databases)

### Current Download Flow
1. Checks if file exists in `workingDir` (downloads directory)
2. If missing, attempts IPFS download (multiple gateways)
3. Falls back to ArDrive/Arweave download
4. Verifies SHA256 hash
5. Extracts and applies SQL patches

## Enhancement 1: Multiple Download Location Search

### Goal
Allow users to place downloaded files in common locations without manual path configuration.

### Search Locations (in order)
1. **Current working directory** (existing behavior)
   - Path: `workingDir` (from `getProvisionerPaths()`)
   - This is the directory users can open via "Download Folder" button

2. **Executable directory** (portable apps)
   - Windows: Directory containing `.exe` file
   - Linux: Directory containing AppImage
   - macOS: Directory containing `.app` bundle (Contents/MacOS)

3. **OS Downloads directory**
   - Windows: `%USERPROFILE%\Downloads`
   - Linux: `$HOME/Downloads` or `$XDG_DOWNLOAD_DIR`
   - macOS: `~/Downloads`

### Implementation Details

#### File: `electron/installer/prepare_databases.js`

**New Function: `searchLocalFile(spec, searchPaths)`**
```javascript
/**
 * Search for a file matching the spec in multiple locations
 * SHA256 hash is REQUIRED for file matching - files without matching hash are rejected
 * @param {Object} spec - File specification from manifest (base or patch)
 * @param {Array<string>} searchPaths - Array of directory paths to search
 * @returns {string|null} - Path to found file, or null if not found
 */
function searchLocalFile(spec, searchPaths) {
  const fileName = spec.file_name;
  const expectedExt = path.extname(fileName);
  const expectedSize = spec.size ? parseInt(spec.size, 10) : null;
  const expectedSha256 = spec.sha256;
  
  // SHA256 is required for file search
  if (!expectedSha256) {
    console.warn(`[search-local] ${fileName}: SHA256 not provided in manifest, skipping local search`);
    return null;
  }
  
  for (const searchDir of searchPaths) {
    if (!fs.existsSync(searchDir)) {
      continue;
    }
    
    // Search recursively in directory
    const found = findFileInDirectory(searchDir, fileName, {
      extension: expectedExt,
      size: expectedSize,
      sha256: expectedSha256
    });
    
    if (found) {
      return found;
    }
  }
  
  return null;
}

/**
 * Recursively search for file matching criteria
 */
function findFileInDirectory(dir, fileName, criteria) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      // Skip symlinks to avoid loops
      if (entry.isSymbolicLink()) {
        continue;
      }
      
      if (entry.isDirectory()) {
        // Recursively search subdirectories
        const found = findFileInDirectory(fullPath, fileName, criteria);
        if (found) {
          return found;
        }
      } else if (entry.isFile()) {
        // Check if file matches
        if (matchesFileCriteria(fullPath, fileName, criteria)) {
          return fullPath;
        }
      }
    }
  } catch (err) {
    // Skip directories we can't read
    return null;
  }
  
  return null;
}

/**
 * Check if file matches criteria (extension, size, SHA256)
 * Checks are performed in order: extension (fastest), size (fast), SHA256 (slowest but definitive)
 * SHA256 is REQUIRED - files without matching hash are rejected
 */
function matchesFileCriteria(filePath, expectedFileName, criteria) {
  // SHA256 is required
  if (!criteria.sha256) {
    return false;
  }
  
  const stats = fs.statSync(filePath);
  
  // Step 1: Check extension (fastest check)
  if (criteria.extension) {
    const fileExt = path.extname(filePath);
    if (fileExt.toLowerCase() !== criteria.extension.toLowerCase()) {
      return false;
    }
  }
  
  // Step 2: Check size (fast check, exact match required)
  // Size is the exact size of the compressed archive in bytes
  if (criteria.size !== null && criteria.size !== undefined) {
    if (stats.size !== criteria.size) {
      return false;
    }
  }
  
  // Step 3: Check SHA256 hash (slowest but definitive verification)
  // This is the final and required check
  const actualHash = sha256File(filePath);
  if (actualHash !== criteria.sha256) {
    return false;
  }
  
  return true;
}
```

**Modify `ensureArtifact()` function:**
- Before attempting downloads, search local paths (if SHA256 is provided in spec)
- Local search requires SHA256 hash - files are matched by extension, exact size, and SHA256
- If found locally, copy to `workingDir` (hash already verified during search)
- Only proceed to download if not found locally

**New Function: `getSearchPaths(userDataDir, workingDir)`**
```javascript
function getSearchPaths(userDataDir, workingDir) {
  const paths = [workingDir]; // Current downloads directory (highest priority)
  
  // Executable directory
  if (process.resourcesPath) {
    // In packaged app, resourcesPath points to app resources
    // Executable is typically one level up
    const execDir = path.dirname(process.execPath);
    paths.push(execDir);
  } else {
    // Development mode: use __dirname
    paths.push(path.dirname(__dirname));
  }
  
  // OS Downloads directory
  const platform = process.platform;
  if (platform === 'win32') {
    paths.push(path.join(os.homedir(), 'Downloads'));
  } else if (platform === 'darwin') {
    paths.push(path.join(os.homedir(), 'Downloads'));
  } else {
    // Linux
    const xdgDownload = process.env.XDG_DOWNLOAD_DIR;
    if (xdgDownload) {
      paths.push(xdgDownload);
    }
    paths.push(path.join(os.homedir(), 'Downloads'));
  }
  
  return paths.filter(p => p && fs.existsSync(path.dirname(p)));
}
```

## Enhancement 2: URL Support with Priority Ordering

### Goal
Add support for direct HTTP/HTTPS URLs in `dbmanifest.json` with configurable download priority.

### Manifest Schema Changes

#### New Attributes in `base` and `sqlpatches` entries:

```json
{
  "rhdata.db": {
    "version": "6",
    "base": {
      "file_name": "full_rhdata_2025_11_24.tar.xz",
      "sha256": "...",
      "size": "...",
      "ipfs_cidv1": "...",
      "url": "https://example.com/filename.tar.xz",
      // OR
      "url": [
        "https://site1.example.com/filename.tar.xz",
        "https://site2.example.com/filename.tar.xz"
      ],
      "priority": ["ipfs", "url.0", "url.1", "ardrive"]
    }
  }
}
```

### Priority System

**Priority Tokens:**
- `ipfs` - Attempt IPFS download (tries all gateways)
- `url` - Try all URLs in order (shorthand for url.0, url.1, etc.)
- `url.0` - First URL in array
- `url.1` - Second URL in array
- `url.2` - Third URL, etc.
- `ardrive` - ArDrive/Arweave download

**Default Priority** (if not specified):
```javascript
["ipfs", "ardrive"]
```

**Priority with URLs** (if URLs present but no priority specified):
```javascript
["ipfs", "url", "ardrive"]
```

### Implementation Details

#### File: `electron/installer/prepare_databases.js`

**New Function: `parsePriority(priority, spec)`**
```javascript
/**
 * Parse priority array and expand shorthand tokens
 * @param {Array<string>|undefined} priority - Priority array from manifest
 * @param {Object} spec - File specification
 * @returns {Array<Object>} - Array of download source objects
 */
function parsePriority(priority, spec) {
  if (!priority) {
    // Default priority based on available sources
    const sources = [];
    if (spec.ipfs_cidv1) {
      sources.push({ type: 'ipfs', cid: spec.ipfs_cidv1 });
    }
    if (spec.url) {
      const urls = Array.isArray(spec.url) ? spec.url : [spec.url];
      urls.forEach((url, idx) => {
        sources.push({ type: 'url', url, index: idx });
      });
    }
    if (spec.data_txid || spec.ardrive_file_path) {
      sources.push({ type: 'ardrive', txid: spec.data_txid, path: spec.ardrive_file_path });
    }
    return sources;
  }
  
  const sources = [];
  const urlArray = Array.isArray(spec.url) ? spec.url : (spec.url ? [spec.url] : []);
  
  for (const token of priority) {
    if (token === 'ipfs' && spec.ipfs_cidv1) {
      sources.push({ type: 'ipfs', cid: spec.ipfs_cidv1 });
    } else if (token === 'ardrive' && (spec.data_txid || spec.ardrive_file_path)) {
      sources.push({ type: 'ardrive', txid: spec.data_txid, path: spec.ardrive_file_path });
    } else if (token === 'url') {
      // Expand to all URLs
      urlArray.forEach((url, idx) => {
        sources.push({ type: 'url', url, index: idx });
      });
    } else if (token.startsWith('url.')) {
      const idx = parseInt(token.substring(4), 10);
      if (!isNaN(idx) && idx >= 0 && idx < urlArray.length) {
        sources.push({ type: 'url', url: urlArray[idx], index: idx });
      }
    }
  }
  
  return sources;
}
```

**Modify `ensureArtifact()` function:**
```javascript
async function ensureArtifact(spec, workingDir, downloadTracker) {
  const destPath = path.join(workingDir, spec.file_name);
  
  if (downloadTracker) {
    downloadTracker.register(spec);
  }
  
  // Check if already downloaded and valid
  if (fs.existsSync(destPath) && (!spec.sha256 || sha256File(destPath) === spec.sha256)) {
    console.log(`[download-cached] ${spec.file_name} already present with matching hash.`);
    if (downloadTracker) {
      downloadTracker.skip(spec);
    }
    return destPath;
  }
  
  // Search local paths first (before any downloads)
  const searchPaths = getSearchPaths(plan.userDataDir, workingDir);
  const localFile = searchLocalFile(spec, searchPaths);
  if (localFile) {
    console.log(`[download-local] Found ${spec.file_name} at ${localFile}`);
    // Copy to working directory
    fs.copyFileSync(localFile, destPath);
    // Verify hash
    if (spec.sha256 && sha256File(destPath) !== spec.sha256) {
      fs.unlinkSync(destPath);
      throw new Error(`Local file hash mismatch for ${spec.file_name}`);
    }
    if (downloadTracker) {
      downloadTracker.skip(spec);
    }
    return destPath;
  }
  
  // Parse priority and attempt downloads in order
  const priority = spec.priority || (spec.url ? ['ipfs', 'url', 'ardrive'] : ['ipfs', 'ardrive']);
  const sources = parsePriority(priority, spec);
  
  let lastError = null;
  
  for (const source of sources) {
    try {
      if (source.type === 'ipfs') {
        // Try all IPFS gateways
        for (const gateway of IPFS_GATEWAYS) {
          const url = `${gateway}${source.cid}`;
          try {
            await downloadFromUrl(url, destPath, spec.sha256, spec, downloadTracker, `ipfs:${gateway}`);
            return destPath;
          } catch (err) {
            lastError = err;
            console.error(`[download-error] ${spec.file_name} via ipfs:${gateway} -> ${err.message}`);
          }
        }
      } else if (source.type === 'url') {
        try {
          await downloadFromUrl(source.url, destPath, spec.sha256, spec, downloadTracker, `url:${source.index}`);
          return destPath;
        } catch (err) {
          lastError = err;
          console.error(`[download-error] ${spec.file_name} via url.${source.index} -> ${err.message}`);
        }
      } else if (source.type === 'ardrive') {
        // Existing ArDrive logic
        if (source.txid) {
          const url = `https://arweave.net/${source.txid}`;
          try {
            await downloadFromUrl(url, destPath, spec.sha256, spec, downloadTracker, 'arweave:data_txid');
            return destPath;
          } catch (err) {
            lastError = err;
            console.error(`[download-error] ${spec.file_name} via arweave:data_txid -> ${err.message}`);
          }
        } else if (source.path) {
          const url = `https://arweave.net${source.path}`;
          try {
            await downloadFromUrl(url, destPath, spec.sha256, spec, downloadTracker, 'arweave:ardrive_path');
            return destPath;
          } catch (err) {
            lastError = err;
            console.error(`[download-error] ${spec.file_name} via arweave:ardrive_path -> ${err.message}`);
          }
        }
      }
    } catch (err) {
      lastError = err;
    }
  }
  
  throw new Error(
    `Failed to download ${spec.file_name}: ${lastError ? lastError.message : 'no sources available'}`
  );
}
```

## Enhancement 3: Provisioned Database Tracking

### Goal
Track successfully provisioned databases with version numbers, timestamps, and hash information in `provisioned.json`.

### File Structure: `provisioned.json`

```json
{
  "targets": {
    "rhdata.db": {
      "version": "6",
      "timestamp": "1764782619",
      "patch": "rhdata-20251203-to006.sql.xz",
      "base_sha256": "92abd802b315235fa261a82ccf9b0cd455813a63026497ff8e204badb5a37cc2",
      "patch_sha256": "c41d82b8d78c45aed6ac57cf7b0d4285576d87ba28f5aef0580d040be302eab9"
    },
    "patchbin.db": {
      "version": "6",
      "timestamp": "1764782620",
      "patch": "bare_patchbin_2025_11_01-readdXX012.sql.xz",
      "base_sha256": "37194e9bd78628a84e6700fd90a052af79ecf7f2f1ff860f99cc3f6bdd601d98",
      "patch_sha256": "79eb57c97c45281866957254a76ff5ef20aa26df2aa4ddd736a830b368a3698b"
    }
  },
  "hashdata": {
    "sha256": "a1b2c3d4e5f6..."
  }
}
```

### Implementation Details

#### File: `electron/installer/prepare_databases.js`

**New Function: `loadProvisionedJson(userDataDir)`**
```javascript
function loadProvisionedJson(userDataDir) {
  const filePath = path.join(userDataDir, 'provisioned.json');
  if (!fs.existsSync(filePath)) {
    return { targets: {}, hashdata: { sha256: null } };
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    
    // Verify hash if present
    if (data.hashdata && data.hashdata.sha256) {
      const computedHash = computeProvisionedHash(data);
      if (computedHash !== data.hashdata.sha256) {
        console.warn('[provisioned.json] Hash verification failed, file may be corrupted');
        return { targets: {}, hashdata: { sha256: null } };
      }
    }
    
    return data;
  } catch (err) {
    console.warn(`[provisioned.json] Failed to load: ${err.message}`);
    return { targets: {}, hashdata: { sha256: null } };
  }
}
```

**New Function: `computeProvisionedHash(data)`**
```javascript
function computeProvisionedHash(data) {
  // Create copy without hashdata
  const { hashdata, ...dataWithoutHash } = data;
  // Minify JSON
  const jsonString = JSON.stringify(dataWithoutHash);
  // Compute SHA256
  return crypto.createHash('sha256').update(jsonString, 'utf8').digest('hex');
}
```

**New Function: `saveProvisionedJson(userDataDir, data)`**
```javascript
function saveProvisionedJson(userDataDir, data) {
  // Compute hash
  const hash = computeProvisionedHash(data);
  data.hashdata = { sha256: hash };
  
  const filePath = path.join(userDataDir, 'provisioned.json');
  ensureDirectory(userDataDir);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}
```

**New Function: `updateProvisionedEntry(userDataDir, dbName, manifestEntry, baseSha256, lastPatchSha256, lastPatchFileName)`**
```javascript
function updateProvisionedEntry(userDataDir, dbName, manifestEntry, baseSha256, lastPatchSha256, lastPatchFileName) {
  const provisioned = loadProvisionedJson(userDataDir);
  
  const version = manifestEntry.version || '0';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  
  provisioned.targets[dbName] = {
    version,
    timestamp,
    patch: lastPatchFileName || null,
    base_sha256: baseSha256,
    patch_sha256: lastPatchSha256 || null
  };
  
  saveProvisionedJson(userDataDir, provisioned);
}
```

**Modify `buildDatabaseFromManifest()` function:**
- After successful provisioning, call `updateProvisionedEntry()`
- Pass base SHA256, last patch SHA256, and last patch filename

**Modify `executeProvision()` function:**
- After each successful database provisioning, update `provisioned.json`
- Track which patch was last applied

## Enhancement 4: Version-Based Reprovisioning

### Goal
Support version-based reprovisioning logic based on `reprovision` and `updates` attributes in `dbmanifest.json`.

### Manifest Schema Changes

```json
{
  "rhdata.db": {
    "version": "6",
    "reprovision": "yes",
    "updates": [
      {
        "5": "reprovision",
        "6": "patch"
      }
    ],
    "base": { ... },
    "sqlpatches": [ ... ]
  }
}
```

### Reprovisioning Logic

1. **If `reprovision: "yes"` is set:**
   - Check `provisioned.json` for existing version
   - If version is older than manifest version:
     - Check `updates` array for specific version instructions
     - If version has "patch" instruction: attempt patching
     - If version has "reprovision" instruction: full reprovision
     - If no specific instruction: default to reprovision

2. **If `reprovision` is not set or `"no"`:**
   - Never trigger reprovisioning based on version
   - Only provision if database is missing

3. **Patching Logic:**
   - **CRITICAL**: Work on a temporary copy of the existing database
   - Copy existing database to staging directory
   - Apply only patches that haven't been applied yet to the temporary copy
   - Only after all patches succeed, copy the updated database to final location
   - This ensures the original database is never corrupted if patching fails
   - Update `provisioned.json` with new patch information

### Implementation Details

#### File: `electron/installer/prepare_databases.js`

**New Function: `checkReprovisionNeeded(dbName, manifestEntry, provisioned)`**
```javascript
function checkReprovisionNeeded(dbName, manifestEntry, provisioned) {
  // If reprovision not set, never reprovision
  if (!manifestEntry.reprovision || manifestEntry.reprovision !== 'yes') {
    return { needed: false, reason: 'reprovision not enabled' };
  }
  
  const provisionedEntry = provisioned.targets[dbName];
  if (!provisionedEntry) {
    return { needed: true, reason: 'not provisioned', action: 'reprovision' };
  }
  
  const manifestVersion = manifestEntry.version || '0';
  const provisionedVersion = provisionedEntry.version || '0';
  
  // Compare versions (simple string comparison, assumes numeric versions)
  if (provisionedVersion < manifestVersion) {
    // Check updates array for specific instructions
    if (Array.isArray(manifestEntry.updates)) {
      for (const updateRule of manifestEntry.updates) {
        if (typeof updateRule === 'object' && updateRule[provisionedVersion]) {
          const action = updateRule[provisionedVersion];
          return {
            needed: true,
            reason: `version ${provisionedVersion} requires ${action}`,
            action: action
          };
        }
      }
    }
    
    // Default: reprovision
    return {
      needed: true,
      reason: `version ${provisionedVersion} < ${manifestVersion}`,
      action: 'reprovision'
    };
  }
  
  return { needed: false, reason: 'version up to date' };
}
```

**New Function: `applyPatchesFromVersion(dbName, existingDbPath, manifestEntry, provisionedEntry, planPaths, downloadTracker)`**
```javascript
/**
 * Apply patches to an existing database by working on a temporary copy
 * Only after all patches succeed, copy the updated database to final location
 * This ensures the original database is not corrupted if patching fails
 */
async function applyPatchesFromVersion(dbName, existingDbPath, manifestEntry, provisionedEntry, planPaths, downloadTracker) {
  const { stagingDir } = planPaths;
  ensureDirectory(stagingDir);
  
  // Create temporary copy of existing database
  const tempDbPath = path.join(stagingDir, `${dbName}.patch.tmp.db`);
  const finalDbPath = path.join(planPaths.finalDir, dbName);
  
  console.log(`[patch] ${dbName}: Creating temporary copy for patching`);
  fs.copyFileSync(existingDbPath, tempDbPath);
  
  try {
    const patches = Array.isArray(manifestEntry.sqlpatches) ? manifestEntry.sqlpatches : [];
    patches.sort((a, b) => a.file_name.localeCompare(b.file_name, 'en', { numeric: true }));
    
    // Find where to start patching
    const lastPatch = provisionedEntry.patch;
    let startIndex = 0;
    
    if (lastPatch) {
      const lastIndex = patches.findIndex(p => p.file_name === lastPatch);
      if (lastIndex >= 0) {
        startIndex = lastIndex + 1;
      }
    }
    
    // Apply remaining patches to temporary copy
    let lastPatchSha256 = provisionedEntry.patch_sha256 || null;
    let lastPatchFileName = provisionedEntry.patch || null;
    
    for (let i = startIndex; i < patches.length; i++) {
      const patch = patches[i];
      const patchArchivePath = await ensureArtifact(patch, planPaths.downloadsDir, downloadTracker);
      console.log(`[patch-start] ${dbName}: applying ${patch.file_name}`);
      const sqlPath = path.join(stagingDir, patch.file_name.replace(/\.xz$/i, ''));
      await decompressXz(patchArchivePath, sqlPath);
      await applySqlPatch(tempDbPath, sqlPath, patch.file_name);
      fs.unlinkSync(sqlPath);
      console.log(`[patch-complete] ${dbName}: applied ${patch.file_name}`);
      
      // Track last applied patch
      lastPatchSha256 = patch.sha256;
      lastPatchFileName = patch.file_name;
    }
    
    // All patches succeeded - now copy to final location
    ensureDirectory(path.dirname(finalDbPath));
    fs.copyFileSync(tempDbPath, finalDbPath);
    fs.unlinkSync(tempDbPath);
    
    console.log(`[provision] ${dbName}: patching completed, database updated at ${finalDbPath}`);
    
    return {
      success: true,
      lastPatchSha256,
      lastPatchFileName
    };
  } catch (err) {
    // Clean up temporary file on error
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
    throw err;
  }
}
```

**Modify `inspectDatabases()` function:**
- Load `provisioned.json`
- For each database, check if reprovisioning is needed
- Set `action` to `'reprovision'` or `'patch'` if needed

**Modify `executeProvision()` function:**
- Handle `'patch'` action differently from `'provision-from-manifest'`
- For patching: 
  - Load existing DB path from userDataDir
  - Call `applyPatchesFromVersion()` which works on temporary copy
  - Only after successful patching, copy updated DB to final location
  - Update `provisioned.json` with new patch information
- For reprovisioning: full reprovision (existing logic, also uses temporary files)

#### File: `electron/main.js`

**Modify `getMissingDatabases()` function:**
- Load `provisioned.json`
- Load `dbmanifest.json`
- Check if reprovisioning is needed based on version
- Return list of databases that need attention (missing OR need reprovision)

**New Function: `checkReprovisionNeeded()` in main.js**
- Similar logic to prepare_databases.js
- Used to determine if provisioner mode should start

## File Locations Summary

### Files to Modify:
1. `electron/installer/prepare_databases.js`
   - Add local file search
   - Add URL support with priority
   - Add provisioned.json tracking
   - Add reprovisioning logic

2. `electron/main.js`
   - Update `getMissingDatabases()` to check reprovisioning
   - Add provisioned.json loading

3. `electron/dbmanifest.json`
   - Add `url` and `priority` attributes (as needed)
   - Add `reprovision` and `updates` attributes (as needed)

### New Files:
- `provisioned.json` (created at runtime in userDataDir)

## Testing Considerations

1. **Local File Search:**
   - Test with files in Downloads directory
   - Test with files in executable directory
   - Test with files in working directory
   - Test hash verification

2. **URL Priority:**
   - Test with single URL
   - Test with multiple URLs
   - Test priority ordering
   - Test fallback behavior

3. **Provisioned Tracking:**
   - Test creation of provisioned.json
   - Test hash verification
   - Test version tracking
   - Test patch tracking

4. **Reprovisioning:**
   - Test version comparison
   - Test patch vs reprovision logic
   - Test updates array parsing

## Migration Notes

- Existing installations without `provisioned.json` will be treated as unprovisioned
- First run after update will create `provisioned.json`
- Version "0" is used for databases without version in manifest
- Backward compatible: works with manifests without new attributes

