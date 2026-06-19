/**
 * game_zip_resolver.js - Locate or download game ZIP files for catalog backfill
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  SMWC_BASE_URL: 'https://www.smwcentral.net/',
  USER_AGENT: 'rhtools-gameversions27zfolder/1.0',
  DOWNLOAD_RETRY_MAX: 3,
  DOWNLOAD_TIMEOUT: 120000
};

function normalizeUrl(url, smwcBaseUrl = DEFAULT_CONFIG.SMWC_BASE_URL) {
  if (!url) return url;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return smwcBaseUrl.replace(/\/$/, '') + url;
  return url;
}

function isValidZip(buffer) {
  if (!buffer || buffer.length < 4) return false;
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4B) return false;
  const type = (buffer[2] << 8) | buffer[3];
  return [0x0304, 0x0506, 0x0708].includes(type);
}

function basenameFromUrl(url) {
  if (!url) return null;
  try {
    const decoded = decodeURIComponent(url.split('/').pop() || '');
    return decoded || null;
  } catch (e) {
    return url.split('/').pop() || null;
  }
}

function collectFilenameCandidates(gameid, metadata, row) {
  const names = new Set();
  const gid = String(gameid);
  names.add(`${gid}.zip`);

  const addName = (value) => {
    if (!value) return;
    const base = path.basename(String(value));
    if (base) names.add(base);
  };

  addName(metadata && metadata.original_download_filename);
  addName(row && row.local_resource_filename);
  addName(basenameFromUrl(row && row.download_url));
  addName(basenameFromUrl(metadata && metadata.download_url));
  addName(basenameFromUrl(metadata && metadata.name_href));

  return [...names];
}

function walkZipFiles(rootDir, onFile) {
  if (!rootDir || !fs.existsSync(rootDir)) return;
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && /\.zip$/i.test(entry.name)) {
        onFile(full, entry.name);
      }
    }
  }
}

/**
 * Find a game ZIP under sourceRoot by gameid or known original filenames.
 */
function findGameZip(sourceRoot, gameid, metadata, row) {
  if (!sourceRoot || !fs.existsSync(sourceRoot)) return null;

  const gid = String(gameid);
  const candidates = collectFilenameCandidates(gid, metadata, row);
  const candidateLower = new Map(candidates.map(n => [n.toLowerCase(), n]));

  let gameIdMatch = null;
  let nameMatch = null;

  walkZipFiles(sourceRoot, (fullPath, fileName) => {
    if (gameIdMatch) return;
    const lower = fileName.toLowerCase();
    if (lower === `${gid}.zip`) {
      gameIdMatch = fullPath;
      return;
    }
    if (!nameMatch && candidateLower.has(lower)) {
      nameMatch = fullPath;
    }
  });

  return gameIdMatch || nameMatch || null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Download ZIP to destDir/{gameid}.zip with retry.
 */
async function downloadGameZip(gameid, downloadUrl, destDir, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const url = normalizeUrl(downloadUrl, cfg.SMWC_BASE_URL);
  if (!url) {
    throw new Error(`No download URL for game ${gameid}`);
  }

  fs.mkdirSync(destDir, { recursive: true });
  const zipPath = path.join(destDir, `${gameid}.zip`);

  if (fs.existsSync(zipPath)) {
    const buf = fs.readFileSync(zipPath);
    if (isValidZip(buf)) {
      return zipPath;
    }
  }

  let lastError = null;
  for (let attempt = 0; attempt < cfg.DOWNLOAD_RETRY_MAX; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), cfg.DOWNLOAD_TIMEOUT);
      const response = await fetch(url, {
        headers: { 'User-Agent': cfg.USER_AGENT },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (!isValidZip(buffer)) {
        throw new Error('Downloaded file is not a valid ZIP archive');
      }

      const tempPath = `${zipPath}.tmp`;
      fs.writeFileSync(tempPath, buffer);
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      fs.renameSync(tempPath, zipPath);
      return zipPath;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < cfg.DOWNLOAD_RETRY_MAX) {
        const backoff = Math.min(5000 * Math.pow(2, attempt), 30000);
        await sleep(backoff);
      }
    }
  }

  throw new Error(`Failed to download after ${cfg.DOWNLOAD_RETRY_MAX} attempts: ${lastError.message}`);
}

/**
 * Resolve local ZIP path: search sourceRoot, optionally download.
 * Returns { zipPath, source: 'local'|'download'|'existing-download-dir'|null }
 */
async function resolveGameZip(opts) {
  const {
    sourceRoot,
    gameid,
    metadata,
    row,
    downloadUrl,
    downloadDir,
    allowDownload = true,
    config = {},
    logFn = () => {}
  } = opts;

  const local = findGameZip(sourceRoot, gameid, metadata, row);
  if (local) {
    return { zipPath: local, source: 'local' };
  }

  if (downloadDir) {
    const cached = path.join(downloadDir, `${gameid}.zip`);
    if (fs.existsSync(cached)) {
      const buf = fs.readFileSync(cached);
      if (isValidZip(buf)) {
        return { zipPath: cached, source: 'existing-download-dir' };
      }
    }
  }

  const url = downloadUrl
    || (row && row.download_url)
    || (metadata && metadata.download_url)
    || (metadata && metadata.name_href);

  if (!allowDownload) {
    return { zipPath: null, source: null, error: 'ZIP not found locally and download disabled' };
  }

  if (!url) {
    return { zipPath: null, source: null, error: 'ZIP not found and no download_url available' };
  }

  logFn(`  Downloading ZIP for game ${gameid}...`);
  const zipPath = await downloadGameZip(gameid, url, downloadDir, config);
  return { zipPath, source: 'download' };
}

module.exports = {
  DEFAULT_CONFIG,
  normalizeUrl,
  isValidZip,
  basenameFromUrl,
  collectFilenameCandidates,
  findGameZip,
  downloadGameZip,
  resolveGameZip
};
