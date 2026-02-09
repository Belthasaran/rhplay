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
 * Check for updates and apply if available
 * 
 * @param {string} [contractAddress] - PointerRegistry contract address (if not provided, extracted from manifest)
 * @param {Object} options - Options
 * @param {boolean} options.forceCheck - Force check even if cache says up to date
 * @param {string} options.customRpcUrl - Custom RPC URL
 * @returns {Promise<Object>} Result: { updated: boolean, currentVersion: number, newVersion: number|null, error?: string }
 */
async function checkForUpdates(contractAddress = null, options = {}) {
  const { forceCheck = false, customRpcUrl = null } = options;
  
  try {
    // Load current core manifest
    const currentManifest = manifestResolver.loadCoreManifest();
    if (!currentManifest) {
      throw new Error('Failed to load current core manifest');
    }
    
    const currentLastupdated = manifestResolver.normalizeLastUpdated(currentManifest.lastupdated);
    
    // Get contract address from manifest if not provided
    const actualContractAddress = contractAddress || getContractAddressFromManifest(currentManifest);
    
    // Load cache
    const cache = loadCorepointerCache();
    
    // Query on-chain pointer
    console.log(`[coremanifest-updater] Querying on-chain pointer at ${actualContractAddress}...`);
    const pointer = await queryLatestWithUrls(actualContractAddress, customRpcUrl);
    
    console.log(`[coremanifest-updater] On-chain version: ${pointer.currentVersion}, updatedAt: ${pointer.updatedAt}`);
    
    // Check if update needed
    if (!forceCheck && cache && cache.currentVersion === pointer.currentVersion) {
      console.log('[coremanifest-updater] Already up to date (version matches cache)');
      return {
        updated: false,
        currentVersion: pointer.currentVersion,
        newVersion: null
      };
    }
    
    // Download coremanifest.dat
    console.log('[coremanifest-updater] Downloading coremanifest.dat...');
    const downloadedBytes = await downloadCoremanifestDat(pointer, 30000);
    
    // Verify on-chain SHA256
    console.log('[coremanifest-updater] Verifying on-chain SHA256...');
    verifyOnChainSha256(downloadedBytes, pointer.payloadSha256);
    console.log('[coremanifest-updater] ✓ On-chain SHA256 verified');
    
    // Verify .dat file (SHA512 + Ed25519 signature)
    console.log('[coremanifest-updater] Verifying .dat file integrity...');
    const verifyResult = await verifyCoreManifestDat(downloadedBytes);
    
    if (!verifyResult.valid) {
      throw new Error(`.dat file verification failed: ${verifyResult.error || 'unknown error'}`);
    }
    
    const newManifest = verifyResult.manifest;
    const newLastupdated = manifestResolver.normalizeLastUpdated(newManifest.lastupdated);
    
    // Verify lastupdated is not in future
    const now = Math.floor(Date.now() / 1000);
    if (newLastupdated > now) {
      throw new Error(`New manifest lastupdated is in the future: ${newLastupdated} > ${now}`);
    }
    
    // Verify monotonicity (new lastupdated must be greater than current)
    if (currentLastupdated !== null && newLastupdated <= currentLastupdated) {
      console.log(`[coremanifest-updater] New manifest lastupdated (${newLastupdated}) not greater than current (${currentLastupdated}), skipping`);
      return {
        updated: false,
        currentVersion: pointer.currentVersion,
        newVersion: null,
        reason: 'not_newer'
      };
    }
    
    // All checks passed - write files
    const userDataDir = manifestResolver.getUserDataDir();
    const datPath = path.join(userDataDir, 'coremanifest_latest.dat');
    const jsonPath = path.join(userDataDir, 'coremanifest_latest.json');
    
    // Write to temp files first, then rename (atomic)
    const tempDatPath = `${datPath}.tmp`;
    const tempJsonPath = `${jsonPath}.tmp`;
    
    fs.writeFileSync(tempDatPath, downloadedBytes);
    fs.writeFileSync(tempJsonPath, JSON.stringify(newManifest, null, 2), 'utf8');
    
    // Atomic rename
    fs.renameSync(tempDatPath, datPath);
    fs.renameSync(tempJsonPath, jsonPath);
    
    // Update cache
    saveCorepointerCache({
      currentVersion: pointer.currentVersion,
      updatedAt: pointer.updatedAt,
      payloadSha256: pointer.payloadSha256,
      lastChecked: Math.floor(Date.now() / 1000)
    });
    
    console.log('[coremanifest-updater] ✓ Update applied successfully');
    
    return {
      updated: true,
      currentVersion: pointer.currentVersion,
      newVersion: pointer.currentVersion,
      lastupdated: newLastupdated
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
  saveCorepointerCache
};
