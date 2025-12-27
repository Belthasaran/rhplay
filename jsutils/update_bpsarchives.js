#!/usr/bin/env node

/**
 * update_bpsarchives.js - Manage bpsarchives.json manifest
 *
 * Usage:
 *   update_bpsarchives.js <manifest.json> [options]
 *
 * Options:
 *   --target <name>                Target entry in manifest (e.g., bps_00.7z, rhsearch_cat.db)
 *   --add-archive <file>           Add a BPS archive 7z file to the manifest
 *   --calculate-ipfs               Calculate IPFS CIDv1 for entries missing it
 *   --update-from-ardrive          Populate missing ArDrive metadata from the configured folder
 *   --ardrive-drive-id <id>        ArDrive drive ID (default: d3338fab-d24c-4d75-9e78-d3024befc225)
 *   --ardrive-folder-id <id>       ArDrive folder ID (default: a6130936-d92e-45ac-a004-273d96e9ec9d)
 *   --help                         Show usage information
 *
 * Examples:
 *   update_bpsarchives.js bpsarchives.json --target bps_00.7z --add-archive bps_00.7z
 *   update_bpsarchives.js bpsarchives.json --calculate-ipfs
 *   update_bpsarchives.js bpsarchives.json --update-from-ardrive
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { of: ipfsOnlyHash } = require('ipfs-only-hash');

const DEFAULT_BPS_DRIVE_ID = 'd3338fab-d24c-4d75-9e78-d3024befc225';
const DEFAULT_BPS_FOLDER_ID = 'a6130936-d92e-45ac-a004-273d96e9ec9d';

const HELP_TEXT = `
Usage:
  update_bpsarchives.js <manifest.json> [options]

Options:
  --target <name>             Manifest entry to update (e.g., bps_00.7z, rhsearch_cat.db)
  --add-archive <file>        Add a BPS archive 7z file to the manifest
  --calculate-ipfs            Calculate IPFS CIDv1 for entries missing it
  --update-from-ardrive       Populate missing ArDrive metadata from the configured folder
  --ardrive-drive-id <id>     ArDrive drive ID (default: ${DEFAULT_BPS_DRIVE_ID})
  --ardrive-folder-id <id>    ArDrive folder ID (default: ${DEFAULT_BPS_FOLDER_ID})
  --help                      Show this help message
`.trim();

function exitWithError(message) {
  console.error(`[update_bpsarchives] ${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = {
    manifestPath: null,
    targetName: null,
    addArchive: null,
    calculateIpfs: false,
    updateFromArdrive: false,
    ardriveDriveId: DEFAULT_BPS_DRIVE_ID,
    ardriveFolderId: DEFAULT_BPS_FOLDER_ID,
    baddr: null,
    setBaddr: false
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
      options.targetName = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--target=')) {
      options.targetName = arg.substring('--target='.length);
    } else if (arg === '--add-archive') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --add-archive');
      }
      options.addArchive = argv[i + 1];
      console.log(`add-archive: ${options.addArchive}`)
      i += 1;
    } else if (arg.startsWith('--add-archive=')) {
      options.addArchive = arg.substring('--add-archive='.length);
    } else if (arg === '--calculate-ipfs') {
      options.calculateIpfs = true;
    } else if (arg === '--update-from-ardrive') {
      options.updateFromArdrive = true;
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
    } else if (arg.startsWith('--baddr=')) {
      options.baddr = arg.substring('--baddr='.length)
      options.setBaddr = true
    } else if (arg.startsWith('--')) {
      exitWithError(`Unrecognized option "${arg}". Use --help for usage information.`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length === 0) {
    exitWithError('Missing manifest path argument.');
  }

  options.manifestPath = positional.shift();

  if (!options.addArchive && !options.calculateIpfs && !options.updateFromArdrive && !options.setBaddr) {
    exitWithError('No action requested. Use --add-archive, --calculate-ipfs, and/or --update-from-ardrive.');
  }

  if (options.addArchive && !options.targetName) {
    // Infer target name from filename
    options.targetName = path.basename(options.addArchive);
  }

  if (!options.targetName && (options.calculateIpfs || options.updateFromArdrive || options.setBaddr)) {
    exitWithError('--target is required when using --calculate-ipfs or --update-from-ardrive.');
  }

  return options;
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    // Create empty manifest if it doesn't exist
    return {};
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

function computeSha256(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function collectArchiveMetadata(filePath) {
  if (!fs.existsSync(filePath)) {
    exitWithError(`Archive file "${filePath}" does not exist.`);
  }
  if (!fs.statSync(filePath).isFile()) {
    exitWithError(`Archive path "${filePath}" is not a regular file.`);
  }

  const buffer = fs.readFileSync(filePath);
  //const sha256 = computeSha256(buffer);
  const sha256 = computeSha256(filePath);
  const ipfsCid = await ipfsOnlyHash(buffer, {
    cidVersion: 1,
    rawLeaves: true,
    hashAlg: 'sha2-256',
    wrapWithDirectory: false,
  });
  const sizeBytes = buffer.length;
  const fileName = path.basename(filePath);

  // Determine type based on filename
  let type = 'bpsarchive';
  if (fileName === 'rhsearch_cat.db.7z' || fileName === 'rhsearch_cat.db') {
    type = 'catalogdb';
  } else if (fileName === 'rhsearch.zip') {
    type = 'catalog';
  } else if (fileName.startsWith('bps_') && fileName.endsWith('.7z')) {
    type = 'bpsarchive';
    // Extract sha1prefixes from filename (e.g., bps_4c.7z -> "4c:4c")
    const prefixMatch = fileName.match(/^bps_([0-9a-f]{2})\.7z$/i);
    if (prefixMatch) {
      const prefix = prefixMatch[1].toLowerCase();
      // For now, set range as prefix:prefix (can be expanded later)
      // sha1prefixes = "4c:4c" means files starting with 4c
    }
  }

  return {
    file_name: fileName,
    format: fileName.endsWith('.7z') ? '7z' : (fileName.endsWith('.zip') ? 'zip' : null),
    sha256,
    ipfs_cidv1: ipfsCid,
    size: sizeBytes.toString(),
    priority: ['baddr', 'ipfs', 'ardrive'],
  };
}

async function loadArdriveClient() {
  const arweave = require('arweave');
  const arDriveCore = require('ardrive-core-js');

  const arweaveUrl = new URL('https://arweave.net:443');
  const arweaveClient = arweave.init({
    host: arweaveUrl.hostname,
    protocol: arweaveUrl.protocol.replace(':', ''),
    port: arweaveUrl.port || 443,
    timeout: 600000,
  });

  return arDriveCore.arDriveAnonymousFactory({ arweave: arweaveClient });
}

async function fetchArdriveFileIndex(folderId) {
  const arDrive = await loadArdriveClient();
  const arDriveCore = require('ardrive-core-js');
  const folderEid = arDriveCore.EID(folderId);
  const items = await arDrive.listPublicFolder({ folderId: folderEid, maxDepth: 10 });
  const files = items.filter((item) => item.entityType === 'file');
  const index = new Map();
  for (const file of files) {
    index.set(file.name, file);
  }
  return index;
}

function needsArdriveMetadata(entry) {
  return (
    !entry.ardrive_file_id ||
    !entry.ardrive_file_name ||
    !entry.ardrive_file_path ||
    !entry.data_txid ||
    !entry.metadata_txid
  );
}

function applyArdriveMetadata(entry, file) {
  if (!file) {
    return false;
  }

  let changed = false;

  const assignments = {
    ardrive_file_name: file.name,
    ardrive_file_path: file.path || entry.ardrive_file_path,
    ardrive_file_id: file.entityId || file.id || entry.ardrive_file_id,
    data_txid: file.dataTxId || file.dataTxID || entry.data_txid,
    metadata_txid: file.manifestTxId || file.metadataTxId || entry.metadata_txid,
    ardrive_drive_id: entry.ardrive_drive_id || DEFAULT_BPS_DRIVE_ID,
    ardrive_folder_id: entry.ardrive_folder_id || DEFAULT_BPS_FOLDER_ID,
  };

  Object.entries(assignments).forEach(([key, value]) => {
    if (value && entry[key] !== value) {
      entry[key] = value;
      changed = true;
    }
  });

  return changed;
}

async function updateFromArdrive(manifest, targetName, driveId, folderId) {
  const index = await fetchArdriveFileIndex(folderId);
  let updated = 0;

  const entry = manifest[targetName];
  if (!entry) {
    exitWithError(`Target "${targetName}" not found in manifest.`);
  }

  // Update base entry
  if (entry.base) {
    if (needsArdriveMetadata(entry.base)) {
      const file = index.get(entry.base.file_name);
      if (file) {
        if (applyArdriveMetadata(entry.base, file)) {
          updated += 1;
          console.log(`[update_bpsarchives] Updated base entry for "${entry.base.file_name}"`);
        }
      } else {
        console.warn(
          `[update_bpsarchives] ArDrive file not found for base "${entry.base.file_name}". Searched in folder ${folderId}`
        );
      }
    }
  }

  // Update additional entries
  if (entry.additional && Array.isArray(entry.additional)) {
    for (const addEntry of entry.additional) {
      if (needsArdriveMetadata(addEntry)) {
        const file = index.get(addEntry.file_name);
        if (file) {
          if (applyArdriveMetadata(addEntry, file)) {
            updated += 1;
            console.log(`[update_bpsarchives] Updated additional entry for "${addEntry.file_name}"`);
          }
        } else {
          console.warn(
            `[update_bpsarchives] ArDrive file not found for additional "${addEntry.file_name}"`
          );
        }
      }
    }
  }

  return updated;
}

async function addArchiveEntry(manifest, targetName, filePath) {
  const metadata = await collectArchiveMetadata(filePath);
  
  // Determine type
  let type = 'bpsarchive';
  if (targetName === 'rhsearch_cat.db' || targetName === 'rhsearch_cat.db.7z') {
    type = 'catalogdb';
  } else if (targetName === 'rhsearch.zip') {
    type = 'catalog';
  } else if (targetName.startsWith('bps_') && targetName.endsWith('.7z')) {
    type = 'bpsarchive';
    // Extract sha1prefixes from filename
    const prefixMatch = targetName.match(/^bps_([0-9a-f]{2})\.7z$/i);
    if (prefixMatch) {
      const prefix = prefixMatch[1].toLowerCase();
      metadata.sha1prefixes = `${prefix}:${prefix}`;
    }
  }

  // Create or update manifest entry
  if (!manifest[targetName]) {
    manifest[targetName] = {
      type: type,
      version: '1',
      base: metadata,
    };
    console.log(`[update_bpsarchives] Added new entry "${targetName}"`);
    return { added: true };
  } else {
    // Update existing entry
    manifest[targetName].base = { ...manifest[targetName].base, ...metadata };
    console.log(`[update_bpsarchives] Updated entry "${targetName}"`);
    return { added: false };
  }
}


//          const setct = await setBaddr(manifest, options.targetName, options.baddr);
async function setBaddr(manifest, targetName, newBaddr) {
  const entry = manifest[targetName];
  if (!entry || !entry.base) {
    exitWithError(`Target "${targetName}" not found in manifest.`);
  }

  entry.base['baddr'] = newBaddr
  return 1;
}


async function calculateIpfsForEntries(manifest, targetName) {
  let calculated = 0;
  
  const entry = manifest[targetName];
  if (!entry) {
    exitWithError(`Target "${targetName}" not found in manifest.`);
  }

  // Calculate for base
  if (entry.base && !entry.base.ipfs_cidv1) {
    // Need file path to calculate IPFS CID
    // For now, skip if we don't have the file locally
    console.warn(`[update_bpsarchives] Cannot calculate IPFS CID for "${entry.base.file_name}" without local file.`);
  }

  // Calculate for additional entries
  if (entry.additional && Array.isArray(entry.additional)) {
    for (const addEntry of entry.additional) {
      if (!addEntry.ipfs_cidv1) {
        console.warn(`[update_bpsarchives] Cannot calculate IPFS CID for "${addEntry.file_name}" without local file.`);
      }
    }
  }

  return calculated;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = readManifest(options.manifestPath);

  let totalAdded = 0;
  let totalUpdated = 0;

  if (options.addArchive) {
    const { added } = await addArchiveEntry(manifest, options.targetName, options.addArchive);
    if (added) {
      totalAdded += 1;
    } else {
      totalUpdated += 1;
    }
  }

  if (options.calculateIpfs) {
    const calculated = await calculateIpfsForEntries(manifest, options.targetName);
    totalUpdated += calculated;
  }

  if (options.setBaddr) {
	  const setct = await setBaddr(manifest, options.targetName, options.baddr);
	  totalUpdated += setct
  }

  if (options.updateFromArdrive) {
    const updated = await updateFromArdrive(manifest, options.targetName, options.ardriveDriveId, options.ardriveFolderId);
    totalUpdated += updated;
  }

  writeManifest(options.manifestPath, manifest);

  console.log('[update_bpsarchives] Completed manifest update.');
  if (totalAdded > 0) {
    console.log(`  Added entries: ${totalAdded}`);
  }
  if (totalUpdated > 0) {
    console.log(`  Updated existing entries: ${totalUpdated}`);
  }
  if (totalAdded === 0 && totalUpdated === 0) {
    console.log('  No changes applied.');
  }
}

main().catch((err) => {
  console.error('[update_bpsarchives] Fatal error:', err);
  process.exit(1);
});
