/**
 * SMWC Maps Manager
 * Fetches and caches SMW memory map JSON files from IPFS.
 * CID from coremanifest smwcmaps key; fallback to default.
 * Cache in userData/smwcmaps; re-fetch at most once per day.
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const manifestResolver = require('./manifest-resolver');
const ipfsFetchConfig = require('./ipfs-fetch-config');

const FALLBACK_CID = 'bafybeibtobdikzquow5z65fgxqjd3xmk53pgytglp55ysxjyn6fbglf3hu';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const EXPECTED_FILES = ['smwrammap.json', 'smwrommap.json', 'smwregs.json', 'smwsram.json', 'smwhijacks.json', 'smwtables.json'];

function readMapFiles(mapsDir) {
  const files = {};
  for (const name of EXPECTED_FILES) {
    const filePath = path.join(mapsDir, name);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const key = name.replace('.json', '');
        files[key] = JSON.parse(content);
      } catch (err) {
        console.warn(`[smwcmaps-manager] Failed to read ${name}:`, err.message);
      }
    }
  }
  return files;
}

function getMapsDir() {
  const userDataDir = manifestResolver.getUserDataDir();
  return path.join(userDataDir, 'smwcmaps');
}

function getLastFetchedPath() {
  return path.join(getMapsDir(), '.last_fetched');
}

function isCacheFresh() {
  const p = getLastFetchedPath();
  if (!fs.existsSync(p)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const fetchedAt = data.fetchedAt;
    if (typeof fetchedAt !== 'number') return false;
    return Date.now() - fetchedAt < CACHE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Ensure maps data is available. Fetches from IPFS if cache is stale or missing.
 * @returns {{ success: boolean, error?: string, mapsDir?: string, files?: Record<string, string> }}
 */
async function ensureMapsData() {
  const mapsDir = getMapsDir();
  ensureDir(mapsDir);

  if (isCacheFresh()) {
    const files = readMapFiles(mapsDir);
    return { success: true, mapsDir, files };
  }

  let cid = FALLBACK_CID;
  try {
    const manifest = manifestResolver.loadCoreManifest();
    if (manifest && typeof manifest.smwcmaps === 'string' && manifest.smwcmaps.trim()) {
      cid = manifest.smwcmaps.trim();
    }
  } catch (err) {
    console.warn('[smwcmaps-manager] Could not load coremanifest, using fallback CID:', err.message);
  }

  const userDataDir = manifestResolver.getUserDataDir();
  const tempZipPath = path.join(mapsDir, 'smwcmaps_temp.zip');

  try {
    await ipfsFetchConfig.fetchFromIpfs({
      cid,
      destPath: tempZipPath,
      spec: { file_name: 'smwcmaps.zip' },
      userDataDir,
      ipfsTimeout: 60,
    });

    const zip = new AdmZip(tempZipPath);
    zip.extractAllTo(mapsDir, true);
    fs.unlinkSync(tempZipPath);

    // If zip had a single subdir (e.g. maps/), move files to root
    const entries = fs.readdirSync(mapsDir);
    if (entries.length === 1 && entries[0] !== '.last_fetched') {
      const subPath = path.join(mapsDir, entries[0]);
      const stat = fs.statSync(subPath);
      if (stat.isDirectory()) {
        const subFiles = fs.readdirSync(subPath);
        for (const f of subFiles) {
          fs.renameSync(path.join(subPath, f), path.join(mapsDir, f));
        }
        fs.rmdirSync(subPath);
      }
    }

    fs.writeFileSync(getLastFetchedPath(), JSON.stringify({ fetchedAt: Date.now() }));

    const files = readMapFiles(mapsDir);
    return { success: true, mapsDir, files };
  } catch (err) {
    if (fs.existsSync(tempZipPath)) {
      try {
        fs.unlinkSync(tempZipPath);
      } catch (e) {}
    }
    console.error('[smwcmaps-manager] Fetch failed:', err);
    return {
      success: false,
      error: err.message || 'Failed to fetch maps from IPFS',
      mapsDir,
    };
  }
}

module.exports = {
  ensureMapsData,
  getMapsDir,
};
