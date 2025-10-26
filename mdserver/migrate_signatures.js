#!/usr/bin/env node

/**
 * Migrate databases to support signature system with row versioning
 * 
 * Adds:
 * - signaturelists and signaturelistentries tables
 * - siglistuuid and row_version columns to signed tables
 * 
 * Usage:
 *   node migrate_signatures.js
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PATCHBIN_DB = path.join(__dirname, 'patchbin.db');
const RHDATA_DB = path.join(__dirname, 'rhdata.db');

function addColumnIfNotExists(db, tableName, columnName, columnDef) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const hasColumn = columns.some(col => col.name === columnName);
    
    if (!hasColumn) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef};`);
      console.log(`  ✓ Added ${columnName} to ${tableName}`);
      return true;
    } else {
      console.log(`  ⓘ ${tableName}.${columnName} already exists`);
      return false;
    }
  } catch (error) {
    console.error(`  ✗ Error adding ${columnName} to ${tableName}: ${error.message}`);
    return false;
  }
}

function main() {
  console.log('='.repeat(70));
  console.log('Signature System Migration');
  console.log('='.repeat(70));
  console.log();
  
  // Check if databases exist
  if (!fs.existsSync(PATCHBIN_DB)) {
    console.error(`Error: patchbin.db not found at ${PATCHBIN_DB}`);
    process.exit(1);
  }
  
  if (!fs.existsSync(RHDATA_DB)) {
    console.error(`Error: rhdata.db not found at ${RHDATA_DB}`);
    process.exit(1);
  }
  
  // Open databases
  const patchbinDb = new Database(PATCHBIN_DB);
  const rhdataDb = new Database(RHDATA_DB);
  
  try {
    // Step 1: Create signature tables in patchbin.db
    console.log('Step 1: Creating signature tables in patchbin.db...');
    const schemaPath = path.join(__dirname, 'signatures_schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Execute only the CREATE TABLE statements
    const createStatements = schema.match(/CREATE TABLE[^;]+;/gs) || [];
    const createIndexes = schema.match(/CREATE INDEX[^;]+;/gs) || [];
    
    for (const stmt of createStatements) {
      try {
        patchbinDb.exec(stmt);
        const tableName = stmt.match(/CREATE TABLE.*?(\w+)\s*\(/)?.[1];
        console.log(`  ✓ Created/verified table: ${tableName}`);
      } catch (e) {
        // Table might already exist
      }
    }
    
    for (const stmt of createIndexes) {
      try {
        patchbinDb.exec(stmt);
      } catch (e) {
        // Index might already exist
      }
    }
    
    console.log();
    
    // Step 2: Add siglistuuid and row_version to patchbin.db tables
    console.log('Step 2: Updating patchbin.db tables...');
    
    addColumnIfNotExists(patchbinDb, 'attachments', 'siglistuuid', 'VARCHAR(255)');
    addColumnIfNotExists(patchbinDb, 'attachments', 'row_version', 'INTEGER DEFAULT 1');
    
    addColumnIfNotExists(patchbinDb, 'signers', 'siglistuuid', 'VARCHAR(255)');
    addColumnIfNotExists(patchbinDb, 'signers', 'row_version', 'INTEGER DEFAULT 1');
    
    console.log();
    
    // Step 3: Add siglistuuid and row_version to rhdata.db tables
    console.log('Step 3: Updating rhdata.db tables...');
    
    addColumnIfNotExists(rhdataDb, 'gameversions', 'siglistuuid', 'VARCHAR(255)');
    addColumnIfNotExists(rhdataDb, 'gameversions', 'row_version', 'INTEGER DEFAULT 1');
    
    addColumnIfNotExists(rhdataDb, 'patchblobs', 'siglistuuid', 'VARCHAR(255)');
    addColumnIfNotExists(rhdataDb, 'patchblobs', 'row_version', 'INTEGER DEFAULT 1');
    
    // Check if rhpatches table exists
    const rhpatchesExists = rhdataDb.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='rhpatches'
    `).get();
    
    if (rhpatchesExists) {
      addColumnIfNotExists(rhdataDb, 'rhpatches', 'siglistuuid', 'VARCHAR(255)');
      addColumnIfNotExists(rhdataDb, 'rhpatches', 'row_version', 'INTEGER DEFAULT 1');
    } else {
      console.log('  ⓘ rhpatches table does not exist, skipping');
    }
    
    console.log();
    
    // Step 4: Update signaturelists table if it exists
    console.log('Step 4: Updating signaturelists table...');
    
    addColumnIfNotExists(patchbinDb, 'signaturelists', 'signlist_timestamp', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    addColumnIfNotExists(patchbinDb, 'signaturelists', 'signed_row_version', 'INTEGER DEFAULT 1');
    addColumnIfNotExists(patchbinDb, 'signaturelists', 'signed_action', 'VARCHAR(255) DEFAULT \'upsert\'');
    
    console.log();
    
    // Summary
    console.log('='.repeat(70));
    console.log('Migration Summary');
    console.log('='.repeat(70));
    console.log();
    
    // Count signed records
    const signedAttachments = patchbinDb.prepare(`
      SELECT COUNT(*) as count FROM attachments WHERE siglistuuid IS NOT NULL
    `).get();
    
    const signedSigners = patchbinDb.prepare(`
      SELECT COUNT(*) as count FROM signers WHERE siglistuuid IS NOT NULL
    `).get();
    
    const signedGameversions = rhdataDb.prepare(`
      SELECT COUNT(*) as count FROM gameversions WHERE siglistuuid IS NOT NULL
    `).get();
    
    const signedPatchblobs = rhdataDb.prepare(`
      SELECT COUNT(*) as count FROM patchblobs WHERE siglistuuid IS NOT NULL
    `).get();
    
    console.log('Signed Records:');
    console.log(`  Attachments:   ${signedAttachments.count}`);
    console.log(`  Signers:       ${signedSigners.count}`);
    console.log(`  GameVersions:  ${signedGameversions.count}`);
    console.log(`  PatchBlobs:    ${signedPatchblobs.count}`);
    console.log();
    
    const totalSignatureLists = patchbinDb.prepare(`
      SELECT COUNT(*) as count FROM signaturelists
    `).get();
    
    const totalSignatures = patchbinDb.prepare(`
      SELECT COUNT(*) as count FROM signaturelistentries
    `).get();
    
    console.log('Signature Tables:');
    console.log(`  Signature Lists: ${totalSignatureLists.count}`);
    console.log(`  Signatures:      ${totalSignatures.count}`);
    console.log();
    
    console.log('✓ Migration complete!');
    
  } catch (error) {
    console.error('Migration error:', error.message);
    throw error;
  } finally {
    patchbinDb.close();
    rhdataDb.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, addColumnIfNotExists };

