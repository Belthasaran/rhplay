/**
 * coremanifest-updater.js
 *
 * Check for updates to coremanifest via on-chain pointer, download, verify, and apply
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { queryLatestWithUrls } = require('./onchain-pointer');
const manifestResolver = require('./manifest-resolver');
const { verifyCoreManifestDat } = require('./verify-coremf-dat-internal');
const arweaveFetchConfig = require('./arweave-fetch-config');
const { resolveDnshostPointer, queryDnsPointer } = require('./dns-pointer');

/**
 * Get corepointer cache path
 */
function getCorepointerCachePath() {
  const userDataDir = manifestResolver.getUserDataDir();
  return path.join(userDataDir, 'corepointer.json');
}

/**
 * Load corepointer cache
 */
function loadCorepointerCache() {
  const cachePath = getCorepointerCachePath();
  if (!fs.existsSync(cachePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[coremanifest-updater] Failed to load corepointer cache:', err.message);
    return null;
  }
}

/**
 * Save corepointer cache
 */
function saveCorepointerCache(data) {
  const cachePath = getCorepointerCachePath();
  const dir = path.dirname(cachePath);
  manifestResolver.ensureDirectory(dir);
  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Get dns_corepointer cache path (DNS source only)
 */
function getDnsCorepointerCachePath() {
  const userDataDir = manifestResolver.getUserDataDir();
  return path.join(userDataDir, 'dns_corepointer.json');
}

/**
 * Load dns_corepointer cache
 */
function loadDnsCorepointerCache() {
  const cachePath = getDnsCorepointerCachePath();
  if (!fs.existsSync(cachePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[coremanifest-updater] Failed to load dns_corepointer cache:', err.message);
    return null;
  }
}

/**
 * Save dns_corepointer cache (only after DNS update applied and verified)
 */
function saveDnsCorepointerCache(data) {
  const cachePath = getDnsCorepointerCachePath();
  const dir = path.dirname(cachePath);
  manifestResolver.ensureDirectory(dir);
  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Download file from URL with timeout
 */
async function downloadFromUrl(url, timeoutMs = 30000) {
  const https = require('https');
  const http = require('http');
  
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https:') ? https : http;
    const request = protocol.get(url, { timeout: timeoutMs }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
    });
    
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Download file from IPFS CID
 */
async function downloadFromIpfs(cid, timeoutMs = 30000) {
  const gateways = [
    `https://ipfs.io/ipfs/${cid}`,
    `https://cloudflare-ipfs.com/ipfs/${cid}`,
    `https://w3s.link/ipfs/${cid}`,
    `https://ipfs.4everland.io/ipfs/${cid}`,
    `https://gateway.pinata.cloud/ipfs/${cid}`
  ];
  
  for (const gatewayUrl of gateways) {
    try {
      console.log(`[coremanifest-updater] Trying IPFS gateway: ${gatewayUrl}`);
      const data = await downloadFromUrl(gatewayUrl, timeoutMs);
      return data;
    } catch (err) {
      console.warn(`[coremanifest-updater] IPFS gateway failed: ${gatewayUrl}`, err.message);
      continue;
    }
  }
  
  throw new Error('All IPFS gateways failed');
}

/**
 * Download from ar:// URL using Wayfinder (resolve to gateway URL, then fetch)
 */
async function downloadFromArUrl(arUrl, timeoutMs = 30000) {
  const txid = arUrl.startsWith('ar://') ? arUrl.slice(5).trim() : null;
  if (!txid) {
    throw new Error('Invalid ar:// URL');
  }
  const userDataDir = manifestResolver.getUserDataDir();
  const resolvedUrl = await arweaveFetchConfig.resolveArweaveDownloadUrl({ txid, userDataDir });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(resolvedUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Download coremanifest.dat from IPFS or URLs
 */
async function downloadCoremanifestDat(pointer, timeoutMs = 30000) {
  // Try IPFS first if CID is available
  if (pointer.cid && pointer.cid.trim()) {
    try {
      return await downloadFromIpfs(pointer.cid, timeoutMs);
    } catch (err) {
      console.warn('[coremanifest-updater] IPFS download failed, trying URLs:', err.message);
    }
  }
  
  // Fall back to BREF URLs
  if (pointer.urls && pointer.urls.length > 0) {
    for (const url of pointer.urls) {
      try {
        console.log(`[coremanifest-updater] Trying URL: ${url}`);
        if (url.startsWith('ar://')) {
          return await downloadFromArUrl(url, timeoutMs);
        }
        return await downloadFromUrl(url, timeoutMs);
      } catch (err) {
        console.warn(`[coremanifest-updater] URL download failed: ${url}`, err.message);
        continue;
      }
    }
  }
  
  throw new Error('All download sources failed');
}

/**
 * Verify SHA256 matches on-chain payloadSha256
 */
function verifyOnChainSha256(downloadedBytes, payloadSha256) {
  const hash = crypto.createHash('sha256').update(downloadedBytes).digest('hex');
  const expected = payloadSha256.startsWith('0x') ? payloadSha256.slice(2) : payloadSha256;
  
  if (hash.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`SHA256 mismatch: expected ${expected}, got ${hash}`);
  }
}

/**
 * Get contract address from core manifest
 * Looks for pointer in coremanifest entry or uses default
 */
function getContractAddressFromManifest(manifest) {
  // Check for top-level pointer (future)
  if (manifest.pointer) {
    return manifest.pointer;
  }
  
  // Check coremanifest entry
  if (manifest.coremanifest && manifest.coremanifest.pointer) {
    return manifest.coremanifest.pointer;
  }
  
  // Check first software target's pointer (fallback)
  for (const key of Object.keys(manifest)) {
    if (key.includes('RHPLAY') && manifest[key] && manifest[key].pointer) {
      return manifest[key].pointer;
    }
  }
  
  // Default contract address
  return '0x43535E8280C0Ec9e845Cacb456C45f576d6D581a';
}

/**
 * Apply verified manifest bytes (writes .dat and .json, returns manifest)
 */
function applyManifestBytes(downloadedBytes, verifyResult) {
  const userDataDir = manifestResolver.getUserDataDir();
  const datPath = path.join(userDataDir, 'coremanifest_latest.dat');
  const jsonPath = path.join(userDataDir, 'coremanifest_latest.json');
  const tempDatPath = `${datPath}.tmp`;
  const tempJsonPath = `${jsonPath}.tmp`;
  const newManifest = verifyResult.manifest;

  fs.writeFileSync(tempDatPath, downloadedBytes);
  fs.writeFileSync(tempJsonPath, JSON.stringify(newManifest, null, 2), 'utf8');
  fs.renameSync(tempDatPath, datPath);
  fs.renameSync(tempJsonPath, jsonPath);

  return newManifest;
}

/**
 * Check for updates and apply if available
 *
 * Flow: (1) Check on-chain pointer; if newer, download and apply. (2) If on-chain fails or not newer,
 * check DNS pointer; if newer, download and apply. Separate caches: corepointer.json (on-chain),
 * dns_corepointer.json (DNS). Both compare against coremanifest_latest.json (manifest) for "newer".
 *
 * @param {string} [contractAddress] - PointerRegistry contract address (if not provided, extracted from manifest)
 * @param {Object} options - Options
 * @param {boolean} options.forceCheck - Force check even if cache says up to date
 * @param {string} options.customRpcUrl - Custom RPC URL
 * @returns {Promise<Object>} Result: { updated: boolean, currentVersion: number, newVersion: number|null, source?: 'onchain'|'dns', error?: string }
 */
async function checkForUpdates(contractAddress = null, options = {}) {
  const { forceCheck = false, customRpcUrl = null } = options;

  try {
    const currentManifest = manifestResolver.loadCoreManifest();
    if (!currentManifest) {
      throw new Error('Failed to load current core manifest');
    }

    const currentLastupdated = manifestResolver.normalizeLastUpdated(currentManifest.lastupdated);
    const currentVersionId = typeof currentManifest.versionid === 'number' ? currentManifest.versionid : null;

    const actualContractAddress = contractAddress || getContractAddressFromManifest(currentManifest);

    // ---- Step 1: Query on-chain pointer ----
    console.log(`[coremanifest-updater] Querying on-chain pointer at ${actualContractAddress}...`);
    let pointer;
    try {
      pointer = await queryLatestWithUrls(actualContractAddress, customRpcUrl);
    } catch (err) {
      console.warn('[coremanifest-updater] On-chain query failed:', err.message);
      pointer = null;
    }

    const isOnChainNewer = pointer && (
      (pointer.currentVersion > (currentVersionId ?? 0)) ||
      (pointer.updatedAt > (currentLastupdated ?? 0))
    );

    // Short-circuit: if not forceCheck and on-chain says we're up to date (same version)
    if (!forceCheck && pointer && !isOnChainNewer) {
      console.log('[coremanifest-updater] On-chain up to date (version/updatedAt not newer than manifest)');
      // Fall through to DNS check
    } else if (isOnChainNewer) {
      console.log('[coremanifest-updater] On-chain indicates update (version: %s, updatedAt: %s)', pointer.currentVersion, pointer.updatedAt);
      try {
        const downloadedBytes = await downloadCoremanifestDat(pointer, 30000);
        verifyOnChainSha256(downloadedBytes, pointer.payloadSha256);
        const verifyResult = await verifyCoreManifestDat(downloadedBytes);
        if (!verifyResult.valid) {
          throw new Error(verifyResult.error || 'verification failed');
        }
        const newManifest = verifyResult.manifest;
        const newLastupdated = manifestResolver.normalizeLastUpdated(newManifest.lastupdated);
        const now = Math.floor(Date.now() / 1000);
        if (newLastupdated > now) {
          throw new Error(`New manifest lastupdated is in the future: ${newLastupdated} > ${now}`);
        }
        if (currentLastupdated !== null && newLastupdated <= currentLastupdated) {
          console.log('[coremanifest-updater] New manifest not newer than current, skipping');
        } else {
          applyManifestBytes(downloadedBytes, verifyResult);
          saveCorepointerCache({
            currentVersion: pointer.currentVersion,
            updatedAt: pointer.updatedAt,
            payloadSha256: pointer.payloadSha256,
            lastChecked: Math.floor(Date.now() / 1000)
          });
          console.log('[coremanifest-updater] ✓ Update applied from on-chain');
          return {
            updated: true,
            currentVersion: pointer.currentVersion,
            newVersion: pointer.currentVersion,
            lastupdated: newLastupdated,
            source: 'onchain'
          };
        }
      } catch (err) {
        console.warn('[coremanifest-updater] On-chain download/verify failed:', err.message);
        // Fall through to DNS check
      }
    }

    // ---- Step 2: DNS pointer (secondary) ----
    const hostnames = resolveDnshostPointer(currentManifest);
    if (hostnames.length === 0) {
      console.log(`[coremanifest-updater] DNS: No dnshost_pointer configured`)
      return {
        updated: false,
        currentVersion: pointer?.currentVersion ?? null,
        newVersion: null,
        error: pointer ? null : 'On-chain query failed and no dnshost_pointer configured'
      };
    }

    loadDnsCorepointerCache(); // Optional; not used for decision

    console.log('[coremanifest-updater] Querying DNS pointer:', hostnames.join(', '));
    const dnsPointer = await queryDnsPointer(hostnames);
    if (!dnsPointer) {
      console.log(`[coremanifest-updater] DNS pointer not found`)
      return {
        updated: false,
        currentVersion: pointer?.currentVersion ?? null,
        newVersion: null
      };
    }

    const isDnsNewer =
      (dnsPointer.currentVersion > (currentVersionId ?? 0)) ||
      (dnsPointer.updatedat > (currentLastupdated ?? 0));

    if (!isDnsNewer) {
      console.log(`[coremanifest-updater] DNS coremanifest version same or less`)
      return {
        updated: false,
        currentVersion: pointer?.currentVersion ?? null,
        newVersion: null
      };
    }

    console.log('[coremanifest-updater] DNS indicates update (version: %s, updatedat: %s)', dnsPointer.currentVersion, dnsPointer.updatedat);
    try {
      const downloadedBytes = await downloadCoremanifestDat(dnsPointer, 30000);
      verifyOnChainSha256(downloadedBytes, dnsPointer.sha256);
      const verifyResult = await verifyCoreManifestDat(downloadedBytes);
      if (!verifyResult.valid) {
        throw new Error(verifyResult.error || 'verification failed');
      }
      const newManifest = verifyResult.manifest;
      const newLastupdated = manifestResolver.normalizeLastUpdated(newManifest.lastupdated);
      const now = Math.floor(Date.now() / 1000);
      if (newLastupdated > now) {
        throw new Error(`New manifest lastupdated is in the future: ${newLastupdated} > ${now}`);
      }
      if (currentLastupdated !== null && newLastupdated <= currentLastupdated) {
        console.log('[coremanifest-updater] New manifest from DNS not newer than current, skipping');
      } else {
        applyManifestBytes(downloadedBytes, verifyResult);
        saveDnsCorepointerCache({
          currentVersion: dnsPointer.currentVersion,
          updatedat: dnsPointer.updatedat,
          lastChecked: Math.floor(Date.now() / 1000)
        });
        console.log('[coremanifest-updater] ✓ Update applied from DNS');
        return {
          updated: true,
          currentVersion: dnsPointer.currentVersion,
          newVersion: dnsPointer.currentVersion,
          lastupdated: newLastupdated,
          source: 'dns'
        };
      }
    } catch (err) {
      console.warn('[coremanifest-updater] DNS download/verify failed:', err.message);
    }

    return {
      updated: false,
      currentVersion: pointer?.currentVersion ?? null,
      newVersion: null
    };
  } catch (err) {
    console.error('[coremanifest-updater] Update check failed:', err);
    return {
      updated: false,
      currentVersion: null,
      newVersion: null,
      error: err.message
    };
  }
}

module.exports = {
  checkForUpdates,
  loadCorepointerCache,
  saveCorepointerCache,
  loadDnsCorepointerCache,
  saveDnsCorepointerCache,
  getCorepointerCachePath,
  getDnsCorepointerCachePath
};
