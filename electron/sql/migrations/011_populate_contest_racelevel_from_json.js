#!/usr/bin/env node
/**
 * Migration Script: Populate contest and racelevel from gvjsondata
 * Date: 2025-01-XX
 * Database: rhdata.db
 * 
 * This script reads the gvjsondata column from gameversions table,
 * parses the JSON, and extracts contest and racelevel attributes
 * if they exist, then updates the respective columns.
 */

const Database = require('better-sqlite3');
const path = require('path');

// Get database path from environment variable or use default
const dbPath = process.env.RHDATA_DB_PATH || path.join(__dirname, '../../electron/rhdata.db');

console.log(`Opening database: ${dbPath}`);

const db = new Database(dbPath);

try {
  // Check if columns exist
  const tableInfo = db.prepare("PRAGMA table_info(gameversions)").all();
  const hasContest = tableInfo.some(col => col.name === 'contest');
  const hasRacelevel = tableInfo.some(col => col.name === 'racelevel');
  
  if (!hasContest || !hasRacelevel) {
    console.error('ERROR: contest or racelevel columns do not exist. Please run migration 010_add_contest_racelevel_to_gameversions.sql first.');
    process.exit(1);
  }
  
  console.log('✓ Columns exist, proceeding with data migration...');
  
  // Get all records with gvjsondata
  const records = db.prepare(`
    SELECT gvuuid, gameid, version, gvjsondata, contest, racelevel
    FROM gameversions
    WHERE gvjsondata IS NOT NULL AND gvjsondata != ''
  `).all();
  
  console.log(`Found ${records.length} records with JSON data`);
  
  const updateStmt = db.prepare(`
    UPDATE gameversions
    SET contest = ?, racelevel = ?
    WHERE gvuuid = ?
  `);
  
  let updatedCount = 0;
  let contestCount = 0;
  let racelevelCount = 0;
  
  const updateTransaction = db.transaction((records) => {
    for (const record of records) {
      try {
        const jsonData = JSON.parse(record.gvjsondata);
        
        let newContest = record.contest;
        let newRacelevel = record.racelevel;
        let shouldUpdate = false;
        
        // Extract contest if it exists in JSON
        if (jsonData.contest !== undefined && jsonData.contest !== null) {
          newContest = String(jsonData.contest);
          if (newContest !== record.contest) {
            contestCount++;
            shouldUpdate = true;
          }
        }
        
        // Extract racelevel if it exists in JSON
        if (jsonData.racelevel !== undefined && jsonData.racelevel !== null) {
          newRacelevel = String(jsonData.racelevel);
          if (newRacelevel !== record.racelevel) {
            racelevelCount++;
            shouldUpdate = true;
          }
        }
        
        // Only update if we found new values
        if (shouldUpdate) {
          updateStmt.run(newContest, newRacelevel, record.gvuuid);
          updatedCount++;
        }
      } catch (error) {
        console.warn(`Failed to parse JSON for ${record.gameid} v${record.version}:`, error.message);
      }
    }
  });
  
  updateTransaction(records);
  
  console.log(`\nMigration complete:`);
  console.log(`  - Records processed: ${records.length}`);
  console.log(`  - Records updated: ${updatedCount}`);
  console.log(`  - Contest values set: ${contestCount}`);
  console.log(`  - Racelevel values set: ${racelevelCount}`);
  
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
} finally {
  db.close();
}

