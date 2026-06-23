/**
 * provision-row-equivalence.js - Row fingerprint helpers for provision conflict detection
 */

const crypto = require('crypto');

const EXCLUDED_COMPARE_COLUMNS = new Set(['updated_at']);
const EXTERNAL_BLOB_COLUMNS = {
  attachments: ['file_data'],
  res_attachments: ['encrypted_data'],
  res_screenshots: ['encrypted_data']
};

function serializeValue(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString('hex');
  }
  return value;
}

function normalizeRowForFingerprint(row, table) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (EXCLUDED_COMPARE_COLUMNS.has(key)) continue;
    if (table && (EXTERNAL_BLOB_COLUMNS[table] || []).includes(key)) continue;
    out[key] = serializeValue(value);
  }
  return out;
}

function computeRowFingerprint(row, table) {
  const normalized = normalizeRowForFingerprint(row, table);
  const keys = Object.keys(normalized).sort();
  const payload = keys.map((k) => `${k}=${JSON.stringify(normalized[k])}`).join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function rowsEquivalent(localRow, declaredRow, table) {
  if (!localRow || !declaredRow) return false;
  if (declaredRow.content_fingerprint && localRow) {
    const localFp = computeRowFingerprint(localRow, table);
    return localFp === declaredRow.content_fingerprint;
  }
  const localNorm = JSON.stringify(normalizeRowForFingerprint(localRow, table));
  const declNorm = JSON.stringify(normalizeRowForFingerprint(declaredRow, table));
  return localNorm === declNorm;
}

module.exports = {
  EXCLUDED_COMPARE_COLUMNS,
  EXTERNAL_BLOB_COLUMNS,
  computeRowFingerprint,
  normalizeRowForFingerprint,
  rowsEquivalent
};
