#!/usr/bin/env node

/**
 * search_build1.js - Stage 1: Ingest and normalize master JSON files
 * 
 * Usage:
 *   enode.sh search_build1.js <index7z folder> <bps7z folder> [options]
 *   enode.sh search_build1.js --incremental <json-file> [options]
 *   enode.sh search_build1.js --help
 * 
 * Stage 1: Ingest all raw JSON, normalize into compact canonical records
 * - Read every master JSON file
 * - Validate minimal schema
 * - Extract and normalize standard fields
 * - Create SQLite database with items table
 * - Package JSON files in ZIP archive
 * 
 * Incremental mode (--incremental):
 * - Add a single JSON file to existing catalog database
 * - Update ZIP archive with the new JSON
 * - Does not rebuild entire catalog
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');
const crypto = require('crypto');

// Helper function to ensure directory exists
async function ensureDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

// Helper function to normalize string (casefold, punctuation, etc.)
function normalizeString(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with space
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

// Helper function to extract version info from string
function parseVersionInfo(str) {
  if (!str) return null;
  
  // Ensure str is a string
  if (typeof str !== 'string') {
    str = String(str);
  }
  
  // Patterns: "V1.0", "1.0", "v1.1", "Version 1.2", etc.
  const patterns = [
    /v?\s*(\d+)\.(\d+)/i,
    /version\s*(\d+)\.(\d+)/i,
    /(\d+)\.(\d+)/,
  ];
  
  for (const pattern of patterns) {
    const match = str.match(pattern);
    if (match) {
      return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        label: match[0]
      };
    }
  }
  
  return null;
}

// Helper function to extract date estimate
function extractDateEstimate(json) {
  // Try multiple date fields in priority order
  const dateFields = [
    'sfc_filename_date',
    '7z_filename_date',
    'sfc_upload_estimate',
    'dir_upload_estimate',
    '7z_upload_estimate'
  ];
  
  for (const field of dateFields) {
    if (json[field]) {
      let dateStr = json[field];
      
      // Ensure dateStr is a string
      if (typeof dateStr !== 'string') {
        dateStr = String(dateStr);
      }
      
      // Try to parse ISO date or YYYY-MM-DD
      const dateMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (dateMatch) {
        return dateMatch[0]; // Return YYYY-MM-DD
      }
      // Try ISO timestamp
      try {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date.toISOString().substring(0, 10); // YYYY-MM-DD
        }
      } catch (e) {
        // Ignore
      }
    }
  }
  
  return null;
}

// Helper function to extract brief description (truncated to ~1K)
function extractBriefDescription(json) {
  const descFields = [
    'description',
    'gameversion.description',
    'gameversion.gvjsondata' // May contain description
  ];
  
  for (const field of descFields) {
    let value = getNestedValue(json, field);
    
    // If value is not a string, try to convert or skip
    if (value && typeof value !== 'string') {
      // If it's an object, try to stringify (for gvjsondata)
      if (typeof value === 'object') {
        try {
          value = JSON.stringify(value);
        } catch (e) {
          continue; // Skip if can't stringify
        }
      } else {
        value = String(value);
      }
    }
    
    if (value && typeof value === 'string' && value.length > 0) {
      // Truncate to ~1K characters
      let brief = value.substring(0, 1000);
      if (value.length > 1000) {
        brief += '...';
      }
      return brief;
    }
  }
  
  return null;
}

// Helper function to get nested value from object
function getNestedValue(obj, path) {
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

// Helper function to extract tags
function extractTags(json) {
  const tags = [];
  
  // From gameversion.tags (may be JSON array or comma-separated)
  if (json.gameversion && json.gameversion.tags) {
    if (Array.isArray(json.gameversion.tags)) {
      tags.push(...json.gameversion.tags);
    } else if (typeof json.gameversion.tags === 'string') {
      // Try to parse as JSON first
      try {
        const parsed = JSON.parse(json.gameversion.tags);
        if (Array.isArray(parsed)) {
          tags.push(...parsed);
        } else {
          tags.push(...json.gameversion.tags.split(',').map(t => t.trim()));
        }
      } catch (e) {
        tags.push(...json.gameversion.tags.split(',').map(t => t.trim()));
      }
    }
  }
  
  // From folder_categories
  if (json.folder_categories && Array.isArray(json.folder_categories)) {
    tags.push(...json.folder_categories);
  }
  
  // Normalize and deduplicate
  return [...new Set(tags.map(t => normalizeString(t)).filter(t => t.length > 0))];
}

// Helper function to extract levelname keywords
function extractLevelnameKeywords(json, maxKeywords = 10) {
  const keywords = [];
  
  if (json.levelnames && typeof json.levelnames === 'object') {
    const levelNames = Object.values(json.levelnames);
    // Filter out vanilla/common names (would need a list, but for now just take unique ones)
    const uniqueNames = [...new Set(levelNames)];
    
    for (const name of uniqueNames.slice(0, maxKeywords)) {
      // Ensure name is a string
      let nameStr = name;
      if (typeof nameStr !== 'string') {
        nameStr = String(nameStr);
      }
      
      if (nameStr && nameStr.length > 0) {
        // Extract meaningful words (skip common words like "VANILLA", "SECRET")
        const words = nameStr.split(/\s+/).filter(w => 
          w.length > 2 && 
          !['vanilla', 'secret', 'level', 'the', 'a', 'an', 'and', 'or'].includes(w.toLowerCase())
        );
        keywords.push(...words);
      }
    }
  }
  
  return keywords.slice(0, maxKeywords);
}

// Helper function to normalize item record
function normalizeItem(json, jsonPath) {
  const item = {
    item_id: null, // Will be set to SHA1 hash
    json_path: jsonPath,
    
    // Core fields
    title: null,
    versioninfo: null,
    author: null,
    authors: null,
    tags: null,
    brief: null,
    date_estimate: null,
    upload_estimate: null,
    folder_categories: null,
    
    // File identifiers
    sfcsource_filename: null,
    sfc_rom_sha1_hash: null,
    sfc_rom_sha256_hash: null,
    bps_filename: null,
    bps_sha1_hash: null,
    bps_sha256_hash: null,
    bps_file_size: null,
    sfc_rom_size: null,
    
    // Metadata flags
    has_screenshots: 0,
    screenshot_count: 0,
    has_levelnames: 0,
    has_lmfilter: 0,
    has_translevel_data: 0,
    has_official_source: 0,
    
    // Searchable keywords
    levelnames_keywords: null,
    
    // Raw JSON (for reference, will be stored in ZIP)
    raw_json_hash: null
  };
  
  // Extract item_id from filename or sfc_rom_sha1_hash
  const filename = path.basename(jsonPath, '.json');
  if (/^[a-f0-9]{40}$/i.test(filename)) {
    item.item_id = filename.toLowerCase();
  } else if (json.sfc_rom_sha1_hash) {
    item.item_id = json.sfc_rom_sha1_hash.toLowerCase();
  }
  
  if (!item.item_id) {
    return null; // Skip if we can't identify the item
  }
  
  // Extract title (prefer gameversion.name, then filename fields)
  let title = json.gameversion?.name || 
              json.sfc_filename_title || 
              json['7z_filename_title'] ||
              null;
  
  // If no title found, try to extract from filename
  if (!title && json.sfcsource_filename && typeof json.sfcsource_filename === 'string') {
    title = json.sfcsource_filename.replace(/\.(sfc|smc)$/i, '');
  }
  
  item.title = title;
  
  // Extract version info
  let versionStr = json.gameversion?.version || 
                   json.sfc_filename_versioninfo ||
                   json['7z_filename_versioninfo'] ||
                   null;
  
  // Convert to string if it's a number
  if (versionStr !== null && typeof versionStr !== 'string') {
    versionStr = String(versionStr);
  }
  
  item.versioninfo = versionStr ? parseVersionInfo(versionStr)?.label || versionStr : null;
  
  // Extract author
  item.author = json.gameversion?.author || 
                json.sfc_filename_author ||
                json['7z_filename_author'] ||
                null;
  
  // Extract authors (may be array or comma-separated)
  if (json.gameversion?.authors) {
    if (Array.isArray(json.gameversion.authors)) {
      item.authors = json.gameversion.authors.join(', ');
    } else {
      item.authors = json.gameversion.authors;
    }
  } else {
    item.authors = item.author;
  }
  
  // Extract tags
  item.tags = JSON.stringify(extractTags(json));
  
  // Extract brief description
  item.brief = extractBriefDescription(json);
  
  // Extract dates
  item.date_estimate = extractDateEstimate(json);
  item.upload_estimate = json.sfc_upload_estimate || json.dir_upload_estimate || null;
  
  // Extract folder categories
  if (json.folder_categories && Array.isArray(json.folder_categories)) {
    item.folder_categories = JSON.stringify(json.folder_categories);
  }
  
  // Extract file identifiers
  item.sfcsource_filename = json.sfcsource_filename || null;
  item.sfc_rom_sha1_hash = json.sfc_rom_sha1_hash || item.item_id || null;
  item.sfc_rom_sha256_hash = json.sfc_rom_sha256_hash || null;
  item.bps_filename = json.bps_filename || null;
  item.bps_sha1_hash = json.bps_sha1_hash || null;
  item.bps_sha256_hash = json.bps_sha256_hash || null;
  // BPS file size might not be in JSON, calculate from bps7z if needed (future enhancement)
  item.bps_file_size = null; // Will be populated if available
  item.sfc_rom_size = json.sfc_rom_size || null;
  
  // Extract 7z archive and BPS index information
  item.index7z_name = json.index7z_name || null;
  item.indexbps_name = json.indexbps_name || null;
  item.index7z_ipfs_cidv1 = json.index7z_ipfs_cidv1 || null;
  item.index7z_ardrive_file_id = json.index7z_ardrive_file_id || null;
  
  // Extract metadata flags
  item.has_screenshots = (json.screenshots && Array.isArray(json.screenshots) && json.screenshots.length > 0) ? 1 : 0;
  item.screenshot_count = item.has_screenshots ? json.screenshots.length : 0;
  item.has_levelnames = (json.levelnames && Object.keys(json.levelnames).length > 0) ? 1 : 0;
  item.has_lmfilter = (json.lmfilter && Array.isArray(json.lmfilter) && json.lmfilter.length > 0) ? 1 : 0;
  item.has_translevel_data = (json.translevel_data && Object.keys(json.translevel_data).length > 0) ? 1 : 0;
  item.has_official_source = (json.gameversion && json.gameversion.gameid) ? 1 : 0;
  
  // Extract levelname keywords for search
  const levelnameKeywords = extractLevelnameKeywords(json, 20);
  item.levelnames_keywords = levelnameKeywords.length > 0 ? levelnameKeywords.join(' ') : null;
  
  // Calculate raw JSON hash
  const jsonStr = JSON.stringify(json);
  item.raw_json_hash = crypto.createHash('sha256').update(jsonStr).digest('hex');
  
  return item;
}

// Helper function to recursively find JSON files
async function findJSONFiles(dir) {
  const results = [];
  
  async function search(currentDir) {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isSymbolicLink()) {
          continue;
        }
        
        if (entry.isDirectory()) {
          await search(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          results.push(fullPath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }
  
  await search(dir);
  return results;
}

// Main processing function
async function buildSearchCatalog1(index7zFolder, bps7zFolder, options) {
  const { rhsearchdb, rhsearchzip } = options;
  
  console.log('='.repeat(70));
  console.log('Stage 1: Ingest and Normalize Master JSON Files');
  console.log('='.repeat(70));
  console.log();
  
  // Validate directories
  try {
    await fs.access(index7zFolder);
  } catch (error) {
    throw new Error(`Index7z folder not accessible: ${error.message}`);
  }
  
  // Determine database and ZIP paths
  const dbPath = rhsearchdb || path.join(path.dirname(index7zFolder), 'rhsearch_cat.db');
  const zipPath = rhsearchzip || path.join(path.dirname(index7zFolder), 'rhsearch.zip');
  
  console.log(`Index7z folder: ${index7zFolder}`);
  console.log(`Database: ${dbPath}`);
  console.log(`ZIP archive: ${zipPath}`);
  console.log();
  
  // Find all JSON files
  console.log('Scanning for master JSON files...');
  const jsonFiles = await findJSONFiles(index7zFolder);
  console.log(`Found ${jsonFiles.length} JSON file(s)`);
  console.log();
  
  // Create or open database
  console.log('Creating/updating database schema...');
  const db = new Database(dbPath);
  
  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      item_id TEXT PRIMARY KEY,
      json_path TEXT NOT NULL,
      title TEXT,
      versioninfo TEXT,
      author TEXT,
      authors TEXT,
      tags TEXT,
      brief TEXT,
      date_estimate TEXT,
      upload_estimate TEXT,
      folder_categories TEXT,
      sfcsource_filename TEXT,
      sfc_rom_sha1_hash TEXT,
      sfc_rom_sha256_hash TEXT,
      bps_filename TEXT,
      bps_sha1_hash TEXT,
      bps_sha256_hash TEXT,
      bps_file_size INTEGER,
      sfc_rom_size INTEGER,
      index7z_name TEXT,
      indexbps_name TEXT,
      index7z_ipfs_cidv1 TEXT,
      index7z_ardrive_file_id TEXT,
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
    
    CREATE INDEX IF NOT EXISTS idx_items_title ON items(title);
    CREATE INDEX IF NOT EXISTS idx_items_author ON items(author);
    CREATE INDEX IF NOT EXISTS idx_items_date ON items(date_estimate);
    CREATE INDEX IF NOT EXISTS idx_items_sfc_sha1 ON items(sfc_rom_sha1_hash);
    CREATE INDEX IF NOT EXISTS idx_items_bps_sha1 ON items(bps_sha1_hash);
  `);
  
  // Add missing columns if they don't exist (migration)
  const tableInfo = db.prepare(`PRAGMA table_info(items)`).all();
  const existingColumns = new Set(tableInfo.map(col => col.name));
  
  const columnsToAdd = [
    { name: 'levelnames_keywords', type: 'TEXT' },
    { name: 'index7z_name', type: 'TEXT' },
    { name: 'indexbps_name', type: 'TEXT' },
    { name: 'index7z_ipfs_cidv1', type: 'TEXT' },
    { name: 'index7z_ardrive_file_id', type: 'TEXT' }
  ];
  
  for (const col of columnsToAdd) {
    if (!existingColumns.has(col.name)) {
      db.exec(`ALTER TABLE items ADD COLUMN ${col.name} ${col.type}`);
      console.log(`Added ${col.name} column to items table`);
    }
  }
  
  // Drop old FTS5 triggers if they exist (they might have wrong schema)
  // Stage 2 will recreate them with correct schema
  try {
    db.exec(`
      DROP TRIGGER IF EXISTS items_fts_insert;
      DROP TRIGGER IF EXISTS items_fts_update;
      DROP TRIGGER IF EXISTS items_fts_delete;
    `);
  } catch (error) {
    // Ignore errors - triggers might not exist
  }
  
  // Create ZIP archive
  console.log('Creating ZIP archive...');
  const zip = new AdmZip();
  
  // Process each JSON file
  let processed = 0;
  let skipped = 0;
  let errors = 0;
  
  console.log();
  console.log('Processing JSON files...');
  
  for (let i = 0; i < jsonFiles.length; i++) {
    const jsonFile = jsonFiles[i];
    const relativePath = path.relative(index7zFolder, jsonFile);
    
    if ((i + 1) % 100 === 0) {
      console.log(`  Processed ${i + 1}/${jsonFiles.length} files...`);
    }
    
    try {
      // Load JSON file
      const content = await fs.readFile(jsonFile, 'utf8');
      const json = JSON.parse(content);
      
      // Normalize item
      const item = normalizeItem(json, relativePath);
      
      if (!item) {
        skipped++;
        continue;
      }
      
      // Insert or update in database
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO items (
          item_id, json_path, title, versioninfo, author, authors, tags,
          brief, date_estimate, upload_estimate, folder_categories,
          sfcsource_filename, sfc_rom_sha1_hash, sfc_rom_sha256_hash,
          bps_filename, bps_sha1_hash, bps_sha256_hash, bps_file_size,
          sfc_rom_size, has_screenshots, screenshot_count, has_levelnames,
          has_lmfilter, has_translevel_data, has_official_source, levelnames_keywords,
          index7z_name, indexbps_name, index7z_ipfs_cidv1, index7z_ardrive_file_id,
          raw_json_hash, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      
      stmt.run(
        item.item_id,
        item.json_path,
        item.title,
        item.versioninfo,
        item.author,
        item.authors,
        item.tags,
        item.brief,
        item.date_estimate,
        item.upload_estimate,
        item.folder_categories,
        item.sfcsource_filename,
        item.sfc_rom_sha1_hash,
        item.sfc_rom_sha256_hash,
        item.bps_filename,
        item.bps_sha1_hash,
        item.bps_sha256_hash,
        item.bps_file_size,
        item.sfc_rom_size,
        item.has_screenshots,
        item.screenshot_count,
        item.has_levelnames,
        item.has_lmfilter,
        item.has_translevel_data,
        item.has_official_source,
        item.levelnames_keywords,
        item.index7z_name,
        item.indexbps_name,
        item.index7z_ipfs_cidv1,
        item.index7z_ardrive_file_id,
        item.raw_json_hash
      );
      
      // Add to ZIP archive
      zip.addFile(relativePath, Buffer.from(content, 'utf8'));
      
      processed++;
    } catch (error) {
      console.error(`  ⚠ Error processing ${relativePath}: ${error.message}`);
      errors++;
    }
  }
  
  // Write ZIP archive
  console.log();
  console.log('Writing ZIP archive...');
  zip.writeZip(zipPath);
  
  // Close database
  db.close();
  
  console.log();
  console.log('='.repeat(70));
  console.log('Stage 1 Complete');
  console.log('='.repeat(70));
  console.log(`Processed: ${processed} item(s)`);
  console.log(`Skipped: ${skipped} file(s)`);
  console.log(`Errors: ${errors} file(s)`);
  console.log(`Database: ${dbPath}`);
  console.log(`ZIP archive: ${zipPath}`);
  console.log();
}

// Main entry point
/**
 * Incremental build: Add a single JSON file to existing catalog
 */
async function buildSearchCatalog1Incremental(jsonFilePath, options) {
  const { rhsearchdb, rhsearchzip } = options;
  
  console.log('='.repeat(70));
  console.log('Incremental Build: Add Single JSON to Catalog');
  console.log('='.repeat(70));
  console.log();
  
  if (!fsSync.existsSync(jsonFilePath)) {
    throw new Error(`JSON file not found: ${jsonFilePath}`);
  }
  
  // Determine database and ZIP paths
  const dbPath = rhsearchdb || path.join(path.dirname(jsonFilePath), 'rhsearch_cat.db');
  const zipPath = rhsearchzip || path.join(path.dirname(jsonFilePath), 'rhsearch.zip');
  
  if (!fsSync.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}. Run full build first.`);
  }
  
  console.log(`JSON file: ${jsonFilePath}`);
  console.log(`Database: ${dbPath}`);
  console.log(`ZIP archive: ${zipPath}`);
  console.log();
  
  // Open existing database
  const db = new Database(dbPath);
  
  // Ensure schema is up to date (migration)
  const tableInfo = db.prepare(`PRAGMA table_info(items)`).all();
  const existingColumns = new Set(tableInfo.map(col => col.name));
  const columnsToAdd = [
    { name: 'levelnames_keywords', type: 'TEXT' },
    { name: 'index7z_name', type: 'TEXT' },
    { name: 'indexbps_name', type: 'TEXT' },
    { name: 'index7z_ipfs_cidv1', type: 'TEXT' },
    { name: 'index7z_ardrive_file_id', type: 'TEXT' }
  ];
  for (const col of columnsToAdd) {
    if (!existingColumns.has(col.name)) {
      db.exec(`ALTER TABLE items ADD COLUMN ${col.name} ${col.type}`);
      console.log(`Added ${col.name} column to items table`);
    }
  }
  
  // Drop old FTS5 triggers (Stage 2 will recreate)
  try {
    db.exec(`
      DROP TRIGGER IF EXISTS items_fts_insert;
      DROP TRIGGER IF EXISTS items_fts_update;
      DROP TRIGGER IF EXISTS items_fts_delete;
    `);
  } catch (error) {
    // Ignore errors
  }
  
  // Open or create ZIP archive
  let zip;
  if (fsSync.existsSync(zipPath)) {
    zip = new AdmZip(zipPath);
  } else {
    zip = new AdmZip();
  }
  
  // Process the single JSON file
  console.log('Processing JSON file...');
  const relativePath = path.basename(jsonFilePath);
  
  try {
    const content = await fs.readFile(jsonFilePath, 'utf8');
    const json = JSON.parse(content);
    
    const item = normalizeItem(json, relativePath);
    if (!item) {
      throw new Error('Failed to normalize JSON');
    }
    
    // Insert or update in database
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO items (
        item_id, json_path, title, versioninfo, author, authors, tags,
        brief, date_estimate, upload_estimate, folder_categories,
        sfcsource_filename, sfc_rom_sha1_hash, sfc_rom_sha256_hash,
        bps_filename, bps_sha1_hash, bps_sha256_hash, bps_file_size,
        sfc_rom_size, has_screenshots, screenshot_count, has_levelnames,
        has_lmfilter, has_translevel_data, has_official_source, levelnames_keywords,
        index7z_name, indexbps_name, index7z_ipfs_cidv1, index7z_ardrive_file_id,
        raw_json_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run(
      item.item_id, item.json_path, item.title, item.versioninfo, item.author, item.authors, item.tags,
      item.brief, item.date_estimate, item.upload_estimate, item.folder_categories,
      item.sfcsource_filename, item.sfc_rom_sha1_hash, item.sfc_rom_sha256_hash,
      item.bps_filename, item.bps_sha1_hash, item.bps_sha256_hash, item.bps_file_size,
      item.sfc_rom_size, item.has_screenshots, item.screenshot_count, item.has_levelnames,
      item.has_lmfilter, item.has_translevel_data, item.has_official_source, item.levelnames_keywords,
      item.index7z_name, item.indexbps_name, item.index7z_ipfs_cidv1, item.index7z_ardrive_file_id,
      item.raw_json_hash
    );
    
    // Add to ZIP archive
    zip.addFile(relativePath, Buffer.from(content, 'utf8'));
    
    console.log(`✓ Processed: ${relativePath}`);
  } catch (error) {
    console.error(`⚠ Error processing ${relativePath}: ${error.message}`);
    throw error;
  }
  
  // Save ZIP archive
  zip.writeZip(zipPath);
  console.log(`✓ Updated ZIP archive: ${zipPath}`);
  
  db.close();
  
  console.log();
  console.log('='.repeat(70));
  console.log('Incremental build complete');
  console.log('='.repeat(70));
  console.log('Next: Run search_build2.js to update grouping and FTS5 index');
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: enode.sh search_build1.js <index7z folder> <bps7z folder> [options]
       enode.sh search_build1.js --incremental <json-file> [options]

Stage 1: Ingest and normalize master JSON files

Arguments (normal mode):
  index7z folder    Directory containing master JSON index files
  bps7z folder      Directory containing 7z archives (for reference, not used in Stage 1)

Arguments (incremental mode):
  --incremental <json-file>   Add a single JSON file to existing catalog

Options:
  --rhsearchdb=FILE    Path to search catalog database (default: rhsearch_cat.db in index7z parent)
  --rhsearchzip=FILE   Path to JSON ZIP archive (default: rhsearch.zip in index7z parent)
  --help, -h           Show this help message

This script:
  - Scans index7z folder recursively for JSON files
  - Normalizes and extracts standard fields from each JSON
  - Creates/updates SQLite database with items table
  - Packages all JSON files into a ZIP archive

Incremental mode:
  - Adds a single JSON file to existing catalog database
  - Updates ZIP archive with the new JSON
  - Does not rebuild entire catalog

Examples:
  enode.sh search_build1.js ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/
  enode.sh search_build1.js --incremental new_item.json --rhsearchdb=search.db --rhsearchzip=search.zip
`);
    process.exit(0);
  }
  
  // Check for incremental mode
  const incrementalIndex = args.findIndex(arg => arg === '--incremental' || arg.startsWith('--incremental='));
  if (incrementalIndex !== -1) {
    // Incremental mode: process single JSON file
    let jsonFilePath = null;
    if (args[incrementalIndex].startsWith('--incremental=')) {
      jsonFilePath = args[incrementalIndex].substring('--incremental='.length);
    } else if (incrementalIndex + 1 < args.length) {
      jsonFilePath = args[incrementalIndex + 1];
    }
    
    if (!jsonFilePath) {
      console.error('Error: --incremental requires a JSON file path');
      console.error('Usage: search_build1.js --incremental <json-file> [--rhsearchdb=...] [--rhsearchzip=...]');
      process.exit(1);
    }
    
    const options = {
      rhsearchdb: null,
      rhsearchzip: null,
    };
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--incremental' || arg.startsWith('--incremental=')) {
        continue; // Skip incremental arg
      } else if (arg.startsWith('--rhsearchdb=')) {
        options.rhsearchdb = arg.substring('--rhsearchdb='.length);
      } else if (arg === '--rhsearchdb' && i + 1 < args.length) {
        options.rhsearchdb = args[++i];
      } else if (arg.startsWith('--rhsearchzip=')) {
        options.rhsearchzip = arg.substring('--rhsearchzip='.length);
      } else if (arg === '--rhsearchzip' && i + 1 < args.length) {
        options.rhsearchzip = args[++i];
      }
    }
    
    try {
      await buildSearchCatalog1Incremental(jsonFilePath, options);
    } catch (error) {
      console.error(`Fatal error: ${error.message}`);
      process.exit(1);
    }
    return;
  }
  
  // Normal mode: process folder
  if (args.length < 2) {
    console.error('Error: Missing required arguments');
    console.error('Usage: enode.sh search_build1.js <index7z folder> <bps7z folder> [options]');
    console.error('Run with --help for more information');
    process.exit(1);
  }
  
  const index7zFolder = args[0];
  const bps7zFolder = args[1];
  
  // Parse options
  const options = {
    rhsearchdb: null,
    rhsearchzip: null
  };
  
  for (const arg of args.slice(2)) {
    if (arg.startsWith('--rhsearchdb=')) {
      options.rhsearchdb = arg.substring('--rhsearchdb='.length);
    } else if (arg.startsWith('--rhsearchzip=')) {
      options.rhsearchzip = arg.substring('--rhsearchzip='.length);
    } else if (arg === '--help' || arg === '-h') {
      // Already handled above
    } else {
      console.error(`Error: Unknown option: ${arg}`);
      console.error('Run with --help for usage information');
      process.exit(1);
    }
  }
  
  // Run processing
  try {
    await buildSearchCatalog1(index7zFolder, bps7zFolder, options);
  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { buildSearchCatalog1, buildSearchCatalog1Incremental, normalizeItem };
