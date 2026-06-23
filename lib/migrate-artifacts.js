/**
 * migrate-artifacts.js - Move DB blob columns into local artifact store (manifest migrate_artifacts)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const fernet = require('fernet');
const artifactStore = require('./artifact-store');

const SUPPORTED_DATABASES = new Set(['patchbin.db', 'resource.db', 'screenshot.db']);

function sha224Hex(buffer) {
  return crypto.createHash('sha224').update(buffer).digest('hex');
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha1Hex(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function md5Hex(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

function blobFromValue(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'base64');
  if (Array.isArray(value)) return Buffer.from(value);
  return null;
}

function bufferToFernetToken(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decryptFernetBlob(encryptedBuffer, fernetKey) {
  if (!encryptedBuffer || !fernetKey) {
    throw new Error('Missing encrypted_data or fernet_key');
  }
  const keyString = Buffer.isBuffer(fernetKey) ? fernetKey.toString('utf8') : String(fernetKey);
  const tokenString = bufferToFernetToken(encryptedBuffer);
  const secret = new fernet.Secret(keyString);
  const token = new fernet.Token({ secret, token: tokenString, ttl: 0 });
  return Buffer.from(token.decode(), 'base64');
}

function isMigrateArtifactsEnabled(spec) {
  if (!spec || typeof spec !== 'object') return false;
  const flag = spec.migrate_artifacts;
  return flag === true || flag === 'true';
}

function verifyOptionalHash(actual, expected, label) {
  if (!expected) return null;
  if (actual !== expected) {
    return `${label} mismatch: expected ${expected}, got ${actual}`;
  }
  return null;
}

function writeTempArtifact(buffer, prefix) {
  const tempPath = path.join(
    os.tmpdir(),
    `rht-migrate-${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`
  );
  fs.writeFileSync(tempPath, buffer);
  return tempPath;
}

function compactDatabase(dbPath) {
  const db = new Database(dbPath);
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM');
  } finally {
    db.close();
  }
}

function migratePatchbinAttachments(db, userDataDir, onLog) {
  const summary = { scanned: 0, migrated: 0, failed: 0, skipped: 0 };
  const rows = db.prepare(`
    SELECT auuid, pbuuid, gvuuid, file_name, file_data,
      file_hash_sha224, file_hash_sha256, file_hash_sha1, file_hash_md5,
      decoded_hash_sha256
    FROM attachments
    WHERE file_data IS NOT NULL AND length(file_data) > 0
  `).all();

  const clearStmt = db.prepare('UPDATE attachments SET file_data = NULL WHERE auuid = ?');

  for (const row of rows) {
    summary.scanned += 1;
    const blob = blobFromValue(row.file_data);
    if (!blob || blob.length === 0) {
      summary.skipped += 1;
      continue;
    }

    const errors = [];
    const sha224 = sha224Hex(blob);
    const sha256 = sha256Hex(blob);
    if (!row.file_hash_sha224) {
      errors.push('missing file_hash_sha224');
    } else {
      errors.push(verifyOptionalHash(sha224, row.file_hash_sha224, 'file_hash_sha224'));
    }
    if (!row.file_hash_sha256) {
      errors.push('missing file_hash_sha256');
    } else {
      errors.push(verifyOptionalHash(sha256, row.file_hash_sha256, 'file_hash_sha256'));
    }
    errors.push(verifyOptionalHash(sha1Hex(blob), row.file_hash_sha1, 'file_hash_sha1'));
    errors.push(verifyOptionalHash(md5Hex(blob), row.file_hash_md5, 'file_hash_md5'));
    const filtered = errors.filter(Boolean);
    if (filtered.length) {
      summary.failed += 1;
      if (onLog) onLog(`[migrate-artifacts] patchbin ${row.auuid}: ${filtered.join('; ')}`, 'warn');
      continue;
    }

    let tempPath = null;
    try {
      tempPath = writeTempArtifact(blob, `pblob-${row.auuid}`);
      artifactStore.addItem({
        artifactType: 'pblob',
        sourcePath: tempPath,
        fileName: row.file_name,
        auuid: row.auuid,
        pbuuid: row.pbuuid || null,
        gvuuid: row.gvuuid || null,
        file_hash_sha256: row.file_hash_sha256 || sha256,
        decoded_hash_sha256: row.decoded_hash_sha256 || null,
        userDataDir
      });
      clearStmt.run(row.auuid);
      summary.migrated += 1;
    } catch (err) {
      summary.failed += 1;
      if (onLog) onLog(`[migrate-artifacts] patchbin ${row.auuid}: ${err.message}`, 'warn');
    } finally {
      if (tempPath && fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  }

  return summary;
}

function migrateEncryptedAttachments({
  db,
  table,
  idCol,
  artifactType,
  ext,
  userDataDir,
  onLog
}) {
  const summary = { scanned: 0, migrated: 0, failed: 0, skipped: 0 };
  const rows = db.prepare(`
    SELECT ${idCol}, file_name, encrypted_data, fernet_key,
      encoded_sha256, decoded_sha256, file_sha256
    FROM ${table}
    WHERE encrypted_data IS NOT NULL AND length(encrypted_data) > 0
  `).all();

  const clearStmt = db.prepare(`UPDATE ${table} SET encrypted_data = NULL WHERE ${idCol} = ?`);

  for (const row of rows) {
    summary.scanned += 1;
    const encrypted = blobFromValue(row.encrypted_data);
    if (!encrypted || encrypted.length === 0) {
      summary.skipped += 1;
      continue;
    }

    const errors = [];
    const encodedSha = sha256Hex(encrypted);
    errors.push(verifyOptionalHash(encodedSha, row.encoded_sha256, 'encoded_sha256'));

    if (row.fernet_key) {
      try {
        const decoded = decryptFernetBlob(encrypted, row.fernet_key);
        const decodedSha = sha256Hex(decoded);
        const expectedDecoded = row.decoded_sha256 || row.file_sha256 || null;
        errors.push(verifyOptionalHash(decodedSha, expectedDecoded, 'decoded_sha256'));
      } catch (err) {
        errors.push(`decrypt failed: ${err.message}`);
      }
    }

    const filtered = errors.filter(Boolean);
    if (filtered.length) {
      summary.failed += 1;
      if (onLog) onLog(`[migrate-artifacts] ${artifactType} ${row[idCol]}: ${filtered.join('; ')}`, 'warn');
      continue;
    }

    const fileName = row.file_name || `${row[idCol]}${ext}`;
    let tempPath = null;
    try {
      tempPath = writeTempArtifact(encrypted, `${artifactType}-${row[idCol]}`);
      const item = {
        artifactType,
        sourcePath: tempPath,
        fileName,
        encoded_sha256: row.encoded_sha256 || encodedSha,
        decoded_sha256: row.decoded_sha256 || row.file_sha256 || null,
        userDataDir
      };
      item[idCol] = row[idCol];
      artifactStore.addItem(item);
      clearStmt.run(row[idCol]);
      summary.migrated += 1;
    } catch (err) {
      summary.failed += 1;
      if (onLog) onLog(`[migrate-artifacts] ${artifactType} ${row[idCol]}: ${err.message}`, 'warn');
    } finally {
      if (tempPath && fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  }

  return summary;
}

function migrateArtifactsForDatabase({ dbPath, dbName, userDataDir, onLog = null } = {}) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    throw new Error(`migrate_artifacts: database not found: ${dbPath}`);
  }
  if (!SUPPORTED_DATABASES.has(dbName)) {
    if (onLog) onLog(`[migrate-artifacts] ${dbName}: no blob migration configured, skipping`);
    return { dbName, skipped: true, summaries: [] };
  }
  if (!userDataDir) {
    throw new Error('migrate_artifacts: userDataDir is required');
  }

  artifactStore.ensureLayout(userDataDir);
  const db = new Database(dbPath);
  const summaries = [];

  try {
    if (dbName === 'patchbin.db') {
      summaries.push({ table: 'attachments', ...migratePatchbinAttachments(db, userDataDir, onLog) });
    } else if (dbName === 'resource.db') {
      summaries.push({
        table: 'res_attachments',
        ...migrateEncryptedAttachments({
          db,
          table: 'res_attachments',
          idCol: 'rauuid',
          artifactType: 'resource',
          ext: '.rbin',
          userDataDir,
          onLog
        })
      });
    } else if (dbName === 'screenshot.db') {
      summaries.push({
        table: 'res_screenshots',
        ...migrateEncryptedAttachments({
          db,
          table: 'res_screenshots',
          idCol: 'rsuuid',
          artifactType: 'screenshot',
          ext: '.sbn',
          userDataDir,
          onLog
        })
      });
    }
  } finally {
    db.close();
  }

  compactDatabase(dbPath);

  const totals = summaries.reduce((acc, s) => ({
    scanned: acc.scanned + (s.scanned || 0),
    migrated: acc.migrated + (s.migrated || 0),
    failed: acc.failed + (s.failed || 0),
    skipped: acc.skipped + (s.skipped || 0)
  }), { scanned: 0, migrated: 0, failed: 0, skipped: 0 });

  if (onLog) {
    onLog(
      `[migrate-artifacts] ${dbName}: scanned=${totals.scanned} migrated=${totals.migrated} `
      + `failed=${totals.failed} skipped=${totals.skipped}`
    );
  }

  return { dbName, skipped: false, summaries, totals };
}

async function maybeMigrateArtifacts({ spec, dbPath, dbName, userDataDir, onLog = null } = {}) {
  if (!isMigrateArtifactsEnabled(spec)) {
    return null;
  }
  if (onLog) onLog(`[migrate-artifacts] ${dbName}: starting post-step migration`);
  return migrateArtifactsForDatabase({ dbPath, dbName, userDataDir, onLog });
}

module.exports = {
  SUPPORTED_DATABASES,
  isMigrateArtifactsEnabled,
  migrateArtifactsForDatabase,
  maybeMigrateArtifacts,
  compactDatabase,
  sha224Hex,
  sha256Hex
};
