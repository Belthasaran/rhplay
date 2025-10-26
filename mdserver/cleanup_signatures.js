#!/usr/bin/env node

/**
 * Cleanup Orphaned Signatures
 * 
 * Finds and archives orphaned or outdated signaturelists and signaturelistentries
 * Orphaned = signaturelist not referenced by any record
 * Outdated = signed_row_version < current row_version
 * 
 * Usage:
 *   node cleanup_signatures.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PATCHBIN_DB = path.join(__dirname, 'patchbin.db');
const RHDATA_DB = path.join(__dirname, 'rhdata.db');
const LOG_HISTORICAL = path.join(__dirname, 'log_mdsign_historical.json');

// Tables that support signatures
const SIGNED_TABLES = {
  'gameversions': { db: RHDATA_DB, primaryKey: 'gvuuid' },
  'patchblobs': { db: RHDATA_DB, primaryKey: 'pbuuid' },
  'rhpatches': { db: RHDATA_DB, primaryKey: 'rhpuuid' },
  'attachments': { db: PATCHBIN_DB, primaryKey: 'auuid' },
  'signers': { db: PATCHBIN_DB, primaryKey: 'signeruuid' }
};

/**
 * Append to historical log
 */
function appendToHistoricalLog(entry) {
  try {
    let logs = [];
    
    if (fs.existsSync(LOG_HISTORICAL)) {
      const content = fs.readFileSync(LOG_HISTORICAL, 'utf8');
      if (content.trim()) {
        logs = JSON.parse(content);
      }
    }
    
    logs.push(entry);
    fs.writeFileSync(LOG_HISTORICAL, JSON.stringify(logs, null, 2));
    
    return true;
  } catch (error) {
    console.error(`  ⚠ Error writing to historical log: ${error.message}`);
    return false;
  }
}

/**
 * Find orphaned signaturelists
 */
function findOrphanedSignatureLists(patchbinDb) {
  const orphaned = [];
  
  // Get all signaturelists
  const allLists = patchbinDb.prepare('SELECT * FROM signaturelists').all();
  
  for (const list of allLists) {
    const tableInfo = SIGNED_TABLES[list.record_type];
    if (!tableInfo) {
      orphaned.push({ ...list, reason: 'unknown_table' });
      continue;
    }
    
    // Check if record still exists and references this signaturelist
    const db = new Database(tableInfo.db, { readonly: true });
    
    try {
      const record = db.prepare(`
        SELECT siglistuuid, row_version FROM ${list.record_type}
        WHERE ${tableInfo.primaryKey} = ?
      `).get(list.record_uuid);
      
      if (!record) {
        orphaned.push({ ...list, reason: 'record_deleted' });
      } else if (record.siglistuuid !== list.siglistuuid) {
        orphaned.push({ ...list, reason: 'not_referenced' });
      } else if (record.row_version > list.signed_row_version) {
        orphaned.push({ ...list, reason: 'version_outdated', current_version: record.row_version });
      }
    } finally {
      db.close();
    }
  }
  
  return orphaned;
}

/**
 * Archive and delete orphaned signatures
 */
function cleanupOrphaned(patchbinDb, orphaned, dryRun = false) {
  let archived = 0;
  let deleted = 0;
  
  for (const list of orphaned) {
    try {
      // Get associated signatures
      const signatures = patchbinDb.prepare(`
        SELECT e.*, s.signer_name
        FROM signaturelistentries e
        LEFT JOIN signers s ON e.signeruuid = s.signeruuid
        WHERE e.siglistuuid = ?
      `).all(list.siglistuuid);
      
      // Archive to historical log
      const entry = {
        timestamp: new Date().toISOString(),
        action: 'cleanup_orphaned',
        reason: list.reason,
        table: list.record_type,
        record_uuid: list.record_uuid,
        signaturelist: list,
        signatures: signatures,
        current_version: list.current_version,
        cleaned_at: new Date().toISOString()
      };
      
      if (!dryRun) {
        appendToHistoricalLog(entry);
        archived++;
        
        // Delete signature entries
        patchbinDb.prepare(`
          DELETE FROM signaturelistentries WHERE siglistuuid = ?
        `).run(list.siglistuuid);
        
        // Delete signaturelist
        patchbinDb.prepare(`
          DELETE FROM signaturelists WHERE siglistuuid = ?
        `).run(list.siglistuuid);
        
        deleted++;
        
        console.log(`  ✓ Cleaned: ${list.siglistuuid} (${list.reason})`);
      } else {
        console.log(`  [DRY RUN] Would clean: ${list.siglistuuid} (${list.reason})`);
      }
      
    } catch (error) {
      console.error(`  ✗ Error cleaning ${list.siglistuuid}: ${error.message}`);
    }
  }
  
  return { archived, deleted };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  console.log('='.repeat(70));
  console.log('Signature Cleanup');
  console.log('='.repeat(70));
  console.log();
  
  if (dryRun) {
    console.log('⚠ DRY RUN MODE - No changes will be made\n');
  }
  
  if (!fs.existsSync(PATCHBIN_DB)) {
    console.error(`Error: patchbin.db not found at ${PATCHBIN_DB}`);
    process.exit(1);
  }
  
  const patchbinDb = new Database(PATCHBIN_DB);
  
  try {
    // Find orphaned signaturelists
    console.log('Scanning for orphaned/outdated signaturelists...');
    const orphaned = findOrphanedSignatureLists(patchbinDb);
    
    console.log(`  Found ${orphaned.length} orphaned/outdated signaturelist(s)\n`);
    
    if (orphaned.length === 0) {
      console.log('✓ No cleanup needed!');
      return;
    }
    
    // Group by reason
    const byReason = {};
    for (const item of orphaned) {
      byReason[item.reason] = (byReason[item.reason] || 0) + 1;
    }
    
    console.log('Breakdown by reason:');
    for (const [reason, count] of Object.entries(byReason)) {
      console.log(`  ${reason}: ${count}`);
    }
    console.log();
    
    // Cleanup
    console.log('Cleaning up...');
    const result = cleanupOrphaned(patchbinDb, orphaned, dryRun);
    
    console.log();
    console.log('='.repeat(70));
    console.log('Cleanup Summary');
    console.log('='.repeat(70));
    console.log();
    console.log(`Total orphaned:       ${orphaned.length}`);
    console.log(`Archived to log:      ${result.archived}`);
    console.log(`Deleted from database: ${result.deleted}`);
    
    if (dryRun) {
      console.log();
      console.log('This was a DRY RUN. Run without --dry-run to actually clean up.');
    } else {
      console.log();
      console.log(`✓ Historical log: ${LOG_HISTORICAL}`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    patchbinDb.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { findOrphanedSignatureLists, cleanupOrphaned };

