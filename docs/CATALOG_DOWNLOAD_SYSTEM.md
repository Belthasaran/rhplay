# Catalog Download and Manifest System

**Version**: 1.0  
**Last Updated**: January 2025  
**Purpose**: Documentation for the automatic download system for catalog files and BPS archives

---

## Table of Contents

1. [Overview](#overview)
2. [bpsarchives.json Manifest](#bpsarchivesjson-manifest)
3. [Download Manager](#download-manager)
4. [Manifest Management](#manifest-management)
5. [Catalog Updates](#catalog-updates)
6. [Integration with Electron App](#integration-with-electron-app)
7. [Usage Examples](#usage-examples)

---

## Overview

The Catalog Download System provides automatic downloading of:
- **Catalog Files**: `rhsearch_cat.db` and `rhsearch.zip` for the search catalog
- **BPS Archives**: 7z archives containing BPS patch files (e.g., `bps_00.7z`, `bps_4c.7z`)

### Key Features

- **Multiple Download Sources**: IPFS, ArDrive, direct URLs, base64-encoded URLs
- **Automatic Fallback**: Tries sources in priority order until one succeeds
- **Hash Verification**: SHA256 verification for all downloads
- **Local File Search**: Checks local directories before downloading
- **Progress Tracking**: Real-time download progress reporting
- **Update Detection**: Automatically detects when catalog updates are available

### Download Locations

All downloads are stored in the program's data directory:
- **Windows**: `%APPDATA%\RHTools\downloads\`
- **Linux**: `~/.config/RHTools/downloads/`
- **macOS**: `~/Library/Application Support/RHTools/downloads/`

---

## bpsarchives.json Manifest

### Location

The manifest file is located at `electron/bpsarchives.json` and is automatically located in both development and packaged builds.

### Structure

```json
{
  "rhsearch_cat.db": {
    "type": "catalogdb",
    "version": "1",
    "base": {
      "file_name": "rhsearch_cat.db.7z",
      "format": "7z",
      "sha256": "22b0a60fd33b317542a91970bb8067e5dd363f5603e4968bd293f55587a15ca8",
      "ipfs_cidv1": "bafybeibkvwfopnx42tlhrj7qn7ihzr3byufsjkyclgv4gapwhximatrqiq",
      "ardrive_file_path": "/SMWRH/catalog/rhsearch_cat.db.7z",
      "ardrive_file_name": "rhsearch_cat.db.7z",
      "ardrive_file_id": "xxx-xxx-xxx",
      "ardrive_drive_id": "d3338fab-d24c-4d75-9e78-d3024befc225",
      "ardrive_folder_id": "a6130936-d92e-45ac-a004-273d96e9ec9d",
      "data_txid": "",
      "metadata_txid": "",
      "size": "1234567",
      "searchdb_version": "1",
      "priority": ["baddr", "ipfs", "ardrive"]
    }
  },
  "rhsearch.zip": {
    "type": "catalog",
    "version": "1",
    "base": {
      "file_name": "rhsearch.zip",
      "sha256": "xxx",
      "ipfs_cidv1": "xxx",
      "size": "1234567",
      "searchdb_version": "1",
      "priority": ["baddr", "ipfs", "ardrive"]
    },
    "additional": [
      {
        "file_name": "rhsearch-add1.zip",
        "format": "zip",
        "sha256": "xxx",
        "ipfs_cidv1": "xxx",
        "size": "xxx",
        "baddr": "xxx",
        "ardrive_file_name": "xxx",
        "ardrive_file_path": "xxx",
        "ardrive_file_id": "xxx",
        "priority": ["baddr", "ipfs", "ardrive"]
      }
    ]
  },
  "bps_00.7z": {
    "type": "bpsarchive",
    "version": "1",
    "base": {
      "file_name": "bps_00.7z",
      "sha1prefixes": "00:00",
      "format": "7z",
      "sha256": "22b0a60fd33b317542a91970bb8067e5dd363f5603e4968bd293f55587a15ca8",
      "ipfs_cidv1": "bafybeibkvwfopnx42tlhrj7qn7ihzr3byufsjkyclgv4gapwhximatrqiq",
      "ardrive_file_path": "/SMWRH/bps7z/bps_00.7z",
      "ardrive_file_name": "bps_00.7z",
      "ardrive_file_id": "xxx-xxx-xxx",
      "ardrive_drive_id": "d3338fab-d24c-4d75-9e78-d3024befc225",
      "ardrive_folder_id": "a6130936-d92e-45ac-a004-273d96e9ec9d",
      "data_txid": "",
      "metadata_txid": "",
      "size": "20582263",
      "priority": ["baddr", "ipfs", "ardrive"]
    }
  }
}
```

### Entry Types

#### catalogdb
- Catalog database files (compressed as .7z)
- Contains the search catalog SQLite database
- `searchdb_version` indicates the catalog database version

#### catalog
- Catalog ZIP files containing JSON files
- `base` entry is the main catalog
- `additional` entries are incremental updates
- `searchdb_version` indicates which catalog database version this ZIP corresponds to

#### bpsarchive
- 7z archives containing BPS patch files
- `sha1prefixes` indicates which SHA1 prefixes are in this archive (e.g., "00:00" means files starting with "00")

### Download Priority

The `priority` array specifies the order in which download sources are tried:
- `"baddr"` - Base64-encoded URLs (highest priority, most private)
- `"ipfs"` - IPFS CIDv1 downloads
- `"ardrive"` - ArDrive downloads
- `"url"` - Direct HTTP/HTTPS URLs

---

## Download Manager

### Module: `electron/utils/catalog-download-manager.js`

The download manager handles all file downloads with support for multiple sources.

### Key Functions

#### `ensureArtifact(spec, workingDir, downloadTracker, userDataDir, ipfsTimeout, finalDestinationDir)`

Downloads a file from the manifest specification.

**Parameters**:
- `spec` - File specification from manifest (base or additional entry)
- `workingDir` - Temporary working directory
- `downloadTracker` - Progress tracking object
- `userDataDir` - Program data directory
- `ipfsTimeout` - Timeout for IPFS downloads (seconds, default: 20)
- `finalDestinationDir` - Optional: download directly to this directory instead of workingDir

**Returns**: Path to downloaded file

**Process**:
1. Checks if file already exists locally (by SHA256 hash)
2. Searches local directories (downloads folder, user Downloads)
3. Downloads from sources in priority order (IPFS, ArDrive, URLs)
4. Verifies SHA256 hash
5. Returns path to downloaded file

#### `downloadTarget(manifestEntry, targetName, workingDir, userDataDir, ipfsTimeout, finalDestinationDir)`

Downloads a complete manifest entry (base file).

#### `createDownloadTracker()`

Creates a progress tracking object for monitoring downloads.

### Download Sources

#### IPFS Downloads

- Uses multiple IPFS gateways in parallel (for files < 180 MB)
- Falls back to sequential gateway testing for larger files
- Supports CIDv1 format
- Configurable timeout (default: 20 seconds)

#### ArDrive Downloads

- Supports three methods:
  1. `data_txid` - Direct Arweave transaction ID
  2. `ardrive_file_path` - ArDrive file path
  3. `ardrive_file_id` - ArDrive file ID (requires API, not yet implemented)

#### URL Downloads

- Direct HTTP/HTTPS URLs
- Base64-encoded URLs (baddr) - decoded before use
- Supports multiple URLs per entry

---

## Manifest Management

### Script: `jsutils/update_bpsarchives.js`

**Purpose**: Create and update `bpsarchives.json` manifest entries

**Usage**:
```bash
enode.sh update_bpsarchives.js <manifest.json> [options]
```

**Options**:
- `--target <name>` - Manifest entry to update (e.g., `bps_00.7z`, `rhsearch_cat.db`)
- `--add-archive <file>` - Add a BPS archive 7z file to the manifest
- `--calculate-ipfs` - Calculate IPFS CIDv1 for entries missing it
- `--update-from-ardrive` - Populate missing ArDrive metadata from the configured folder
- `--ardrive-drive-id <id>` - ArDrive drive ID (default: `d3338fab-d24c-4d75-9e78-d3024befc225`)
- `--ardrive-folder-id <id>` - ArDrive folder ID (default: `a6130936-d92e-45ac-a004-273d96e9ec9d`)

**Examples**:

```bash
# Add a new BPS archive
enode.sh update_bpsarchives.js bpsarchives.json \
  --target bps_00.7z --add-archive bps_00.7z

# Calculate IPFS CIDs for all entries
enode.sh update_bpsarchives.js bpsarchives.json \
  --target bps_00.7z --calculate-ipfs

# Update ArDrive metadata
enode.sh update_bpsarchives.js bpsarchives.json \
  --target bps_00.7z --update-from-ardrive
```

**What it does**:
- Calculates SHA256 hash of the file
- Calculates IPFS CIDv1 (if `--calculate-ipfs` is used)
- Fetches ArDrive metadata (if `--update-from-ardrive` is used)
- Updates or creates manifest entry

---

## Catalog Updates

### searchdat.json Tracking

The system tracks installed catalog versions in `searchdat.json` (located in program data directory):

```json
{
  "catalog": {
    "base_version": "1",
    "base_sha256": "xxx",
    "base_installed_at": "2025-01-XX...",
    "base_path": "/path/to/rhsearch.zip",
    "additional": [
      {
        "file_name": "rhsearch-add1.zip",
        "sha256": "xxx",
        "version": "1",
        "installed_at": "2025-01-XX...",
        "path": "/path/to/rhsearch-add1.zip"
      }
    ]
  },
  "catalogdb": {
    "base_version": "1",
    "base_sha256": "xxx",
    "base_installed_at": "2025-01-XX...",
    "base_path": "/path/to/rhsearch_cat.db"
  },
  "bpsarchives": {}
}
```

### Update Detection

The Electron app automatically checks for catalog updates when:
- Catalog search modal is opened
- User manually triggers update check

Update detection compares:
- Installed version vs. manifest version
- Installed SHA256 vs. manifest SHA256

### Applying Updates

When an update is available:

1. **Download**: File is downloaded from IPFS/ArDrive/URL
2. **Verify**: SHA256 hash is verified
3. **Install**:
   - **Catalog ZIP files**: Extracts JSON files and adds to catalog using incremental build
   - **Catalog Database**: Replaces existing database file
4. **Update Tracking**: `searchdat.json` is updated with new version info

### catalog-manifest-utils.js

**Location**: `electron/utils/catalog-manifest-utils.js`

**Key Functions**:

- `locateBpsArchivesManifest()` - Finds manifest in dev or packaged builds
- `loadBpsArchivesManifest()` - Loads manifest JSON
- `loadSearchDat()` - Loads tracking file
- `saveSearchDat()` - Saves tracking file
- `updateSearchDatCatalog()` - Updates tracking with installed version
- `checkCatalogUpdates()` - Compares manifest with installed versions

---

## Integration with Electron App

### Catalog Search Modal

When the catalog search modal is opened:
1. Checks if catalog files are available
2. If available, checks for updates
3. Shows update notifications if updates are available
4. Allows user to install updates with one click

### "Add Game" Workflow

When adding a game from catalog:
1. Checks if BPS/7z files are available locally
2. If not found, automatically attempts download from manifest
3. Downloads to program data downloads directory
4. Extracts BPS file from 7z if needed
5. Creates temporary RHPAK and installs game

### IPC Handlers

**`catalog:check-updates`**
- Checks manifest for available updates
- Returns list of updates with version info

**`catalog:apply-update`**
- Downloads update file
- Verifies SHA256 hash
- Installs update (catalog or database)
- Updates tracking file

**`catalog:find-files`**
- Searches for BPS/7z files locally
- Automatically downloads if not found
- Returns file paths

**`catalog:download-files`**
- Downloads specific file from manifest
- Returns download path

---

## Usage Examples

### Adding a New BPS Archive to Manifest

```bash
# Add bps_4c.7z to manifest
enode.sh update_bpsarchives.js electron/bpsarchives.json \
  --target bps_4c.7z --add-archive /path/to/bps_4c.7z

# Calculate IPFS CID
enode.sh update_bpsarchives.js electron/bpsarchives.json \
  --target bps_4c.7z --calculate-ipfs

# Update ArDrive metadata
enode.sh update_bpsarchives.js electron/bpsarchives.json \
  --target bps_4c.7z --update-from-ardrive
```

### Programmatic Download

```javascript
const catalogDownloadManager = require('./utils/catalog-download-manager');
const catalogManifestUtils = require('./utils/catalog-manifest-utils');

// Load manifest
const manifest = catalogManifestUtils.loadBpsArchivesManifest();

// Download a BPS archive
const manifestEntry = manifest['bps_00.7z'];
const userDataDir = app.getPath('userData');
const downloadsDir = path.join(userDataDir, 'downloads');

const downloadTracker = catalogDownloadManager.createDownloadTracker();
const downloadedPath = await catalogDownloadManager.ensureArtifact(
  manifestEntry.base,
  path.join(userDataDir, 'CatalogTemp'),
  downloadTracker,
  userDataDir,
  20,
  downloadsDir // Download directly to downloads directory
);
```

### Checking for Updates

```javascript
const catalogManifestUtils = require('./utils/catalog-manifest-utils');

const updates = catalogManifestUtils.checkCatalogUpdates();
if (updates.available) {
  console.log(`Found ${updates.updates.length} update(s)`);
  for (const update of updates.updates) {
    console.log(`- ${update.name}: v${update.currentVersion} → v${update.availableVersion}`);
  }
}
```

---

## Related Documentation

- `docs/SEARCH_CATALOG_SYSTEM.md` - Complete search catalog system documentation
- `docs/PROGRAMS.MD` - Program listing and quick reference

---

*Last Updated: January 2025*
