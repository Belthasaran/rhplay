# New Update Script Specification

## Document Version
Version: 1.0  
Date: October 12, 2025  
Purpose: Consolidation of legacy Python scripts into single JavaScript updater

---

## 1. Executive Summary

This document specifies the implementation plan for `updategames.js`, a comprehensive JavaScript script that consolidates the functionality of multiple legacy Python scripts into a single, maintainable solution for updating the game versions database.

### 1.1 Current Process Overview

The existing workflow consists of multiple separate scripts executed in sequence:

1. **Metadata Fetch**: `legacy/do_fetch_smwclist.py` - Fetches game list from SMWC server
2. **New Game Detection**: `legacy/findnew_enhanced.py` - Compares lists to identify new games
3. **Download Orchestration**: `legacy/runid_enhanced.py` - Coordinates download process
4. **ZIP Download**: `legacy/smwcfetchrand_enhanced.py` - Downloads game ZIP files
5. **Patch Extraction**: `legacy/extractpatch_enhanced.py` - Extracts and tests patches
6. **Blob Creation**: `legacy/mkblob.py` - Creates encrypted patchblobs
7. **Data Import**: `loaddata.js` - Imports JSON to database
8. **Attachment Processing**: `attachblobs.js` - Creates attachment records

### 1.2 Goals

The consolidated `updategames.js` script will:

- Fetch metadata from SMWC server with proper rate limiting
- Detect new game versions not yet in the database
- Download game ZIP files
- Extract, analyze, and test all patch files (not just primary)
- Generate hash verification data
- Create patchblob records with encryption
- Create attachment records
- Update database atomically with proper error handling
- Support resumable operations
- Maintain compatibility with existing database schema

---

## 2. Database Schema Modifications

### 2.1 New Tables for Update Process Tracking

Add the following tables to `electron/sql/rhdata.sql`:

#### 2.1.1 `update_status` Table

Tracks overall update process state and metadata fetch history.

```sql
CREATE TABLE update_status (
  uuuid varchar(255) primary key DEFAULT (uuid()),
  operation_type varchar(50) NOT NULL,  -- 'metadata_fetch', 'game_update', 'patch_process'
  status varchar(50) NOT NULL,          -- 'pending', 'in_progress', 'completed', 'failed', 'paused'
  metadata jsonb,                       -- Store additional operational metadata
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  error_message text,
  retry_count INTEGER DEFAULT 0
);
```

#### 2.1.2 `game_fetch_queue` Table

Queue for games pending download and processing.

```sql
CREATE TABLE game_fetch_queue (
  queueuuid varchar(255) primary key DEFAULT (uuid()),
  gameid varchar(255) NOT NULL,
  status varchar(50) NOT NULL DEFAULT 'pending',  -- 'pending', 'downloading', 'processing', 'completed', 'failed'
  priority INTEGER DEFAULT 100,
  game_metadata jsonb,              -- Store raw metadata from SMWC
  download_url varchar(500),
  zip_path varchar(500),            -- Path to downloaded ZIP
  error_message text,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  UNIQUE(gameid)
);
```

#### 2.1.3 `patch_files_working` Table

Temporary working table for tracking individual patch files during processing.

```sql
CREATE TABLE patch_files_working (
  pfuuid varchar(255) primary key DEFAULT (uuid()),
  queueuuid varchar(255) REFERENCES game_fetch_queue(queueuuid),
  gameid varchar(255) NOT NULL,
  zip_path varchar(500),
  patch_filename varchar(500),      -- Filename inside ZIP
  patch_type varchar(10),           -- 'bps' or 'ips'
  is_primary BOOLEAN DEFAULT 0,     -- Primary patch flag
  priority_score INTEGER,           -- Heuristic score for primary selection
  
  -- Hash calculations
  pat_sha1 varchar(255),
  pat_sha224 varchar(255),
  pat_shake_128 varchar(255),
  
  -- Result of applying patch
  result_sha1 varchar(255),
  result_sha224 varchar(255),
  result_shake1 varchar(255),
  
  -- File paths
  patch_file_path varchar(500),     -- Extracted patch location
  result_file_path varchar(500),    -- Patched ROM location
  
  -- Processing status
  status varchar(50) DEFAULT 'pending',  -- 'pending', 'extracted', 'tested', 'failed', 'completed'
  test_result varchar(50),          -- 'success', 'failed', 'not_tested'
  error_message text,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP
);
```

#### 2.1.4 `smwc_metadata_cache` Table

Cache for SMWC server responses to minimize repeated fetches.

```sql
CREATE TABLE smwc_metadata_cache (
  cacheuuid varchar(255) primary key DEFAULT (uuid()),
  fetch_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  page_number INTEGER,
  response_data jsonb,              -- Full JSON response from server
  next_page_url varchar(500),
  record_count INTEGER,
  cache_expires TIMESTAMP,
  UNIQUE(page_number, fetch_date)
);
```

### 2.2 Enhanced `patchblobs` Table

Add columns to track multiple patches per game version:

```sql
-- Add these columns to existing patchblobs table
ALTER TABLE patchblobs ADD COLUMN patch_filename varchar(500);
ALTER TABLE patchblobs ADD COLUMN patch_type varchar(10);      -- 'bps' or 'ips'
ALTER TABLE patchblobs ADD COLUMN is_primary BOOLEAN DEFAULT 0;
ALTER TABLE patchblobs ADD COLUMN zip_source varchar(500);     -- Source ZIP file
```

### 2.3 Enhanced `attachments` Table

Already exists in `electron/sql/patchbin.sql` - no modifications needed, but we'll utilize additional columns:
- `parents` - JSON array to link multiple patchblobs with same hash
- `locators` - JSON array for file locations

---

## 3. Core Modules and Functions

### 3.1 Configuration Module

```javascript
const CONFIG = {
  // Rate limiting
  SMWC_REQUEST_DELAY: 60000,        // 60 seconds between requests (as per original)
  SMWC_EXTRA_DELAY: 10000,          // Extra 10 second delay
  DOWNLOAD_RETRY_MAX: 3,
  DOWNLOAD_TIMEOUT: 120000,         // 2 minutes
  
  // Paths
  DB_PATH: path.join(__dirname, 'electron', 'rhdata.db'),
  PATCHBIN_DB_PATH: path.join(__dirname, 'electron', 'patchbin.db'),
  ZIPS_DIR: path.join(__dirname, 'zips'),
  PATCH_DIR: path.join(__dirname, 'patch'),
  ROM_DIR: path.join(__dirname, 'rom'),
  BLOBS_DIR: path.join(__dirname, 'blobs'),
  TEMP_DIR: path.join(__dirname, 'temp'),
  HACKS_DIR: path.join(__dirname, 'hacks'),
  META_DIR: path.join(__dirname, 'meta'),
  PAT_META_DIR: path.join(__dirname, 'pat_meta'),
  ROM_META_DIR: path.join(__dirname, 'rom_meta'),
  
  // Base ROM
  BASE_ROM_PATH: path.join(__dirname, 'smw.sfc'),
  BASE_ROM_SHA224: 'fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08',
  
  // SMWC API
  SMWC_BASE_URL: 'https://www.smwcentral.net/',
  SMWC_API_ENDPOINT: 'ajax.php?a=getsectionlist&p=section&s=smwhacks&u=0&g=0&n=1&o=date&d=desc',
  
  // User Agent
  USER_AGENT: 'rhtools-updategames/1.0 (https://github.com/yourusername/rhtools)',
  
  // Flips utility
  FLIPS_PATH: process.platform === 'win32' ? 'flips.exe' : './flips',
  
  // Encryption settings
  PBKDF2_ITERATIONS: 390000,
  
  // Options
  PROCESS_ALL_PATCHES: false,       // Can be overridden by command line
  DRY_RUN: false,                   // Test mode, no actual DB changes
};
```

### 3.2 Database Module (`lib/database.js`)

Encapsulates database operations:

```javascript
class DatabaseManager {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma('foreign_keys = OFF');
  }
  
  // Update status tracking
  createUpdateStatus(operationType, metadata = {})
  updateUpdateStatus(uuuid, status, errorMessage = null)
  getActiveUpdateStatus(operationType)
  
  // Game fetch queue
  addToFetchQueue(gameid, metadata, downloadUrl)
  getNextQueueItem()
  updateQueueStatus(queueuuid, status, errorMessage = null)
  
  // Patch files working
  addPatchFile(queueuuid, gameid, zipPath, patchFilename, patchType)
  updatePatchFileHashes(pfuuid, hashes)
  markPatchPrimary(pfuuid)
  getPatchFilesByQueue(queueuuid)
  
  // Metadata cache
  cacheMetadataPage(pageNumber, responseData, nextPageUrl)
  getCachedMetadata(pageNumber, maxAge = 86400000) // 24 hours
  
  // Game versions
  getExistingGameIds()
  getLatestVersionForGame(gameid)
  createGameVersion(data)
  
  // Patchblobs
  createPatchBlob(data)
  getPatchBlobByHashes(patSha224, resultSha224)
  linkPatchBlobToGameVersion(pbuuid, gvuuid)
  
  // Attachments (patchbin.db)
  createAttachment(data)
  getAttachmentByHash(fileHashSha224)
  
  // Transactions
  beginTransaction()
  commit()
  rollback()
  
  close()
}
```

### 3.3 SMWC Metadata Fetcher Module (`lib/smwc-fetcher.js`)

Handles communication with SMWC server:

```javascript
class SMWCFetcher {
  constructor(dbManager) {
    this.dbManager = dbManager;
    this.lastRequestTime = 0;
  }
  
  /**
   * Fetch complete game list from SMWC with rate limiting
   * Returns array of game metadata objects
   */
  async fetchCompleteGameList() {
    const games = [];
    let nextUrl = this.buildInitialUrl();
    let pageNumber = 0;
    
    while (nextUrl) {
      // Check cache first
      const cached = this.dbManager.getCachedMetadata(pageNumber);
      if (cached) {
        games.push(...cached.games);
        nextUrl = cached.nextPageUrl;
        pageNumber++;
        continue;
      }
      
      // Rate limiting
      await this.waitForRateLimit();
      
      // Fetch page
      const response = await this.fetchPage(nextUrl);
      
      // Cache response
      this.dbManager.cacheMetadataPage(
        pageNumber, 
        response.data, 
        response.next_page_url
      );
      
      games.push(...response.data);
      nextUrl = response.next_page_url;
      pageNumber++;
    }
    
    return games;
  }
  
  /**
   * Wait for rate limit (60+ seconds between requests)
   */
  async waitForRateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const waitTime = CONFIG.SMWC_REQUEST_DELAY + CONFIG.SMWC_EXTRA_DELAY - elapsed;
    
    if (waitTime > 0) {
      console.log(`Rate limiting: waiting ${waitTime/1000} seconds...`);
      await this.sleep(waitTime);
    }
    
    this.lastRequestTime = Date.now();
  }
  
  /**
   * Fetch single page from SMWC
   */
  async fetchPage(url) {
    const response = await fetch(url, {
      headers: {
        'User-Agent': CONFIG.USER_AGENT
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  }
  
  /**
   * Process raw game data (equivalent to loadsmwrh.fix_hentry)
   */
  normalizeGameEntry(rawEntry) {
    // Convert time to added date
    if (!rawEntry.added && rawEntry.time) {
      const date = new Date(parseInt(rawEntry.time) * 1000);
      rawEntry.added = date.toISOString();
    }
    
    // Normalize type/difficulty
    if (rawEntry.difficulty && !rawEntry.type) {
      rawEntry.type = rawEntry.difficulty;
    }
    
    // Normalize URLs
    if (!rawEntry.name_href && rawEntry.download_url) {
      rawEntry.name_href = rawEntry.download_url;
    }
    if (!rawEntry.download_url && rawEntry.name_href) {
      rawEntry.download_url = rawEntry.name_href;
    }
    
    // Normalize authors
    if (!rawEntry.author && rawEntry.authors) {
      if (typeof rawEntry.authors === 'string') {
        rawEntry.author = rawEntry.authors;
      } else if (Array.isArray(rawEntry.authors)) {
        rawEntry.author = rawEntry.authors.map(a => a.name).join(', ');
        rawEntry.authors = rawEntry.author;
      }
    }
    
    // Handle fields object
    if (rawEntry.fields) {
      const fieldsToPromote = ['demo', 'featured', 'length', 'difficulty', 'description'];
      fieldsToPromote.forEach(field => {
        if (rawEntry.fields[field]) {
          rawEntry[field] = rawEntry.fields[field];
        }
      });
    }
    
    return rawEntry;
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 3.4 Game Downloader Module (`lib/game-downloader.js`)

Downloads ZIP files from SMWC:

```javascript
class GameDownloader {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }
  
  /**
   * Download game ZIP file
   */
  async downloadGame(queueItem) {
    const { gameid, download_url } = queueItem;
    
    console.log(`Downloading game ${gameid} from ${download_url}`);
    
    // Normalize URL
    let url = download_url;
    if (url.startsWith('//')) {
      url = 'https:' + url;
    }
    
    // Download with retry
    let attempt = 0;
    let lastError = null;
    
    while (attempt < CONFIG.DOWNLOAD_RETRY_MAX) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': CONFIG.USER_AGENT
          },
          timeout: CONFIG.DOWNLOAD_TIMEOUT
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const buffer = await response.buffer();
        
        // Save to zips directory
        const zipPath = path.join(CONFIG.ZIPS_DIR, `${gameid}.zip`);
        const tempPath = `${zipPath}.new`;
        
        fs.writeFileSync(tempPath, buffer);
        fs.renameSync(tempPath, zipPath);
        
        console.log(`  ✓ Downloaded to ${zipPath} (${buffer.length} bytes)`);
        
        return zipPath;
        
      } catch (error) {
        lastError = error;
        attempt++;
        console.log(`  ✗ Download attempt ${attempt} failed: ${error.message}`);
        
        if (attempt < CONFIG.DOWNLOAD_RETRY_MAX) {
          await this.sleep(5000 * attempt); // Exponential backoff
        }
      }
    }
    
    throw new Error(`Failed to download after ${CONFIG.DOWNLOAD_RETRY_MAX} attempts: ${lastError.message}`);
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 3.5 Patch Processor Module (`lib/patch-processor.js`)

Extracts and tests patch files:

```javascript
const { ZipFile } = require('yazl'); // or adm-zip
const crypto = require('crypto');
const { execSync } = require('child_process');

class PatchProcessor {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }
  
  /**
   * Process all patches in a ZIP file
   */
  async processZipPatches(queueuuid, gameid, zipPath) {
    console.log(`Processing patches in ${zipPath}`);
    
    const patches = await this.extractPatchList(zipPath);
    console.log(`  Found ${patches.length} patch file(s)`);
    
    // Score patches for primary selection
    const scoredPatches = this.scorePatchFiles(patches);
    
    // Process each patch
    const results = [];
    for (const patchInfo of scoredPatches) {
      try {
        const result = await this.processSinglePatch(
          queueuuid, 
          gameid, 
          zipPath, 
          patchInfo
        );
        results.push(result);
      } catch (error) {
        console.error(`  ✗ Failed to process ${patchInfo.filename}: ${error.message}`);
        results.push({ 
          filename: patchInfo.filename, 
          error: error.message,
          status: 'failed'
        });
      }
    }
    
    return results;
  }
  
  /**
   * Extract list of patch files from ZIP
   */
  async extractPatchList(zipPath) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    
    const patches = [];
    
    for (const entry of entries) {
      // Skip directories and non-patch files
      if (entry.isDirectory) continue;
      
      // Skip Spanish versions (as per original script)
      if (entry.entryName.match(/^Espa/i)) continue;
      
      // Check for .bps or .ips files
      const match = entry.entryName.match(/\.(bps|ips)$/i);
      if (match) {
        patches.push({
          filename: entry.entryName,
          type: match[1].toLowerCase(),
          size: entry.header.size,
          entry: entry
        });
      }
    }
    
    return patches;
  }
  
  /**
   * Score patch files for primary selection
   * Heuristics similar to extractpatch_enhanced.py
   */
  scorePatchFiles(patches) {
    return patches.map(patch => {
      let score = 0;
      const name = patch.filename.toLowerCase();
      
      // Prefer files in root directory
      if (!name.includes('/')) {
        score += 100;
      }
      
      // Prefer .bps over .ips
      if (patch.type === 'bps') {
        score += 50;
      }
      
      // Prefer larger files (main hack vs readme patches)
      score += Math.min(patch.size / 1000, 50);
      
      // Penalize certain patterns
      if (name.includes('readme')) score -= 100;
      if (name.includes('read me')) score -= 100;
      if (name.includes('optional')) score -= 50;
      if (name.includes('alternate')) score -= 30;
      if (name.includes('alt')) score -= 30;
      
      // Prefer files with hack name or similar
      if (name.includes('hack')) score += 20;
      if (name.includes('patch')) score += 10;
      
      return { ...patch, score };
    }).sort((a, b) => b.score - a.score);
  }
  
  /**
   * Process a single patch file
   */
  async processSinglePatch(queueuuid, gameid, zipPath, patchInfo) {
    const isPrimary = patchInfo.score === Math.max(
      ...this.scorePatchFiles([patchInfo]).map(p => p.score)
    );
    
    // Create working record
    const pfuuid = this.dbManager.addPatchFile(
      queueuuid,
      gameid,
      zipPath,
      patchInfo.filename,
      patchInfo.type
    );
    
    // Extract patch from ZIP
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    const patchData = zip.readFile(patchInfo.entry);
    
    // Calculate patch hashes
    const patSha1 = crypto.createHash('sha1').update(patchData).digest('hex');
    const patSha224 = crypto.createHash('sha224').update(patchData).digest('hex');
    const patShake128 = this.calculateShake128(patchData);
    
    // Save patch file
    const patchPath = path.join(CONFIG.PATCH_DIR, patShake128);
    const tempPatchPath = `${patchPath}.new`;
    fs.writeFileSync(tempPatchPath, patchData);
    fs.renameSync(tempPatchPath, patchPath);
    
    console.log(`  Processing: ${patchInfo.filename}`);
    console.log(`    SHA-224: ${patSha224}`);
    
    // Apply patch using flips
    const resultPath = path.join(CONFIG.TEMP_DIR, `result_${pfuuid}`);
    const testResult = await this.applyPatch(patchPath, resultPath);
    
    let resultHashes = null;
    if (testResult.success) {
      // Calculate result hashes
      const resultData = fs.readFileSync(resultPath);
      const resultSha1 = crypto.createHash('sha1').update(resultData).digest('hex');
      const resultSha224 = crypto.createHash('sha224').update(resultData).digest('hex');
      const resultShake1 = this.calculateShake128(resultData);
      
      resultHashes = {
        result_sha1: resultSha1,
        result_sha224: resultSha224,
        result_shake1: resultShake1
      };
      
      // Save result ROM
      const romFilename = `${gameid}_${resultShake1}.sfc`;
      const romPath = path.join(CONFIG.ROM_DIR, romFilename);
      const tempRomPath = `${romPath}.new`;
      fs.writeFileSync(tempRomPath, resultData);
      fs.renameSync(tempRomPath, romPath);
      
      console.log(`    ✓ Patch applied successfully`);
      console.log(`    Result SHA-224: ${resultSha224}`);
      
      // Clean up temp result
      fs.unlinkSync(resultPath);
    } else {
      console.log(`    ✗ Patch application failed: ${testResult.error}`);
    }
    
    // Update working record
    this.dbManager.updatePatchFileHashes(pfuuid, {
      pat_sha1: patSha1,
      pat_sha224: patSha224,
      pat_shake_128: patShake128,
      ...resultHashes,
      patch_file_path: patchPath,
      result_file_path: resultHashes ? romPath : null,
      test_result: testResult.success ? 'success' : 'failed',
      error_message: testResult.error,
      status: testResult.success ? 'completed' : 'failed'
    });
    
    if (isPrimary) {
      this.dbManager.markPatchPrimary(pfuuid);
    }
    
    return {
      pfuuid,
      filename: patchInfo.filename,
      type: patchInfo.type,
      isPrimary,
      success: testResult.success,
      hashes: {
        pat_sha224: patSha224,
        result_sha224: resultHashes?.result_sha224
      }
    };
  }
  
  /**
   * Apply patch using flips utility
   */
  async applyPatch(patchPath, resultPath) {
    try {
      const command = `${CONFIG.FLIPS_PATH} --apply "${patchPath}" "${CONFIG.BASE_ROM_PATH}" "${resultPath}"`;
      execSync(command, { 
        stdio: 'pipe',
        timeout: 30000 // 30 second timeout
      });
      
      // Verify result file exists
      if (!fs.existsSync(resultPath)) {
        return { success: false, error: 'Result file not created' };
      }
      
      return { success: true };
      
    } catch (error) {
      return { 
        success: false, 
        error: error.message || 'Flips execution failed'
      };
    }
  }
  
  /**
   * Calculate SHAKE-128 hash (24 bytes, base64 URL-safe)
   */
  calculateShake128(data) {
    // Node.js doesn't have native SHAKE support in older versions
    // Use shake256 and truncate, or use a library
    const hash = crypto.createHash('shake128', { outputLength: 24 });
    hash.update(data);
    const digest = hash.digest();
    
    // Base64 URL-safe encoding (replace + with _, / with -)
    return digest.toString('base64')
      .replace(/\+/g, '_')
      .replace(/\//g, '-')
      .replace(/=/g, '');
  }
}
```

### 3.6 Blob Creator Module (`lib/blob-creator.js`)

Creates encrypted patchblob files:

```javascript
const crypto = require('crypto');
const fernet = require('fernet');
const lzma = require('lzma-native');

class BlobCreator {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }
  
  /**
   * Create encrypted blob from patch file
   * Equivalent to mkblob.py functionality
   */
  async createPatchBlob(gameid, patchFileRecord) {
    const { 
      pat_sha224, 
      pat_sha1, 
      pat_shake_128,
      patch_file_path,
      result_sha224,
      result_sha1,
      result_shake1
    } = patchFileRecord;
    
    console.log(`  Creating patchblob for ${patchFileRecord.patch_filename}`);
    
    // Read patch data
    const patchData = fs.readFileSync(patch_file_path);
    
    // Compress with LZMA
    const compressedPatch = await this.compressLZMA(patchData);
    const compressedPatchSha224 = crypto.createHash('sha224')
      .update(compressedPatch)
      .hexdigest();
    
    // Encrypt with Fernet
    const password = Buffer.from(pat_sha224, 'ascii');
    const salt = crypto.randomBytes(16);
    const key = this.deriveKey(password, salt);
    const frn = new fernet.Secret(key.toString('base64'));
    const token = new fernet.Token({ secret: frn });
    const encryptedData = token.encode(compressedPatch.toString('base64'));
    
    // Compress encrypted data
    const finalCompressed = await this.compressLZMA(Buffer.from(encryptedData));
    const finalSha224 = crypto.createHash('sha224')
      .update(finalCompressed)
      .hexdigest();
    
    // Generate blob name
    const blobName = `pblob_${gameid}_${finalSha224.substring(0, 10)}`;
    const blobPath = path.join(CONFIG.BLOBS_DIR, blobName);
    
    // Save blob
    const tempBlobPath = `${blobPath}.new`;
    fs.writeFileSync(tempBlobPath, finalCompressed);
    fs.renameSync(tempBlobPath, blobPath);
    
    console.log(`    ✓ Created blob: ${blobName}`);
    
    // Also create ROM blob if result exists
    let romblobName = null;
    if (result_shake1) {
      romblobName = await this.createRomBlob(
        gameid, 
        patchFileRecord, 
        pat_sha224, 
        salt
      );
    }
    
    return {
      patchblob1_name: blobName,
      patchblob1_key: key.toString('base64'),
      patchblob1_sha224: finalSha224,
      romblob_name: romblobName,
      romblob_salt: salt.toString('base64')
    };
  }
  
  /**
   * Create encrypted ROM blob
   */
  async createRomBlob(gameid, patchFileRecord, patSha224, salt) {
    const { result_file_path, result_shake1 } = patchFileRecord;
    
    // Read ROM data
    const romData = fs.readFileSync(result_file_path);
    
    // Compress ROM
    const compressedRom = await this.compressLZMA(romData);
    
    // Derive key from base ROM + patch SHA
    const baseRomData = fs.readFileSync(CONFIG.BASE_ROM_PATH);
    const combinedHash = crypto.createHash('sha224')
      .update(Buffer.concat([baseRomData, Buffer.from(patSha224, 'ascii')]))
      .hexdigest();
    
    const password = Buffer.from(combinedHash, 'ascii');
    const key = this.deriveKey(password, salt);
    
    // Encrypt
    const frn = new fernet.Secret(key.toString('base64'));
    const token = new fernet.Token({ secret: frn });
    const encryptedData = token.encode(compressedRom.toString('base64'));
    
    // Compress encrypted data
    const finalCompressed = await this.compressLZMA(Buffer.from(encryptedData));
    const finalSha224 = crypto.createHash('sha224')
      .update(finalCompressed)
      .hexdigest();
    
    // Generate blob name
    const romblobName = `rblob_${gameid}_${finalSha224.substring(0, 10)}`;
    const romblobPath = path.join(CONFIG.BLOBS_DIR, romblobName);
    
    // Save blob
    const tempPath = `${romblobPath}.new`;
    fs.writeFileSync(tempPath, finalCompressed);
    fs.renameSync(tempPath, romblobPath);
    
    console.log(`    ✓ Created ROM blob: ${romblobName}`);
    
    return romblobName;
  }
  
  /**
   * Derive encryption key using PBKDF2
   */
  deriveKey(password, salt) {
    return crypto.pbkdf2Sync(
      password,
      salt,
      CONFIG.PBKDF2_ITERATIONS,
      32,
      'sha256'
    );
  }
  
  /**
   * Compress data using LZMA
   */
  async compressLZMA(data) {
    return new Promise((resolve, reject) => {
      lzma.compress(data, (result, error) => {
        if (error) {
          reject(error);
        } else {
          resolve(Buffer.from(result));
        }
      });
    });
  }
}
```

### 3.7 Database Record Creator Module (`lib/record-creator.js`)

Creates gameversions, patchblobs, and attachments records:

```javascript
const crypto = require('crypto');

class RecordCreator {
  constructor(dbManager, patchbinDbManager) {
    this.dbManager = dbManager;
    this.patchbinDbManager = patchbinDbManager;
  }
  
  /**
   * Create complete set of records for a processed game
   */
  async createGameRecords(queueItem, patchResults, blobData) {
    console.log(`Creating database records for game ${queueItem.gameid}`);
    
    this.dbManager.beginTransaction();
    
    try {
      // 1. Create gameversion record
      const gvuuid = await this.createGameVersionRecord(
        queueItem,
        patchResults,
        blobData
      );
      
      // 2. Create patchblob records (one per patch)
      const patchblobRecords = [];
      for (const patchResult of patchResults) {
        if (patchResult.success) {
          const pbuuid = await this.createPatchBlobRecord(
            gvuuid,
            queueItem.gameid,
            patchResult,
            blobData
          );
          patchblobRecords.push({ pbuuid, patchResult });
        }
      }
      
      // 3. Create attachment records
      for (const pbRecord of patchblobRecords) {
        await this.createAttachmentRecord(
          pbRecord.pbuuid,
          gvuuid,
          blobData
        );
      }
      
      this.dbManager.commit();
      
      console.log(`  ✓ Created records: gvuuid=${gvuuid}, ${patchblobRecords.length} patchblobs`);
      
      return { gvuuid, patchblobRecords };
      
    } catch (error) {
      this.dbManager.rollback();
      throw error;
    }
  }
  
  /**
   * Create gameversion record
   */
  async createGameVersionRecord(queueItem, patchResults, blobData) {
    const metadata = queueItem.game_metadata;
    
    // Find primary patch
    const primaryPatch = patchResults.find(p => p.isPrimary && p.success);
    
    const data = {
      gvuuid: this.generateUUID(),
      gameid: queueItem.gameid,
      section: metadata.section,
      gametype: metadata.type || metadata.difficulty,
      name: metadata.name,
      time: metadata.time,
      added: metadata.added,
      moderated: metadata.moderated,
      author: metadata.author,
      authors: metadata.authors,
      submitter: metadata.submitter,
      demo: metadata.demo,
      featured: metadata.featured,
      length: metadata.length,
      difficulty: metadata.difficulty,
      url: metadata.url,
      download_url: metadata.download_url,
      name_href: metadata.name_href,
      author_href: metadata.author_href,
      obsoleted_by: metadata.obsoleted_by,
      size: metadata.size,
      description: metadata.description,
      tags: Array.isArray(metadata.tags) ? JSON.stringify(metadata.tags) : metadata.tags,
      tags_href: metadata.tags_href,
      gvjsondata: JSON.stringify(metadata),
      
      // Primary patch information
      patchblob1_name: primaryPatch ? blobData.patchblob1_name : null,
      pat_sha224: primaryPatch ? primaryPatch.hashes.pat_sha224 : null
    };
    
    // Check for previous versions and track changes
    const previousVersion = this.dbManager.getLatestVersionForGame(queueItem.gameid);
    if (previousVersion) {
      const changedFields = this.findChangedFields(previousVersion, data);
      data.gvchange_attributes = JSON.stringify(changedFields);
    }
    
    this.dbManager.createGameVersion(data);
    
    return data.gvuuid;
  }
  
  /**
   * Create patchblob record
   */
  async createPatchBlobRecord(gvuuid, gameid, patchResult, blobData) {
    // Check if identical patchblob already exists
    const existing = this.dbManager.getPatchBlobByHashes(
      patchResult.hashes.pat_sha224,
      patchResult.hashes.result_sha224
    );
    
    if (existing) {
      console.log(`    ⓘ Patchblob already exists (pbuuid=${existing.pbuuid}), reusing`);
      
      // Link to this gameversion
      this.dbManager.linkPatchBlobToGameVersion(existing.pbuuid, gvuuid);
      
      return existing.pbuuid;
    }
    
    // Create new patchblob
    const data = {
      pbuuid: this.generateUUID(),
      gvuuid: gvuuid,
      patch_name: patchResult.filename,
      patch_filename: patchResult.filename,
      patch_type: patchResult.type,
      is_primary: patchResult.isPrimary ? 1 : 0,
      pat_sha1: patchResult.hashes.pat_sha1,
      pat_sha224: patchResult.hashes.pat_sha224,
      pat_shake_128: patchResult.hashes.pat_shake_128,
      result_sha1: patchResult.hashes.result_sha1,
      result_sha224: patchResult.hashes.result_sha224,
      result_shake1: patchResult.hashes.result_shake1,
      patchblob1_key: blobData.patchblob1_key,
      patchblob1_name: blobData.patchblob1_name,
      patchblob1_sha224: blobData.patchblob1_sha224,
      pbjsondata: JSON.stringify(patchResult),
      zip_source: patchResult.zipPath
    };
    
    this.dbManager.createPatchBlob(data);
    
    return data.pbuuid;
  }
  
  /**
   * Create attachment record (in patchbin.db)
   */
  async createAttachmentRecord(pbuuid, gvuuid, blobData) {
    // Check if attachment with same hash already exists
    const existing = this.patchbinDbManager.getAttachmentByHash(
      blobData.patchblob1_sha224
    );
    
    if (existing) {
      console.log(`    ⓘ Attachment already exists (auuid=${existing.auuid})`);
      
      // Update parents array to include this pbuuid
      const parents = JSON.parse(existing.parents || '[]');
      if (!parents.includes(pbuuid)) {
        parents.push(pbuuid);
        this.patchbinDbManager.updateAttachmentParents(existing.auuid, parents);
      }
      
      return existing.auuid;
    }
    
    // Read blob file
    const blobPath = path.join(CONFIG.BLOBS_DIR, blobData.patchblob1_name);
    const fileData = fs.readFileSync(blobPath);
    
    // Calculate all hashes and checksums
    const fileSha1 = crypto.createHash('sha1').update(fileData).digest('hex');
    const fileSha224 = crypto.createHash('sha224').update(fileData).digest('hex');
    const fileSha256 = crypto.createHash('sha256').update(fileData).digest('hex');
    const fileMd5 = crypto.createHash('md5').update(fileData).digest('hex');
    const fileCrc16 = this.calculateCRC16(fileData);
    const fileCrc32 = this.calculateCRC32(fileData);
    
    // Calculate IPFS CIDs
    const { cidv0, cidv1 } = await this.calculateIPFSCIDs(fileData);
    
    // Decode and calculate decoded hashes
    const decodedData = await this.decodeBlob(
      fileData,
      blobData.patchblob1_key
    );
    
    const decodedSha1 = crypto.createHash('sha1').update(decodedData).digest('hex');
    const decodedSha224 = crypto.createHash('sha224').update(decodedData).digest('hex');
    const decodedSha256 = crypto.createHash('sha256').update(decodedData).digest('hex');
    const decodedMd5 = crypto.createHash('md5').update(decodedData).digest('hex');
    const { cidv0: decodedCidv0, cidv1: decodedCidv1 } = 
      await this.calculateIPFSCIDs(decodedData);
    
    const data = {
      auuid: this.generateUUID(),
      pbuuid: pbuuid,
      gvuuid: gvuuid,
      file_crc16: fileCrc16,
      file_crc32: fileCrc32,
      file_size: fileData.length,
      locators: JSON.stringify([]),
      parents: JSON.stringify([pbuuid]),
      file_ipfs_cidv0: cidv0,
      file_ipfs_cidv1: cidv1,
      file_hash_sha224: fileSha224,
      file_hash_sha1: fileSha1,
      file_hash_md5: fileMd5,
      file_hash_sha256: fileSha256,
      file_name: blobData.patchblob1_name,
      filekey: blobData.patchblob1_key,
      decoded_ipfs_cidv0: decodedCidv0,
      decoded_ipfs_cidv1: decodedCidv1,
      decoded_hash_sha224: decodedSha224,
      decoded_hash_sha1: decodedSha1,
      decoded_hash_md5: decodedMd5,
      decoded_hash_sha256: decodedSha256,
      file_data: fileData
    };
    
    this.patchbinDbManager.createAttachment(data);
    
    return data.auuid;
  }
  
  /**
   * Utility functions
   */
  generateUUID() {
    return crypto.randomUUID();
  }
  
  findChangedFields(oldRecord, newRecord) {
    const fields = [
      'name', 'author', 'authors', 'description', 'difficulty',
      'length', 'demo', 'featured', 'url', 'download_url'
    ];
    
    return fields.filter(field => {
      const oldVal = oldRecord[field];
      const newVal = newRecord[field];
      return JSON.stringify(oldVal) !== JSON.stringify(newVal);
    });
  }
  
  calculateCRC16(buffer) {
    const crc = require('crc');
    return crc.crc16(buffer).toString(16).padStart(4, '0');
  }
  
  calculateCRC32(buffer) {
    const crc32 = require('crc-32');
    const result = crc32.buf(buffer);
    return (result >>> 0).toString(16).padStart(8, '0');
  }
  
  async calculateIPFSCIDs(buffer) {
    const { CID } = require('multiformats/cid');
    const { sha256 } = require('multiformats/hashes/sha2');
    
    const hash = await sha256.digest(buffer);
    const cidV0 = CID.createV0(hash);
    const cidV1 = CID.createV1(0x70, hash);
    
    return {
      cidv0: cidV0.toString(),
      cidv1: cidV1.toString()
    };
  }
  
  async decodeBlob(encryptedData, keyBase64) {
    const lzma = require('lzma-native');
    const fernet = require('fernet');
    const UrlBase64 = require('urlsafe-base64');
    
    // Decompress LZMA
    const decompressed1 = await new Promise((resolve, reject) => {
      lzma.decompress(encryptedData, (result, error) => {
        if (error) reject(error);
        else resolve(Buffer.from(result));
      });
    });
    
    // Decrypt Fernet
    const key = UrlBase64.encode(Buffer.from(keyBase64, 'base64')).toString();
    const frnsecret = new fernet.Secret(key);
    const token = new fernet.Token({ 
      secret: frnsecret, 
      ttl: 0, 
      token: decompressed1.toString()
    });
    const decrypted = token.decode();
    
    // Decompress again
    const decompressed2 = await new Promise((resolve, reject) => {
      lzma.decompress(Buffer.from(decrypted, 'base64'), (result, error) => {
        if (error) reject(error);
        else resolve(Buffer.from(result));
      });
    });
    
    return decompressed2;
  }
}
```

---

## 4. Main Script Structure (`updategames.js`)

### 4.1 Command Line Interface

```javascript
#!/usr/bin/env node

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 [options]')
  .option('fetch-metadata', {
    description: 'Fetch latest metadata from SMWC server',
    type: 'boolean',
    default: true
  })
  .option('process-new', {
    description: 'Process new games found in metadata',
    type: 'boolean',
    default: true
  })
  .option('all-patches', {
    description: 'Process all patch files, not just primary',
    type: 'boolean',
    default: false
  })
  .option('resume', {
    description: 'Resume from previous interrupted run',
    type: 'boolean',
    default: false
  })
  .option('dry-run', {
    description: 'Simulate operations without database changes',
    type: 'boolean',
    default: false
  })
  .option('game-ids', {
    description: 'Process specific game IDs (comma-separated)',
    type: 'string'
  })
  .option('limit', {
    description: 'Limit number of games to process',
    type: 'number'
  })
  .help('h')
  .alias('h', 'help')
  .example('$0', 'Fetch metadata and process all new games')
  .example('$0 --all-patches', 'Process all patches in each game')
  .example('$0 --game-ids=12345,12346', 'Process specific games')
  .example('$0 --resume', 'Resume interrupted processing')
  .argv;
```

### 4.2 Main Execution Flow

```javascript
async function main() {
  console.log('==================================================');
  console.log('       rhtools - Update Games Script v1.0        ');
  console.log('==================================================\n');
  
  // Configuration
  CONFIG.PROCESS_ALL_PATCHES = argv['all-patches'];
  CONFIG.DRY_RUN = argv['dry-run'];
  
  if (CONFIG.DRY_RUN) {
    console.log('⚠  DRY RUN MODE - No database changes will be made\n');
  }
  
  // Initialize
  const dbManager = new DatabaseManager(CONFIG.DB_PATH);
  const patchbinDbManager = new DatabaseManager(CONFIG.PATCHBIN_DB_PATH);
  
  try {
    // Verify prerequisites
    await verifyPrerequisites();
    
    // Step 1: Fetch metadata (if enabled)
    let gamesList = [];
    if (argv['fetch-metadata']) {
      console.log('\n[Step 1/5] Fetching metadata from SMWC...');
      gamesList = await fetchMetadata(dbManager);
      console.log(`  ✓ Fetched ${gamesList.length} games\n`);
    }
    
    // Step 2: Identify new games
    console.log('[Step 2/5] Identifying new games...');
    const newGames = await identifyNewGames(dbManager, gamesList, argv);
    console.log(`  ✓ Found ${newGames.length} new games\n`);
    
    if (newGames.length === 0) {
      console.log('No new games to process. Exiting.');
      return;
    }
    
    // Step 3: Download and process games
    console.log('[Step 3/5] Processing games...');
    await processGames(dbManager, newGames, argv);
    
    // Step 4: Create blobs
    console.log('[Step 4/5] Creating encrypted blobs...');
    await createBlobs(dbManager);
    
    // Step 5: Create database records
    console.log('[Step 5/5] Creating database records...');
    await createDatabaseRecords(dbManager, patchbinDbManager);
    
    console.log('\n==================================================');
    console.log('              Update Complete!                    ');
    console.log('==================================================\n');
    
  } catch (error) {
    console.error('\n✗ Fatal error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    dbManager.close();
    patchbinDbManager.close();
  }
}

/**
 * Verify prerequisites (base ROM, flips utility, directories)
 */
async function verifyPrerequisites() {
  console.log('Verifying prerequisites...');
  
  // Check base ROM
  if (!fs.existsSync(CONFIG.BASE_ROM_PATH)) {
    throw new Error(`Base ROM not found: ${CONFIG.BASE_ROM_PATH}`);
  }
  
  const romData = fs.readFileSync(CONFIG.BASE_ROM_PATH);
  const romHash = crypto.createHash('sha224').update(romData).digest('hex');
  
  if (romHash !== CONFIG.BASE_ROM_SHA224) {
    console.warn(`  ⚠ Base ROM hash mismatch!`);
    console.warn(`    Expected: ${CONFIG.BASE_ROM_SHA224}`);
    console.warn(`    Got:      ${romHash}`);
    console.warn(`  This may cause issues with patching.`);
  } else {
    console.log(`  ✓ Base ROM verified`);
  }
  
  // Check flips utility
  try {
    execSync(`${CONFIG.FLIPS_PATH} --version`, { stdio: 'pipe' });
    console.log(`  ✓ Flips utility found`);
  } catch (error) {
    throw new Error(`Flips utility not found or not executable: ${CONFIG.FLIPS_PATH}`);
  }
  
  // Check/create directories
  const dirs = [
    CONFIG.ZIPS_DIR,
    CONFIG.PATCH_DIR,
    CONFIG.ROM_DIR,
    CONFIG.BLOBS_DIR,
    CONFIG.TEMP_DIR,
    CONFIG.HACKS_DIR,
    CONFIG.META_DIR,
    CONFIG.PAT_META_DIR,
    CONFIG.ROM_META_DIR
  ];
  
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`  ✓ Created directory: ${dir}`);
    }
  }
  
  console.log('  ✓ All prerequisites verified\n');
}

/**
 * Fetch metadata from SMWC
 */
async function fetchMetadata(dbManager) {
  const fetcher = new SMWCFetcher(dbManager);
  
  const uuuid = dbManager.createUpdateStatus('metadata_fetch', {
    started: new Date().toISOString()
  });
  
  try {
    const games = await fetcher.fetchCompleteGameList();
    
    dbManager.updateUpdateStatus(uuuid, 'completed');
    
    return games;
    
  } catch (error) {
    dbManager.updateUpdateStatus(uuuid, 'failed', error.message);
    throw error;
  }
}

/**
 * Identify new games not in database
 */
async function identifyNewGames(dbManager, gamesList, argv) {
  // Get existing game IDs
  const existingIds = new Set(dbManager.getExistingGameIds());
  
  console.log(`  Existing games in database: ${existingIds.size}`);
  
  // Filter for new games
  let newGames = gamesList.filter(game => {
    const gameid = String(game.id);
    return !existingIds.has(gameid);
  });
  
  // Apply filters from command line
  if (argv['game-ids']) {
    const requestedIds = argv['game-ids'].split(',').map(s => s.trim());
    newGames = newGames.filter(game => 
      requestedIds.includes(String(game.id))
    );
  }
  
  if (argv.limit) {
    newGames = newGames.slice(0, argv.limit);
  }
  
  return newGames;
}

/**
 * Process games (download, extract, test patches)
 */
async function processGames(dbManager, newGames, argv) {
  const downloader = new GameDownloader(dbManager);
  const processor = new PatchProcessor(dbManager);
  
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  
  for (const game of newGames) {
    const gameid = String(game.id);
    processed++;
    
    console.log(`\n[${processed}/${newGames.length}] Processing game ${gameid}: ${game.name}`);
    
    // Check if already in queue
    let queueItem = dbManager.getQueueItemByGameId(gameid);
    
    if (!queueItem || (argv.resume && queueItem.status !== 'completed')) {
      // Add to queue
      const queueuuid = dbManager.addToFetchQueue(
        gameid,
        game,
        game.download_url || game.name_href
      );
      
      queueItem = dbManager.getQueueItem(queueuuid);
    }
    
    try {
      // Download ZIP if not already downloaded
      if (!queueItem.zip_path || !fs.existsSync(queueItem.zip_path)) {
        dbManager.updateQueueStatus(queueItem.queueuuid, 'downloading');
        const zipPath = await downloader.downloadGame(queueItem);
        dbManager.updateQueueZipPath(queueItem.queueuuid, zipPath);
        queueItem.zip_path = zipPath;
      } else {
        console.log(`  Using existing ZIP: ${queueItem.zip_path}`);
      }
      
      // Process patches
      dbManager.updateQueueStatus(queueItem.queueuuid, 'processing');
      const results = await processor.processZipPatches(
        queueItem.queueuuid,
        gameid,
        queueItem.zip_path
      );
      
      // Check results
      const successCount = results.filter(r => r.success).length;
      
      if (successCount > 0) {
        dbManager.updateQueueStatus(queueItem.queueuuid, 'completed');
        console.log(`  ✓ Successfully processed ${successCount}/${results.length} patches`);
        succeeded++;
      } else {
        dbManager.updateQueueStatus(
          queueItem.queueuuid, 
          'failed', 
          'No patches could be processed'
        );
        console.log(`  ✗ Failed to process any patches`);
        failed++;
      }
      
    } catch (error) {
      console.error(`  ✗ Error: ${error.message}`);
      dbManager.updateQueueStatus(queueItem.queueuuid, 'failed', error.message);
      failed++;
    }
  }
  
  console.log(`\nProcessing Summary:`);
  console.log(`  Total:     ${processed}`);
  console.log(`  Succeeded: ${succeeded}`);
  console.log(`  Failed:    ${failed}`);
}

/**
 * Create encrypted blobs for all processed patches
 */
async function createBlobs(dbManager) {
  const blobCreator = new BlobCreator(dbManager);
  
  // Get all completed queue items without blobs
  const queueItems = dbManager.getCompletedQueueItemsWithoutBlobs();
  
  console.log(`  Processing ${queueItems.length} games for blob creation`);
  
  for (const queueItem of queueItems) {
    const gameid = queueItem.gameid;
    console.log(`\n  Game ${gameid}:`);
    
    // Get patch files for this game
    const patchFiles = dbManager.getPatchFilesByQueue(queueItem.queueuuid);
    
    for (const patchFile of patchFiles) {
      if (patchFile.status === 'completed') {
        try {
          const blobData = await blobCreator.createPatchBlob(gameid, patchFile);
          
          // Store blob data in working table
          dbManager.updatePatchFileBlobData(patchFile.pfuuid, blobData);
          
        } catch (error) {
          console.error(`    ✗ Failed to create blob: ${error.message}`);
        }
      }
    }
  }
}

/**
 * Create final database records
 */
async function createDatabaseRecords(dbManager, patchbinDbManager) {
  const recordCreator = new RecordCreator(dbManager, patchbinDbManager);
  
  // Get all completed queue items ready for record creation
  const queueItems = dbManager.getCompletedQueueItemsReadyForRecords();
  
  console.log(`  Creating records for ${queueItems.length} games`);
  
  let created = 0;
  let skipped = 0;
  
  for (const queueItem of queueItems) {
    const gameid = queueItem.gameid;
    console.log(`\n  Game ${gameid}:`);
    
    try {
      // Check if already created
      if (dbManager.gameVersionExists(gameid)) {
        console.log(`    ⓘ Game version already exists, skipping`);
        skipped++;
        continue;
      }
      
      // Get patch results
      const patchFiles = dbManager.getPatchFilesByQueue(queueItem.queueuuid);
      const successfulPatches = patchFiles.filter(p => p.status === 'completed');
      
      if (successfulPatches.length === 0) {
        console.log(`    ⚠ No successful patches, skipping`);
        skipped++;
        continue;
      }
      
      // Get blob data
      const primaryPatch = successfulPatches.find(p => p.is_primary) || successfulPatches[0];
      const blobData = dbManager.getPatchFileBlobData(primaryPatch.pfuuid);
      
      if (!blobData) {
        console.log(`    ⚠ No blob data, skipping`);
        skipped++;
        continue;
      }
      
      // Create records
      if (!CONFIG.DRY_RUN) {
        await recordCreator.createGameRecords(
          queueItem,
          successfulPatches,
          blobData
        );
        created++;
      } else {
        console.log(`    [DRY RUN] Would create records`);
        created++;
      }
      
    } catch (error) {
      console.error(`    ✗ Failed to create records: ${error.message}`);
    }
  }
  
  console.log(`\nRecord Creation Summary:`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped: ${skipped}`);
}

// Execute main
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
```

---

## 5. Implementation Phases

### Phase 1: Foundation (Days 1-2)
1. Create database schema additions
2. Implement configuration module
3. Implement database manager module
4. Add comprehensive tests

### Phase 2: Metadata Fetching (Days 3-4)
1. Implement SMWC fetcher module
2. Add rate limiting logic
3. Implement metadata caching
4. Test with live SMWC server

### Phase 3: Download & Extraction (Days 5-6)
1. Implement game downloader module
2. Implement patch processor module
3. Add patch scoring heuristics
4. Test with various ZIP files

### Phase 4: Blob Creation (Days 7-8)
1. Implement blob creator module
2. Add encryption/compression logic
3. Test blob creation and verification
4. Validate compatibility with existing blobs

### Phase 5: Database Records (Days 9-10)
1. Implement record creator module
2. Add duplicate detection logic
3. Test database record creation
4. Verify attachments table integration

### Phase 6: Main Script & CLI (Days 11-12)
1. Implement main script logic
2. Add command-line interface
3. Add resume capability
4. Implement error handling and logging

### Phase 7: Testing & Documentation (Days 13-14)
1. End-to-end testing with real data
2. Performance testing
3. Documentation
4. Create migration guide from legacy scripts

---

## 6. Error Handling & Recovery

### 6.1 Resumable Operations

The script supports resuming from interruptions:

- **Metadata Fetch**: Cached in `smwc_metadata_cache` table
- **Download Queue**: Tracked in `game_fetch_queue` table
- **Patch Processing**: Status in `patch_files_working` table
- **Blob Creation**: Blob data stored in working tables

### 6.2 Error Categories

1. **Network Errors**: Retry with exponential backoff
2. **Patch Application Errors**: Mark patch as failed, continue with others
3. **Database Errors**: Rollback transaction, log and exit
4. **File System Errors**: Log and skip, continue with next

### 6.3 Logging

- Console output for progress
- Database logging in `update_status` table
- Optional file logging for debugging

---

## 7. Testing Strategy

### 7.1 Unit Tests

- Database operations
- Hash calculations
- Patch scoring
- Blob encryption/decryption

### 7.2 Integration Tests

- SMWC API interaction (with mocking)
- Download and extraction
- Database record creation

### 7.3 End-to-End Tests

- Process sample games through entire workflow
- Verify database consistency
- Compare with legacy script output

---

## 8. Migration from Legacy Scripts

### 8.1 Compatibility

The new script maintains compatibility with:
- Existing database schema (with additions)
- Existing blob format and encryption
- Existing file structure (zips/, patch/, blobs/, etc.)

### 8.2 Migration Steps

1. **Backup**: Create backup of `rhdata.db` and `patchbin.db`
2. **Schema Update**: Run schema migration SQL
3. **Test Run**: Use `--dry-run` flag
4. **Parallel Run**: Run both legacy and new scripts on test data
5. **Validation**: Compare outputs
6. **Cutover**: Switch to new script exclusively

### 8.3 Deprecation Timeline

- **Month 1**: New script available, legacy scripts still supported
- **Month 2**: New script recommended, legacy deprecated
- **Month 3**: Legacy scripts removed from active use

---

## 9. Configuration & Customization

### 9.1 Environment Variables

```bash
# Override default database path
export RHDATA_DB_PATH=/custom/path/rhdata.db

# Override base ROM path
export SMW_ROM_PATH=/custom/path/smw.sfc

# Override flips path
export FLIPS_PATH=/usr/local/bin/flips

# Enable debug logging
export DEBUG=rhtools:*
```

### 9.2 Config File

Optional `updategames.config.json`:

```json
{
  "smwc": {
    "requestDelay": 60000,
    "userAgent": "custom-agent"
  },
  "paths": {
    "zips": "./custom-zips",
    "blobs": "./custom-blobs"
  },
  "processing": {
    "processAllPatches": true,
    "maxConcurrent": 1,
    "retryMax": 3
  }
}
```

---

## 10. Performance Considerations

### 10.1 Bottlenecks

- **SMWC Rate Limiting**: 60+ seconds between requests (required)
- **Download Speed**: Network dependent
- **Patch Application**: CPU bound (flips utility)
- **Blob Encryption**: CPU bound (PBKDF2 iterations)

### 10.2 Optimizations

- **Caching**: Metadata cached to avoid re-fetching
- **Parallel Processing**: Limited to 1 concurrent to respect rate limits
- **Incremental Updates**: Only process new games
- **Database Indexing**: Proper indexes on lookup columns

### 10.3 Estimated Runtime

For 100 new games:
- Metadata fetch: ~120 minutes (due to rate limiting)
- Download: ~30 minutes (assuming average 5MB per game)
- Processing: ~45 minutes (patch extraction and testing)
- Blob creation: ~20 minutes
- Record creation: ~5 minutes

**Total**: ~3.5 hours

---

## 11. Security Considerations

### 11.1 Data Integrity

- SHA-224 hash verification at every step
- Base ROM verification before patching
- Blob integrity checking

### 11.2 Encryption

- PBKDF2 with 390,000 iterations
- Fernet encryption for blobs
- Keys derived from patch hashes

### 11.3 Network Security

- HTTPS for all SMWC requests
- User-Agent identification
- Rate limiting compliance

---

## 12. Future Enhancements

### 12.1 Potential Additions

1. **Web UI**: Progress dashboard
2. **Parallel Downloads**: Multi-threaded with rate limiting
3. **Cloud Storage**: Direct upload to IPFS/Arweave
4. **Notifications**: Email/webhook on completion
5. **API Mode**: Run as service with REST API
6. **Differential Updates**: Only re-process changed games

### 12.2 Maintenance

- Regular updates for SMWC API changes
- Compatibility with new patch formats
- Performance optimizations
- Bug fixes and improvements

---

## Appendix A: Database Query Reference

### Get Games Needing Processing

```sql
SELECT * FROM game_fetch_queue 
WHERE status IN ('pending', 'failed') 
  AND retry_count < 3
ORDER BY priority DESC, created_at ASC;
```

### Get Completed Games Without Records

```sql
SELECT gfq.* 
FROM game_fetch_queue gfq
LEFT JOIN gameversions gv ON gfq.gameid = gv.gameid
WHERE gfq.status = 'completed' 
  AND gv.gvuuid IS NULL;
```

### Get Patches Needing Blobs

```sql
SELECT pfw.* 
FROM patch_files_working pfw
WHERE pfw.status = 'completed'
  AND NOT EXISTS (
    SELECT 1 FROM patchblobs pb 
    WHERE pb.pat_sha224 = pfw.pat_sha224
  );
```

---

## Appendix B: File Structure

```
rhtools/
├── updategames.js              # Main script
├── lib/
│   ├── database.js             # Database manager
│   ├── smwc-fetcher.js         # SMWC metadata fetcher
│   ├── game-downloader.js      # ZIP downloader
│   ├── patch-processor.js      # Patch extraction/testing
│   ├── blob-creator.js         # Blob encryption
│   └── record-creator.js       # Database record creation
├── electron/
│   ├── rhdata.db               # Main database
│   ├── patchbin.db             # Attachments database
│   └── sql/
│       ├── rhdata.sql          # Schema (enhanced)
│       └── patchbin.sql        # Existing schema
├── zips/                       # Downloaded ZIPs
├── patch/                      # Extracted patches
├── rom/                        # Patched ROMs
├── blobs/                      # Encrypted blobs
├── temp/                       # Temporary files
├── hacks/                      # Game metadata JSON
├── meta/                       # Patch metadata
├── pat_meta/                   # Patch metadata (alternate)
└── rom_meta/                   # ROM metadata
```

---

## Appendix C: Example Usage

### Basic Usage

```bash
# Update with default settings
node updategames.js

# Process all patches (not just primary)
node updategames.js --all-patches

# Process specific games
node updategames.js --game-ids=12345,12346,12347

# Dry run (no database changes)
node updategames.js --dry-run

# Resume interrupted update
node updategames.js --resume

# Limit to 10 games for testing
node updategames.js --limit=10

# Skip metadata fetch, process existing queue
node updategames.js --no-fetch-metadata --process-new
```

### NPM Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "updategames": "node updategames.js",
    "updategames:all": "node updategames.js --all-patches",
    "updategames:test": "node updategames.js --dry-run --limit=5",
    "updategames:resume": "node updategames.js --resume"
  }
}
```

---

## Document Approval

This specification document should be reviewed and approved before implementation begins. Key stakeholders should verify:

1. Functional requirements are complete
2. Database schema changes are acceptable
3. Performance characteristics meet needs
4. Security measures are adequate
5. Migration plan is feasible

---

**End of Specification Document**

