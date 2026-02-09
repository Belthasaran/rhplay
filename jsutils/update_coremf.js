#!/usr/bin/env node

/**
 * update_coremf.js
 *
 * Update coremanifest.json targets (MANIFEST_PKG, win64/portable, linux64/AppImage, etc.)
 *
 * Usage:
 *   update_coremf.js <coremanifest.json> --target <key> [options]
 *
 * Options:
 *   --target <key>                Target entry (e.g., beta/MANIFEST_PKG, beta/RHPLAY/win64/portable)
 *   --zipfile <path>              (MANIFEST_PKG) Path to ZIP file
 *   --exe <path>                  (Software) Path to executable file
 *   --file <path>                 (Software) Path to file (alternative to --exe)
 *   --sha256 <hex>                SHA256 hash (compute if omitted)
 *   --size <bytes>                File size in bytes (compute if omitted)
 *   --ipfs-cid <cid>              IPFS CIDv1 (compute if omitted)
 *   --url <url>                   HTTPS URL
 *   --baddr <base64>              Base64-encoded URL (baddr)
 *   --ardrive-drive-id <id>       ArDrive drive ID
 *   --ardrive-folder-id <id>      ArDrive folder ID
 *   --ardrive-file-name <name>    ArDrive file name
 *   --ardrive-file-path <path>    ArDrive file path
 *   --ardrive-file-id <id>        ArDrive file ID
 *   --data-txid <txid>            ArDrive data transaction ID
 *   --bump-lastupdated            Update lastupdated to current time
 *   --bump-versionid              Increment versionid
 *   --help                        Show usage information
 *
 * Examples:
 *   update_coremf.js electron/coremanifest.json --target beta/MANIFEST_PKG --zipfile manifest.zip
 *   update_coremf.js electron/coremanifest.json --target beta/RHPLAY/win64/portable --exe RHTools.exe --bump-lastupdated
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { of: ipfsOnlyHash } = require('ipfs-only-hash');

const HELP_TEXT = `
Usage:
  update_coremf.js <coremanifest.json> --target <key> [options]

Options:
  --target <key>                Target entry (e.g., beta/MANIFEST_PKG, beta/RHPLAY/win64/portable)
  --zipfile <path>              (MANIFEST_PKG) Path to ZIP file
  --exe <path>                  (Software) Path to executable file
  --file <path>                 (Software) Path to file (alternative to --exe)
  --sha256 <hex>                SHA256 hash (compute if omitted)
  --size <bytes>                File size in bytes (compute if omitted)
  --ipfs-cid <cid>              IPFS CIDv1 (compute if omitted)
  --url <url>                   HTTPS URL
  --baddr <base64>              Base64-encoded URL (baddr)
  --ardrive-drive-id <id>       ArDrive drive ID
  --ardrive-folder-id <id>      ArDrive folder ID
  --ardrive-file-name <name>    ArDrive file name
  --ardrive-file-path <path>    ArDrive file path
  --ardrive-file-id <id>        ArDrive file ID
  --data-txid <txid>            ArDrive data transaction ID
  --bump-lastupdated            Update lastupdated to current time
  --bump-versionid              Increment versionid
  --help                        Show this help message

Examples:
  update_coremf.js electron/coremanifest.json --target beta/MANIFEST_PKG --zipfile manifest.zip
  update_coremf.js electron/coremanifest.json --target beta/RHPLAY/win64/portable --exe RHTools.exe --bump-lastupdated
`.trim();

function exitWithError(message) {
  console.error(`[update_coremf] ${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = {
    manifestPath: null,
    targetKey: null,
    zipfile: null,
    exe: null,
    file: null,
    sha256: null,
    size: null,
    ipfsCid: null,
    url: null,
    baddr: null,
    ardriveDriveId: null,
    ardriveFolderId: null,
    ardriveFileName: null,
    ardriveFilePath: null,
    ardriveFileId: null,
    dataTxid: null,
    bumpLastupdated: false,
    bumpVersionid: false
  };

  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      console.log(HELP_TEXT);
      process.exit(0);
    } else if (arg === '--target') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --target');
      }
      options.targetKey = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--target=')) {
      options.targetKey = arg.substring('--target='.length);
    } else if (arg === '--zipfile') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --zipfile');
      }
      options.zipfile = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--zipfile=')) {
      options.zipfile = arg.substring('--zipfile='.length);
    } else if (arg === '--exe') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --exe');
      }
      options.exe = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--exe=')) {
      options.exe = arg.substring('--exe='.length);
    } else if (arg === '--file') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --file');
      }
      options.file = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--file=')) {
      options.file = arg.substring('--file='.length);
    } else if (arg === '--sha256') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --sha256');
      }
      options.sha256 = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--sha256=')) {
      options.sha256 = arg.substring('--sha256='.length);
    } else if (arg === '--size') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --size');
      }
      options.size = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--size=')) {
      options.size = arg.substring('--size='.length);
    } else if (arg === '--ipfs-cid') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --ipfs-cid');
      }
      options.ipfsCid = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--ipfs-cid=')) {
      options.ipfsCid = arg.substring('--ipfs-cid='.length);
    } else if (arg === '--url') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --url');
      }
      options.url = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--url=')) {
      options.url = arg.substring('--url='.length);
    } else if (arg === '--baddr') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --baddr');
      }
      options.baddr = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--baddr=')) {
      options.baddr = arg.substring('--baddr='.length);
    } else if (arg === '--ardrive-drive-id') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --ardrive-drive-id');
      }
      options.ardriveDriveId = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--ardrive-drive-id=')) {
      options.ardriveDriveId = arg.substring('--ardrive-drive-id='.length);
    } else if (arg === '--ardrive-folder-id') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --ardrive-folder-id');
      }
      options.ardriveFolderId = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--ardrive-folder-id=')) {
      options.ardriveFolderId = arg.substring('--ardrive-folder-id='.length);
    } else if (arg === '--ardrive-file-name') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --ardrive-file-name');
      }
      options.ardriveFileName = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--ardrive-file-name=')) {
      options.ardriveFileName = arg.substring('--ardrive-file-name='.length);
    } else if (arg === '--ardrive-file-path') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --ardrive-file-path');
      }
      options.ardriveFilePath = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--ardrive-file-path=')) {
      options.ardriveFilePath = arg.substring('--ardrive-file-path='.length);
    } else if (arg === '--ardrive-file-id') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --ardrive-file-id');
      }
      options.ardriveFileId = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--ardrive-file-id=')) {
      options.ardriveFileId = arg.substring('--ardrive-file-id='.length);
    } else if (arg === '--data-txid') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --data-txid');
      }
      options.dataTxid = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--data-txid=')) {
      options.dataTxid = arg.substring('--data-txid='.length);
    } else if (arg === '--bump-lastupdated') {
      options.bumpLastupdated = true;
    } else if (arg === '--bump-versionid') {
      options.bumpVersionid = true;
    } else if (arg.startsWith('--')) {
      exitWithError(`Unrecognized option "${arg}". Use --help for usage information.`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length === 0) {
    exitWithError('Missing coremanifest.json path argument.');
  }

  options.manifestPath = positional.shift();

  if (!options.targetKey) {
    exitWithError('Missing required option --target');
  }

  // Determine file path
  if (!options.zipfile && !options.exe && !options.file) {
    exitWithError('Must specify --zipfile, --exe, or --file');
  }

  if (options.exe && options.file) {
    exitWithError('Cannot specify both --exe and --file');
  }

  return options;
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    exitWithError(`Manifest file "${manifestPath}" not found.`);
  }
  const raw = fs.readFileSync(manifestPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    exitWithError(`Failed to parse manifest JSON: ${err.message}`);
  }
}

function writeManifest(manifestPath, manifest) {
  const output = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(manifestPath, output, 'utf8');
}

/**
 * Find target entry case-insensitively
 */
function findTargetEntry(manifest, targetKey) {
  const normalizedKey = targetKey.toLowerCase();
  for (const key of Object.keys(manifest)) {
    if (key.toLowerCase() === normalizedKey) {
      return { actualKey: key, entry: manifest[key] };
    }
  }
  return null;
}

function computeSha256(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function computeIpfsCid(filePath) {
  const buffer = fs.readFileSync(filePath);
  return await ipfsOnlyHash(buffer, {
    cidVersion: 1,
    rawLeaves: true,
    hashAlg: 'sha2-256',
    wrapWithDirectory: false
  });
}

async function run(argv) {
  const opts = parseArguments(argv);

  // Read manifest
  const manifest = readManifest(opts.manifestPath);

  // Find target entry (case-insensitive)
  const targetInfo = findTargetEntry(manifest, opts.targetKey);
  if (!targetInfo) {
    exitWithError(`Target "${opts.targetKey}" not found in manifest`);
  }

  const { actualKey, entry } = targetInfo;
  console.log(`[update_coremf] Updating target: ${actualKey}`);

  // Determine file path
  const filePath = opts.zipfile || opts.exe || opts.file;
  if (!fs.existsSync(filePath)) {
    exitWithError(`File not found: ${filePath}`);
  }

  // Compute metadata if needed
  let sha256 = opts.sha256;
  let size = opts.size;
  let ipfsCid = opts.ipfsCid;

  if (!sha256 || !size || !ipfsCid) {
    console.log(`[update_coremf] Computing metadata for ${filePath}...`);
    const stats = fs.statSync(filePath);
    
    if (!size) {
      size = stats.size.toString();
      console.log(`[update_coremf] Size: ${size} bytes`);
    }

    if (!sha256) {
      sha256 = computeSha256(filePath);
      console.log(`[update_coremf] SHA256: ${sha256}`);
    }

    if (!ipfsCid) {
      ipfsCid = await computeIpfsCid(filePath);
      console.log(`[update_coremf] IPFS CIDv1: ${ipfsCid}`);
    }
  }

  // Determine filename
  const fileName = path.basename(filePath);

  // Update entry based on target type
  if (actualKey.toLowerCase().includes('manifest_pkg')) {
    // MANIFEST_PKG entry
    entry.sha256 = sha256;
    entry.size = size;
    entry.ipfs_cidv1 = ipfsCid;
    if (opts.baddr) {
      entry.baddr = opts.baddr;
    }
    if (opts.url) {
      // Store URL in baddr if no baddr specified
      if (!opts.baddr) {
        entry.baddr = Buffer.from(opts.url).toString('base64');
      }
    }
  } else {
    // Software target (win64/portable, linux64/AppImage)
    entry.sha256 = sha256;
    entry.size = size;
    entry.ipfs_cidv1 = ipfsCid;
    entry.source_filename = fileName;
    entry.target_filename = fileName;
    if (opts.baddr) {
      entry.baddr = opts.baddr;
    }
    if (opts.url) {
      if (!opts.baddr) {
        entry.baddr = Buffer.from(opts.url).toString('base64');
      }
    }
    // Update updated timestamp
    entry.updated = Math.floor(Date.now() / 1000);
  }

  // Update ArDrive fields if provided
  if (opts.ardriveDriveId) {
    entry.ardrive_drive_id = opts.ardriveDriveId;
  }
  if (opts.ardriveFolderId) {
    entry.ardrive_folder_id = opts.ardriveFolderId;
  }
  if (opts.ardriveFileName) {
    entry.ardrive_file_name = opts.ardriveFileName;
  }
  if (opts.ardriveFilePath) {
    entry.ardrive_file_path = opts.ardriveFilePath;
  }
  if (opts.ardriveFileId) {
    entry.ardrive_file_id = opts.ardriveFileId;
  }
  if (opts.dataTxid) {
    entry.data_txid = opts.dataTxid;
  }

  // Update top-level fields if requested
  if (opts.bumpLastupdated) {
    manifest.lastupdated = Math.floor(Date.now() / 1000);
    console.log(`[update_coremf] Updated lastupdated to ${manifest.lastupdated}`);
  }

  if (opts.bumpVersionid) {
    manifest.versionid = (manifest.versionid || 0) + 1;
    console.log(`[update_coremf] Incremented versionid to ${manifest.versionid}`);
  }

  // Write manifest
  writeManifest(opts.manifestPath, manifest);
  console.log(`[update_coremf] Successfully updated ${opts.manifestPath}`);
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((err) => {
    console.error('[update_coremf] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { run };
