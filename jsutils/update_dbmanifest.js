#!/usr/bin/env node

/**
 * Update dbmanifest.json metadata for patchbin distribution artifacts.
 *
 * Usage:
 *   update_dbmanifest.js <manifest.json> [options]
 *
 * Options:
 *   --target <dbfile>                Target database entry in manifest (default: basename of --target path or PATCHBIN_DB_PATH env)
 *   --add-sqlpatches <files...>      Append or refresh SQL patch metadata for the given compressed files
 *   --update-from-ardrive            Populate missing ArDrive metadata from the configured public folder
 *   --patchbin-db <path>             Explicit patchbin database path (env PATCHBIN_DB_PATH fallback)
 *   --help                           Show usage information
 *
 * Examples:
 *   update_dbmanifest.js dbmanifest.json --target patchbin.db \
 *     --add-sqlpatches readd_output/*.sql.xz
 *
 *   update_dbmanifest.js dbmanifest.json --target patchbin.db \
 *     --update-from-ardrive
 *
 * Notes:
 *   - IPFS CIDv1 hashes are calculated using ipfs-only-hash (no upload required).
 *   - ArDrive metadata is discovered via anonymous access to the public drive/folder.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { of: ipfsOnlyHash } = require('ipfs-only-hash');

const DEFAULT_DRIVE_ID = '58677413-8a0c-4982-944d-4a1b40454039';
const DEFAULT_PATCH_FOLDER_ID = '1e42b095-4fbf-4411-bcc9-688917d5a5af';
const DEFAULT_TARGET_DB = process.env.PATCHBIN_DB_PATH ? path.basename(process.env.PATCHBIN_DB_PATH) : 'patchbin.db';

const HELP_TEXT = `
Usage:
  update_dbmanifest.js <manifest.json> [options]

Options:
  --target <dbfile>             Manifest entry to update (defaults to PATCHBIN_DB_PATH basename or "patchbin.db")
  --patchbin-db <path>          Explicit patchbin database path (optional sanity check)
  --add-sqlpatches <files...>   Add or refresh SQL patch entries for the provided compressed files
  --update-from-ardrive         Populate missing ArDrive metadata for existing manifest entries
  --help                        Show this help message

Environment overrides:
  PATCHBIN_DB_PATH              Provides default for --patchbin-db and target name when not explicitly supplied
`.trim();

function exitWithError(message) {
  console.error(`[update_dbmanifest] ${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  const options = {
    manifestPath: null,
    targetName: DEFAULT_TARGET_DB,
    patchbinDbPath: process.env.PATCHBIN_DB_PATH || null,
    addSqlPatches: [],
    updateFromArdrive: false,
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
    } else if (arg === '--patchbin-db') {
      if (i + 1 >= argv.length) {
        exitWithError('Expected value after --patchbin-db');
      }
      options.patchbinDbPath = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--patchbin-db=')) {
      options.patchbinDbPath = arg.substring('--patchbin-db='.length);
    } else if (arg === '--add-sqlpatches') {
      const files = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        files.push(argv[i + 1]);
        i += 1;
      }
      if (files.length === 0) {
        exitWithError('No files provided after --add-sqlpatches');
      }
      options.addSqlPatches.push(...files);
    } else if (arg.startsWith('--add-sqlpatches=')) {
      const list = arg.substring('--add-sqlpatches='.length);
      options.addSqlPatches.push(...list.split(',').map((item) => item.trim()).filter(Boolean));
    } else if (arg === '--update-from-ardrive') {
      options.updateFromArdrive = true;
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

  if (!options.targetName && options.patchbinDbPath) {
    options.targetName = path.basename(options.patchbinDbPath);
  }

  if (!options.targetName) {
    exitWithError('Unable to determine target name. Provide --target or set PATCHBIN_DB_PATH.');
  }

  if (!options.updateFromArdrive && options.addSqlPatches.length === 0) {
    exitWithError('No action requested. Use --add-sqlpatches and/or --update-from-ardrive.');
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

function ensureTarget(manifest, targetName) {
  if (!Object.prototype.hasOwnProperty.call(manifest, targetName)) {
    exitWithError(`Target "${targetName}" not found in manifest.`);
  }
  const entry = manifest[targetName];
  if (!entry.sqlpatches) {
    entry.sqlpatches = [];
  } else if (!Array.isArray(entry.sqlpatches)) {
    exitWithError(`Manifest target "${targetName}" has invalid "sqlpatches" structure (expected array).`);
  }
  return entry;
}

function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function collectSqlPatchMetadata(filePath) {
  if (!fs.existsSync(filePath)) {
    exitWithError(`SQL patch file "${filePath}" does not exist.`);
  }
  if (!fs.statSync(filePath).isFile()) {
    exitWithError(`SQL patch path "${filePath}" is not a regular file.`);
  }

  const buffer = fs.readFileSync(filePath);
  const sha256 = computeSha256(buffer);
  const ipfsCid = await ipfsOnlyHash(buffer, {
    cidVersion: 1,
    rawLeaves: true,
    hashAlg: 'sha2-256',
    wrapWithDirectory: false,
  });
  const sizeBytes = buffer.length;

  return {
    file_name: path.basename(filePath),
    format: 'xz',
    type: 'sql',
    sha256,
    ipfs_cidv1: ipfsCid,
    size: sizeBytes.toString(),
  };
}

function mergePatchMetadata(existing, metadata) {
  const merged = { ...existing };
  Object.entries(metadata).forEach(([key, value]) => {
    merged[key] = value;
  });
  return merged;
}

async function addSqlPatchEntries(entry, filePaths) {
  if (filePaths.length === 0) {
    return { added: 0, updated: 0 };
  }

  const currentByName = new Map(entry.sqlpatches.map((patch) => [patch.file_name, patch]));
  let added = 0;
  let updated = 0;

  for (const filePath of filePaths) {
    const metadata = await collectSqlPatchMetadata(filePath);
    const current = currentByName.get(metadata.file_name);

    if (current) {
      const merged = mergePatchMetadata(current, metadata);
      currentByName.set(metadata.file_name, merged);
      updated += 1;
    } else {
      currentByName.set(metadata.file_name, metadata);
      added += 1;
    }
  }

  entry.sqlpatches = Array.from(currentByName.values()).sort((a, b) =>
    a.file_name.localeCompare(b.file_name, 'en', { sensitivity: 'base' })
  );

  return { added, updated };
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

function needsArdriveMetadata(patch) {
  return (
    !patch.ardrive_file_id ||
    !patch.ardrive_file_name ||
    !patch.ardrive_file_path ||
    !patch.data_txid ||
    !patch.metadata_txid
  );
}

function applyArdriveMetadata(patch, file) {
  if (!file) {
    return false;
  }

  let changed = false;

  const assignments = {
    ardrive_file_name: file.name,
    ardrive_file_path: file.path || patch.ardrive_file_path,
    ardrive_file_id: file.entityId || file.id || patch.ardrive_file_id,
    data_txid: file.dataTxId || file.dataTxID || patch.data_txid,
    metadata_txid: file.manifestTxId || file.metadataTxId || patch.metadata_txid,
    ardrive_drive_id: patch.ardrive_drive_id || DEFAULT_DRIVE_ID,
    ardrive_folder_id: patch.ardrive_folder_id || DEFAULT_PATCH_FOLDER_ID,
  };

  Object.entries(assignments).forEach(([key, value]) => {
    if (value && patch[key] !== value) {
      patch[key] = value;
      changed = true;
    }
  });

  return changed;
}

async function updateFromArdrive(entry) {
  const index = await fetchArdriveFileIndex(DEFAULT_PATCH_FOLDER_ID);
  let updated = 0;

  for (const patch of entry.sqlpatches) {
    if (!needsArdriveMetadata(patch)) {
      continue;
    }

    const file = index.get(patch.file_name);
    if (!file) {
      console.warn(
        `[update_dbmanifest] ArDrive file not found for "${patch.file_name}". Skipping metadata update.`
      );
      continue;
    }

    if (applyArdriveMetadata(patch, file)) {
      updated += 1;
    }
  }

  return updated;
}

function writeManifest(manifestPath, manifest) {
  const output = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(manifestPath, output, 'utf8');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = readManifest(options.manifestPath);

  if (options.patchbinDbPath && !fs.existsSync(options.patchbinDbPath)) {
    console.warn(
      `[update_dbmanifest] Warning: --patchbin-db path "${options.patchbinDbPath}" does not exist.`
    );
  }

  const entry = ensureTarget(manifest, options.targetName);

  let totalAdded = 0;
  let totalUpdated = 0;

  if (options.addSqlPatches.length > 0) {
    const { added, updated } = await addSqlPatchEntries(entry, options.addSqlPatches);
    totalAdded += added;
    totalUpdated += updated;
  }

  if (options.updateFromArdrive) {
    const updated = await updateFromArdrive(entry);
    totalUpdated += updated;
  }

  writeManifest(options.manifestPath, manifest);

  console.log('[update_dbmanifest] Completed manifest update.');
  if (totalAdded > 0) {
    console.log(`  Added SQL patches: ${totalAdded}`);
  }
  if (totalUpdated > 0) {
    console.log(`  Updated existing entries: ${totalUpdated}`);
  }
  if (totalAdded === 0 && totalUpdated === 0) {
    console.log('  No changes applied.');
  }
}

main().catch((err) => {
  console.error('[update_dbmanifest] Fatal error:', err);
  process.exit(1);
});

