/**
 * database-update-check.js
 *
 * Check if database updates are available by comparing provisioned.json
 * with dbmanifest.json version numbers.
 */

const fs = require('fs');
const path = require('path');
const manifestResolver = require('./manifest-resolver');

// Database targets that can be updated (exclude clientdata.db - user data)
const UPDATEABLE_DATABASES = ['rhdata.db', 'patchbin.db', 'resource.db', 'screenshot.db'];

/**
 * Simple version comparison
 * Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
  if (!v1 && !v2) return 0;
  if (!v1) return -1;
  if (!v2) return 1;

  const s1 = String(v1).trim();
  const s2 = String(v2).trim();

  // Try numeric comparison first
  const n1 = parseFloat(s1);
  const n2 = parseFloat(s2);
  if (!isNaN(n1) && !isNaN(n2)) {
    if (n1 < n2) return -1;
    if (n1 > n2) return 1;
    return 0;
  }

  // Fallback to string
  if (s1 < s2) return -1;
  if (s1 > s2) return 1;
  return 0;
}

/**
 * Load provisioned.json from userDataDir
 */
function loadProvisionedJson(userDataDir) {
  const filePath = path.join(userDataDir, 'provisioned.json');
  if (!fs.existsSync(filePath)) {
    return { targets: {}, hashdata: { sha256: null } };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[database-update-check] Failed to load provisioned.json: ${err.message}`);
    return { targets: {}, hashdata: { sha256: null } };
  }
}

/**
 * Check if database can be patched (vs must re-provision)
 * Find patch with version_before === provisionedVersion; return true if found
 */
function canPatchDatabase(provisionedVersion, sqlpatches) {
  if (!sqlpatches || !Array.isArray(sqlpatches)) {
    return false;
  }

  const currentStr = provisionedVersion != null ? String(provisionedVersion).trim() : null;
  if (!currentStr) {
    return false;
  }

  for (const patch of sqlpatches) {
    const vb = patch.version_before;
    if (vb != null && String(vb).trim() === currentStr) {
      return true;
    }
  }

  return false;
}

/**
 * Get patches to apply for in-place update (from version_before match through end)
 */
function getPatchesToApply(provisionedVersion, sqlpatches) {
  if (!sqlpatches || !Array.isArray(sqlpatches)) {
    return [];
  }

  const currentStr = provisionedVersion != null ? String(provisionedVersion).trim() : null;
  if (!currentStr) {
    return [];
  }

  let found = false;
  const result = [];
  for (const patch of sqlpatches) {
    const vb = patch.version_before;
    if (vb != null && String(vb).trim() === currentStr) {
      found = true;
    }
    if (found) {
      result.push(patch);
    }
  }

  return result;
}

/**
 * Check for database updates
 * Compares dbmanifest.json versions with provisioned.json
 *
 * @returns {Object} { updatesAvailable: boolean, updates: [{ dbName, currentVersion, targetVersion, canPatch, patchesToApply }] }
 */
function checkForDatabaseUpdates() {
  try {
    const userDataDir = manifestResolver.getUserDataDir();
    const provisioned = loadProvisionedJson(userDataDir);

    let dbmanifest;
    try {
      dbmanifest = manifestResolver.loadDbmanifest();
    } catch (err) {
      console.warn('[database-update-check] Failed to load dbmanifest:', err.message);
      return { updatesAvailable: false, updates: [] };
    }

    if (!dbmanifest) {
      return { updatesAvailable: false, updates: [] };
    }

    const updates = [];

    for (const dbName of UPDATEABLE_DATABASES) {
      const manifestEntry = dbmanifest[dbName];
      if (!manifestEntry) {
        continue;
      }

      const targetVersion = manifestEntry.version || '0';
      const provisionedEntry = provisioned.targets && provisioned.targets[dbName];
      const currentVersion = provisionedEntry ? (provisionedEntry.version || '0') : '0';

      if (compareVersions(currentVersion, targetVersion) >= 0) {
        continue;
      }

      const sqlpatches = Array.isArray(manifestEntry.sqlpatches) ? manifestEntry.sqlpatches : [];
      const canPatch = canPatchDatabase(currentVersion, sqlpatches);
      const patchesToApply = canPatch ? getPatchesToApply(currentVersion, sqlpatches) : [];

      updates.push({
        dbName,
        currentVersion,
        targetVersion,
        canPatch,
        patchesToApply,
        manifestEntry
      });
    }

    return {
      updatesAvailable: updates.length > 0,
      updates
    };
  } catch (err) {
    console.error('[database-update-check] Error:', err);
    return { updatesAvailable: false, updates: [], error: err.message };
  }
}

/**
 * Per-database row for UI: current vs manifest target and coarse status.
 * @returns {{ rows: Array<{dbName, currentVersion, targetVersion, status}>, updatesAvailable: boolean, error?: string }}
 */
function getDatabaseProvisionStatus() {
  try {
    const userDataDir = manifestResolver.getUserDataDir();
    const provisioned = loadProvisionedJson(userDataDir);
    let dbmanifest;
    try {
      dbmanifest = manifestResolver.loadDbmanifest();
    } catch (err) {
      return {
        rows: [],
        updatesAvailable: false,
        error: err.message || String(err)
      };
    }
    if (!dbmanifest) {
      return { rows: [], updatesAvailable: false, error: 'No dbmanifest loaded' };
    }

    const rows = [];
    let updatesAvailable = false;

    for (const dbName of UPDATEABLE_DATABASES) {
      const manifestEntry = dbmanifest[dbName];
      if (!manifestEntry) {
        rows.push({
          dbName,
          currentVersion: '—',
          targetVersion: '—',
          status: 'unknown'
        });
        continue;
      }

      const targetVersion = String(manifestEntry.version != null ? manifestEntry.version : '0').trim();
      const provisionedEntry = provisioned.targets && provisioned.targets[dbName];
      const currentVersion = provisionedEntry
        ? String(provisionedEntry.version != null ? provisionedEntry.version : '0').trim()
        : '0';

      let status;
      if (!provisionedEntry) {
        status = 'not-provisioned';
        updatesAvailable = true;
      } else if (compareVersions(currentVersion, targetVersion) >= 0) {
        status = 'up-to-date';
      } else {
        status = 'update-available';
        updatesAvailable = true;
      }

      rows.push({
        dbName,
        currentVersion,
        targetVersion,
        status
      });
    }

    return { rows, updatesAvailable };
  } catch (err) {
    return {
      rows: [],
      updatesAvailable: false,
      error: err.message || String(err)
    };
  }
}

module.exports = {
  checkForDatabaseUpdates,
  getDatabaseProvisionStatus,
  canPatchDatabase,
  getPatchesToApply,
  loadProvisionedJson,
  UPDATEABLE_DATABASES,
  compareVersions
};
