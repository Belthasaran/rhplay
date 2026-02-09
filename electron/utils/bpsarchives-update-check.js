/**
 * bpsarchives-update-check.js
 *
 * Check if bpsarchives manifest is out of date compared to core manifest
 */

const manifestResolver = require('./manifest-resolver');
const AdmZip = require('adm-zip');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Check if bpsarchives manifest is out of date
 * Compares current bpsarchives lastupdated with core manifest's beta/bpsarchives.json entry
 * 
 * @returns {Object} { outOfDate: boolean, currentLastupdated: number|null, availableLastupdated: number|null, manifestPkgEntry: object|null }
 */
function checkBpsarchivesOutOfDate() {
  try {
    // Load current bpsarchives manifest
    const bpsManifest = manifestResolver.loadBpsarchivesManifest();
    if (!bpsManifest) {
      return {
        outOfDate: false,
        currentLastupdated: null,
        availableLastupdated: null,
        manifestPkgEntry: null,
        error: 'Failed to load bpsarchives manifest'
      };
    }
    
    const currentLastupdated = manifestResolver.normalizeLastUpdated(bpsManifest.lastupdated);
    if (currentLastupdated === null) {
      return {
        outOfDate: false,
        currentLastupdated: null,
        availableLastupdated: null,
        manifestPkgEntry: null,
        error: 'Current bpsarchives manifest missing lastupdated'
      };
    }
    
    // Load core manifest
    const coreManifest = manifestResolver.loadCoreManifest();
    if (!coreManifest) {
      return {
        outOfDate: false,
        currentLastupdated,
        availableLastupdated: null,
        manifestPkgEntry: null,
        error: 'Failed to load core manifest'
      };
    }
    
    // Check beta/bpsarchives.json entry
    const bpsEntry = coreManifest['beta/bpsarchives.json'];
    if (!bpsEntry || !bpsEntry.updated) {
      return {
        outOfDate: false,
        currentLastupdated,
        availableLastupdated: null,
        manifestPkgEntry: null,
        error: 'Core manifest missing beta/bpsarchives.json entry'
      };
    }
    
    const availableLastupdated = manifestResolver.normalizeLastUpdated(bpsEntry.updated);
    if (availableLastupdated === null) {
      return {
        outOfDate: false,
        currentLastupdated,
        availableLastupdated: null,
        manifestPkgEntry: null,
        error: 'Core manifest beta/bpsarchives.json missing updated field'
      };
    }
    
    // Check if available is newer
    const outOfDate = availableLastupdated > currentLastupdated;
    
    // Get MANIFEST_PKG entry for downloading
    const manifestPkgEntry = coreManifest['beta/MANIFEST_PKG'] || null;
    
    return {
      outOfDate,
      currentLastupdated,
      availableLastupdated,
      manifestPkgEntry,
      channel: 'beta'
    };
    
  } catch (err) {
    return {
      outOfDate: false,
      currentLastupdated: null,
      availableLastupdated: null,
      manifestPkgEntry: null,
      error: err.message
    };
  }
}

/**
 * Update bpsarchives manifest from MANIFEST_PKG ZIP
 * Downloads ZIP, extracts bpsarchives.json, validates, writes bpsarchives_latest.json
 * 
 * @param {Object} manifestPkgEntry - beta/MANIFEST_PKG entry from core manifest
 * @param {Function} progressCallback - Optional progress callback
 * @returns {Promise<Object>} { success: boolean, error?: string }
 */
async function updateBpsarchivesFromManifestPkg(manifestPkgEntry, progressCallback = null) {
  const catalogDownloadManager = require('./catalog-download-manager');
  const { app } = require('electron');
  
  try {
    if (!manifestPkgEntry) {
      throw new Error('manifestPkgEntry is required');
    }
    
    if (progressCallback) {
      progressCallback({ message: 'Downloading manifest package...' });
    }
    
    // Download MANIFEST_PKG ZIP
    const userDataDir = app.getPath('userData');
    const workingDir = path.join(userDataDir, 'CatalogTemp');
    fs.mkdirSync(workingDir, { recursive: true });
    
    const downloadTracker = catalogDownloadManager.createDownloadTracker();
    const downloadedPath = await catalogDownloadManager.ensureArtifact(
      manifestPkgEntry,
      workingDir,
      downloadTracker,
      userDataDir,
      30, // timeout
      null // stay in workingDir
    );
    
    // Verify SHA256
    if (progressCallback) {
      progressCallback({ message: 'Verifying download...' });
    }
    
    const fileData = fs.readFileSync(downloadedPath);
    const sha256 = crypto.createHash('sha256').update(fileData).digest('hex');
    const expectedSha256 = manifestPkgEntry.sha256;
    
    if (sha256 !== expectedSha256) {
      throw new Error(`SHA256 mismatch: expected ${expectedSha256}, got ${sha256}`);
    }
    
    // Extract ZIP
    if (progressCallback) {
      progressCallback({ message: 'Extracting manifest package...' });
    }
    
    const zip = new AdmZip(downloadedPath);
    const zipEntries = zip.getEntries();
    
    // Find bpsarchives.json in ZIP
    const bpsEntry = zipEntries.find(entry => entry.entryName === 'bpsarchives.json');
    if (!bpsEntry) {
      throw new Error('bpsarchives.json not found in manifest package');
    }
    
    // Extract and parse
    const bpsJsonText = bpsEntry.getData().toString('utf8');
    const bpsManifest = JSON.parse(bpsJsonText);
    
    // Validate
    const validation = manifestResolver.validateManifest(bpsManifest);
    if (!validation.valid) {
      throw new Error(`Invalid bpsarchives.json: ${validation.error}`);
    }
    
    const newLastupdated = validation.lastupdated;
    const now = Math.floor(Date.now() / 1000);
    if (newLastupdated > now) {
      throw new Error(`New manifest lastupdated is in the future: ${newLastupdated}`);
    }
    
    // Check monotonicity (should be newer than current)
    const currentBps = manifestResolver.loadBpsarchivesManifest();
    const currentLastupdated = currentBps ? manifestResolver.normalizeLastUpdated(currentBps.lastupdated) : null;
    
    if (currentLastupdated !== null && newLastupdated <= currentLastupdated) {
      throw new Error(`New manifest lastupdated (${newLastupdated}) not greater than current (${currentLastupdated})`);
    }
    
    // Write bpsarchives_latest.json
    if (progressCallback) {
      progressCallback({ message: 'Saving updated manifest...' });
    }
    
    const latestPath = path.join(userDataDir, 'bpsarchives_latest.json');
    const tempPath = `${latestPath}.tmp`;
    
    fs.writeFileSync(tempPath, JSON.stringify(bpsManifest, null, 2), 'utf8');
    fs.renameSync(tempPath, latestPath);
    
    if (progressCallback) {
      progressCallback({ message: 'Update complete!' });
    }
    
    return {
      success: true,
      lastupdated: newLastupdated
    };
    
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

module.exports = {
  checkBpsarchivesOutOfDate,
  updateBpsarchivesFromManifestPkg
};
