#!/usr/bin/env node

/**
 * loaddata.js - Load JSON game data into the rhdata.db SQLite database
 * 
 * Usage:
 *   node loaddata.js <json-file>
 *   npm run loaddata <json-file>
 * 
 * Environment Variables:
 *   RHDATA_DB_PATH or DB_PATH - Override the default database path
 * 
 * Examples:
 *   node loaddata.js electron/example-rhmd/10012
 *   node loaddata.js mydata.json
 *   RHDATA_DB_PATH=/path/to/test.db node loaddata.js data.json
 * 
 * Features:
 * - Supports single JSON objects or arrays of objects
 * - Inserts records into gameversions, rhpatches, and patchblobs tables
 * - Automatically tracks version numbers for each gameid
 * - Detects and skips duplicate records
 * - Tracks changed attributes between versions
 * - Stores optimized JSON in gvjsondata and pbjsondata fields
 * - Extracts and stores fields.type and raw_fields.difficulty from nested JSON
 * - Preserves locked attributes across versions (e.g., legacy_type)
 * 
 * Locked Attributes:
 * - Defined in LOCKED_ATTRIBUTES array
 * - Copied from previous version and NOT overwritten by JSON data
 * - Can only be changed through manual SQL updates
 * - Useful for curator-managed fields that should persist
 * 
 * Input JSON structure:
 * - Each record can be a single object or an array of objects
 * - Required fields: id (or gameid), name
 * - Optional fields map to gameversions table columns
 * - If patchblob1_name, patchblob1_key, and patchblob1_sha224 exist, creates patchblob entry
 * - If patch field exists, creates rhpatches entry
 * - New schema: fields.type → fields_type, raw_fields.difficulty → raw_difficulty
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

/**
 * Generate a UUID v4
 */
function generateUUID() {
  return crypto.randomUUID();
}

// Database path - can be overridden with environment variables
const DB_PATH = process.env.RHDATA_DB_PATH || process.env.DB_PATH || path.join(__dirname, 'electron', 'rhdata.db');

// Fields to check for duplicates
const DUPLICATE_CHECK_FIELDS = [
  'gameid', 'name', 'gametype', 'moderated', 'author', 'authors', 
  'submitter', 'demo', 'length', 'difficulty', 'url', 'download_url', 
  'size', 'description', 'patchblob1_name'
];

// Locked attributes - these fields are preserved from the previous version
// and are NOT overwritten by new JSON data. They can only be changed manually.
// This allows curators to set values that persist across version updates.
const LOCKED_ATTRIBUTES = [
  'legacy_type'  // User-curated type classification that persists across versions
];

// Fields in gameversions table
const GAMEVERSION_FIELDS = [
  'section', 'gameid', 'version', 'removed', 'obsoleted', 'gametype', 
  'name', 'time', 'added', 'moderated', 'author', 'authors', 'submitter', 
  'demo', 'featured', 'length', 'difficulty', 'url', 'download_url', 
  'name_href', 'author_href', 'obsoleted_by', 'pat_sha224', 'size', 
  'description', 'gvjsondata', 'gvchange_attributes', 'gvchanges', 
  'tags', 'tags_href', 'fields_type', 'raw_difficulty', 'combinedtype', 
  'legacy_type'
];

// Fields in patchblobs table
const PATCHBLOB_FIELDS = [
  'gvuuid', 'patch_name', 'pat_sha1', 'pat_sha224', 'pat_shake_128',
  'patchblob1_key', 'patchblob1_name', 'patchblob1_sha224',
  'result_sha1', 'result_sha224', 'result_shake1', 'pbjsondata'
];

/**
 * Normalize a value for SQLite binding
 * SQLite3 can only bind: numbers, strings, bigints, buffers, and null
 */
function normalizeValueForSQLite(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'boolean') {
    // Convert boolean to string representation of integer for consistent storage
    return (value ? 1 : 0).toString();
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Check if a record with the same key fields already exists
 */
function isDuplicate(db, record) {
  const whereClauses = [];
  const params = {};
  
  DUPLICATE_CHECK_FIELDS.forEach(field => {
    if (record[field] !== undefined && record[field] !== null) {
      whereClauses.push(`${field} = @${field}`);
      params[field] = normalizeValueForSQLite(record[field]);
    } else {
      whereClauses.push(`(${field} IS NULL OR ${field} = '')`);
    }
  });
  
  const query = `SELECT COUNT(*) as count FROM gameversions WHERE ${whereClauses.join(' AND ')}`;
  // Debug: uncomment to see the query
  // console.log('Duplicate check query:', query);
  // console.log('Params:', params);
  const result = db.prepare(query).get(params);
  // console.log('Duplicate check result:', result);
  return result.count > 0;
}

/**
 * Get the previous version record for the same gameid
 */
function getPreviousVersion(db, gameid) {
  const query = `
    SELECT * FROM gameversions 
    WHERE gameid = ? 
    ORDER BY version DESC 
    LIMIT 1
  `;
  return db.prepare(query).get(gameid);
}

/**
 * Find attributes that differ between two records
 */
function findChangedAttributes(prevRecord, newRecord) {
  if (!prevRecord) return null;
  
  const changed = [];
  
  // Fields to compare (actual gameversions table fields)
  const compareFields = [
    'section', 'gametype', 'name', 'time', 'added', 'moderated', 
    'author', 'authors', 'submitter', 'demo', 'featured', 'length', 
    'difficulty', 'url', 'download_url', 'name_href', 'author_href', 
    'obsoleted_by', 'patchblob1_name', 'pat_sha224', 'size', 
    'description', 'tags', 'tags_href'
  ];
  
  // Normalize new record values
  const normalizedNew = {
    gametype: newRecord.type || newRecord.gametype,
    name: newRecord.name,
    author: newRecord.author,
    authors: newRecord.authors,
    demo: newRecord.demo,
    length: newRecord.length,
    difficulty: newRecord.difficulty,
    url: newRecord.url,
    download_url: newRecord.download_url,
    description: newRecord.description,
    patchblob1_name: newRecord.patchblob1_name,
    pat_sha224: newRecord.pat_sha224,
    size: newRecord.size,
    section: newRecord.section,
    time: newRecord.time,
    added: newRecord.added,
    moderated: newRecord.moderated,
    submitter: newRecord.submitter,
    featured: newRecord.featured,
    name_href: newRecord.name_href,
    author_href: newRecord.author_href,
    obsoleted_by: newRecord.obsoleted_by,
    tags: Array.isArray(newRecord.tags) ? JSON.stringify(newRecord.tags) : newRecord.tags,
    tags_href: newRecord.tags_href
  };
  
  compareFields.forEach(field => {
    const prevVal = prevRecord[field];
    const newVal = normalizedNew[field];
    
    // Normalize for comparison (treat undefined/null/empty as equivalent)
    let prevNorm = (prevVal === null || prevVal === undefined || prevVal === '') ? null : prevVal;
    let newNorm = (newVal === null || newVal === undefined || newVal === '') ? null : newVal;
    
    // Normalize booleans to numbers for comparison (true->1, false->0)
    // This ensures compatibility when comparing new boolean values against old numeric values in DB
    if (typeof newNorm === 'boolean') {
      newNorm = newNorm ? 1 : 0;
    }
    if (typeof prevNorm === 'boolean') {
      prevNorm = prevNorm ? 1 : 0;
    }
    
    if (JSON.stringify(prevNorm) !== JSON.stringify(newNorm)) {
      changed.push(field);
    }
  });
  
  return changed.length > 0 ? changed : null;
}

/**
 * Optimize JSON by removing whitespace
 */
function optimizeJSON(obj) {
  return JSON.stringify(obj);
}

/**
 * Compute combined type string from multiple type/difficulty fields
 * Format: [fields_type]: [difficulty] (raw_difficulty) (raw_fields.type)
 * Example: "Kaizo: Advanced (diff_4) (kaizo)"
 * 
 * If none of the preferred fields exist, falls back to type/gametype field.
 * 
 * @param {Object} record - The JSON record
 * @returns {string|null} - Combined type string or null
 */
function computeCombinedType(record) {
  const parts = [];
  
  // 1. fields.type (optional, followed by ": ")
  const fieldsType = record.fields && record.fields.type ? record.fields.type : null;
  
  // 2. difficulty (main difficulty field)
  const difficulty = record.difficulty;
  
  // 3. raw_fields.difficulty
  const rawDifficulty = record.raw_fields && record.raw_fields.difficulty ? record.raw_fields.difficulty : null;
  
  // 4. raw_fields.type (can be array or string)
  let rawFieldsType = null;
  if (record.raw_fields && record.raw_fields.type) {
    if (Array.isArray(record.raw_fields.type)) {
      rawFieldsType = record.raw_fields.type.join(', ');
    } else {
      rawFieldsType = record.raw_fields.type;
    }
  }
  
  // Build the combined string
  let result = '';
  
  // Add fields.type with colon if present
  if (fieldsType) {
    result += fieldsType + ': ';
  }
  
  // Add main difficulty
  if (difficulty) {
    result += difficulty;
  }
  
  // Add raw_difficulty in parentheses if present
  if (rawDifficulty) {
    result += ' (' + rawDifficulty + ')';
  }
  
  // Add raw_fields.type in parentheses if present
  if (rawFieldsType) {
    result += ' (' + rawFieldsType + ')';
  }
  
  // Trim the result
  result = result.trim();
  
  // If result is empty, fall back to type/gametype field if present
  if (!result) {
    const fallbackType = record.type || record.gametype;
    if (fallbackType) {
      result = fallbackType;
    }
  }
  
  // Return result or null if still empty
  return result || null;
}

/**
 * Insert a record into gameversions table
 */
function insertGameVersion(db, record) {
  const gameid = record.gameid || record.id;
  
  // Normalize the record for duplicate checking
  const normalizedRecord = {
    ...record,
    gameid: gameid,
    gametype: record.type || record.gametype
  };
  
  // Check for duplicates
  if (isDuplicate(db, normalizedRecord)) {
    console.log(`Skipping duplicate record: ${gameid} - ${record.name}`);
    return null;
  }
  
  // Get previous version if exists
  const prevVersion = getPreviousVersion(db, gameid);
  const changedAttributes = findChangedAttributes(prevVersion, record);
  
  // Calculate next version number
  const nextVersion = prevVersion ? (prevVersion.version || 0) + 1 : 1;
  
  // Copy locked attributes from previous version if they exist
  // Locked attributes are preserved and not overwritten by new JSON data
  const lockedValues = {};
  if (prevVersion) {
    LOCKED_ATTRIBUTES.forEach(attr => {
      if (prevVersion[attr] !== undefined && prevVersion[attr] !== null) {
        lockedValues[attr] = prevVersion[attr];
        console.log(`  ℹ️  Preserving locked attribute: ${attr} = "${prevVersion[attr]}"`);
      }
    });
  }
  
  // Extract new schema fields
  // fields.type from nested fields object (e.g., "Kaizo", "Standard")
  const fieldsType = record.fields && record.fields.type ? record.fields.type : null;
  
  // raw_fields.difficulty from nested raw_fields object (e.g., "diff_4", "diff_2")
  const rawDifficulty = record.raw_fields && record.raw_fields.difficulty ? record.raw_fields.difficulty : null;
  
  // Compute combined type string
  const combinedType = computeCombinedType(record);
  
  // Prepare data for insertion
  const data = {
    gvuuid: generateUUID(),
    gameid: gameid,
    version: nextVersion,
    section: record.section,
    gametype: record.type || record.gametype,
    name: record.name,
    time: record.time,
    added: record.added,
    moderated: normalizeValueForSQLite(record.moderated),
    author: record.author,
    authors: record.authors,
    submitter: record.submitter,
    demo: record.demo,
    featured: normalizeValueForSQLite(record.featured),
    length: record.length,
    difficulty: record.difficulty,
    url: record.url,
    download_url: record.download_url,
    name_href: record.name_href,
    author_href: record.author_href,
    obsoleted_by: record.obsoleted_by,
    patchblob1_name: record.patchblob1_name,
    pat_sha224: record.pat_sha224,
    size: record.size,
    description: record.description,
    gvjsondata: optimizeJSON(record),
    gvchange_attributes: changedAttributes ? JSON.stringify(changedAttributes) : null,
    tags: Array.isArray(record.tags) ? JSON.stringify(record.tags) : record.tags,
    tags_href: record.tags_href,
    fields_type: fieldsType,
    raw_difficulty: rawDifficulty,
    combinedtype: combinedType,
    // Apply locked attributes from previous version (overrides JSON data)
    ...lockedValues
  };
  
  // Build INSERT query
  const fields = [];
  const placeholders = [];
  const values = {};
  
  Object.keys(data).forEach(key => {
    if (data[key] !== undefined) {
      fields.push(key);
      placeholders.push(`@${key}`);
      values[key] = data[key];
    }
  });
  
  const query = `
    INSERT INTO gameversions (${fields.join(', ')}) 
    VALUES (${placeholders.join(', ')})
  `;
  
  const result = db.prepare(query).run(values);
  console.log(`Inserted gameversion: ${gameid} - ${record.name} (gvuuid: ${data.gvuuid})`);
  
  return data.gvuuid;
}

/**
 * Insert a record into rhpatches table
 */
function insertRhPatch(db, gameid, patchName) {
  if (!patchName) return;
  
  try {
    const query = `
      INSERT INTO rhpatches (rhpuuid, gameid, patch_name) 
      VALUES (@rhpuuid, @gameid, @patch_name)
      ON CONFLICT(patch_name) DO NOTHING
    `;
    
    db.prepare(query).run({ 
      rhpuuid: generateUUID(),
      gameid, 
      patch_name: patchName 
    });
    console.log(`  - Inserted rhpatch: ${patchName}`);
  } catch (error) {
    console.log(`  - Skipped rhpatch (already exists): ${patchName}`);
  }
}

/**
 * Insert a record into patchblobs table
 */
function insertPatchBlob(db, gvuuid, record) {
  if (!record.patchblob1_name || !record.patchblob1_key || !record.patchblob1_sha224) {
    return;
  }
  
  const data = {
    pbuuid: generateUUID(),
    gvuuid: gvuuid,
    patch_name: record.patch,
    pat_sha1: record.pat_sha1,
    pat_sha224: record.pat_sha224,
    pat_shake_128: record.pat_shake_128,
    patchblob1_key: record.patchblob1_key,
    patchblob1_name: record.patchblob1_name,
    patchblob1_sha224: record.patchblob1_sha224,
    result_sha1: record.result_sha1,
    result_sha224: record.result_sha224,
    result_shake1: record.result_shake1,
    pbjsondata: optimizeJSON(record)
  };
  
  try {
    const fields = [];
    const placeholders = [];
    const values = {};
    
    Object.keys(data).forEach(key => {
      if (data[key] !== undefined) {
        fields.push(key);
        placeholders.push(`@${key}`);
        values[key] = data[key];
      }
    });
    
    const query = `
      INSERT INTO patchblobs (${fields.join(', ')}) 
      VALUES (${placeholders.join(', ')})
      ON CONFLICT(patchblob1_name) DO NOTHING
    `;
    
    db.prepare(query).run(values);
    console.log(`  - Inserted patchblob: ${record.patchblob1_name}`);
  } catch (error) {
    console.log(`  - Skipped patchblob (already exists): ${record.patchblob1_name}`);
  }
}

/**
 * Process a single record
 */
function processRecord(db, record) {
  const gameid = record.gameid || record.id;
  
  // Insert into gameversions
  const gvuuid = insertGameVersion(db, record);
  
  if (!gvuuid) {
    return; // Skip if duplicate
  }
  
  // Insert into rhpatches if patch attribute exists
  if (record.patch) {
    insertRhPatch(db, gameid, record.patch);
  }
  
  // Insert into patchblobs if required fields exist
  insertPatchBlob(db, gvuuid, record);
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node loaddata.js <json-file>');
    console.error('Example: node loaddata.js electron/example-rhmd/10012');
    process.exit(1);
  }
  
  const jsonFile = args[0];
  
  // Check if file exists
  if (!fs.existsSync(jsonFile)) {
    console.error(`Error: File not found: ${jsonFile}`);
    process.exit(1);
  }
  
  // Read JSON file
  let data;
  try {
    const content = fs.readFileSync(jsonFile, 'utf8');
    data = JSON.parse(content);
  } catch (error) {
    console.error(`Error reading JSON file: ${error.message}`);
    process.exit(1);
  }
  
  // Check if database exists
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Error: Database not found: ${DB_PATH}`);
    process.exit(1);
  }
  
  // Open database
  const db = new Database(DB_PATH);
  
  // Enable foreign keys (but we'll handle the constraints manually if needed)
  db.pragma('foreign_keys = OFF');
  
  try {
    // Process data (single object or array)
    const records = Array.isArray(data) ? data : [data];
    
    console.log(`Processing ${records.length} record(s)...`);
    
    records.forEach((record, index) => {
      console.log(`\n[${index + 1}/${records.length}] Processing record...`);
      processRecord(db, record);
    });
    
    console.log('\nDone!');
  } finally {
    db.close();
  }
}

// Run main function
if (require.main === module) {
  main();
}

