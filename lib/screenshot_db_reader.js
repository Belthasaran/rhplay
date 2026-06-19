/**
 * screenshot_db_reader.js - Read and verify screenshots from screenshot.db
 *
 * Used by catalog backfill to avoid HTTP downloads when encrypted screenshot
 * data is already stored locally.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const fernet = require('fernet');
const { getUserDataDir } = require('../electron/utils/manifest-resolver');

const gameScreenshotCache = new Map();

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function resolveScreenshotDataDir(opts = {}) {
  if (opts.screenshotDataDir) {
    return path.resolve(opts.screenshotDataDir);
  }
  if (process.env.SCREENSHOT_DATA_DIR) {
    return path.resolve(process.env.SCREENSHOT_DATA_DIR);
  }
  return getUserDataDir();
}

function openScreenshotDb(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    throw new Error(`Screenshot database not found: ${dbPath}`);
  }
  return new Database(dbPath, { readonly: true });
}

function hasJunctionTable(db) {
  const row = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='gameversion_screenshots'
  `).get();
  return !!row;
}

function loadScreenshotsForGame(db, gameid) {
  const gid = String(gameid);
  if (gameScreenshotCache.has(gid)) {
    return gameScreenshotCache.get(gid);
  }

  let rows;
  if (hasJunctionTable(db)) {
    rows = db.prepare(`
      SELECT
        rs.rsuuid,
        gvs.gameid,
        rs.gvuuid,
        rs.rhpakuuid,
        COALESCE(gvs.file_name, rs.file_name) AS file_name,
        rs.file_ext,
        COALESCE(gvs.source_url, rs.source_url) AS source_url,
        rs.screenshot_type,
        rs.encrypted_data,
        rs.fernet_key,
        rs.kind,
        rs.decoded_sha256,
        rs.file_sha256,
        rs.encoded_sha256,
        rs.storage_path,
        rs.source_path,
        gvs.sequence_no
      FROM gameversion_screenshots gvs
      INNER JOIN res_screenshots rs ON gvs.rsuuid = rs.rsuuid
      WHERE gvs.gameid = ?
      ORDER BY gvs.sequence_no ASC NULLS LAST, rs.created_at ASC
    `).all(gid);
  } else {
    rows = db.prepare(`
      SELECT
        rsuuid, gameid, gvuuid, rhpakuuid,
        file_name, file_ext, source_url, screenshot_type,
        encrypted_data, fernet_key, kind,
        decoded_sha256, file_sha256, encoded_sha256,
        storage_path, source_path, sequence_no
      FROM res_screenshots
      WHERE gameid = ?
      ORDER BY sequence_no ASC NULLS LAST, created_at ASC
    `).all(gid);
  }

  gameScreenshotCache.set(gid, rows);
  return rows;
}

function normalizeImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    return decodeURIComponent(url.trim());
  } catch (e) {
    return url.trim();
  }
}

function urlsMatch(a, b) {
  if (!a || !b) return false;
  const na = normalizeImageUrl(a);
  const nb = normalizeImageUrl(b);
  if (na === nb) return true;
  try {
    return decodeURIComponent(na) === decodeURIComponent(nb);
  } catch (e) {
    return false;
  }
}

function findScreenshotRecord(records, imageUrl) {
  if (!records || !imageUrl) return null;
  for (const rec of records) {
    if (urlsMatch(rec.source_url, imageUrl)) {
      return rec;
    }
  }
  return null;
}

function bufferToFernetToken(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encryptedDataToBuffer(encryptedData) {
  if (Buffer.isBuffer(encryptedData)) {
    return encryptedData;
  }
  if (encryptedData instanceof Uint8Array) {
    return Buffer.from(encryptedData);
  }
  if (typeof encryptedData === 'string') {
    return Buffer.from(encryptedData, 'base64');
  }
  if (Array.isArray(encryptedData)) {
    return Buffer.from(encryptedData);
  }
  return null;
}

function decryptScreenshotBlob(encryptedData, fernetKey) {
  const encryptedBuffer = encryptedDataToBuffer(encryptedData);
  if (!encryptedBuffer || !fernetKey) {
    throw new Error('Missing encrypted_data or fernet_key');
  }

  let keyString = fernetKey;
  if (Buffer.isBuffer(fernetKey)) {
    keyString = fernetKey.toString('utf8');
  }

  const tokenString = bufferToFernetToken(encryptedBuffer);
  const secret = new fernet.Secret(keyString);
  const token = new fernet.Token({ secret, token: tokenString, ttl: 0 });
  const decodedBase64 = token.decode();
  return Buffer.from(decodedBase64, 'base64');
}

function getExpectedSha256(record) {
  return record.decoded_sha256 || record.file_sha256 || null;
}

function verifyScreenshotBuffer(buffer, record) {
  const expected = getExpectedSha256(record);
  if (!expected) return true;
  return sha256Hex(buffer) === expected;
}

function resolveScreenshotBytes(record, dataDir) {
  const errors = [];

  if (record.encrypted_data && record.fernet_key) {
    try {
      const buffer = decryptScreenshotBlob(record.encrypted_data, record.fernet_key);
      if (verifyScreenshotBuffer(buffer, record)) {
        return { ok: true, buffer, source: 'db-blob' };
      }
      errors.push('decrypted blob sha256 mismatch');
    } catch (e) {
      errors.push(`decrypt failed: ${e.message}`);
    }
  }

  const relPath = record.storage_path || record.source_path;
  if (relPath && dataDir) {
    const fullPath = path.join(dataDir, relPath);
    if (fs.existsSync(fullPath)) {
      try {
        const buffer = fs.readFileSync(fullPath);
        if (verifyScreenshotBuffer(buffer, record)) {
          return { ok: true, buffer, source: 'db-file' };
        }
        errors.push(`storage_path file sha256 mismatch: ${fullPath}`);
      } catch (e) {
        errors.push(`storage_path read failed: ${e.message}`);
      }
    }
  }

  return { ok: false, errors };
}

function tryLoadScreenshotFromDb(db, gameid, imageUrl, dataDir) {
  if (!db || !gameid || !imageUrl) {
    return { ok: false };
  }

  const records = loadScreenshotsForGame(db, gameid);
  const record = findScreenshotRecord(records, imageUrl);
  if (!record) {
    return { ok: false, reason: 'no matching source_url' };
  }

  const resolved = resolveScreenshotBytes(record, dataDir);
  if (resolved.ok) {
    return {
      ...resolved,
      fileExt: record.file_ext || null,
      fileName: record.file_name || null
    };
  }

  return {
    ok: false,
    reason: resolved.errors ? resolved.errors.join('; ') : 'verification failed'
  };
}

function clearScreenshotCache() {
  gameScreenshotCache.clear();
}

module.exports = {
  sha256Hex,
  resolveScreenshotDataDir,
  openScreenshotDb,
  loadScreenshotsForGame,
  findScreenshotRecord,
  normalizeImageUrl,
  urlsMatch,
  decryptScreenshotBlob,
  resolveScreenshotBytes,
  tryLoadScreenshotFromDb,
  clearScreenshotCache,
  bufferToFernetToken,
  encryptedDataToBuffer
};
