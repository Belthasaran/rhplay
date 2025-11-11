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
 * Databases handled: clientdata.db, rhdata.db, patchbin.db
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
  --provision               Execute provisioning workflow (download/apply/copy)
  --write-plan <file>       Write action plan JSON to the specified file
  --help                    Show this help message

Examples:
  prepare_databases.js
  prepare_databases.js --overwrite rhdata.db,patchbin.db --ensure-dirs
`.trim();

let progressLogStream = null;
let progressDonePath = null;
let progressLoggingInitialized = false;

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

  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args) => {
    const message = args.join(' ');
    if (progressLogStream) {
      progressLogStream.write(`${message}\n`);
    }
    origLog(...args);
  };

  console.error = (...args) => {
    const message = args.join(' ');
    if (progressLogStream) {
      progressLogStream.write(`[error] ${message}\n`);
    }
    origError(...args);
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
  }
}

function exitWithError(message) {
  if (progressLoggingInitialized) {
    finalizeProgress(false);
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

function normalizeWorkingPaths(plan) {
  if (!fs.existsSync(plan.workingDir)) {
    fs.mkdirSync(plan.workingDir, { recursive: true });
  }
  return {
    downloadsDir: plan.workingDir,
    stagingDir: path.join(plan.workingDir, 'staging'),
  };
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
    provision: opts.provision,
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

function locateEmbeddedClientSeed() {
  const candidates = [
    path.resolve(__dirname, '..', 'packed_db', 'clientdata.db.initial.xz'),
    path.resolve(__dirname, '..', 'db', 'clientdata.db'),
  ];

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'db', 'clientdata.db.initial.xz'));
    candidates.push(path.join(process.resourcesPath, 'db', 'clientdata.db'));
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function stageEmbeddedClientDb(userDataDir, overwrite = true) {
  ensureDirectory(userDataDir);

  const source = locateEmbeddedClientSeed();

  if (!source) {
    throw new Error(`Embedded clientdata.db seed not found in expected locations.`);
  }

  const destination = path.join(userDataDir, 'clientdata.db');
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

const IPFS_GATEWAYS = [
  'https://w3s.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

async function ensureArtifact(spec, workingDir, downloadTracker) {
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

  let lastError = null;

  const attempts = [];

  if (spec.ipfs_cidv1) {
    for (const gateway of IPFS_GATEWAYS) {
      const url = `${gateway}${spec.ipfs_cidv1}`;
      attempts.push({ url, label: `ipfs:${gateway}` });
      try {
        await downloadFromUrl(url, destPath, spec.sha256, spec, downloadTracker, `ipfs:${gateway}`);
        return destPath;
      } catch (err) {
        lastError = err;
        console.error(`[download-error] ${spec.file_name} via ipfs:${gateway} -> ${err.message}`);
      }
    }
  }

  if (spec.data_txid) {
    const url = `https://arweave.net/${spec.data_txid}`;
    attempts.push({ url, label: 'arweave:data_txid' });
    try {
      await downloadFromUrl(url, destPath, spec.sha256, spec, downloadTracker, 'arweave:data_txid');
      return destPath;
    } catch (err) {
      lastError = err;
      console.error(`[download-error] ${spec.file_name} via arweave:data_txid -> ${err.message}`);
    }
  } else if (spec.ardrive_file_path) {
    // Last resort: attempt to download via public ArDrive gateway path.
    const url = `https://arweave.net${spec.ardrive_file_path}`;
    attempts.push({ url, label: 'arweave:ardrive_path' });
    try {
      await downloadFromUrl(url, destPath, spec.sha256, spec, downloadTracker, 'arweave:ardrive_path');
      return destPath;
    } catch (err) {
      lastError = err;
      console.error(`[download-error] ${spec.file_name} via arweave:ardrive_path -> ${err.message}`);
    }
  }

  if (attempts.length === 0) {
    console.error(`[download-fail] ${spec.file_name}: no download sources available in manifest.`);
  } else {
    console.error(
      `[download-fail] ${spec.file_name}: exhausted ${attempts.length} source(s). Last error was: ${
        lastError ? lastError.message : 'unknown'
      }`
    );
  }

  throw new Error(
    `Failed to download ${spec.file_name}: ${lastError ? lastError.message : 'no sources available'}`
  );
}

async function downloadFromUrl(url, destPath, expectedSha256, spec, downloadTracker, sourceLabel) {
  console.log(`[download-attempt] ${spec.file_name} via ${sourceLabel || url}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4 * 60 * 1000); // 4 minutes
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

async function buildDatabaseFromManifest(dbStatus, manifestEntry, planPaths, downloadTracker) {
  const { downloadsDir, stagingDir } = planPaths;
  ensureDirectory(stagingDir);

  const base = manifestEntry.base;
  if (!base) {
    throw new Error(`Manifest entry missing base description.`);
  }

  const baseArchivePath = await ensureArtifact(base, downloadsDir, downloadTracker);
  console.log(`[extract] ${dbStatus.name}: decompressing base archive ${base.file_name}`);
  const baseTarPath = path.join(stagingDir, `${base.file_name.replace(/\.xz$/i, '')}.tar`);
  const tempDbPath = path.join(stagingDir, `${dbStatus.name}.tmp.db`);
  const finalDbPath = path.join(planPaths.finalDir, dbStatus.name);

  if (fs.existsSync(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }

  await decompressXz(baseArchivePath, baseTarPath);
  console.log(`[extract] ${dbStatus.name}: extracting ${base.extract_file || dbStatus.name}`);
  await extractFileFromTar(baseTarPath, base.extract_file || dbStatus.name, tempDbPath);
  fs.unlinkSync(baseTarPath);

  console.log(
    `[plan] ${dbStatus.name}: extracted base archive (archive SHA already verified as ${base.sha256 || 'unknown'})`
  );

  const patches = Array.isArray(manifestEntry.sqlpatches) ? manifestEntry.sqlpatches : [];
  patches.sort((a, b) => a.file_name.localeCompare(b.file_name, 'en', { numeric: true }));

  for (const patch of patches) {
    const patchArchivePath = await ensureArtifact(patch, downloadsDir, downloadTracker);
    console.log(`[patch-start] ${dbStatus.name}: applying ${patch.file_name}`);
    const sqlPath = path.join(stagingDir, patch.file_name.replace(/\.xz$/i, ''));
    await decompressXz(patchArchivePath, sqlPath);
    await applySqlPatch(tempDbPath, sqlPath, patch.file_name);
    fs.unlinkSync(sqlPath);
    console.log(`[patch-complete] ${dbStatus.name}: applied ${patch.file_name}`);
  }

  ensureDirectory(path.dirname(finalDbPath));
  fs.copyFileSync(tempDbPath, finalDbPath);
  fs.unlinkSync(tempDbPath);
  console.log(`[provision] ${dbStatus.name}: finalized database at ${finalDbPath}`);
  return finalDbPath;
}

async function applySqlPatch(dbPath, sqlPath, originName) {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const db = new Database(dbPath);
  try {
    //db.exec('BEGIN;');
    db.exec(sql);
    //db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw new Error(`Failed to apply ${originName}: ${err.message}`);
  } finally {
    db.close();
  }
}

async function executeProvision(plan, manifest) {
  const result = {
    executed: [],
    skipped: [],
    errors: [],
  };

  const downloadTracker = createDownloadTracker();
  for (const db of plan.databases) {
    const manifestEntry = manifest[DATABASES.find((d) => d.name === db.name)?.manifestKey];
    if (!manifestEntry) {
      continue;
    }
    if (manifestEntry.base) {
      downloadTracker.register(manifestEntry.base);
    }
    if (Array.isArray(manifestEntry.sqlpatches)) {
      manifestEntry.sqlpatches.forEach((spec) => downloadTracker.register(spec));
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
        const dest = await stageEmbeddedClientDb(paths.finalDir, true);
        result.executed.push({ name: db.name, action: 'copied-embedded', path: dest });
        console.log(`[provision] ${db.name}: embedded seed copied to ${dest}`);
      } else if (db.action === 'provision-from-manifest') {
        const manifestEntry = manifest[DATABASES.find((d) => d.name === db.name).manifestKey];
        if (!manifestEntry) {
          throw new Error('Manifest entry missing.');
        }
        const dest = await buildDatabaseFromManifest(db, manifestEntry, paths, downloadTracker);
        result.executed.push({ name: db.name, action: 'provisioned', path: dest });
        console.log(`[provision] ${db.name}: provisioning completed -> ${dest}`);
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

    if (opts.ensureDirs) {
      ensureDirectory(opts.userDataDir);
      ensureDirectory(opts.workingDir);
    }

    const dbStatus = inspectDatabases(opts, manifest);
    const plan = buildPlan(opts, dbStatus);

    if (opts.ensureDirs) {
      const manifestCopyPath = copyManifestToWorkingDir(opts.manifestPath, opts.workingDir);
      plan.workingManifestPath = manifestCopyPath;
      const embeddedSeed = locateEmbeddedClientSeed();
      if (embeddedSeed) {
        plan.clientdataSeedSource = embeddedSeed;
        if (opts.provision) {
          try {
            const stagedClientSeed = await stageEmbeddedClientDb(opts.userDataDir, false);
            plan.clientdataSeedPath = stagedClientSeed;
          } catch (err) {
            plan.clientdataSeedError = err.message;
          }
        }
      } else {
        plan.clientdataSeedError = 'Embedded clientdata seed not found.';
      }
    }

    if (opts.provision) {
      plan.provisionResult = await executeProvision(plan, manifest);
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

module.exports = { run };

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

