#!/usr/bin/env node

/**
 * ipfs-fetch-config.js
 *
 * Central configuration for IPFS fetch behavior. Supports:
 * - Environment variables (highest precedence)
 * - user-fetch-settings.json in user data directory
 * - Program defaults
 *
 * Fetch modes: helia (default, verified fetch via HTTP gateways), basic (legacy fetch)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const FETCH_SETTINGS_FILENAME = 'user-fetch-settings.json';

const STANDARD_GATEWAYS = [
  'https://ipfs.4everland.io/ipfs/',
  'https://w3s.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://rhtools.4everland.link/ipfs/',
];

const DEFAULT_CONFIG = {
  ipfs: {
    fetch_mode: 'helia',
    helia_mode: 'http',
    parallel: 5,
    gateway_selection: 'standard',
    gateway_list: [],
  },
  p2p_opt_in: false,
};

let cachedConfig = null;
let cachedGateways = null;
let heliaVerifiedFetchPromise = null;

/**
 * Get user data directory (works in Electron and standalone Node)
 * @param {string} [userDataDirOverride] - Override from --user-data-dir (prepare_databases)
 * @returns {string}
 */
function getUserDataDir(userDataDirOverride) {
  if (userDataDirOverride) {
    return userDataDirOverride;
  }
  try {
    const { app } = require('electron');
    return app.getPath('userData');
  } catch (err) {
    const os = require('os');
    const platform = process.platform;
    if (platform === 'win32') {
      const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      return path.join(base, 'RHTools');
    }
    if (platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Application Support', 'RHTools');
    }
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(configHome, 'RHTools');
  }
}

/**
 * Parse IPFS_GATEWAY_LIST from env (comma-separated or JSON array)
 * @returns {string[]}
 */
function parseGatewayListFromEnv() {
  const raw = process.env.IPFS_GATEWAY_LIST;
  if (!raw || typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
    } catch (e) {
      return [];
    }
  }
  return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Normalize gateway entries to full URL with /ipfs/ suffix for basic fetch
 * Input can be hostname (rhtools.4everland.link) or full URL (https://rhtools.4everland.link/ipfs/)
 * @param {string[]} list
 * @returns {string[]}
 */
function normalizeGateways(list) {
  return list.map((g) => {
    const t = g.trim();
    if (!t) return null;
    if (t.startsWith('http://') || t.startsWith('https://')) {
      return t.endsWith('/') ? t : `${t}/`;
    }
    return `https://${t}/ipfs/`;
  }).filter(Boolean);
}

/**
 * Load user config from file
 * @param {string} userDataDir
 * @returns {object|null}
 */
function loadUserConfig(userDataDir) {
  const filePath = path.join(userDataDir, FETCH_SETTINGS_FILENAME);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    console.warn(`[ipfs-fetch-config] Failed to load ${filePath}:`, err.message);
    return null;
  }
}

/**
 * Get merged fetch config. Precedence: env > user file > defaults.
 * @param {string} [userDataDir] - User data dir (for prepare_databases standalone)
 * @returns {object}
 */
function getFetchConfig(userDataDir) {
  if (cachedConfig && !userDataDir) {
    return cachedConfig;
  }
  const dir = getUserDataDir(userDataDir);
  const userConfig = loadUserConfig(dir);

  const ipfs = { ...DEFAULT_CONFIG.ipfs };

  if (userConfig && userConfig.ipfs && typeof userConfig.ipfs === 'object') {
    if (userConfig.ipfs.fetch_mode) ipfs.fetch_mode = userConfig.ipfs.fetch_mode;
    if (userConfig.ipfs.helia_mode) ipfs.helia_mode = userConfig.ipfs.helia_mode;
    if (typeof userConfig.ipfs.parallel === 'number') ipfs.parallel = userConfig.ipfs.parallel;
    if (userConfig.ipfs.gateway_selection) ipfs.gateway_selection = userConfig.ipfs.gateway_selection;
    if (Array.isArray(userConfig.ipfs.gateway_list)) ipfs.gateway_list = userConfig.ipfs.gateway_list;
  }

  // Environment overrides
  if (process.env.IPFS_FETCH_MODE) {
    const m = process.env.IPFS_FETCH_MODE.toLowerCase();
    if (m === 'basic' || m === 'helia') ipfs.fetch_mode = m;
  }
  if (process.env.IPFS_HELIA_MODE) {
    const m = process.env.IPFS_HELIA_MODE.toLowerCase();
    if (m === 'http' || m === 'rpc') ipfs.helia_mode = m;
  }
  if (process.env.IPFS_PARALLEL_FETCH !== undefined && process.env.IPFS_PARALLEL_FETCH !== '') {
    const n = parseInt(process.env.IPFS_PARALLEL_FETCH, 10);
    if (!isNaN(n) && n >= 0) ipfs.parallel = n;
  }
  if (process.env.IPFS_GATEWAY_SELECTION) {
    const s = process.env.IPFS_GATEWAY_SELECTION.toLowerCase();
    if (['standard', 'replace', 'append', 'prepend'].includes(s)) ipfs.gateway_selection = s;
  }
  const envGateways = parseGatewayListFromEnv();
  if (envGateways.length > 0) {
    ipfs.gateway_list = envGateways;
  }

  const config = {
    ipfs,
    p2p_opt_in: (userConfig && userConfig.p2p_opt_in === true) || false,
  };
  if (!userDataDir) {
    cachedConfig = config;
  }
  return config;
}

/**
 * Get resolved gateway list for IPFS fetch (full URLs with /ipfs/ suffix)
 * @param {string} [userDataDir]
 * @returns {string[]}
 */
function getResolvedGateways(userDataDir) {
  const cacheKey = userDataDir || 'default';
  if (cachedGateways && cacheKey === 'default') {
    return cachedGateways;
  }
  const cfg = getFetchConfig(userDataDir);
  const { gateway_selection, gateway_list } = cfg.ipfs;
  const normalized = normalizeGateways(gateway_list);

  let list;
  switch (gateway_selection) {
    case 'replace':
      list = normalized.length > 0 ? normalized : STANDARD_GATEWAYS;
      break;
    case 'append':
      list = [...STANDARD_GATEWAYS, ...normalized];
      break;
    case 'prepend':
      list = [...normalized, ...STANDARD_GATEWAYS];
      break;
    case 'standard':
    default:
      list = normalized.length > 0 ? normalized : STANDARD_GATEWAYS;
      break;
  }

  if (!userDataDir) {
    cachedGateways = list;
  }
  return list;
}

/**
 * Get fetch mode
 * @param {string} [userDataDir]
 * @returns {'helia'|'basic'}
 */
function getFetchMode(userDataDir) {
  return getFetchConfig(userDataDir).ipfs.fetch_mode;
}

/**
 * Get parallel concurrency (0 = sequential)
 * @param {string} [userDataDir]
 * @returns {number}
 */
function getParallelCount(userDataDir) {
  return getFetchConfig(userDataDir).ipfs.parallel;
}

/**
 * Get path to user-fetch-settings.json
 * @param {string} [userDataDir]
 * @returns {string}
 */
function getFetchSettingsPath(userDataDir) {
  return path.join(getUserDataDir(userDataDir), FETCH_SETTINGS_FILENAME);
}

/**
 * Check if user-fetch-settings.json exists
 * @param {string} [userDataDir]
 * @returns {boolean}
 */
function fetchSettingsPathExists(userDataDir) {
  return fs.existsSync(getFetchSettingsPath(userDataDir));
}

/**
 * Write user-fetch-settings.json
 * @param {object} config
 * @param {string} [userDataDir]
 */
function saveFetchSettings(config, userDataDir) {
  const dir = getUserDataDir(userDataDir);
  const filePath = path.join(dir, FETCH_SETTINGS_FILENAME);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
    clearConfigCache();
  } catch (err) {
    throw new Error(`Failed to save fetch settings: ${err.message}`);
  }
}

/**
 * Create Helia verified fetch (lazy, cached)
 * Uses HTTP gateways only - no local node
 * @returns {Promise<Function>}
 */
async function createHeliaVerifiedFetch() {
  if (heliaVerifiedFetchPromise) {
    return heliaVerifiedFetchPromise;
  }
  heliaVerifiedFetchPromise = (async () => {
    const gateways = getResolvedGateways();
    const gatewayBases = gateways.map((g) => {
      const match = g.match(/^(https?:\/\/[^/]+)/);
      return match ? match[1] : g.replace(/\/ipfs\/?$/, '');
    });
    const { createVerifiedFetch } = await import('@helia/verified-fetch');
    return createVerifiedFetch({
      gateways: gatewayBases.length > 0 ? gatewayBases : ['https://trustless-gateway.link'],
      routers: ['https://delegated-ipfs.dev'],
    });
  })();
  return heliaVerifiedFetchPromise;
}

/**
 * SHA256 of file
 * @param {string} filePath
 * @returns {string|null}
 */
function sha256File(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (err) {
    return null;
  }
}

/**
 * Fetch from IPFS using configured mode (helia or basic)
 * @param {object} options
 * @param {string} options.cid - IPFS CID
 * @param {string} options.destPath - Destination file path
 * @param {string} [options.expectedSha256] - Optional SHA256 for verification
 * @param {object} options.spec - Artifact spec (file_name, etc.)
 * @param {object} [options.downloadTracker] - Progress tracker
 * @param {number} [options.ipfsTimeout=20] - Timeout in seconds
 * @param {Function} [options.progressCallback] - Progress message callback
 * @param {string} [options.userDataDir] - User data dir override
 */
async function fetchFromIpfs(options) {
  const {
    cid,
    destPath,
    expectedSha256,
    spec,
    downloadTracker,
    ipfsTimeout = 20,
    progressCallback,
    userDataDir,
  } = options;

  let mode = getFetchMode(userDataDir);
  if (mode === 'manual') {
    mode = 'basic'; // Manual = user runs local node; use basic fetch (gateways) for now
  }
  const gateways = getResolvedGateways(userDataDir);
  const parallel = getParallelCount(userDataDir);

  if (mode === 'helia') {
    return fetchFromIpfsHelia({
      cid,
      destPath,
      expectedSha256,
      spec,
      downloadTracker,
      ipfsTimeout,
      progressCallback,
      gateways,
      parallel,
    });
  }
  return fetchFromIpfsBasic({
    cid,
    destPath,
    expectedSha256,
    spec,
    downloadTracker,
    ipfsTimeout,
    progressCallback,
    gateways,
    parallel,
  });
}

/**
 * Basic fetch: native fetch + gateways, parallel or sequential
 */
async function fetchFromIpfsBasic(options) {
  const {
    cid,
    destPath,
    expectedSha256,
    spec,
    downloadTracker,
    ipfsTimeout,
    progressCallback,
    gateways,
    parallel,
  } = options;

  const tempDir = path.dirname(destPath);
  const batchSize = parallel > 0 ? Math.min(parallel, gateways.length) : 1;
  const abortControllers = [];
  let successfulDownload = null;
  let lastError = null;

  if (progressCallback) {
    progressCallback(`Testing ${gateways.length} IPFS gateways (${batchSize} in parallel)...`);
  }

  for (let i = 0; i < gateways.length; i += batchSize) {
    const batch = gateways.slice(i, i + batchSize);
    const batchPromises = batch.map((gateway, batchIdx) => {
      const gatewayUrl = `${gateway}${cid}`;
      const gatewayLabel = `ipfs:${gateway}`;
      const controller = new AbortController();
      abortControllers.push(controller);
      const tempPath = path.join(tempDir, `${spec.file_name}.ipfs.${i + batchIdx}`);

      const timeout = setTimeout(() => controller.abort(), ipfsTimeout * 1000);

      return fetch(gatewayUrl, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
          }
          const totalBytes = Number(response.headers.get('content-length')) || 0;
          if (downloadTracker && !successfulDownload) {
            downloadTracker.start(spec, totalBytes);
          }
          const writeStream = fs.createWriteStream(tempPath);
          const bodyStream = Readable.fromWeb(response.body);
          let downloadedBytes = 0;
          const { Transform } = require('stream');
          const tracker = new Transform({
            transform(chunk, encoding, callback) {
              downloadedBytes += chunk.length;
              if (downloadTracker && !successfulDownload) {
                downloadTracker.progress(spec, downloadedBytes, totalBytes);
              }
              callback(null, chunk);
            },
          });
          await pipeline(bodyStream, tracker, writeStream);
          writeStream.close();
          if (expectedSha256) {
            const actualSha = sha256File(tempPath);
            if (actualSha !== expectedSha256) {
              fs.unlinkSync(tempPath);
              throw new Error(`SHA-256 mismatch (expected ${expectedSha256}, got ${actualSha})`);
            }
          }
          clearTimeout(timeout);
          return { success: true, path: tempPath, label: gatewayLabel };
        })
        .catch((err) => {
          clearTimeout(timeout);
          if (fs.existsSync(tempPath)) {
            try {
              fs.unlinkSync(tempPath);
            } catch (e) {}
          }
          const msg = err.name === 'AbortError' ? `Timeout after ${ipfsTimeout}s` : err.message;
          return { success: false, error: msg, label: gatewayLabel };
        });
    });

    const batchResults = await Promise.allSettled(batchPromises);

    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value.success && !successfulDownload) {
        successfulDownload = result.value;
        abortControllers.forEach((c) => {
          try {
            c.abort();
          } catch (e) {}
        });
        fs.copyFileSync(successfulDownload.path, destPath);
        fs.unlinkSync(successfulDownload.path);
        if (downloadTracker) downloadTracker.complete(spec);
        return;
      } else if (result.status === 'fulfilled' && !result.value.success) {
        lastError = new Error(result.value.error);
      }
    }
  }

  throw lastError || new Error('All IPFS gateways failed');
}

/**
 * Helia verified fetch: uses @helia/verified-fetch with HTTP gateways
 */
async function fetchFromIpfsHelia(options) {
  const {
    cid,
    destPath,
    expectedSha256,
    spec,
    downloadTracker,
    ipfsTimeout,
    progressCallback,
    gateways,
    parallel,
  } = options;

  const verifiedFetch = await createHeliaVerifiedFetch();
  const ipfsUrl = `ipfs://${cid}`;

  if (progressCallback) {
    progressCallback('Fetching from IPFS (Helia verified fetch)...');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), (ipfsTimeout || 20) * 1000);

  try {
    const response = await verifiedFetch(ipfsUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`IPFS fetch failed: ${response.status} ${response.statusText}`);
    }

    const totalBytes = Number(response.headers.get('content-length')) || 0;
    if (downloadTracker) {
      downloadTracker.start(spec, totalBytes);
    }

    const tempPath = `${destPath}.helia.tmp`;
    const writeStream = fs.createWriteStream(tempPath);
    const body = response.body;
    if (!body) {
      throw new Error('No response body from IPFS');
    }
    const bodyStream = Readable.fromWeb(body);
    const { Transform } = require('stream');
    let downloadedBytes = 0;
    const tracker = new Transform({
      transform(chunk, encoding, callback) {
        downloadedBytes += chunk.length;
        if (downloadTracker) {
          downloadTracker.progress(spec, downloadedBytes, totalBytes);
        }
        callback(null, chunk);
      },
    });
    await pipeline(bodyStream, tracker, writeStream);
    writeStream.close();

    if (expectedSha256) {
      const actualSha = sha256File(tempPath);
      if (actualSha !== expectedSha256) {
        fs.unlinkSync(tempPath);
        throw new Error(`SHA-256 mismatch (expected ${expectedSha256}, got ${actualSha})`);
      }
    }

    await fs.promises.rename(tempPath, destPath);
    if (downloadTracker) {
      downloadTracker.complete(spec);
    }
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

function clearConfigCache() {
  cachedConfig = null;
  cachedGateways = null;
  heliaVerifiedFetchPromise = null;
}

module.exports = {
  getFetchConfig,
  getResolvedGateways,
  getFetchMode,
  getParallelCount,
  getFetchSettingsPath,
  fetchSettingsPathExists,
  saveFetchSettings,
  fetchFromIpfs,
  getUserDataDir,
  FETCH_SETTINGS_FILENAME,
  STANDARD_GATEWAYS,
  clearConfigCache,
};
