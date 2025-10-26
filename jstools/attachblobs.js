#!/usr/bin/env node

/**
 * attachblobs.js - Attach blob files to patchbin.db database
 * 
 * Usage:
 *   node attachblobs.js              # Process all patchblobs
 *   node attachblobs.js --newonly    # Only process new patchblobs (faster)
 *   node attachblobs.js --help       # Show help message
 *   npm run attachblobs
 * 
 * Options:
 *   --newonly    Skip processing patchblobs where file_name already exists
 *                in attachments table. This significantly speeds up incremental
 *                processing by avoiding file searches and hash calculations for
 *                files that have already been attached.
 * 
 * Features:
 * - Reads patchblobs records from rhdata.db
 * - Recursively searches for files matching patchblob1_name
 * - Verifies file integrity with SHA-224 hash
 * - Calculates multiple hashes (SHA-1, SHA-224, SHA-256, MD5)
 * - Calculates CRC checksums (CRC16, CRC32)
 * - Calculates IPFS CIDs (v0 and v1)
 * - Handles encrypted files (decrypts using patchblob1_key)
 * - Inserts/updates records into attachments table in patchbin.db
 * - Preserves existing non-NULL data in fields not being calculated
 *   (e.g., arweave_file_name, arweave_file_id, arweave_file_path)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const crc32 = require('crc-32');
const crc16 = require('crc').crc16;
const { CID } = require('multiformats/cid');
const { sha256 } = require('multiformats/hashes/sha2');
const fernet = require('fernet');
const lzma = require('lzma-native');
const UrlBase64 = require('urlsafe-base64');

// Database paths
const RHDATA_DB_PATH = path.join(__dirname, 'electron', 'rhdata.db');
const PATCHBIN_DB_PATH = path.join(__dirname, 'electron', 'patchbin.db');

// Project root for searching
const PROJECT_ROOT = __dirname;

/**
 * Generate a UUID v4
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Calculate SHA-224 hash
 */
function sha224(buffer) {
  return crypto.createHash('sha224').update(buffer).digest('hex');
}

/**
 * Calculate SHA-1 hash
 */
function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

/**
 * Calculate SHA-256 hash
 */
function sha256Hash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Calculate MD5 hash
 */
function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Calculate CRC16 (BSD checksum)
 */
function calculateCRC16(buffer) {
  return crc16(buffer).toString(16).padStart(4, '0');
}

/**
 * Calculate CRC32
 */
function calculateCRC32(buffer) {
  const result = crc32.buf(buffer);
  // Convert signed to unsigned
  return (result >>> 0).toString(16).padStart(8, '0');
}

/**
 * Calculate IPFS CID v0 and v1
 */
async function calculateIPFSCIDs(buffer) {
  // Create SHA-256 multihash
  const hash = await sha256.digest(buffer);
  
  // CIDv0 (dag-pb, base58btc)
  const cidV0 = CID.createV0(hash);
  
  // CIDv1 (dag-pb, base32)
  const cidV1 = CID.createV1(0x70, hash); // 0x70 is dag-pb codec
  
  return {
    cidv0: cidV0.toString(),
    cidv1: cidV1.toString()
  };
}

/**
 * Decrypt Fernet encrypted data
 */
async function decryptFernet(encryptedData, key) {
  const frnsecret = new fernet.Secret(key);
  const token = new fernet.Token({ 
    secret: frnsecret, 
    ttl: 0, 
    token: encryptedData 
  });
  return token.decode();
}

/**
 * atob implementation for Node.js
 */
function atob(bstr) {
  return Buffer.from(bstr, 'base64').toString();
}

/**
 * Decompress LZMA data
 */
async function decompressLZMA(buffer) {
  return await lzma.decompress(buffer);
}

/**
 * Decode encrypted patchblob (decrypt and decompress)
 */
async function decodePatchBlob(rawData, patchblob1_key) {
  try {
    // Step 1: Decompress LZMA
    const decomp1 = await decompressLZMA(rawData);
    
    // Step 2: Prepare Fernet key
    const key = UrlBase64.encode(atob(patchblob1_key)).toString();
    
    // Step 3: Decrypt with Fernet
    const decrypted = await decryptFernet(Buffer.from(decomp1).toString(), key);
    
    // Step 4: Decompress again
    const decomp2 = await decompressLZMA(Buffer.from(decrypted, 'base64'));
    
    return decomp2;
  } catch (error) {
    console.error('Error decoding patchblob:', error.message);
    return null;
  }
}

/**
 * Recursively search for file by name, excluding symlinks
 */
function findFileRecursive(dir, fileName, foundFiles = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      // Skip symbolic links
      if (entry.isSymbolicLink()) {
        continue;
      }
      
      if (entry.isDirectory()) {
        // Recursively search subdirectories
        findFileRecursive(fullPath, fileName, foundFiles);
      } else if (entry.isFile() && entry.name === fileName) {
        foundFiles.push(fullPath);
      }
    }
  } catch (error) {
    // Skip directories we can't read
    console.log(`Warning: Cannot read directory ${dir}: ${error.message}`);
  }
  
  return foundFiles;
}

/**
 * Check if attachment already exists and return its details
 */
function getAttachmentStatus(db, fileName, fileHashSha224) {
  const query = `
    SELECT *
    FROM attachments 
    WHERE file_name = ? AND file_hash_sha224 = ?
  `;
  const result = db.prepare(query).get(fileName, fileHashSha224);
  
  if (!result) {
    return { exists: false, needsFileSizeUpdate: false, auuid: null, existingData: null };
  }
  
  // Check if file_size is missing (NULL or undefined)
  const needsFileSizeUpdate = result.file_size == null;
  
  return {
    exists: true,
    needsFileSizeUpdate: needsFileSizeUpdate,
    auuid: result.auuid,
    existingData: result
  };
}

/**
 * Process a single patchblob record
 */
async function processPatchBlob(rhdataDb, patchbinDb, record) {
  const { pbuuid, gvuuid, patchblob1_name, patchblob1_sha224, patchblob1_key, pat_sha224 } = record;
  
  console.log(`\nProcessing: ${patchblob1_name}`);
  
  // Search for the file
  console.log(`Searching for file: ${patchblob1_name}...`);
  const foundFiles = findFileRecursive(PROJECT_ROOT, patchblob1_name);
  
  if (foundFiles.length === 0) {
    console.log(`  ⚠ File not found: ${patchblob1_name}`);
    return;
  }
  
  console.log(`  Found ${foundFiles.length} file(s) with matching name`);
  
  // Try each found file
  let validFile = null;
  let fileData = null;
  
  for (const filePath of foundFiles) {
    try {
      fileData = fs.readFileSync(filePath);
      const fileHash = sha224(fileData);
      
      if (fileHash === patchblob1_sha224) {
        console.log(`  ✓ Hash verified: ${filePath}`);
        validFile = filePath;
        break;
      } else {
        console.log(`  ⚠ Hash mismatch for ${filePath}`);
        console.log(`    Expected: ${patchblob1_sha224}`);
        console.log(`    Got:      ${fileHash}`);
      }
    } catch (error) {
      console.log(`  ⚠ Error reading ${filePath}: ${error.message}`);
    }
  }
  
  if (!validFile) {
    console.log(`  ✗ No valid file found with matching hash`);
    return;
  }
  
  // Calculate file hashes and checksums
  console.log(`  Calculating hashes and checksums...`);
  const fileCrc16 = calculateCRC16(fileData);
  const fileCrc32 = calculateCRC32(fileData);
  const fileHashSha224 = sha224(fileData);
  const fileHashSha1 = sha1(fileData);
  const fileHashMd5 = md5(fileData);
  const fileHashSha256 = sha256Hash(fileData);
  const fileIPFS = await calculateIPFSCIDs(fileData);
  const fileSize = fileData.length;
  
  // Check if already exists
  const attachmentStatus = getAttachmentStatus(patchbinDb, patchblob1_name, fileHashSha224);
  
  // Prepare new calculated data
  const newCalculatedData = {
    pbuuid: pbuuid,
    gvuuid: gvuuid,
    file_crc16: fileCrc16,
    file_crc32: fileCrc32,
    file_size: fileSize,
    locators: JSON.stringify([]),
    parents: JSON.stringify([]),
    file_ipfs_cidv0: fileIPFS.cidv0,
    file_ipfs_cidv1: fileIPFS.cidv1,
    file_hash_sha224: fileHashSha224,
    file_hash_sha1: fileHashSha1,
    file_hash_md5: fileHashMd5,
    file_hash_sha256: fileHashSha256,
    file_name: patchblob1_name,
    filekey: patchblob1_key || '',
    decoded_ipfs_cidv0: '',
    decoded_ipfs_cidv1: '',
    decoded_hash_sha224: '',
    decoded_hash_sha1: '',
    decoded_hash_md5: '',
    decoded_hash_sha256: '',
    file_data: fileData
  };
  
  // Prepare attachment record - merge with existing data to preserve non-NULL values
  let attachment;
  if (attachmentStatus.exists) {
    console.log(`  ⓘ Record exists, merging with existing data to preserve non-NULL fields...`);
    
    // Start with existing data
    attachment = { ...attachmentStatus.existingData };
    
    // Overwrite with new calculated data
    Object.keys(newCalculatedData).forEach(key => {
      attachment[key] = newCalculatedData[key];
    });
    
    // Ensure we keep the existing auuid
    attachment.auuid = attachmentStatus.auuid;
  } else {
    // New record - use calculated data and generate new UUID
    attachment = {
      auuid: generateUUID(),
      ...newCalculatedData
    };
  }
  
  // If encrypted, decode and calculate decoded hashes
  if (patchblob1_key && pat_sha224) {
    console.log(`  Decoding encrypted patchblob...`);
    const decodedData = await decodePatchBlob(fileData, patchblob1_key);
    
    if (decodedData) {
      const decodedHashSha224 = sha224(decodedData);
      
      // Verify decoded hash matches expected pat_sha224
      if (decodedHashSha224 !== pat_sha224) {
        console.log(`  ✗ Decoded hash mismatch!`);
        console.log(`    Expected: ${pat_sha224}`);
        console.log(`    Got:      ${decodedHashSha224}`);
        console.log(`  Aborting insert for this record.`);
        return;
      }
      
      console.log(`  ✓ Decoded hash verified`);
      
      // Calculate and update decoded hashes and IPFS CIDs
      attachment.decoded_hash_sha224 = decodedHashSha224;
      attachment.decoded_hash_sha1 = sha1(decodedData);
      attachment.decoded_hash_md5 = md5(decodedData);
      attachment.decoded_hash_sha256 = sha256Hash(decodedData);
      const decodedIPFS = await calculateIPFSCIDs(decodedData);
      attachment.decoded_ipfs_cidv0 = decodedIPFS.cidv0;
      attachment.decoded_ipfs_cidv1 = decodedIPFS.cidv1;
    } else {
      console.log(`  ⚠ Failed to decode patchblob, continuing without decoded data`);
      // If decoding failed but we have existing decoded data, preserve it
      // (already preserved in the merge above if record exists)
    }
  }
  
  // Insert or update attachments table
  try {
    const fields = Object.keys(attachment);
    const placeholders = fields.map(f => `@${f}`);
    
    const query = `
      REPLACE INTO attachments (${fields.join(', ')}) 
      VALUES (${placeholders.join(', ')})
    `;
    
    patchbinDb.prepare(query).run(attachment);
    
    if (attachmentStatus.exists) {
      console.log(`  ✓ Updated attachments table (auuid: ${attachment.auuid}) - preserved existing data`);
    } else {
      console.log(`  ✓ Inserted into attachments table (auuid: ${attachment.auuid})`);
    }
  } catch (error) {
    console.error(`  ✗ Error inserting/updating database: ${error.message}`);
  }
}

/**
 * Check if any attachment exists with the given file_name
 */
function fileNameExistsInAttachments(db, fileName) {
  const query = `
    SELECT COUNT(*) as count
    FROM attachments 
    WHERE file_name = ?
  `;
  const result = db.prepare(query).get(fileName);
  return result.count > 0;
}

/**
 * Parse command line arguments
 */
function parseCommandLineArgs() {
  const args = process.argv.slice(2);
  const options = {
    newonly: false
  };
  
  for (const arg of args) {
    if (arg === '--newonly') {
      options.newonly = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node attachblobs.js [options]

Options:
  --newonly    Skip processing patchblobs where file_name already exists
               in attachments table (for faster incremental processing)
  --help, -h   Show this help message

Examples:
  node attachblobs.js              # Process all patchblobs
  node attachblobs.js --newonly    # Only process new patchblobs
      `);
      process.exit(0);
    } else {
      console.warn(`Warning: Unknown option: ${arg}`);
    }
  }
  
  return options;
}

/**
 * Main function
 */
async function main() {
  // Parse command line options
  const options = parseCommandLineArgs();
  
  console.log('attachblobs.js - Attaching blob files to patchbin.db\n');
  
  if (options.newonly) {
    console.log('Mode: --newonly (skipping existing file_names)\n');
  }
  
  // Check if databases exist
  if (!fs.existsSync(RHDATA_DB_PATH)) {
    console.error(`Error: rhdata.db not found at ${RHDATA_DB_PATH}`);
    process.exit(1);
  }
  
  if (!fs.existsSync(PATCHBIN_DB_PATH)) {
    console.error(`Error: patchbin.db not found at ${PATCHBIN_DB_PATH}`);
    console.log('Creating patchbin.db...');
    // Create the database
    const patchbinDb = new Database(PATCHBIN_DB_PATH);
    const schemaPath = path.join(__dirname, 'electron', 'sql', 'patchbin.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      patchbinDb.exec(schema);
      patchbinDb.close();
      console.log('Created patchbin.db successfully.');
    } else {
      console.error(`Error: Schema file not found at ${schemaPath}`);
      process.exit(1);
    }
  }
  
  // Open databases
  const rhdataDb = new Database(RHDATA_DB_PATH);
  const patchbinDb = new Database(PATCHBIN_DB_PATH);
  
  // Disable foreign keys for patchbin if needed
  patchbinDb.pragma('foreign_keys = OFF');
  
  try {
    // Get all patchblobs
    const query = `
      SELECT pbuuid, gvuuid, patchblob1_name, patchblob1_sha224, 
             patchblob1_key, pat_sha224 
      FROM patchblobs 
      WHERE patchblob1_name IS NOT NULL 
        AND patchblob1_sha224 IS NOT NULL
    `;
    
    const patchblobs = rhdataDb.prepare(query).all();
    
    console.log(`Found ${patchblobs.length} patchblob records to process\n`);
    console.log('='.repeat(60));
    
    let processed = 0;
    let inserted = 0;
    let skipped = 0;
    let skippedNewOnly = 0;
    let errors = 0;
    
    for (const record of patchblobs) {
      try {
        // If --newonly is set, skip if file_name already exists
        if (options.newonly && fileNameExistsInAttachments(patchbinDb, record.patchblob1_name)) {
          console.log(`\nSkipping (--newonly): ${record.patchblob1_name} (already exists)`);
          skippedNewOnly++;
          processed++;
          continue;
        }
        
        const beforeCount = patchbinDb.prepare('SELECT COUNT(*) as count FROM attachments').get().count;
        await processPatchBlob(rhdataDb, patchbinDb, record);
        const afterCount = patchbinDb.prepare('SELECT COUNT(*) as count FROM attachments').get().count;
        
        if (afterCount > beforeCount) {
          inserted++;
        } else {
          skipped++;
        }
      } catch (error) {
        console.error(`Error processing ${record.patchblob1_name}: ${error.message}`);
        errors++;
      }
      processed++;
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('\nSummary:');
    console.log(`  Total processed: ${processed}`);
    console.log(`  Inserted:        ${inserted}`);
    console.log(`  Skipped:         ${skipped}`);
    if (options.newonly) {
      console.log(`  Skipped (--newonly): ${skippedNewOnly}`);
    }
    console.log(`  Errors:          ${errors}`);
    
  } finally {
    rhdataDb.close();
    patchbinDb.close();
  }
}

// Run main function
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { 
  processPatchBlob,
  fileNameExistsInAttachments,
  parseCommandLineArgs,
  generateUUID,
  sha224,
  sha1,
  sha256Hash,
  md5,
  calculateCRC16,
  calculateCRC32,
  calculateIPFSCIDs
};

