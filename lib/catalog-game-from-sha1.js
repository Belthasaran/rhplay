'use strict';

/**
 * Install a catalog game by patched-ROM SHA1 (rhsearch_cat.db + rhpak import).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');
const {
  findSevenZLocally,
  extractBpsFromSevenZ,
  buildCatalogSearchPaths,
  makeExtractTempDir,
} = require('./catalog-patch-extract');
const { resolveSha1ToGame } = require('./mt-share-code-resolver');

/**
 * @param {string} userDataPath
 */
function ensureCatalogBaseFiles(userDataPath) {
  const dbPath = path.join(userDataPath, 'rhsearch_cat.db');
  const zipPath = path.join(userDataPath, 'rhsearch.zip');
  if (fs.existsSync(dbPath) && fs.existsSync(zipPath)) {
    return { dbPath, zipPath };
  }
  throw new Error('Catalog database not installed. Install catalog base files from Settings or Add Game from Catalog.');
}

/**
 * @param {string} zipPath
 * @param {string} itemId
 */
function readCatalogItemJson(zipPath, itemId) {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry(`${itemId}.json`);
  if (!entry) {
    throw new Error(`Catalog JSON not found for ${itemId}`);
  }
  return JSON.parse(entry.getData().toString('utf8'));
}

/**
 * @param {string} dbPath
 * @param {string} sha1
 */
function lookupCatalogItemBySha1(dbPath, sha1) {
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare(`
      SELECT item_id, index7z_name, indexbps_name, sfc_rom_sha256_hash, sfc_rom_sha1_hash
      FROM items WHERE LOWER(sfc_rom_sha1_hash) = LOWER(?)
      LIMIT 1
    `).get(sha1);
    return row || null;
  } finally {
    db.close();
  }
}

/**
 * @param {object} params
 */
async function findOrDownloadCatalogBps(params) {
  const {
    item,
    itemJson,
    userDataPath,
    onProgress,
    downloadSevenZ,
  } = params;

  const searchPaths = buildCatalogSearchPaths({ userDataPath });
  let sevenZPath = findSevenZLocally(item.index7z_name, searchPaths);

  if (!sevenZPath && downloadSevenZ) {
    onProgress?.(`Downloading ${item.index7z_name}…`);
    sevenZPath = await downloadSevenZ(item);
  }

  if (!sevenZPath) {
    throw new Error(`7z archive not found: ${item.index7z_name}`);
  }

  const sevenZip = require('node-7z');
  const tempDir = makeExtractTempDir('share-code-catalog');
  onProgress?.('Extracting BPS…');
  const bpsPath = await extractBpsFromSevenZ(
    sevenZip,
    sevenZPath,
    item.indexbps_name || itemJson?.indexbps_name,
    tempDir
  );
  return { bpsPath, itemJson };
}

/**
 * @param {object} params
 */
async function installGameFromCatalogSha1(params) {
  const {
    sha1,
    userDataPath,
    clientDbPath,
    rhdataDb,
    onProgress,
    downloadSevenZ,
    createRhpak,
    importRhpak,
  } = params;

  const existing = resolveSha1ToGame(rhdataDb, sha1);
  if (existing) {
    return existing;
  }

  onProgress?.('Checking catalog…');
  const { dbPath, zipPath } = ensureCatalogBaseFiles(userDataPath);
  const item = lookupCatalogItemBySha1(dbPath, sha1);
  if (!item?.item_id) {
    throw new Error(`No catalog item for SHA1 ${sha1.slice(0, 8)}`);
  }

  onProgress?.(`Found catalog item ${item.item_id.slice(0, 8)}…`);
  const itemJson = readCatalogItemJson(zipPath, item.item_id);
  const { bpsPath } = await findOrDownloadCatalogBps({
    item,
    itemJson,
    userDataPath,
    onProgress,
    downloadSevenZ,
  });

  onProgress?.('Creating RHPAK…');
  const rhpak = await createRhpak({
    itemId: item.item_id,
    bpsPath,
    sfcSha256: item.sfc_rom_sha256_hash,
    itemJson,
    clientDbPath,
  });
  if (!rhpak?.rhpakPath) {
    throw new Error(rhpak?.error || 'RHPAK creation failed');
  }

  onProgress?.('Installing RHPAK…');
  const imported = await importRhpak(rhpak.rhpakPath);
  if (!imported?.success) {
    throw new Error(imported?.error || 'RHPAK import failed');
  }

  const resolved = resolveSha1ToGame(rhdataDb, sha1);
  if (!resolved) {
    throw new Error('Game installed but SHA1 still not found in rhdata');
  }
  return resolved;
}

module.exports = {
  ensureCatalogBaseFiles,
  readCatalogItemJson,
  lookupCatalogItemBySha1,
  findOrDownloadCatalogBps,
  installGameFromCatalogSha1,
};
