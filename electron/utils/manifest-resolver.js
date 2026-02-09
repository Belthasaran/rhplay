#!/usr/bin/env node

/**
 * manifest-resolver.js
 *
 * Utilities for resolving manifest files (_latest.json in userData vs bundled manifests)
 * Handles validation, bootstrap, and resolution order
 */

const fs = require('fs');
const path = require('path');

/**
 * Normalize lastupdated value to integer
 * Accepts string or number in JSON
 */
function normalizeLastUpdated(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value.trim(), 10);
    if (isNaN(parsed)) {
      return null;
    }
    return parsed;
  }
  return null;
}

/**
 * Validate manifest: check lastupdated exists and is not in the future
 * Returns { valid: boolean, lastupdated: number|null, error?: string }
 */
function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, lastupdated: null, error: 'Manifest is not an object' };
  }

  const lastupdated = normalizeLastUpdated(manifest.lastupdated);
  if (lastupdated === null) {
    return { valid: false, lastupdated: null, error: 'lastupdated missing or invalid' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (lastupdated > now) {
    return { valid: false, lastupdated, error: `lastupdated is in the future: ${lastupdated} > ${now}` };
  }

  return { valid: true, lastupdated };
}

/**
 * Resolve resource path (similar to prepare_databases.js)
 * Works in both dev mode and packaged app
 */
function resolveResourcePath(input) {
  if (!input) {
    return null;
  }
  const candidates = [];
  if (path.isAbsolute(input)) {
    candidates.push(input);
  } else {
    if (process.resourcesPath) {
      // Packaged app
      candidates.push(path.join(process.resourcesPath, input));
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', input));
      candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', input));
      candidates.push(path.join(process.resourcesPath, 'app.asar', input));
      candidates.push(path.join(process.resourcesPath, 'app.asar', 'electron', input));
    }
    // Development mode
    candidates.push(path.join(__dirname, input));
    candidates.push(path.join(__dirname, '..', input));
    candidates.push(path.join(__dirname, '..', 'electron', input));
    candidates.push(path.join(process.cwd(), input));
  }
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

/**
 * Get user data directory
 */
function getUserDataDir() {
  try {
    const { app } = require('electron');
    return app.getPath('userData');
  } catch (err) {
    // If electron is not available (e.g., in Node.js script), use default
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
 * Ensure directory exists
 */
function ensureDirectory(dirPath) {
  if (!dirPath) {
    return;
  }
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (err) {
    console.error('[manifest-resolver] Failed to ensure directory:', dirPath, err);
  }
}

/**
 * Load and validate a manifest file
 * Returns { path: string|null, manifest: object|null, lastupdated: number|null, valid: boolean }
 */
function loadManifestFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { path: null, manifest: null, lastupdated: null, valid: false };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const manifest = JSON.parse(raw);
    const validation = validateManifest(manifest);
    return {
      path: filePath,
      manifest,
      lastupdated: validation.lastupdated,
      valid: validation.valid,
      error: validation.error
    };
  } catch (err) {
    console.error(`[manifest-resolver] Failed to load/parse ${filePath}:`, err.message);
    return { path: filePath, manifest: null, lastupdated: null, valid: false, error: err.message };
  }
}

/**
 * Get bundled coremanifest.json path
 */
function getBundledCoreManifestPath() {
  const candidates = [
    'electron/coremanifest.json',
    'coremanifest.json'
  ];
  for (const candidate of candidates) {
    const resolved = resolveResourcePath(candidate);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

/**
 * Get bundled bpsarchives.json path
 */
function getBundledBpsarchivesManifestPath() {
  const candidates = [
    'electron/bpsarchives.json',
    'bpsarchives.json',
    'db/bpsarchives.json'
  ];
  for (const candidate of candidates) {
    const resolved = resolveResourcePath(candidate);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

/**
 * Get bundled dbmanifest.json path
 */
function getBundledDbmanifestPath() {
  const candidates = [
    'electron/dbmanifest.json',
    'dbmanifest.json',
    'db/dbmanifest.json'
  ];
  for (const candidate of candidates) {
    const resolved = resolveResourcePath(candidate);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

/**
 * Get core manifest path (userData/coremanifest_latest.json or bundled)
 * Returns { path: string, source: 'userData'|'bundled', manifest: object|null, lastupdated: number|null }
 */
function getCoreManifestPath() {
  const userDataDir = getUserDataDir();
  const latestPath = path.join(userDataDir, 'coremanifest_latest.json');
  
  // Try userData _latest first
  const latest = loadManifestFile(latestPath);
  if (latest.valid) {
    return {
      path: latestPath,
      source: 'userData',
      manifest: latest.manifest,
      lastupdated: latest.lastupdated
    };
  }

  // Fall back to bundled
  const bundledPath = getBundledCoreManifestPath();
  if (!bundledPath) {
    throw new Error('coremanifest.json not found in bundled locations');
  }
  const bundled = loadManifestFile(bundledPath);
  return {
    path: bundledPath,
    source: 'bundled',
    manifest: bundled.manifest,
    lastupdated: bundled.lastupdated
  };
}

/**
 * Load core manifest (resolved path)
 */
function loadCoreManifest() {
  const resolved = getCoreManifestPath();
  return resolved.manifest;
}

/**
 * Get bpsarchives manifest path (userData/bpsarchives_latest.json or bundled)
 */
function getBpsarchivesManifestPath() {
  const userDataDir = getUserDataDir();
  const latestPath = path.join(userDataDir, 'bpsarchives_latest.json');
  
  // Try userData _latest first
  const latest = loadManifestFile(latestPath);
  if (latest.valid) {
    return {
      path: latestPath,
      source: 'userData',
      manifest: latest.manifest,
      lastupdated: latest.lastupdated
    };
  }

  // Fall back to bundled
  const bundledPath = getBundledBpsarchivesManifestPath();
  if (!bundledPath) {
    return null;
  }
  const bundled = loadManifestFile(bundledPath);
  return {
    path: bundledPath,
    source: 'bundled',
    manifest: bundled.manifest,
    lastupdated: bundled.lastupdated
  };
}

/**
 * Load bpsarchives manifest (resolved path)
 */
function loadBpsarchivesManifest() {
  const resolved = getBpsarchivesManifestPath();
  return resolved ? resolved.manifest : null;
}

/**
 * Get dbmanifest path (userData/dbmanifest_latest.json or bundled)
 * Future: will use _latest when implemented
 */
function getDbmanifestPath() {
  // For now, only use bundled
  // TODO: Add userData/dbmanifest_latest.json support
  const bundledPath = getBundledDbmanifestPath();
  if (!bundledPath) {
    throw new Error('dbmanifest.json not found in bundled locations');
  }
  const bundled = loadManifestFile(bundledPath);
  return {
    path: bundledPath,
    source: 'bundled',
    manifest: bundled.manifest,
    lastupdated: bundled.lastupdated
  };
}

/**
 * Bootstrap: ensure _latest files exist and are up to date
 * Copies bundled to _latest if missing or if bundled is newer
 */
function bootstrapManifests() {
  const userDataDir = getUserDataDir();
  ensureDirectory(userDataDir);

  // Bootstrap coremanifest_latest.json
  const bundledCorePath = getBundledCoreManifestPath();
  if (bundledCorePath) {
    const bundledCore = loadManifestFile(bundledCorePath);
    if (bundledCore.valid && bundledCore.manifest) {
      const latestCorePath = path.join(userDataDir, 'coremanifest_latest.json');
      const latestCore = loadManifestFile(latestCorePath);
      
      const shouldCopy = !latestCore.valid || 
                        (bundledCore.lastupdated !== null && 
                         latestCore.lastupdated !== null && 
                         bundledCore.lastupdated > latestCore.lastupdated);
      
      if (shouldCopy) {
        try {
          fs.writeFileSync(latestCorePath, JSON.stringify(bundledCore.manifest, null, 2), 'utf8');
          console.log('[manifest-resolver] Bootstrapped coremanifest_latest.json from bundled');
        } catch (err) {
          console.error('[manifest-resolver] Failed to bootstrap coremanifest_latest.json:', err.message);
        }
      }
    }
  }

  // Bootstrap bpsarchives_latest.json
  const bundledBpsPath = getBundledBpsarchivesManifestPath();
  if (bundledBpsPath) {
    const bundledBps = loadManifestFile(bundledBpsPath);
    if (bundledBps.valid && bundledBps.manifest) {
      const latestBpsPath = path.join(userDataDir, 'bpsarchives_latest.json');
      const latestBps = loadManifestFile(latestBpsPath);
      
      const shouldCopy = !latestBps.valid || 
                        (bundledBps.lastupdated !== null && 
                         latestBps.lastupdated !== null && 
                         bundledBps.lastupdated > latestBps.lastupdated);
      
      if (shouldCopy) {
        try {
          fs.writeFileSync(latestBpsPath, JSON.stringify(bundledBps.manifest, null, 2), 'utf8');
          console.log('[manifest-resolver] Bootstrapped bpsarchives_latest.json from bundled');
        } catch (err) {
          console.error('[manifest-resolver] Failed to bootstrap bpsarchives_latest.json:', err.message);
        }
      }
    }
  }

  // TODO: Bootstrap dbmanifest_latest.json when ready
}

module.exports = {
  normalizeLastUpdated,
  validateManifest,
  getUserDataDir,
  ensureDirectory,
  getCoreManifestPath,
  loadCoreManifest,
  getBpsarchivesManifestPath,
  loadBpsarchivesManifest,
  getDbmanifestPath,
  bootstrapManifests,
  getBundledCoreManifestPath,
  getBundledBpsarchivesManifestPath,
  getBundledDbmanifestPath
};
