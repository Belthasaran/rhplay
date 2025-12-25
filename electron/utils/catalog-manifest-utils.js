#!/usr/bin/env node

/**
 * catalog-manifest-utils.js
 *
 * Utilities for locating and managing bpsarchives.json manifest and searchdat.json tracking
 * Works in both development mode and portable executable builds
 */

const fs = require('fs');
const path = require('path');

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
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * Locate bpsarchives.json manifest
 * Searches in multiple locations (dev mode and packaged app)
 */
function locateBpsArchivesManifest() {
  const candidates = [
    path.resolve(__dirname, '..', 'electron', 'bpsarchives.json'),
    path.resolve(__dirname, '..', 'bpsarchives.json'),
    path.resolve(__dirname, '..', 'db', 'bpsarchives.json'),
  ];
  
  if (process.resourcesPath) {
    // Packaged app
    candidates.push(path.join(process.resourcesPath, 'db', 'bpsarchives.json'));
    candidates.push(path.join(process.resourcesPath, 'electron', 'bpsarchives.json'));
  }
  
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * Load bpsarchives.json manifest
 */
function loadBpsArchivesManifest() {
  const manifestPath = locateBpsArchivesManifest();
  if (!manifestPath) {
    return null;
  }
  
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[catalog-manifest] Failed to parse bpsarchives.json: ${err.message}`);
    return null;
  }
}

/**
 * Get user data directory (where searchdat.json should be stored)
 */
function getUserDataDir() {
  try {
    const { app } = require('electron');
    return app.getPath('userData');
  } catch (err) {
    // If electron is not available (e.g., in Node.js script), use default
    const os = require('os');
    const path = require('path');
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
 * Get searchdat.json path
 */
function getSearchDatPath() {
  return path.join(getUserDataDir(), 'searchdat.json');
}

/**
 * Load searchdat.json tracking file
 */
function loadSearchDat() {
  const searchDatPath = getSearchDatPath();
  if (!fs.existsSync(searchDatPath)) {
    return {
      catalog: {
        base_version: null,
        base_sha256: null,
        base_installed_at: null,
        additional: []
      },
      catalogdb: {
        base_version: null,
        base_sha256: null,
        base_installed_at: null
      },
      bpsarchives: {}
    };
  }
  
  try {
    const raw = fs.readFileSync(searchDatPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[catalog-manifest] Failed to parse searchdat.json: ${err.message}`);
    return {
      catalog: {
        base_version: null,
        base_sha256: null,
        base_installed_at: null,
        additional: []
      },
      catalogdb: {
        base_version: null,
        base_sha256: null,
        base_installed_at: null
      },
      bpsarchives: {}
    };
  }
}

/**
 * Save searchdat.json tracking file
 */
function saveSearchDat(searchDat) {
  const searchDatPath = getSearchDatPath();
  const dir = path.dirname(searchDatPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(searchDatPath, JSON.stringify(searchDat, null, 2), 'utf8');
}

/**
 * Update searchdat.json with installed catalog information
 */
function updateSearchDatCatalog(type, version, sha256, filePath) {
  const searchDat = loadSearchDat();
  
  if (type === 'catalog') {
    if (!searchDat.catalog) {
      searchDat.catalog = {
        base_version: null,
        base_sha256: null,
        base_installed_at: null,
        additional: []
      };
    }
    searchDat.catalog.base_version = version;
    searchDat.catalog.base_sha256 = sha256;
    searchDat.catalog.base_installed_at = new Date().toISOString();
    searchDat.catalog.base_path = filePath;
  } else if (type === 'catalogdb') {
    if (!searchDat.catalogdb) {
      searchDat.catalogdb = {
        base_version: null,
        base_sha256: null,
        base_installed_at: null
      };
    }
    searchDat.catalogdb.base_version = version;
    searchDat.catalogdb.base_sha256 = sha256;
    searchDat.catalogdb.base_installed_at = new Date().toISOString();
    searchDat.catalogdb.base_path = filePath;
  } else if (type === 'catalog-additional') {
    if (!searchDat.catalog) {
      searchDat.catalog = {
        base_version: null,
        base_sha256: null,
        base_installed_at: null,
        additional: []
      };
    }
    if (!searchDat.catalog.additional) {
      searchDat.catalog.additional = [];
    }
    // Check if this additional file is already tracked
    const existingIndex = searchDat.catalog.additional.findIndex(
      (item) => item.file_name === filePath || item.sha256 === sha256
    );
    const additionalEntry = {
      file_name: path.basename(filePath),
      sha256: sha256,
      version: version,
      installed_at: new Date().toISOString(),
      path: filePath
    };
    if (existingIndex >= 0) {
      searchDat.catalog.additional[existingIndex] = additionalEntry;
    } else {
      searchDat.catalog.additional.push(additionalEntry);
    }
  }
  
  saveSearchDat(searchDat);
}

/**
 * Check if catalog update is available
 * Compares manifest with searchdat.json to find missing updates
 */
function checkCatalogUpdates() {
  const manifest = loadBpsArchivesManifest();
  if (!manifest) {
    return { available: false, updates: [] };
  }
  
  const searchDat = loadSearchDat();
  const updates = [];
  
  // Check catalog base
  if (manifest['rhsearch.zip']) {
    const entry = manifest['rhsearch.zip'];
    if (entry.base) {
      const installed = searchDat.catalog;
      const manifestVersion = entry.base.searchdb_version || entry.version || '1';
      const manifestSha256 = entry.base.sha256;
      
      // Check if file is missing or version is higher
      const versionCompare = compareVersions(manifestVersion, installed.base_version || '0');
      const isMissing = !installed.base_version || !installed.base_sha256;
      const isNewer = versionCompare > 0;
      const isDifferent = installed.base_sha256 !== manifestSha256;
      
      if (isMissing || isNewer || isDifferent) {
        updates.push({
          type: 'catalog-base',
          name: 'rhsearch.zip',
          currentVersion: installed.base_version,
          currentSha256: installed.base_sha256,
          availableVersion: manifestVersion,
          availableSha256: manifestSha256,
          entry: entry.base,
          isMissing: isMissing,
          isNewer: isNewer
        });
      }
      
      // Check additional catalog files
      if (entry.additional && Array.isArray(entry.additional)) {
        for (const addEntry of entry.additional) {
          const addSha256 = addEntry.sha256;
          const isInstalled = searchDat.catalog.additional && 
            searchDat.catalog.additional.some(item => item.sha256 === addSha256);
          
          if (!isInstalled) {
            updates.push({
              type: 'catalog-additional',
              name: addEntry.file_name,
              availableSha256: addSha256,
              entry: addEntry
            });
          }
        }
      }
    }
  }
  
  // Check catalogdb base
  if (manifest['rhsearch_cat.db']) {
    const entry = manifest['rhsearch_cat.db'];
    if (entry.base) {
      const installed = searchDat.catalogdb;
      const manifestVersion = entry.base.searchdb_version || entry.version || '1';
      const manifestSha256 = entry.base.sha256;
      
      // Check if file is missing or version is higher
      const versionCompare = compareVersions(manifestVersion, installed.base_version || '0');
      const isMissing = !installed.base_version || !installed.base_sha256;
      const isNewer = versionCompare > 0;
      const isDifferent = installed.base_sha256 !== manifestSha256;
      
      if (isMissing || isNewer || isDifferent) {
        updates.push({
          type: 'catalogdb-base',
          name: 'rhsearch_cat.db',
          currentVersion: installed.base_version,
          currentSha256: installed.base_sha256,
          availableVersion: manifestVersion,
          availableSha256: manifestSha256,
          entry: entry.base,
          isMissing: isMissing,
          isNewer: isNewer
        });
      }
    }
  }
  
  return {
    available: updates.length > 0,
    updates: updates
  };
}

/**
 * Compare version strings (simple numeric comparison)
 * Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
  if (!v1 && !v2) return 0;
  if (!v1) return -1;
  if (!v2) return 1;
  
  // Try to parse as numbers
  const n1 = parseFloat(v1);
  const n2 = parseFloat(v2);
  
  if (!isNaN(n1) && !isNaN(n2)) {
    if (n1 < n2) return -1;
    if (n1 > n2) return 1;
    return 0;
  }
  
  // Fallback to string comparison
  if (v1 < v2) return -1;
  if (v1 > v2) return 1;
  return 0;
}

module.exports = {
  locateBpsArchivesManifest,
  loadBpsArchivesManifest,
  getUserDataDir,
  getSearchDatPath,
  loadSearchDat,
  saveSearchDat,
  updateSearchDatCatalog,
  checkCatalogUpdates,
  resolveResourcePath,
  compareVersions
};
