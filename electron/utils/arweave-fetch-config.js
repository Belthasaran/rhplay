#!/usr/bin/env node

/**
 * arweave-fetch-config.js
 *
 * Central configuration for Arweave/ArDrive fetch. Reads from the same
 * user-fetch-settings.json as IPFS (via ipfs-fetch-config.getFetchConfig).
 * Supports legacy fixed gateway (arweave.net or ardrive.net) or Wayfinder
 * client with dynamic gateway routing.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const ipfsFetchConfig = require('./ipfs-fetch-config');

let wayfinderClientPromise = null;
let wayfinderUnavailable = false;

/**
 * Normalize gateway base URL (no trailing slash)
 * @param {string} gateway
 * @returns {string}
 */
function normalizeLegacyGateway(gateway) {
  if (!gateway || typeof gateway !== 'string') return 'https://arweave.net:443';
  const t = gateway.trim();
  if (!t) return 'https://arweave.net:443';
  return t.endsWith('/') ? t.slice(0, -1) : t;
}

/**
 * Get Arweave fetch mode from config
 * @param {string} [userDataDir]
 * @returns {'legacy'|'wayfinder'}
 */
function getArweaveFetchMode(userDataDir) {
  const cfg = ipfsFetchConfig.getFetchConfig(userDataDir);
  const mode = (cfg.arweave && cfg.arweave.fetch_mode) || 'legacy';
  return mode === 'wayfinder' ? 'wayfinder' : 'legacy';
}

/**
 * Get legacy (fixed) gateway base URL for Arweave/ArDrive
 * @param {string} [userDataDir]
 * @returns {string}
 */
function getArweaveLegacyGateway(userDataDir) {
  const cfg = ipfsFetchConfig.getFetchConfig(userDataDir);
  const gateway = (cfg.arweave && cfg.arweave.legacy_gateway) || 'https://arweave.net:443';
  return normalizeLegacyGateway(gateway);
}

/**
 * Get list of Arweave gateways for display (e.g. Software Update dialog).
 * Legacy: single configured gateway; Wayfinder: placeholder for dynamic.
 * @param {string} [userDataDir]
 * @returns {string[]}
 */
function getArweaveGatewaysForDisplay(userDataDir) {
  const mode = getArweaveFetchMode(userDataDir);
  if (mode === 'legacy') {
    return [getArweaveLegacyGateway(userDataDir)];
  }
  return ['Wayfinder (dynamic)'];
}

/** Default trusted gateways for Wayfinder peer discovery (fetches /ar-io/peers). Order = fallback sequence. */
const DEFAULT_WAYFINDER_TRUSTED_GATEWAYS = [
  'https://permagate.io',
  'https://ardrive.net',
  'https://ar-io.net',
  'https://arweave.net',
];

/**
 * Get list of trusted gateways for Wayfinder peer discovery (from config or defaults).
 * @param {string} [userDataDir]
 * @returns {string[]}
 */
function getWayfinderTrustedGateways(userDataDir) {
  const cfg = ipfsFetchConfig.getFetchConfig(userDataDir);
  const list = cfg.arweave?.wayfinder_trusted_gateways;
  if (Array.isArray(list) && list.length > 0) {
    return list.filter((g) => typeof g === 'string' && g.trim()).map((g) => g.trim());
  }
  return DEFAULT_WAYFINDER_TRUSTED_GATEWAYS;
}

/**
 * Create a resilient gateways provider that tries multiple trusted peers in sequence.
 * If one host (e.g. arweave.net) is down, discovery still works via others.
 * @param {string} [userDataDir]
 * @returns {Promise<object>}
 */
async function createResilientGatewaysProvider(userDataDir) {
  const gateways = getWayfinderTrustedGateways(userDataDir);
  const {
    CompositeGatewaysProvider,
    TrustedPeersGatewaysProvider,
    SimpleCacheGatewaysProvider,
  } = await import('@ar.io/wayfinder-core');
  const providers = gateways.map((g) => new TrustedPeersGatewaysProvider({ trustedGateway: g }));
  const composite = new CompositeGatewaysProvider({ providers });
  return new SimpleCacheGatewaysProvider({
    gatewaysProvider: composite,
    ttlSeconds: 300,
  });
}

/**
 * Create Wayfinder client (lazy, cached). Uses RandomRoutingStrategy with a resilient
 * gateways provider that tries multiple trusted peers (permagate, ardrive, ar-io, arweave).
 * @param {string} [userDataDir]
 * @returns {Promise<object>}
 */
async function createWayfinderClient(userDataDir) {
  if (wayfinderClientPromise) {
    return wayfinderClientPromise;
  }
  wayfinderClientPromise = (async () => {
    const {
      createWayfinderClient: createClient,
      createRoutingStrategy,
    } = await import('@ar.io/wayfinder-core');
    const gatewaysProvider = await createResilientGatewaysProvider(userDataDir);
    return createClient({
     telemetrySettings: {
        enabled: false
     },
      routingStrategy: createRoutingStrategy({
        strategy: 'random',
        gatewaysProvider,
      }),
    });
  })();
  return wayfinderClientPromise;
}

/**
 * Resolve Arweave download URL (txid or path) using config: legacy fixed URL or Wayfinder resolveUrl.
 * @param {object} options
 * @param {string} [options.txid] - Arweave transaction ID
 * @param {string} [options.path] - ArDrive path (e.g. /SMWRH/...)
 * @param {string} [options.userDataDir]
 * @returns {Promise<string>} - HTTP URL to fetch
 */
async function resolveArweaveDownloadUrl(options) {
  const { txid, path: pathPart, userDataDir } = options;
  const mode = getArweaveFetchMode(userDataDir);
  const base = getArweaveLegacyGateway(userDataDir);

  if (mode === 'legacy') {
    if (txid) {
      return `${base}/${txid}`;
    }
    if (pathPart && typeof pathPart === 'string') {
      const p = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
      return `${base}${p}`;
    }
    throw new Error('resolveArweaveDownloadUrl: need txid or path');
  }

  if (wayfinderUnavailable) {
    if (txid) return `${base}/${txid}`;
    if (pathPart) return `${base}${pathPart.startsWith('/') ? pathPart : '/' + pathPart}`;
    throw new Error('resolveArweaveDownloadUrl: need txid or path');
  }

  try {
    const wayfinder = await createWayfinderClient(userDataDir);
    /** @param {string|URL|{url?:string}} resolved */
    const toUrlString = (resolved) => {
      if (typeof resolved === 'string') return resolved;
      if (resolved && typeof resolved.href === 'string') return resolved.href;
      if (resolved && resolved.url) return resolved.url;
      return null;
    };
    if (txid) {
      const resolved = await wayfinder.resolveUrl({ txId: txid });
      const urlStr = toUrlString(resolved);
      if (urlStr) return urlStr;
    }
    if (pathPart && typeof pathPart === 'string') {
      const pathNorm = pathPart.startsWith('/') ? pathPart : '/' + pathPart;
      const legacyUrl = `https://arweave.net${pathNorm}`;
      const resolved = await wayfinder.resolveUrl({ originalUrl: legacyUrl });
      const urlStr = toUrlString(resolved);
      if (urlStr) return urlStr;
    }
  } catch (err) {
    const isModuleError = err && (
      (typeof err.message === 'string' && (
        err.message.includes('Cannot find package') ||
        err.message.includes('Cannot find module')
      )) ||
      err.code === 'ERR_MODULE_NOT_FOUND'
    );
    if (isModuleError) {
      wayfinderUnavailable = true;
      wayfinderClientPromise = null;
      console.warn('[arweave-fetch-config] Wayfinder unavailable, using legacy gateway:', err.message);
      if (txid) return `${base}/${txid}`;
      if (pathPart) return `${base}${pathPart.startsWith('/') ? pathPart : '/' + pathPart}`;
    }
    throw err;
  }

  throw new Error('resolveArweaveDownloadUrl: need txid or path');
}

function sha256File(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (err) {
    return null;
  }
}

/**
 * Fetch from Arweave/ArDrive and write to destPath. Uses config (legacy or Wayfinder).
 * @param {object} options
 * @param {string} [options.txid]
 * @param {string} [options.path] - ArDrive path
 * @param {string} options.destPath
 * @param {string} [options.expectedSha256]
 * @param {object} options.spec - { file_name } for progress
 * @param {object} [options.downloadTracker] - { start, progress, complete }
 * @param {string} [options.userDataDir]
 * @param {number} [options.timeoutMs=240000]
 * @param {string} [options.sourceLabel] - e.g. 'arweave:data_txid'
 */
async function fetchFromArweave(options) {
  const {
    txid,
    path: pathPart,
    destPath,
    expectedSha256,
    spec,
    downloadTracker,
    userDataDir,
    timeoutMs = 4 * 60 * 1000,
    sourceLabel = 'arweave',
  } = options;

  const url = await resolveArweaveDownloadUrl({ txid, path: pathPart, userDataDir });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timeout);
    const hint = err.cause ? ` (${String(err.cause.code || err.cause.message || err.cause)})` : '';
    const urlHint = typeof url === 'string' ? ` url=${url.replace(/^https?:\/\//, '').substring(0, 80)}...` : '';
    throw new Error(`fetch failed${hint}${urlHint}`, { cause: err });
  }
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const totalBytes = Number(response.headers.get('content-length')) || 0;
  if (downloadTracker) {
    downloadTracker.start(spec, totalBytes);
  }

  const tempPath = `${destPath}.download`;
  const writeStream = fs.createWriteStream(tempPath);
  const bodyStream = Readable.fromWeb(response.body);
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

  if (downloadTracker) {
    downloadTracker.complete(spec);
  }

  if (expectedSha256) {
    const actualSha = sha256File(tempPath);
    if (actualSha !== expectedSha256) {
      fs.unlinkSync(tempPath);
      throw new Error(`SHA-256 mismatch (expected ${expectedSha256}, got ${actualSha})`);
    }
  }

  await fs.promises.rename(tempPath, destPath);
}

function clearArweaveConfigCache() {
  wayfinderClientPromise = null;
  wayfinderUnavailable = false;
}

module.exports = {
  getArweaveFetchMode,
  getArweaveLegacyGateway,
  getArweaveGatewaysForDisplay,
  resolveArweaveDownloadUrl,
  fetchFromArweave,
  clearArweaveConfigCache,
};
