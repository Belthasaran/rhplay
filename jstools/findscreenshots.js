#!/usr/bin/env node

/**
 * findscreenshots.js - Download and associate screenshots with games
 * 
 * Downloads screenshots from URLs found in game metadata and associates them
 * with games either in exported folders (--target-folder) or database (--target-database).
 * 
 * Usage:
 *   node findscreenshots.js [options]
 * 
 * Modes:
 *   --target-folder=<path>    Export screenshots to game folders
 *   --target-database         Save screenshots to screenshot.db
 * 
 * Options:
 *   --gamefolders=all         Process all game folders (target-folder mode)
 *   --subfolders=<ids>        Process specific game folders (comma-separated)
 *   --limit=<n>               Stop after finding/downloading screenshots for N games
 *   --help, -h                Show help message
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const Database = require('better-sqlite3');
const fernet = require('fernet');
const UrlBase64 = require('urlsafe-base64');
const { CID } = require('multiformats/cid');
const { sha256: multiformatsSha256 } = require('multiformats/hashes/sha2');

// Configuration
const CONFIG = {
  DOWNLOAD_RETRY_MAX: 3,
  DOWNLOAD_TIMEOUT: 30000, // 30 seconds
  USER_AGENT: 'rhtools-findscreenshots/1.0',
  
  // Database paths (can be overridden by environment variables)
  RHDATA_DB_PATH: process.env.RHDATA_DB_PATH || path.join(__dirname, '..', 'electron', 'rhdata.db'),
  SCREENSHOT_DB_PATH: process.env.SCREENSHOT_DB_PATH || path.join(__dirname, '..', 'electron', 'screenshot.db'),
  RESOURCE_DB_PATH: process.env.RESOURCE_DB_PATH || path.join(__dirname, '..', 'electron', 'resource.db'),
};

// Command line argument parsing
function parseArgs(args) {
  const parsed = {
    'target-folder': null,
    'target-database': false,
    'gamefolders': null,
    'subfolders': null,
    'limit': null,
    'gameid': null
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith('--target-folder=')) {
      parsed['target-folder'] = path.resolve(arg.split('=')[1]);
    } else if (arg === '--target-folder') {
      parsed['target-folder'] = path.resolve(args[++i]);
    } else if (arg === '--target-database') {
      parsed['target-database'] = true;
    } else if (arg.startsWith('--gamefolders=')) {
      parsed['gamefolders'] = arg.split('=')[1];
    } else if (arg === '--gamefolders') {
      parsed['gamefolders'] = args[++i];
    } else if (arg.startsWith('--subfolders=')) {
      parsed['subfolders'] = arg.split('=')[1];
    } else if (arg === '--subfolders') {
      parsed['subfolders'] = args[++i];
    } else if (arg.startsWith('--limit=')) {
      parsed['limit'] = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--limit') {
      parsed['limit'] = parseInt(args[++i], 10);
    } else if (arg.startsWith('--gameid=')) {
      parsed['gameid'] = arg.split('=')[1];
    } else if (arg === '--gameid') {
      parsed['gameid'] = args[++i];
    }
  }
  
  return parsed;
}

/**
 * Print help
 */
function printHelp() {
  console.log(`
findscreenshots.js - Download and associate screenshots with games

Usage:
  node findscreenshots.js [options]

Modes (one required):
  --target-folder=<path>    Export screenshots to game folders
  --target-database         Save screenshots to screenshot.db database

Options:
  --gamefolders=all         Process all game folders (target-folder mode)
  --subfolders=<ids>        Process specific game folders (comma-separated IDs)
  --gameid=<ids>            Process specific game IDs (comma-separated, target-database mode)
  --limit=<n>               Stop after finding/downloading screenshots for N games
  --help, -h                Show this help message

Environment Variables:
  RHDATA_DB_PATH           Path to rhdata.db
  SCREENSHOT_DB_PATH       Path to screenshot.db
  RESOURCE_DB_PATH         Path to resource.db

Examples:
  node findscreenshots.js --target-folder=games --gamefolders=all
  node findscreenshots.js --target-folder=games --subfolders=12345,5678
  node findscreenshots.js --target-folder=games --limit=2
  node findscreenshots.js --target-database --limit=5
  `);
}

/**
 * Download a file from URL
 */
function downloadFile(url, destPath, retries = CONFIG.DOWNLOAD_RETRY_MAX) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': CONFIG.USER_AGENT
      },
      timeout: CONFIG.DOWNLOAD_TIMEOUT
    };
    
    const attemptDownload = (attempt) => {
      const req = client.request(options, (res) => {
        if (res.statusCode !== 200) {
          if (attempt < retries) {
            console.log(`      Retrying download (${attempt + 1}/${retries})...`);
            setTimeout(() => attemptDownload(attempt + 1), 1000 * attempt);
            return;
          }
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }
        
        const fileStream = fs.createWriteStream(destPath);
        res.pipe(fileStream);
        
        fileStream.on('finish', () => {
          fileStream.close();
          resolve(destPath);
        });
        
        fileStream.on('error', (err) => {
          fs.unlinkSync(destPath);
          reject(err);
        });
      });
      
      req.on('error', (err) => {
        if (attempt < retries) {
          console.log(`      Retrying download (${attempt + 1}/${retries})...`);
          setTimeout(() => attemptDownload(attempt + 1), 1000 * attempt);
        } else {
          reject(err);
        }
      });
      
      req.on('timeout', () => {
        req.destroy();
        if (attempt < retries) {
          console.log(`      Retrying download (${attempt + 1}/${retries})...`);
          setTimeout(() => attemptDownload(attempt + 1), 1000 * attempt);
        } else {
          reject(new Error('Download timeout'));
        }
      });
      
      req.end();
    };
    
    attemptDownload(0);
  });
}

/**
 * Calculate file hashes
 */
function calculateHashes(filePath) {
  const data = fs.readFileSync(filePath);
  return {
    sha224: crypto.createHash('sha224').update(data).digest('hex'),
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    sha1: crypto.createHash('sha1').update(data).digest('hex'),
    md5: crypto.createHash('md5').update(data).digest('hex'),
    size: data.length,
    buffer: data
  };
}

/**
 * Generate Fernet key
 */
function generateFernetKey() {
  return UrlBase64.encode(crypto.randomBytes(32)).toString();
}

/**
 * Convert Fernet token string to buffer
 */
function fernetTokenToBuffer(token) {
  let base64 = token.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64');
}

/**
 * Convert buffer to Fernet token string
 */
function bufferToFernetToken(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Encrypt buffer with Fernet
 */
function encryptBuffer(buffer, providedKey = null) {
  const key = providedKey || generateFernetKey();
  const secret = new fernet.Secret(key);
  const token = new fernet.Token({ secret, ttl: 0 });
  const payload = buffer.toString('base64');
  const tokenString = token.encode(payload);
  const tokenBuffer = fernetTokenToBuffer(tokenString);
  return {
    key,
    tokenString,
    tokenBuffer,
    encodedSha256: crypto.createHash('sha256').update(tokenBuffer).digest('hex'),
    decodedSha256: crypto.createHash('sha256').update(buffer).digest('hex')
  };
}

/**
 * Detect file type from extension
 */
function detectFileType(fileName) {
  if (!fileName) return null;
  const ext = path.extname(fileName).toLowerCase().replace('.', '');
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml'
  };
  return map[ext] || ext || null;
}

/**
 * Calculate IPFS CIDs
 */
async function computeIpfsCids(buffer) {
  const hash = await multiformatsSha256.digest(buffer);
  const cidV0 = CID.createV0(hash);
  const cidV1 = CID.createV1(0x70, hash); // 0x70 is dag-pb codec
  return {
    cidV0: cidV0.toString(),
    cidV1: cidV1.toString()
  };
}

/**
 * Get image URLs from game metadata
 */
function extractImageUrls(metadata) {
  const urls = [];
  
  if (!metadata) return urls;
  
  // Parse if string
  const meta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
  
  // Check images attribute
  if (Array.isArray(meta.images)) {
    urls.push(...meta.images);
  } else if (meta.images && typeof meta.images === 'string') {
    try {
      const parsed = JSON.parse(meta.images);
      if (Array.isArray(parsed)) {
        urls.push(...parsed);
      }
    } catch {
      // Not JSON, treat as single URL
      urls.push(meta.images);
    }
  }
  
  // Also check screenshot URLs in various formats
  if (meta.screenshots && Array.isArray(meta.screenshots)) {
    for (const shot of meta.screenshots) {
      if (typeof shot === 'string') {
        urls.push(shot);
      } else if (shot && shot.url) {
        urls.push(shot.url);
      }
    }
  }
  
  return [...new Set(urls)]; // Remove duplicates
}

/**
 * Process game folder (target-folder mode)
 */
async function processGameFolder(gameFolder, gameid, screenshotDb, resourceDb) {
  const skeletonPath = path.join(gameFolder, `${gameid}.json`);
  
  if (!fs.existsSync(skeletonPath)) {
    console.log(`  [${gameid}] ⚠ Skeleton JSON not found, skipping`);
    return { processed: false, downloaded: 0 };
  }
  
  const skeleton = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
  
  // Try to get metadata from gvjsondata first (contains full SMWC metadata including images)
  let metadata = null;
  if (skeleton.gameversion?.gvjsondata) {
    metadata = typeof skeleton.gameversion.gvjsondata === 'string' 
      ? JSON.parse(skeleton.gameversion.gvjsondata) 
      : skeleton.gameversion.gvjsondata;
  } else {
    // Fallback: use gameversion object directly (may not have images array)
    metadata = skeleton.gameversion || {};
  }
  
  const imageUrls = extractImageUrls(metadata);
  
  if (imageUrls.length === 0) {
    console.log(`  [${gameid}] No image URLs found`);
    return { processed: true, downloaded: 0 };
  }
  
  console.log(`  [${gameid}] Found ${imageUrls.length} image URL(s)`);
  
  // Create screenshots subfolder
  const screenshotsSubfolder = path.join(gameFolder, 'screenshots');
  if (!fs.existsSync(screenshotsSubfolder)) {
    fs.mkdirSync(screenshotsSubfolder, { recursive: true });
  }
  
  let downloaded = 0;
  const screenshotSources = [];
  
  // Track existing screenshots to avoid duplicates
  const existingScreenshots = skeleton.screenshots || [];
  
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    
    try {
      // Check if we already have this screenshot by source_url in screenshot_sources
      const existingSourceByUrl = (skeleton.screenshot_sources || []).find(s => s.source_url === imageUrl);
      if (existingSourceByUrl) {
        console.log(`    [${i + 1}/${imageUrls.length}] Already have screenshot source: ${imageUrl}`);
        continue;
      }
      
      // Also check existing screenshots (from previous prepare runs)
      const existingByUrl = existingScreenshots.find(s => s.source_url === imageUrl);
      if (existingByUrl) {
        console.log(`    [${i + 1}/${imageUrls.length}] Already have screenshot: ${imageUrl}`);
        continue;
      }
      
      // Determine file extension from URL
      const urlPath = new URL(imageUrl).pathname;
      const ext = path.extname(urlPath) || '.png';
      const filename = `screenshot_${gameid}_${i + 1}${ext}`;
      const destPath = path.join(screenshotsSubfolder, filename);
      
      // Download image
      console.log(`    [${i + 1}/${imageUrls.length}] Downloading: ${imageUrl}`);
      await downloadFile(imageUrl, destPath);
      
      // Calculate hashes
      const hashes = calculateHashes(destPath);
      
      // Check for duplicate by hash (if we have database access - for reference only in folder mode)
      let isDuplicate = false;
      let duplicateRecord = null;
      
      if (screenshotDb) {
        try {
          const existingByHash = screenshotDb.prepare(`
            SELECT * FROM res_screenshots 
            WHERE decoded_sha256 = ? OR file_sha256 = ?
            LIMIT 1
          `).get(hashes.sha256, hashes.sha256);
          
          if (existingByHash) {
            isDuplicate = true;
            duplicateRecord = existingByHash;
            console.log(`      ⚠ Duplicate detected in database (hash matches existing screenshot)`);
          }
        } catch (error) {
          // Database check failed - non-fatal in folder mode, just log and continue
          console.log(`      ⓘ Database duplicate check skipped: ${error.message}`);
        }
      }
      
      // Also check in local skeleton screenshots and screenshot_sources
      const localDuplicate = existingScreenshots.find(s => 
        (s.file_hash_sha256 || s.file_sha256 || s.decoded_sha256) === hashes.sha256
      );
      
      const sourceDuplicate = (skeleton.screenshot_sources || []).find(s => 
        s.file_sha256 === hashes.sha256 || s.file_sha224 === hashes.sha224
      );
      
      if (localDuplicate || sourceDuplicate) {
        isDuplicate = true;
        duplicateRecord = localDuplicate || sourceDuplicate;
        console.log(`      ⚠ Duplicate detected (hash matches existing screenshot)`);
      }
      
      // Create screenshot source metadata (not full screenshot record - that's done by --prepare)
      const screenshotSource = {
        source_url: imageUrl,
        file_path: `screenshots/${filename}`,
        file_name: filename,
        file_sha256: hashes.sha256,
        file_sha224: hashes.sha224,
        file_sha1: hashes.sha1,
        file_md5: hashes.md5,
        file_size: hashes.size,
        created_at: new Date().toISOString()
      };
      
      if (isDuplicate && duplicateRecord) {
        // Still add source metadata but mark as duplicate
        screenshotSource.duplicate_of = duplicateRecord.rsuuid || duplicateRecord.suuid || duplicateRecord.ruuid;
        console.log(`      → Source metadata added (duplicate of existing screenshot)`);
      }
      
      screenshotSources.push(screenshotSource);
      downloaded++;
      
    } catch (error) {
      console.error(`    [${i + 1}/${imageUrls.length}] ✗ Failed: ${error.message}`);
    }
  }
  
  // Update skeleton with screenshot sources
  // Store screenshot sources metadata separately from skeleton.screenshots (which is managed by --prepare)
  // 1. skeleton.screenshot_sources - metadata about externally sourced screenshots (URLs, hashes, etc.)
  if (!skeleton.screenshot_sources) {
    skeleton.screenshot_sources = [];
  }
  
  // Add screenshot source metadata (for mapping source_url during --prepare)
  for (const source of screenshotSources) {
    if (source.file_path && !source.duplicate_of) {
      // Check if this source already exists
      const existingSource = skeleton.screenshot_sources.find(s => 
        s.file_sha256 === source.file_sha256 || 
        s.source_url === source.source_url
      );
      
      if (!existingSource) {
        skeleton.screenshot_sources.push(source);
      }
    }
  }
  
  // 2. skeleton.gameversion.screenshots - array of file paths (strings) for newgame.js --prepare
  // This is what buildScreenshotEntries reads to process and encrypt screenshots
  if (!skeleton.gameversion) {
    skeleton.gameversion = {};
  }
  if (!Array.isArray(skeleton.gameversion.screenshots)) {
    skeleton.gameversion.screenshots = [];
  }
  
  // Add file paths to gameversion.screenshots (as strings) for processing during --prepare
  for (const source of screenshotSources) {
    if (source.file_path && !source.duplicate_of) {
      // Add relative path to gameversion.screenshots if not already present
      const pathStr = source.file_path;
      if (!skeleton.gameversion.screenshots.includes(pathStr)) {
        skeleton.gameversion.screenshots.push(pathStr);
      }
    }
  }
  
  fs.writeFileSync(skeletonPath, JSON.stringify(skeleton, null, 2));
  
  console.log(`  [${gameid}] ✓ Downloaded ${downloaded} screenshot(s)`);
  return { processed: true, downloaded };
}

/**
 * Process database game (target-database mode)
 */
async function processDatabaseGame(gameid, gvuuid, gvjsondata, screenshotDb, resourceDb) {
  const metadata = typeof gvjsondata === 'string' ? JSON.parse(gvjsondata) : gvjsondata;
  const imageUrls = extractImageUrls(metadata);
  
  if (imageUrls.length === 0) {
    return { processed: true, downloaded: 0 };
  }
  
  console.log(`  [${gameid}] Found ${imageUrls.length} image URL(s)`);
  
  // Create screenshots directory if it doesn't exist
  const screenshotsDir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
  
  let downloaded = 0;
  
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    
    try {
      // Check if we already have this screenshot by source_url
      const existingByUrl = screenshotDb.prepare(`
        SELECT * FROM res_screenshots 
        WHERE source_url = ? AND gameid = ?
        LIMIT 1
      `).get(imageUrl, gameid);
      
      if (existingByUrl) {
        console.log(`    [${i + 1}/${imageUrls.length}] Already have screenshot: ${imageUrl}`);
        continue;
      }
      
      // Determine file extension from URL
      const urlPath = new URL(imageUrl).pathname;
      const ext = path.extname(urlPath) || '.png';
      const filename = `screenshot_${gameid}_${Date.now()}_${i + 1}${ext}`;
      const destPath = path.join(screenshotsDir, filename);
      
      // Download image
      console.log(`    [${i + 1}/${imageUrls.length}] Downloading: ${imageUrl}`);
      await downloadFile(imageUrl, destPath);
      
      // Calculate hashes
      const hashes = calculateHashes(destPath);
      const imageBuffer = hashes.buffer;
      
      // Check for duplicate by hash
      const existingByHash = screenshotDb.prepare(`
        SELECT * FROM res_screenshots 
        WHERE decoded_sha256 = ? OR file_sha256 = ?
        LIMIT 1
      `).get(hashes.sha256, hashes.sha256);
      
      if (existingByHash) {
        // Add to alt_names table
        console.log(`      ⚠ Duplicate detected, adding to alt_names`);
        
        // Check if alt_names table exists, create if not
        // Migration will create the table, but ensure it exists for safety
        screenshotDb.exec(`
          CREATE TABLE IF NOT EXISTS screenshot_alt_names (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            suuid TEXT NOT NULL,
            alt_source_url TEXT NOT NULL,
            alt_file_name TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (suuid) REFERENCES res_screenshots(rsuuid),
            UNIQUE(suuid, alt_source_url)
          )
        `);
        
        // Check if this alt_name already exists
        const existingAlt = screenshotDb.prepare(`
          SELECT * FROM screenshot_alt_names 
          WHERE suuid = ? AND alt_source_url = ?
        `).get(existingByHash.rsuuid || existingByHash.suuid, imageUrl);
        
        if (!existingAlt) {
          screenshotDb.prepare(`
            INSERT INTO screenshot_alt_names (suuid, alt_source_url, alt_file_name)
            VALUES (?, ?, ?)
          `).run(existingByHash.rsuuid || existingByHash.suuid, imageUrl, filename);
        }
        
        // Delete downloaded file since it's a duplicate
        fs.unlinkSync(destPath);
        
        console.log(`      → Linked as alternate name for existing screenshot ${existingByHash.rsuuid || existingByHash.suuid}`);
        continue;
      }
      
      // Encrypt the screenshot with Fernet (like newgame.js does)
      console.log(`      Encrypting screenshot...`);
      const encryption = encryptBuffer(imageBuffer);
      
      // Calculate IPFS CIDs
      console.log(`      Calculating IPFS CIDs...`);
      const ipfs = await computeIpfsCids(imageBuffer);
      
      // Determine file type and extension
      const fileExt = path.extname(filename).replace('.', '').toLowerCase();
      const screenshotType = detectFileType(filename) || 'image/png';
      
      // Insert new screenshot record (database mode only)
      const rsuuid = crypto.randomUUID();
      screenshotDb.prepare(`
        INSERT INTO res_screenshots (
          rsuuid, gameid, gvuuid, file_name, file_ext, file_size,
          file_sha256, decoded_sha256, encoded_sha256,
          encrypted_data, fernet_key,
          screenshot_type, kind,
          source_url, ipfs_cid_v1, ipfs_cid_v0,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rsuuid,
        gameid,
        gvuuid,
        filename,
        fileExt,
        hashes.size,
        hashes.sha256,  // file_sha256 (decoded)
        hashes.sha256,  // decoded_sha256
        encryption.encodedSha256,  // encoded_sha256 (encrypted)
        encryption.tokenBuffer,  // encrypted_data (BLOB)
        encryption.key,  // fernet_key
        screenshotType,  // screenshot_type (e.g., "image/png")
        'file',  // kind
        imageUrl,  // source_url
        ipfs.cidV1,  // ipfs_cid_v1
        ipfs.cidV0,  // ipfs_cid_v0
        new Date().toISOString()
      );
      
      // Delete the temporary downloaded file (we only need the encrypted version in DB)
      fs.unlinkSync(destPath);
      
      downloaded++;
      console.log(`      ✓ Saved encrypted screenshot: ${rsuuid}`);
      
    } catch (error) {
      console.error(`    [${i + 1}/${imageUrls.length}] ✗ Failed: ${error.message}`);
    }
  }
  
  console.log(`  [${gameid}] ✓ Downloaded ${downloaded} screenshot(s)`);
  return { processed: true, downloaded };
}

/**
 * Main function
 */
async function main() {
  const argv = parseArgs(process.argv.slice(2));
  
  console.log('==================================================');
  console.log('       findscreenshots.js - Screenshot Finder     ');
  console.log('==================================================\n');
  
  if (!argv['target-folder'] && !argv['target-database']) {
    console.error('Error: Must specify either --target-folder or --target-database');
    printHelp();
    process.exit(1);
  }
  
  let screenshotDb = null;
  let resourceDb = null;
  let rhdataDb = null;
  
  try {
    if (argv['target-database']) {
      // Open databases
      if (!fs.existsSync(CONFIG.SCREENSHOT_DB_PATH)) {
        throw new Error(`Screenshot database not found: ${CONFIG.SCREENSHOT_DB_PATH}`);
      }
      screenshotDb = new Database(CONFIG.SCREENSHOT_DB_PATH);
      
      if (!fs.existsSync(CONFIG.RHDATA_DB_PATH)) {
        throw new Error(`rhdata database not found: ${CONFIG.RHDATA_DB_PATH}`);
      }
      rhdataDb = new Database(CONFIG.RHDATA_DB_PATH);
      
      console.log('Database mode: Processing games from rhdata.db\n');
      
      // Get games from database
      let games;
      if (argv['gameid']) {
        const gameids = argv['gameid'].split(',').map(s => s.trim());
        const placeholders = gameids.map(() => '?').join(',');
        games = rhdataDb.prepare(`
          SELECT gameid, gvuuid, gvjsondata 
          FROM gameversions
          WHERE gameid IN (${placeholders})
          ORDER BY gameid, version DESC
        `).all(...gameids);
        console.log(`Filtering to specific game IDs: ${gameids.join(', ')}`);
      } else {
        games = rhdataDb.prepare(`
          SELECT gameid, gvuuid, gvjsondata 
          FROM gameversions
          ORDER BY gameid, version DESC
        `).all();
      }
      
      console.log(`Found ${games.length} game version(s) to check\n`);
      
      let processed = 0;
      let totalDownloaded = 0;
      const limit = argv['limit'] || games.length;
      
      for (const game of games) {
        if (processed >= limit) {
          console.log(`\nReached limit of ${limit} game(s) with downloaded screenshots`);
          break;
        }
        
        const result = await processDatabaseGame(
          game.gameid,
          game.gvuuid,
          game.gvjsondata,
          screenshotDb,
          resourceDb
        );
        
        if (result.processed && result.downloaded > 0) {
          processed++;
          totalDownloaded += result.downloaded;
        }
      }
      
      console.log(`\nSummary: Processed ${processed} game(s), downloaded ${totalDownloaded} screenshot(s)`);
      
    } else {
      // Target folder mode
      const targetFolder = argv['target-folder'];
      
      if (!fs.existsSync(targetFolder)) {
        throw new Error(`Target folder not found: ${targetFolder}`);
      }
      
      console.log(`Folder mode: Processing games from ${targetFolder}\n`);
      
      // Optionally open databases for duplicate checking
      if (fs.existsSync(CONFIG.SCREENSHOT_DB_PATH)) {
        screenshotDb = new Database(CONFIG.SCREENSHOT_DB_PATH);
        console.log('  ✓ Opened screenshot.db for duplicate checking');
      }
      
      if (fs.existsSync(CONFIG.RESOURCE_DB_PATH)) {
        resourceDb = new Database(CONFIG.RESOURCE_DB_PATH);
        console.log('  ✓ Opened resource.db for duplicate checking');
        
        // Create res_alt_names table if it doesn't exist
        resourceDb.exec(`
          CREATE TABLE IF NOT EXISTS res_alt_names (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ruuid TEXT NOT NULL,
            alt_source_url TEXT NOT NULL,
            alt_file_name TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (ruuid) REFERENCES res_attachments(ruuid),
            UNIQUE(ruuid, alt_source_url)
          )
        `);
      }
      
      console.log('');
      
      // Get game folders
      let gameFolders = [];
      
      if (argv['subfolders']) {
        const gameids = argv['subfolders'].split(',').map(s => s.trim());
        gameFolders = gameids.map(gameid => ({
          gameid: gameid,
          path: path.join(targetFolder, gameid)
        })).filter(f => fs.existsSync(f.path));
      } else {
        // Get all subfolders
        const entries = fs.readdirSync(targetFolder, { withFileTypes: true });
        gameFolders = entries
          .filter(e => e.isDirectory())
          .map(e => ({
            gameid: e.name,
            path: path.join(targetFolder, e.name)
          }));
      }
      
      console.log(`Found ${gameFolders.length} game folder(s) to process\n`);
      
      let processed = 0;
      let totalDownloaded = 0;
      const limit = argv['limit'] || gameFolders.length;
      
      for (const folder of gameFolders) {
        if (processed >= limit) {
          console.log(`\nReached limit of ${limit} game(s) with downloaded screenshots`);
          break;
        }
        
        const result = await processGameFolder(
          folder.path,
          folder.gameid,
          screenshotDb,
          resourceDb
        );
        
        if (result.processed && result.downloaded > 0) {
          processed++;
          totalDownloaded += result.downloaded;
        }
      }
      
      console.log(`\nSummary: Processed ${processed} game(s), downloaded ${totalDownloaded} screenshot(s)`);
    }
    
  } catch (error) {
    console.error('\n✗ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (screenshotDb) screenshotDb.close();
    if (resourceDb) resourceDb.close();
    if (rhdataDb) rhdataDb.close();
  }
}

// Execute main
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main, CONFIG };

