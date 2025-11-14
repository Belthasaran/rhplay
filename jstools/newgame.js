#!/usr/bin/env node

/**
 * newgame.js - Interactive utility for preparing and managing game submissions.
 *
 * Usage (run with enode.sh):
 *   enode.sh jstools/newgame.js <json-file> --create   # interactive skeleton wizard
 *   enode.sh jstools/newgame.js <json-file> --prepare  # stage artifacts and compute metadata
 *   enode.sh jstools/newgame.js <json-file> --check    # validate JSON + database state
 *   enode.sh jstools/newgame.js <json-file> --add      # upsert records into databases
 *   enode.sh jstools/newgame.js <json-file> --remove   # remove records created from JSON
 *
 * General options:
 *   --rhdatadb=/path/to/rhdata.db
 *   --patchbindb=/path/to/patchbin.db
 *   --resourcedb=/path/to/resource.db
 *   --screenshotdb=/path/to/screenshot.db
 *   --force                      # overwrite existing rows when adding
 *   --purge-files                # remove patch/blob files during --remove
 *   --help                       # show help text
 *
 * Environment overrides:
 *   RHDATA_DB_PATH
 *   PATCHBIN_DB_PATH
 *   RESOURCE_DB_PATH
 *   SCREENSHOT_DB_PATH
 *
 * Notes:
 * - The JSON skeleton captures the fields curated via gameversions/gameversion_stats tables.
 * - Artifact metadata is generated during --prepare and verified during --add.
 * - Re-running --add updates existing rows (if --force) without creating duplicates.
 * - --remove deletes database records that were previously inserted by this script.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const Database = require('better-sqlite3');
const crc = require('crc');
const crc32 = require('crc-32');
const { CID } = require('multiformats/cid');
const { sha256: multiformatsSha256 } = require('multiformats/hashes/sha2');
const jssha = require('jssha');
const { spawnSync } = require('child_process');
const fernet = require('fernet');
const UrlBase64 = require('urlsafe-base64');

const SCRIPT_VERSION = '0.1.0';

const DEFAULT_RHDATA_DB_PATH = process.env.RHDATA_DB_PATH ||
  path.join(__dirname, '..', 'electron', 'rhdata.db');
const DEFAULT_PATCHBIN_DB_PATH = process.env.PATCHBIN_DB_PATH ||
  path.join(__dirname, '..', 'electron', 'patchbin.db');
const DEFAULT_RESOURCE_DB_PATH = process.env.RESOURCE_DB_PATH ||
  path.join(__dirname, '..', 'electron', 'resource.db');
const DEFAULT_SCREENSHOT_DB_PATH = process.env.SCREENSHOT_DB_PATH ||
  path.join(__dirname, '..', 'electron', 'screenshot.db');

const ALLOWED_DIFFICULTIES = [
  'Newcomer', 'Casual', 'Skilled', 'Advanced', 'Expert', 'Master', 'Grandmaster'
];

const DEFAULT_TYPES = [
  'Standard', 'Kaizo', 'Puzzle', 'Tool-Assisted', 'Pit'
];

const DEFAULT_WARNINGS = [
  'None', 'Possible Photosensitivity Triggers', 'Suggestive Content or Language',
  'Violence', 'Adult Themes'
];

/**
 * Utility helpers
 */

function generateUuid() {
  return crypto.randomUUID();
}

function generateGameId() {
  const now = new Date();
  const parts = [
    now.getUTCFullYear().toString().slice(-2),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0')
  ];
  return `new${parts.join('')}_${now.getUTCMilliseconds().toString().padStart(3, '0')}`;
}

function buildDefaultRhpakName(gv) {
  const gameId = gv.gameid || 'unknown-game';
  const author = gv.author || gv.authors || gv.submitter || 'unknown-author';
  const gameName = gv.name || 'Untitled';
  const version = gv.version !== undefined && gv.version !== null ? gv.version : '1';
  return `${gameId} - ${author} - ${gameName} - ${version}`;
}

function ensureRhpakMetadata(skeleton) {
  skeleton.metadata = skeleton.metadata || {};
  if (!skeleton.metadata.rhpakuuid) {
    skeleton.metadata.rhpakuuid = generateUuid();
  }
  if (!skeleton.metadata.rhpakname) {
    const gv = skeleton.gameversion || {};
    skeleton.metadata.rhpakname = buildDefaultRhpakName(gv);
  }
  return skeleton.metadata;
}

function pathToAbsolute(inputPath,baseDir = process.cwd()) {
  if (!inputPath) return '';
  if (path.isAbsolute(inputPath)) {
    return path.normalize(inputPath);
  }
  return path.normalize(path.join(baseDir, inputPath));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureDatabaseFileIfMissing(dbPath) {
  if (!dbPath) return;
  const dir = path.dirname(dbPath);
  ensureDir(dir);
  if (!fs.existsSync(dbPath)) {
    const db = new Database(dbPath);
    db.close();
  }
}

function normalizeRelativePath(relPath) {
  if (!relPath) return relPath;
  return relPath.split(path.sep).join('/');
}

function toRelativePath(absPath, baseDir) {
  if (!absPath) return null;
  const relative = path.relative(baseDir, absPath);
  return normalizeRelativePath(relative);
}

function toAbsolutePath(relPath, baseDir) {
  if (!relPath) return null;
  if (path.isAbsolute(relPath)) {
    return relPath;
  }
  return path.resolve(baseDir, relPath);
}

function generateFernetKey() {
  return UrlBase64.encode(crypto.randomBytes(32)).toString();
}

function fernetTokenToBuffer(token) {
  let base64 = token.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64');
}

function bufferToFernetToken(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encryptBuffer(buffer, providedKey = null) {
  const key = providedKey || generateFernetKey();
  const secret = new fernet.Secret(key);
  const token = new fernet.Token({ secret, ttl: 0 });
  const payload = buffer.toString('base64');
  const tokenString = token.encode(payload);
  const tokenBuffer = fernetTokenToBuffer(tokenString);
  return {
    key,
    tokenString,
    tokenBuffer,
    encodedSha256: sha256(tokenBuffer),
    decodedSha256: sha256(buffer)
  };
}

function decryptFernetToken(tokenStr, key) {
  const secret = new fernet.Secret(key);
  const token = new fernet.Token({ secret, token: tokenStr, ttl: 0 });
  const decodedBase64 = token.decode();
  return Buffer.from(decodedBase64, 'base64');
}

function detectFileType(fileName) {
  if (!fileName) return null;
  const ext = path.extname(fileName).toLowerCase().replace('.', '');
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    bps: 'application/octet-stream',
    zip: 'application/zip',
    '7z': 'application/x-7z-compressed'
  };
  return map[ext] || ext || null;
}

function isLikelyUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function removeStagedFile(relativePath, baseDir) {
  if (!relativePath) return;
  const absolutePath = toAbsolutePath(relativePath, baseDir);
  if (absolutePath && fs.existsSync(absolutePath)) {
    fs.rmSync(absolutePath, { force: true });
  }
}

function pruneAutoGeneratedResources(skeleton, baseDir) {
  if (!Array.isArray(skeleton.resources)) {
    skeleton.resources = [];
    return;
  }
  const keep = [];
  for (const entry of skeleton.resources) {
    if (entry && entry.auto_generated) {
      removeStagedFile(entry.encrypted_data_path, baseDir);
    } else if (entry) {
      keep.push(entry);
    }
  }
  skeleton.resources = keep;
}

function pruneAutoGeneratedScreenshots(skeleton, baseDir) {
  if (!Array.isArray(skeleton.screenshots)) {
    skeleton.screenshots = [];
    return;
  }
  const keep = [];
  for (const entry of skeleton.screenshots) {
    if (entry && entry.auto_generated) {
      removeStagedFile(entry.encrypted_data_path, baseDir);
    } else if (entry) {
      keep.push(entry);
    }
  }
  skeleton.screenshots = keep;
}

function mergeResourceEntries(manualEntries, autoEntries) {
  const merged = [];
  const seen = new Set();

  for (const entry of manualEntries) {
    if (!entry) continue;
    merged.push(entry);
    if (entry.file_sha256) {
      seen.add(entry.file_sha256);
    }
  }

  for (const entry of autoEntries) {
    if (!entry) continue;
    if (entry.file_sha256 && seen.has(entry.file_sha256)) {
      continue;
    }
    merged.push(entry);
    if (entry.file_sha256) {
      seen.add(entry.file_sha256);
    }
  }

  return merged;
}

function mergeScreenshotEntries(manualEntries, autoEntries) {
  const merged = [];
  const seenSha = new Set();
  const seenUrl = new Set();

  for (const entry of manualEntries) {
    if (!entry) continue;
    merged.push(entry);
    if (entry.file_sha256) {
      seenSha.add(entry.file_sha256);
    }
    if (entry.source_url) {
      seenUrl.add(entry.source_url);
    }
  }

  for (const entry of autoEntries) {
    if (!entry) continue;
    if (entry.file_sha256 && seenSha.has(entry.file_sha256)) {
      continue;
    }
    if (entry.source_url && seenUrl.has(entry.source_url)) {
      continue;
    }
    merged.push(entry);
    if (entry.file_sha256) {
      seenSha.add(entry.file_sha256);
    }
    if (entry.source_url) {
      seenUrl.add(entry.source_url);
    }
  }

  return merged;
}

function stageEncryptedFile(buffer, baseDir, subdir, baseName, existingKey = null) {
  const directory = subdir ? path.join(baseDir, subdir) : baseDir;
  ensureDir(directory);
  const encryption = encryptBuffer(buffer, existingKey);
  const fileName = `${baseName}.fernet`;
  const absolutePath = path.join(directory, fileName);
  fs.writeFileSync(absolutePath, encryption.tokenBuffer);
  return {
    fernetKey: encryption.key,
    encryptedSha256: encryption.encodedSha256,
    decodedSha256: encryption.decodedSha256,
    relativePath: normalizeRelativePath(path.relative(baseDir, absolutePath))
  };
}

function buildPatchResourceEntry(skeleton, artifact, baseDir) {
  const gv = skeleton.gameversion;
  const staged = stageEncryptedFile(artifact.buffer, baseDir, 'resources', artifact.patSha256);
  return {
    resource_uuid: generateUuid(),
    auto_generated: true,
    kind: 'patch',
    description: 'Primary patch resource (prepared automatically)',
    resource_scope: 'gameversion',
    linked_type: 'gameversion',
    linked_uuid: gv.gvuuid,
    gameid: gv.gameid,
    gvuuid: gv.gvuuid,
    rhpakuuid: skeleton.metadata?.rhpakuuid || null,
    file_name: artifact.fileName,
    file_ext: artifact.extension,
    file_size: artifact.size,
    file_sha224: artifact.patSha224,
    file_sha256: artifact.patSha256,
    file_sha1: artifact.patSha1,
    file_md5: artifact.patHashMd5,
    file_crc16: artifact.crc16,
    file_crc32: artifact.crc32,
    encoded_sha256: staged.encryptedSha256,
    decoded_sha256: staged.decodedSha256,
    encrypted_data_path: staged.relativePath,
    fernet_key: staged.fernetKey,
    ipfs_cid_v1: artifact.ipfsCidV1,
    ipfs_cid_v0: artifact.ipfsCidV0,
    download_url: gv.download_url || null,
    storage_path: artifact.patchStoredRelativePath,
    blob_storage_path: artifact.patchblobStoredRelativePath,
    source_path: artifact.sourceRelativePath || null,
    created_at: new Date().toISOString()
  };
}

async function buildScreenshotEntries(skeleton, baseDir) {
  const gv = skeleton.gameversion;
  if (!Array.isArray(gv.screenshots)) {
    return [];
  }

  const entries = [];
  for (const raw of gv.screenshots) {
    if (!raw || typeof raw !== 'string') {
      continue;
    }
    const value = raw.trim();
    if (!value) continue;

    if (isLikelyUrl(value)) {
      entries.push({
        screenshot_uuid: generateUuid(),
        auto_generated: true,
        kind: 'url',
        screenshot_type: 'url',
        source_url: value,
        gameid: gv.gameid,
        gvuuid: gv.gvuuid,
        rhpakuuid: skeleton.metadata?.rhpakuuid || null,
        download_url: value,
        created_at: new Date().toISOString()
      });
      continue;
    }

    const absolutePath = pathToAbsolute(value,baseDir);
    if (!absolutePath || !fs.existsSync(absolutePath)) {
      console.warn(`  ⚠ Screenshot path not found: ${absolutePath}`);
      continue;
    }

    const buffer = fs.readFileSync(absolutePath);
    const stats = fs.statSync(absolutePath);
    const fileSha224 = sha224(buffer);
    const fileSha256 = sha256(buffer);
    const fileSha1 = sha1(buffer);
    const fileMd5 = md5(buffer);
    const crc16Value = crc16(buffer);
    const crc32Value = crc32Hex(buffer);
    const ipfs = await computeIpfsCids(buffer);
    const baseName = fileSha256.slice(0, 32);
    const staged = stageEncryptedFile(buffer, baseDir, 'screenshots', baseName);
    const relativeSource = normalizeRelativePath(path.relative(baseDir, absolutePath));
    const inBase = !relativeSource.startsWith('..');

    entries.push({
      screenshot_uuid: generateUuid(),
      auto_generated: true,
      kind: 'file',
      screenshot_type: detectFileType(absolutePath) || 'file',
      source_path: inBase ? relativeSource : null,
      storage_path: inBase ? relativeSource : null,
      encrypted_data_path: staged.relativePath,
      fernet_key: staged.fernetKey,
      rhpakuuid: skeleton.metadata?.rhpakuuid || null,
      file_name: path.basename(absolutePath),
      file_ext: path.extname(absolutePath).replace('.', '').toLowerCase(),
      file_size: stats.size,
      file_sha224: fileSha224,
      file_sha256: fileSha256,
      file_sha1: fileSha1,
      file_md5: fileMd5,
      file_crc16: crc16Value,
      file_crc32: crc32Value,
      encoded_sha256: staged.encryptedSha256,
      decoded_sha256: staged.decodedSha256,
      ipfs_cid_v1: ipfs.cidV1,
      ipfs_cid_v0: ipfs.cidV0,
      gameid: gv.gameid,
      gvuuid: gv.gvuuid,
      created_at: new Date().toISOString()
    });
  }

  return entries;
}

async function loadPreparedPatchArtifact(skeleton, baseDir) {
  const patchInfo = skeleton.artifacts && skeleton.artifacts.patch;
  if (!patchInfo) {
    throw new Error('Prepared patch artifact metadata not found. Run --prepare first.');
  }
  const patchStoredAbs = toAbsolutePath(patchInfo.patch_stored_path, baseDir);
  if (!patchStoredAbs || !fs.existsSync(patchStoredAbs)) {
    throw new Error(`Prepared patch file missing: ${patchInfo.patch_stored_path}`);
  }
  const buffer = fs.readFileSync(patchStoredAbs);
  const recalculatedSha256 = sha256(buffer);
  if (patchInfo.pat_sha256 && recalculatedSha256 !== patchInfo.pat_sha256) {
    throw new Error(`Prepared patch hash mismatch. Expected ${patchInfo.pat_sha256}, got ${recalculatedSha256}`);
  }
  const recalculatedSha224 = sha224(buffer);
  if (patchInfo.pat_sha224 && recalculatedSha224 !== patchInfo.pat_sha224) {
    throw new Error(`Prepared patch SHA-224 mismatch. Expected ${patchInfo.pat_sha224}, got ${recalculatedSha224}`);
  }
  const recalculatedSha1 = sha1(buffer);
  if (patchInfo.pat_sha1 && recalculatedSha1 !== patchInfo.pat_sha1) {
    throw new Error(`Prepared patch SHA-1 mismatch. Expected ${patchInfo.pat_sha1}, got ${recalculatedSha1}`);
  }
  const recalculatedMd5 = md5(buffer);
  if (patchInfo.pat_md5 && recalculatedMd5 !== patchInfo.pat_md5) {
    throw new Error(`Prepared patch MD5 mismatch. Expected ${patchInfo.pat_md5}, got ${recalculatedMd5}`);
  }
  const recalculatedCrc16 = crc16(buffer);
  if (patchInfo.crc16 && recalculatedCrc16 !== patchInfo.crc16) {
    throw new Error(`Prepared patch CRC16 mismatch. Expected ${patchInfo.crc16}, got ${recalculatedCrc16}`);
  }
  const recalculatedCrc32 = crc32Hex(buffer);
  if (patchInfo.crc32 && recalculatedCrc32 !== patchInfo.crc32) {
    throw new Error(`Prepared patch CRC32 mismatch. Expected ${patchInfo.crc32}, got ${recalculatedCrc32}`);
  }

  const patchblobName = skeleton.patchblob && skeleton.patchblob.patchblob1_name ? skeleton.patchblob.patchblob1_name : null;
  if (!patchblobName) {
    throw new Error('Prepared patchblob name missing in skeleton.');
  }
  const patchblobStoredAbs = toAbsolutePath(patchInfo.patchblob_stored_path, baseDir);
  if (!patchblobStoredAbs || !fs.existsSync(patchblobStoredAbs)) {
    throw new Error(`Prepared patchblob file missing: ${patchInfo.patchblob_stored_path}`);
  }

  const ipfsResult = await computeIpfsCids(buffer);
  if (patchInfo.ipfs_cid_v1 && ipfsResult.cidV1 !== patchInfo.ipfs_cid_v1) {
    throw new Error(`Prepared patch IPFS CID v1 mismatch. Expected ${patchInfo.ipfs_cid_v1}, got ${ipfsResult.cidV1}`);
  }

  const artifact = {
    buffer,
    size: buffer.length,
    extension: patchInfo.file_ext || path.extname(patchStoredAbs).replace('.', '').toLowerCase(),
    fileName: patchInfo.file_name || path.basename(patchStoredAbs),
    sourcePath: patchInfo.source_path || patchStoredAbs,
    patSha224: patchInfo.pat_sha224 || recalculatedSha224,
    patSha1: patchInfo.pat_sha1 || recalculatedSha1,
    patSha256: patchInfo.pat_sha256 || recalculatedSha256,
    patHashMd5: patchInfo.pat_md5 || recalculatedMd5,
    patShake128: skeleton.patchblob && skeleton.patchblob.pat_shake_128 ? skeleton.patchblob.pat_shake_128 : shake128Base64Url(buffer),
    crc16: patchInfo.crc16 || recalculatedCrc16,
    crc32: patchInfo.crc32 || recalculatedCrc32,
    ipfsCidV0: patchInfo.ipfs_cid_v0 || ipfsResult.cidV0,
    ipfsCidV1: patchInfo.ipfs_cid_v1 || ipfsResult.cidV1,
    patchblobName,
    patchStoredPath: patchStoredAbs,
    patchStoredRelativePath: patchInfo.patch_stored_path,
    patchRelativePath: patchInfo.patch_relative_path || path.posix.join('patch', path.basename(patchStoredAbs)),
    patchblobStoredPath: patchblobStoredAbs,
    patchblobStoredRelativePath: patchInfo.patchblob_stored_path,
    patchblobRelativePath: patchInfo.patchblob_relative_path || path.posix.join('blobs', patchblobName)
  };
  return artifact;
}

async function assembleResourcePayloads(resources, baseDir) {
  const payloads = [];
  for (const entry of resources || []) {
    if (!entry) {
      continue;
    }
    if (!entry.rhpakuuid) {
      throw new Error(`Resource entry missing rhpakuuid metadata: ${entry.resource_uuid || entry.file_name || '(unnamed)'}`);
    }
    if (!entry.fernet_key || !entry.encrypted_data_path) {
      console.warn(`  ⚠ Skipping resource without encrypted data: ${entry.resource_uuid || entry.file_name || '(unnamed)'}`);
      continue;
    }
    const encryptedAbs = toAbsolutePath(entry.encrypted_data_path, baseDir);
    if (!encryptedAbs || !fs.existsSync(encryptedAbs)) {
      throw new Error(`Resource encrypted data missing: ${entry.encrypted_data_path}`);
    }
    const encryptedBuffer = fs.readFileSync(encryptedAbs);
    const tokenString = bufferToFernetToken(encryptedBuffer);
    const recalculatedEncodedSha = sha256(encryptedBuffer);
    if (entry.encoded_sha256 && recalculatedEncodedSha !== entry.encoded_sha256) {
      throw new Error(`Resource encrypted hash mismatch for ${entry.resource_uuid || entry.file_name}`);
    }
    const decodedBuffer = decryptFernetToken(tokenString, entry.fernet_key);
    const recalculatedDecodedSha = sha256(decodedBuffer);
    if (entry.decoded_sha256 && recalculatedDecodedSha !== entry.decoded_sha256) {
      throw new Error(`Resource decoded hash mismatch for ${entry.resource_uuid || entry.file_name}`);
    }
    if (entry.file_sha256 && recalculatedDecodedSha !== entry.file_sha256) {
      throw new Error(`Resource recorded file_sha256 mismatch for ${entry.resource_uuid || entry.file_name}`);
    }
    const ipfs = await computeIpfsCids(decodedBuffer);
    if (entry.ipfs_cid_v1 && ipfs.cidV1 !== entry.ipfs_cid_v1) {
      throw new Error(`Resource IPFS CID v1 mismatch for ${entry.resource_uuid || entry.file_name}`);
    }
    payloads.push({
      entry,
      tokenString,
      encryptedBuffer,
      decodedBuffer
    });
  }
  return payloads;
}

async function assembleScreenshotPayloads(screenshots, baseDir) {
  const payloads = [];
  for (const entry of screenshots || []) {
    if (!entry) continue;
    if (typeof entry === 'string') {
      // Legacy/simple entries carry no metadata; verification only applies to prepared assets.
      continue;
    }
    if (!entry.rhpakuuid) {
      throw new Error(`Screenshot entry missing rhpakuuid metadata: ${entry.screenshot_uuid || entry.file_name || entry.source_path || 'unknown'}`);
    }
    if (entry.kind === 'url') {
      payloads.push({ entry, type: 'url' });
      continue;
    }
    if (entry.kind && entry.kind !== 'file') {
      // Unsupported kinds are skipped but logged for future handling.
      console.warn(`Skipping screenshot entry with unsupported kind "${entry.kind}" (${entry.screenshot_uuid || entry.file_name || entry.source_path || 'unknown'})`);
      continue;
    }
    if (!entry.fernet_key || !entry.encrypted_data_path) {
      throw new Error(`Screenshot entry missing encrypted data: ${entry.screenshot_uuid || entry.file_name || entry.source_path || 'unknown'}`);
    }
    const encryptedAbs = toAbsolutePath(entry.encrypted_data_path, baseDir);
    if (!encryptedAbs || !fs.existsSync(encryptedAbs)) {
      throw new Error(`Screenshot encrypted data missing: ${entry.encrypted_data_path}`);
    }
    const encryptedBuffer = fs.readFileSync(encryptedAbs);
    const tokenString = bufferToFernetToken(encryptedBuffer);
    const recalculatedEncodedSha = sha256(encryptedBuffer);
    if (entry.encoded_sha256 && recalculatedEncodedSha !== entry.encoded_sha256) {
      throw new Error(`Screenshot encrypted hash mismatch for ${entry.screenshot_uuid || entry.file_name || entry.source_path || 'unknown'}`);
    }
    const decodedBuffer = decryptFernetToken(tokenString, entry.fernet_key);
    const recalculatedDecodedSha = sha256(decodedBuffer);
    if (entry.decoded_sha256 && recalculatedDecodedSha !== entry.decoded_sha256) {
      throw new Error(`Screenshot decoded hash mismatch for ${entry.screenshot_uuid || entry.file_name || entry.source_path || 'unknown'}`);
    }
    if (entry.file_sha256 && recalculatedDecodedSha !== entry.file_sha256) {
      throw new Error(`Screenshot file hash mismatch for ${entry.screenshot_uuid || entry.file_name || entry.source_path || 'unknown'}`);
    }
    const ipfs = await computeIpfsCids(decodedBuffer);
    if (entry.ipfs_cid_v1 && ipfs.cidV1 !== entry.ipfs_cid_v1) {
      throw new Error(`Screenshot IPFS CID v1 mismatch for ${entry.screenshot_uuid || entry.file_name || entry.source_path || 'unknown'}`);
    }
    payloads.push({
      entry,
      type: 'file',
      tokenString,
      encryptedBuffer,
      decodedBuffer
    });
  }
  return payloads;
}

function normalizeRelativePath(relPath) {
  return relPath ? relPath.replace(/\\/g, '/') : relPath;
}

function findExecutable(candidates) {
  const pathEntries = (process.env.PATH || '').split(path.delimiter);
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const possible = candidate.includes(path.sep) ? [candidate] : pathEntries.map(dir => path.join(dir, candidate));
    for (const base of possible) {
      for (const ext of extensions) {
        const filePath = base.endsWith(ext) ? base : base + ext;
        try {
          fs.accessSync(filePath, fs.constants.X_OK);
          return filePath;
        } catch (err) {
          continue;
        }
      }
    }
  }
  return null;
}

function find7zBinary() {
  const binary = findExecutable(['7z', '7za', '7zz', '7zr']);
  if (!binary) {
    throw new Error('Unable to locate a 7z executable (tried 7z/7za/7zz). Please install 7-Zip and ensure it is on PATH.');
  }
  return binary;
}

function create7zArchive(sourceDir, outputPath) {
  const sevenZip = find7zBinary();
  ensureDir(path.dirname(outputPath));
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }
  const args = ['a', '-t7z', '-mx=9', outputPath, '.'];
  const result = spawnSync(sevenZip, args, { cwd: sourceDir, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`7z archiving failed with exit code ${result.status}`);
  }
}

function extract7zArchive(archivePath, destinationDir) {
  const sevenZip = find7zBinary();
  ensureDir(destinationDir);
  const args = ['x', archivePath, '-y'];
  const result = spawnSync(sevenZip, args, { cwd: destinationDir, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`7z extraction failed with exit code ${result.status}`);
  }
}

function shake128Base64Url(buffer, outputBits = 192) {
  const sha = new jssha('SHAKE128', 'ARRAYBUFFER');
  sha.update(buffer);
  const hex = sha.getHash('HEX', { outputLen: outputBits });
  const raw = Buffer.from(hex, 'hex');
  return raw.toString('base64')
    .replace(/\+/g, '_')
    .replace(/\//g, '-')
    .replace(/=+$/g, '');
}

function sha224(buffer) {
  return crypto.createHash('sha224').update(buffer).digest('hex');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

async function computeIpfsCids(buffer) {
  const hash = await multiformatsSha256.digest(buffer);
  const cidV0 = CID.createV0(hash);
  const cidV1 = CID.createV1(0x70, hash);
  return {
    cidV0: cidV0.toString(),
    cidV1: cidV1.toString()
  };
}

function crc16(buffer) {
  return crc.crc16(buffer).toString(16).padStart(4, '0');
}

function crc32Hex(buffer) {
  return (crc32.buf(buffer) >>> 0).toString(16).padStart(8, '0');
}

function loadSkeleton(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to read skeleton JSON: ${error.message}`);
  }
}

function defaultSkeleton() {
  return {
    metadata: {
      script: 'newgame.js',
      version: SCRIPT_VERSION,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      prepared: false,
      prepared_at: null,
      added_at: null
    },
    artifacts: {
      patch: null
    },
    gameversion: {
      gvuuid: generateUuid(),
      gameid: generateGameId(),
      section: 'smwhacks',
      based_against: 'SMW',
      version: 1,
      removed: 0,
      obsoleted: 0,
      moderated: 0,
      featured: 0,
      name: '',
      gametype: '',
      difficulty: '',
      raw_difficulty: 'diff_3',
      type: '',
      warnings: [],
      tags: [],
      author: '',
      authors: '',
      submitter: '',
      legacy_type: '',
      url: '',
      download_url: '',
      name_href: '',
      author_href: '',
      obsoleted_by: '',
      description: '',
      length: '',
      demo: 'No',
      sa1: 'No',
      collab: 'No',
      screenshots: [],
      patch_filename: '',
      patch_local_path: '',
      patch_notes: '',
      submission_notes: ''
    },
    gameversion_stats: {
      download_count: 0,
      view_count: 0,
      comment_count: 0,
      rating_value: null,
      rating_count: 0,
      favorite_count: 0,
      hof_status: null,
      featured_status: null
    },
    patchblob: {
      pbuuid: generateUuid(),
      patchblob1_name: null,
      patchblob1_sha224: null,
      patchblob1_key: null,
      pat_sha1: null,
      pat_sha224: null,
      pat_shake_128: null,
      result_sha1: null,
      result_sha224: null,
      result_shake1: null,
      patch_name: null
    },
    attachment: {
      auuid: generateUuid(),
      file_name: null,
      download_urls: []
    },
    resources: [],
    screenshots: []
  };
}

function saveSkeleton(filePath, data) {
  const clone = { ...data };
  clone.metadata = {
    ...(clone.metadata || {}),
    updated_at: new Date().toISOString(),
    version: SCRIPT_VERSION,
    script: 'newgame.js'
  };
  fs.writeFileSync(filePath, JSON.stringify(clone, null, 2) + os.EOL);
}

function findEditorCommand() {
  if (process.platform === 'win32') {
    const winDir = process.env.WINDIR || 'C:\\Windows';
    const candidates = [
      path.join(winDir, 'System32', 'edit.exe'),
      path.join(winDir, 'System32', 'edit.com')
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return { command: candidate, args: [] };
      }
    }
    return null;
  }
  const editorPath = '/usr/bin/editor';
  if (fs.existsSync(editorPath)) {
    return { command: editorPath, args: [] };
  }
  return null;
}

async function editDescriptionWithEditor(initialText) {
  const editor = findEditorCommand();
  if (!editor) {
    return { status: 'unavailable' };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhtools-desc-'));
  const tmpFile = path.join(tmpDir, 'description.txt');
  fs.writeFileSync(tmpFile, initialText || '', 'utf8');

  try {
    const result = spawnSync(editor.command, [...editor.args, tmpFile], { stdio: 'inherit' });
    if (result.error) {
      console.log(`  ⚠ Failed to launch editor: ${result.error.message}`);
      return { status: 'failed', text: initialText || '' };
    }
    if (result.status !== 0) {
      console.log(`  ⚠ Editor exited with code ${result.status}; keeping existing description.`);
      return { status: 'failed', text: initialText || '' };
    }
    const edited = fs.readFileSync(tmpFile, 'utf8').replace(/\r\n/g, '\n');
    return { status: 'success', text: edited };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function promptMultilineDescription(rl, initialText) {
  console.log('\nEnter description text. Finish with a single "." on its own line.');
  if (initialText) {
    console.log('Press Enter without typing anything to keep the existing description.');
  } else {
    console.log('Provide at least one line, then use "." on a line by itself to finish.');
  }

  const lines = [];
  let isFirstLine = true;

  while (true) {
    const line = await rl.question('> ');
    if (isFirstLine && line === '' && initialText !== undefined && initialText !== null && initialText !== '') {
      console.log('  ↻ Keeping existing description.');
      return initialText;
    }
    if (line === '.') {
      break;
    }
    lines.push(line);
    isFirstLine = false;
  }

  return lines.join('\n');
}

/**
 * CLI argument parsing
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  const config = {
    mode: null,
    jsonPath: null,
    rhdataPath: DEFAULT_RHDATA_DB_PATH,
    patchbinPath: DEFAULT_PATCHBIN_DB_PATH,
    resourcePath: DEFAULT_RESOURCE_DB_PATH,
    screenshotPath: DEFAULT_SCREENSHOT_DB_PATH,
    packageOutput: null,
    packageInput: null,
    outputJson: null,
    baseDir: null,
    force: false,
    purgeFiles: false
  };

  for (const arg of args) {
    if (!config.jsonPath && !arg.startsWith('--')) {
      config.jsonPath = arg;
      continue;
    }
    if (arg === '--create' || arg === '--prepare' || arg === '--check' || arg === '--add' || arg === '--remove' || arg === '--uninstall') {
      if (config.mode) {
        throw new Error('Only one primary mode flag is allowed (--create, --prepare, --check, --add, --remove, --uninstall, --package, --import, --verify-package).');
      }
      config.mode = arg.slice(2);
      continue;
    }
    if (arg.startsWith('--package=')) {
      if (config.mode && config.mode !== 'package') {
        throw new Error('Only one primary mode flag is allowed.');
      }
      config.mode = 'package';
      config.packageOutput = arg.split('=')[1];
      continue;
    }
    if (arg === '--import') {
      if (config.mode && config.mode !== 'import') {
        throw new Error('Only one primary mode flag is allowed.');
      }
      config.mode = 'import';
      continue;
    }
    if (arg === '--verify-package') {
      if (config.mode && config.mode !== 'verify-package') {
        throw new Error('Only one primary mode flag is allowed.');
      }
      config.mode = 'verify-package';
      continue;
    }
    if (arg.startsWith('--output-json=')) {
      config.outputJson = path.resolve(process.cwd(), arg.split('=')[1]);
      continue;
    }
    if (arg.startsWith('--rhdatadb=')) {
      config.rhdataPath = path.normalize(arg.split('=')[1]);
      continue;
    }
    if (arg.startsWith('--patchbindb=')) {
      config.patchbinPath = path.normalize(arg.split('=')[1]);
      continue;
    }
    if (arg.startsWith('--resourcedb=')) {
      config.resourcePath = path.normalize(arg.split('=')[1]);
      continue;
    }
    if (arg.startsWith('--screenshotdb=')) {
      config.screenshotPath = path.normalize(arg.split('=')[1]);
      continue;
    }
    if (arg === '--force') {
      config.force = true;
      continue;
    }
    if (arg === '--purge-files') {
      config.purgeFiles = true;
      continue;
    }
    if (arg === '--help') {
      config.mode = 'help';
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!config.mode) {
    config.mode = 'help';
  }

  if (config.mode === 'import' || config.mode === 'verify-package') {
    if (!config.jsonPath) {
      throw new Error('Package file path is required.');
    }
    config.packageInput = pathToAbsolute(config.jsonPath);
    config.packageBaseDir = path.dirname(config.packageInput);
    config.jsonPath = null;
  } else if (config.mode === 'uninstall' && config.jsonPath && config.jsonPath.toLowerCase().endsWith('.rhpak')) {
    config.packageInput = pathToAbsolute(config.jsonPath);
    config.packageBaseDir = path.dirname(config.packageInput);
    config.jsonPath = null;
  } else if (config.mode !== 'help') {
    if (!config.jsonPath) {
      throw new Error('JSON file path is required as the first argument.');
    }
    config.jsonPath = pathToAbsolute(config.jsonPath);
    config.baseDir = path.dirname(config.jsonPath);
  }

  if (config.packageOutput) {
    const base = config.baseDir || process.cwd();
    config.packageOutput = pathToAbsolute(config.packageOutput, base);
  }

  return config;
}

function printHelp() {
  const lines = [
    'Usage: enode.sh jstools/newgame.js <json-file> [mode] [options]',
    '',
    'Modes (exactly one):',
    '  --create       Run interactive wizard to build or update the skeleton JSON',
    '  --prepare      Stage patch/resources/screenshots metadata prior to --add',
    '  --check        Validate skeleton contents and database state',
    '  --add          Verify prepared artifacts and upsert database records',
    '  --remove       (requires --force) Legacy direct removal; prefer --uninstall',
    '  --uninstall    Remove all database records for a prepared JSON or .rhpak package',
    '  --package=FILE Package prepared data into a .rhpak archive (requires prior --prepare)',
    '  --import       Import a .rhpak package (first argument must be the package path)',
    '  --verify-package Verify the contents of a .rhpak package without importing',
    '',
    'Options:',
    '  --rhdatadb=PATH     Override rhdata.db location (default from env or electron/rhdata.db)',
    '  --patchbindb=PATH   Override patchbin.db location',
    '  --resourcedb=PATH   Override resource.db location',
    '  --screenshotdb=PATH Override screenshot.db location',
    '  --output-json=PATH  (Import only) Path to write the imported JSON skeleton',
    '  --force             Required for --remove (deprecated workflow)',
    '  --purge-files       Delete staged patch/blob resources when removing/uninstalling from JSON',
    '  --help              Show this message',
    '',
    'Examples:',
    '  enode.sh jstools/newgame.js data/newhack.json --create',
    '  enode.sh jstools/newgame.js data/newhack.json --prepare',
    '  enode.sh jstools/newgame.js data/newhack.json --check',
    '  enode.sh jstools/newgame.js data/newhack.json --add --force',
    '  enode.sh jstools/newgame.js data/newhack.json --remove --force --purge-files',
    '  enode.sh jstools/newgame.js data/newhack.json --uninstall',
    '  enode.sh jstools/newgame.js data/newhack.json --package=example.rhpak',
    '  enode.sh jstools/newgame.js example.rhpak --verify-package',
    '  enode.sh jstools/newgame.js example.rhpak --import --output-json=imported.json',
    '  enode.sh jstools/newgame.js example.rhpak --uninstall'
  ];
  console.log(lines.join('\n'));
}

/**
 * Interactive prompt helpers
 */

async function ask(rl, question, defaultValue = '', { allowEmpty = false, parser = (v) => v } = {}) {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await rl.question(`${question}${suffix}: `);
  if (!answer && defaultValue !== undefined) {
    if (!allowEmpty && defaultValue === '') {
      return parser(answer.trim());
    }
    return parser(defaultValue);
  }
  if (!allowEmpty && !answer.trim()) {
    return parser(defaultValue);
  }
  return parser(answer.trim());
}

async function askChoice(rl, question, choices, defaultValue = '') {
  const display = `${question} (${choices.join('/')})`;
  return ask(rl, display, defaultValue, {
    parser: (value) => {
      if (!value) return defaultValue;
      const normalized = value.trim();
      if (choices.includes(normalized)) {
        return normalized;
      }
      console.log(`  ⚠ Invalid choice. Expected one of: ${choices.join(', ')}`);
      return defaultValue || choices[0];
    }
  });
}

async function runCreateWizard(filePath, skeleton) {
  console.log('Interactive new game wizard\n');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const gv = skeleton.gameversion;

    gv.name = await ask(rl, 'Game name', gv.name);
    gv.gameid = await ask(rl, 'Game ID', gv.gameid);
    gv.version = parseInt(await ask(rl, 'Version number', gv.version.toString()), 10) || 1;
    gv.section = await ask(rl, 'Section', gv.section || 'smwhacks');
    gv.based_against = await ask(rl, 'Based against', gv.based_against || 'SMW');
    gv.gametype = await ask(rl, 'Game type / category', gv.gametype);
    gv.type = await askChoice(rl, 'Type label', [...DEFAULT_TYPES, 'Custom'], gv.type || DEFAULT_TYPES[0]);
    gv.difficulty = await askChoice(rl, 'Difficulty', ALLOWED_DIFFICULTIES, gv.difficulty || ALLOWED_DIFFICULTIES[0]);
    gv.raw_difficulty = await ask(rl, 'Raw difficulty code (diff_N)', gv.raw_difficulty || `diff_${Math.min(ALLOWED_DIFFICULTIES.indexOf(gv.difficulty) + 1, 7)}`);
    gv.length = await ask(rl, 'Length (e.g. "12 exit(s)")', gv.length || '');
    gv.demo = await askChoice(rl, 'Demo (Yes/No)', ['Yes', 'No'], gv.demo || 'No');
    gv.sa1 = await askChoice(rl, 'SA-1 (Yes/No)', ['Yes', 'No'], gv.sa1 || 'No');
    gv.collab = await askChoice(rl, 'Collab (Yes/No)', ['Yes', 'No'], gv.collab || 'No');
    gv.author = await ask(rl, 'Primary author', gv.author || '');
    gv.authors = await ask(rl, 'Author list (comma separated)', gv.authors || '');
    gv.submitter = await ask(rl, 'Submitter username', gv.submitter || gv.author);
    gv.legacy_type = await ask(rl, 'Legacy type (optional)', gv.legacy_type || '');
    gv.url = await ask(rl, 'Info URL (optional)', gv.url || '');
    gv.download_url = await ask(rl, 'Author download URL (optional)', gv.download_url || '');
    gv.name_href = await ask(rl, 'Name href (optional)', gv.name_href || '');
    gv.author_href = await ask(rl, 'Author href (optional)', gv.author_href || '');
    gv.obsoleted_by = await ask(rl, 'Obsoleted by (gameid)', gv.obsoleted_by || '');
    const editDescriptionChoice = await askChoice(rl, 'Edit Description', ['Yes', 'No'], 'No');
    if (editDescriptionChoice.toLowerCase() === 'yes') {
      const editorResult = await editDescriptionWithEditor(gv.description || '');
      if (editorResult.status === 'success') {
        gv.description = editorResult.text;
      } else if (editorResult.status === 'unavailable') {
        console.log('  ⚠ No external editor available; please enter the description below.');
        gv.description = await promptMultilineDescription(rl, gv.description || '');
      } else {
        gv.description = editorResult.text;
      }
    } else {
      gv.description = await promptMultilineDescription(rl, gv.description || '');
    }

    const tagAnswer = await ask(rl, 'Tags (comma separated)', (gv.tags || []).join(', '), { allowEmpty: true });
    gv.tags = tagAnswer ? tagAnswer.split(',').map((t) => t.trim()).filter(Boolean) : [];

    const warningAnswer = await ask(rl, 'Warnings (comma separated)', (gv.warnings || []).join(', '), { allowEmpty: true });
    gv.warnings = warningAnswer ? warningAnswer.split(',').map((t) => t.trim()).filter(Boolean) : [];

    const screenshotAnswer = await ask(rl, 'Screenshots (comma separated paths or URLs)', (gv.screenshots || []).join(', '), { allowEmpty: true });
    gv.screenshots = screenshotAnswer ? screenshotAnswer.split(',').map((t) => t.trim()).filter(Boolean) : [];

    gv.patch_local_path = pathToAbsolute(await ask(rl, 'Patch file path (.bps/.zip)', gv.patch_local_path || ''));
    gv.patch_filename = await ask(rl, 'Patch filename label', gv.patch_filename || path.basename(gv.patch_local_path || ''));
    gv.patch_notes = await ask(rl, 'Patch notes (optional)', gv.patch_notes || '');
    gv.submission_notes = await ask(rl, 'Submission notes (optional)', gv.submission_notes || '');

    skeleton.metadata.updated_at = new Date().toISOString();

    saveSkeleton(filePath, skeleton);
    console.log(`\n✓ Skeleton saved to ${filePath}`);
  } finally {
    rl.close();
  }
}

/**
 * Validation
 */

function validateSkeleton(skeleton, options = {}, baseDir) {
  const issues = [];
  const gv = skeleton.gameversion || {};
  const skipPatchFileCheck = options.skipPatchFileCheck === true;

  if (!gv.name) {
    issues.push({ level: 'error', message: 'Game name is required.' });
  }
  if (!gv.gameid) {
    issues.push({ level: 'error', message: 'Game ID is required.' });
  }
  if (!gv.gvuuid) {
    issues.push({ level: 'error', message: 'gvuuid is missing.' });
  }
  if (!skipPatchFileCheck) {
    if (!gv.patch_local_path) {
      issues.push({ level: 'error', message: 'Patch file path is required.' });
    } else {
      const patchPath = toAbsolutePath(gv.patch_local_path, baseDir);
      if (!patchPath || !fs.existsSync(patchPath)) {
        issues.push({ level: 'error', message: `Patch file not found: ${gv.patch_local_path}` });
      }
    }
  }
  if (!ALLOWED_DIFFICULTIES.includes(gv.difficulty)) {
    issues.push({ level: 'warning', message: `Difficulty "${gv.difficulty}" is not in canonical list.` });
  }

  if (!gv.type) {
    issues.push({ level: 'warning', message: 'Type label is empty.' });
  }

  if (!gv.author) {
    issues.push({ level: 'warning', message: 'Author is empty.' });
  }

  if (!skeleton.patchblob || !skeleton.patchblob.pbuuid) {
    issues.push({ level: 'warning', message: 'Patch blob UUID missing. It will be generated during --add.' });
  }
  if (!skeleton.attachment || !skeleton.attachment.auuid) {
    issues.push({ level: 'warning', message: 'Attachment UUID missing. It will be generated during --add.' });
  }

  if (options.rhdataPath && !fs.existsSync(options.rhdataPath)) {
    issues.push({ level: 'error', message: `rhdata.db not found: ${options.rhdataPath}` });
  }
  if (options.patchbinPath && !fs.existsSync(options.patchbinPath)) {
    issues.push({ level: 'error', message: `patchbin.db not found: ${options.patchbinPath}` });
  }
  if (options.resourcePath && !fs.existsSync(options.resourcePath)) {
    issues.push({ level: 'error', message: `resource.db not found: ${options.resourcePath}` });
  }
  if (options.screenshotPath && !fs.existsSync(options.screenshotPath)) {
    issues.push({ level: 'error', message: `screenshot.db not found: ${options.screenshotPath}` });
  }
  return issues;
}

function validatePreparedState(skeleton, baseDir) {
  const issues = [];
  if (!skeleton.metadata || !skeleton.metadata.prepared) {
    issues.push({ level: 'error', message: 'Skeleton has not been prepared. Run --prepare before --add.' });
  }
  if (!skeleton.metadata || !skeleton.metadata.rhpakuuid) {
    issues.push({ level: 'error', message: 'Prepared skeleton is missing rhpakuuid metadata. Re-run --prepare.' });
  }
  if (!skeleton.metadata || !skeleton.metadata.rhpakname) {
    issues.push({ level: 'warning', message: 'Prepared skeleton is missing rhpakname metadata. It will default during --prepare.' });
  }

  const patchInfo = skeleton.artifacts && skeleton.artifacts.patch;
  if (!patchInfo) {
    issues.push({ level: 'error', message: 'Prepared patch artifact details are missing.' });
  } else {
    const patchStoredAbs = toAbsolutePath(patchInfo.patch_stored_path, baseDir);
    if (!patchStoredAbs || !fs.existsSync(patchStoredAbs)) {
      issues.push({ level: 'error', message: `Prepared patch file is missing: ${patchInfo.patch_stored_path || '(not set)'}` });
    }
    const blobStoredAbs = toAbsolutePath(patchInfo.patchblob_stored_path, baseDir);
    if (!blobStoredAbs || !fs.existsSync(blobStoredAbs)) {
      issues.push({ level: 'error', message: `Prepared patchblob file is missing: ${patchInfo.patchblob_stored_path || '(not set)'}` });
    }
  }

  if (!Array.isArray(skeleton.resources) || skeleton.resources.length === 0) {
    issues.push({ level: 'warning', message: 'No prepared resource entries recorded.' });
  } else {
    for (const entry of skeleton.resources) {
      if (!entry) continue;
      if (entry.encrypted_data_path) {
        const encryptedAbs = toAbsolutePath(entry.encrypted_data_path, baseDir);
        if (!encryptedAbs || !fs.existsSync(encryptedAbs)) {
          issues.push({ level: 'error', message: `Resource encrypted data file missing: ${entry.encrypted_data_path}` });
        }
      } else if (entry.auto_generated) {
        issues.push({ level: 'error', message: `Auto-generated resource is missing encrypted data: ${entry.resource_uuid || '(unnamed)'}` });
      }
    }
  }

  if (!Array.isArray(skeleton.screenshots) || skeleton.screenshots.length === 0) {
    issues.push({ level: 'warning', message: 'No prepared screenshot entries recorded.' });
  } else {
    for (const entry of skeleton.screenshots) {
      if (!entry) continue;
      if (entry.kind === 'file') {
        if (!entry.encrypted_data_path) {
          issues.push({ level: 'error', message: `Screenshot file missing encrypted data path: ${entry.screenshot_uuid || '(unnamed)'}` });
          continue;
        }
        const encryptedAbs = toAbsolutePath(entry.encrypted_data_path, baseDir);
        if (!encryptedAbs || !fs.existsSync(encryptedAbs)) {
          issues.push({ level: 'error', message: `Screenshot encrypted data file missing: ${entry.encrypted_data_path}` });
        }
      } else if (entry.kind === 'url' && !entry.source_url) {
        issues.push({ level: 'warning', message: 'Screenshot URL entry is missing source_url.' });
      }
    }
  }

  return issues;
}

function printIssues(issues) {
  if (!issues.length) {
    console.log('✓ No validation issues detected.');
    return;
  }
  const sorted = issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  for (const issue of sorted) {
    const icon = issue.level === 'error' ? '✗' : '⚠';
    console.log(`${icon} ${issue.message}`);
  }
}

function summarizeDatabaseState(dbPaths, skeleton) {
  const summary = [];
  const { rhdataPath, patchbinPath, resourcePath, screenshotPath } = dbPaths;
  const gv = skeleton.gameversion;
  try {
    if (fs.existsSync(rhdataPath)) {
      const db = new Database(rhdataPath, { readonly: true });
      try {
        const existing = db.prepare('SELECT gvuuid FROM gameversions WHERE gameid = ? AND version = ?').get(gv.gameid, gv.version);
        if (existing) {
          summary.push(`ℹ gameversions entry already exists for ${gv.gameid} v${gv.version} (gvuuid=${existing.gvuuid})`);
        } else {
          summary.push(`✓ gameversions slot available for ${gv.gameid} v${gv.version}`);
        }
        const stats = db.prepare('SELECT gameid FROM gameversion_stats WHERE gameid = ?').get(gv.gameid);
        if (stats) {
          summary.push(`ℹ gameversion_stats entry exists for ${gv.gameid}`);
        }
        const patch = db.prepare('SELECT patchblob1_name FROM patchblobs WHERE patchblob1_name = ?').get(skeleton.patchblob.patchblob1_name || '');
        if (patch) {
          summary.push(`ℹ patchblobs entry already exists for ${patch.patchblob1_name}`);
        }
      } finally {
        db.close();
      }
    }
    if (fs.existsSync(patchbinPath) && skeleton.patchblob.patchblob1_name) {
      const db = new Database(patchbinPath, { readonly: true });
      try {
        const att = db.prepare('SELECT auuid FROM attachments WHERE file_name = ?').get(skeleton.patchblob.patchblob1_name);
        if (att) {
          summary.push(`ℹ attachments entry exists for ${skeleton.patchblob.patchblob1_name}`);
        }
      } finally {
        db.close();
      }
    }
    if (resourcePath && fs.existsSync(resourcePath)) {
      const db = new Database(resourcePath, { readonly: true });
      try {
        const res = db.prepare('SELECT COUNT(*) AS cnt FROM res_attachments WHERE gvuuid = ?').get(gv.gvuuid);
        if (res && res.cnt > 0) {
          summary.push(`ℹ resource entries already recorded: ${res.cnt}`);
        }
      } finally {
        db.close();
      }
    }
    if (screenshotPath && fs.existsSync(screenshotPath)) {
      const db = new Database(screenshotPath, { readonly: true });
      try {
        const scr = db.prepare('SELECT COUNT(*) AS cnt FROM res_screenshots WHERE gvuuid = ?').get(gv.gvuuid);
        if (scr && scr.cnt > 0) {
          summary.push(`ℹ screenshot entries already recorded: ${scr.cnt}`);
        }
      } finally {
        db.close();
      }
    }
  } catch (error) {
    summary.push(`✗ Failed to inspect database state: ${error.message}`);
  }

  for (const line of summary) {
    console.log(line);
  }
}

async function handlePrepare(config, skeleton) {
  const baseDir = config.baseDir || path.dirname(config.jsonPath);
  const issues = validateSkeleton(skeleton, {
    rhdataPath: config.rhdataPath,
    patchbinPath: config.patchbinPath
  }, baseDir);
  printIssues(issues);
  if (issues.some((i) => i.level === 'error')) {
    throw new Error('Cannot prepare artifacts while validation errors exist.');
  }

  const metadata = ensureRhpakMetadata(skeleton);
  metadata.rhpakname = metadata.rhpakname || buildDefaultRhpakName(skeleton.gameversion || {});
  metadata.rhpakuuid = metadata.rhpakuuid || generateUuid();

  pruneAutoGeneratedResources(skeleton, baseDir);
  pruneAutoGeneratedScreenshots(skeleton, baseDir);

  const artifact = await preparePatchArtifacts(skeleton, baseDir);

  const rhpakuuid = metadata.rhpakuuid;
  skeleton.gameversion = skeleton.gameversion || {};
  skeleton.gameversion.rhpakuuid = rhpakuuid;

  const patchResourceEntry = buildPatchResourceEntry(skeleton, artifact, baseDir);
  const manualResources = Array.isArray(skeleton.resources) ? skeleton.resources : [];
  skeleton.resources = mergeResourceEntries(manualResources, [patchResourceEntry]);

  const autoScreenshots = await buildScreenshotEntries(skeleton, baseDir);
  const manualScreenshots = Array.isArray(skeleton.screenshots) ? skeleton.screenshots : [];
  skeleton.screenshots = mergeScreenshotEntries(manualScreenshots, autoScreenshots);

  skeleton.resources = (skeleton.resources || []).map((entry) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      if (!entry.rhpakuuid) {
        return { ...entry, rhpakuuid };
      }
    }
    return entry;
  });
  skeleton.screenshots = (skeleton.screenshots || []).map((entry) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      if (!entry.rhpakuuid) {
        return { ...entry, rhpakuuid };
      }
    }
    return entry;
  });

  skeleton.artifacts = skeleton.artifacts || {};
  skeleton.artifacts.patch = {
    file_name: artifact.fileName,
    file_ext: artifact.extension,
    file_size: artifact.size,
    pat_sha1: artifact.patSha1,
    pat_sha224: artifact.patSha224,
    pat_sha256: artifact.patSha256,
    pat_md5: artifact.patHashMd5,
    crc16: artifact.crc16,
    crc32: artifact.crc32,
    ipfs_cid_v0: artifact.ipfsCidV0,
    ipfs_cid_v1: artifact.ipfsCidV1,
    patch_relative_path: artifact.patchRelativePath,
    patchblob_relative_path: artifact.patchblobRelativePath,
    patch_stored_path: artifact.patchStoredRelativePath,
    patchblob_stored_path: artifact.patchblobStoredRelativePath,
    source_path: artifact.sourceRelativePath || artifact.patchRelativePath,
    prepared_at: new Date().toISOString()
  };

  skeleton.gameversion.patch = artifact.patchRelativePath;
  skeleton.gameversion.patchblob1_name = artifact.patchblobName;
  skeleton.gameversion.pat_sha224 = artifact.patSha224;
  skeleton.gameversion.patch_local_path = artifact.patchRelativePath;

  skeleton.patchblob = skeleton.patchblob || {};
  skeleton.patchblob.rhpakuuid = rhpakuuid;
  skeleton.patchblob.patchblob1_name = artifact.patchblobName;
  skeleton.patchblob.patchblob1_sha224 = artifact.patSha224;
  skeleton.patchblob.pat_sha1 = artifact.patSha1;
  skeleton.patchblob.pat_sha224 = artifact.patSha224;
  skeleton.patchblob.pat_shake_128 = artifact.patShake128;
  skeleton.patchblob.patch_name = artifact.patchRelativePath;

  skeleton.attachment = skeleton.attachment || {};
  skeleton.attachment.rhpakuuid = rhpakuuid;
  skeleton.attachment.file_name = artifact.patchblobName;

  skeleton.metadata.prepared = true;
  skeleton.metadata.prepared_at = new Date().toISOString();

  // Remove large buffers before saving
  delete artifact.buffer;

  saveSkeleton(config.jsonPath, skeleton);
  console.log(`\n✓ Prepared artifacts for ${skeleton.gameversion.gameid} v${skeleton.gameversion.version}`);
  console.log(`  Patch stored at: ${skeleton.artifacts.patch.patch_stored_path}`);
  console.log(`  Resources staged: ${skeleton.resources.length}`);
  console.log(`  Screenshots staged: ${skeleton.screenshots.length}`);
}

/**
 * Patch and attachment preparation
 */

async function preparePatchArtifacts(skeleton, baseDir) {
  const gv = skeleton.gameversion;
  const patchPath = toAbsolutePath(gv.patch_local_path, baseDir);
  const buffer = fs.readFileSync(patchPath);
  const stats = fs.statSync(patchPath);
  const extension = path.extname(patchPath).replace('.', '').toLowerCase();

  const patSha224 = sha224(buffer);
  const patSha1 = sha1(buffer);
  const patSha256 = sha256(buffer);
  const patShake128 = shake128Base64Url(buffer);
  const ipfsCids = await computeIpfsCids(buffer);
  const patchblobName = `pblob_${gv.gameid}_${patSha224.slice(0, 10)}`;
  const patchRelative = normalizeRelativePath(path.join('patch', patShake128));
  const patchStoredAbs = path.join(baseDir, patchRelative);
  ensureDir(path.dirname(patchStoredAbs));
  fs.copyFileSync(patchPath, patchStoredAbs);

  const patchblobRelative = normalizeRelativePath(path.join('blobs', patchblobName));
  const patchBlobStoredAbs = path.join(baseDir, patchblobRelative);
  ensureDir(path.dirname(patchBlobStoredAbs));
  fs.writeFileSync(patchBlobStoredAbs, buffer);
  const sourceRelative = normalizeRelativePath(path.relative(baseDir, patchPath));
  const sourceInBase = !sourceRelative.startsWith('..');

  return {
    buffer,
    size: stats.size,
    extension,
    fileName: path.basename(patchPath),
    sourcePath: patchPath,
    sourceRelativePath: sourceInBase ? sourceRelative : null,
    patSha224,
    patSha1,
    patSha256,
    patHashMd5: md5(buffer),
    patShake128,
    crc16: crc16(buffer),
    crc32: crc32Hex(buffer),
    ipfsCidV0: ipfsCids.cidV0,
    ipfsCidV1: ipfsCids.cidV1,
    patchblobName,
    patchStoredPath: patchStoredAbs,
    patchStoredRelativePath: patchRelative,
    patchRelativePath: patchRelative,
    patchblobStoredPath: patchBlobStoredAbs,
    patchblobStoredRelativePath: patchblobRelative,
    patchblobRelativePath: patchblobRelative
  };
}

/**
 * Upsert operations
 */

function upsertGameversion(db, skeleton, artifact, options) {
  const gv = skeleton.gameversion;
  const now = new Date().toISOString();
  const tagsString = gv.tags && gv.tags.length ? JSON.stringify(gv.tags) : null;
  const warningsString = gv.warnings && gv.warnings.length ? JSON.stringify(gv.warnings) : null;
  const rhpakuuid = (skeleton.metadata && skeleton.metadata.rhpakuuid) || gv.rhpakuuid;
  if (!rhpakuuid) {
    throw new Error('rhpakuuid metadata missing for gameversion upsert. Re-run --prepare.');
  }
  const jsonPayload = {
    id: gv.gameid,
    gameid: gv.gameid,
    name: gv.name,
    authors: gv.authors || gv.author || '',
    author: gv.author || '',
    submitter: gv.submitter || gv.author || '',
    description: gv.description || '',
    url: gv.url || '',
    download_url: gv.download_url || '',
    length: gv.length || '',
    difficulty: gv.difficulty || '',
    raw_difficulty: gv.raw_difficulty || '',
    type: gv.type || gv.gametype || '',
    gametype: gv.gametype || '',
    based_against: gv.based_against || 'SMW',
    demo: gv.demo || 'No',
    sa1: gv.sa1 || 'No',
    collab: gv.collab || 'No',
    tags: gv.tags || [],
    warnings: gv.warnings || [],
    screenshots: gv.screenshots || [],
    patch: artifact.patchRelativePath,
    patch_filename: gv.patch_filename || path.basename(gv.patch_local_path || ''),
    pat_sha1: artifact.patSha1,
    pat_sha224: artifact.patSha224,
    pat_shake_128: artifact.patShake128,
    patchblob1_name: artifact.patchblobName,
    patchblob1_sha224: artifact.patSha224,
    patchblob1_key: null,
    submission_notes: gv.submission_notes || '',
    patch_notes: gv.patch_notes || '',
    name_href: gv.name_href || '',
    author_href: gv.author_href || '',
    obsoleted_by: gv.obsoleted_by || ''
  };

  const query = `
    INSERT INTO gameversions (
      gvuuid, section, gameid, version, removed, obsoleted, gametype, name,
      time, added, moderated, author, authors, submitter, demo, featured,
      length, difficulty, url, download_url, name_href, author_href, obsoleted_by,
      patchblob1_name, pat_sha224, size, description, gvjsondata, tags,
      tags_href, gvchange_attributes, gvchanges, fields_type, raw_difficulty,
      combinedtype, legacy_type, rhpakuuid
    )
    VALUES (
      @gvuuid, @section, @gameid, @version, @removed, @obsoleted, @gametype, @name,
      @time, @added, @moderated, @author, @authors, @submitter, @demo, @featured,
      @length, @difficulty, @url, @download_url, @name_href, @author_href, @obsoleted_by,
      @patchblob1_name, @pat_sha224, @size, @description, @gvjsondata, @tags,
      NULL, NULL, NULL, @fields_type, @raw_difficulty,
      NULL, @legacy_type, @rhpakuuid
    )
    ON CONFLICT(gameid, version) DO UPDATE SET
      section = excluded.section,
      removed = excluded.removed,
      obsoleted = excluded.obsoleted,
      gametype = excluded.gametype,
      name = excluded.name,
      time = excluded.time,
      added = excluded.added,
      moderated = excluded.moderated,
      author = excluded.author,
      authors = excluded.authors,
      submitter = excluded.submitter,
      demo = excluded.demo,
      featured = excluded.featured,
      length = excluded.length,
      difficulty = excluded.difficulty,
      url = excluded.url,
      download_url = excluded.download_url,
      name_href = excluded.name_href,
      author_href = excluded.author_href,
      obsoleted_by = excluded.obsoleted_by,
      patchblob1_name = excluded.patchblob1_name,
      pat_sha224 = excluded.pat_sha224,
      size = excluded.size,
      description = excluded.description,
      gvjsondata = excluded.gvjsondata,
      tags = excluded.tags,
      fields_type = excluded.fields_type,
      raw_difficulty = excluded.raw_difficulty,
      legacy_type = excluded.legacy_type,
      rhpakuuid = excluded.rhpakuuid
  `;

  const params = {
    gvuuid: gv.gvuuid,
    section: gv.section || 'smwhacks',
    gameid: gv.gameid,
    version: gv.version || 1,
    removed: gv.removed || 0,
    obsoleted: gv.obsoleted || 0,
    gametype: gv.gametype || gv.type || '',
    name: gv.name,
    time: now,
    added: now,
    moderated: gv.moderated || 0,
    author: gv.author || '',
    authors: gv.authors || gv.author || '',
    submitter: gv.submitter || gv.author || '',
    demo: gv.demo || 'No',
    featured: gv.featured || 0,
    length: gv.length || '',
    difficulty: gv.difficulty || '',
    url: gv.url || '',
    download_url: gv.download_url || '',
    name_href: gv.name_href || '',
    author_href: gv.author_href || '',
    obsoleted_by: gv.obsoleted_by || '',
    patchblob1_name: artifact.patchblobName,
    pat_sha224: artifact.patSha224,
    size: artifact.size.toString(),
    description: gv.description || '',
    gvjsondata: JSON.stringify(jsonPayload),
    tags: tagsString,
    fields_type: gv.type || gv.gametype || '',
    raw_difficulty: gv.raw_difficulty || '',
    legacy_type: gv.legacy_type || '',
    rhpakuuid
  };

  const existing = db.prepare('SELECT gvuuid, rhpakuuid FROM gameversions WHERE gameid = ? AND version = ?')
    .get(gv.gameid, gv.version);
  if (existing) {
    if (existing.rhpakuuid && existing.rhpakuuid !== rhpakuuid) {
      throw new Error(`Existing gameversion ${gv.gameid} v${gv.version} belongs to rhpak ${existing.rhpakuuid} and cannot be replaced by ${rhpakuuid}.`);
    }
    if (!existing.rhpakuuid && existing.gvuuid && existing.gvuuid !== gv.gvuuid) {
      throw new Error(`Existing gameversion ${gv.gameid} v${gv.version} lacks rhpak ownership and cannot be replaced.`);
    }
  }

  db.prepare(query).run(params);
}

function upsertGameversionStats(db, skeleton) {
  const gv = skeleton.gameversion;
  const rhpakuuid = (skeleton.metadata && skeleton.metadata.rhpakuuid) || gv.rhpakuuid;
  if (!rhpakuuid) {
    throw new Error('rhpakuuid metadata missing for gameversion_stats upsert.');
  }
  const stats = skeleton.gameversion_stats || {};
  const query = `
    INSERT INTO gameversion_stats (
      gameid, gvuuid, download_count, view_count, comment_count,
      rating_value, rating_count, favorite_count, hof_status,
      featured_status, gvjsondata, rhpakuuid
    )
    VALUES (
      @gameid, @gvuuid, @download_count, @view_count, @comment_count,
      @rating_value, @rating_count, @favorite_count, @hof_status,
      @featured_status, @gvjsondata, @rhpakuuid
    )
    ON CONFLICT(gameid) DO UPDATE SET
      gvuuid = excluded.gvuuid,
      download_count = excluded.download_count,
      view_count = excluded.view_count,
      comment_count = excluded.comment_count,
      rating_value = excluded.rating_value,
      rating_count = excluded.rating_count,
      favorite_count = excluded.favorite_count,
      hof_status = excluded.hof_status,
      featured_status = excluded.featured_status,
      gvjsondata = excluded.gvjsondata,
      rhpakuuid = excluded.rhpakuuid,
      last_updated = CURRENT_TIMESTAMP
  `;

  const payload = {
    gameid: gv.gameid,
    gvuuid: gv.gvuuid,
    download_count: stats.download_count || 0,
    view_count: stats.view_count || 0,
    comment_count: stats.comment_count || 0,
    rating_value: stats.rating_value,
    rating_count: stats.rating_count || 0,
    favorite_count: stats.favorite_count || 0,
    hof_status: stats.hof_status || null,
    featured_status: stats.featured_status || null,
    gvjsondata: JSON.stringify({
      id: gv.gameid,
      download_count: stats.download_count || 0,
      view_count: stats.view_count || 0,
      comment_count: stats.comment_count || 0,
      rating_value: stats.rating_value,
      rating_count: stats.rating_count || 0,
      favorite_count: stats.favorite_count || 0
    }),
    rhpakuuid
  };

  const existing = db.prepare('SELECT rhpakuuid FROM gameversion_stats WHERE gameid = ?').get(gv.gameid);
  if (existing) {
    if (existing.rhpakuuid && existing.rhpakuuid !== rhpakuuid) {
      throw new Error(`Existing gameversion_stats for ${gv.gameid} belongs to rhpak ${existing.rhpakuuid} and cannot be replaced by ${rhpakuuid}.`);
    }
    if (!existing.rhpakuuid) {
      throw new Error(`Existing gameversion_stats for ${gv.gameid} was not installed via an rhpak and cannot be replaced.`);
    }
  }

  db.prepare(query).run(payload);
}

function upsertPatchblob(db, skeleton, artifact) {
  const gv = skeleton.gameversion;
  const pb = skeleton.patchblob;
  const rhpakuuid = (skeleton.metadata && skeleton.metadata.rhpakuuid) || gv.rhpakuuid || pb.rhpakuuid;
  if (!rhpakuuid) {
    throw new Error('rhpakuuid metadata missing for patchblob upsert.');
  }
  if (!pb.pbuuid) {
    pb.pbuuid = generateUuid();
  }

  const query = `
    INSERT INTO patchblobs (
      pbuuid, gvuuid, patch_name, pat_sha1, pat_sha224, pat_shake_128,
      patchblob1_key, patchblob1_name, patchblob1_sha224,
      result_sha1, result_sha224, result_shake1, pbjsondata, rhpakuuid
    )
    VALUES (
      @pbuuid, @gvuuid, @patch_name, @pat_sha1, @pat_sha224, @pat_shake_128,
      @patchblob1_key, @patchblob1_name, @patchblob1_sha224,
      @result_sha1, @result_sha224, @result_shake1, @pbjsondata, @rhpakuuid
    )
    ON CONFLICT(patchblob1_name) DO UPDATE SET
      gvuuid = excluded.gvuuid,
      patch_name = excluded.patch_name,
      pat_sha1 = excluded.pat_sha1,
      pat_sha224 = excluded.pat_sha224,
      pat_shake_128 = excluded.pat_shake_128,
      patchblob1_key = excluded.patchblob1_key,
      patchblob1_sha224 = excluded.patchblob1_sha224,
      result_sha1 = excluded.result_sha1,
      result_sha224 = excluded.result_sha224,
      result_shake1 = excluded.result_shake1,
      pbjsondata = excluded.pbjsondata,
      rhpakuuid = excluded.rhpakuuid
  `;

  const payload = {
    pbuuid: pb.pbuuid,
    gvuuid: gv.gvuuid,
    patch_name: artifact.patchRelativePath,
    pat_sha1: artifact.patSha1,
    pat_sha224: artifact.patSha224,
    pat_shake_128: artifact.patShake128,
    patchblob1_key: pb.patchblob1_key || null,
    patchblob1_name: artifact.patchblobName,
    patchblob1_sha224: artifact.patSha224,
    result_sha1: pb.result_sha1 || null,
    result_sha224: pb.result_sha224 || null,
    result_shake1: pb.result_shake1 || null,
    pbjsondata: JSON.stringify({
      patch: artifact.patchRelativePath,
      pat_sha1: artifact.patSha1,
      pat_sha224: artifact.patSha224,
      pat_shake_128: artifact.patShake128,
      patchblob1_name: artifact.patchblobName
    }),
    rhpakuuid
  };

  const existing = db.prepare('SELECT rhpakuuid FROM patchblobs WHERE patchblob1_name = ?').get(artifact.patchblobName);
  if (existing) {
    if (existing.rhpakuuid && existing.rhpakuuid !== rhpakuuid) {
      throw new Error(`Patchblob ${artifact.patchblobName} belongs to rhpak ${existing.rhpakuuid} and cannot be replaced by ${rhpakuuid}.`);
    }
    if (!existing.rhpakuuid) {
      throw new Error(`Patchblob ${artifact.patchblobName} was not installed via an rhpak and cannot be replaced.`);
    }
  }

  db.prepare(query).run(payload);
  pb.patchblob1_name = artifact.patchblobName;
  pb.patchblob1_sha224 = artifact.patSha224;
  pb.pat_sha1 = artifact.patSha1;
  pb.pat_sha224 = artifact.patSha224;
  pb.pat_shake_128 = artifact.patShake128;
  pb.patch_name = artifact.patchRelativePath;
}

function upsertPatchblobExtended(db, skeleton, artifact) {
  const pb = skeleton.patchblob;
  const gv = skeleton.gameversion;
  const rhpakuuid = (skeleton.metadata && skeleton.metadata.rhpakuuid) || gv.rhpakuuid || pb.rhpakuuid;
  if (!rhpakuuid) {
    throw new Error('rhpakuuid metadata missing for patchblobs_extended upsert.');
  }
  const query = `
    INSERT INTO patchblobs_extended (
      pbuuid, patch_filename, patch_type, is_primary, zip_source, rhpakuuid
    )
    VALUES (
      @pbuuid, @patch_filename, @patch_type, @is_primary, @zip_source, @rhpakuuid
    )
    ON CONFLICT(pbuuid) DO UPDATE SET
      patch_filename = excluded.patch_filename,
      patch_type = excluded.patch_type,
      is_primary = excluded.is_primary,
      zip_source = excluded.zip_source,
      rhpakuuid = excluded.rhpakuuid
  `;

  const existing = db.prepare('SELECT rhpakuuid FROM patchblobs_extended WHERE pbuuid = ?').get(pb.pbuuid);
  if (existing) {
    if (existing.rhpakuuid && existing.rhpakuuid !== rhpakuuid) {
      throw new Error(`patchblobs_extended entry ${pb.pbuuid} belongs to rhpak ${existing.rhpakuuid} and cannot be replaced by ${rhpakuuid}.`);
    }
    if (!existing.rhpakuuid) {
      throw new Error(`patchblobs_extended entry ${pb.pbuuid} was not installed via an rhpak and cannot be replaced.`);
    }
  }

  db.prepare(query).run({
    pbuuid: pb.pbuuid,
    patch_filename: gv.patch_filename || path.basename(gv.patch_local_path || artifact.patchblobName),
    patch_type: artifact.extension || 'bps',
    is_primary: 1,
    zip_source: null,
    rhpakuuid
  });
}

function upsertAttachment(db, skeleton, artifact) {
  const pb = skeleton.patchblob;
  const gv = skeleton.gameversion;
  const at = skeleton.attachment;
  const rhpakuuid = (skeleton.metadata && skeleton.metadata.rhpakuuid) || gv.rhpakuuid || pb.rhpakuuid || at.rhpakuuid;
  if (!rhpakuuid) {
    throw new Error('rhpakuuid metadata missing for attachment upsert.');
  }
  if (!at.auuid) {
    at.auuid = generateUuid();
  }

  const existing = db.prepare('SELECT auuid, rhpakuuid FROM attachments WHERE file_name = ?').get(artifact.patchblobName);
  if (existing) {
    if (existing.rhpakuuid && existing.rhpakuuid !== rhpakuuid) {
      throw new Error(`Attachment ${artifact.patchblobName} belongs to rhpak ${existing.rhpakuuid} and cannot be replaced by ${rhpakuuid}.`);
    }
    if (!existing.rhpakuuid) {
      throw new Error(`Attachment ${artifact.patchblobName} was not installed via an rhpak and cannot be replaced.`);
    }
    at.auuid = existing.auuid;
  }

  const query = `
    REPLACE INTO attachments (
      auuid, pbuuid, gvuuid, rhpakuuid, resuuid,
      file_crc16, file_crc32, locators, parents,
      file_ipfs_cidv0, file_ipfs_cidv1,
      file_hash_sha224, file_hash_sha1, file_hash_md5, file_hash_sha256,
      file_name, filekey,
      decoded_ipfs_cidv0, decoded_ipfs_cidv1,
      decoded_hash_sha224, decoded_hash_sha1, decoded_hash_md5, decoded_hash_sha256,
      file_data, download_urls, file_size
    )
    VALUES (
      @auuid, @pbuuid, @gvuuid, @rhpakuuid, NULL,
      @file_crc16, @file_crc32, @locators, @parents,
      @file_ipfs_cidv0, @file_ipfs_cidv1,
      @file_hash_sha224, @file_hash_sha1, @file_hash_md5, @file_hash_sha256,
      @file_name, @filekey,
      '', '', '', '', '', '',
      @file_data, @download_urls, @file_size
    )
  `;

  db.prepare(query).run({
    auuid: at.auuid,
    pbuuid: pb.pbuuid,
    gvuuid: gv.gvuuid,
    rhpakuuid,
    file_crc16: artifact.crc16,
    file_crc32: artifact.crc32,
    locators: JSON.stringify([]),
    parents: JSON.stringify([]),
    file_ipfs_cidv0: artifact.ipfsCidV0,
    file_ipfs_cidv1: artifact.ipfsCidV1,
    file_hash_sha224: artifact.patSha224,
    file_hash_sha1: artifact.patSha1,
    file_hash_md5: artifact.patHashMd5,
    file_hash_sha256: artifact.patSha256,
    file_name: artifact.patchblobName,
    filekey: '',
    file_data: artifact.buffer,
    download_urls: (at.download_urls || []).concat(gv.download_url ? [gv.download_url] : []).join(','),
    file_size: artifact.size
  });

  at.file_name = artifact.patchblobName;
  at.rhpakuuid = rhpakuuid;
}

function upsertPatchRecord(db, skeleton, artifact) {
  const gv = skeleton.gameversion;
  const rhpakuuid = (skeleton.metadata && skeleton.metadata.rhpakuuid) || gv.rhpakuuid;
  if (!rhpakuuid) {
    throw new Error('rhpakuuid metadata missing for rhpatches upsert.');
  }
  const existing = db.prepare('SELECT rhpakuuid FROM rhpatches WHERE patch_name = ?').get(artifact.patchRelativePath);
  if (existing) {
    if (existing.rhpakuuid && existing.rhpakuuid !== rhpakuuid) {
      throw new Error(`Patch record ${artifact.patchRelativePath} belongs to rhpak ${existing.rhpakuuid} and cannot be replaced by ${rhpakuuid}.`);
    }
    if (!existing.rhpakuuid) {
      throw new Error(`Patch record ${artifact.patchRelativePath} was not installed via an rhpak and cannot be replaced.`);
    }
  }
  const query = `
    INSERT INTO rhpatches (rhpuuid, gameid, patch_name, rhpakuuid)
    VALUES (@rhpuuid, @gameid, @patch_name, @rhpakuuid)
    ON CONFLICT(patch_name) DO UPDATE SET
      gameid = excluded.gameid,
      rhpakuuid = excluded.rhpakuuid
  `;
  db.prepare(query).run({
    rhpuuid: generateUuid(),
    gameid: gv.gameid,
    patch_name: artifact.patchRelativePath,
    rhpakuuid
  });
}

function upsertRhpakRecord(db, skeleton) {
  const metadata = skeleton.metadata || {};
  const rhpakuuid = metadata.rhpakuuid;
  if (!rhpakuuid) {
    throw new Error('rhpakuuid metadata missing for rhpak registration.');
  }
  const name = (metadata.rhpakname && metadata.rhpakname.trim())
    ? metadata.rhpakname.trim()
    : buildDefaultRhpakName(skeleton.gameversion || {});
  const query = `
    INSERT INTO rhpakages (rhpakuuid, name)
    VALUES (@rhpakuuid, @name)
    ON CONFLICT(rhpakuuid) DO UPDATE SET
      name = excluded.name,
      updated_at = CURRENT_TIMESTAMP
  `;
  db.prepare(query).run({ rhpakuuid, name });
}

function upsertPreparedResources(resourceDb, skeleton, payloads) {
  if (!payloads || payloads.length === 0) {
    return;
  }
  const gv = skeleton.gameversion;
  const rhpakuuid = (skeleton.metadata && skeleton.metadata.rhpakuuid) || gv.rhpakuuid;
  if (!rhpakuuid) {
    throw new Error('rhpakuuid metadata missing for res_attachments upsert.');
  }
  const insertStmt = resourceDb.prepare(`
    INSERT INTO res_attachments (
      rauuid, resource_scope, linked_type, linked_uuid,
      gameid, gvuuid, rhpakuuid, description,
      file_name, file_ext, file_size,
      file_sha224, file_sha256, file_sha1, file_md5,
      file_crc16, file_crc32,
      encoded_sha256, decoded_sha256,
      encrypted_data, fernet_key,
      download_url, ipfs_cid_v1, ipfs_cid_v0,
      arweave_file_id, arweave_file_url,
      ardrive_file_name, ardrive_file_id, ardrive_file_path,
      storage_path, blob_storage_path, source_path
    )
    VALUES (
      @rauuid, @resource_scope, @linked_type, @linked_uuid,
      @gameid, @gvuuid, @rhpakuuid, @description,
      @file_name, @file_ext, @file_size,
      @file_sha224, @file_sha256, @file_sha1, @file_md5,
      @file_crc16, @file_crc32,
      @encoded_sha256, @decoded_sha256,
      @encrypted_data, @fernet_key,
      @download_url, @ipfs_cid_v1, @ipfs_cid_v0,
      @arweave_file_id, @arweave_file_url,
      @ardrive_file_name, @ardrive_file_id, @ardrive_file_path,
      @storage_path, @blob_storage_path, @source_path
    )
    ON CONFLICT(file_sha256) DO UPDATE SET
      resource_scope = excluded.resource_scope,
      linked_type = excluded.linked_type,
      linked_uuid = excluded.linked_uuid,
      gameid = excluded.gameid,
      gvuuid = excluded.gvuuid,
      description = excluded.description,
      encrypted_data = excluded.encrypted_data,
      fernet_key = excluded.fernet_key,
      download_url = excluded.download_url,
      ipfs_cid_v1 = excluded.ipfs_cid_v1,
      ipfs_cid_v0 = excluded.ipfs_cid_v0,
      arweave_file_id = excluded.arweave_file_id,
      arweave_file_url = excluded.arweave_file_url,
      ardrive_file_name = excluded.ardrive_file_name,
      ardrive_file_id = excluded.ardrive_file_id,
      ardrive_file_path = excluded.ardrive_file_path,
      storage_path = excluded.storage_path,
      blob_storage_path = excluded.blob_storage_path,
      source_path = excluded.source_path,
      rhpakuuid = excluded.rhpakuuid,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const payload of payloads) {
    const entry = payload.entry;
    const rauuid = entry.resource_uuid || generateUuid();
    entry.resource_uuid = rauuid;
    const effectiveFileSha256 = entry.file_sha256 || (payload.decodedBuffer ? sha256(payload.decodedBuffer) : null);
    if (effectiveFileSha256) {
      const existing = resourceDb.prepare('SELECT rhpakuuid FROM res_attachments WHERE file_sha256 = ?').get(effectiveFileSha256);
      if (existing) {
        const entryRhpak = entry.rhpakuuid || rhpakuuid;
        if (existing.rhpakuuid && existing.rhpakuuid !== entryRhpak) {
          throw new Error(`Resource file ${entry.file_name || effectiveFileSha256} belongs to rhpak ${existing.rhpakuuid} and cannot be replaced by ${entryRhpak}.`);
        }
        if (!existing.rhpakuuid) {
          throw new Error(`Resource file ${entry.file_name || effectiveFileSha256} was not installed via an rhpak and cannot be replaced.`);
        }
      }
    }
    const effectiveFileSha224 = entry.file_sha224 || (payload.decodedBuffer ? sha224(payload.decodedBuffer) : null);
    const effectiveEncodedSha = entry.encoded_sha256 || (payload.encryptedBuffer ? sha256(payload.encryptedBuffer) : null);
    const effectiveDecodedSha = entry.decoded_sha256 || (payload.decodedBuffer ? sha256(payload.decodedBuffer) : null);
    insertStmt.run({
      rauuid,
      resource_scope: entry.resource_scope || 'gameversion',
      linked_type: entry.linked_type || 'gameversion',
      linked_uuid: entry.linked_uuid || gv.gvuuid,
      gameid: entry.gameid || gv.gameid,
      gvuuid: entry.gvuuid || gv.gvuuid,
      rhpakuuid: entry.rhpakuuid || rhpakuuid,
      description: entry.description || null,
      file_name: entry.file_name,
      file_ext: entry.file_ext || null,
      file_size: entry.file_size || (payload.decodedBuffer ? payload.decodedBuffer.length : null),
      file_sha224: effectiveFileSha224,
      file_sha256: effectiveFileSha256,
      file_sha1: entry.file_sha1 || null,
      file_md5: entry.file_md5 || null,
      file_crc16: entry.file_crc16 || null,
      file_crc32: entry.file_crc32 || null,
      encoded_sha256: effectiveEncodedSha,
      decoded_sha256: effectiveDecodedSha,
      encrypted_data: payload.encryptedBuffer,
      fernet_key: entry.fernet_key,
      download_url: entry.download_url || null,
      ipfs_cid_v1: entry.ipfs_cid_v1 || null,
      ipfs_cid_v0: entry.ipfs_cid_v0 || null,
      arweave_file_id: entry.arweave_file_id || null,
      arweave_file_url: entry.arweave_file_url || null,
      ardrive_file_name: entry.ardrive_file_name || null,
      ardrive_file_id: entry.ardrive_file_id || null,
      ardrive_file_path: entry.ardrive_file_path || null,
      storage_path: entry.storage_path || null,
      blob_storage_path: entry.blob_storage_path || null,
      source_path: entry.source_path || null
    });
  }
}

function upsertPreparedScreenshots(screenshotDb, skeleton, payloads) {
  if (!payloads || payloads.length === 0) {
    return;
  }
  const gv = skeleton.gameversion;
  const rhpakuuid = (skeleton.metadata && skeleton.metadata.rhpakuuid) || gv.rhpakuuid;
  if (!rhpakuuid) {
    throw new Error('rhpakuuid metadata missing for res_screenshots upsert.');
  }

  const insertFileStmt = screenshotDb.prepare(`
    INSERT INTO res_screenshots (
      rsuuid, screenshot_type, kind,
      gameid, gvuuid, rhpakuuid,
      source_url, file_name, file_ext, file_size,
      file_sha256, encoded_sha256, decoded_sha256,
      encrypted_data, fernet_key,
      download_url, ipfs_cid_v1, ipfs_cid_v0,
      arweave_file_id, arweave_file_url,
      ardrive_file_name, ardrive_file_id, ardrive_file_path,
      storage_path, source_path
    )
    VALUES (
      @rsuuid, @screenshot_type, @kind,
      @gameid, @gvuuid, @rhpakuuid,
      @source_url, @file_name, @file_ext, @file_size,
      @file_sha256, @encoded_sha256, @decoded_sha256,
      @encrypted_data, @fernet_key,
      @download_url, @ipfs_cid_v1, @ipfs_cid_v0,
      @arweave_file_id, @arweave_file_url,
      @ardrive_file_name, @ardrive_file_id, @ardrive_file_path,
      @storage_path, @source_path
    )
    ON CONFLICT(file_sha256) DO UPDATE SET
      screenshot_type = excluded.screenshot_type,
      kind = excluded.kind,
      gameid = excluded.gameid,
      gvuuid = excluded.gvuuid,
      source_url = excluded.source_url,
      file_name = excluded.file_name,
      file_ext = excluded.file_ext,
      file_size = excluded.file_size,
      encrypted_data = excluded.encrypted_data,
      fernet_key = excluded.fernet_key,
      download_url = excluded.download_url,
      ipfs_cid_v1 = excluded.ipfs_cid_v1,
      ipfs_cid_v0 = excluded.ipfs_cid_v0,
      arweave_file_id = excluded.arweave_file_id,
      arweave_file_url = excluded.arweave_file_url,
      ardrive_file_name = excluded.ardrive_file_name,
      ardrive_file_id = excluded.ardrive_file_id,
      ardrive_file_path = excluded.ardrive_file_path,
      storage_path = excluded.storage_path,
      source_path = excluded.source_path,
      rhpakuuid = excluded.rhpakuuid,
      updated_at = CURRENT_TIMESTAMP
  `);

  const insertUrlStmt = screenshotDb.prepare(`
    INSERT INTO res_screenshots (
      rsuuid, screenshot_type, kind,
      gameid, gvuuid, rhpakuuid,
      source_url, download_url
    )
    VALUES (
      @rsuuid, @screenshot_type, @kind,
      @gameid, @gvuuid, @rhpakuuid,
      @source_url, @download_url
    )
    ON CONFLICT(source_url) DO UPDATE SET
      gameid = excluded.gameid,
      gvuuid = excluded.gvuuid,
      download_url = excluded.download_url,
      rhpakuuid = excluded.rhpakuuid,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const payload of payloads) {
    const entry = payload.entry;
    const rsuuid = entry.screenshot_uuid || generateUuid();
    entry.screenshot_uuid = rsuuid;

    if (payload.type === 'file') {
      if (entry.file_sha256) {
        const existing = screenshotDb.prepare('SELECT rhpakuuid FROM res_screenshots WHERE file_sha256 = ?').get(entry.file_sha256);
        if (existing) {
          const entryRhpak = entry.rhpakuuid || rhpakuuid;
          if (existing.rhpakuuid && existing.rhpakuuid !== entryRhpak) {
            throw new Error(`Screenshot ${entry.file_name || entry.file_sha256} belongs to rhpak ${existing.rhpakuuid} and cannot be replaced by ${entryRhpak}.`);
          }
          if (!existing.rhpakuuid) {
            throw new Error(`Screenshot ${entry.file_name || entry.file_sha256} was not installed via an rhpak and cannot be replaced.`);
          }
        }
      }
      insertFileStmt.run({
        rsuuid,
        screenshot_type: entry.screenshot_type || 'file',
        kind: entry.kind || 'file',
        gameid: entry.gameid || gv.gameid,
        gvuuid: entry.gvuuid || gv.gvuuid,
        rhpakuuid: entry.rhpakuuid || rhpakuuid,
        source_url: entry.source_url || null,
        file_name: entry.file_name || null,
        file_ext: entry.file_ext || null,
        file_size: entry.file_size || (payload.decodedBuffer ? payload.decodedBuffer.length : null),
        file_sha256: entry.file_sha256 || (payload.decodedBuffer ? sha256(payload.decodedBuffer) : null),
        encoded_sha256: entry.encoded_sha256 || (payload.encryptedBuffer ? sha256(payload.encryptedBuffer) : null),
        decoded_sha256: entry.decoded_sha256 || (payload.decodedBuffer ? sha256(payload.decodedBuffer) : null),
        encrypted_data: payload.encryptedBuffer,
        fernet_key: entry.fernet_key,
        download_url: entry.download_url || null,
        ipfs_cid_v1: entry.ipfs_cid_v1 || null,
        ipfs_cid_v0: entry.ipfs_cid_v0 || null,
        arweave_file_id: entry.arweave_file_id || null,
        arweave_file_url: entry.arweave_file_url || null,
        ardrive_file_name: entry.ardrive_file_name || null,
        ardrive_file_id: entry.ardrive_file_id || null,
        ardrive_file_path: entry.ardrive_file_path || null,
        storage_path: entry.storage_path || null,
        source_path: entry.source_path || null
      });
    } else {
      if (entry.source_url) {
        const existingUrl = screenshotDb.prepare('SELECT rhpakuuid FROM res_screenshots WHERE source_url = ?').get(entry.source_url);
        if (existingUrl) {
          const entryRhpak = entry.rhpakuuid || rhpakuuid;
          if (existingUrl.rhpakuuid && existingUrl.rhpakuuid !== entryRhpak) {
            throw new Error(`Screenshot URL ${entry.source_url} belongs to rhpak ${existingUrl.rhpakuuid} and cannot be replaced by ${entryRhpak}.`);
          }
          if (!existingUrl.rhpakuuid) {
            throw new Error(`Screenshot URL ${entry.source_url} was not installed via an rhpak and cannot be replaced.`);
          }
        }
      }
      insertUrlStmt.run({
        rsuuid,
        screenshot_type: entry.screenshot_type || 'url',
        kind: entry.kind || 'url',
        gameid: entry.gameid || gv.gameid,
        gvuuid: entry.gvuuid || gv.gvuuid,
        rhpakuuid: entry.rhpakuuid || rhpakuuid,
        source_url: entry.source_url,
        download_url: entry.download_url || entry.source_url || null
      });
    }
  }
}

/**
 * Removal helpers
 */

function removeRecords(rhdataDb, patchbinDb, resourceDb, screenshotDb, skeleton, baseDir, options) {
  const gv = skeleton.gameversion;
  const pb = skeleton.patchblob;
  const at = skeleton.attachment;
  const rhpakuuid = skeleton.metadata && skeleton.metadata.rhpakuuid;

  const deleteRh = rhdataDb.prepare('DELETE FROM rhpatches WHERE gameid = ?');
  const deleteStats = rhdataDb.prepare('DELETE FROM gameversion_stats WHERE gameid = ?');
  const deleteGameversion = rhdataDb.prepare('DELETE FROM gameversions WHERE gameid = ? AND version = ?');
  const deletePatchblob = rhdataDb.prepare('DELETE FROM patchblobs WHERE patchblob1_name = ?');
  const deletePatchblobExtended = rhdataDb.prepare('DELETE FROM patchblobs_extended WHERE pbuuid = ?');

  deleteRh.run(gv.gameid);
  deleteStats.run(gv.gameid);
  deleteGameversion.run(gv.gameid, gv.version);
  if (pb.patchblob1_name) {
    const existing = rhdataDb.prepare('SELECT pbuuid FROM patchblobs WHERE patchblob1_name = ?').get(pb.patchblob1_name);
    deletePatchblob.run(pb.patchblob1_name);
    if (existing) {
      deletePatchblobExtended.run(existing.pbuuid);
    }
  }

  if (pb.patchblob1_name) {
    patchbinDb.prepare('DELETE FROM attachments WHERE file_name = ?').run(pb.patchblob1_name);
  }

  if (resourceDb) {
    resourceDb.prepare('DELETE FROM res_attachments WHERE gameid = ? AND gvuuid = ?').run(gv.gameid, gv.gvuuid);
  }
  if (screenshotDb) {
    screenshotDb.prepare('DELETE FROM res_screenshots WHERE gameid = ? AND gvuuid = ?').run(gv.gameid, gv.gvuuid);
  }

  if (rhpakuuid) {
    rhdataDb.prepare('DELETE FROM rhpakages WHERE rhpakuuid = ?').run(rhpakuuid);
    if (resourceDb) {
      resourceDb.prepare('DELETE FROM res_attachments WHERE rhpakuuid = ?').run(rhpakuuid);
    }
    if (screenshotDb) {
      screenshotDb.prepare('DELETE FROM res_screenshots WHERE rhpakuuid = ?').run(rhpakuuid);
    }
    patchbinDb.prepare('DELETE FROM attachments WHERE rhpakuuid = ?').run(rhpakuuid);
    rhdataDb.prepare('DELETE FROM patchblobs WHERE rhpakuuid = ?').run(rhpakuuid);
    rhdataDb.prepare('DELETE FROM patchblobs_extended WHERE rhpakuuid = ?').run(rhpakuuid);
    rhdataDb.prepare('DELETE FROM gameversion_stats WHERE rhpakuuid = ?').run(rhpakuuid);
    rhdataDb.prepare('DELETE FROM gameversions WHERE rhpakuuid = ?').run(rhpakuuid);
    rhdataDb.prepare('DELETE FROM rhpatches WHERE rhpakuuid = ?').run(rhpakuuid);
  }

  const patchInfo = skeleton.artifacts && skeleton.artifacts.patch;
  if (options.purgeFiles && patchInfo?.patchblob_stored_path) {
    const blobPath = toAbsolutePath(patchInfo.patchblob_stored_path, baseDir);
    if (blobPath && fs.existsSync(blobPath)) {
      fs.unlinkSync(blobPath);
    }
  }
  if (options.purgeFiles && patchInfo?.patch_stored_path) {
    const patchPath = toAbsolutePath(patchInfo.patch_stored_path, baseDir);
    if (patchPath && fs.existsSync(patchPath)) {
      fs.unlinkSync(patchPath);
    }
  }
  if (options.purgeFiles && Array.isArray(skeleton.resources)) {
    for (const entry of skeleton.resources) {
      if (entry && entry.auto_generated) {
        removeStagedFile(entry.encrypted_data_path, baseDir);
      }
    }
  }
  if (options.purgeFiles && Array.isArray(skeleton.screenshots)) {
    for (const entry of skeleton.screenshots) {
      if (entry && entry.auto_generated && entry.encrypted_data_path) {
        removeStagedFile(entry.encrypted_data_path, baseDir);
      }
    }
  }
}

function deleteRhpakRecords(databases, rhpakuuid) {
  const summary = {
    rhdata: {
      gameversions: 0,
      gameversion_stats: 0,
      patchblobs: 0,
      patchblobs_extended: 0,
      rhpatches: 0,
      rhpakages: 0
    },
    attachments: 0,
    resources: 0,
    screenshots: 0
  };

  if (databases.rhdata) {
    const txn = databases.rhdata.transaction((uuid) => {
      const counts = {
        rhpatches: databases.rhdata.prepare('DELETE FROM rhpatches WHERE rhpakuuid = ?').run(uuid).changes,
        patchblobs_extended: databases.rhdata.prepare('DELETE FROM patchblobs_extended WHERE rhpakuuid = ?').run(uuid).changes,
        patchblobs: databases.rhdata.prepare('DELETE FROM patchblobs WHERE rhpakuuid = ?').run(uuid).changes,
        gameversion_stats: databases.rhdata.prepare('DELETE FROM gameversion_stats WHERE rhpakuuid = ?').run(uuid).changes,
        gameversions: databases.rhdata.prepare('DELETE FROM gameversions WHERE rhpakuuid = ?').run(uuid).changes,
        rhpakages: databases.rhdata.prepare('DELETE FROM rhpakages WHERE rhpakuuid = ?').run(uuid).changes
      };
      return counts;
    });
    summary.rhdata = txn(rhpakuuid);
  }

  if (databases.patchbin) {
    const txn = databases.patchbin.transaction((uuid) => databases.patchbin.prepare('DELETE FROM attachments WHERE rhpakuuid = ?').run(uuid).changes);
    summary.attachments = txn(rhpakuuid);
  }

  if (databases.resource) {
    const txn = databases.resource.transaction((uuid) => databases.resource.prepare('DELETE FROM res_attachments WHERE rhpakuuid = ?').run(uuid).changes);
    summary.resources = txn(rhpakuuid);
  }

  if (databases.screenshot) {
    const txn = databases.screenshot.transaction((uuid) => databases.screenshot.prepare('DELETE FROM res_screenshots WHERE rhpakuuid = ?').run(uuid).changes);
    summary.screenshots = txn(rhpakuuid);
  }

  return summary;
}

function purgePreparedFilesFromSkeleton(skeleton, baseDir) {
  const patchInfo = skeleton.artifacts && skeleton.artifacts.patch;
  if (patchInfo?.patchblob_stored_path) {
    const blobPath = toAbsolutePath(patchInfo.patchblob_stored_path, baseDir);
    if (blobPath && fs.existsSync(blobPath)) {
      fs.unlinkSync(blobPath);
    }
  }
  if (patchInfo?.patch_stored_path) {
    const patchPath = toAbsolutePath(patchInfo.patch_stored_path, baseDir);
    if (patchPath && fs.existsSync(patchPath)) {
      fs.unlinkSync(patchPath);
    }
  }

  if (Array.isArray(skeleton.resources)) {
    for (const entry of skeleton.resources) {
      if (entry && entry.auto_generated) {
        removeStagedFile(entry.encrypted_data_path, baseDir);
      }
    }
  }

  if (Array.isArray(skeleton.screenshots)) {
    for (const entry of skeleton.screenshots) {
      if (entry && entry.auto_generated && entry.encrypted_data_path) {
        removeStagedFile(entry.encrypted_data_path, baseDir);
      }
    }
  }
}

async function handleUninstall(config, skeletonFromJson = null) {
  if (!fs.existsSync(config.rhdataPath)) {
    throw new Error(`rhdata.db not found at ${config.rhdataPath}`);
  }
  if (!fs.existsSync(config.patchbinPath)) {
    throw new Error(`patchbin.db not found at ${config.patchbinPath}`);
  }

  const descriptors = new Map();
  let tempDir = null;

  try {
    if (config.packageInput) {
      const packageAbs = config.packageInput;
      if (!fs.existsSync(packageAbs)) {
        throw new Error(`Package not found: ${packageAbs}`);
      }
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhpak-uninstall-'));
      extract7zArchive(packageAbs, tempDir);

      const jsonPaths = [];
      function collectJsonFiles(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            collectJsonFiles(fullPath);
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
            jsonPaths.push(fullPath);
          }
        }
      }
      collectJsonFiles(tempDir);
      if (jsonPaths.length === 0) {
        throw new Error('Package did not contain any JSON skeleton files to uninstall.');
      }

      for (const jsonPath of jsonPaths) {
        const skeleton = loadSkeleton(jsonPath);
        if (!skeleton || !skeleton.metadata || !skeleton.metadata.rhpakuuid) {
          throw new Error(`Skeleton ${path.relative(tempDir, jsonPath)} is missing rhpakuuid metadata and cannot be uninstalled.`);
        }
        const rhpakuuid = skeleton.metadata.rhpakuuid;
        if (!descriptors.has(rhpakuuid)) {
          descriptors.set(rhpakuuid, {
            rhpakuuid,
            name: skeleton.metadata.rhpakname || buildDefaultRhpakName(skeleton.gameversion || {}),
            skeleton: null,
            jsonPath: null,
            baseDir: null,
            source: path.basename(packageAbs)
          });
        }
      }
    } else {
      const skeleton = skeletonFromJson || loadSkeleton(config.jsonPath);
      if (!skeleton) {
        throw new Error(`Skeleton not found at ${config.jsonPath}`);
      }
      if (!skeleton.metadata || !skeleton.metadata.rhpakuuid) {
        throw new Error('Skeleton is missing rhpakuuid metadata. Re-run --prepare before uninstalling.');
      }
      const rhpakuuid = skeleton.metadata.rhpakuuid;
      descriptors.set(rhpakuuid, {
        rhpakuuid,
        name: skeleton.metadata.rhpakname || buildDefaultRhpakName(skeleton.gameversion || {}),
        skeleton,
        jsonPath: config.jsonPath,
        baseDir: config.baseDir || path.dirname(config.jsonPath),
        source: path.basename(config.jsonPath)
      });
    }

    if (descriptors.size === 0) {
      throw new Error('No rhpak metadata found to uninstall.');
    }

    const rhdataDb = new Database(config.rhdataPath);
    const patchbinDb = new Database(config.patchbinPath);
    const resourceDb = fs.existsSync(config.resourcePath) ? new Database(config.resourcePath) : null;
    const screenshotDb = fs.existsSync(config.screenshotPath) ? new Database(config.screenshotPath) : null;

    try {
      for (const descriptor of descriptors.values()) {
        const summary = deleteRhpakRecords({
          rhdata: rhdataDb,
          patchbin: patchbinDb,
          resource: resourceDb,
          screenshot: screenshotDb
        }, descriptor.rhpakuuid);

        console.log(`✓ Uninstalled rhpak ${descriptor.name} (${descriptor.rhpakuuid})`);
        console.log(`  Removed gameversions: ${summary.rhdata.gameversions}`);
        console.log(`  Removed gameversion_stats: ${summary.rhdata.gameversion_stats}`);
        console.log(`  Removed patchblobs: ${summary.rhdata.patchblobs}`);
        console.log(`  Removed patchblobs_extended: ${summary.rhdata.patchblobs_extended}`);
        console.log(`  Removed rhpatches: ${summary.rhdata.rhpatches}`);
        console.log(`  Removed attachments: ${summary.attachments}`);
        console.log(`  Removed resource entries: ${summary.resources}`);
        console.log(`  Removed screenshot entries: ${summary.screenshots}`);

        if (descriptor.skeleton && descriptor.jsonPath) {
          if (config.purgeFiles) {
            purgePreparedFilesFromSkeleton(descriptor.skeleton, descriptor.baseDir);
          }
          const metadata = descriptor.skeleton.metadata || {};
          metadata.added_at = null;
          metadata.rhpak_installed_at = null;
          metadata.last_uninstalled_at = new Date().toISOString();
          descriptor.skeleton.metadata = metadata;
          saveSkeleton(descriptor.jsonPath, descriptor.skeleton);
        }
      }
    } finally {
      rhdataDb.close();
      patchbinDb.close();
      if (resourceDb) resourceDb.close();
      if (screenshotDb) screenshotDb.close();
    }
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * Mode handlers
 */

async function handleCheck(config, skeleton) {
  const baseDir = config.baseDir || path.dirname(config.jsonPath);
  const issues = validateSkeleton(skeleton, {
    rhdataPath: config.rhdataPath,
    patchbinPath: config.patchbinPath
  }, baseDir);
  printIssues(issues);
  if (issues.some((i) => i.level === 'error')) {
    console.log('\n✗ Resolve errors above before proceeding.');
    return;
  }
  if (!skeleton.metadata || !skeleton.metadata.prepared) {
    console.log('\n⚠ Skeleton has not been prepared with --prepare yet.');
  } else {
    console.log(`\n✓ Prepared artifacts recorded on ${skeleton.metadata.prepared_at || 'unknown date'}`);
    const preparedIssues = validatePreparedState(skeleton, baseDir);
    const actionable = preparedIssues.filter(issue => issue.level === 'error' || issue.level === 'warning');
    if (actionable.length > 0) {
      console.log('\nPrepared artifact validation:');
      printIssues(preparedIssues);
    }
  }
  console.log('');
  summarizeDatabaseState({
    rhdataPath: config.rhdataPath,
    patchbinPath: config.patchbinPath,
    resourcePath: config.resourcePath,
    screenshotPath: config.screenshotPath
  }, skeleton);
}

async function handleAdd(config, skeleton) {
  const baseDir = config.baseDir || path.dirname(config.jsonPath);
  ensureDatabaseFileIfMissing(config.resourcePath);
  ensureDatabaseFileIfMissing(config.screenshotPath);

  const metadata = ensureRhpakMetadata(skeleton);
  const rhpakuuid = metadata.rhpakuuid;
  if (!rhpakuuid) {
    throw new Error('Prepared skeleton missing rhpakuuid metadata. Re-run --prepare.');
  }
  metadata.rhpakname = metadata.rhpakname || buildDefaultRhpakName(skeleton.gameversion || {});

  const baseIssues = validateSkeleton(skeleton, {
    rhdataPath: config.rhdataPath,
    patchbinPath: config.patchbinPath,
    resourcePath: config.resourcePath,
    screenshotPath: config.screenshotPath,
    skipPatchFileCheck: true
  }, config.baseDir);
  const preparedIssues = validatePreparedState(skeleton, config.baseDir);
  const combinedIssues = [...baseIssues, ...preparedIssues];
  printIssues(combinedIssues);
  if (combinedIssues.some((issue) => issue.level === 'error')) {
    throw new Error('Cannot add records while validation errors exist.');
  }

  const patchArtifact = await loadPreparedPatchArtifact(skeleton, baseDir);
  const resourcePayloads = await assembleResourcePayloads(skeleton.resources || [], baseDir);
  const screenshotPayloads = await assembleScreenshotPayloads(skeleton.screenshots || [], baseDir);

  const rhdataDb = new Database(config.rhdataPath);
  const patchbinDb = new Database(config.patchbinPath);
  const resourceDb = new Database(config.resourcePath);
  const screenshotDb = new Database(config.screenshotPath);

  try {
    const transactionRh = rhdataDb.transaction(() => {
      upsertGameversion(rhdataDb, skeleton, patchArtifact, { force: config.force });
      upsertGameversionStats(rhdataDb, skeleton);
      upsertPatchblob(rhdataDb, skeleton, patchArtifact);
      upsertPatchblobExtended(rhdataDb, skeleton, patchArtifact);
      upsertPatchRecord(rhdataDb, skeleton, patchArtifact);
      upsertRhpakRecord(rhdataDb, skeleton);
    });
    const transactionAttachment = patchbinDb.transaction(() => {
      upsertAttachment(patchbinDb, skeleton, patchArtifact);
    });
    const transactionResource = resourceDb.transaction(() => {
      upsertPreparedResources(resourceDb, skeleton, resourcePayloads);
    });
    const transactionScreenshot = screenshotDb.transaction(() => {
      upsertPreparedScreenshots(screenshotDb, skeleton, screenshotPayloads);
    });

    transactionRh();
    transactionAttachment();
    if (resourcePayloads.length > 0) {
      transactionResource();
    }
    if (screenshotPayloads.length > 0) {
      transactionScreenshot();
    }
  } finally {
    rhdataDb.close();
    patchbinDb.close();
    resourceDb.close();
    screenshotDb.close();
  }

  metadata.added_at = new Date().toISOString();
  metadata.rhpak_installed_at = metadata.added_at;
  saveSkeleton(config.jsonPath, skeleton);
  console.log('✓ Database updated successfully.');
  console.log(`  Resources processed: ${resourcePayloads.length}`);
  console.log(`  Screenshots processed: ${screenshotPayloads.length}`);
}

async function handleRemove(config, skeleton) {
  if (!config.force) {
    throw new Error('--remove is deprecated. Use --uninstall instead, or rerun with --remove --force to proceed.');
  }
  console.warn('⚠  --remove bypasses rhpak safeguards. Prefer --uninstall unless you have a specific reason.');

  if (!fs.existsSync(config.rhdataPath)) {
    throw new Error(`rhdata.db not found at ${config.rhdataPath}`);
  }
  if (!fs.existsSync(config.patchbinPath)) {
    throw new Error(`patchbin.db not found at ${config.patchbinPath}`);
  }

  const rhdataDb = new Database(config.rhdataPath);
  const patchbinDb = new Database(config.patchbinPath);
  const resourceDb = fs.existsSync(config.resourcePath) ? new Database(config.resourcePath) : null;
  const screenshotDb = fs.existsSync(config.screenshotPath) ? new Database(config.screenshotPath) : null;

  const baseDir = config.baseDir || path.dirname(config.jsonPath);

  try {
    removeRecords(rhdataDb, patchbinDb, resourceDb, screenshotDb, skeleton, baseDir, { purgeFiles: config.purgeFiles });
  } finally {
    rhdataDb.close();
    patchbinDb.close();
    if (resourceDb) resourceDb.close();
    if (screenshotDb) screenshotDb.close();
  }

  skeleton.metadata = skeleton.metadata || {};
  skeleton.metadata.added_at = null;
  skeleton.metadata.rhpak_installed_at = null;
  skeleton.metadata.last_removed_at = new Date().toISOString();
  saveSkeleton(config.jsonPath, skeleton);

  console.log(`✓ Removed database records for ${skeleton.gameversion.gameid} v${skeleton.gameversion.version}`);
}

async function handlePackage(config, skeleton) {
  if (!config.packageOutput) {
    throw new Error('The --package option requires a target file via --package=FILE.');
  }
  let packageOutput = config.packageOutput;
  if (!path.extname(packageOutput)) {
    packageOutput += '.rhpak';
  }
  const baseDir = config.baseDir || path.dirname(config.jsonPath);
  packageOutput = path.resolve(baseDir, packageOutput);

  const baseIssues = validatePreparedState(skeleton, baseDir);
  printIssues(baseIssues);
  if (baseIssues.some(issue => issue.level === 'error')) {
    throw new Error('Resolve preparation issues before packaging.');
  }

  ensureRhpakMetadata(skeleton);

  saveSkeleton(config.jsonPath, skeleton);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhpak-'));
  const stagedPaths = new Set();

  try {
    const clone = JSON.parse(JSON.stringify(skeleton));
    clone.metadata = clone.metadata || {};
    clone.metadata.package = {
      created_at: new Date().toISOString(),
      source_filename: path.basename(config.jsonPath),
      package_name: path.basename(packageOutput)
    };

    const skeletonTempPath = path.join(tempDir, 'skeleton.json');
    saveSkeleton(skeletonTempPath, clone);

    function stage(relative, absoluteOverride) {
      if (!relative) return;
      const normalized = normalizeRelativePath(relative);
      const absolute = absoluteOverride || toAbsolutePath(normalized, baseDir);
      if (!absolute || !fs.existsSync(absolute)) {
        throw new Error(`Required artifact missing: ${normalized}`);
      }
      if (stagedPaths.has(normalized)) {
        return;
      }
      const destination = path.join(tempDir, ...normalized.split('/'));
      ensureDir(path.dirname(destination));
      fs.copyFileSync(absolute, destination);
      stagedPaths.add(normalized);
    }

    const patchInfo = skeleton.artifacts && skeleton.artifacts.patch;
    if (!patchInfo) {
      throw new Error('Prepared patch metadata missing from skeleton.');
    }

    stage(patchInfo.patch_stored_path);
    stage(patchInfo.patchblob_stored_path);

    for (const entry of skeleton.resources || []) {
      if (!entry || !entry.encrypted_data_path) continue;
      stage(entry.encrypted_data_path);
    }

    for (const entry of skeleton.screenshots || []) {
      if (!entry || entry.kind === 'url') continue;
      if (!entry.encrypted_data_path) continue;
      stage(entry.encrypted_data_path);
    }

    create7zArchive(tempDir, packageOutput);
    console.log(`✓ Created package: ${packageOutput}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function handleImport(config) {
  const packageAbs = config.packageInput;
  if (!fs.existsSync(packageAbs)) {
    throw new Error(`Package not found: ${packageAbs}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhpak-import-'));
  try {
    extract7zArchive(packageAbs, tempDir);

    let skeletonCandidate = path.join(tempDir, 'skeleton.json');
    if (!fs.existsSync(skeletonCandidate)) {
      const candidates = fs.readdirSync(tempDir).filter(name => name.endsWith('.json'));
      if (candidates.length === 0) {
        throw new Error('Package did not contain a skeleton JSON file.');
      }
      skeletonCandidate = path.join(tempDir, candidates[0]);
    }

    const skeleton = loadSkeleton(skeletonCandidate);
    if (!skeleton) {
      throw new Error('Failed to load skeleton from package.');
    }

    const patchInfo = skeleton.artifacts && skeleton.artifacts.patch;
    if (!patchInfo) {
      throw new Error('Package skeleton missing patch artifact metadata.');
    }

    const defaultJsonName = (skeleton.metadata && skeleton.metadata.package && skeleton.metadata.package.source_filename)
      || `${path.basename(packageAbs, path.extname(packageAbs))}.json`;
    const outputJsonPath = config.outputJson
      ? path.resolve(process.cwd(), config.outputJson)
      : path.resolve(process.cwd(), defaultJsonName);
    const outputBaseDir = path.dirname(outputJsonPath);
    if (fs.existsSync(outputJsonPath)) {
      throw new Error(`Output JSON already exists: ${outputJsonPath}. Use --output-json to specify a different file or remove the existing one.`);
    }
    ensureDir(path.dirname(outputJsonPath));

    function copyFromPackage(relativePath) {
      if (!relativePath) return null;
      const normalized = normalizeRelativePath(relativePath);
      const source = path.join(tempDir, ...normalized.split('/'));
      if (!fs.existsSync(source)) {
        throw new Error(`Package is missing expected artifact: ${normalized}`);
      }
      const destination = toAbsolutePath(normalized, outputBaseDir);
      ensureDir(path.dirname(destination));
      if (!fs.existsSync(destination)) {
        fs.copyFileSync(source, destination);
      }
      return normalized;
    }

    patchInfo.patch_stored_path = copyFromPackage(patchInfo.patch_stored_path) || patchInfo.patch_stored_path;
    patchInfo.patchblob_stored_path = copyFromPackage(patchInfo.patchblob_stored_path) || patchInfo.patchblob_stored_path;

    for (const entry of skeleton.resources || []) {
      if (!entry || !entry.encrypted_data_path) continue;
      entry.encrypted_data_path = copyFromPackage(entry.encrypted_data_path) || entry.encrypted_data_path;
    }

    for (const entry of skeleton.screenshots || []) {
      if (!entry || entry.kind === 'url' || !entry.encrypted_data_path) continue;
      entry.encrypted_data_path = copyFromPackage(entry.encrypted_data_path) || entry.encrypted_data_path;
    }

    skeleton.gameversion.patch_local_path = patchInfo.patch_stored_path;
    patchInfo.source_path = patchInfo.patch_stored_path;

    const metadata = ensureRhpakMetadata(skeleton);
    metadata.prepared = true;
    metadata.prepared_at = metadata.prepared_at || new Date().toISOString();
    metadata.imported_from = {
      package: path.basename(packageAbs),
      imported_at: new Date().toISOString()
    };
    metadata.added_at = null;

    const rhpakuuid = metadata.rhpakuuid;
    skeleton.gameversion = skeleton.gameversion || {};
    skeleton.gameversion.rhpakuuid = rhpakuuid;
    skeleton.patchblob = skeleton.patchblob || {};
    skeleton.patchblob.rhpakuuid = rhpakuuid;
    skeleton.attachment = skeleton.attachment || {};
    skeleton.attachment.rhpakuuid = rhpakuuid;
    skeleton.resources = (skeleton.resources || []).map((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && !entry.rhpakuuid) {
        return { ...entry, rhpakuuid };
      }
      return entry;
    });
    skeleton.screenshots = (skeleton.screenshots || []).map((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && entry.kind !== undefined) {
        if (!entry.rhpakuuid) {
          return { ...entry, rhpakuuid };
        }
      }
      if (entry && typeof entry === 'object' && !Array.isArray(entry) && entry.kind === undefined && !entry.rhpakuuid) {
        return { ...entry, rhpakuuid };
      }
      return entry;
    });

    saveSkeleton(outputJsonPath, skeleton);
    console.log(`✓ Imported package into ${outputJsonPath}`);
    console.log('  You can now run --check and --add on the imported JSON.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function handleVerifyPackage(config) {
  const packageAbs = config.packageInput;
  if (!fs.existsSync(packageAbs)) {
    throw new Error(`Package not found: ${packageAbs}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhpak-verify-'));
  try {
    extract7zArchive(packageAbs, tempDir);

    let skeletonCandidate = path.join(tempDir, 'skeleton.json');
    if (!fs.existsSync(skeletonCandidate)) {
      const candidates = fs.readdirSync(tempDir).filter(name => name.endsWith('.json'));
      if (candidates.length === 0) {
        throw new Error('Package did not contain a skeleton JSON file.');
      }
      skeletonCandidate = path.join(tempDir, candidates[0]);
    }

    const skeleton = loadSkeleton(skeletonCandidate);
    if (!skeleton) {
      throw new Error('Failed to load skeleton from package.');
    }

    const baseDir = tempDir;

    const baseIssues = validateSkeleton(skeleton, {
      skipPatchFileCheck: true
    }, baseDir);
    const preparedIssues = validatePreparedState(skeleton, baseDir);
    const combined = [...baseIssues, ...preparedIssues];
    printIssues(combined);
    if (combined.some(issue => issue.level === 'error')) {
      throw new Error('Package verification failed due to the errors above.');
    }

    await loadPreparedPatchArtifact(skeleton, baseDir);
    await assembleResourcePayloads(skeleton.resources || [], baseDir);
    await assembleScreenshotPayloads(skeleton.screenshots || [], baseDir);

    console.log(`✓ Package verification succeeded: ${path.basename(packageAbs)}`);
    console.log(`  Resources verified: ${Array.isArray(skeleton.resources) ? skeleton.resources.length : 0}`);
    console.log(`  Screenshots verified: ${Array.isArray(skeleton.screenshots) ? skeleton.screenshots.length : 0}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Entry point
 */

async function main() {
  let config;
  try {
    config = parseArgs(process.argv);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    printHelp();
    process.exit(1);
  }

  if (config.mode === 'help') {
    printHelp();
    return;
  }

  if (config.mode === 'import') {
    await handleImport(config);
    return;
  }
  if (config.mode === 'verify-package') {
    await handleVerifyPackage(config);
    return;
  }
  if (config.mode === 'uninstall') {
    if (config.packageInput) {
      await handleUninstall(config, null);
      return;
    }
    config.baseDir = config.baseDir || path.dirname(config.jsonPath);
    const skeleton = loadSkeleton(config.jsonPath);
    if (!skeleton) {
      throw new Error(`Skeleton not found at ${config.jsonPath}`);
    }
    await handleUninstall(config, skeleton);
    return;
  }

  config.baseDir = config.baseDir || path.dirname(config.jsonPath);

  let skeleton = loadSkeleton(config.jsonPath);
  if (!skeleton) {
    skeleton = defaultSkeleton();
    saveSkeleton(config.jsonPath, skeleton);
    console.log(`Created new skeleton at ${config.jsonPath}`);
  }

  switch (config.mode) {
    case 'create':
      await runCreateWizard(config.jsonPath, skeleton);
      break;
    case 'prepare':
      await handlePrepare(config, skeleton);
      break;
    case 'check':
      await handleCheck(config, skeleton);
      break;
    case 'add':
      await handleAdd(config, skeleton);
      break;
    case 'package':
      await handlePackage(config, skeleton);
      break;
    case 'remove':
      await handleRemove(config, skeleton);
      break;
    default:
      printHelp();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\nFatal error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  });
}


