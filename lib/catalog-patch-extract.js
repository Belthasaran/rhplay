/**
 * catalog-patch-extract.js - Locate and extract BPS from catalog bps7z archives
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function findFileByName(dir, targetName, depth = 0) {
  if (depth > 12 || !dir || !fs.existsSync(dir)) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFileByName(fullPath, targetName, depth + 1);
        if (found) return found;
      } else if (entry.name === targetName || entry.name.endsWith(`/${targetName}`)) {
        return fullPath;
      }
    }
  } catch (err) {
    // ignore unreadable dirs
  }
  return null;
}

function findSevenZLocally(index7zName, searchPaths) {
  if (!index7zName) return null;
  for (const searchPath of searchPaths || []) {
    if (!searchPath) continue;
    const candidate = path.join(searchPath, index7zName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function extractBpsFromSevenZ(sevenZip, sevenZPath, indexBpsName, tempDir) {
  if (!sevenZip || !sevenZPath || !indexBpsName) {
    throw new Error('Missing 7z path or BPS name for extraction');
  }
  fs.mkdirSync(tempDir, { recursive: true });
  await new Promise((resolve, reject) => {
    sevenZip.unpack(sevenZPath, tempDir, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const bpsPath = findFileByName(tempDir, path.basename(indexBpsName));
  if (!bpsPath) {
    throw new Error(`BPS file ${indexBpsName} not found in ${path.basename(sevenZPath)}`);
  }
  return bpsPath;
}

function lookupCatalogItem(db, patchblob) {
  if (!db || !patchblob) return null;
  const columns = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
  const hasSha256 = columns.includes('sfc_rom_sha256_hash');
  const hasIndex7z = columns.includes('index7z_name');
  const hasIndexBps = columns.includes('indexbps_name');
  if (!hasIndex7z || !hasIndexBps) return null;

  let row = null;
  if (hasSha256 && patchblob.result_sha256) {
    row = db.prepare(`
      SELECT index7z_name, indexbps_name, sfc_rom_sha256_hash, sfc_rom_sha1_hash
      FROM items WHERE sfc_rom_sha256_hash = ? LIMIT 1
    `).get(patchblob.result_sha256);
  }
  if (!row && patchblob.result_sha1) {
    row = db.prepare(`
      SELECT index7z_name, indexbps_name, sfc_rom_sha256_hash, sfc_rom_sha1_hash
      FROM items WHERE sfc_rom_sha1_hash = ? LIMIT 1
    `).get(patchblob.result_sha1);
  }
  return row;
}

function buildCatalogSearchPaths(ctx) {
  const paths = require('./patch-resolver-paths');
  const dirs = [];
  const downloads = paths.getCatalogDownloadsDir(ctx);
  if (downloads) dirs.push(downloads);
  dirs.push(path.join(os.homedir(), 'Downloads'));
  return dirs;
}

function makeExtractTempDir(prefix = 'catalog-extract') {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

module.exports = {
  findFileByName,
  findSevenZLocally,
  extractBpsFromSevenZ,
  lookupCatalogItem,
  buildCatalogSearchPaths,
  makeExtractTempDir
};
