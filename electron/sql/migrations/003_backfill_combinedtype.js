#!/usr/bin/env node

/**
 * Migration 003: Backfill combinedtype for existing records
 * 
 * This migration:
 * 1. Finds all records where combinedtype IS NULL or empty string
 * 2. Parses the gvjsondata column to extract the original JSON
 * 3. Computes the combinedtype using the same logic as loaddata.js
 * 4. Updates the record with the computed combinedtype value
 * 
 * Usage:
 *   node electron/sql/migrations/003_backfill_combinedtype.js
 *   
 * With custom database:
 *   DB_PATH=/path/to/db node electron/sql/migrations/003_backfill_combinedtype.js
 */

const Database = require('better-sqlite3');
const path = require('path');

// Database path - can be overridden with environment variable
const DB_PATH = process.env.DB_PATH || process.env.RHDATA_DB_PATH || 
                path.join(__dirname, '..', '..', 'rhdata.db');

/**
 * Compute combined type string from multiple type/difficulty fields
 * (Same logic as in loaddata.js)
 * 
 * Format: [fields_type]: [difficulty] (raw_difficulty) (raw_fields.type)
 * Example: "Kaizo: Advanced (diff_4) (kaizo)"
 * 
 * If none of the preferred fields exist, falls back to type/gametype field.
 * 
 * @param {Object} record - The JSON record from gvjsondata
 * @returns {string|null} - Combined type string or null
 */
function computeCombinedType(record) {
  // 1. fields.type (optional, followed by ": ")
  const fieldsType = record.fields && record.fields.type ? record.fields.type : null;
  
  // 2. difficulty (main difficulty field)
  const difficulty = record.difficulty;
  
  // 3. raw_fields.difficulty
  const rawDifficulty = record.raw_fields && record.raw_fields.difficulty ? 
    record.raw_fields.difficulty : null;
  
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
 * Main migration function
 */
function runMigration() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  Migration 003: Backfill combinedtype                 ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  console.log(`Database: ${DB_PATH}\n`);
  
  // Check if database exists
  const fs = require('fs');
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ Error: Database not found: ${DB_PATH}`);
    process.exit(1);
  }
  
  // Open database
  const db = new Database(DB_PATH);
  
  try {
    // Begin transaction for atomic updates
    db.prepare('BEGIN TRANSACTION').run();
    
    // Find records that need updating
    console.log('📊 Analyzing records...');
    const needsUpdate = db.prepare(`
      SELECT gvuuid, gameid, name, gvjsondata 
      FROM gameversions 
      WHERE combinedtype IS NULL OR combinedtype = ''
    `).all();
    
    const total = needsUpdate.length;
    console.log(`   Found ${total} record(s) needing combinedtype update\n`);
    
    if (total === 0) {
      console.log('✅ No records need updating. All records already have combinedtype.\n');
      db.prepare('ROLLBACK').run();
      db.close();
      return;
    }
    
    // Update records
    console.log('🔄 Processing records...\n');
    
    const updateStmt = db.prepare('UPDATE gameversions SET combinedtype = ? WHERE gvuuid = ?');
    
    let successful = 0;
    let failed = 0;
    let skipped = 0;
    
    needsUpdate.forEach((row, index) => {
      const progress = `[${index + 1}/${total}]`;
      
      try {
        // Parse the JSON data
        let jsonData;
        try {
          jsonData = JSON.parse(row.gvjsondata);
        } catch (parseError) {
          console.log(`${progress} ⚠️  ${row.gameid} - ${row.name}`);
          console.log(`         JSON parse error: ${parseError.message}`);
          skipped++;
          return;
        }
        
        // Compute combinedtype
        const combinedType = computeCombinedType(jsonData);
        
        // Update the record
        updateStmt.run(combinedType, row.gvuuid);
        
        if (combinedType) {
          console.log(`${progress} ✓ ${row.gameid} - ${row.name}`);
          console.log(`         combinedtype: "${combinedType}"`);
          successful++;
        } else {
          console.log(`${progress} ○ ${row.gameid} - ${row.name}`);
          console.log(`         combinedtype: NULL (no difficulty fields)`);
          successful++;
        }
      } catch (error) {
        console.log(`${progress} ✗ ${row.gameid} - ${row.name}`);
        console.log(`         Error: ${error.message}`);
        failed++;
      }
    });
    
    // Commit transaction
    db.prepare('COMMIT').run();
    
    // Summary
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║  Migration Summary                                     ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    console.log(`  Total records processed: ${total}`);
    console.log(`  ✅ Successfully updated: ${successful}`);
    if (skipped > 0) {
      console.log(`  ⚠️  Skipped (parse error): ${skipped}`);
    }
    if (failed > 0) {
      console.log(`  ❌ Failed: ${failed}`);
    }
    
    // Verification
    console.log('\n📊 Verification:');
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(combinedtype) as with_combined,
        COUNT(*) - COUNT(combinedtype) as without_combined
      FROM gameversions
    `).get();
    
    console.log(`   Total records:           ${stats.total}`);
    console.log(`   With combinedtype:       ${stats.with_combined}`);
    console.log(`   Without combinedtype:    ${stats.without_combined}`);
    
    const coverage = ((stats.with_combined / stats.total) * 100).toFixed(1);
    console.log(`   Coverage:                ${coverage}%`);
    
    console.log('\n✅ Migration completed successfully!\n');
    
  } catch (error) {
    // Rollback on error
    try {
      db.prepare('ROLLBACK').run();
    } catch (rollbackError) {
      // Ignore rollback errors
    }
    
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Run migration if executed directly
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration, computeCombinedType };

