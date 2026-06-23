/**
 * provision-bundle.js - Unpack and execute provisioning bundles (7z/zip + provindex.json)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');
const artifactStore = require('./artifact-store');

const PROVINDEX_FILENAME = 'provindex.json';

function normalizeFormat(format, fileName = '') {
  const f = String(format || '').toLowerCase();
  if (f === '7z' || f.endsWith('.7z')) return '7z';
  if (f === 'zip' || f.endsWith('.zip')) return 'zip';
  if (fileName.toLowerCase().endsWith('.7z')) return '7z';
  if (fileName.toLowerCase().endsWith('.zip')) return 'zip';
  return f;
}

function isBundleSpec(spec) {
  return spec && String(spec.type || '').toLowerCase() === 'bundle';
}

async function unpackZip(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const zip = new AdmZip(archivePath);
  zip.extractAllTo(destDir, true);
}

async function unpack7z(archivePath, destDir) {
  const sevenZip = require('7zip-min');
  fs.mkdirSync(destDir, { recursive: true });
  await new Promise((resolve, reject) => {
    sevenZip.unpack(archivePath, destDir, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function unpackBundle(archivePath, format, destDir) {
  const fmt = normalizeFormat(format, archivePath);
  if (fmt === 'zip') {
    await unpackZip(archivePath, destDir);
    return destDir;
  }
  if (fmt === '7z') {
    await unpack7z(archivePath, destDir);
    return destDir;
  }
  throw new Error(`Unsupported bundle format: ${format || fmt}`);
}

function loadProvindex(bundleDir) {
  const indexPath = path.join(bundleDir, PROVINDEX_FILENAME);
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Missing ${PROVINDEX_FILENAME} in bundle`);
  }
  const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${PROVINDEX_FILENAME} must be a JSON array`);
  }
  return parsed;
}

function resolveBundleMember(bundleDir, source) {
  const direct = path.join(bundleDir, source);
  if (fs.existsSync(direct)) return direct;
  const base = path.basename(source);
  const walk = (dir, depth = 0) => {
    if (depth > 8 || !fs.existsSync(dir)) return null;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (name === base) return full;
      if (fs.statSync(full).isDirectory()) {
        const found = walk(full, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  const found = walk(bundleDir);
  if (!found) throw new Error(`Bundle member not found: ${source}`);
  return found;
}

async function applySqlPatch(dbPath, sqlPath, originName) {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const db = new Database(dbPath);
  try {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(sql);
  } catch (err) {
    throw new Error(`Failed to apply ${originName}: ${err.message}`);
  } finally {
    db.close();
  }
}

async function executeInstruction(instr, ctx) {
  const type = String(instr.type || '').toUpperCase();
  const { bundleDir, dbPath, userDataDir, onLog } = ctx;

  if (type === 'EXTRACT_DB') {
    if (!instr.source) throw new Error('EXTRACT_DB missing source');
    const member = resolveBundleMember(bundleDir, instr.source);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.copyFileSync(member, dbPath);
    if (onLog) onLog(`EXTRACT_DB: ${instr.source} → ${path.basename(dbPath)}`);
    return;
  }

  if (type === 'SQL_PATCH') {
    if (!dbPath) throw new Error('SQL_PATCH requires dbPath');
    if (!instr.source) throw new Error('SQL_PATCH missing source');
    const sqlFile = resolveBundleMember(bundleDir, instr.source);
    if (onLog) onLog(`SQL_PATCH: applying ${instr.source}`);
    await applySqlPatch(dbPath, sqlFile, instr.source);
    return;
  }

  if (type === 'ADDITEM') {
    const artifactType = instr.artifact_type || instr.artifactType;
    if (!artifactType) throw new Error('ADDITEM missing artifact_type');
    if (!instr.source) throw new Error('ADDITEM missing source');
    const sourcePath = resolveBundleMember(bundleDir, instr.source);
    artifactStore.addItem({
      artifactType,
      sourcePath,
      fileName: instr.file_name || path.basename(instr.source),
      auuid: instr.auuid || null,
      pbuuid: instr.pbuuid || null,
      gvuuid: instr.gvuuid || null,
      rauuid: instr.rauuid || null,
      rsuuid: instr.rsuuid || null,
      file_hash_sha256: instr.file_hash_sha256 || null,
      decoded_hash_sha256: instr.decoded_hash_sha256 || null,
      encoded_sha256: instr.encoded_sha256 || null,
      decoded_sha256: instr.decoded_sha256 || null,
      result_sha1: instr.result_sha1 || null,
      result_sha224: instr.result_sha224 || null,
      userDataDir
    });
    if (onLog) onLog(`ADDITEM: ${artifactType} ${instr.source}`);
    return;
  }

  if (type === 'CLEANUP') {
    const artifactType = instr.artifact_type || instr.artifactType;
    artifactStore.appendCleanupHint({
      artifactType,
      auuid: instr.auuid || null,
      pbuuid: instr.pbuuid || null,
      rauuid: instr.rauuid || null,
      rsuuid: instr.rsuuid || null,
      userDataDir
    });
    if (onLog) onLog(`CLEANUP hint: ${artifactType} auuid=${instr.auuid || ''}`);
    return;
  }

  throw new Error(`Unknown provindex instruction type: ${instr.type}`);
}

async function executeProvindex({
  instructions,
  bundleDir,
  dbPath = null,
  dbName = null,
  userDataDir = null,
  onLog = null
}) {
  const log = onLog || (() => {});
  for (const instr of instructions) {
    await executeInstruction(instr, { bundleDir, dbPath, dbName, userDataDir, onLog: log });
  }
}

async function applyBundle({
  archivePath,
  spec,
  dbPath = null,
  extractFile = null,
  dbName = null,
  userDataDir = null,
  onLog = null,
  stagingDir = null
}) {
  const bundleDir = stagingDir || fs.mkdtempSync(path.join(os.tmpdir(), 'provision-bundle-'));
  const ownedDir = !stagingDir;
  try {
    const format = spec.format || normalizeFormat('', spec.file_name || archivePath);
    await unpackBundle(archivePath, format, bundleDir);
    const instructions = loadProvindex(bundleDir);

    const hasExtractDb = instructions.some((i) => String(i.type || '').toUpperCase() === 'EXTRACT_DB');
    if (!hasExtractDb && dbPath && extractFile) {
      const member = resolveBundleMember(bundleDir, extractFile);
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.copyFileSync(member, dbPath);
      if (onLog) onLog(`extract_file: ${extractFile} → ${path.basename(dbPath)}`);
    }

    await executeProvindex({
      instructions,
      bundleDir,
      dbPath,
      dbName,
      userDataDir,
      onLog
    });
    return { bundleDir, dbPath };
  } finally {
    if (ownedDir && fs.existsSync(bundleDir)) {
      fs.rmSync(bundleDir, { recursive: true, force: true });
    }
  }
}

async function applyBundleAsBase({
  bundlePath,
  spec,
  extractFile,
  dbName,
  tempDbPath,
  userDataDir,
  stagingDir,
  onLog
}) {
  return applyBundle({
    archivePath: bundlePath,
    spec,
    dbPath: tempDbPath,
    extractFile: extractFile || dbName,
    dbName,
    userDataDir,
    stagingDir,
    onLog
  });
}

async function applyBundleAsPatch({
  bundlePath,
  spec,
  dbPath,
  dbName,
  userDataDir,
  stagingDir,
  onLog
}) {
  return applyBundle({
    archivePath: bundlePath,
    spec,
    dbPath,
    dbName,
    userDataDir,
    stagingDir,
    onLog
  });
}

module.exports = {
  PROVINDEX_FILENAME,
  isBundleSpec,
  normalizeFormat,
  unpackBundle,
  loadProvindex,
  executeProvindex,
  applyBundle,
  applyBundleAsBase,
  applyBundleAsPatch,
  resolveBundleMember,
  applySqlPatch
};
