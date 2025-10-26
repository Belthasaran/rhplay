#!/usr/bin/env node

/**
 * Mode 2 Implementation for fetchpatches.js
 * Find and populate missing file_data from various sources
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Default search parameters
const DEFAULT_SEARCH_MAX = 20;
const DEFAULT_MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB in bytes

// Default IPFS gateways
const DEFAULT_IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/%CID%',
  'https://gateway.pinata.cloud/ipfs/%CID%',
  'https://cloudflare-ipfs.com/ipfs/%CID%',
  'https://dweb.link/ipfs/%CID%'
];

// IPFS gateway checker CID and expected output
const IPFS_CHECKER_CID = 'bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m';
const IPFS_CHECKER_SHA256 = '7530010a7ec61daef2e028720f102a75d40af932528e742eb10cdae4de8d7004';
const IPFS_CHECKER_TEXT = 'Hello from IPFS Gateway Checker';

// Default local search paths
const DEFAULT_SEARCH_PATHS = [
  path.join(__dirname, 'blobs'),
  path.join(__dirname, 'electron', 'blobs'),
  path.join(__dirname, 'patch'),
  path.join(__dirname, 'temp')
];

/**
 * Parse file size string (e.g., "200MB", "1GB") to bytes
 */
function parseFileSize(sizeStr) {
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)?$/i);
  if (!match) {
    throw new Error(`Invalid file size format: ${sizeStr}`);
  }
  
  const value = parseFloat(match[1]);
  const unit = (match[2] || 'B').toUpperCase();
  
  const multipliers = {
    'B': 1,
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024,
    'TB': 1024 * 1024 * 1024 * 1024
  };
  
  return Math.floor(value * multipliers[unit]);
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
 * Verify file data matches attachment hashes
 */
function verifyFileData(fileData, attachment) {
  // Use strongest available hash
  if (attachment.file_hash_sha256) {
    const hash = sha256(fileData);
    if (hash === attachment.file_hash_sha256) {
      return { verified: true, method: 'SHA-256' };
    }
  }
  
  if (attachment.file_hash_sha224) {
    const hash = sha224(fileData);
    if (hash === attachment.file_hash_sha224) {
      return { verified: true, method: 'SHA-224' };
    }
  }
  
  return { verified: false, method: null };
}

/**
 * Check if path is an archive file
 */
function isArchiveFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.zip', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso'].includes(ext);
}

/**
 * Search for file in local filesystem
 */
async function searchLocal(attachment, searchPaths, options) {
  console.log(`  🔍 Searching local filesystem...`);
  
  for (const searchPath of searchPaths) {
    if (!fs.existsSync(searchPath)) {
      console.log(`    ⚠ Path not found: ${searchPath}`);
      continue;
    }
    
    try {
      const result = await searchInDirectory(searchPath, attachment, options);
      if (result) {
        return result;
      }
    } catch (error) {
      console.log(`    ⚠ Error searching ${searchPath}: ${error.message}`);
    }
  }
  
  return null;
}

/**
 * Recursively search directory for matching file
 */
async function searchInDirectory(dir, attachment, options, depth = 0) {
  if (depth > 10) return null; // Prevent excessive recursion
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      // Skip symbolic links
      if (entry.isSymbolicLink()) {
        continue;
      }
      
      if (entry.isDirectory()) {
        // Recurse into subdirectory
        const result = await searchInDirectory(fullPath, attachment, options, depth + 1);
        if (result) return result;
      } else if (entry.isFile()) {
        // Check if file matches
        const result = await checkFile(fullPath, attachment, options);
        if (result) return result;
      }
    }
  } catch (error) {
    // Skip directories we can't read
  }
  
  return null;
}

/**
 * Check if a file matches the attachment
 */
async function checkFile(filePath, attachment, options) {
  try {
    const stats = fs.statSync(filePath);
    
    // Check file size if known
    if (attachment.file_size && stats.size !== attachment.file_size) {
      // Size mismatch - skip unless it's an archive
      if (!isArchiveFile(filePath)) {
        return null;
      }
    }
    
    // Check max file size limit
    if (stats.size > options.maxFileSize) {
      return null;
    }
    
    // Check filename if not ignoring
    if (!options.ignoreFilename) {
      const baseName = path.basename(filePath, path.extname(filePath));
      const targetBaseName = path.basename(attachment.file_name, path.extname(attachment.file_name));
      
      if (baseName !== targetBaseName) {
        // Filename doesn't match - skip unless it's an archive
        if (!isArchiveFile(filePath)) {
          return null;
        }
      }
    }
    
    // If it's an archive, search inside it
    if (isArchiveFile(filePath)) {
      return await searchInArchive(filePath, attachment, options);
    }
    
    // Read and verify file
    const fileData = fs.readFileSync(filePath);
    const verification = verifyFileData(fileData, attachment);
    
    if (verification.verified) {
      console.log(`    ✓ Found matching file: ${filePath}`);
      console.log(`      Verified with ${verification.method}`);
      return { data: fileData, source: `local:${filePath}` };
    }
  } catch (error) {
    // Skip files we can't read
  }
  
  return null;
}

/**
 * Search inside archive file
 */
async function searchInArchive(archivePath, attachment, options) {
  // This is a placeholder - full implementation would use libraries like:
  // - yauzl for ZIP
  // - node-7z for 7z
  // - tar-stream for TAR
  console.log(`    🗜 Searching archive: ${path.basename(archivePath)} (not implemented)`);
  return null;
}

/**
 * Search ArDrive by file ID/name/path
 */
async function searchArDrive(attachment, arDrive, options) {
  console.log(`  🌐 Searching ArDrive...`);
  
  if (!attachment.arweave_file_id && !attachment.arweave_file_name) {
    console.log(`    ⚠ No ArDrive metadata available`);
    return null;
  }
  
  try {
    if (attachment.arweave_file_id) {
      // Try to download by transaction ID (would need to get dataTxId)
      console.log(`    Checking file ID: ${attachment.arweave_file_id}`);
      // Implementation would list folder and find the file
    }
    
    // For now, return null - full implementation needed
    return null;
  } catch (error) {
    console.log(`    ⚠ ArDrive search error: ${error.message}`);
    return null;
  }
}

/**
 * Load IPFS gateways from database
 */
function loadIPFSGatewaysFromDB(db) {
  try {
    // Check if ipfsgateways table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='ipfsgateways'
    `).get();
    
    if (!tableExists) {
      return [];
    }
    
    // Check if priority column exists (may not exist in older schemas)
    const columns = db.prepare("PRAGMA table_info(ipfsgateways)").all();
    const hasPriority = columns.some(col => col.name === 'priority');
    
    // Get working gateways (not failed in last 10 minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    
    let gateways;
    if (hasPriority) {
      gateways = db.prepare(`
        SELECT url 
        FROM ipfsgateways 
        WHERE notworking_timestamp IS NULL 
           OR notworking_timestamp < ?
        ORDER BY priority ASC, url ASC
      `).all(tenMinutesAgo);
    } else {
      // Fallback for schemas without priority column
      gateways = db.prepare(`
        SELECT url 
        FROM ipfsgateways 
        WHERE notworking_timestamp IS NULL 
           OR notworking_timestamp < ?
        ORDER BY url ASC
      `).all(tenMinutesAgo);
    }
    
    return gateways.map(g => g.url);
  } catch (error) {
    console.log(`    ⚠ Error loading gateways from DB: ${error.message}`);
    return [];
  }
}

/**
 * Build gateway URL with CID placeholder replacement
 */
function buildGatewayURL(gateway, cid) {
  if (gateway.includes('%CID%')) {
    return gateway.replace('%CID%', cid);
  } else {
    // Standard IPFS gateway pattern
    return `${gateway}/ipfs/${cid}`;
  }
}

/**
 * Verify IPFS gateway is working
 */
async function verifyIPFSGateway(gateway, db = null) {
  try {
    const url = buildGatewayURL(gateway, IPFS_CHECKER_CID);
    
    const response = await fetch(url, { 
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const text = await response.text();
    
    // Verify content
    if (text.trim() !== IPFS_CHECKER_TEXT) {
      // Also check SHA256
      const hash = crypto.createHash('sha256').update(text).digest('hex');
      if (hash !== IPFS_CHECKER_SHA256) {
        throw new Error('Content mismatch');
      }
    }
    
    // Gateway is working
    return { working: true, gateway };
    
  } catch (error) {
    // Gateway failed - update database if provided
    if (db) {
      try {
        const tableExists = db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='ipfsgateways'
        `).get();
        
        if (tableExists) {
          db.prepare(`
            UPDATE ipfsgateways 
            SET notworking_timestamp = CURRENT_TIMESTAMP,
                error = ?
            WHERE url = ?
          `).run(error.message, gateway);
        }
      } catch (dbError) {
        // Ignore DB errors
      }
    }
    
    return { working: false, gateway, error: error.message };
  }
}

/**
 * Initialize and verify IPFS gateways
 */
async function initializeIPFSGateways(customGateways, db = null) {
  let gateways = [];
  
  // Add custom gateways first (highest priority)
  if (customGateways && customGateways.length > 0) {
    gateways.push(...customGateways);
  }
  
  // Load from database if available
  if (db) {
    const dbGateways = loadIPFSGatewaysFromDB(db);
    gateways.push(...dbGateways);
  }
  
  // Add defaults if no gateways specified
  if (gateways.length === 0) {
    gateways.push(...DEFAULT_IPFS_GATEWAYS);
  }
  
  // Remove duplicates
  gateways = [...new Set(gateways)];
  
  console.log(`  Verifying ${gateways.length} IPFS gateway(s)...`);
  
  const verifiedGateways = [];
  
  for (const gateway of gateways) {
    console.log(`    Testing: ${gateway}`);
    const result = await verifyIPFSGateway(gateway, db);
    
    if (result.working) {
      console.log(`      ✓ Working`);
      verifiedGateways.push(gateway);
    } else {
      console.log(`      ✗ Failed: ${result.error}`);
    }
    
    // Wait 2 seconds between checks as per spec
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`  ${verifiedGateways.length} gateway(s) verified and ready`);
  
  return verifiedGateways;
}

/**
 * Generate alternate CID formats for IPFS search
 * Converts between dag-pb (bafy) and raw (bafk) formats
 */
function getAlternateCIDs(cid) {
  if (!cid) return [];
  
  const alternates = [cid]; // Always include original
  
  // Convert between bafy (dag-pb) and bafk (raw) formats
  // These represent the same content but with different IPFS wrapping
  // Format: base + version + codec + hash
  //   bafy + be + hash (dag-pb, codec 0x70)
  //   bafk + re + hash (raw, codec 0x55)
  
  if (cid.startsWith('bafybe')) {
    // dag-pb → raw: bafybeXXX... → bafkreXXX...
    const rawCid = 'bafkre' + cid.substring(6);
    alternates.unshift(rawCid);
  } else if (cid.startsWith('bafkre')) {
    // raw → dag-pb: bafkreXXX... → bafybeXXX...
    const dagPbCid = 'bafybe' + cid.substring(6);
    alternates.unshift(dagPbCid);
  }
  
  return alternates;
}

/**
 * Search IPFS using CIDs with multiple gateways
 */
async function searchIPFS(attachment, options, verifiedGateways) {
  console.log(`  🌐 Searching IPFS...`);
  
  if (!attachment.file_ipfs_cidv1 && !attachment.file_ipfs_cidv0) {
    console.log(`    ⚠ No IPFS CIDs available`);
    return null;
  }
  
  if (!verifiedGateways || verifiedGateways.length === 0) {
    console.log(`    ⚠ No working IPFS gateways available`);
    return null;
  }
  
  const primaryCid = attachment.file_ipfs_cidv1 || attachment.file_ipfs_cidv0;
  
  // Generate list of CIDs to try (original + alternates)
  const cidsToTry = getAlternateCIDs(primaryCid);
  
  if (cidsToTry.length > 1) {
    console.log(`    ⓘ Will try ${cidsToTry.length} CID formats (dag-pb/raw variants)`);
  }
  
  // Try each CID format
  for (const cid of cidsToTry) {
    console.log(`    Trying CID: ${cid.substring(0, 20)}...`);
    
    // Try each gateway for this CID
    for (let i = 0; i < verifiedGateways.length; i++) {
      const gateway = verifiedGateways[i];
      
      try {
        const url = buildGatewayURL(gateway, cid);
        console.log(`      Gateway ${i+1}/${verifiedGateways.length}: ${gateway.substring(0, 30)}...`);
        
        const response = await fetch(url, {
          signal: AbortSignal.timeout(30000) // 30 second timeout
        });
        
        if (!response.ok) {
          console.log(`        HTTP ${response.status}`);
          continue; // Try next gateway
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const fileData = Buffer.from(arrayBuffer);
        
        const verification = verifyFileData(fileData, attachment);
        if (verification.verified) {
          console.log(`    ✓ Found via IPFS`);
          console.log(`      CID: ${cid}`);
          console.log(`      Gateway: ${gateway}`);
          console.log(`      Verified with ${verification.method}`);
          return { data: fileData, source: `ipfs:${cid}@${gateway}` };
        } else {
          console.log(`        Hash mismatch`);
          continue; // Try next gateway
        }
      } catch (error) {
        console.log(`        Error: ${error.message}`);
        // Try next gateway
      }
    }
  }
  
  console.log(`    ✗ File not found on any IPFS gateway (tried ${cidsToTry.length} CID format(s))`);
  return null;
}

/**
 * Search using download_urls
 */
async function searchDownloadUrls(attachment, options) {
  console.log(`  🌐 Searching download URLs...`);
  
  if (!attachment.download_urls) {
    console.log(`    ⚠ No download URLs available`);
    return null;
  }
  
  let urls = [];
  try {
    // Parse as JSON array or single URL
    if (attachment.download_urls.startsWith('[')) {
      urls = JSON.parse(attachment.download_urls);
    } else {
      urls = [attachment.download_urls];
    }
  } catch (error) {
    urls = [attachment.download_urls];
  }
  
  // Shuffle URLs for random order
  urls = urls.sort(() => Math.random() - 0.5);
  
  for (const url of urls) {
    try {
      console.log(`    Trying: ${url}`);
      
      const response = await fetch(url);
      if (!response.ok) {
        console.log(`      HTTP ${response.status}`);
        continue;
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const fileData = Buffer.from(arrayBuffer);
      
      // Check if it's an archive
      const urlExt = path.extname(new URL(url).pathname).toLowerCase();
      if (['.zip', '.7z', '.tar', '.gz'].includes(urlExt)) {
        console.log(`      Archive file detected (search not implemented)`);
        continue;
      }
      
      const verification = verifyFileData(fileData, attachment);
      if (verification.verified) {
        console.log(`    ✓ Found via URL`);
        console.log(`      Verified with ${verification.method}`);
        return { data: fileData, source: `url:${url}` };
      } else {
        console.log(`      Hash mismatch`);
      }
    } catch (error) {
      console.log(`      Error: ${error.message}`);
    }
  }
  
  return null;
}

/**
 * Parse Mode 2 specific arguments
 */
function parseMode2Arguments(args) {
  const options = {
    searchMax: DEFAULT_SEARCH_MAX,
    maxFileSize: DEFAULT_MAX_FILE_SIZE,
    searchLocal: true,
    searchLocalPaths: [],
    searchArDrive: false,
    searchIPFS: false,
    searchAllArDrive: false,
    searchDownload: false,
    searchAPI: false,
    apiUrl: null,
    apiClient: null,
    apiSecret: null,
    ipfsGateways: [], // Changed to array to support multiple gateways
    ignoreFilename: false
  };
  
  for (const arg of args) {
    if (arg.startsWith('--searchmax=')) {
      options.searchMax = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--maxfilesize=')) {
      options.maxFileSize = parseFileSize(arg.split('=')[1]);
    } else if (arg === '--nosearchlocal') {
      options.searchLocal = false;
    } else if (arg.startsWith('--searchlocalpath=')) {
      options.searchLocalPaths.push(arg.split('=')[1]);
    } else if (arg === '--searchardrive') {
      options.searchArDrive = true;
    } else if (arg === '--searchipfs') {
      options.searchIPFS = true;
    } else if (arg === '--allardrive') {
      options.searchAllArDrive = true;
    } else if (arg === '--download') {
      options.searchDownload = true;
    } else if (arg === '--apisearch') {
      options.searchAPI = true;
    } else if (arg.startsWith('--apiurl=')) {
      options.apiUrl = arg.split('=')[1];
      options.searchAPI = true;
    } else if (arg.startsWith('--apiclient=')) {
      options.apiClient = arg.split('=')[1];
    } else if (arg.startsWith('--apisecret=')) {
      options.apiSecret = arg.split('=')[1];
    } else if (arg.startsWith('--ipfsgateway=')) {
      // Support multiple --ipfsgateway options
      options.ipfsGateways.push(arg.split('=')[1]);
    } else if (arg === '--ignorefilename') {
      options.ignoreFilename = true;
    }
  }
  
  return options;
}

// Load Option G implementation
const optionG = require('./fetchpatches_mode2_optionG');

module.exports = {
  parseMode2Arguments,
  searchLocal,
  searchArDrive,
  searchIPFS,
  searchDownloadUrls,
  searchAPI: optionG.searchAPI,
  parseFileSize,
  verifyFileData,
  validateFileDataHash: optionG.validateFileDataHash,
  initializeIPFSGateways,
  verifyIPFSGateway,
  loadIPFSGatewaysFromDB,
  buildGatewayURL,
  DEFAULT_SEARCH_MAX,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_SEARCH_PATHS,
  DEFAULT_IPFS_GATEWAYS,
  IPFS_CHECKER_CID,
  IPFS_CHECKER_SHA256,
  IPFS_CHECKER_TEXT
};

