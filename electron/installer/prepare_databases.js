#!/usr/bin/env node

/**
 * prepare_databases.js
 *
 * Utility invoked by graphical installers to plan and execute database
 * provisioning based on electron/dbmanifest.json. The script can generate a
 * plan only, or perform the full workflow: download archives (IPFS first,
 * ArDrive/Arweave fallback), extract base databases, apply SQL patches, and
 * move finished databases into the application settings directory.
 *
 * Usage:
 *   prepare_databases.js [options]
 *
 * Options:
 *   --manifest <path>         Path to dbmanifest.json (default: electron/dbmanifest.json)
 *   --user-data-dir <path>    Override detected app settings directory
 *   --working-dir <path>      Override temporary working directory
 *   --overwrite <names>       Comma-separated list of databases to overwrite (default: none)
 *   --ensure-dirs             Create user data + working directories if missing
 *   --provision               Execute provisioning workflow based on manifest
 *   --write-plan <file>       Write JSON plan to file in addition to stdout
 *   --help                    Show usage information
 *
 * Databases handled: clientdata.db, rhdata.db, patchbin.db, screenshot.db, resource.db
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');
const lzma = require('lzma-native');
const tar = require('tar');
const Database = require('better-sqlite3');
const ipfsFetchConfig = require('../utils/ipfs-fetch-config');
const arweaveFetchConfig = require('../utils/arweave-fetch-config');
const {
  parseDbChainArg,
  resolveChainView,
  chainToStoreValue,
  formatChainLabel
} = require('../utils/manifest-chain');
const provisionBundle = require('../../lib/provision-bundle');
const { isBundleSpec } = provisionBundle;
const { maybeMigrateArtifacts } = require('../../lib/migrate-artifacts');

const DATABASES = [
  { name: 'clientdata.db', manifestKey: 'clientdata.db', embedded: true },
  { name: 'rhdata.db', manifestKey: 'rhdata.db', embedded: false },
  { name: 'patchbin.db', manifestKey: 'patchbin.db', embedded: false },
  { name: 'resource.db', manifestKey: 'resource.db', embedded: false },
  { name: 'screenshot.db', manifestKey: 'screenshot.db', embedded: false},
];

const HELP_TEXT = `
Usage:
  prepare_databases.js [options]

Options:
  --manifest <path>         Path to dbmanifest.json (default: electron/dbmanifest.json)
  --user-data-dir <path>    Override detected app settings directory
  --working-dir <path>      Override temporary working directory
  --overwrite <names>       Comma-separated list of databases to overwrite (default: none)
  --ensure-dirs             Create the user data and working directories if they do not exist
  --provision               Execute provisioning workflow (download/apply/copy)
  --write-plan <file>       Write action plan JSON to the specified file
  --verify-links            Verify all download sources (developer tool)
  --verify-build            Verify build process for all targets (developer tool)
  --target <name>           Limit verification to specific target (e.g., rhdata.db)
  --ipfs-timeout <seconds>  Timeout for IPFS downloads in seconds (default: 20)
  --update-mode             Run in-place database update (apply patches from plan)
  --update-plan <file>      JSON file with updates to apply (required with --update-mode)
  --update-result-path <f>  Write per-db update results JSON (used with --update-mode)
  --db-chain <full|light>   Provisioning chain: full (default) or light (uses base:light when configured, else shared base/sqlpatches)
  --lightdb                 Alias for --db-chain light
  --help                    Show this help message

Examples:
  prepare_databases.js
  prepare_databases.js --overwrite rhdata.db,patchbin.db --ensure-dirs
  prepare_databases.js --verify-links --target=rhdata.db
  prepare_databases.js --verify-build
`.trim();

let progressLogStream = null;
let progressDonePath = null;
let progressLoggingInitialized = false;
let savedConsoleLog = null;
let savedConsoleError = null;

function initProgressLogging(opts) {
  if (progressLoggingInitialized) {
    return;
  }
  progressLoggingInitialized = true;

  if (opts.progressLogPath) {
    const resolved = path.resolve(opts.progressLogPath);
    ensureDirectory(path.dirname(resolved));
    progressLogStream = fs.createWriteStream(resolved, { flags: 'a' });
  }

  if (opts.progressDonePath) {
    progressDonePath = path.resolve(opts.progressDonePath);
    ensureDirectory(path.dirname(progressDonePath));
  }

  savedConsoleLog = console.log.bind(console);
  savedConsoleError = console.error.bind(console);

  console.log = (...args) => {
    const message = args.join(' ');
    if (progressLogStream) {
      progressLogStream.write(`${message}\n`);
    }
    savedConsoleLog(...args);
  };

  console.error = (...args) => {
    const message = args.join(' ');
    if (progressLogStream) {
      progressLogStream.write(`[error] ${message}\n`);
    }
    savedConsoleError(...args);
  };
}

function finalizeProgress(success) {
  if (progressLogStream) {
    progressLogStream.end();
    progressLogStream = null;
  }
  if (progressDonePath) {
    try {
      fs.writeFileSync(
        progressDonePath,
        JSON.stringify({ success, timestamp: new Date().toISOString() }, null, 2)
      );
    } catch (err) {
      // ignore fs errors on finalize
    }
    progressDonePath = null;
  }
  if (savedConsoleLog && savedConsoleError) {
    console.log = savedConsoleLog;
    console.error = savedConsoleError;
    savedConsoleLog = null;
    savedConsoleError = null;
  }
  progressLoggingInitialized = false;
}

function exitWithError(message) {
  if (progressLoggingInitialized) {
    finalizeProgress(false);
  }
  if (process.env.RHPLAY_PREPARE_DB_THROW === '1') {
    throw new Error(message);
  }
  const errorPayload = { success: false, error: message };
  console.error(JSON.stringify(errorPayload));
  process.stdout.write(JSON.stringify(errorPayload));
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {
    manifestPath: null,
    userDataDir: null,
    workingDir: null,
    overwrite: new Set(),
    ensureDirs: false,
    provision: false,
    writePlanPath: null,
    writeSummaryPath: null,
    progressLogPath: null,
    progressDonePath: null,
    verifyLinks: false,
    verifyBuild: false,
    target: null,
    ipfsTimeout: 20, // Default 20 seconds for IPFS downloads
    updateMode: false,
    updatePlanPath: null,
    updateResultPath: null,
    dbChain: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      console.log(HELP_TEXT);
      process.exit(0);
    } else if (arg === '--manifest') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --manifest');
      opts.manifestPath = argv[++i];
    } else if (arg.startsWith('--manifest=')) {
      opts.manifestPath = arg.substring('--manifest='.length);
    } else if (arg === '--user-data-dir') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --user-data-dir');
      opts.userDataDir = path.resolve(argv[++i]);
    } else if (arg.startsWith('--user-data-dir=')) {
      opts.userDataDir = path.resolve(arg.substring('--user-data-dir='.length));
    } else if (arg === '--working-dir') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --working-dir');
      opts.workingDir = path.resolve(argv[++i]);
    } else if (arg.startsWith('--working-dir=')) {
      opts.workingDir = path.resolve(arg.substring('--working-dir='.length));
    } else if (arg === '--overwrite') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --overwrite');
      parseOverwriteList(opts.overwrite, argv[++i]);
    } else if (arg.startsWith('--overwrite=')) {
      parseOverwriteList(opts.overwrite, arg.substring('--overwrite='.length));
    } else if (arg === '--ensure-dirs') {
      opts.ensureDirs = true;
    } else if (arg === '--provision') {
      opts.provision = true;
    } else if (arg === '--write-plan') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --write-plan');
      opts.writePlanPath = path.resolve(argv[++i]);
    } else if (arg.startsWith('--write-plan=')) {
      opts.writePlanPath = path.resolve(arg.substring('--write-plan='.length));
    } else if (arg === '--write-summary') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --write-summary');
      opts.writeSummaryPath = path.resolve(argv[++i]);
    } else if (arg.startsWith('--write-summary=')) {
      opts.writeSummaryPath = path.resolve(arg.substring('--write-summary='.length));
    } else if (arg === '--progress-log') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --progress-log');
      opts.progressLogPath = argv[++i];
    } else if (arg.startsWith('--progress-log=')) {
      opts.progressLogPath = arg.substring('--progress-log='.length);
    } else if (arg === '--progress-done') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --progress-done');
      opts.progressDonePath = argv[++i];
    } else if (arg.startsWith('--progress-done=')) {
      opts.progressDonePath = arg.substring('--progress-done='.length);
    } else if (arg === '--verify-links') {
      opts.verifyLinks = true;
    } else if (arg === '--verify-build') {
      opts.verifyBuild = true;
    } else if (arg === '--target') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --target');
      opts.target = argv[++i];
    } else if (arg.startsWith('--target=')) {
      opts.target = arg.substring('--target='.length);
    } else if (arg === '--ipfs-timeout') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --ipfs-timeout');
      const timeoutValue = parseInt(argv[++i], 10);
      if (isNaN(timeoutValue) || timeoutValue <= 0) {
        exitWithError('--ipfs-timeout must be a positive number (seconds)');
      }
      opts.ipfsTimeout = timeoutValue;
    } else if (arg.startsWith('--ipfs-timeout=')) {
      const timeoutValue = parseInt(arg.substring('--ipfs-timeout='.length), 10);
      if (isNaN(timeoutValue) || timeoutValue <= 0) {
        exitWithError('--ipfs-timeout must be a positive number (seconds)');
      }
      opts.ipfsTimeout = timeoutValue;
    } else if (arg === '--update-mode') {
      opts.updateMode = true;
    } else if (arg === '--update-plan') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --update-plan');
      opts.updatePlanPath = path.resolve(argv[++i]);
    } else if (arg === '--update-result-path') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --update-result-path');
      opts.updateResultPath = path.resolve(argv[++i]);
    } else if (arg.startsWith('--update-plan=')) {
      opts.updatePlanPath = path.resolve(arg.substring('--update-plan='.length));
    } else if (arg.startsWith('--update-result-path=')) {
      opts.updateResultPath = path.resolve(arg.substring('--update-result-path='.length));
    } else if (arg === '--db-chain') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --db-chain');
      opts.dbChain = parseDbChainArg(argv[++i]);
    } else if (arg.startsWith('--db-chain=')) {
      opts.dbChain = parseDbChainArg(arg.substring('--db-chain='.length));
    } else if (arg === '--lightdb') {
      opts.dbChain = parseDbChainArg('light');
    } else if (arg.startsWith('--')) {
      exitWithError(`Unknown option "${arg}". Use --help for usage details.`);
    } else {
      exitWithError(`Unexpected positional argument "${arg}". Use --help for usage.`);
    }
  }

  return opts;
}

function parseOverwriteList(set, csv) {
  csv
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => set.add(item));
}

function detectUserDataDir() {
  const platform = process.platform;
  const name = 'rhtools';
  if (platform === 'win32') {
    const base =
      process.env.APPDATA ||
      path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, name);
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', name);
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, name);
}

function defaultWorkingDir(userDataDir) {
  const platform = process.platform;
  if (platform === 'win32') {
    const base =
      process.env.LOCALAPPDATA ||
      path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'RHTools', 'InstallerTemp');
  }
  if (platform === 'darwin') {
    return path.join(userDataDir, 'InstallerTemp');
  }
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'rhtools-installer');
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    exitWithError(`Manifest not found at "${manifestPath}".`);
  }
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    exitWithError(`Failed to parse manifest JSON: ${err.message}`);
  }
}

function normalizeWorkingPaths(plan) {
  if (!fs.existsSync(plan.workingDir)) {
    fs.mkdirSync(plan.workingDir, { recursive: true });
  }
  return {
    downloadsDir: plan.workingDir,
    stagingDir: path.join(plan.workingDir, 'staging'),
  };
}

/**
 * Get search paths for local file discovery
 * Searches: working directory, executable directory, OS Downloads folder
 */
function getSearchPaths(userDataDir, workingDir) {
  const paths = [workingDir]; // Current downloads directory (highest priority)

  // Executable directory (for portable apps)
  if (process.resourcesPath) {
    // In packaged app, executable is typically one level up from resourcesPath
    const execDir = path.dirname(process.execPath);
    paths.push(execDir);
  } else {
    // Development mode: use __dirname
    paths.push(path.dirname(__dirname));
    // Also include packed_db directory for files with source_path
    paths.push(path.resolve(__dirname, '..', 'packed_db'));
  }

  // OS Downloads directory
  const platform = process.platform;
  if (platform === 'win32') {
    paths.push(path.join(os.homedir(), 'Downloads'));
  } else if (platform === 'darwin') {
    paths.push(path.join(os.homedir(), 'Downloads'));
  } else {
    // Linux
    const xdgDownload = process.env.XDG_DOWNLOAD_DIR;
    if (xdgDownload) {
      paths.push(xdgDownload);
    }
    paths.push(path.join(os.homedir(), 'Downloads'));
  }

  return paths.filter((p) => p && fs.existsSync(path.dirname(p)));
}

/**
 * Check if file matches criteria (extension, size, SHA256)
 * Checks are performed in order: extension (fastest), size (fast), SHA256 (slowest but definitive)
 * SHA256 is REQUIRED - files without matching hash are rejected
 */
function matchesFileCriteria(filePath, criteria) {
  // SHA256 is required
  if (!criteria.sha256) {
    return false;
  }

  const stats = fs.statSync(filePath);

  // Step 1: Check extension (fastest check)
  if (criteria.extension) {
    const fileExt = path.extname(filePath);
    if (fileExt.toLowerCase() !== criteria.extension.toLowerCase()) {
      return false;
    }
  }

  // Step 2: Check size (fast check, exact match required)
  // Size is the exact size of the compressed archive in bytes
  if (criteria.size !== null && criteria.size !== undefined) {
    if (stats.size !== criteria.size) {
      return false;
    }
  }

  // Step 3: Check SHA256 hash (slowest but definitive verification)
  // This is the final and required check
  const actualHash = sha256File(filePath);
  if (actualHash !== criteria.sha256) {
    return false;
  }

  return true;
}

/**
 * Recursively search for file matching criteria in a directory
 */
function findFileInDirectory(dir, criteria) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip symlinks to avoid loops
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        // Recursively search subdirectories
        const found = findFileInDirectory(fullPath, criteria);
        if (found) {
          return found;
        }
      } else if (entry.isFile()) {
        // Check if file matches
        if (matchesFileCriteria(fullPath, criteria)) {
          return fullPath;
        }
      }
    }
  } catch (err) {
    // Skip directories we can't read
    return null;
  }

  return null;
}

/**
 * Search for a file matching the spec in multiple locations
 * SHA256 hash is REQUIRED for file matching - files without matching hash are rejected
 * @param {Object} spec - File specification from manifest (base or patch)
 * @param {Array<string>} searchPaths - Array of directory paths to search
 * @returns {string|null} - Path to found file, or null if not found
 */
function searchLocalFile(spec, searchPaths) {
  const fileName = spec.file_name;
  const expectedExt = path.extname(fileName);
  const expectedSize = spec.size ? parseInt(spec.size, 10) : null;
  const expectedSha256 = spec.sha256;

  // SHA256 is required for file search
  if (!expectedSha256) {
    console.warn(`[search-local] ${fileName}: SHA256 not provided in manifest, skipping local search`);
    return null;
  }

  for (const searchDir of searchPaths) {
    if (!fs.existsSync(searchDir)) {
      continue;
    }

    // Search recursively in directory
    const found = findFileInDirectory(searchDir, {
      extension: expectedExt,
      size: expectedSize,
      sha256: expectedSha256,
    });

    if (found) {
      return found;
    }
  }

  return null;
}

function sha256File(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (err) {
    return null;
  }
}

/**
 * Compute SHA256 hash of provisioned.json data (excluding hashdata section)
 */
function computeProvisionedHash(data) {
  // Create copy without hashdata
  const { hashdata, ...dataWithoutHash } = data;
  // Minify JSON
  const jsonString = JSON.stringify(dataWithoutHash);
  console.log('HASH: '+jsonString )
  // Compute SHA256
  return crypto.createHash('sha256').update(jsonString, 'utf8').digest('hex');
}

/**
 * Load provisioned.json from userDataDir
 */
function loadProvisionedJson(userDataDir) {
  const filePath = path.join(userDataDir, 'provisioned.json');
  if (!fs.existsSync(filePath)) {
    return { targets: {}, hashdata: { sha256: null } };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);

    // Verify hash if present
    if (data.hashdata && data.hashdata.sha256) {
      const computedHash = computeProvisionedHash(data);
      if (computedHash !== data.hashdata.sha256) {
        console.warn('[provisioned.json] Hash verification failed, file may be corrupted');
        return { targets: {}, hashdata: { sha256: null } };
      }
    }

    return data;
  } catch (err) {
    console.warn(`[provisioned.json] Failed to load: ${err.message}`);
    return { targets: {}, hashdata: { sha256: null } };
  }
}

/**
 * Save provisioned.json to userDataDir
 */
function saveProvisionedJson(userDataDir, data) {
  // Compute hash
  const hash = computeProvisionedHash(data);
  data.hashdata = { sha256: hash };

  const filePath = path.join(userDataDir, 'provisioned.json');
  ensureDirectory(userDataDir);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Update provisioned.json entry for a database
 */
function updateProvisionedEntry(userDataDir, dbName, version, baseSha256, lastPatchSha256, lastPatchFileName, storeChain = undefined) {
  const provisioned = loadProvisionedJson(userDataDir);
  const existing = provisioned.targets[dbName];
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const entry = {
    version: String(version ?? '0'),
    timestamp,
    patch: lastPatchFileName || null,
    base_sha256: baseSha256,
    patch_sha256: lastPatchSha256 || null,
  };

  let chainToWrite = storeChain;
  if (chainToWrite === undefined) {
    chainToWrite = chainToStoreValue(null, existing);
  }
  if (chainToWrite === 'light' || chainToWrite === 'full') {
    entry.chain = chainToWrite;
  }

  provisioned.targets[dbName] = entry;
  saveProvisionedJson(userDataDir, provisioned);
}

function inspectDatabases(opts, manifest) {
  const userDataDir = opts.userDataDir;
  const provisioned = loadProvisionedJson(userDataDir);
  const results = [];

  // Check regular databases
  for (const db of DATABASES) {
    const filePath = path.join(userDataDir, db.name);
    const exists = fs.existsSync(filePath);
    const shouldOverwrite = opts.overwrite.has(db.name);
    const manifestEntry = manifest[db.manifestKey];
    const provisionedEntry = provisioned.targets && provisioned.targets[db.name];
    let chainView = null;
    if (manifestEntry) {
      try {
        chainView = resolveChainView(manifestEntry, {
          requestedChain: opts.dbChain,
          provisionedEntry
        });
      } catch (err) {
        chainView = { error: err.message };
      }
    }

    const details = {
      name: db.name,
      embedded: db.embedded,
      path: filePath,
      exists,
      overwrite: shouldOverwrite,
      action: null,
      sizeBytes: null,
      sha256: null,
      manifestAvailable: Boolean(manifestEntry),
      manifestSummary: summarizeChainView(chainView),
      dbChain: chainView && !chainView.error ? chainView.effectiveChain : null,
      chainLabel: chainView && !chainView.error ? formatChainLabel(chainView.storeChain ? chainView.effectiveChain : 'full-implicit') : null,
      chainError: chainView?.error || null,
    };

    if (exists) {
      const stats = fs.statSync(filePath);
      details.sizeBytes = stats.size;
      details.sha256 = sha256File(filePath);
    }

    if (!exists || shouldOverwrite) {
      details.action = db.embedded ? 'copy-embedded' : 'provision-from-manifest';
    } else {
      details.action = 'skip';
    }

    results.push(details);
  }

  // Check appfiles entries (pseudo-databases)
  for (const [targetKey, manifestEntry] of Object.entries(manifest)) {
    if (targetKey === 'greetings') continue;
    if (manifestEntry.type === 'appfiles') {
      const filePath = path.join(userDataDir, targetKey);
      const exists = fs.existsSync(filePath);
      const shouldOverwrite = opts.overwrite.has(targetKey);

      const details = {
        name: targetKey,
        embedded: false,
        path: filePath,
        exists,
        overwrite: shouldOverwrite,
        action: null,
        sizeBytes: null,
        sha256: null,
        manifestAvailable: true,
        manifestSummary: summarizeManifest(manifestEntry),
        type: 'appfiles',
      };

      if (exists) {
        const stats = fs.statSync(filePath);
        details.sizeBytes = stats.size;
        details.sha256 = sha256File(filePath);
      }

      if (!exists || shouldOverwrite) {
        details.action = 'provision-appfiles';
      } else {
        details.action = 'skip';
      }

      results.push(details);
    }
  }

  return results;
}

function summarizeChainView(chainView) {
  if (!chainView || chainView.error) return null;
  if (!chainView.base) return { chain: chainView.effectiveChain, version: chainView.version, patchCount: chainView.sqlpatches.length };
  return {
    chain: chainView.effectiveChain,
    version: chainView.version,
    base: {
      file_name: chainView.base.file_name,
      sha256: chainView.base.sha256,
      size: chainView.base.size,
      patchCount: chainView.sqlpatches.length,
    },
  };
}

function summarizeManifest(entry) {
  if (!entry) return null;
  const summary = {};
  if (entry.base) {
    summary.base = {
      file_name: entry.base.file_name,
      sha256: entry.base.sha256,
      size: entry.base.size,
      patchCount: Array.isArray(entry.sqlpatches) ? entry.sqlpatches.length : 0,
    };
  }
  return summary;
}

function buildPlan(opts, dbStatus) {
  const plan = {
    platform: process.platform,
    manifestPath: opts.manifestPath,
    userDataDir: opts.userDataDir,
    workingDir: opts.workingDir,
    ensureDirs: opts.ensureDirs,
    dbChain: opts.dbChain || null,
    databases: dbStatus,
    downloads: [],
    provision: opts.provision,
  };

  for (const db of dbStatus) {
    if (db.action === 'provision-from-manifest' && db.manifestSummary && db.manifestSummary.base) {
      const manifestEntryKey = DATABASES.find((d) => d.name === db.name)?.manifestKey;
      plan.downloads.push({
        database: db.name,
        manifestKey: manifestEntryKey,
      });
    } else if (db.action === 'provision-appfiles' && db.manifestSummary && db.manifestSummary.base) {
      // Appfiles entries use their target name as the manifest key
      plan.downloads.push({
        database: db.name,
        manifestKey: db.name,
      });
    }
  }

  return plan;
}

function writePlanIfRequested(plan, filePath) {
  if (!filePath) return;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(plan, null, 2));
}

function writeSummaryIfRequested(plan, filePath) {
  if (!filePath) return;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const lines = [];
  const provisionRequired = plan.databases.some((db) => db.action !== 'skip');
  lines.push(`PROVISION_REQUIRED=${provisionRequired ? 'yes' : 'no'}`);
  lines.push(`USER_DATA_DIR=${plan.userDataDir}`);
  lines.push(`WORKING_DIR=${plan.workingDir}`);
  lines.push(`MANIFEST=${plan.manifestPath}`);
  if (plan.dbChain) {
    lines.push(`DB_CHAIN=${plan.dbChain}`);
  }
  lines.push('');
  lines.push('DATABASES:');
  plan.databases.forEach((db) => {
    const summary = [
      `status=${db.action}`,
      `exists=${db.exists}`,
      `overwrite=${db.overwrite}`,
      `embedded=${db.embedded}`,
    ].join(', ');
    lines.push(`- ${db.name}: ${summary}`);
    if (db.manifestSummary && db.manifestSummary.base) {
      const base = db.manifestSummary.base;
      lines.push(`    base: ${base.file_name} (${base.size || 'unknown'} bytes)`);
      lines.push(`    patches: ${base.patchCount}`);
    }
  });
  if (plan.downloads.length > 0) {
    lines.push('');
    lines.push('DOWNLOADS_PENDING:');
    plan.downloads.forEach((dl) => {
      lines.push(`- ${dl.database}: ${dl.manifestKey}`);
    });
  }
  lines.push('');
  lines.push('ArDrive (manual download option): https://app.ardrive.io/#/drives/58677413-8a0c-4982-944d-4a1b40454039?name=SMWRH');
  fs.writeFileSync(filePath, lines.join('\n'));
}

function copyManifestToWorkingDir(manifestPath, workingDir) {
  const destPath = path.join(workingDir, 'dbmanifest.json');
  fs.copyFileSync(manifestPath, destPath);
  return destPath;
}

/**
 * Locate an embedded database seed file for a given database name.
 * Searches for both .xz compressed and uncompressed versions.
 * 
 * @param {string} dbName - Database filename (e.g., 'clientdata.db', 'screenshot.db')
 * @returns {string|null} - Path to the seed file, or null if not found
 */
function locateEmbeddedSeed(dbName) {
  const baseName = path.basename(dbName, '.db');
  const candidates = [
    path.resolve(__dirname, '..', 'packed_db', `${dbName}.initial.xz`),
    path.resolve(__dirname, '..', 'packed_db', `${baseName}.db.initial.xz`),
    path.resolve(__dirname, '..', 'db', dbName),
  ];

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'db', `${dbName}.initial.xz`));
    candidates.push(path.join(process.resourcesPath, 'db', `${baseName}.db.initial.xz`));
    candidates.push(path.join(process.resourcesPath, 'db', dbName));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'packed_db', `${dbName}.initial.xz`));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'packed_db', `${baseName}.db.initial.xz`));
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * Locate an embedded patch file based on source_path from manifest.
 * Searches in packed_db directory and app resources (similar to embedded seeds).
 * 
 * @param {string} sourcePath - Source path from manifest (e.g., 'packed_db/patchbin-schema-3-to-10.sql.xz')
 * @param {string} fileName - Expected filename (e.g., 'patchbin-schema-3-to-10.sql.xz')
 * @returns {string|null} - Path to the embedded patch file, or null if not found
 */
function locateEmbeddedPatch(sourcePath, fileName) {
  if (!sourcePath) {
    return null;
  }

  // Extract just the filename from source_path (e.g., 'packed_db/file.sql.xz' -> 'file.sql.xz')
  const sourceFileName = path.basename(sourcePath);
  
  // Build candidate paths similar to embedded seeds
  const candidates = [
    // Development mode: relative to electron/installer
    path.resolve(__dirname, '..', sourcePath),
    path.resolve(__dirname, '..', 'packed_db', sourceFileName),
    path.resolve(__dirname, '..', 'db', sourceFileName),
  ];

  if (process.resourcesPath) {
    // Packaged app: check in resources/db and unpacked locations
    candidates.push(path.join(process.resourcesPath, 'db', sourceFileName));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', sourcePath));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'packed_db', sourceFileName));
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * Stage an embedded database seed file to the user data directory.
 * Handles both compressed (.xz) and uncompressed database files.
 * 
 * @param {string} dbName - Database filename (e.g., 'clientdata.db', 'screenshot.db')
 * @param {string} userDataDir - Target user data directory
 * @param {boolean} overwrite - Whether to overwrite existing database
 * @returns {Promise<string>} - Path to the staged database file
 */
async function stageEmbeddedDb(dbName, userDataDir, overwrite = true) {
  ensureDirectory(userDataDir);

  const source = locateEmbeddedSeed(dbName);

  if (!source) {
    throw new Error(`Embedded ${dbName} seed not found in expected locations.`);
  }

  const destination = path.join(userDataDir, dbName);
  if (!overwrite && fs.existsSync(destination)) {
    return destination;
  }
  if (overwrite && fs.existsSync(destination)) {
    fs.unlinkSync(destination);
  }

  if (source.endsWith('.xz')) {
    const tempPath = `${destination}.tmp`;
    try {
      await decompressXz(source, tempPath);
      fs.renameSync(tempPath, destination);
    } catch (err) {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      throw err;
    }
  } else {
    fs.copyFileSync(source, destination);
  }

  return destination;
}

/**
 * @deprecated Use stageEmbeddedDb() instead
 * Legacy function for backward compatibility.
 */
function locateEmbeddedClientSeed() {
  return locateEmbeddedSeed('clientdata.db');
}

/**
 * @deprecated Use stageEmbeddedDb() instead
 * Legacy function for backward compatibility.
 */
async function stageEmbeddedClientDb(userDataDir, overwrite = true) {
  return stageEmbeddedDb('clientdata.db', userDataDir, overwrite);
}

/**
 * Decode base64-encoded URL
 * @param {string} b64 - Base64-encoded string
 * @returns {string|null} - Decoded URL or null if invalid
 */
function decodeBaddr(b64) {
  try {
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    // Validate it looks like a URL
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      return decoded.trim();
    }
    console.warn(`[baddr] Decoded string does not appear to be a URL: ${decoded.substring(0, 50)}`);
    return null;
  } catch (err) {
    console.warn(`[baddr] Failed to decode base64: ${err.message}`);
    return null;
  }
}

/**
 * Get URLs from spec (from either 'url' or 'baddr' fields)
 * Returns array with metadata about source type
 * @param {Object} spec - File specification
 * @returns {Array<{url: string, type: 'url'|'baddr', index: number}>} - Array of URL objects with metadata
 */
function getUrlsFromSpec(spec) {
  const urls = [];
  let index = 0;
  
  // Handle 'url' field (plain URLs)
  if (spec.url) {
    const urlArray = Array.isArray(spec.url) ? spec.url : [spec.url];
    urlArray.forEach((url) => {
      urls.push({ url, type: 'url', index: index++ });
    });
  }
  
  // Handle 'baddr' field (base64-encoded URLs)
  if (spec.baddr) {
    const baddrArray = Array.isArray(spec.baddr) ? spec.baddr : [spec.baddr];
    baddrArray.forEach((b64) => {
      const decoded = decodeBaddr(b64);
      if (decoded) {
        urls.push({ url: decoded, type: 'baddr', index: index++ });
      }
    });
  }
  
  return urls;
}

/**
 * Parse priority array and expand shorthand tokens
 * @param {Array<string>|undefined} priority - Priority array from manifest
 * @param {Object} spec - File specification
 * @returns {Array<Object>} - Array of download source objects
 */
function parsePriority(priority, spec) {
  // Get all URLs (from both 'url' and 'baddr' fields)
  const urlArray = getUrlsFromSpec(spec);
  const hasUrls = urlArray.length > 0;
  
  if (!priority) {
    // Default priority based on available sources
    const sources = [];
    if (spec.ipfs_cidv1) {
      sources.push({ type: 'ipfs', cid: spec.ipfs_cidv1 });
    }
    if (hasUrls) {
      urlArray.forEach((urlObj) => {
        sources.push({ type: 'url', url: urlObj.url, urlType: urlObj.type, index: urlObj.index });
      });
    }
    if (spec.data_txid || spec.ardrive_file_path) {
      sources.push({ type: 'ardrive', txid: spec.data_txid, path: spec.ardrive_file_path });
    }
    return sources;
  }

  const sources = [];

  for (const token of priority) {
    if (token === 'ipfs' && spec.ipfs_cidv1) {
      sources.push({ type: 'ipfs', cid: spec.ipfs_cidv1 });
    } else if (token === 'ardrive' && (spec.data_txid || spec.ardrive_file_path)) {
      sources.push({ type: 'ardrive', txid: spec.data_txid, path: spec.ardrive_file_path });
    } else if (token === 'url' || token === 'baddr') {
      // Expand to all URLs (from both url and baddr fields)
      urlArray.forEach((urlObj) => {
        sources.push({ type: 'url', url: urlObj.url, urlType: urlObj.type, index: urlObj.index });
      });
    } else if (token.startsWith('url.') || token.startsWith('baddr.')) {
      // Support both url.0 and baddr.0 syntax
      const idx = parseInt(token.substring(token.indexOf('.') + 1), 10);
      if (!isNaN(idx) && idx >= 0) {
        // Find URL at this index (across both url and baddr)
        const urlObj = urlArray.find((u) => u.index === idx);
        if (urlObj) {
          sources.push({ type: 'url', url: urlObj.url, urlType: urlObj.type, index: urlObj.index });
        }
      }
    }
  }

  return sources;
}

async function ensureArtifact(spec, workingDir, downloadTracker, userDataDir, ipfsTimeout = 20) {
  const destPath = path.join(workingDir, spec.file_name);
  if (downloadTracker) {
    downloadTracker.register(spec);
  }
  if (fs.existsSync(destPath) && (!spec.sha256 || sha256File(destPath) === spec.sha256)) {
    console.log(`[download-cached] ${spec.file_name} already present with matching hash.`);
    if (downloadTracker) {
      downloadTracker.skip(spec);
    }
    return destPath;
  }

  if (fs.existsSync(destPath)) {
    console.warn(`[download-retry] ${spec.file_name} present but hash mismatch, re-downloading.`);
  }

  // Check for embedded patch first (if source_path is specified)
  // Embedded patches are included in the project and should be used before remote downloads
  if (spec.source_path && spec.type === 'sql') {
    const embeddedPatch = locateEmbeddedPatch(spec.source_path, spec.file_name);
    if (embeddedPatch) {
      console.log(`[download-embedded] Found embedded patch ${spec.file_name} at ${embeddedPatch}`);
      // Copy to working directory
      fs.copyFileSync(embeddedPatch, destPath);
      // Verify hash if provided
      if (spec.sha256 && sha256File(destPath) !== spec.sha256) {
        fs.unlinkSync(destPath);
        throw new Error(`Embedded patch hash mismatch for ${spec.file_name}`);
      }
      if (downloadTracker) {
        downloadTracker.skip(spec);
      }
      return destPath;
    } else {
      console.warn(`[download-embedded] Embedded patch ${spec.file_name} with source_path "${spec.source_path}" not found in expected locations. Falling back to remote download.`);
    }
  }

  // Search local paths (before any downloads)
  // SHA256 is required for local search
  if (spec.sha256) {
    const searchPaths = getSearchPaths(userDataDir, workingDir);
    const localFile = searchLocalFile(spec, searchPaths);
    if (localFile) {
      console.log(`[download-local] Found ${spec.file_name} at ${localFile}`);
      // Copy to working directory
      fs.copyFileSync(localFile, destPath);
      // Verify hash (should already match, but double-check)
      if (spec.sha256 && sha256File(destPath) !== spec.sha256) {
        fs.unlinkSync(destPath);
        throw new Error(`Local file hash mismatch for ${spec.file_name}`);
      }
      if (downloadTracker) {
        downloadTracker.skip(spec);
      }
      return destPath;
    }
  }

  // Parse priority and attempt downloads in order
  // Check if URLs are available (from either 'url' or 'baddr' fields)
  const urlArray = getUrlsFromSpec(spec);
  const hasUrls = urlArray.length > 0;
  const priority = spec.priority || (hasUrls ? ['ipfs', 'url', 'ardrive'] : ['ipfs', 'ardrive']);
  const sources = parsePriority(priority, spec);

  let lastError = null;

  console.log(`[ensureArtifact] remote-download: sources ${JSON.stringify(sources)}`)
  for (const source of sources) {
    try {
      if (source.type === 'ipfs') {
        const userDataDirForConfig = userDataDir || detectUserDataDir();

        console.log(`[ensureArtifact] ipfs  fetch cid  ${source.cid}`)
        await ipfsFetchConfig.fetchFromIpfs({
          cid: source.cid,
          destPath,
          expectedSha256: spec.sha256,
          spec,
          downloadTracker,
          ipfsTimeout,
          userDataDir: userDataDirForConfig,
        });
        return destPath;
      } else if (source.type === 'url') {
        try {
          await downloadFromUrl(source.url, destPath, spec.sha256, spec, downloadTracker, `url:${source.index}`);
          return destPath;
        } catch (err) {
          lastError = err;
          console.error(`[download-error] ${spec.file_name} via url.${source.index} -> ${err.message}`);
        }
      } else if (source.type === 'ardrive') {
        const userDataDirForConfig = userDataDir || detectUserDataDir();
        try {
          await arweaveFetchConfig.fetchFromArweave({
            txid: source.txid,
            path: source.path,
            destPath,
            expectedSha256: spec.sha256,
            spec,
            downloadTracker,
            userDataDir: userDataDirForConfig,
          });
          return destPath;
        } catch (err) {
          lastError = err;
          console.error(`[download-error] ${spec.file_name} via ardrive -> ${err.message}`);
        }
      }
    } catch (err) {
      lastError = err;
      if (source.type === 'ipfs') {
        console.error(`[download-error] ${spec.file_name} via ipfs -> ${err.message}`);
      }
    }
  }

  if (sources.length === 0) {
    console.error(`[download-fail] ${spec.file_name}: no download sources available in manifest.`);
  } else {
    console.error(
      `[download-fail] ${spec.file_name}: exhausted ${sources.length} source(s). Last error was: ${
        lastError ? lastError.message : 'unknown'
      }`
    );
  }

  throw new Error(
    `Failed to download ${spec.file_name}: ${lastError ? lastError.message : 'no sources available'}`
  );
}

/**
 * Download from IPFS using parallel gateway testing (5 at a time)
 * Only for files < 180 MB with SHA256 hash available
 * @param {number} ipfsTimeout - Timeout in seconds for each IPFS request
 */
async function downloadFromUrl(url, destPath, expectedSha256, spec, downloadTracker, sourceLabel, timeoutMs = 4 * 60 * 1000) {
  console.log(`[download-attempt] ${spec.file_name} via ${sourceLabel || url}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
  clearTimeout(timeout);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const totalBytes = Number(response.headers.get('content-length')) || 0;
  if (downloadTracker) {
    downloadTracker.start(spec, totalBytes);
  }

  const tempPath = `${destPath}.download`;
  const writeStream = fs.createWriteStream(tempPath);
  const bodyStream = Readable.fromWeb(response.body);
  let downloadedBytes = 0;
  const tracker = new Transform({
    transform(chunk, encoding, callback) {
      downloadedBytes += chunk.length;
      if (downloadTracker) {
        downloadTracker.progress(spec, downloadedBytes, totalBytes);
      }
      callback(null, chunk);
    },
  });

  await pipeline(bodyStream, tracker, writeStream);
  writeStream.close();

  if (downloadTracker) {
    downloadTracker.complete(spec);
  }

  if (expectedSha256) {
    const actualSha = sha256File(tempPath);
    if (actualSha !== expectedSha256) {
      fs.unlinkSync(tempPath);
      throw new Error(`SHA-256 mismatch (expected ${expectedSha256}, got ${actualSha})`);
    }
  }

  await fs.promises.rename(tempPath, destPath);
}

async function decompressXz(sourcePath, destPath) {
  await pipeline(
    fs.createReadStream(sourcePath),
    lzma.createDecompressor(),
    fs.createWriteStream(destPath)
  );
}

async function extractFileFromTar(tarPath, extractFile, outputPath) {
  let extracted = false;
  await tar.x({
    file: tarPath,
    cwd: path.dirname(outputPath),
    filter: (filePath) => {
      if (filePath === extractFile) {
        extracted = true;
        return true;
      }
      return false;
    },
  });

  if (!extracted) {
    throw new Error(`Unable to locate ${extractFile} inside ${path.basename(tarPath)}`);
  }

  const extractedPath = path.join(path.dirname(outputPath), extractFile);
  if (extractedPath !== outputPath) {
    fs.renameSync(extractedPath, outputPath);
  }
}

async function extractBaseArchive({
  base,
  baseArchivePath,
  dbName,
  format,
  stagingDir,
  tempDbPath,
  userDataDir,
  onLog = console.log
}) {
  if (isBundleSpec(base)) {
    const bundleStaging = path.join(stagingDir, `bundle-base-${dbName}`);
    await provisionBundle.applyBundleAsBase({
      bundlePath: baseArchivePath,
      spec: base,
      extractFile: base.extract_file || dbName,
      dbName,
      tempDbPath,
      userDataDir,
      stagingDir: bundleStaging,
      onLog
    });
  } else if (format === 'tar+xz' || format === 'tar.xz') {
    onLog(`[extract] ${dbName}: decompressing tar archive ${base.file_name}`);
    const baseTarPath = path.join(stagingDir, `${base.file_name.replace(/\.xz$/i, '')}.tar`);
    await decompressXz(baseArchivePath, baseTarPath);
    const extractFile = base.extract_file || dbName;
    onLog(`[extract] ${dbName}: extracting ${extractFile} from tar`);
    await extractFileFromTar(baseTarPath, extractFile, tempDbPath);
    fs.unlinkSync(baseTarPath);
  } else if (format === 'xz') {
    onLog(`[extract] ${dbName}: decompressing ${base.file_name}`);
    await decompressXz(baseArchivePath, tempDbPath);
  } else {
    throw new Error(`Unsupported format: ${format} for ${dbName}`);
  }

  await maybeMigrateArtifacts({
    spec: base,
    dbPath: tempDbPath,
    dbName,
    userDataDir,
    onLog
  });
}

async function applyManifestPatch({
  patch,
  patchArchivePath,
  tempDbPath,
  dbName,
  stagingDir,
  userDataDir,
  onLog = console.log
}) {
  if (isBundleSpec(patch)) {
    const bundleStaging = path.join(stagingDir, `bundle-patch-${dbName}-${path.basename(patch.file_name, path.extname(patch.file_name))}`);
    await provisionBundle.applyBundleAsPatch({
      bundlePath: patchArchivePath,
      spec: patch,
      dbPath: tempDbPath,
      dbName,
      userDataDir,
      stagingDir: bundleStaging,
      onLog
    });
  } else {
  const sqlPath = path.join(stagingDir, patch.file_name.replace(/\.xz$/i, ''));
  const patchFormat = patch.format || (patch.file_name.toLowerCase().endsWith('.xz') ? 'xz' : null);
  if (patchFormat === 'xz' || patch.file_name.toLowerCase().endsWith('.xz')) {
    await decompressXz(patchArchivePath, sqlPath);
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`Decompression failed: output file ${sqlPath} does not exist`);
    }
    const stats = fs.statSync(sqlPath);
    if (stats.size === 0) {
      throw new Error(`Decompression failed: output file ${sqlPath} is empty`);
    }
  } else {
    fs.copyFileSync(patchArchivePath, sqlPath);
  }
  await applySqlPatch(tempDbPath, sqlPath, patch.file_name);
  fs.unlinkSync(sqlPath);
  }

  await maybeMigrateArtifacts({
    spec: patch,
    dbPath: tempDbPath,
    dbName,
    userDataDir,
    onLog
  });
}

/**
 * Extract multiple files/directories from tar archive
 * Supports wildcards like "Flips/*" to extract entire directories
 */
async function extractFilesFromTar(tarPath, installFiles, destDir) {
  const extractedFiles = [];
  const extractedPaths = new Set();

  // First, list all files in the tar to find matches
  const tarEntries = [];
  await tar.list({
    file: tarPath,
    onentry: (entry) => {
      tarEntries.push(entry.path);
    },
  });

  // Process each install_files pattern
  for (const pattern of installFiles) {
    if (pattern.endsWith('/*')) {
      // Wildcard pattern: extract entire directory
      const dirPrefix = pattern.slice(0, -2); // Remove '/*'
      const matchingEntries = tarEntries.filter((entry) => entry.startsWith(dirPrefix + '/') || entry === dirPrefix);
      
      if (matchingEntries.length === 0) {
        throw new Error(`No files found matching pattern ${pattern} in archive`);
      }

      // Extract all matching entries
      let extracted = false;
      await tar.x({
        file: tarPath,
        cwd: destDir,
        filter: (filePath) => {
          if (filePath.startsWith(dirPrefix + '/') || filePath === dirPrefix) {
            extracted = true;
            return true;
          }
          return false;
        },
      });

      if (!extracted) {
        throw new Error(`No files extracted for pattern ${pattern}`);
      }

      // Track all extracted files (only files, not directories)
      for (const entry of matchingEntries) {
        const fullPath = path.join(destDir, entry);
        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          if (stats.isFile()) {
            extractedFiles.push(entry);
            extractedPaths.add(entry);
          }
        }
      }
    } else {
      // Exact file match
      if (!tarEntries.includes(pattern)) {
        throw new Error(`File ${pattern} not found in archive`);
      }

      let extracted = false;
      await tar.x({
        file: tarPath,
        cwd: destDir,
        filter: (filePath) => {
          if (filePath === pattern) {
            extracted = true;
            return true;
          }
          return false;
        },
      });

      if (!extracted) {
        throw new Error(`File ${pattern} was not extracted`);
      }

      const fullPath = path.join(destDir, pattern);
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        if (stats.isFile()) {
          extractedFiles.push(pattern);
          extractedPaths.add(pattern);
        }
      }
    }
  }

  return extractedFiles;
}

/**
 * Build appfiles package from manifest
 * Extracts files from tar archive and creates tracking file
 */
async function buildAppFilesFromManifest(dbStatus, manifestEntry, planPaths, downloadTracker, userDataDir, ipfsTimeout = 20) {
  const { downloadsDir, stagingDir } = planPaths;
  ensureDirectory(stagingDir);

  const base = manifestEntry.base;
  if (!base) {
    throw new Error(`Manifest entry missing base description.`);
  }

  if (!base.install_files || !Array.isArray(base.install_files) || base.install_files.length === 0) {
    throw new Error(`Manifest entry missing install_files array.`);
  }

  // Download base archive
  const baseArchivePath = await ensureArtifact(base, downloadsDir, downloadTracker, userDataDir, ipfsTimeout);
  console.log(`[extract] ${dbStatus.name}: extracting appfiles from ${base.file_name}`);

  // Extract tar archive to staging
  const format = base.format || 'tar+xz';
  if (format !== 'tar+xz' && format !== 'tar.xz') {
    throw new Error(`Unsupported format for appfiles: ${format}`);
  }

  const baseTarPath = path.join(stagingDir, `${base.file_name.replace(/\.xz$/i, '')}.tar`);
  await decompressXz(baseArchivePath, baseTarPath);

  // Extract specified files to userDataDir
  const extractedFiles = await extractFilesFromTar(baseTarPath, base.install_files, userDataDir);
  fs.unlinkSync(baseTarPath);

  console.log(`[extract] ${dbStatus.name}: extracted ${extractedFiles.length} file(s)`);

  // Calculate SHA256 for each extracted file
  const installedFiles = [];
  for (const file of extractedFiles) {
    const filePath = path.join(userDataDir, file);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        const fileSha256 = sha256File(filePath);
        installedFiles.push({
          file,
          sha256: fileSha256,
        });
      }
    }
  }

  // Create tracking file
  const trackingFilePath = path.join(userDataDir, dbStatus.name);
  const version = manifestEntry.version || '0';
  const message = manifestEntry.message || '';
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const trackingContent = {
    message,
    version,
    timestamp,
    installed_files: installedFiles,
  };

  fs.writeFileSync(trackingFilePath, JSON.stringify(trackingContent, null, 2), 'utf8');
  console.log(`[provision] ${dbStatus.name}: tracking file created at ${trackingFilePath}`);

  // Update provisioned.json
  updateProvisionedEntry(userDataDir, dbStatus.name, version, base.sha256, null, null, null);

  return trackingFilePath;
}

async function buildDatabaseFromManifest(dbStatus, chainView, planPaths, downloadTracker, userDataDir, ipfsTimeout = 20) {
  const { downloadsDir, stagingDir } = planPaths;
  ensureDirectory(stagingDir);

  const base = chainView.base;
  if (!base) {
    throw new Error(`Manifest entry missing base for ${chainView.effectiveChain} chain.`);
  }

  const baseArchivePath = await ensureArtifact(base, downloadsDir, downloadTracker, userDataDir, ipfsTimeout);
  const format = base.format || 'xz';
  const tempDbPath = path.join(stagingDir, `${dbStatus.name}.tmp.db`);
  const finalDbPath = path.join(planPaths.finalDir, dbStatus.name);

  if (fs.existsSync(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }

  await extractBaseArchive({
    base,
    baseArchivePath,
    dbName: dbStatus.name,
    format,
    stagingDir,
    tempDbPath,
    userDataDir
  });

  console.log(
    `[plan] ${dbStatus.name}: extracted base archive (archive SHA already verified as ${base.sha256 || 'unknown'})`
  );

  const patches = Array.isArray(chainView.sqlpatches) ? chainView.sqlpatches : [];
  // Apply patches in manifest order (do not sort alphabetically)
  // The manifest order is critical for schema migrations and dependencies

  let lastPatchSha256 = null;
  let lastPatchFileName = null;

  for (const patch of patches) {
    const patchArchivePath = await ensureArtifact(patch, downloadsDir, downloadTracker, userDataDir, ipfsTimeout);
    console.log(`[patch-start] ${dbStatus.name}: applying ${patch.file_name}`);
    await applyManifestPatch({
      patch,
      patchArchivePath,
      tempDbPath,
      dbName: dbStatus.name,
      stagingDir,
      userDataDir
    });
    console.log(`[patch-complete] ${dbStatus.name}: applied ${patch.file_name}`);
    
    // Track last applied patch
    lastPatchSha256 = patch.sha256;
    lastPatchFileName = patch.file_name;
  }

  ensureDirectory(path.dirname(finalDbPath));
  fs.copyFileSync(tempDbPath, finalDbPath);
  fs.unlinkSync(tempDbPath);
  console.log(`[provision] ${dbStatus.name}: finalized database at ${finalDbPath}`);
  
  // Update provisioned.json
  updateProvisionedEntry(
    userDataDir,
    dbStatus.name,
    chainView.version,
    base.sha256,
    lastPatchSha256,
    lastPatchFileName,
    chainView.storeChain
  );
  
  return finalDbPath;
}

async function applySqlPatch(dbPath, sqlPath, originName) {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const db = new Database(dbPath);
  try {
    //db.exec('BEGIN;');
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(sql);
    //db.exec('COMMIT;');
  } catch (err) {
    try { 
    db.exec('ROLLBACK;');
    } catch (rberr) {
	    //
    }
    throw new Error(`Failed to apply ${originName}: ${err.message}`);
  } finally {
    db.close();
  }
}

async function executeProvision(plan, manifest, ipfsTimeout = 20) {
  const result = {
    executed: [],
    skipped: [],
    errors: [],
  };

  const downloadTracker = createDownloadTracker();
  const provisioned = loadProvisionedJson(plan.userDataDir);

  for (const db of plan.databases) {
    const manifestKey = DATABASES.find((d) => d.name === db.name)?.manifestKey;
    const manifestEntry = manifestKey ? manifest[manifestKey] : null;
    if (!manifestEntry) {
      continue;
    }
    let chainView;
    try {
      chainView = resolveChainView(manifestEntry, {
        requestedChain: plan.dbChain,
        provisionedEntry: provisioned.targets && provisioned.targets[db.name]
      });
    } catch (err) {
      continue;
    }
    if (chainView.base) {
      downloadTracker.register(chainView.base);
    }
    if (Array.isArray(chainView.sqlpatches)) {
      chainView.sqlpatches.forEach((spec) => downloadTracker.register(spec));
    }
  }

  const paths = normalizeWorkingPaths(plan);
  paths.finalDir = plan.userDataDir;

  ensureDirectory(paths.downloadsDir);
  ensureDirectory(paths.stagingDir);
  ensureDirectory(paths.finalDir);

  for (const db of plan.databases) {
    if (db.action === 'skip') {
      console.log(`[provision] ${db.name}: skipping (already up to date)`);
      result.skipped.push({ name: db.name, reason: 'existing kept' });
      continue;
    }

    try {
      console.log(`[provision] ${db.name}: action=${db.action}`);
      if (db.action === 'copy-embedded') {
        const manifestEntry = manifest[DATABASES.find((d) => d.name === db.name)?.manifestKey];
        if (!manifestEntry) {
          throw new Error(`Manifest entry missing for embedded database ${db.name}.`);
        }
        const chainView = resolveChainView(manifestEntry, {
          requestedChain: plan.dbChain,
          provisionedEntry: provisioned.targets && provisioned.targets[db.name]
        });

        // Copy embedded seed database
        const dest = await stageEmbeddedDb(db.name, paths.finalDir, true);
        console.log(`[provision] ${db.name}: embedded seed copied to ${dest}`);

        const patches = Array.isArray(chainView.sqlpatches) ? chainView.sqlpatches : [];
        let lastPatchSha256 = null;
        let lastPatchFileName = null;
        
        if (patches.length > 0) {
          console.log(`[provision] ${db.name}: applying ${patches.length} SQL patch(es) to embedded database`);
          
          // Use a temporary copy for patching, then replace the final file
          const tempDbPath = path.join(paths.stagingDir, `${db.name}.tmp.db`);
          fs.copyFileSync(dest, tempDbPath);
          
          for (const patch of patches) {
            const patchArchivePath = await ensureArtifact(patch, paths.downloadsDir, downloadTracker, plan.userDataDir, ipfsTimeout);
            console.log(`[patch-start] ${db.name}: applying ${patch.file_name}`);
            await applyManifestPatch({
              patch,
              patchArchivePath,
              tempDbPath,
              dbName: db.name,
              stagingDir: paths.stagingDir,
              userDataDir: plan.userDataDir
            });
            console.log(`[patch-complete] ${db.name}: applied ${patch.file_name}`);
            
            // Track last applied patch
            lastPatchSha256 = patch.sha256;
            lastPatchFileName = patch.file_name;
          }
          
          // Replace the final database with the patched version
          fs.copyFileSync(tempDbPath, dest);
          fs.unlinkSync(tempDbPath);
          console.log(`[provision] ${db.name}: patches applied, database finalized at ${dest}`);
        }
        
        result.executed.push({ name: db.name, action: 'copied-embedded', path: dest });
        
        // Update provisioned.json for embedded databases
        // For embedded databases, compute SHA256 from final database file
        const finalDbSha256 = sha256File(dest);
        updateProvisionedEntry(
          plan.userDataDir,
          db.name,
          chainView.version,
          finalDbSha256,
          lastPatchSha256,
          lastPatchFileName,
          chainView.storeChain
        );
      } else if (db.action === 'provision-from-manifest') {
        const manifestEntry = manifest[DATABASES.find((d) => d.name === db.name).manifestKey];
        if (!manifestEntry) {
          throw new Error('Manifest entry missing.');
        }
        if (db.chainError) {
          throw new Error(db.chainError);
        }
        const chainView = resolveChainView(manifestEntry, {
          requestedChain: plan.dbChain,
          provisionedEntry: provisioned.targets && provisioned.targets[db.name]
        });
        const dest = await buildDatabaseFromManifest(db, chainView, paths, downloadTracker, plan.userDataDir, ipfsTimeout);
        result.executed.push({ name: db.name, action: 'provisioned', path: dest });
        console.log(`[provision] ${db.name}: provisioning completed -> ${dest}`);
      } else if (db.action === 'provision-appfiles') {
        const manifestEntry = manifest[db.name];
        if (!manifestEntry) {
          throw new Error(`Manifest entry missing for ${db.name}.`);
        }
        if (manifestEntry.type !== 'appfiles') {
          throw new Error(`Entry ${db.name} is not of type appfiles.`);
        }
        const dest = await buildAppFilesFromManifest(db, manifestEntry, paths, downloadTracker, plan.userDataDir, ipfsTimeout);
        result.executed.push({ name: db.name, action: 'provisioned-appfiles', path: dest });
        console.log(`[provision] ${db.name}: appfiles provisioning completed -> ${dest}`);
      } else {
        result.skipped.push({ name: db.name, reason: `unknown action ${db.action}` });
        console.log(`[provision] ${db.name}: skipped (unknown action ${db.action})`);
      }
    } catch (err) {
      console.error(`[provision] ${db.name}: error ${err.message}`);
      result.errors.push({ name: db.name, message: err.message });
    }
  }

  return result;
}

/**
 * Verify all download links in manifest
 */
async function verifyLinks(manifest, opts) {
  console.log('='.repeat(70));
  console.log('Manifest Link Verification');
  console.log('='.repeat(70));
  console.log();

  const targets = opts.target ? [opts.target] : Object.keys(manifest).filter((k) => k !== 'greetings');
  const results = {
    passed: [],
    failed: [],
    warnings: [],
  };

  for (const targetKey of targets) {
    if (targetKey === 'greetings') continue;
    const target = manifest[targetKey];
    if (!target || typeof target !== 'object') continue;

    console.log(`\n[${targetKey}]`);
    console.log('-'.repeat(70));

    // Verify base
    if (target.base) {
      console.log(`  Base: ${target.base.file_name}`);
      const baseResult = await verifyFileSpec(target.base, `base for ${targetKey}`, opts);
      if (baseResult.success) {
        results.passed.push({ target: targetKey, type: 'base', file: target.base.file_name });
      } else {
        results.failed.push({ target: targetKey, type: 'base', file: target.base.file_name, error: baseResult.error });
      }
      if (baseResult.warning) {
        results.warnings.push({ target: targetKey, type: 'base', file: target.base.file_name, warning: baseResult.warning });
      }
    }

    // Verify patches
    if (Array.isArray(target.sqlpatches)) {
      for (const patch of target.sqlpatches) {
        console.log(`  Patch: ${patch.file_name}`);
        const patchResult = await verifyFileSpec(patch, `patch for ${targetKey}`, opts);
        if (patchResult.success) {
          results.passed.push({ target: targetKey, type: 'patch', file: patch.file_name });
        } else {
          results.failed.push({ target: targetKey, type: 'patch', file: patch.file_name, error: patchResult.error });
        }
        if (patchResult.warning) {
          results.warnings.push({ target: targetKey, type: 'patch', file: patch.file_name, warning: patchResult.warning });
        }
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('Verification Summary');
  console.log('='.repeat(70));
  console.log(`Passed: ${results.passed.length}`);
  console.log(`Failed: ${results.failed.length}`);
  console.log(`Warnings: ${results.warnings.length}`);

  if (results.failed.length > 0) {
    console.log('\nFailed Downloads:');
    results.failed.forEach((f) => {
      console.log(`  [${f.target}] ${f.type}: ${f.file}`);
      console.log(`    Error: ${f.error}`);
    });
  }

  if (results.warnings.length > 0) {
    console.log('\nWarnings:');
    results.warnings.forEach((w) => {
      console.log(`  [${w.target}] ${w.type}: ${w.file}`);
      console.log(`    Warning: ${w.warning}`);
    });
  }

  return results.failed.length === 0;
}

/**
 * Verify a single file specification (download and hash check)
 */
async function verifyFileSpec(spec, context, opts = {}) {
  const tempDir = path.join(os.tmpdir(), 'rhtools-verify-' + Date.now());
  ensureDirectory(tempDir);
  const tempPath = path.join(tempDir, spec.file_name);
  const userDataDir = opts.userDataDir || detectUserDataDir();
  const ipfsTimeout = (opts.ipfsTimeout || 20) * 1000;

  try {
    // Get all available download sources
    const sources = parsePriority(spec.priority || ['ipfs', 'url', 'ardrive'], spec);

    let downloaded = false;
    let downloadedFromSource = null;
    let lastError = null;
    const sourceResults = [];

    // Try each source - verify ALL sources, not just stop at first success
    for (const source of sources) {
      let sourceLabel = '';
      let url = '';
      const tempPathForSource = path.join(tempDir, `${spec.file_name}.${sourceResults.length}`);

      try {
        if (source.type === 'ipfs') {
          const gateways = ipfsFetchConfig.getResolvedGateways(userDataDir);
          console.log(`    Trying IPFS gateways (${gateways.length} total, testing 5 in parallel)...`);
          
          const gatewayPromises = gateways.map((gateway, idx) => {
            const gatewayUrl = `${gateway}${source.cid}`;
            const gatewayLabel = `ipfs:${gateway}`;
            const gatewayTempPath = path.join(tempDir, `${spec.file_name}.ipfs.${idx}`);
            
            return downloadFromUrl(gatewayUrl, gatewayTempPath, null, spec, null, gatewayLabel, ipfsTimeout)
              .then(() => {
                return { success: true, gateway, label: gatewayLabel, path: gatewayTempPath };
              })
              .catch((err) => {
                return { success: false, gateway, label: gatewayLabel, error: err.message, path: gatewayTempPath };
              });
          });
          
          // Test 5 gateways at a time
          const batchSize = 5;
          let ipfsSuccess = false;
          
          for (let i = 0; i < gatewayPromises.length; i += batchSize) {
            const batch = gatewayPromises.slice(i, i + batchSize);
            const batchResults = await Promise.allSettled(batch);
            
            for (const result of batchResults) {
              if (result.status === 'fulfilled') {
                const gatewayResult = result.value;
                sourceResults.push({
                  source: gatewayResult.label,
                  success: gatewayResult.success,
                  error: gatewayResult.error,
                });
                
                if (gatewayResult.success && !downloaded) {
                  // Use first successful download for hash verification
                  try {
                    fs.copyFileSync(gatewayResult.path, tempPath);
                    downloaded = true;
                    downloadedFromSource = gatewayResult.label;
                    ipfsSuccess = true;
                  } catch (copyErr) {
                    // If copy fails, continue to next gateway
                  }
                }
                
                // Clean up temp file
                if (fs.existsSync(gatewayResult.path) && gatewayResult.path !== tempPath) {
                  try {
                    fs.unlinkSync(gatewayResult.path);
                  } catch {
                    // Ignore cleanup errors
                  }
                }
              }
            }
            
            // If we got a successful download, we can stop testing remaining gateways
            // (but we've already queued them, so they'll complete in background)
            if (ipfsSuccess && i + batchSize < gatewayPromises.length) {
              console.log(`    IPFS download succeeded, skipping remaining gateways...`);
              break;
            }
          }
          
          if (!ipfsSuccess) {
            lastError = new Error('All IPFS gateways failed');
          }
        } else if (source.type === 'url') {
          url = source.url;
          // Distinguish between url and baddr sources
          const urlType = source.urlType || 'url';
          sourceLabel = `${urlType}:${source.index}`;
          console.log(`    Trying ${sourceLabel}...`);
          await downloadFromUrl(url, tempPathForSource, null, spec, null, sourceLabel);
          sourceResults.push({ source: sourceLabel, success: true });
          if (!downloaded) {
            // Use first successful download for hash verification
            fs.copyFileSync(tempPathForSource, tempPath);
            downloaded = true;
            downloadedFromSource = sourceLabel;
          }
        } else if (source.type === 'ardrive') {
          sourceLabel = source.txid ? 'arweave:data_txid' : 'arweave:ardrive_path';
          try {
            console.log(`    Trying ${sourceLabel}...`);
            await arweaveFetchConfig.fetchFromArweave({
              txid: source.txid,
              path: source.path,
              destPath: tempPathForSource,
              expectedSha256: null,
              spec,
              downloadTracker: null,
              userDataDir,
            });
            sourceResults.push({ source: sourceLabel, success: true });
            if (!downloaded) {
              fs.copyFileSync(tempPathForSource, tempPath);
              downloaded = true;
              downloadedFromSource = sourceLabel;
            }
          } catch (err) {
            sourceResults.push({ source: sourceLabel, success: false, error: err.message });
          }
        }

        // Clean up temp file for this source
        if (fs.existsSync(tempPathForSource) && tempPathForSource !== tempPath) {
          fs.unlinkSync(tempPathForSource);
        }
      } catch (err) {
        lastError = err;
        if (sourceLabel) {
          sourceResults.push({ source: sourceLabel, success: false, error: err.message });
        }
        // Clean up temp file on error
        if (fs.existsSync(tempPathForSource)) {
          try {
            fs.unlinkSync(tempPathForSource);
          } catch {
            // Ignore cleanup errors
          }
        }
        // Continue to next source
      }
    }

    // Report on all sources tried
    const successfulSources = sourceResults.filter((r) => r.success);
    const failedSources = sourceResults.filter((r) => !r.success);

    if (successfulSources.length > 0) {
      console.log(`    ✓ ${successfulSources.length} source(s) succeeded: ${successfulSources.map((s) => s.source).join(', ')}`);
    }
    if (failedSources.length > 0) {
      console.log(`    ✗ ${failedSources.length} source(s) failed: ${failedSources.map((s) => s.source).join(', ')}`);
    }

    if (!downloaded) {
      return {
        success: false,
        error: `All download sources failed. Last error: ${lastError ? lastError.message : 'unknown'}`,
        sourceResults,
      };
    }

    // Verify hash using the downloaded file
    if (!spec.sha256) {
      return {
        success: false,
        error: 'No SHA256 hash specified in manifest',
        warning: 'File downloaded but cannot verify hash',
        sourceResults,
        downloadedFrom: downloadedFromSource,
      };
    }

    const actualHash = sha256File(tempPath);
    if (actualHash !== spec.sha256) {
      return {
        success: false,
        error: `Hash mismatch: expected ${spec.sha256}, got ${actualHash}`,
        sourceResults,
        downloadedFrom: downloadedFromSource,
      };
    }

    // Verify size if specified
    if (spec.size) {
      const stats = fs.statSync(tempPath);
      const expectedSize = parseInt(spec.size, 10);
      if (stats.size !== expectedSize) {
        return {
          success: true,
          warning: `Size mismatch: expected ${expectedSize}, got ${stats.size}`,
          sourceResults,
          downloadedFrom: downloadedFromSource,
        };
      }
    }

    return {
      success: true,
      sourceResults,
      downloadedFrom: downloadedFromSource,
    };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    // Cleanup
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Verify build process for all targets
 */
async function verifyBuild(manifest, opts) {
  console.log('='.repeat(70));
  console.log('Manifest Build Verification');
  console.log('='.repeat(70));
  console.log();

  const targets = opts.target ? [opts.target] : Object.keys(manifest).filter((k) => k !== 'greetings');
  const results = {
    passed: [],
    failed: [],
    warnings: [],
  };

  const tempDir = path.join(os.tmpdir(), 'rhtools-verify-build-' + Date.now());
  ensureDirectory(tempDir);
  const stagingDir = path.join(tempDir, 'staging');
  ensureDirectory(stagingDir);

  try {
    for (const targetKey of targets) {
      if (targetKey === 'greetings') continue;
      const target = manifest[targetKey];
      if (!target || typeof target !== 'object' || !target.base) continue;

      console.log(`\n[${targetKey}]`);
      console.log('-'.repeat(70));

      try {
        // Download base file
        console.log(`  Downloading base: ${target.base.file_name}`);
        const basePath = path.join(tempDir, target.base.file_name);
        await ensureArtifact(target.base, tempDir, null, opts.userDataDir || detectUserDataDir(), opts.ipfsTimeout || 20);

        // Extract base database based on format
        console.log(`  Extracting base database...`);
        const tempDbPath = path.join(stagingDir, `${targetKey}.tmp.db`);
        const format = target.base.format || 'xz';

        await extractBaseArchive({
          base: target.base,
          baseArchivePath: basePath,
          dbName: targetKey,
          format,
          stagingDir,
          tempDbPath,
          userDataDir: opts.userDataDir || detectUserDataDir(),
          onLog: console.log
        });

        // Apply patches
        const patches = Array.isArray(target.sqlpatches) ? target.sqlpatches : [];
        // patches.sort((a, b) => a.file_name.localeCompare(b.file_name, 'en', { numeric: true }));

        if (patches.length === 0) {
          console.log(`  No patches to apply`);
        } else {
          console.log(`  Applying ${patches.length} patch(es)...`);
        }

        for (const patch of patches) {
          console.log(`    Applying: ${patch.file_name}`);
          const patchPath = await ensureArtifact(patch, tempDir, null, opts.userDataDir || detectUserDataDir(), opts.ipfsTimeout || 20);

          try {
            await applyManifestPatch({
              patch,
              patchArchivePath: patchPath,
              tempDbPath,
              dbName: targetKey,
              stagingDir,
              userDataDir: opts.userDataDir || detectUserDataDir(),
              onLog: (msg) => console.log(`    ${msg}`)
            });
            console.log(`      ✓ Applied successfully`);
          } catch (err) {
            // Check for common issues
            const errorMsg = err.message.toLowerCase();
            let issue = 'unknown';
            if (errorMsg.includes('sqlite_sequence')) {
              issue = 'sqlite_sequence table creation';
            } else if (errorMsg.includes('syntax error')) {
              issue = 'SQL syntax error';
            } else if (errorMsg.includes('no such table')) {
              issue = 'missing table';
            } else if (errorMsg.includes('duplicate column')) {
              issue = 'duplicate column';
            }

            results.failed.push({
              target: targetKey,
              patch: patch.file_name,
              error: err.message,
              issue,
            });
            console.log(`      ✗ Failed: ${err.message}`);
            console.log(`        Issue type: ${issue}`);
            throw err; // Stop processing this target
          }
        }

        // Verify final database is valid
        const db = new Database(tempDbPath);
        try {
          // Try a simple query to verify database is valid
          db.prepare('SELECT 1').get();
          console.log(`  ✓ Build verification passed`);
          results.passed.push({ target: targetKey, patches: patches.length });
        } finally {
          db.close();
        }
      } catch (err) {
        results.failed.push({
          target: targetKey,
          error: err.message,
        });
        console.log(`  ✗ Build verification failed: ${err.message}`);
      }
    }
  } finally {
    // Cleanup
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('Build Verification Summary');
  console.log('='.repeat(70));
  console.log(`Passed: ${results.passed.length}`);
  console.log(`Failed: ${results.failed.length}`);

  if (results.failed.length > 0) {
    console.log('\nFailed Builds:');
    results.failed.forEach((f) => {
      console.log(`  [${f.target}]`);
      if (f.patch) {
        console.log(`    Patch: ${f.patch}`);
      }
      console.log(`    Error: ${f.error}`);
      if (f.issue) {
        console.log(`    Issue: ${f.issue}`);
      }
    });
  }

  return results.failed.length === 0;
}

/**
 * Run in-place database update (apply patches only, no full re-provision)
 * Update plan: { updates: [{ dbName, patchesToApply, manifestEntry, targetVersion }] }
 * Continues on per-db failure; writes results to --update-result-path if provided.
 */
async function runUpdateMode(opts, manifest) {
  const userDataDir = opts.userDataDir;
  const workingDir = opts.workingDir;
  const ipfsTimeout = opts.ipfsTimeout || 20;

  let plan;
  try {
    const planJson = fs.readFileSync(opts.updatePlanPath, 'utf8');
    plan = JSON.parse(planJson);
  } catch (err) {
    return { success: false, results: [], error: `Failed to load update plan: ${err.message}` };
  }

  const updates = plan.updates || [];
  if (updates.length === 0) {
    return { success: true, results: [] };
  }

  const downloadsDir = path.join(workingDir, 'downloads');
  const stagingDir = path.join(workingDir, 'staging');
  ensureDirectory(downloadsDir);
  ensureDirectory(stagingDir);

  const downloadTracker = createDownloadTracker();
  for (const u of updates) {
    const patches = u.patchesToApply || [];
    patches.forEach((p) => downloadTracker.register(p));
  }

  const provisioned = loadProvisionedJson(userDataDir);
  const results = [];

  for (const u of updates) {
    const { dbName, patchesToApply, manifestEntry, targetVersion } = u;
    const patches = Array.isArray(patchesToApply) ? patchesToApply : [];

    if (patches.length === 0) {
      console.log(`[update] ${dbName}: no patches to apply, skipping`);
      results.push({ dbName, success: true });
      continue;
    }

    const existingPath = path.join(userDataDir, dbName);
    if (!fs.existsSync(existingPath)) {
      const errMsg = `Database ${dbName} not found at ${existingPath}`;
      console.log(`[patch-failed] ${dbName}: ${errMsg}`);
      results.push({ dbName, success: false, error: errMsg });
      continue;
    }

    try {
      const tempDbPath = path.join(stagingDir, `${dbName}.tmp.db`);
      fs.copyFileSync(existingPath, tempDbPath);
      console.log(`[update] ${dbName}: copied existing db to staging, applying ${patches.length} patch(es)`);

      let lastPatchSha256 = null;
      let lastPatchFileName = null;

      for (const patch of patches) {
        const patchArchivePath = await ensureArtifact(patch, downloadsDir, downloadTracker, userDataDir, ipfsTimeout);
        console.log(`[patch-start] ${dbName}: applying ${patch.file_name}`);
        await applyManifestPatch({
          patch,
          patchArchivePath,
          tempDbPath,
          dbName,
          stagingDir,
          userDataDir
        });
        console.log(`[patch-complete] ${dbName}: applied ${patch.file_name}`);
        lastPatchSha256 = patch.sha256;
        lastPatchFileName = patch.file_name;
      }

      fs.copyFileSync(tempDbPath, existingPath);
      fs.unlinkSync(tempDbPath);
      console.log(`[update] ${dbName}: finalized at ${existingPath}`);

      const currentEntry = provisioned.targets && provisioned.targets[dbName];
      const baseSha256 = currentEntry && currentEntry.base_sha256 ? currentEntry.base_sha256 : null;
      const chainView = resolveChainView(manifestEntry, { provisionedEntry: currentEntry });
      const targetVer = u.targetVersion || chainView.version;
      updateProvisionedEntry(
        userDataDir,
        dbName,
        targetVer,
        baseSha256,
        lastPatchSha256,
        lastPatchFileName,
        chainView.storeChain
      );

      results.push({ dbName, success: true });
    } catch (err) {
      const errMsg = err.message || String(err);
      console.log(`[patch-failed] ${dbName}: ${errMsg}`);
      results.push({ dbName, success: false, error: errMsg });
    }
  }

  const anySucceeded = results.some((r) => r.success);
  const anyFailed = results.some((r) => !r.success);
  const success = anySucceeded && !anyFailed;
  const partialSuccess = anySucceeded && anyFailed;

  if (opts.updateResultPath) {
    try {
      ensureDirectory(path.dirname(opts.updateResultPath));
      fs.writeFileSync(opts.updateResultPath, JSON.stringify({ results }, null, 2), 'utf8');
    } catch (err) {
      console.warn(`[update] Failed to write result file: ${err.message}`);
    }
  }

  return {
    success,
    partialSuccess,
    results,
    error: !anySucceeded ? (results.find((r) => !r.success)?.error || 'All updates failed') : undefined
  };
}

async function run(argv) {
  const opts = parseArgs(argv);
  initProgressLogging(opts);
  try {
    const defaultManifestFallback = 'electron/db/dbmanifest.json';
    const manifestCandidate =
      opts.manifestPath || resolveResourcePath(defaultManifestFallback) || resolveDefaultManifestPath();
    const resolvedManifest = resolveResourcePath(manifestCandidate);
    if (!resolvedManifest) {
      exitWithError(`Manifest not found. Looked for ${manifestCandidate}`);
    }
    opts.manifestPath = resolvedManifest;
    opts.userDataDir = opts.userDataDir || detectUserDataDir();
    opts.workingDir = opts.workingDir || defaultWorkingDir(opts.userDataDir);

    const manifest = loadManifest(opts.manifestPath);

    // Handle update mode (in-place patch application)
    if (opts.updateMode && opts.updatePlanPath) {
      const updateResult = await runUpdateMode(opts, manifest);
      finalizeProgress(updateResult.success || updateResult.partialSuccess);
      if (!updateResult.success && !updateResult.partialSuccess) {
        exitWithError(updateResult.error || 'Database update failed');
      }
      return updateResult;
    }

    // Handle verification modes
    if (opts.verifyLinks) {
      const success = await verifyLinks(manifest, opts);
      process.exit(success ? 0 : 1);
      return;
    }

    if (opts.verifyBuild) {
      const success = await verifyBuild(manifest, opts);
      process.exit(success ? 0 : 1);
      return;
    }

    if (opts.ensureDirs) {
      ensureDirectory(opts.userDataDir);
      ensureDirectory(opts.workingDir);
    }

    const dbStatus = inspectDatabases(opts, manifest);
    const plan = buildPlan(opts, dbStatus);

    if (opts.ensureDirs) {
      const manifestCopyPath = copyManifestToWorkingDir(opts.manifestPath, opts.workingDir);
      plan.workingManifestPath = manifestCopyPath;
      // Check for embedded seeds (for informational purposes in plan)
      plan.embeddedSeeds = {};
      for (const db of DATABASES.filter((d) => d.embedded)) {
        const seedPath = locateEmbeddedSeed(db.name);
        if (seedPath) {
          plan.embeddedSeeds[db.name] = seedPath;
        }
      }
    }

    if (opts.provision) {
      plan.provisionResult = await executeProvision(plan, manifest, opts.ipfsTimeout);
      const finalDbStatus = inspectDatabases(opts, manifest);
      plan.databases = finalDbStatus;
      plan.downloads = [];
    }

    writePlanIfRequested(plan, opts.writePlanPath);
    writeSummaryIfRequested(plan, opts.writeSummaryPath);
    console.log(JSON.stringify(plan, null, 2));

    const success = !opts.provision || !plan.provisionResult || plan.provisionResult.errors.length === 0;
    finalizeProgress(success);
    return plan;
  } catch (err) {
    finalizeProgress(false);
    throw err;
  }
}

module.exports = {
  run,
  DATABASES,
  updateProvisionedEntry,
  loadProvisionedJson,
  inspectDatabases,
  buildPlan,
  summarizeChainView
};

if (require.main === module) {
  run(process.argv.slice(2)).catch((err) => {
    console.error('[prepare_databases] Fatal error:', err);
    process.exit(1);
  });
}

function resolveDefaultManifestPath() {
  const candidates = [
    path.resolve(__dirname, '..', 'dbmanifest.json'),
    path.resolve(__dirname, '..', 'db', 'dbmanifest.json'),
    path.resolve(__dirname, '..', 'packed_db', 'dbmanifest.json'),
  ];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'db', 'dbmanifest.json'));
  }
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function resolveResourcePath(input) {
  if (!input) {
    return null;
  }
  const candidates = [];
  if (path.isAbsolute(input)) {
    candidates.push(input);
  } else {
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, input));
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', input));
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', input));
      candidates.push(path.join(process.resourcesPath, 'app.asar', input));
      candidates.push(path.join(process.resourcesPath, 'app.asar', 'electron', input));
    }
    candidates.push(path.join(__dirname, input));
    candidates.push(path.join(__dirname, '..', input));
    candidates.push(path.join(process.cwd(), input));
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'unknown';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)}${units[idx]}`;
}

function createDownloadTracker() {
  const state = {
    total: 0,
    completed: 0,
  };

  return {
    register(spec) {
      if (spec.__downloadOrder) {
        return;
      }
      spec.__downloadOrder = ++state.total;
    },
    start(spec, totalBytes) {
      spec.__downloadBytesTotal = totalBytes || 0;
      spec.__downloadLastPercent = -1;
      spec.__downloadLastBytes = 0;
      console.log(
        `[download-start] ${spec.__downloadOrder}/${state.total} ${spec.file_name} size=${formatBytes(totalBytes)}`
      );
    },
    progress(spec, downloaded, totalBytes) {
      if (totalBytes > 0) {
        const percent = Math.floor((downloaded / totalBytes) * 100);
        if (percent >= (spec.__downloadLastPercent ?? -1) + 5) {
          spec.__downloadLastPercent = percent;
          console.log(
            `[download-progress] ${spec.file_name} ${percent}% (${formatBytes(downloaded)}/${formatBytes(totalBytes)})`
          );
        }
      } else {
        if (downloaded - (spec.__downloadLastBytes ?? 0) >= 5 * 1024 * 1024) {
          spec.__downloadLastBytes = downloaded;
          console.log(
            `[download-progress] ${spec.file_name} downloaded ${formatBytes(downloaded)} (total unknown)`
          );
        }
      }
    },
    complete(spec) {
      state.completed += 1;
      console.log(
        `[download-complete] ${spec.__downloadOrder}/${state.total} ${spec.file_name}`
      );
    },
    skip(spec) {
      console.log(`[download-skip] ${spec.file_name} already present`);
      state.completed += 1;
    },
  };
}

