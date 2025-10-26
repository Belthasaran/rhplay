#!/usr/bin/env node

/**
 * Sign Metadata Records
 * 
 * Creates digital signatures for records in gameversions, patchblobs, rhpatches, attachments
 * 
 * Usage:
 *   node sign_metadata.js --signer=SIGNER_UUID --table=TABLE_NAME --record=RECORD_UUID --keyfile=KEY_FILE
 *   node sign_metadata.js --signer=abc123 --table=attachments --record=xyz789 --keyfile=signer_metadata_abc_2025.txt
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PATCHBIN_DB = path.join(__dirname, 'patchbin.db');
const RHDATA_DB = path.join(__dirname, 'rhdata.db');

const LOG_NEW_SIGNATURES = path.join(__dirname, 'log_mdsign_new.json');
const LOG_HISTORICAL_SIGNATURES = path.join(__dirname, 'log_mdsign_historical.json');

// Tables that support signatures
const SIGNED_TABLES = {
  'gameversions': { db: RHDATA_DB, primaryKey: 'gvuuid' },
  'patchblobs': { db: RHDATA_DB, primaryKey: 'pbuuid' },
  'rhpatches': { db: RHDATA_DB, primaryKey: 'rhpuuid' },
  'attachments': { db: PATCHBIN_DB, primaryKey: 'auuid' },
  'signers': { db: PATCHBIN_DB, primaryKey: 'signeruuid' }
};

/**
 * Parse key file
 */
function parseKeyFile(keyfilePath) {
  const content = fs.readFileSync(keyfilePath, 'utf8');
  
  const signerUuid = content.match(/SIGNER_UUID=([^\n]+)/)?.[1];
  const algorithm = content.match(/ALGORITHM=([^\n]+)/)?.[1];
  
  // Extract PEM private key
  const pemMatch = content.match(/PRIVATE_KEY_PEM<<EOF\n([\s\S]+?)\nEOF/);
  const privateKeyPem = pemMatch ? pemMatch[1] : null;
  
  // Or hex private key
  const privateKeyHex = content.match(/PRIVATE_KEY_HEX=([^\n]+)/)?.[1];
  
  if (!signerUuid || !algorithm) {
    throw new Error('Invalid key file format');
  }
  
  let privateKey;
  if (privateKeyPem) {
    privateKey = crypto.createPrivateKey(privateKeyPem);
  } else if (privateKeyHex) {
    const keyBuffer = Buffer.from(privateKeyHex, 'hex');
    privateKey = crypto.createPrivateKey({
      key: keyBuffer,
      format: 'der',
      type: 'pkcs8'
    });
  } else {
    throw new Error('No private key found in file');
  }
  
  return {
    signerUuid,
    algorithm,
    privateKey
  };
}

/**
 * Get record from database
 */
function getRecord(tableName, recordUuid) {
  const tableInfo = SIGNED_TABLES[tableName];
  if (!tableInfo) {
    throw new Error(`Table ${tableName} is not a signed table`);
  }
  
  const db = new Database(tableInfo.db);
  
  try {
    const record = db.prepare(`SELECT * FROM ${tableName} WHERE ${tableInfo.primaryKey} = ?`).get(recordUuid);
    
    if (!record) {
      throw new Error(`Record not found: ${recordUuid}`);
    }
    
    return record;
  } finally {
    db.close();
  }
}

/**
 * Create canonical string for signing
 * Excludes: siglistuuid, signature fields, timestamps, file_data (covered by file_hash_sha256)
 */
function createCanonicalString(record) {
  const entries = Object.entries(record)
    .filter(([key, value]) => {
      // Exclude signature-related fields
      if (key === 'siglistuuid') return false;
      if (key.includes('signature')) return false;
      
      // Exclude timestamp fields
      if (key.includes('import_time')) return false;
      if (key.includes('updated_time')) return false;
      if (key.includes('gvimport_time')) return false;
      if (key.includes('pbimport_time')) return false;
      if (key === 'last_search') return false;
      if (key === 'created_at') return false;
      if (key === 'last_access') return false;
      
      // IMPORTANT: Exclude file_data (it's covered by file_hash_sha256)
      if (key === 'file_data') return false;
      
      // Exclude other non-metadata fields
      if (key === 'pblobdata') return false; // Binary data in patchblobs
      
      return true;
    })
    .sort(([a], [b]) => a.localeCompare(b)); // Sort by key name
  
  // Create canonical string
  const parts = entries.map(([key, value]) => {
    if (value === null) {
      return `${key}=null`;
    } else if (Buffer.isBuffer(value)) {
      // For binary data, use hex representation (should not happen after file_data exclusion)
      return `${key}=${value.toString('hex')}`;
    } else {
      return `${key}=${value}`;
    }
  });
  
  return parts.join('&');
}

/**
 * Sign data
 */
function signData(data, privateKey, algorithm) {
  const hash = crypto.createHash('sha256').update(data).digest();
  
  if (algorithm === 'ED25519') {
    const signature = crypto.sign(null, hash, privateKey);
    return signature.toString('hex');
  } else if (algorithm === 'RSA') {
    const signature = crypto.sign('sha256', hash, {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING
    });
    return signature.toString('hex');
  } else {
    throw new Error(`Unsupported algorithm: ${algorithm}`);
  }
}

/**
 * Create a clean copy of record for logging (excludes file_data)
 */
function createCleanRecordCopy(record) {
  const clean = { ...record };
  
  // Remove file_data (covered by file_hash_sha256)
  delete clean.file_data;
  
  // Remove pblobdata (binary data in patchblobs)
  delete clean.pblobdata;
  
  // Convert any remaining buffers to hex
  for (const [key, value] of Object.entries(clean)) {
    if (Buffer.isBuffer(value)) {
      clean[key] = value.toString('hex');
    }
  }
  
  return clean;
}

/**
 * Append to JSON log file
 */
function appendToLog(logPath, entry) {
  try {
    let logs = [];
    
    // Read existing log if it exists
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      if (content.trim()) {
        logs = JSON.parse(content);
      }
    }
    
    // Append new entry
    logs.push(entry);
    
    // Write back to file
    fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
    
    return true;
  } catch (error) {
    console.error(`  ⚠ Error writing to log: ${error.message}`);
    return false;
  }
}

/**
 * Log new signature
 */
function logNewSignature(tableName, record, siglistUuid, signerUuid, signature, algorithm, action) {
  const entry = {
    timestamp: new Date().toISOString(),
    action: 'new_signature',
    table: tableName,
    record_uuid: record[SIGNED_TABLES[tableName].primaryKey],
    row_version: record.row_version || 1,
    siglistuuid: siglistUuid,
    signeruuid: signerUuid,
    signature_algorithm: algorithm,
    signed_action: action,
    signature: signature,
    record_snapshot: createCleanRecordCopy(record)
  };
  
  appendToLog(LOG_NEW_SIGNATURES, entry);
}

/**
 * Archive outdated signatures
 */
function archiveOutdatedSignatures(db, oldSiglistUuid, tableName, recordUuid) {
  try {
    // Get old signaturelist details
    const oldList = db.prepare(`
      SELECT * FROM signaturelists WHERE siglistuuid = ?
    `).get(oldSiglistUuid);
    
    if (!oldList) return;
    
    // Get old signatures
    const oldSignatures = db.prepare(`
      SELECT e.*, s.signer_name
      FROM signaturelistentries e
      LEFT JOIN signers s ON e.signeruuid = s.signeruuid
      WHERE e.siglistuuid = ?
    `).all(oldSiglistUuid);
    
    const entry = {
      timestamp: new Date().toISOString(),
      action: 'archive_outdated',
      reason: 'row_version_mismatch',
      table: tableName,
      record_uuid: recordUuid,
      old_signaturelist: oldList,
      old_signatures: oldSignatures,
      archived_at: new Date().toISOString()
    };
    
    appendToLog(LOG_HISTORICAL_SIGNATURES, entry);
    console.log(`  ✓ Archived ${oldSignatures.length} outdated signature(s) to log`);
    
  } catch (error) {
    console.error(`  ⚠ Error archiving signatures: ${error.message}`);
  }
}

/**
 * Create or get signaturelist for record
 */
function ensureSignatureList(db, tableName, recordUuid, currentSiglistUuid, rowVersion, action = 'upsert') {
  // Check if existing signaturelist is for current row version
  if (currentSiglistUuid) {
    const existingList = db.prepare(`
      SELECT signed_row_version FROM signaturelists WHERE siglistuuid = ?
    `).get(currentSiglistUuid);
    
    if (existingList && existingList.signed_row_version === rowVersion) {
      console.log(`  ⓘ Using existing signaturelist: ${currentSiglistUuid} (row version ${rowVersion})`);
      return currentSiglistUuid;
    } else {
      console.log(`  ⚠ Row version mismatch: signed=${existingList?.signed_row_version}, current=${rowVersion}`);
      console.log(`  ⓘ Archiving and removing old signaturelist...`);
      
      // Archive outdated signatures before deletion
      archiveOutdatedSignatures(db, currentSiglistUuid, tableName, recordUuid);
      
      // Delete old signature list entries
      db.prepare(`DELETE FROM signaturelistentries WHERE siglistuuid = ?`).run(currentSiglistUuid);
      
      // Delete old signature list
      db.prepare(`DELETE FROM signaturelists WHERE siglistuuid = ?`).run(currentSiglistUuid);
      
      console.log(`  ✓ Removed outdated signaturelist`);
    }
  }
  
  // Create new signaturelist
  const siglistUuid = crypto.randomUUID();
  
  db.prepare(`
    INSERT INTO signaturelists (siglistuuid, record_type, record_uuid, signed_row_version, signed_action)
    VALUES (?, ?, ?, ?, ?)
  `).run(siglistUuid, tableName, recordUuid, rowVersion, action);
  
  console.log(`  ✓ Created new signaturelist: ${siglistUuid} (row version ${rowVersion})`);
  
  return siglistUuid;
}

/**
 * Add signature to signaturelist
 */
function addSignature(db, siglistUuid, signerUuid, signature, algorithm, tableName, record, action) {
  // Check if signature already exists for this signer
  const existing = db.prepare(`
    SELECT entryuuid FROM signaturelistentries
    WHERE siglistuuid = ? AND signeruuid = ?
  `).get(siglistUuid, signerUuid);
  
  if (existing) {
    console.log(`  ⚠ Signature already exists for this signer, updating...`);
    
    db.prepare(`
      UPDATE signaturelistentries
      SET signature = ?, signed_at = CURRENT_TIMESTAMP
      WHERE entryuuid = ?
    `).run(signature, existing.entryuuid);
    
    console.log(`  ✓ Updated signature`);
  } else {
    const entryUuid = crypto.randomUUID();
    
    db.prepare(`
      INSERT INTO signaturelistentries (entryuuid, siglistuuid, signeruuid, signature, signature_algorithm, hash_algorithm)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(entryUuid, siglistUuid, signerUuid, signature, algorithm, 'SHA256');
    
    console.log(`  ✓ Created new signature entry: ${entryUuid}`);
    
    // Log new signature
    if (tableName && record) {
      logNewSignature(tableName, record, siglistUuid, signerUuid, signature, algorithm, action);
      console.log(`  ✓ Logged to ${path.basename(LOG_NEW_SIGNATURES)}`);
    }
  }
}

/**
 * Update record with siglistuuid
 */
function updateRecordSiglistUuid(tableName, recordUuid, siglistUuid) {
  const tableInfo = SIGNED_TABLES[tableName];
  const db = new Database(tableInfo.db);
  
  try {
    // Check if siglistuuid column exists
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const hasSiglistUuid = columns.some(col => col.name === 'siglistuuid');
    
    if (!hasSiglistUuid) {
      console.log(`  ⚠ Warning: ${tableName} table does not have siglistuuid column`);
      console.log(`  Run: ALTER TABLE ${tableName} ADD COLUMN siglistuuid VARCHAR(255);`);
      return false;
    }
    
    db.prepare(`
      UPDATE ${tableName}
      SET siglistuuid = ?
      WHERE ${tableInfo.primaryKey} = ?
    `).run(siglistUuid, recordUuid);
    
    console.log(`  ✓ Updated ${tableName} record with siglistuuid`);
    return true;
  } finally {
    db.close();
  }
}

/**
 * Sign all unsigned or outdated records in a table
 */
async function signAllRecords(tableName, keyfilePath, db, action = 'upsert') {
  console.log(`Signing all unsigned/outdated records in ${tableName}...`);
  
  const tableInfo = SIGNED_TABLES[tableName];
  const dataDb = tableName === 'attachments' || tableName === 'signers' 
    ? db 
    : new Database(tableInfo.db);
  
  try {
    // Find records that need signing
    const query = `
      SELECT * FROM ${tableName}
      WHERE siglistuuid IS NULL
         OR row_version > (
           SELECT signed_row_version 
           FROM signaturelists 
           WHERE siglistuuid = ${tableName}.siglistuuid
         )
    `;
    
    const records = dataDb.prepare(query).all();
    
    console.log(`  Found ${records.length} record(s) needing signatures`);
    
    if (records.length === 0) {
      return { signed: 0, skipped: 0 };
    }
    
    // Load signer key
    const signer = parseKeyFile(keyfilePath);
    
    let signed = 0;
    let errors = 0;
    
    for (const record of records) {
      try {
        const recordUuid = record[tableInfo.primaryKey];
        const rowVersion = record.row_version || 1;
        
        console.log(`\n  [${signed + 1}/${records.length}] Signing ${recordUuid} (v${rowVersion})`);
        
        // Create canonical string
        const canonical = createCanonicalString(record);
        
        // Sign the data
        const signature = signData(canonical, signer.privateKey, signer.algorithm);
        
        // Ensure signature list (handles version mismatch)
        const siglistUuid = ensureSignatureList(db, tableName, recordUuid, record.siglistuuid, rowVersion, action);
        
        // Add signature
        addSignature(db, siglistUuid, signer.signerUuid, signature, signer.algorithm, tableName, record, action);
        
        // Update record if needed
        if (!record.siglistuuid || record.siglistuuid !== siglistUuid) {
          updateRecordSiglistUuid(tableName, recordUuid, siglistUuid);
        }
        
        signed++;
        
      } catch (error) {
        console.error(`  ✗ Error signing ${record[tableInfo.primaryKey]}: ${error.message}`);
        errors++;
      }
    }
    
    return { signed, errors, total: records.length };
    
  } finally {
    if (dataDb !== db && dataDb) {
      dataDb.close();
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  const options = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=');
      options[key] = value || 'true';
    }
  }
  
  if (!options.table || !options.keyfile) {
    console.log('Sign Metadata Records\n');
    console.log('Usage:');
    console.log('  Single record:');
    console.log('    node sign_metadata.js --table=TABLE_NAME --record=RECORD_UUID --keyfile=KEY_FILE');
    console.log();
    console.log('  All unsigned/outdated records:');
    console.log('    node sign_metadata.js --table=TABLE_NAME --all --keyfile=KEY_FILE');
    console.log();
    console.log('Options:');
    console.log('  --table=NAME      Table name (gameversions, patchblobs, rhpatches, attachments, signers)');
    console.log('  --record=UUID     Record UUID to sign (for single record)');
    console.log('  --all             Sign all unsigned or outdated records');
    console.log('  --keyfile=PATH    Path to signer key file');
    console.log('  --action=ACTION   Signature action (upsert/delete, default: upsert)');
    console.log();
    console.log('Examples:');
    console.log('  node sign_metadata.js --table=attachments --record=abc-123 --keyfile=signer_key.txt');
    console.log('  node sign_metadata.js --table=attachments --all --keyfile=signer_key.txt');
    console.log('  node sign_metadata.js --table=gameversions --all --keyfile=signer_key.txt');
    console.log();
    process.exit(0);
  }
  
  const tableName = options.table;
  const keyfilePath = path.resolve(options.keyfile);
  const action = options.action || 'upsert';
  
  // Open patchbin.db for signature management
  const db = new Database(PATCHBIN_DB);
  
  try {
    // Ensure signature tables exist
    const schemaPath = path.join(__dirname, 'signatures_schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      const createStatements = schema.match(/CREATE TABLE[^;]+;/gs) || [];
      for (const stmt of createStatements) {
        try {
          db.exec(stmt);
        } catch (e) {
          // Table exists, ignore
        }
      }
    }
    
    // Handle --all option
    if (options.all === 'true') {
      console.log('='.repeat(70));
      console.log('Signing All Unsigned/Outdated Records');
      console.log('='.repeat(70));
      console.log();
      console.log(`Table:   ${tableName}`);
      console.log(`Keyfile: ${keyfilePath}`);
      console.log(`Action:  ${action}`);
      console.log();
      
      const result = await signAllRecords(tableName, keyfilePath, db, action);
      
      console.log();
      console.log('='.repeat(70));
      console.log('Batch Signing Complete!');
      console.log('='.repeat(70));
      console.log();
      console.log(`Total records:    ${result.total}`);
      console.log(`Successfully signed: ${result.signed}`);
      console.log(`Errors:           ${result.errors || 0}`);
      console.log();
      
      return;
    }
    
    // Single record signing
    console.log('='.repeat(70));
    console.log('Signing Metadata Record');
    console.log('='.repeat(70));
    console.log();
    
    const recordUuid = options.record;
    
    console.log(`Table:   ${tableName}`);
    console.log(`Record:  ${recordUuid}`);
    console.log(`Keyfile: ${keyfilePath}`);
    console.log(`Action:  ${action}`);
    console.log();
  
    // Load signer key
    console.log('Loading signer key...');
    const signer = parseKeyFile(keyfilePath);
    console.log(`  ✓ Loaded ${signer.algorithm} private key`);
    console.log(`  Signer UUID: ${signer.signerUuid}`);
    console.log();
    
    // Get record from database
    console.log('Loading record from database...');
    const record = getRecord(tableName, recordUuid);
    const rowVersion = record.row_version || 1;
    console.log(`  ✓ Found record in ${tableName}`);
    console.log(`  Row version: ${rowVersion}`);
    console.log();
    
    // Create canonical string
    console.log('Creating canonical string...');
    const canonical = createCanonicalString(record);
    console.log(`  ✓ Canonical string created (${canonical.length} bytes)`);
    console.log();
    
    // Sign the data
    console.log('Generating signature...');
    const signature = signData(canonical, signer.privateKey, signer.algorithm);
    console.log(`  ✓ Signature generated (${signature.length} hex chars)`);
    console.log(`    ${signature.substring(0, 64)}...`);
    console.log();
    
    // Ensure signaturelist exists for this record
    console.log('Managing signature list...');
    const siglistUuid = ensureSignatureList(db, tableName, recordUuid, record.siglistuuid, rowVersion, action);
    
    // Add signature to signaturelist
    addSignature(db, siglistUuid, signer.signerUuid, signature, signer.algorithm, tableName, record, action);
    
    // Update record with siglistuuid if it was null or changed
    if (!record.siglistuuid || record.siglistuuid !== siglistUuid) {
      updateRecordSiglistUuid(tableName, recordUuid, siglistUuid);
    }
    
    console.log();
    console.log('='.repeat(70));
    console.log('Signature Created Successfully!');
    console.log('='.repeat(70));
    console.log();
    console.log(`Record:         ${recordUuid}`);
    console.log(`Table:          ${tableName}`);
    console.log(`Row Version:    ${rowVersion}`);
    console.log(`Signature List: ${siglistUuid}`);
    console.log(`Signer:         ${signer.signerUuid}`);
    console.log(`Algorithm:      ${signer.algorithm}`);
    console.log(`Action:         ${action}`);
    console.log(`Signature:      ${signature.substring(0, 32)}...`);
    console.log();
    
    // Show current signatures for this record
    const signatures = db.prepare(`
      SELECT e.*, s.signer_name, s.publickey_type
      FROM signaturelistentries e
      JOIN signers s ON e.signeruuid = s.signeruuid
      WHERE e.siglistuuid = ?
      ORDER BY e.signed_at DESC
    `).all(siglistUuid);
    
    console.log(`Total signatures for this record: ${signatures.length}`);
    signatures.forEach((sig, idx) => {
      console.log(`  ${idx+1}. ${sig.signer_name} (${sig.publickey_type}) - ${sig.signed_at}`);
    });
    console.log();
    
  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error.message);
    process.exit(1);
  });
}

module.exports = { createCanonicalString, signData };

