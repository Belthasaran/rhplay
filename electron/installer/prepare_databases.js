#!/usr/bin/env node

/**
 * prepare_databases.js
 *
 * Utility invoked by future graphical installers to plan and stage database
 * provisioning based on electron/dbmanifest.json. At this stage we focus on
 * directory detection, manifest inspection, and action planning. Subsequent
 * iterations will download archives, apply SQL patches, and perform final
 * installation steps.
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
 *   --write-plan <file>       Write JSON plan to file in addition to stdout
 *   --help                    Show usage information
 *
 * Databases handled: clientdata.db, rhdata.db, patchbin.db
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DEFAULT_MANIFEST = path.resolve(__dirname, '..', 'dbmanifest.json');

const DATABASES = [
  { name: 'clientdata.db', manifestKey: 'clientdata.db', embedded: true },
  { name: 'rhdata.db', manifestKey: 'rhdata.db', embedded: false },
  { name: 'patchbin.db', manifestKey: 'patchbin.db', embedded: false },
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
  --write-plan <file>       Write action plan JSON to the specified file
  --help                    Show this help message

Examples:
  prepare_databases.js
  prepare_databases.js --overwrite rhdata.db,patchbin.db --ensure-dirs
`.trim();

function exitWithError(message) {
  console.error(`[prepare_databases] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {
    manifestPath: DEFAULT_MANIFEST,
    userDataDir: null,
    workingDir: null,
    overwrite: new Set(),
    ensureDirs: false,
    writePlanPath: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      console.log(HELP_TEXT);
      process.exit(0);
    } else if (arg === '--manifest') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --manifest');
      opts.manifestPath = path.resolve(argv[++i]);
    } else if (arg.startsWith('--manifest=')) {
      opts.manifestPath = path.resolve(arg.substring('--manifest='.length));
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
    } else if (arg === '--write-plan') {
      if (i + 1 >= argv.length) exitWithError('Missing value after --write-plan');
      opts.writePlanPath = path.resolve(argv[++i]);
    } else if (arg.startsWith('--write-plan=')) {
      opts.writePlanPath = path.resolve(arg.substring('--write-plan='.length));
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
  if (platform === 'win32') {
    const base =
      process.env.APPDATA ||
      path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'RHTools');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'RHTools');
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'RHTools');
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

function sha256File(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (err) {
    return null;
  }
}

function inspectDatabases(opts, manifest) {
  const userDataDir = opts.userDataDir;
  const results = [];

  for (const db of DATABASES) {
    const filePath = path.join(userDataDir, db.name);
    const exists = fs.existsSync(filePath);
    const shouldOverwrite = opts.overwrite.has(db.name);
    const manifestEntry = manifest[db.manifestKey];

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
      manifestSummary: summarizeManifest(manifestEntry),
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

  return results;
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
    databases: dbStatus,
    downloads: [],
  };

  for (const db of dbStatus) {
    if (db.action === 'provision-from-manifest' && db.manifestSummary && db.manifestSummary.base) {
      const manifestEntryKey = DATABASES.find((d) => d.name === db.name)?.manifestKey;
      plan.downloads.push({
        database: db.name,
        manifestKey: manifestEntryKey,
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

function copyManifestToWorkingDir(manifestPath, workingDir) {
  const destPath = path.join(workingDir, 'dbmanifest.json');
  fs.copyFileSync(manifestPath, destPath);
  return destPath;
}

function stageEmbeddedClientDb(userDataDir) {
  const source = path.resolve(__dirname, '..', 'db_temp', 'clientdata.db');
  if (!fs.existsSync(source)) {
    throw new Error(`Embedded clientdata.db seed not found at ${source}`);
  }
  const destination = path.join(userDataDir, 'clientdata.db.seed');
  fs.copyFileSync(source, destination);
  return destination;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  opts.userDataDir = opts.userDataDir || detectUserDataDir();
  opts.workingDir = opts.workingDir || defaultWorkingDir(opts.userDataDir);

  const manifest = loadManifest(opts.manifestPath);

  if (opts.ensureDirs) {
    ensureDirectory(opts.userDataDir);
    ensureDirectory(opts.workingDir);
  }

  const dbStatus = inspectDatabases(opts, manifest);
  const plan = buildPlan(opts, dbStatus);

  if (opts.ensureDirs) {
    const manifestCopyPath = copyManifestToWorkingDir(opts.manifestPath, opts.workingDir);
    plan.workingManifestPath = manifestCopyPath;

    try {
      const stagedClientSeed = stageEmbeddedClientDb(opts.userDataDir);
      plan.clientdataSeedPath = stagedClientSeed;
    } catch (err) {
      plan.clientdataSeedError = err.message;
    }
  }

  writePlanIfRequested(plan, opts.writePlanPath);
  console.log(JSON.stringify(plan, null, 2));
}

main();

