#!/usr/bin/env node
/**
 * list-unuploaded-blobs.js
 * 
 * Lists blob files that haven't been uploaded to various providers.
 * Helps identify which files still need to be uploaded to ArDrive, IPFS, etc.
 * 
 * Usage:
 *   node list-unuploaded-blobs.js [options]
 * 
 * Options:
 *   --provider=<name>        Check specific provider (ipfs, ardrive, all) [default: arweave]
 *   --create-archive         Create a zip file containing unuploaded files
 *   --archive-name=<name>    Name for the archive file [default: unuploaded-blobs.zip]
 *   --scan-ardrive=<folder>  Scan ArDrive folder and exclude already uploaded files
 *   --scan-ipfs              Check IPFS gateways for CIDv1 availability
 *   --ipfs-gateway=<url>     IPFS gateway to check [default: https://ipfs.io]
 *   --output=<file>          Save list to file instead of stdout
 *   --verbose                Show detailed information
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const https = require('https');
const http = require('http');

const CONFIG = {
  DB_PATH: path.join(__dirname, 'electron', 'rhdata.db'),
  PATCHBIN_DB_PATH: path.join(__dirname, 'electron', 'patchbin.db'),
  BLOBS_DIR: path.join(__dirname, 'blobs'),
  PROVIDER: 'arweave',
  CREATE_ARCHIVE: false,
  ARCHIVE_NAME: 'unuploaded-blobs.zip',
  SCAN_ARDRIVE: null,
  SCAN_IPFS: false,
  IPFS_GATEWAY: 'https://ipfs.io',
  OUTPUT_FILE: null,
  VERBOSE: false
};

function parseArgs(args) {
  const parsed = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--provider=')) {
      parsed.provider = arg.split('=')[1];
    } else if (arg === '--provider') {
      parsed.provider = args[++i];
    } else if (arg === '--create-archive') {
      parsed.createArchive = true;
    } else if (arg.startsWith('--archive-name=')) {
      parsed.archiveName = arg.split('=')[1];
    } else if (arg === '--archive-name') {
      parsed.archiveName = args[++i];
    } else if (arg.startsWith('--scan-ardrive=')) {
      parsed.scanArdrive = arg.split('=')[1];
    } else if (arg === '--scan-ardrive') {
      parsed.scanArdrive = args[++i];
    } else if (arg === '--scan-ipfs') {
      parsed.scanIpfs = true;
    } else if (arg.startsWith('--ipfs-gateway=')) {
      parsed.ipfsGateway = arg.split('=')[1];
    } else if (arg === '--ipfs-gateway') {
      parsed.ipfsGateway = args[++i];
    } else if (arg.startsWith('--output=')) {
      parsed.outputFile = arg.split('=')[1];
    } else if (arg === '--output') {
      parsed.outputFile = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      parsed.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
list-unuploaded-blobs.js - List blobs not yet uploaded to providers

Usage:
  node list-unuploaded-blobs.js [options]

Options:
  --provider=<name>        Check specific provider (ipfs, ardrive, all) [default: arweave]
  --create-archive         Create a zip file containing unuploaded files
  --archive-name=<name>    Name for the archive file [default: unuploaded-blobs.zip]
  --scan-ardrive=<folder>  Scan ArDrive folder and exclude already uploaded files
  --scan-ipfs              Check IPFS gateways for CIDv1 availability
  --ipfs-gateway=<url>     IPFS gateway to check [default: https://ipfs.io]
  --output=<file>          Save list to file instead of stdout
  --verbose, -v            Show detailed information
  --help, -h               Show this help message

Examples:
  # List blobs missing arweave_file_id
  node list-unuploaded-blobs.js

  # Create archive of unuploaded files
  node list-unuploaded-blobs.js --create-archive

  # Check IPFS and list unuploaded
  node list-unuploaded-blobs.js --provider=ipfs --scan-ipfs

  # List all providers
  node list-unuploaded-blobs.js --provider=all --verbose
`);
      process.exit(0);
    }
  }
  
  return parsed;
}

function ensureUploadStatusTable(patchbinDb) {
  // Create upload_status table if it doesn't exist
  patchbinDb.exec(`
    CREATE TABLE IF NOT EXISTS upload_status (
      file_name TEXT PRIMARY KEY,
      uploaded_ipfs INTEGER DEFAULT 0,
      uploaded_arweave INTEGER DEFAULT 0,
      uploaded_ardrive INTEGER DEFAULT 0,
      ipfs_uploaded_time TIMESTAMP NULL,
      arweave_uploaded_time TIMESTAMP NULL,
      ardrive_uploaded_time TIMESTAMP NULL,
      ipfs_cid TEXT NULL,
      arweave_txid TEXT NULL,
      ardrive_file_id TEXT NULL,
      notes TEXT NULL,
      created_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  if (CONFIG.VERBOSE) {
    console.error('✓ Upload status table verified');
  }
}

function getUnuploadedBlobs(rhdataDb, patchbinDb, provider) {
  // Query for blobs based on provider
  let query;
  
  if (provider === 'arweave' || provider === 'ardrive') {
    // Check for blobs not uploaded to arweave/ardrive
    const uploadedColumn = provider === 'arweave' ? 'uploaded_arweave' : 'uploaded_ardrive';
    query = `
      SELECT 
        pb.patchblob1_name as file_name,
        pb.patchblob1_sha224,
        a.file_hash_sha224,
        us.uploaded_arweave,
        us.uploaded_ardrive,
        us.arweave_txid,
        us.ardrive_file_id
      FROM patchblobs pb
      LEFT JOIN patchbin.attachments a ON a.file_name = pb.patchblob1_name
      LEFT JOIN patchbin.upload_status us ON us.file_name = pb.patchblob1_name
      WHERE pb.patchblob1_name IS NOT NULL
        AND (us.${uploadedColumn} IS NULL OR us.${uploadedColumn} = 0)
	AND arweave_file_id IS NULL 
      ORDER BY pb.patchblob1_name
    `;
  } else if (provider === 'ipfs') {
    // Check for blobs not uploaded to IPFS
    query = `
      SELECT 
        pb.patchblob1_name as file_name,
        pb.patchblob1_sha224,
        a.file_hash_sha224,
        us.uploaded_ipfs,
        us.ipfs_cid
      FROM patchblobs pb
      LEFT JOIN patchbin.attachments a ON a.file_name = pb.patchblob1_name
      LEFT JOIN patchbin.upload_status us ON us.file_name = pb.patchblob1_name
      WHERE pb.patchblob1_name IS NOT NULL
        AND (us.uploaded_ipfs IS NULL OR us.uploaded_ipfs = 0)
      ORDER BY pb.patchblob1_name
    `;
  } else if (provider === 'all') {
    // Check all providers
    query = `
      SELECT 
        pb.patchblob1_name as file_name,
        pb.patchblob1_sha224,
        a.file_hash_sha224,
        us.uploaded_ipfs,
        us.uploaded_arweave,
        us.uploaded_ardrive,
        us.ipfs_cid,
        us.arweave_txid,
        us.ardrive_file_id
      FROM patchblobs pb
      LEFT JOIN patchbin.attachments a ON a.file_name = pb.patchblob1_name
      LEFT JOIN patchbin.upload_status us ON us.file_name = pb.patchblob1_name
      WHERE pb.patchblob1_name IS NOT NULL
      ORDER BY pb.patchblob1_name
    `;
  }
  
  const results = rhdataDb.prepare(query).all();
  return results;
}

async function checkIpfsAvailability(cid, gateway) {
  if (!cid || !cid.startsWith('bafk')) {
    return false;
  }
  
  return new Promise((resolve) => {
    const url = `${gateway}/ipfs/${cid}?download=false`;
    const protocol = gateway.startsWith('https') ? https : http;
    
    const req = protocol.get(url, { timeout: 5000 }, (res) => {
      // HEAD request would be better, but some gateways don't support it
      // 200 or 301/302 means file exists
      resolve(res.statusCode === 200 || res.statusCode === 301 || res.statusCode === 302);
      req.abort();
    });
    
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.abort();
      resolve(false);
    });
  });
}

async function scanArdriveFolder(folderId) {
  // This would require ardrive-cli or API calls
  // For now, return empty array - to be implemented
  console.error('⚠️  ArDrive scanning not yet implemented');
  return [];
}

async function createArchive(fileList, archiveName) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  
  let addedCount = 0;
  let missingCount = 0;
  
  for (const fileName of fileList) {
    const filePath = path.join(CONFIG.BLOBS_DIR, fileName);
    
    if (fs.existsSync(filePath)) {
      zip.addLocalFile(filePath);
      addedCount++;
    } else {
      missingCount++;
      if (CONFIG.VERBOSE) {
        console.error(`⚠️  File not found: ${fileName}`);
      }
    }
  }
  
  zip.writeZip(archiveName);
  
  return { addedCount, missingCount };
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  
  CONFIG.PROVIDER = (argv.provider || CONFIG.PROVIDER).toLowerCase();
  CONFIG.CREATE_ARCHIVE = argv.createArchive || false;
  CONFIG.ARCHIVE_NAME = argv.archiveName || CONFIG.ARCHIVE_NAME;
  CONFIG.SCAN_ARDRIVE = argv.scanArdrive || null;
  CONFIG.SCAN_IPFS = argv.scanIpfs || false;
  CONFIG.IPFS_GATEWAY = argv.ipfsGateway || CONFIG.IPFS_GATEWAY;
  CONFIG.OUTPUT_FILE = argv.outputFile || null;
  CONFIG.VERBOSE = argv.verbose || false;
  
  // Validate provider
  const validProviders = ['ipfs', 'arweave', 'ardrive', 'all'];
  if (!validProviders.includes(CONFIG.PROVIDER)) {
    console.error(`Error: Invalid provider '${CONFIG.PROVIDER}'. Must be one of: ${validProviders.join(', ')}`);
    process.exit(1);
  }
  
  if (CONFIG.VERBOSE) {
    console.error('='.repeat(70));
    console.error('UNUPLOADED BLOBS SCANNER');
    console.error('='.repeat(70));
    console.error(`Provider: ${CONFIG.PROVIDER}`);
    console.error(`Scan IPFS: ${CONFIG.SCAN_IPFS}`);
    console.error(`Create Archive: ${CONFIG.CREATE_ARCHIVE}`);
    console.error('');
  }
  
  try {
    // Open databases
    const rhdataDb = new Database(CONFIG.DB_PATH, { readonly: false });
    const patchbinDb = new Database(CONFIG.PATCHBIN_DB_PATH, { readonly: false });
    
    // Attach patchbin to rhdata for queries
    rhdataDb.prepare(`ATTACH DATABASE '${CONFIG.PATCHBIN_DB_PATH}' AS patchbin`).run();
    
    // Ensure upload_status table exists
    ensureUploadStatusTable(patchbinDb);
    
    // Get unuploaded blobs
    if (CONFIG.VERBOSE) {
      console.error('Querying unuploaded blobs...');
    }
    
    let blobs = getUnuploadedBlobs(rhdataDb, patchbinDb, CONFIG.PROVIDER);
    
    if (CONFIG.VERBOSE) {
      console.error(`Found ${blobs.length} potentially unuploaded blobs\n`);
    }
    
    // Filter by ArDrive scan
    if (CONFIG.SCAN_ARDRIVE) {
      const ardriveFiles = await scanArdriveFolder(CONFIG.SCAN_ARDRIVE);
      const ardriveFileNames = new Set(ardriveFiles);
      blobs = blobs.filter(b => !ardriveFileNames.has(b.file_name));
      
      if (CONFIG.VERBOSE) {
        console.error(`After ArDrive scan: ${blobs.length} blobs remaining\n`);
      }
    }
    
    // Check IPFS availability
    if (CONFIG.SCAN_IPFS && CONFIG.PROVIDER === 'ipfs') {
      if (CONFIG.VERBOSE) {
        console.error('Checking IPFS gateway availability...');
      }
      
      const availableOnIpfs = [];
      
      for (let i = 0; i < blobs.length; i++) {
        const blob = blobs[i];
        
        if (blob.uploaded_ipfs === 1) {
          // Already marked as uploaded, skip gateway check
          continue;
        }
        
        // Try to get CID from database
        const cid = blob.ipfs_cid;
        
        if (cid) {
          if (CONFIG.VERBOSE) {
            console.error(`[${i + 1}/${blobs.length}] Checking ${blob.file_name}...`);
          }
          
          const available = await checkIpfsAvailability(cid, CONFIG.IPFS_GATEWAY);
          
          if (available) {
            availableOnIpfs.push(blob.file_name);
            if (CONFIG.VERBOSE) {
              console.error(`  ✓ Available on IPFS: ${cid}`);
            }
          }
        } else if (CONFIG.VERBOSE) {
          console.error(`[${i + 1}/${blobs.length}] Skipping ${blob.file_name} (no CID)`);
        }
      }
      
      // Filter out blobs available on IPFS
      blobs = blobs.filter(b => !availableOnIpfs.includes(b.file_name));
      
      if (CONFIG.VERBOSE) {
        console.error(`\nAfter IPFS check: ${blobs.length} blobs need uploading\n`);
      }
    }
    
    // Extract file names
    const fileNames = blobs.map(b => b.file_name);
    
    // Create archive if requested
    if (CONFIG.CREATE_ARCHIVE && fileNames.length > 0) {
      if (CONFIG.VERBOSE) {
        console.error(`Creating archive: ${CONFIG.ARCHIVE_NAME}...`);
      }
      
      const { addedCount, missingCount } = await createArchive(fileNames, CONFIG.ARCHIVE_NAME);
      
      if (CONFIG.VERBOSE) {
        console.error(`✓ Archive created: ${addedCount} files added, ${missingCount} missing\n`);
      }
    }
    
    // Output results
    if (CONFIG.OUTPUT_FILE) {
      fs.writeFileSync(CONFIG.OUTPUT_FILE, fileNames.join('\n') + '\n');
      if (CONFIG.VERBOSE) {
        console.error(`✓ List saved to: ${CONFIG.OUTPUT_FILE}`);
      }
    } else {
      // Print to stdout
      fileNames.forEach(name => console.log(name));
    }
    
    if (CONFIG.VERBOSE) {
      console.error('');
      console.error('='.repeat(70));
      console.error(`Total unuploaded blobs: ${fileNames.length}`);
      console.error('='.repeat(70));
    }
    
    rhdataDb.close();
    patchbinDb.close();
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (CONFIG.VERBOSE) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();

