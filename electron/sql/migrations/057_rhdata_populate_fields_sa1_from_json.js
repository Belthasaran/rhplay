#!/usr/bin/env node
/**
 * Migration Script: Populate sa1 from gvjsondata
 * Date: 2025-01-XX
 * Database: rhdata.db
 * 
 * This script reads the gvjsondata column from gameversions table,
 * parses the JSON, and extracts sa1 attribute from multiple sources:
 * - If "sa1" is in tags array, set to "yes"
 * - If fields.sa1 exists as "Yes" or "No" string, use that
 * - If raw_fields.sa1 exists as true/false boolean, convert to "yes"/"no"
 * 
 * The field defaults to blank (NULL) if no value is found.
 */

const Database = require('better-sqlite3');
const path = require('path');

// Get database path from environment variable or use default
const dbPath = process.env.RHDATA_DB_PATH || path.join(__dirname, '../../electron/rhdata.db');

console.log(`Opening database: ${dbPath}`);

const db = new Database(dbPath);

try {
  // Check if column exists
  const tableInfo = db.prepare("PRAGMA table_info(gameversions)").all();
  const hasSa1 = tableInfo.some(col => col.name === 'sa1');
  
  if (!hasSa1) {
    console.error('ERROR: sa1 column does not exist. Please run migration 056_rhdata_add_fields_sa1.sql first.');
    process.exit(1);
  }
  
  console.log('✓ Column exists, proceeding with data migration...');
  
  // Get all records with gvjsondata
  const records = db.prepare(`
    SELECT gvuuid, gameid, version, gvjsondata, sa1
    FROM gameversions
    WHERE gvjsondata IS NOT NULL AND gvjsondata != ''
  `).all();
  
  console.log(`Found ${records.length} records with JSON data`);
  
  const updateStmt = db.prepare(`
    UPDATE gameversions
    SET sa1 = ?
    WHERE gvuuid = ?
  `);
  
  let updatedCount = 0;
  let yesCount = 0;
  let noCount = 0;
  let skippedCount = 0;
  
  /**
   * Extract sa1 value from JSON data
   * Priority:
   * 1. Check if "sa1" is in tags array -> "yes"
   * 2. Check fields.sa1 -> "Yes"/"No" -> "yes"/"no"
   * 3. Check raw_fields.sa1 -> true/false -> "yes"/"no"
   * Returns null if not found
   */
  function extractSa1(jsonData) {
    if (!jsonData || typeof jsonData !== 'object') {
      return null;
    }
    
    // Priority 1: Check if "sa1" is in tags array
    if (Array.isArray(jsonData.tags)) {
      if (jsonData.tags.includes('sa1')) {
        return 'yes';
      }
    }
    
    // Priority 2: Check fields.sa1 (string: "Yes" or "No")
    if (jsonData.fields && typeof jsonData.fields === 'object') {
      if (jsonData.fields.sa1 !== undefined && jsonData.fields.sa1 !== null) {
        const sa1Value = String(jsonData.fields.sa1).trim();
        if (sa1Value.toLowerCase() === 'yes') {
          return 'yes';
        } else if (sa1Value.toLowerCase() === 'no') {
          return 'no';
        }
      }
    }
    
    // Priority 3: Check raw_fields.sa1 (boolean: true or false)
    if (jsonData.raw_fields && typeof jsonData.raw_fields === 'object') {
      if (jsonData.raw_fields.sa1 !== undefined && jsonData.raw_fields.sa1 !== null) {
        if (jsonData.raw_fields.sa1 === true || jsonData.raw_fields.sa1 === 'true') {
          return 'yes';
        } else if (jsonData.raw_fields.sa1 === false || jsonData.raw_fields.sa1 === 'false') {
          return 'no';
        }
      }
    }
    
    return null;
  }
  
  const updateTransaction = db.transaction((records) => {
    for (const record of records) {
      try {
        const jsonData = JSON.parse(record.gvjsondata);
        
        const extractedSa1 = extractSa1(jsonData);
        
        // Only update if we found a value and it's different from current
        if (extractedSa1 !== null) {
          if (extractedSa1 !== record.sa1) {
            updateStmt.run(extractedSa1, record.gvuuid);
            updatedCount++;
            
            if (extractedSa1 === 'yes') {
              yesCount++;
            } else if (extractedSa1 === 'no') {
              noCount++;
            }
          }
        } else {
          // No value found - leave as NULL (blank)
          skippedCount++;
        }
      } catch (error) {
        console.warn(`Failed to parse JSON for ${record.gameid} v${record.version}:`, error.message);
        skippedCount++;
      }
    }
  });
  
  updateTransaction(records);
  
  console.log(`\nMigration complete:`);
  console.log(`  - Records processed: ${records.length}`);
  console.log(`  - Records updated: ${updatedCount}`);
  console.log(`  - Set to "yes": ${yesCount}`);
  console.log(`  - Set to "no": ${noCount}`);
  console.log(`  - Skipped (no value found): ${skippedCount}`);
  
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
} finally {
  db.close();
}

