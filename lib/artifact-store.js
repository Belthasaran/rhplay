/**
 * artifact-store.js - Client provisioning artifact store (pblob, resource, screenshot)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARTIFACT_TYPES = ['pblob', 'resource', 'screenshot'];

const PBLOB_CSV_HEADER = 'subdir,file_name,auuid,pbuuid,gvuuid,file_hash_sha256,decoded_hash_sha256,result_sha1,result_sha224\n';
const RESOURCE_CSV_HEADER = 'subdir,rauuid,file_name,encoded_sha256,decoded_sha256\n';
const SCREENSHOT_CSV_HEADER = 'subdir,rsuuid,file_name,encoded_sha256,decoded_sha256\n';
const CLEANUP_CSV_HEADER = 'artifact_type,auuid,pbuuid,rauuid,rsuuid,hint_at\n';

const README_ROOT = `RHPlay provisioning artifact store.

Files delivered via provisioning bundles (ADDITEM) are stored here instead of
inside SQLite database blobs. Legacy file_data / encrypted_data in databases
is still used as a fallback when no mapping exists.

Subdirectories:
  pblob/       - encoded patchblob files
  resource/    - resource .rbin files
  screenshot/  - screenshot .sbn files

Index CSVs track UUID-to-file mappings. Do not edit while RHPlay is running.
`;

const README_PBLOB = `Encoded patchblob artifacts (pblob_* files).
Indexed by pblob_index.csv in this directory.
`;

const README_RESOURCE = `Resource attachment artifacts (.rbin files).
Indexed by resource_index.csv in this directory.
`;

const README_SCREENSHOT = `Screenshot artifacts (.sbn files).
Indexed by screenshot_index.csv in this directory.
`;

function uuidPrefix2(id) {
  const s = String(id || '').replace(/-/g, '');
  return (s.slice(0, 2) || '00').toLowerCase();
}

function escapeCsv(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function getArtifactStoreRoot(userDataDir = null) {
  if (process.env.ARTIFACT_STORE_DIR) return process.env.ARTIFACT_STORE_DIR;
  const root = userDataDir || process.env.PATCH_RESOLVER_USER_DATA || null;
  if (!root) return null;
  return path.join(root, 'artifacts');
}

function getTypeDir(root, type) {
  return path.join(root, type);
}

function getIndexCsvPath(root, type) {
  if (type === 'pblob') return path.join(getTypeDir(root, 'pblob'), 'pblob_index.csv');
  if (type === 'resource') return path.join(getTypeDir(root, 'resource'), 'resource_index.csv');
  if (type === 'screenshot') return path.join(getTypeDir(root, 'screenshot'), 'screenshot_index.csv');
  throw new Error(`Unknown artifact type: ${type}`);
}

function getCleanupHintsPath(root) {
  return path.join(root, 'cleanup_hints.csv');
}

function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

function readCsvRows(csvPath, headerCols) {
  if (!fs.existsSync(csvPath)) return [];
  const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const parts = parseCsvLine(line);
    const row = {};
    headerCols.forEach((col, i) => {
      row[col] = parts[i] || '';
    });
    rows.push(row);
  }
  return rows;
}

function writeCsvRows(csvPath, header, rows, formatRow) {
  const body = rows.map(formatRow).join('\n');
  const content = rows.length ? `${header}${body}\n` : header;
  atomicWriteFile(csvPath, content);
}

function ensureLayout(userDataDir = null) {
  const root = getArtifactStoreRoot(userDataDir);
  if (!root) return null;
  fs.mkdirSync(root, { recursive: true });
  if (!fs.existsSync(path.join(root, 'README.txt'))) {
    fs.writeFileSync(path.join(root, 'README.txt'), README_ROOT, 'utf8');
  }
  const typeReadmes = {
    pblob: README_PBLOB,
    resource: README_RESOURCE,
    screenshot: README_SCREENSHOT
  };
  for (const type of ARTIFACT_TYPES) {
    const dir = getTypeDir(root, type);
    fs.mkdirSync(dir, { recursive: true });
    const readme = path.join(dir, 'README.txt');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, typeReadmes[type], 'utf8');
    }
    const csvPath = getIndexCsvPath(root, type);
    if (!fs.existsSync(csvPath)) {
      const headers = {
        pblob: PBLOB_CSV_HEADER,
        resource: RESOURCE_CSV_HEADER,
        screenshot: SCREENSHOT_CSV_HEADER
      };
      fs.writeFileSync(csvPath, headers[type], 'utf8');
    }
  }
  const cleanupPath = getCleanupHintsPath(root);
  if (!fs.existsSync(cleanupPath)) {
    fs.writeFileSync(cleanupPath, CLEANUP_CSV_HEADER, 'utf8');
  }
  return root;
}

function resolvePblobPath({ auuid, pbuuid, userDataDir = null } = {}) {
  const root = getArtifactStoreRoot(userDataDir);
  if (!root) return null;
  const csvPath = getIndexCsvPath(root, 'pblob');
  const rows = readCsvRows(csvPath, [
    'subdir', 'file_name', 'auuid', 'pbuuid', 'gvuuid',
    'file_hash_sha256', 'decoded_hash_sha256', 'result_sha1', 'result_sha224'
  ]);
  let row = null;
  if (auuid) row = rows.find((r) => r.auuid === auuid);
  if (!row && pbuuid) row = rows.find((r) => r.pbuuid === pbuuid);
  if (!row) return null;
  const filePath = path.join(getTypeDir(root, 'pblob'), row.subdir, row.file_name);
  if (!fs.existsSync(filePath)) return null;
  return { filePath, row, root };
}

function resolveResourcePath({ rauuid, userDataDir = null } = {}) {
  const root = getArtifactStoreRoot(userDataDir);
  if (!root || !rauuid) return null;
  const rows = readCsvRows(getIndexCsvPath(root, 'resource'), [
    'subdir', 'rauuid', 'file_name', 'encoded_sha256', 'decoded_sha256'
  ]);
  const row = rows.find((r) => r.rauuid === rauuid);
  if (!row) return null;
  const filePath = path.join(getTypeDir(root, 'resource'), row.subdir, row.file_name);
  if (!fs.existsSync(filePath)) return null;
  return { filePath, row, root };
}

function resolveScreenshotPath({ rsuuid, userDataDir = null } = {}) {
  const root = getArtifactStoreRoot(userDataDir);
  if (!root || !rsuuid) return null;
  const rows = readCsvRows(getIndexCsvPath(root, 'screenshot'), [
    'subdir', 'rsuuid', 'file_name', 'encoded_sha256', 'decoded_sha256'
  ]);
  const row = rows.find((r) => r.rsuuid === rsuuid);
  if (!row) return null;
  const filePath = path.join(getTypeDir(root, 'screenshot'), row.subdir, row.file_name);
  if (!fs.existsSync(filePath)) return null;
  return { filePath, row, root };
}

function upsertPblobRow(root, row) {
  const csvPath = getIndexCsvPath(root, 'pblob');
  const cols = [
    'subdir', 'file_name', 'auuid', 'pbuuid', 'gvuuid',
    'file_hash_sha256', 'decoded_hash_sha256', 'result_sha1', 'result_sha224'
  ];
  let rows = readCsvRows(csvPath, cols);
  const key = row.pbuuid || row.auuid;
  rows = rows.filter((r) => (row.pbuuid ? r.pbuuid !== row.pbuuid : true)
    && (row.auuid ? r.auuid !== row.auuid : true));
  rows.push(row);
  writeCsvRows(csvPath, PBLOB_CSV_HEADER, rows, (r) => cols.map((c) => escapeCsv(r[c])).join(','));
}

function upsertResourceRow(root, row) {
  const csvPath = getIndexCsvPath(root, 'resource');
  const cols = ['subdir', 'rauuid', 'file_name', 'encoded_sha256', 'decoded_sha256'];
  let rows = readCsvRows(csvPath, cols);
  rows = rows.filter((r) => r.rauuid !== row.rauuid);
  rows.push(row);
  writeCsvRows(csvPath, RESOURCE_CSV_HEADER, rows, (r) => cols.map((c) => escapeCsv(r[c])).join(','));
}

function upsertScreenshotRow(root, row) {
  const csvPath = getIndexCsvPath(root, 'screenshot');
  const cols = ['subdir', 'rsuuid', 'file_name', 'encoded_sha256', 'decoded_sha256'];
  let rows = readCsvRows(csvPath, cols);
  rows = rows.filter((r) => r.rsuuid !== row.rsuuid);
  rows.push(row);
  writeCsvRows(csvPath, SCREENSHOT_CSV_HEADER, rows, (r) => cols.map((c) => escapeCsv(r[c])).join(','));
}

function copyArtifactFile(sourcePath, destPath, expectedHash = null) {
  const data = fs.readFileSync(sourcePath);
  if (expectedHash) {
    const actual = sha256Buffer(data);
    if (actual !== expectedHash) {
      throw new Error(`Hash mismatch for ${sourcePath}: expected ${expectedHash}, got ${actual}`);
    }
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  if (fs.existsSync(destPath)) {
    const existing = fs.readFileSync(destPath);
    if (existing.equals(data)) return { written: false, destPath };
    fs.writeFileSync(destPath, data);
    return { written: true, destPath, overwritten: true };
  }
  fs.writeFileSync(destPath, data);
  return { written: true, destPath };
}

function addItem({
  artifactType,
  sourcePath,
  fileName = null,
  auuid = null,
  pbuuid = null,
  gvuuid = null,
  rauuid = null,
  rsuuid = null,
  file_hash_sha256 = null,
  decoded_hash_sha256 = null,
  encoded_sha256 = null,
  decoded_sha256 = null,
  result_sha1 = null,
  result_sha224 = null,
  userDataDir = null
}) {
  const root = ensureLayout(userDataDir);
  const type = String(artifactType || '').toLowerCase();
  if (!ARTIFACT_TYPES.includes(type)) {
    throw new Error(`ADDITEM: unsupported artifact_type ${artifactType}`);
  }
  const id = auuid || pbuuid || rauuid || rsuuid || path.basename(sourcePath);
  const subdir = uuidPrefix2(id);
  const baseName = fileName || path.basename(sourcePath);
  const destPath = path.join(getTypeDir(root, type), subdir, baseName);
  const hashForCheck = file_hash_sha256 || encoded_sha256 || null;
  copyArtifactFile(sourcePath, destPath, hashForCheck);

  if (type === 'pblob') {
    upsertPblobRow(root, {
      subdir,
      file_name: baseName,
      auuid: auuid || '',
      pbuuid: pbuuid || '',
      gvuuid: gvuuid || '',
      file_hash_sha256: file_hash_sha256 || '',
      decoded_hash_sha256: decoded_hash_sha256 || '',
      result_sha1: result_sha1 || '',
      result_sha224: result_sha224 || ''
    });
  } else if (type === 'resource') {
    upsertResourceRow(root, {
      subdir,
      rauuid: rauuid || '',
      file_name: baseName,
      encoded_sha256: encoded_sha256 || '',
      decoded_sha256: decoded_sha256 || ''
    });
  } else if (type === 'screenshot') {
    upsertScreenshotRow(root, {
      subdir,
      rsuuid: rsuuid || '',
      file_name: baseName,
      encoded_sha256: encoded_sha256 || '',
      decoded_sha256: decoded_sha256 || ''
    });
  }
  return { destPath, subdir, fileName: baseName };
}

function appendCleanupHint({
  artifactType,
  auuid = null,
  pbuuid = null,
  rauuid = null,
  rsuuid = null,
  userDataDir = null
}) {
  const root = ensureLayout(userDataDir);
  const csvPath = getCleanupHintsPath(root);
  const line = [
    escapeCsv(artifactType),
    escapeCsv(auuid || ''),
    escapeCsv(pbuuid || ''),
    escapeCsv(rauuid || ''),
    escapeCsv(rsuuid || ''),
    escapeCsv(new Date().toISOString())
  ].join(',');
  fs.appendFileSync(csvPath, `${line}\n`, 'utf8');
  return csvPath;
}

module.exports = {
  ARTIFACT_TYPES,
  uuidPrefix2,
  getArtifactStoreRoot,
  ensureLayout,
  resolvePblobPath,
  resolveResourcePath,
  resolveScreenshotPath,
  addItem,
  appendCleanupHint,
  copyArtifactFile,
  atomicWriteFile,
  sha256Buffer
};
