#!/usr/bin/env node

/**
 * fetchpatches.js - Fetch and manage patch attachments from ArDrive and other sources
 * 
 * Usage:
 *   node fetchpatches.js mode1          # Populate ArDrive metadata for attachments
 *   node fetchpatches.js mode2          # Find and download missing attachment data
 *   node fetchpatches.js mode3 [args]   # Retrieve specific attachment
 * 
 * Mode 1: Scan attachments table for missing ArDrive metadata and populate it
 * Mode 2: Find and download missing file_data (future implementation)
 * Mode 3: Retrieve specific attachment (future implementation)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const arDriveCore = require('ardrive-core-js');
const arweave = require('arweave');

// Database paths (can be overridden by --patchbindb and --rhdatadb)
let RHDATA_DB_PATH = path.join(__dirname, 'electron', 'rhdata.db');
let PATCHBIN_DB_PATH = path.join(__dirname, 'electron', 'patchbin.db');

// ArDrive configuration
const DEFAULT_GATEWAY = 'https://arweave.net:443';
const PUBLIC_FOLDER_ID = '07b13d74-e426-4012-8c6d-cba0927012fb';

// Default parameters for remote fetching
const DEFAULT_FETCH_LIMIT = 20;
const DEFAULT_FETCH_DELAY = 1000; // milliseconds
const MIN_FETCH_DELAY = 500; // minimum 500ms to avoid server overload

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse command line arguments for fetch parameters
 */
function parseArguments(args) {
  const params = {
    mode: null,
    fetchLimit: DEFAULT_FETCH_LIMIT,
    fetchDelay: DEFAULT_FETCH_DELAY,
    extraArgs: []
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--fetchlimit=')) {
      const value = parseInt(arg.split('=')[1], 10);
      if (isNaN(value) || value < 1) {
        console.error(`Invalid fetchlimit value: ${arg.split('=')[1]}`);
        console.error('fetchlimit must be a positive integer');
        process.exit(1);
      }
      params.fetchLimit = value;
    } else if (arg.startsWith('--fetchdelay=')) {
      const value = parseInt(arg.split('=')[1], 10);
      if (isNaN(value) || value < MIN_FETCH_DELAY) {
        console.error(`Invalid fetchdelay value: ${arg.split('=')[1]}`);
        console.error(`fetchdelay must be at least ${MIN_FETCH_DELAY}ms`);
        process.exit(1);
      }
      params.fetchDelay = value;
    } else if (arg.startsWith('--patchbindb=')) {
      PATCHBIN_DB_PATH = arg.split('=')[1];
    } else if (arg.startsWith('--rhdatadb=')) {
      RHDATA_DB_PATH = arg.split('=')[1];
    } else if (i === 0) {
      params.mode = arg.toLowerCase();
    } else {
      params.extraArgs.push(arg);
    }
  }
  
  return params;
}

/**
 * Initialize ArDrive anonymous client
 */
function initArDrive() {
  const arweaveUrl = new URL(DEFAULT_GATEWAY);
  const arweaveClient = arweave.init({
    host: arweaveUrl.hostname,
    protocol: arweaveUrl.protocol.replace(':', ''),
    port: arweaveUrl.port || 443,
    timeout: 600000
  });
  
  return arDriveCore.arDriveAnonymousFactory({ arweave: arweaveClient });
}

/**
 * List all files in the public ArDrive folder
 */
async function listArDriveFiles(arDrive) {
  try {
    const folderId = arDriveCore.EID(PUBLIC_FOLDER_ID);
    const files = await arDrive.listPublicFolder({ folderId: folderId, maxDepth: 10 });
    
    console.log(`Found ${files.length} items on ArDrive`);
    
    // Filter to only files (not folders)
    const fileItems = files.filter(item => item.entityType === 'file');
    console.log(`  ${fileItems.length} files`);
    console.log(`  ${files.length - fileItems.length} folders`);
    
    return fileItems;
  } catch (error) {
    console.error('Error listing ArDrive files:', error);
    throw error;
  }
}

/**
 * Download a file from ArDrive by transaction ID
 */
async function downloadArDriveFile(txId) {
  try {
    const url = `${DEFAULT_GATEWAY}/${txId}`;
    console.log(`    Downloading from ${url}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error(`    Error downloading file: ${error.message}`);
    return null;
  }
}

/**
 * Calculate SHA-224 hash
 */
function sha224(buffer) {
  return crypto.createHash('sha224').update(buffer).digest('hex');
}

/**
 * Calculate SHA-256 hash
 */
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Calculate SHA-1 hash
 */
function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

/**
 * Verify file hash against attachment record using secure hashes
 * Returns true if file matches, false otherwise
 */
function verifyFileHash(fileData, attachment) {
  // Priority: Use strongest hash available
  
  // SHA-256 (most secure and commonly used)
  if (attachment.file_hash_sha256) {
    const fileHash = sha256(fileData);
    if (fileHash === attachment.file_hash_sha256) {
      console.log(`    ✓ Verified with SHA-256: ${fileHash}`);
      return true;
    }
  }
  
  // SHA-224
  if (attachment.file_hash_sha224) {
    const fileHash = sha224(fileData);
    if (fileHash === attachment.file_hash_sha224) {
      console.log(`    ✓ Verified with SHA-224: ${fileHash}`);
      return true;
    }
  }
  
  // Decoded hashes (for encrypted files)
  if (attachment.decoded_hash_sha256) {
    const fileHash = sha256(fileData);
    if (fileHash === attachment.decoded_hash_sha256) {
      console.log(`    ✓ Verified with decoded SHA-256: ${fileHash}`);
      return true;
    }
  }
  
  if (attachment.decoded_hash_sha224) {
    const fileHash = sha224(fileData);
    if (fileHash === attachment.decoded_hash_sha224) {
      console.log(`    ✓ Verified with decoded SHA-224: ${fileHash}`);
      return true;
    }
  }
  
  console.log(`    ✗ Hash verification failed`);
  return false;
}

/**
 * Match ArDrive files with attachment records
 */
function matchFileToAttachment(ardriveFile, attachments) {
  const fileName = ardriveFile.name;
  
  // Try exact file name match first
  for (const attachment of attachments) {
    // Match exact name
    if (attachment.file_name === fileName) {
      return attachment;
    }
    
    // Match name without extension (.bin)
    if (fileName.endsWith('.bin') && attachment.file_name === fileName.slice(0, -4)) {
      return attachment;
    }
    
    // Match name with extension added
    if (attachment.file_name + '.bin' === fileName) {
      return attachment;
    }
  }
  
  return null;
}

/**
 * Mode 1: Populate ArDrive metadata for attachments with missing ArDrive info
 */
async function mode1_populateArDriveMetadata(fetchLimit = DEFAULT_FETCH_LIMIT, fetchDelay = DEFAULT_FETCH_DELAY) {
  console.log('='.repeat(70));
  console.log('MODE 1: Populate ArDrive Metadata');
  console.log('='.repeat(70));
  console.log();
  console.log(`Configuration:`);
  console.log(`  Fetch Limit: ${fetchLimit} attachments per run`);
  console.log(`  Fetch Delay: ${fetchDelay}ms between each attachment`);
  console.log();
  
  // Check if databases exist
  if (!fs.existsSync(PATCHBIN_DB_PATH)) {
    console.error(`Error: patchbin.db not found at ${PATCHBIN_DB_PATH}`);
    process.exit(1);
  }
  
  // Open database
  const db = new Database(PATCHBIN_DB_PATH);
  
  try {
    // Initialize ArDrive
    console.log('Initializing ArDrive client...');
    const arDrive = initArDrive();
    
    // List all files on ArDrive
    console.log(`\nListing files from ArDrive folder: ${PUBLIC_FOLDER_ID}`);
    const ardriveFiles = await listArDriveFiles(arDrive);
    
    // Get attachments with missing ArDrive metadata
    console.log('\nQuerying attachments with missing ArDrive metadata...');
    const query = `
      SELECT auuid, pbuuid, gvuuid, resuuid,
             file_name, file_hash_sha224, file_hash_sha256,
             file_ipfs_cidv0, file_ipfs_cidv1,
             decoded_hash_sha224, decoded_hash_sha256,
             arweave_file_name, arweave_file_id, arweave_file_path
      FROM attachments
      WHERE arweave_file_id IS NULL 
         OR arweave_file_name IS NULL 
         OR arweave_file_path IS NULL
    `;
    
    const attachments = db.prepare(query).all();
    console.log(`Found ${attachments.length} attachments with missing ArDrive metadata`);
    
    if (attachments.length === 0) {
      console.log('\n✓ All attachments already have ArDrive metadata!');
      return;
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('Processing attachments...\n');
    
    let processed = 0;
    let matched = 0;
    let verified = 0;
    let updated = 0;
    let failed = 0;
    
    // Process each ArDrive file
    for (const ardriveFile of ardriveFiles) {
      // Only process files, not folders
      if (ardriveFile.entityType !== 'file') {
        continue;
      }
      
      // Try to match with an attachment
      const attachment = matchFileToAttachment(ardriveFile, attachments);
      
      if (!attachment) {
        continue;
      }
      
      // Check if we've reached the fetch limit
      if (processed >= fetchLimit) {
        console.log(`\n⚠ Reached fetch limit of ${fetchLimit} attachments`);
        console.log(`  Stopping to avoid server overload`);
        console.log(`  Run the script again to process more attachments`);
        break;
      }
      
      matched++;
      processed++;
      
      const remaining = fetchLimit - processed;
      console.log(`\n[${processed}/${fetchLimit}] Matched: ${ardriveFile.name} (${remaining} remaining)`);
      console.log(`  ArDrive Path: ${ardriveFile.path}`);
      console.log(`  File ID: ${ardriveFile.entityId}`);
      console.log(`  Attachment: ${attachment.file_name} (auuid: ${attachment.auuid})`);
      
      // Download and verify the file
      console.log(`  Downloading file for verification...`);
      const fileData = await downloadArDriveFile(ardriveFile.dataTxId);
      
      if (!fileData) {
        console.log(`  ✗ Failed to download file`);
        failed++;
        continue;
      }
      
      console.log(`  Downloaded ${fileData.length} bytes`);
      
      // Verify hash
      if (!verifyFileHash(fileData, attachment)) {
        console.log(`  ✗ Hash mismatch - skipping`);
        failed++;
        continue;
      }
      
      verified++;
      
      // Update database with ArDrive metadata
      try {
        // Convert values to strings and handle potential undefined/null
        // This ensures SQLite compatibility (only accepts strings, numbers, buffers, null)
        const arweaveName = String(ardriveFile.name || '');
        const arweaveId = String(ardriveFile.entityId || '');
        const arweavePath = String(ardriveFile.path || '');
        const auuid = String(attachment.auuid || '');
        
        const updateQuery = `
          UPDATE attachments
          SET arweave_file_name = ?,
              arweave_file_id = ?,
              arweave_file_path = ?,
              updated_time = CURRENT_TIMESTAMP
          WHERE auuid = ?
        `;
        
        db.prepare(updateQuery).run(
          arweaveName,
          arweaveId,
          arweavePath,
          auuid
        );
        
        console.log(`  ✓ Updated database record`);
        updated++;
        
      } catch (error) {
        console.error(`  ✗ Database update error: ${error.message}`);
        console.error(`  ArDrive file: ${ardriveFile.name}, ID: ${ardriveFile.entityId}`);
        console.error(`  Attachment: ${attachment.file_name}, auuid: ${attachment.auuid}`);
        failed++;
      }
      
      // Add delay between processing attachments (if not the last one)
      if (processed < fetchLimit && remaining > 0) {
        console.log(`  ⏱ Waiting ${fetchDelay}ms before next download...`);
        await sleep(fetchDelay);
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('\nSummary:');
    console.log(`  Total attachments needing metadata: ${attachments.length}`);
    console.log(`  Attachments processed this run:     ${processed}`);
    console.log(`  Files matched by name:              ${matched}`);
    console.log(`  Files verified by hash:             ${verified}`);
    console.log(`  Records updated:                    ${updated}`);
    console.log(`  Failed:                             ${failed}`);
    console.log(`  Still missing metadata:             ${attachments.length - updated}`);
    
    if (processed >= fetchLimit && attachments.length > updated) {
      console.log('\n💡 Tip: Run the script again to process more attachments');
      console.log(`   ${attachments.length - updated} attachments still need metadata`);
    }
    
  } catch (error) {
    console.error('\nFatal error:', error);
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Mode 2: Find and download missing attachment data
 */
async function mode2_findAttachmentData(fetchLimit = DEFAULT_FETCH_LIMIT, fetchDelay = DEFAULT_FETCH_DELAY, extraArgs = []) {
  // Load Mode 2 implementation
  const mode2 = require('./fetchpatches_mode2');
  
  console.log('='.repeat(70));
  console.log('MODE 2: Find Attachment Data');
  console.log('='.repeat(70));
  console.log();
  
  // Parse Mode 2 specific options
  const searchOptions = mode2.parseMode2Arguments(extraArgs);
  
  console.log(`Configuration:`);
  console.log(`  Search Max: ${searchOptions.searchMax} attachments per run`);
  console.log(`  Fetch Delay: ${fetchDelay}ms between each attachment`);
  console.log(`  Max File Size: ${(searchOptions.maxFileSize / (1024 * 1024)).toFixed(0)}MB`);
  console.log();
  console.log(`Search Options:`);
  console.log(`  Local Search: ${searchOptions.searchLocal ? 'Yes' : 'No'}`);
  if (searchOptions.searchLocalPaths.length > 0) {
    console.log(`  Local Paths: ${searchOptions.searchLocalPaths.join(', ')}`);
  }
  console.log(`  ArDrive: ${searchOptions.searchArDrive ? 'Yes' : 'No'}`);
  console.log(`  IPFS: ${searchOptions.searchIPFS ? 'Yes' : 'No'}`);
  console.log(`  Download URLs: ${searchOptions.searchDownload ? 'Yes' : 'No'}`);
  console.log(`  API Search: ${searchOptions.searchAPI ? 'Yes' : 'No'}`);
  if (searchOptions.searchAPI) {
    console.log(`    API URL: ${searchOptions.apiUrl || 'Not set'}`);
    console.log(`    API Client: ${searchOptions.apiClient ? 'Configured' : 'Not set'}`);
  }
  console.log(`  Ignore Filename: ${searchOptions.ignoreFilename ? 'Yes' : 'No'}`);
  console.log();
  
  // Check if database exists
  if (!fs.existsSync(PATCHBIN_DB_PATH)) {
    console.error(`Error: patchbin.db not found at ${PATCHBIN_DB_PATH}`);
    process.exit(1);
  }
  
  // Open database
  const db = new Database(PATCHBIN_DB_PATH);
  
  try {
    // Initialize ArDrive if needed
    let arDrive = null;
    if (searchOptions.searchArDrive || searchOptions.searchAllArDrive) {
      console.log('Initializing ArDrive client...');
      arDrive = initArDrive();
    }
    
    // Initialize and verify IPFS gateways if IPFS search is enabled
    let verifiedIPFSGateways = [];
    if (searchOptions.searchIPFS) {
      console.log('\nInitializing IPFS gateways...');
      verifiedIPFSGateways = await mode2.initializeIPFSGateways(
        searchOptions.ipfsGateways,
        db
      );
      
      if (verifiedIPFSGateways.length === 0) {
        console.log('  ⚠ No working IPFS gateways available');
        console.log('  IPFS search will be skipped');
        searchOptions.searchIPFS = false;
      }
      console.log();
    }
    
    // Query attachments needing file_data
    console.log('Querying attachments with missing file_data...');
    const query = `
      SELECT auuid, pbuuid, gvuuid, resuuid,
             file_name, file_size,
             file_hash_sha224, file_hash_sha256,
             file_ipfs_cidv0, file_ipfs_cidv1,
             arweave_file_name, arweave_file_id, arweave_file_path,
             download_urls, last_search
      FROM attachments
      WHERE file_data IS NULL
        AND (file_hash_sha224 IS NOT NULL OR file_hash_sha256 IS NOT NULL)
        AND file_size IS NOT NULL
      ORDER BY last_search ASC NULLS FIRST
      LIMIT ?
    `;
    
    const attachments = db.prepare(query).all(searchOptions.searchMax);
    console.log(`Found ${attachments.length} attachments needing file_data\n`);
    
    if (attachments.length === 0) {
      console.log('✓ No attachments need file_data!\n');
      return;
    }
    
    console.log('='.repeat(70));
    console.log('Processing attachments...\n');
    
    let processed = 0;
    let found = 0;
    let updated = 0;
    let notFound = 0;
    
    // Prepare database statements
    const updateDataStmt = db.prepare(`
      UPDATE attachments
      SET file_data = ?,
          updated_time = CURRENT_TIMESTAMP,
          last_search = CURRENT_TIMESTAMP
      WHERE auuid = ?
    `);
    
    const updateSearchStmt = db.prepare(`
      UPDATE attachments
      SET last_search = CURRENT_TIMESTAMP
      WHERE auuid = ?
    `);
    
    // Build search paths
    const searchPaths = [...mode2.DEFAULT_SEARCH_PATHS];
    if (searchOptions.searchLocalPaths.length > 0) {
      searchPaths.push(...searchOptions.searchLocalPaths);
    }
    
    // Process each attachment
    for (const attachment of attachments) {
      processed++;
      const remaining = searchOptions.searchMax - processed;
      
      console.log(`[${processed}/${searchOptions.searchMax}] ${attachment.file_name} (${remaining} remaining)`);
      console.log(`  auuid: ${attachment.auuid}`);
      console.log(`  size: ${attachment.file_size} bytes`);
      console.log(`  hashes: SHA256=${attachment.file_hash_sha256 ? 'yes' : 'no'}, SHA224=${attachment.file_hash_sha224 ? 'yes' : 'no'}`);
      
      let result = null;
      let apiCancelled = false;
      
      // Try each search option in order
      try {
        // Option A & B: Local search
        if ((searchOptions.searchLocal || searchOptions.searchLocalPaths.length > 0) && !result) {
          result = await mode2.searchLocal(attachment, searchPaths, searchOptions);
        }
        
        // Option C: ArDrive
        if (searchOptions.searchArDrive && !result && arDrive) {
          result = await mode2.searchArDrive(attachment, arDrive, searchOptions);
        }
        
        // Option D: IPFS
        if (searchOptions.searchIPFS && !result) {
          result = await mode2.searchIPFS(attachment, searchOptions, verifiedIPFSGateways);
        }
        
        // Option F: Download URLs
        if (searchOptions.searchDownload && !result) {
          result = await mode2.searchDownloadUrls(attachment, searchOptions);
        }
        
        // Option G: API Search
        if (searchOptions.searchAPI && !result && !apiCancelled) {
          const apiResult = await mode2.searchAPI(attachment, searchOptions, db);
          
          if (apiResult && apiResult.cancelEndpoint) {
            console.log(`  ⚠ API endpoint cancelled - skipping for remaining attachments`);
            apiCancelled = true;
            searchOptions.searchAPI = false;
          } else if (apiResult && apiResult.metadata) {
            console.log(`  ⓘ API returned metadata with URLs - can try other sources`);
            // Metadata received but no file_data, continue to other sources
          } else {
            result = apiResult;
          }
        }
        
        // If found, validate hash before storing
        if (result) {
          console.log(`  ✓ Found file data from: ${result.source}`);
          console.log(`    Size: ${result.data.length} bytes`);
          
          // CRITICAL: Validate file_data hash
          console.log(`  🔒 Validating file_data hash...`);
          const hashValidation = mode2.validateFileDataHash(result.data, attachment.file_hash_sha256);
          
          if (!hashValidation.valid) {
            console.error(`  ✗ file_data hash validation FAILED: ${hashValidation.reason}`);
            if (hashValidation.expected) {
              console.error(`      Expected: ${hashValidation.expected}`);
              console.error(`      Got:      ${hashValidation.actual}`);
            }
            console.error(`  ✗ REJECTING invalid file_data\n`);
            
            // Do not store invalid data, update last_search anyway
            try {
              updateSearchStmt.run(attachment.auuid);
            } catch (e) {
              // Ignore
            }
            continue;
          }
          
          console.log(`  ✓ file_data hash verified`);
          
          try {
            updateDataStmt.run(result.data, attachment.auuid);
            console.log(`  ✓ Updated database record\n`);
            found++;
            updated++;
          } catch (error) {
            console.error(`  ✗ Database update error: ${error.message}\n`);
          }
        } else {
          console.log(`  ✗ File not found in any source`);
          
          try {
            updateSearchStmt.run(attachment.auuid);
            console.log(`  ⏱ Updated last_search timestamp\n`);
            notFound++;
          } catch (error) {
            console.error(`  ✗ Database update error: ${error.message}\n`);
          }
        }
        
      } catch (error) {
        console.error(`  ✗ Error: ${error.message}\n`);
        // Update last_search anyway
        try {
          updateSearchStmt.run(attachment.auuid);
        } catch (e) {
          // Ignore
        }
      }
      
      // Add delay between processing
      if (processed < searchOptions.searchMax && remaining > 0) {
        console.log(`  ⏱ Waiting ${fetchDelay}ms before next search...`);
        await sleep(fetchDelay);
      }
    }
    
    // Summary
    console.log('='.repeat(70));
    console.log('\nSummary:');
    console.log(`  Total attachments checked:     ${processed}`);
    console.log(`  Files found and verified:      ${found}`);
    console.log(`  Records updated with data:     ${updated}`);
    console.log(`  Files not found:               ${notFound}`);
    
    // Check remaining
    const remainingQuery = db.prepare(`
      SELECT COUNT(*) as count 
      FROM attachments 
      WHERE file_data IS NULL 
        AND (file_hash_sha224 IS NOT NULL OR file_hash_sha256 IS NOT NULL)
        AND file_size IS NOT NULL
    `).get();
    
    console.log(`  Still missing file_data:       ${remainingQuery.count}`);
    
    if (remainingQuery.count > 0) {
      console.log('\n💡 Tip: Run the script again to process more attachments');
      console.log(`   Consider adding more search options: --searchipfs, --searchardrive, --download`);
    }
    
  } catch (error) {
    console.error('\nFatal error:', error);
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Calculate Shake128 hash for filename (compatible with repatch.py)
 * Format: base64(shake128(data).digest(24), b"_-")
 */
function calculateShake128Filename(data) {
  const shake = crypto.createHash('shake128', { outputLength: 24 });
  shake.update(data);
  const digest = shake.digest();
  // Use URL-safe base64 encoding (+ → _, / → -)
  return digest.toString('base64').replace(/\+/g, '_').replace(/\//g, '-').replace(/=/g, '');
}

/**
 * Parse Mode 3 arguments
 */
function parseMode3Arguments(args) {
  const options = {
    searchBy: null,  // gameid, file_name, gvuuid, pbuuid, patch_name (legacy single search)
    searchValue: null,
    searchCriteria: [],  // Array of {type, value, exact, regex} for multiple -b options
    queryType: null,  // rawpblob, patch, gameversions
    outputType: null,  // print, file
    outputFile: null,
    outputFormat: null,  // json, binary, list (for -ot/--output-type)
    versions: false,  // Include all versions (renamed from multiple)
    multi: null,  // Return all entries but only highest version per gameid (null = auto-detect)
    noMulti: false,  // Explicitly restrict to one gameid
    matchVersion: 'latest',  // all, first, latest, previous
    mode2Options: []  // Options to pass to mode2 if needed
  };
  
  let nextIsExact = false;
  let nextIsRegex = false;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-b' && i + 1 < args.length) {
      // New multi-search syntax: -b TYPE VALUE
      const type = args[++i];
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        const value = args[++i];
        options.searchCriteria.push({
          type: type,
          value: value,
          exact: nextIsExact,
          regex: nextIsRegex
        });
        nextIsExact = false;
        nextIsRegex = false;
      } else {
        console.error(`Error: -b ${type} requires a value`);
        process.exit(1);
      }
    } else if (arg.startsWith('--b=')) {
      // Legacy syntax: --b=TYPE (value expected as next positional arg)
      const type = arg.split('=')[1];
      options.searchBy = type;
    } else if (arg === '-q' && i + 1 < args.length) {
      options.queryType = args[++i];
    } else if (arg.startsWith('--query=')) {
      options.queryType = arg.split('=')[1];
    } else if (arg === '-p' || arg === '--print') {
      options.outputType = 'print';
    } else if (arg === '-o' && i + 1 < args.length) {
      options.outputType = 'file';
      options.outputFile = args[++i];
    } else if (arg.startsWith('--output=')) {
      options.outputType = 'file';
      options.outputFile = arg.split('=')[1];
    } else if (arg === '--exact') {
      nextIsExact = true;
    } else if (arg === '--regex') {
      nextIsRegex = true;
    } else if (arg === '--multiple' || arg === '--versions') {
      options.versions = true;
    } else if (arg === '--multi') {
      options.multi = true;
    } else if (arg === '--nomulti') {
      options.noMulti = true;
      options.multi = false;
    } else if (arg === '-ot' && i + 1 < args.length) {
      const format = args[++i];
      if (['json', 'binary', 'list'].includes(format)) {
        options.outputFormat = format;
      } else {
        console.error(`Error: Invalid output format: ${format}`);
        console.error('Valid formats: json, binary, list');
        process.exit(1);
      }
    } else if (arg.startsWith('--output-type=')) {
      const format = arg.split('=')[1];
      if (['json', 'binary', 'list'].includes(format)) {
        options.outputFormat = format;
      } else {
        console.error(`Error: Invalid output format: ${format}`);
        console.error('Valid formats: json, binary, list');
        process.exit(1);
      }
    } else if (arg.startsWith('--matchversion=')) {
      const value = arg.split('=')[1];
      if (['all', 'first', 'latest', 'previous'].includes(value)) {
        options.matchVersion = value;
      } else {
        console.error(`Error: Invalid --matchversion value: ${value}`);
        console.error('Valid values: all, first, latest, previous');
        process.exit(1);
      }
    } else if (!options.searchValue && options.searchCriteria.length === 0 && !arg.startsWith('-')) {
      // First non-option argument is the search value (legacy mode)
      options.searchValue = arg;
    } else if (!arg.startsWith('-')) {
      // Additional positional args for mode2 or legacy search value
      if (options.searchBy && !options.searchValue) {
        options.searchValue = arg;
      } else {
        options.mode2Options.push(arg);
      }
    } else {
      // Collect remaining arguments for potential mode2 search
      options.mode2Options.push(arg);
    }
  }
  
  // Set defaults
  if (!options.queryType) {
    options.queryType = 'gameversions';  // Default query type
  }
  
  // Legacy compatibility: convert old searchBy/searchValue to new searchCriteria
  if (options.searchBy && options.searchValue && options.searchCriteria.length === 0) {
    options.searchCriteria.push({
      type: options.searchBy,
      value: options.searchValue,
      exact: false,
      regex: false
    });
  }
  
  // Set default search if none provided
  if (options.searchCriteria.length === 0) {
    if (options.searchValue) {
      options.searchCriteria.push({
        type: 'file_name',
        value: options.searchValue,
        exact: false,
        regex: false
      });
    }
  }
  
  // Determine if this is an attribute search or direct ID search
  const directIdSearchTypes = ['gameid', 'gvuuid', 'pbuuid', 'file_name'];
  const hasDirectIdSearch = options.searchCriteria.some(c => directIdSearchTypes.includes(c.type));
  const hasAttributeSearch = options.searchCriteria.some(c => !directIdSearchTypes.includes(c.type));
  
  // Set multi default based on search type (if not explicitly set)
  if (options.multi === null && !options.noMulti) {
    if (hasAttributeSearch && options.queryType === 'gameversions') {
      // Attribute searches default to multi mode
      options.multi = true;
    } else {
      options.multi = false;
    }
  }
  
  // Apply noMulti override
  if (options.noMulti) {
    options.multi = false;
  }
  
  // Set output format defaults
  if (!options.outputFormat) {
    if (options.queryType === 'gameversions') {
      // For gameversions queries
      if (hasAttributeSearch && options.multi) {
        // Attribute searches with multi default to list format
        options.outputFormat = 'list';
      } else {
        // Direct ID searches default to json
        options.outputFormat = 'json';
      }
    } else {
      // For rawpblob and patch queries, default to binary
      options.outputFormat = 'binary';
    }
  }
  
  return options;
}

/**
 * Format gameversions results as a list (similar to python3 search.py)
 * @param {Array} gameversions - Array of gameversion records
 * @returns {string} - Formatted list output
 */
function formatGameversionsList(gameversions) {
  if (gameversions.length === 0) {
    return 'No results found.';
  }
  
  // Calculate column widths
  const gameidWidth = Math.max(10, ...gameversions.map(gv => (gv.gameid || '').length));
  const nameWidth = Math.max(30, ...gameversions.map(gv => (gv.name || '').length));
  const gametypeWidth = Math.max(12, ...gameversions.map(gv => (gv.gametype || '').length));
  const difficultyWidth = Math.max(12, ...gameversions.map(gv => (gv.difficulty || '').length));
  
  // Build header
  const header = 
    'Game ID'.padEnd(gameidWidth, ' ') + '  ' +
    'Name'.padEnd(nameWidth, ' ') + '  ' +
    'Type'.padEnd(gametypeWidth, ' ') + '  ' +
    'Difficulty'.padEnd(difficultyWidth, ' ');
  
  const separator = '='.repeat(header.length);
  
  // Build rows
  const rows = gameversions.map(gv => {
    const gameid = (gv.gameid || '').padEnd(gameidWidth, ' ');
    const name = (gv.name || '').padEnd(nameWidth, ' ');
    const gametype = (gv.gametype || '').padEnd(gametypeWidth, ' ');
    const difficulty = (gv.difficulty || '').padEnd(difficultyWidth, ' ');
    
    return gameid + '  ' + name + '  ' + gametype + '  ' + difficulty;
  });
  
  // Combine all parts
  return header + '\n' + separator + '\n' + rows.join('\n');
}

/**
 * Match a value against search criteria
 * @param {string|number} fieldValue - The value from the database field
 * @param {string} searchValue - The search value
 * @param {boolean} exact - Whether to do exact matching
 * @param {boolean} regex - Whether to interpret searchValue as regex
 * @returns {boolean} - Whether it matches
 */
function matchSearchValue(fieldValue, searchValue, exact, regex) {
  // Handle null/undefined
  if (fieldValue === null || fieldValue === undefined) {
    return false;
  }
  
  const fieldStr = String(fieldValue);
  
  // Regex matching
  if (regex) {
    try {
      const regexObj = new RegExp(searchValue, 'i');
      return regexObj.test(fieldStr);
    } catch (e) {
      console.error(`Invalid regex pattern: ${searchValue}`);
      return false;
    }
  }
  
  // Exact matching
  if (exact) {
    return fieldStr.toLowerCase() === searchValue.toLowerCase();
  }
  
  // Check for comparison operators for numbers/dates
  if (searchValue.startsWith('>') || searchValue.startsWith('<')) {
    const operator = searchValue[0];
    const compareValue = searchValue.slice(1).trim();
    
    // Try numeric comparison
    const fieldNum = parseFloat(fieldStr);
    const compareNum = parseFloat(compareValue);
    
    if (!isNaN(fieldNum) && !isNaN(compareNum)) {
      if (operator === '>') {
        return fieldNum > compareNum;
      } else if (operator === '<') {
        return fieldNum < compareNum;
      }
    }
    
    // Try date/string comparison
    if (operator === '>') {
      return fieldStr > compareValue;
    } else if (operator === '<') {
      return fieldStr < compareValue;
    }
  }
  
  // Fuzzy matching (case-insensitive substring)
  return fieldStr.toLowerCase().includes(searchValue.toLowerCase());
}

/**
 * Check if record matches all search criteria
 * @param {Object} record - Database record
 * @param {Array} criteria - Array of search criteria
 * @returns {boolean} - Whether record matches all criteria
 */
function matchesAllCriteria(record, criteria) {
  for (const criterion of criteria) {
    const { type, value, exact, regex } = criterion;
    let matched = false;
    
    switch (type) {
      case 'name':
        matched = matchSearchValue(record.name, value, exact, regex);
        break;
        
      case 'gametype':
        matched = matchSearchValue(record.gametype, value, exact, regex);
        break;
        
      case 'authors':
        // Check both author and authors fields
        matched = matchSearchValue(record.author, value, exact, regex) ||
                  matchSearchValue(record.authors, value, exact, regex);
        break;
        
      case 'difficulty':
        matched = matchSearchValue(record.difficulty, value, exact, regex);
        break;
        
      case 'added':
        matched = matchSearchValue(record.added, value, exact, regex);
        break;
        
      case 'section':
        matched = matchSearchValue(record.section, value, exact, regex);
        break;
        
      case 'version':
        matched = matchSearchValue(record.version, value, exact, regex);
        break;
        
      case 'tags': {
        // Tags matching: check if all specified tags are in the record's tags
        if (!record.tags) {
          matched = false;
        } else {
          try {
            // Parse tags if it's JSON
            let recordTags = record.tags;
            if (typeof recordTags === 'string') {
              try {
                recordTags = JSON.parse(recordTags);
              } catch (e) {
                // Not JSON, treat as plain string
              }
            }
            
            // Convert to array if needed
            if (Array.isArray(recordTags)) {
              // Check if tag is in array
              matched = recordTags.some(tag => matchSearchValue(tag, value, exact, regex));
            } else {
              // Check as string
              matched = matchSearchValue(recordTags, value, exact, regex);
            }
          } catch (e) {
            matched = false;
          }
        }
        break;
      }
      
      case 'gameid':
        matched = matchSearchValue(record.gameid, value, exact, regex);
        break;
        
      case 'demo':
        matched = matchSearchValue(record.demo, value, exact, regex);
        break;
        
      case 'length':
        matched = matchSearchValue(record.length, value, exact, regex);
        break;
        
      default:
        // Try to match against the field with same name as type
        if (record[type] !== undefined) {
          matched = matchSearchValue(record[type], value, exact, regex);
        } else {
          console.error(`Unknown search type: ${type}`);
          matched = false;
        }
    }
    
    if (!matched) {
      return false;  // Must match ALL criteria
    }
  }
  
  return true;
}

/**
 * Search for records based on criteria
 * @param {Database} rhdataDb - rhdata.db (gameversions)
 * @param {Database} patchbinDb - patchbin.db (patchblobs, attachments)
 * @param {Object} options - Search options
 */
function searchRecords(rhdataDb, patchbinDb, options) {
  const results = {
    gameversions: [],
    patchblobs: [],
    attachments: []
  };
  
  try {
    // Handle new multi-criteria search for gameversions
    if (options.searchCriteria.length > 0) {
      // Determine if we're searching gameversions or other tables
      const hasGameversionsCriteria = options.searchCriteria.some(c => 
        ['name', 'gametype', 'authors', 'difficulty', 'added', 'section', 'version', 'tags', 'gameid', 'demo', 'length'].includes(c.type)
      );
      
      const hasDirectIdSearch = options.searchCriteria.some(c => 
        ['gvuuid', 'pbuuid', 'file_name'].includes(c.type)
      );
      
      if (hasDirectIdSearch) {
        // Handle direct ID lookups
        for (const criterion of options.searchCriteria) {
          if (criterion.type === 'gvuuid') {
            const gv = rhdataDb.prepare(`SELECT * FROM gameversions WHERE gvuuid = ?`).get(criterion.value);
            if (gv) results.gameversions = [gv];
          } else if (criterion.type === 'pbuuid') {
            const pb = patchbinDb.prepare(`SELECT * FROM patchblobs WHERE pbuuid = ?`).get(criterion.value);
            if (pb) results.patchblobs = [pb];
          } else if (criterion.type === 'file_name') {
            const attachments = patchbinDb.prepare(`SELECT * FROM attachments WHERE file_name = ?`).all(criterion.value);
            results.attachments = attachments;
          }
        }
      } else if (hasGameversionsCriteria) {
        // Search gameversions with criteria
        let allGameVersions = rhdataDb.prepare(`SELECT * FROM gameversions`).all();
        
        // Filter by criteria
        const matchingVersions = allGameVersions.filter(gv => matchesAllCriteria(gv, options.searchCriteria));
        
        // Apply version filtering based on matchVersion option
        if (options.matchVersion === 'latest' && !options.versions && !options.multi) {
          // Group by gameid and keep only highest version
          const grouped = {};
          for (const gv of matchingVersions) {
            if (!grouped[gv.gameid] || gv.version > grouped[gv.gameid].version) {
              grouped[gv.gameid] = gv;
            }
          }
          results.gameversions = Object.values(grouped);
        } else if (options.matchVersion === 'first') {
          // Group by gameid and keep only lowest version
          const grouped = {};
          for (const gv of matchingVersions) {
            if (!grouped[gv.gameid] || gv.version < grouped[gv.gameid].version) {
              grouped[gv.gameid] = gv;
            }
          }
          results.gameversions = Object.values(grouped);
        } else if (options.matchVersion === 'previous') {
          // Group by gameid and keep second highest version
          const grouped = {};
          for (const gv of matchingVersions) {
            if (!grouped[gv.gameid]) {
              grouped[gv.gameid] = [];
            }
            grouped[gv.gameid].push(gv);
          }
          
          for (const gameid in grouped) {
            grouped[gameid].sort((a, b) => b.version - a.version);
            if (grouped[gameid].length > 1) {
              results.gameversions.push(grouped[gameid][1]);  // Second highest
            } else if (grouped[gameid].length === 1) {
              results.gameversions.push(grouped[gameid][0]);  // Only one version
            }
          }
        } else if (options.multi) {
          // Return all matching entries, but only highest version per gameid
          const grouped = {};
          for (const gv of matchingVersions) {
            if (!grouped[gv.gameid] || gv.version > grouped[gv.gameid].version) {
              grouped[gv.gameid] = gv;
            }
          }
          results.gameversions = Object.values(grouped);
        } else {
          // Return all matching versions (matchVersion === 'all' or versions === true)
          results.gameversions = matchingVersions;
        }
        
        // Apply nomulti filter - restrict to one gameid
        if (options.noMulti && results.gameversions.length > 0) {
          const firstGameid = results.gameversions[0].gameid;
          results.gameversions = results.gameversions.filter(gv => gv.gameid === firstGameid);
        }
      }
    }
    
    // Legacy single-criterion search (backward compatibility)
    else if (options.searchBy) {
      switch (options.searchBy) {
        case 'gameid': {
          if (options.versions) {
            results.gameversions = rhdataDb.prepare(`
              SELECT * FROM gameversions WHERE gameid = ?
              ORDER BY version DESC
            `).all(options.searchValue);
          } else {
            const gv = rhdataDb.prepare(`
              SELECT * FROM gameversions WHERE gameid = ?
              ORDER BY version DESC LIMIT 1
            `).get(options.searchValue);
            if (gv) results.gameversions = [gv];
          }
          break;
        }
        
        case 'gvuuid': {
          const gv = rhdataDb.prepare(`
            SELECT * FROM gameversions WHERE gvuuid = ?
          `).get(options.searchValue);
          if (gv) results.gameversions = [gv];
          break;
        }
        
        case 'pbuuid': {
          const pb = patchbinDb.prepare(`
            SELECT * FROM patchblobs WHERE pbuuid = ?
          `).get(options.searchValue);
          if (pb) results.patchblobs = [pb];
          break;
        }
        
        case 'file_name': {
          const attachments = patchbinDb.prepare(`
            SELECT * FROM attachments WHERE file_name = ?
          `).all(options.searchValue);
          results.attachments = attachments;
          break;
        }
        
        default:
          throw new Error(`Unsupported search type: ${options.searchBy}`);
      }
    }
    
    // If we found gameversions, also get related patchblobs and attachments
    if (results.gameversions.length > 0) {
      for (const gv of results.gameversions) {
        if (gv.pbuuid) {
          const pb = patchbinDb.prepare(`SELECT * FROM patchblobs WHERE pbuuid = ?`).get(gv.pbuuid);
          if (pb && !results.patchblobs.find(p => p.pbuuid === pb.pbuuid)) {
            results.patchblobs.push(pb);
          }
        }
      }
    }
    
    // If we found patchblobs, also get related attachments
    if (results.patchblobs.length > 0) {
      for (const pb of results.patchblobs) {
        if (pb.auuid) {
          const att = patchbinDb.prepare(`SELECT * FROM attachments WHERE auuid = ?`).get(pb.auuid);
          if (att && !results.attachments.find(a => a.auuid === att.auuid)) {
            results.attachments.push(att);
          }
        }
      }
    }
    
  } catch (error) {
    throw new Error(`Search failed: ${error.message}`);
  }
  
  return results;
}

/**
 * Decrypt patchblob data
 */
function decryptPatchblob(encryptedData, patchblob) {
  try {
    // Get decryption key from patchblob
    const key = patchblob.pbkey;
    const iv = patchblob.pbiv;
    
    if (!key || !iv) {
      throw new Error('Missing encryption key or IV');
    }
    
    // Decrypt using AES-256-CBC
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'hex'), Buffer.from(iv, 'hex'));
    let decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    
    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

/**
 * Mode 3: Retrieve and display/save specific attachment or metadata
 */
async function mode3_retrieveAttachment(args) {
  console.log('='.repeat(70));
  console.log('MODE 3: Retrieve Attachment/Metadata');
  console.log('='.repeat(70));
  console.log();
  
  // Parse arguments
  const options = parseMode3Arguments(args);
  
  if (options.searchCriteria.length === 0 && !options.searchValue) {
    console.error('Error: No search criteria provided');
    console.error('\nUsage:');
    console.error('  node fetchpatches.js mode3 -b TYPE VALUE [options]');
    console.error('\nSearch Options:');
    console.error('  -b TYPE VALUE        Search by field (can be used multiple times)');
    console.error('                       Types: name, gametype, authors, difficulty, added,');
    console.error('                              section, version, tags, gameid, demo, length,');
    console.error('                              gvuuid, pbuuid, file_name');
    console.error('  --exact              Use exact matching for next -b (not fuzzy)');
    console.error('  --regex              Use regex matching for next -b');
    console.error('\nQuery Options:');
    console.error('  -q, --query=TYPE     Query: rawpblob, patch, gameversions (default: gameversions)');
    console.error('\nOutput Options:');
    console.error('  -p, --print          Print to stdout');
    console.error('  -o, --output=FILE    Save to file');
    console.error('  -ot FORMAT           Output format: json, binary, list');
    console.error('  --output-type=FORMAT (default: list for attribute searches, json for ID searches)');
    console.error('\nVersion Filtering:');
    console.error('  --versions           Include all versions for each gameid');
    console.error('  --multi              Return all entries, highest version per gameid (default for attributes)');
    console.error('  --nomulti            Restrict results to one gameid');
    console.error('  --matchversion=TYPE  Version to match: all, first, latest, previous');
    console.error('\nExamples:');
    console.error('  # Basic search');
    console.error('  node fetchpatches.js mode3 -b gameid "Super Mario World" -q gameversions');
    console.error('  node fetchpatches.js mode3 -b file_name test.bin -q rawpblob -o output.bin');
    console.error('');
    console.error('  # Multi-criteria search');
    console.error('  node fetchpatches.js mode3 -b demo No -b authors KT --exact -b length "73"');
    console.error('  node fetchpatches.js mode3 -b added 2024 -b difficulty Hard');
    console.error('  node fetchpatches.js mode3 -b added ">2023" -b length "<10"');
    process.exit(1);
  }
  
  console.log('Search Configuration:');
  
  // Display search criteria
  if (options.searchCriteria.length > 0) {
    console.log('  Search Criteria:');
    for (const criterion of options.searchCriteria) {
      const flags = [];
      if (criterion.exact) flags.push('exact');
      if (criterion.regex) flags.push('regex');
      const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
      console.log(`    -b ${criterion.type} "${criterion.value}"${flagStr}`);
    }
  } else if (options.searchBy) {
    console.log(`  Search By:    ${options.searchBy}`);
    console.log(`  Search Value: ${options.searchValue}`);
  }
  
  console.log(`  Query Type:   ${options.queryType}`);
  console.log(`  Output:       ${options.outputType || 'auto'}`);
  console.log(`  Output Format: ${options.outputFormat}`);
  
  if (options.outputFile) {
    console.log(`  Output File:  ${options.outputFile}`);
  }
  
  if (options.versions) {
    console.log(`  Versions:     All versions`);
  }
  
  if (options.multi) {
    console.log(`  Multi:        Highest version per gameid`);
  }
  
  if (options.noMulti) {
    console.log(`  NoMulti:      Restricted to one gameid`);
  }
  
  if (options.matchVersion !== 'latest') {
    console.log(`  Match Version: ${options.matchVersion}`);
  }
  
  console.log();
  
  // Open databases
  if (!fs.existsSync(PATCHBIN_DB_PATH)) {
    console.error(`Error: patchbin.db not found at ${PATCHBIN_DB_PATH}`);
    process.exit(1);
  }
  
  if (!fs.existsSync(RHDATA_DB_PATH)) {
    console.error(`Error: rhdata.db not found at ${RHDATA_DB_PATH}`);
    process.exit(1);
  }
  
  const patchbinDb = new Database(PATCHBIN_DB_PATH);
  const rhdataDb = new Database(RHDATA_DB_PATH, { readonly: true });
  
  try {
    // Search for records
    console.log('Searching...');
    const results = searchRecords(rhdataDb, patchbinDb, options);
    
    console.log(`Found:`);
    console.log(`  Game Versions: ${results.gameversions.length}`);
    console.log(`  Patch Blobs:   ${results.patchblobs.length}`);
    console.log(`  Attachments:   ${results.attachments.length}`);
    console.log();
    
    if (results.gameversions.length === 0 && results.patchblobs.length === 0 && results.attachments.length === 0) {
      console.log('✗ No records found');
      return;
    }
    
    // Process based on query type
    let outputData = null;
    let isMetadata = false;
    
    switch (options.queryType) {
      case 'gameversions': {
        // Output gameversions based on output format
        isMetadata = true;
        if (options.outputFormat === 'list') {
          outputData = formatGameversionsList(results.gameversions);
        } else {
          // json format (default for direct ID searches)
          outputData = JSON.stringify(results.gameversions, null, 2);
        }
        break;
      }
      
      case 'rawpblob': {
        // Get raw patchblob data from attachments
        if (results.attachments.length === 0) {
          console.error('✗ No attachments found');
          return;
        }
        
        const attachment = results.attachments[0];
        
        if (!attachment.file_data) {
          console.log('⚠ Attachment file_data is NULL');
          console.log('Running Mode 2 search for this attachment...');
          console.log();
          
          // Trigger Mode 2 search for this specific attachment
          await mode2_findAttachmentForMode3(patchbinDb, attachment, options.mode2Options);
          
          // Reload attachment to get file_data
          const reloaded = patchbinDb.prepare(`SELECT * FROM attachments WHERE auuid = ?`).get(attachment.auuid);
          
          if (!reloaded || !reloaded.file_data) {
            console.error('✗ Could not retrieve file data');
            return;
          }
          
          outputData = reloaded.file_data;
        } else {
          outputData = attachment.file_data;
        }
        break;
      }
      
      case 'patch': {
        // Get decoded patchblob (decrypt)
        if (results.attachments.length === 0) {
          console.error('✗ No attachments found');
          return;
        }
        
        const attachment = results.attachments[0];
        const patchblob = results.patchblobs.find(pb => pb.auuid === attachment.auuid);
        
        if (!patchblob) {
          console.error('✗ No patchblob found for this attachment');
          return;
        }
        
        if (!attachment.file_data) {
          console.log('⚠ Attachment file_data is NULL');
          console.log('Running Mode 2 search for this attachment...');
          console.log();
          
          // Trigger Mode 2 search
          await mode2_findAttachmentForMode3(patchbinDb, attachment, options.mode2Options);
          
          // Reload
          const reloaded = patchbinDb.prepare(`SELECT * FROM attachments WHERE auuid = ?`).get(attachment.auuid);
          
          if (!reloaded || !reloaded.file_data) {
            console.error('✗ Could not retrieve file data');
            return;
          }
          
          attachment.file_data = reloaded.file_data;
        }
        
        console.log('Decrypting patchblob...');
        outputData = decryptPatchblob(attachment.file_data, patchblob);
        
        // Verify decoded hash
        if (patchblob.decoded_hash_sha256) {
          const actualHash = crypto.createHash('sha256').update(outputData).digest('hex');
          if (actualHash === patchblob.decoded_hash_sha256) {
            console.log('✓ Decoded hash verified (SHA256)');
          } else {
            console.error('✗ Decoded hash mismatch!');
            console.error(`  Expected: ${patchblob.decoded_hash_sha256}`);
            console.error(`  Got:      ${actualHash}`);
            return;
          }
        }
        break;
      }
      
      default:
        console.error(`Unsupported query type: ${options.queryType}`);
        return;
    }
    
    // Output the data
    if (!outputData) {
      console.error('✗ No data to output');
      return;
    }
    
    // Determine output method
    let outputMethod = options.outputType;
    if (!outputMethod) {
      // Auto-detect: metadata goes to stdout, file content goes to file
      outputMethod = isMetadata ? 'print' : 'file';
    }
    
    if (outputMethod === 'print') {
      // Print to stdout
      console.log('Output:');
      console.log('='.repeat(70));
      if (Buffer.isBuffer(outputData)) {
        console.log(`<Binary data: ${outputData.length} bytes>`);
        console.log('Use -o option to save to file');
      } else {
        console.log(outputData);
      }
      console.log('='.repeat(70));
    } else {
      // Save to file
      let filename = options.outputFile;
      
      if (!filename) {
        // Generate filename using shake128 hash
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const hashName = calculateShake128Filename(outputData);
        filename = path.join(tempDir, hashName);
      }
      
      fs.writeFileSync(filename, outputData);
      console.log(`✓ Saved to: ${filename}`);
      console.log(`  Size: ${outputData.length} bytes`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    patchbinDb.close();
    rhdataDb.close();
  }
}

/**
 * Helper: Run Mode 2 search for a specific attachment (for Mode 3)
 */
async function mode2_findAttachmentForMode3(db, attachment, extraOptions) {
  // Run Mode 2 search for just this one attachment
  const mode2 = require('./fetchpatches_mode2');
  
  // Parse search options
  const searchOptions = mode2.parseMode2Arguments(extraOptions);
  searchOptions.searchMax = 1;  // Only search for this one attachment
  
  console.log('Mode 2 Search Options:');
  console.log(`  Local Search:  ${searchOptions.searchLocal ? 'Yes' : 'No'}`);
  console.log(`  ArDrive:       ${searchOptions.searchArDrive ? 'Yes' : 'No'}`);
  console.log(`  IPFS:          ${searchOptions.searchIPFS ? 'Yes' : 'No'}`);
  console.log(`  Download URLs: ${searchOptions.searchDownload ? 'Yes' : 'No'}`);
  console.log(`  API Search:    ${searchOptions.searchAPI ? 'Yes' : 'No'}`);
  console.log();
  
  // Initialize ArDrive if needed
  let arDrive = null;
  if (searchOptions.searchArDrive) {
    arDrive = initArDrive();
  }
  
  // Initialize IPFS gateways if needed
  let verifiedIPFSGateways = [];
  if (searchOptions.searchIPFS) {
    console.log('Initializing IPFS gateways...');
    verifiedIPFSGateways = await mode2.initializeIPFSGateways(
      searchOptions.ipfsGateways,
      db
    );
    console.log();
  }
  
  // Search paths for local search
  const searchPaths = searchOptions.searchLocal ? mode2.DEFAULT_SEARCH_PATHS : [];
  if (searchOptions.searchLocalPaths.length > 0) {
    searchPaths.push(...searchOptions.searchLocalPaths);
  }
  
  // Try to find the file
  let result = null;
  
  try {
    // Try each search option
    if ((searchOptions.searchLocal || searchOptions.searchLocalPaths.length > 0) && !result) {
      result = await mode2.searchLocal(attachment, searchPaths, searchOptions);
    }
    
    if (searchOptions.searchArDrive && !result && arDrive) {
      result = await mode2.searchArDrive(attachment, arDrive, searchOptions);
    }
    
    if (searchOptions.searchIPFS && !result) {
      result = await mode2.searchIPFS(attachment, searchOptions, verifiedIPFSGateways);
    }
    
    if (searchOptions.searchDownload && !result) {
      result = await mode2.searchDownloadUrls(attachment, searchOptions);
    }
    
    if (searchOptions.searchAPI && !result) {
      result = await mode2.searchAPI(attachment, searchOptions, db);
    }
    
    if (result && result.data) {
      // Validate hash
      const validation = mode2.validateFileDataHash(result.data, attachment.file_hash_sha256);
      
      if (!validation.valid) {
        console.error('✗ file_data hash validation failed');
        return false;
      }
      
      console.log('✓ Found and verified file data');
      console.log(`  Source: ${result.source}`);
      
      // Update database
      db.prepare(`
        UPDATE attachments
        SET file_data = ?,
            updated_time = CURRENT_TIMESTAMP,
            last_search = CURRENT_TIMESTAMP
        WHERE auuid = ?
      `).run(result.data, attachment.auuid);
      
      console.log('✓ Updated attachment record');
      return true;
    } else {
      console.log('✗ File not found in any source');
      
      // Update last_search
      db.prepare(`
        UPDATE attachments SET last_search = CURRENT_TIMESTAMP WHERE auuid = ?
      `).run(attachment.auuid);
      
      return false;
    }
  } catch (error) {
    console.error(`Search error: ${error.message}`);
    return false;
  }
}

/**
 * Mode: Add Sizes - Populate file_size for records with file_data
 */
async function modeAddSizes() {
  console.log('='.repeat(70));
  console.log('MODE: Add Sizes');
  console.log('='.repeat(70));
  console.log();
  console.log('Populate file_size attribute for attachments with file_data\n');
  
  // Check if database exists
  if (!fs.existsSync(PATCHBIN_DB_PATH)) {
    console.error(`Error: patchbin.db not found at ${PATCHBIN_DB_PATH}`);
    process.exit(1);
  }
  
  // Open database
  const db = new Database(PATCHBIN_DB_PATH);
  
  try {
    // Check if file_size column exists
    const columns = db.prepare("PRAGMA table_info(attachments)").all();
    const hasFileSizeColumn = columns.some(col => col.name === 'file_size');
    
    if (!hasFileSizeColumn) {
      console.error('Error: file_size column does not exist in attachments table');
      console.log('\nYou may need to update the schema. Add the column with:');
      console.log('  ALTER TABLE attachments ADD COLUMN file_size INTEGER;');
      process.exit(1);
    }
    
    // Query attachments with file_data but missing file_size
    console.log('Querying attachments with file_data but missing file_size...');
    const query = `
      SELECT auuid, file_name, file_data
      FROM attachments
      WHERE file_data IS NOT NULL
        AND (file_size IS NULL OR file_size = 0)
    `;
    
    const attachments = db.prepare(query).all();
    console.log(`Found ${attachments.length} attachments needing file_size\n`);
    
    if (attachments.length === 0) {
      console.log('✓ All attachments with file_data already have file_size set!\n');
      return;
    }
    
    console.log('='.repeat(70));
    console.log('Processing attachments...\n');
    
    let updated = 0;
    let failed = 0;
    
    const updateStmt = db.prepare(`
      UPDATE attachments
      SET file_size = ?
      WHERE auuid = ?
    `);
    
    // Process each attachment
    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i];
      const progress = i + 1;
      const remaining = attachments.length - progress;
      
      try {
        // Get the size of file_data
        const fileSize = attachment.file_data ? attachment.file_data.length : 0;
        
        console.log(`[${progress}/${attachments.length}] ${attachment.file_name} (${remaining} remaining)`);
        console.log(`  auuid: ${attachment.auuid}`);
        console.log(`  file_size: ${fileSize} bytes`);
        
        // Update the database
        updateStmt.run(fileSize, attachment.auuid);
        
        console.log(`  ✓ Updated\n`);
        updated++;
        
      } catch (error) {
        console.error(`  ✗ Error: ${error.message}\n`);
        failed++;
      }
    }
    
    // Summary
    console.log('='.repeat(70));
    console.log('\nSummary:');
    console.log(`  Total attachments processed: ${attachments.length}`);
    console.log(`  Successfully updated:        ${updated}`);
    console.log(`  Failed:                      ${failed}`);
    
    // Verify results
    const verifyQuery = db.prepare(`
      SELECT COUNT(*) as count 
      FROM attachments 
      WHERE file_data IS NOT NULL 
        AND (file_size IS NULL OR file_size = 0)
    `).get();
    
    console.log(`  Still missing file_size:     ${verifyQuery.count}`);
    
    if (verifyQuery.count === 0) {
      console.log('\n✓ All attachments with file_data now have file_size set!');
    }
    
  } catch (error) {
    console.error('\nFatal error:', error);
    throw error;
  } finally {
    db.close();
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('fetchpatches.js - Fetch and manage patch attachments\n');
    console.log('Usage:');
    console.log('  node fetchpatches.js mode1 [options]          # Populate ArDrive metadata');
    console.log('  node fetchpatches.js mode2 [options]          # Find missing attachment data');
    console.log('  node fetchpatches.js mode3 <value> [options]  # Retrieve specific attachment/metadata');
    console.log('  node fetchpatches.js addsizes                 # Populate file_size from file_data');
    console.log();
    console.log('General Options (all modes):');
    console.log(`  --fetchlimit=N       Limit attachments to process (default: ${DEFAULT_FETCH_LIMIT})`);
    console.log(`  --fetchdelay=MS      Delay between downloads (default: ${DEFAULT_FETCH_DELAY}ms, min: ${MIN_FETCH_DELAY}ms)`);
    console.log('  --patchbindb=PATH    Path to patchbin.db (for testing)');
    console.log('  --rhdatadb=PATH      Path to rhdata.db (for testing)');
    console.log();
    console.log('Mode 2 Search Options:');
    console.log('  --searchmax=N              Max attachments to search (default: 20)');
    console.log('  --maxfilesize=SIZE         Max file size to download (default: 200MB)');
    console.log('  --nosearchlocal            Disable default local search');
    console.log('  --searchlocalpath=PATH     Add local search path (can repeat)');
    console.log('  --searchardrive            Search ArDrive by ID/name/path');
    console.log('  --searchipfs               Search IPFS using CIDs');
    console.log('  --ipfsgateway=URL          IPFS gateway URL (can repeat, supports %CID%)');
    console.log('  --download                 Search download_urls from database');
    console.log('  --ignorefilename           Search all files by hash only');
    console.log('  --allardrive               Broader ArDrive search (future)');
    console.log('  --apisearch                Use private metadata API search');
    console.log('  --apiurl=URL               API endpoint URL');
    console.log('  --apiclient=ID             API client ID');
    console.log('  --apisecret=SECRET         API client secret');
    console.log();
    console.log('Mode 3 Options:');
    console.log('  Search Options:');
    console.log('    -b TYPE VALUE         Search by field (can be used multiple times)');
    console.log('                          Types: name, gametype, authors, difficulty, added,');
    console.log('                                 section, version, tags, gameid, demo, length,');
    console.log('                                 gvuuid, pbuuid, file_name');
    console.log('    --exact               Use exact matching for next -b (not fuzzy)');
    console.log('    --regex               Use regex matching for next -b');
    console.log('');
    console.log('  Query Options:');
    console.log('    -q, --query=TYPE      Query: rawpblob, patch, gameversions (default: gameversions)');
    console.log('');
    console.log('  Output Options:');
    console.log('    -p, --print           Print to stdout');
    console.log('    -o, --output=FILE     Save to file');
    console.log('    -ot FORMAT            Output format: json, binary, list');
    console.log('    --output-type=FORMAT  (default: list for attribute searches, json for ID searches)');
    console.log('');
    console.log('  Version Filtering:');
    console.log('    --versions            Include all versions for each gameid');
    console.log('    --multi               Return all entries, highest version per gameid');
    console.log('                          (default for attribute searches)');
    console.log('    --nomulti             Restrict results to one gameid');
    console.log('    --matchversion=TYPE   Version to match: all, first, latest, previous');
    console.log('                          (default: latest)');
    console.log('');
    console.log('  + Mode 2 options        If file not found, all mode2 options available');
    console.log();
    console.log('Examples:');
    console.log('  # Mode 1');
    console.log('  node fetchpatches.js mode1');
    console.log('  node fetchpatches.js mode1 --fetchlimit=50');
    console.log();
    console.log('  # Mode 2');
    console.log('  node fetchpatches.js mode2');
    console.log('  node fetchpatches.js mode2 --searchmax=10 --searchipfs');
    console.log('  node fetchpatches.js mode2 --searchlocalpath=../backup --download');
    console.log('  node fetchpatches.js mode2 --apisearch --apiurl=https://api.example.com/search --apiclient=xxx --apisecret=yyy');
    console.log();
    console.log('  # Mode 3 - Basic searches');
    console.log('  node fetchpatches.js mode3 -b gameid "Super Mario World" -q gameversions --versions');
    console.log('  node fetchpatches.js mode3 -b file_name test.bin -q rawpblob -o output.bin');
    console.log('  node fetchpatches.js mode3 -b gvuuid <gvuuid> -q patch --searchipfs');
    console.log('');
    console.log('  # Mode 3 - Advanced multi-criteria searches (list format)');
    console.log('  node fetchpatches.js mode3 -b demo No -b authors KT -b length "73"');
    console.log('  node fetchpatches.js mode3 -b name Kaizo -b difficulty Hard');
    console.log('  node fetchpatches.js mode3 -b added 2024 -b section "Kaizo: Hard"');
    console.log('  node fetchpatches.js mode3 -b added ">2023" -b length "<10"');
    console.log('  node fetchpatches.js mode3 --regex -b name "^Super.*World$" -b tags vanilla');
    console.log('');
    console.log('  # Mode 3 - Override output format');
    console.log('  node fetchpatches.js mode3 -b gametype Kaizo -ot json');
    console.log('  node fetchpatches.js mode3 -b gameid "game_123" --output-type=list');
    console.log();
    console.log('  # Other');
    console.log('  node fetchpatches.js addsizes');
    console.log();
    process.exit(0);
  }
  
  // Parse arguments
  const params = parseArguments(args);
  
  if (!params.mode) {
    console.error('Error: No mode specified');
    console.error('Valid modes: mode1, mode2, mode3');
    process.exit(1);
  }
  
  switch (params.mode) {
    case 'mode1':
      await mode1_populateArDriveMetadata(params.fetchLimit, params.fetchDelay);
      break;
    
    case 'mode2':
      await mode2_findAttachmentData(params.fetchLimit, params.fetchDelay, params.extraArgs);
      break;
    
    case 'mode3':
      await mode3_retrieveAttachment(params.extraArgs);
      break;
    
    case 'addsizes':
      await modeAddSizes();
      break;
    
    default:
      console.error(`Unknown mode: ${params.mode}`);
      console.error('Valid modes: mode1, mode2, mode3, addsizes');
      process.exit(1);
  }
}

// Run main function
if (require.main === module) {
  main().catch(error => {
    console.error('\nFatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  mode1_populateArDriveMetadata,
  mode2_findAttachmentData,
  mode3_retrieveAttachment,
  modeAddSizes
};

