#!/usr/bin/env node
/**
 * mark-upload-done.js
 * 
 * Marks blob files as uploaded to a specific provider in the upload_status table.
 * 
 * Usage:
 *   node mark-upload-done.js --provider=<name> [file names...]
 *   node mark-upload-done.js --provider=<name> --file=<list.txt>
 *   cat files.txt | node mark-upload-done.js --provider=<name> --stdin
 * 
 * Options:
 *   --provider=<name>     Provider name (ipfs, arweave, ardrive, etc.) [REQUIRED]
 *   --file=<path>         Read file names from file (one per line)
 *   --stdin               Read file names from stdin (space/newline separated)
 *   --txid=<id>           Transaction ID for arweave uploads
 *   --cid=<cid>           CID for IPFS uploads
 *   --file-id=<id>        File ID for ArDrive uploads
 *   --dry-run             Show what would be marked without updating database
 *   --verbose, -v         Show detailed information
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const readline = require('readline');

const CONFIG = {
  PATCHBIN_DB_PATH: path.join(__dirname, 'electron', 'patchbin.db'),
  PROVIDER: null,
  TXID: null,
  CID: null,
  FILE_ID: null,
  DRY_RUN: false,
  VERBOSE: false,
  USE_STDIN: false,
  INPUT_FILE: null
};

function parseArgs(args) {
  const parsed = {
    fileNames: []
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--provider=')) {
      parsed.provider = arg.split('=')[1];
    } else if (arg === '--provider') {
      parsed.provider = args[++i];
    } else if (arg.startsWith('--file=')) {
      parsed.inputFile = arg.split('=')[1];
    } else if (arg === '--file') {
      parsed.inputFile = args[++i];
    } else if (arg === '--stdin') {
      parsed.useStdin = true;
    } else if (arg.startsWith('--txid=')) {
      parsed.txid = arg.split('=')[1];
    } else if (arg === '--txid') {
      parsed.txid = args[++i];
    } else if (arg.startsWith('--cid=')) {
      parsed.cid = arg.split('=')[1];
    } else if (arg === '--cid') {
      parsed.cid = args[++i];
    } else if (arg.startsWith('--file-id=')) {
      parsed.fileId = arg.split('=')[1];
    } else if (arg === '--file-id') {
      parsed.fileId = args[++i];
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      parsed.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
mark-upload-done.js - Mark blob files as uploaded to a provider

Usage:
  node mark-upload-done.js --provider=<name> [file names...]
  node mark-upload-done.js --provider=<name> --file=<list.txt>
  cat files.txt | node mark-upload-done.js --provider=<name> --stdin

Options:
  --provider=<name>     Provider name (ipfs, arweave, ardrive, etc.) [REQUIRED]
  --file=<path>         Read file names from file (one per line)
  --stdin               Read file names from stdin (space/newline separated)
  --txid=<id>           Transaction ID for arweave uploads
  --cid=<cid>           CID for IPFS uploads
  --file-id=<id>        File ID for ArDrive uploads
  --dry-run             Show what would be marked without updating database
  --verbose, -v         Show detailed information
  --help, -h            Show this help message

Providers:
  ipfs                  Mark as uploaded to IPFS
  arweave               Mark as uploaded to Arweave
  ardrive               Mark as uploaded to ArDrive
  <custom>              Mark as uploaded to custom provider

Examples:
  # Mark files from command line
  node mark-upload-done.js --provider=ipfs pblob_123.bin pblob_456.bin

  # Mark files from a list
  node mark-upload-done.js --provider=arweave --file=uploaded.txt

  # Mark files from stdin
  cat uploaded.txt | node mark-upload-done.js --provider=ipfs --stdin

  # Mark with transaction ID
  node mark-upload-done.js --provider=arweave --txid=abc123 pblob_123.bin

  # Dry run
  node mark-upload-done.js --provider=ipfs --dry-run --file=list.txt
`);
      process.exit(0);
    } else if (!arg.startsWith('--')) {
      // Treat as file name
      parsed.fileNames.push(arg);
    }
  }
  
  return parsed;
}

async function readFileNames(inputFile) {
  const content = fs.readFileSync(inputFile, 'utf-8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

async function readStdin() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });
    
    const lines = [];
    
    rl.on('line', (line) => {
      // Split by spaces and newlines
      const names = line.split(/\s+/).filter(n => n.trim().length > 0);
      lines.push(...names);
    });
    
    rl.on('close', () => {
      resolve(lines);
    });
  });
}

function ensureUploadStatusTable(db) {
  // Create upload_status table if it doesn't exist
  db.exec(`
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
}

function markFilesUploaded(db, provider, fileNames, metadata) {
  const providerLower = provider.toLowerCase();
  const now = new Date().toISOString();
  
  // Determine column names based on provider
  let uploadedColumn, timeColumn, metadataColumn;
  
  if (providerLower === 'ipfs') {
    uploadedColumn = 'uploaded_ipfs';
    timeColumn = 'ipfs_uploaded_time';
    metadataColumn = 'ipfs_cid';
  } else if (providerLower === 'arweave') {
    uploadedColumn = 'uploaded_arweave';
    timeColumn = 'arweave_uploaded_time';
    metadataColumn = 'arweave_txid';
  } else if (providerLower === 'ardrive') {
    uploadedColumn = 'uploaded_ardrive';
    timeColumn = 'ardrive_uploaded_time';
    metadataColumn = 'ardrive_file_id';
  } else {
    // Custom provider - store in notes
    console.error(`⚠️  Custom provider '${provider}' - storing in notes field`);
    uploadedColumn = null;
  }
  
  const results = {
    inserted: 0,
    updated: 0,
    errors: 0,
    skipped: []
  };
  
  const insertOrUpdate = db.prepare(`
    INSERT INTO upload_status (
      file_name, ${uploadedColumn}, ${timeColumn}, ${metadataColumn}, updated_time
    ) VALUES (?, 1, ?, ?, ?)
    ON CONFLICT(file_name) DO UPDATE SET
      ${uploadedColumn} = 1,
      ${timeColumn} = ?,
      ${metadataColumn} = COALESCE(?, ${metadataColumn}),
      updated_time = ?
  `);
  
  const insertOrUpdateCustom = db.prepare(`
    INSERT INTO upload_status (
      file_name, notes, updated_time
    ) VALUES (?, ?, ?)
    ON CONFLICT(file_name) DO UPDATE SET
      notes = ?,
      updated_time = ?
  `);
  
  for (const fileName of fileNames) {
    try {
      if (uploadedColumn) {
        const metadataValue = metadata.cid || metadata.txid || metadata.fileId;
        insertOrUpdate.run(
          fileName,
          now,
          metadataValue,
          now,
          now,
          metadataValue,
          now
        );
      } else {
        // Custom provider
        const note = `Uploaded to ${provider} at ${now}`;
        insertOrUpdateCustom.run(
          fileName,
          note,
          now,
          note,
          now
        );
      }
      
      // Check if it was insert or update
      const existing = db.prepare('SELECT file_name FROM upload_status WHERE file_name = ?').get(fileName);
      if (existing) {
        results.updated++;
      } else {
        results.inserted++;
      }
    } catch (error) {
      results.errors++;
      results.skipped.push({ fileName, error: error.message });
      
      if (CONFIG.VERBOSE) {
        console.error(`✗ Error marking ${fileName}: ${error.message}`);
      }
    }
  }
  
  return results;
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  
  // Validate required provider
  if (!argv.provider) {
    console.error('Error: --provider is required');
    console.error('Try: node mark-upload-done.js --help');
    process.exit(1);
  }
  
  CONFIG.PROVIDER = argv.provider;
  CONFIG.DRY_RUN = argv.dryRun || false;
  CONFIG.VERBOSE = argv.verbose || false;
  CONFIG.USE_STDIN = argv.useStdin || false;
  CONFIG.INPUT_FILE = argv.inputFile || null;
  CONFIG.TXID = argv.txid || null;
  CONFIG.CID = argv.cid || null;
  CONFIG.FILE_ID = argv.fileId || null;
  
  if (CONFIG.VERBOSE) {
    console.error('='.repeat(70));
    console.error('MARK UPLOAD DONE');
    console.error('='.repeat(70));
    console.error(`Provider: ${CONFIG.PROVIDER}`);
    console.error(`Dry Run: ${CONFIG.DRY_RUN}`);
    console.error('');
  }
  
  try {
    // Collect file names from various sources
    let fileNames = [...argv.fileNames];
    
    if (CONFIG.INPUT_FILE) {
      const filesFromFile = await readFileNames(CONFIG.INPUT_FILE);
      fileNames.push(...filesFromFile);
      
      if (CONFIG.VERBOSE) {
        console.error(`Read ${filesFromFile.length} file names from ${CONFIG.INPUT_FILE}`);
      }
    }
    
    if (CONFIG.USE_STDIN) {
      const filesFromStdin = await readStdin();
      fileNames.push(...filesFromStdin);
      
      if (CONFIG.VERBOSE) {
        console.error(`Read ${filesFromStdin.length} file names from stdin`);
      }
    }
    
    // Remove duplicates
    fileNames = [...new Set(fileNames)];
    
    if (fileNames.length === 0) {
      console.error('Error: No file names provided');
      console.error('Provide file names via:');
      console.error('  - Command line arguments');
      console.error('  - --file=<path> option');
      console.error('  - --stdin option');
      process.exit(1);
    }
    
    if (CONFIG.VERBOSE) {
      console.error(`Total files to mark: ${fileNames.length}\n`);
    }
    
    if (CONFIG.DRY_RUN) {
      console.error('DRY RUN - No changes will be made');
      console.error('\nWould mark the following files as uploaded to ' + CONFIG.PROVIDER + ':');
      fileNames.forEach(name => console.error(`  - ${name}`));
      console.error('');
      process.exit(0);
    }
    
    // Open database
    const db = new Database(CONFIG.PATCHBIN_DB_PATH, { readonly: false });
    
    // Ensure table exists
    ensureUploadStatusTable(db);
    
    // Mark files as uploaded
    const metadata = {
      cid: CONFIG.CID,
      txid: CONFIG.TXID,
      fileId: CONFIG.FILE_ID
    };
    
    const results = markFilesUploaded(db, CONFIG.PROVIDER, fileNames, metadata);
    
    db.close();
    
    // Report results
    console.error('');
    console.error('='.repeat(70));
    console.error('RESULTS');
    console.error('='.repeat(70));
    console.error(`Total processed: ${fileNames.length}`);
    console.error(`✓ Marked as uploaded: ${results.inserted + results.updated}`);
    console.error(`  - New records: ${results.inserted}`);
    console.error(`  - Updated records: ${results.updated}`);
    
    if (results.errors > 0) {
      console.error(`✗ Errors: ${results.errors}`);
      
      if (results.skipped.length > 0) {
        console.error('\nFailed files:');
        results.skipped.forEach(s => {
          console.error(`  - ${s.fileName}: ${s.error}`);
        });
      }
    }
    
    console.error('='.repeat(70));
    
    // Exit with error code if there were errors
    if (results.errors > 0) {
      process.exit(1);
    }
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (CONFIG.VERBOSE) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();

