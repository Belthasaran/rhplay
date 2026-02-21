/**
 * software-update-manager.js
 *
 * Core logic for software updates: checking, downloading, verifying, and launching new versions
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { checkForSoftwareUpdate } = require('./software-update-check');
const manifestResolver = require('./manifest-resolver');
const { verifyCoreManifestDat } = require('./verify-coremf-dat-internal');
const { ensureArtifact } = require('./catalog-download-manager');

// IPFS gateways (same as catalog-download-manager)
const IPFS_GATEWAYS = [
  'https://ipfs.4everland.io/ipfs/',
  'https://w3s.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://rhtools.4everland.link/ipfs/'
];

// ArWeave gateways
const ARWEAVE_GATEWAYS = [
  'https://arweave.net',
  'https://ar-io.net',
  'https://arweave.live'
];

/**
 * Calculate SHA256 hash of a file
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
 * Format Unix timestamp to readable date string
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
}

/**
 * Get IPFS gateways list
 */
function getIPFSGateways() {
  return IPFS_GATEWAYS;
}

/**
 * Get ArWeave gateways list
 */
function getArWeaveGateways() {
  return ARWEAVE_GATEWAYS;
}

/**
 * Build IPFS gateway URL
 */
function buildIPFSUrl(cid, gateway) {
  if (!cid || !gateway) return null;
  const base = gateway.endsWith('/') ? gateway.slice(0, -1) : gateway;
  return `${base}/${cid}`;
}

/**
 * Build ArWeave gateway URL
 */
function buildArWeaveUrl(txid, gateway) {
  if (!txid || !gateway) return null;
  const base = gateway.endsWith('/') ? gateway.slice(0, -1) : gateway;
  return `${base}/${txid}`;
}

/**
 * Get directory where update target should be placed (same dir as executable)
 * For AppImage: use APPIMAGE env var so we target the actual AppImage file on disk,
 * not the read-only mount point.
 * For Windows portable: electron-builder sets PORTABLE_EXECUTABLE_DIR to user's folder.
 */
function getExecutableDirectory() {
  if (process.platform === 'linux' && process.env.APPIMAGE) {
    return path.dirname(process.env.APPIMAGE);
  }
  if (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  return path.dirname(process.execPath);
}

/**
 * Get directories to search for local version (exec dir + common locations)
 */
function getLocalVersionSearchDirectories() {
  const dirs = [getExecutableDirectory()];
  const home = os.homedir();
  if (home) {
    dirs.push(home);
    dirs.push(path.join(home, 'Desktop'));
    dirs.push(path.join(home, 'Downloads'));
  }
  try {
    const { app } = require('electron');
    const desktop = app.getPath('desktop');
    const downloads = app.getPath('downloads');
    if (desktop && !dirs.includes(desktop)) dirs.push(desktop);
    if (downloads && !dirs.includes(downloads)) dirs.push(downloads);
  } catch (_) {
    // Electron not available (e.g. in test)
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    dirs.push(path.join(process.env.APPDATA, 'RHTools'));
  }
  return dirs;
}

/**
 * Check if new version file exists locally - searches executable dir and common locations
 */
function checkLocalVersionExists(entry) {
  if (!entry) return { exists: false, path: null, filename: null };
  
  const filename = entry.target_filename || entry.source_filename;
  if (!filename) return { exists: false, path: null, filename: null };
  
  const searchDirs = getLocalVersionSearchDirectories();
  for (const dir of searchDirs) {
    const localPath = path.join(dir, filename);
    if (fs.existsSync(localPath)) {
      return {
        exists: true,
        path: localPath,
        filename
      };
    }
  }
  
  return {
    exists: false,
    path: null,
    filename
  };
}

/**
 * Verify local file SHA256 matches expected hash
 */
function verifyLocalVersionSHA256(filePath, expectedSHA256) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { matches: false, error: 'File does not exist' };
  }
  
  if (!expectedSHA256) {
    return { matches: false, error: 'No expected SHA256 provided' };
  }
  
  const actualHash = sha256File(filePath);
  if (!actualHash) {
    return { matches: false, error: 'Failed to calculate SHA256' };
  }
  
  const matches = actualHash.toLowerCase() === expectedSHA256.toLowerCase();
  return {
    matches,
    actualHash,
    expectedHash: expectedSHA256,
    error: matches ? null : 'SHA256 mismatch'
  };
}

/**
 * Verify coremanifest.dat signature
 * Ensures we're using signed coremanifest.dat, not tampered JSON
 */
async function verifyCoreManifestSignature() {
  try {
    const userDataDir = manifestResolver.getUserDataDir();
    const datPath = path.join(userDataDir, 'coremanifest_latest.dat');
    
    if (!fs.existsSync(datPath)) {
      return {
        valid: false,
        error: 'coremanifest_latest.dat not found'
      };
    }
    
    const fileData = fs.readFileSync(datPath);
    const verifyResult = await verifyCoreManifestDat(fileData);
    
    return verifyResult;
  } catch (err) {
    return {
      valid: false,
      error: err.message
    };
  }
}

/**
 * Create download spec from manifest entry
 */
function createDownloadSpec(entry) {
  const filename = entry.target_filename || entry.source_filename;
  if (!filename) {
    throw new Error('Entry missing target_filename or source_filename');
  }
  
  const spec = {
    file_name: filename,
    sha256: entry.sha256,
    size: entry.size ? parseInt(entry.size, 10) : null,
    ipfs_cidv1: entry.ipfs_cidv1 || null,
    data_txid: entry.data_txid || null,
    ardrive_file_path: entry.ardrive_file_path || null,
    ardrive_file_id: entry.ardrive_file_id || null,
    ardrive_drive_id: entry.ardrive_drive_id || null,
    ardrive_folder_id: entry.ardrive_folder_id || null,
    priority: entry.priority || null
  };
  
  // Handle addr/baddr
  if (entry.addr) {
    spec.url = Array.isArray(entry.addr) ? entry.addr : [entry.addr];
  }
  if (entry.baddr) {
    spec.baddr = Array.isArray(entry.baddr) ? entry.baddr : [entry.baddr];
  }
  
  return spec;
}

/**
 * Download update with progress tracking
 */
async function downloadUpdate(entry, progressCallback) {
  if (!entry || !entry.sha256) {
    throw new Error('Invalid entry or missing SHA256');
  }
  
  // Verify coremanifest signature first
  const sigVerify = await verifyCoreManifestSignature();
  if (!sigVerify.valid) {
    throw new Error(`coremanifest.dat signature verification failed: ${sigVerify.error}`);
  }
  
  // Create download spec
  const spec = createDownloadSpec(entry);
  
  // Create temp directory for download
  const tempDir = path.join(manifestResolver.getUserSpecificTempBase(), 'rhtools-update');
  manifestResolver.ensureDirectory(tempDir);
  
  // Create download tracker for progress (similar to provisioner)
  const downloadTracker = {
    register: (s) => {
      if (progressCallback && s._progressMessage) {
        progressCallback({ 
          message: s._progressMessage, 
          filename: s.file_name || '',
          current: 0, 
          total: 0,
          percent: 0
        });
      }
    },
    start: (s, totalBytes) => {
      if (progressCallback) {
        const totalSize = formatBytes(totalBytes);
        progressCallback({ 
          message: `Starting download: ${s.file_name} (${totalSize})`, 
          filename: s.file_name || '',
          current: 0, 
          total: totalBytes,
          percent: 0
        });
      }
    },
    progress: (s, currentBytes, totalBytes) => {
      if (progressCallback) {
        const percent = totalBytes > 0 ? Math.floor((currentBytes / totalBytes) * 100) : 0;
        progressCallback({ 
          message: `Downloading ${s.file_name}: ${percent}%`, 
          filename: s.file_name || '',
          current: currentBytes, 
          total: totalBytes,
          percent: percent
        });
      }
    },
    complete: (s) => {
      if (progressCallback) {
        progressCallback({ 
          message: `Download completed: ${s.file_name}`, 
          filename: s.file_name || '',
          current: s.__downloadBytesTotal || 0, 
          total: s.__downloadBytesTotal || 0,
          percent: 100
        });
      }
    },
    skip: () => {}
  };
  
  // Helper function to format bytes
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
    const units = ['B', 'KB', 'MB', 'GB'];
    let idx = 0;
    let value = bytes;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx += 1;
    }
    return `${value.toFixed(idx === 0 ? 0 : 1)}${units[idx]}`;
  }
  
  const userDataDir = manifestResolver.getUserDataDir();
  const downloadedPath = await ensureArtifact(
    spec,
    tempDir,
    downloadTracker,
    userDataDir,
    20, // IPFS timeout
    tempDir // finalDestinationDir
  );
  
  // Verify SHA256 after download
  const hashVerify = verifyLocalVersionSHA256(downloadedPath, entry.sha256);
  if (!hashVerify.matches) {
    throw new Error(`Downloaded file SHA256 mismatch: ${hashVerify.error}`);
  }
  
  return downloadedPath;
}

/**
 * Move downloaded file to target location (same directory as running executable)
 * Uses rename when source and target are on same device; falls back to copy+delete
 * when EXDEV (cross-device) occurs (e.g. AppImage: temp vs actual AppImage path).
 */
function moveUpdateToTarget(downloadedPath, targetPath) {
  if (!fs.existsSync(downloadedPath)) {
    throw new Error('Downloaded file does not exist');
  }
  
  const targetDir = path.dirname(targetPath);
  manifestResolver.ensureDirectory(targetDir);
  
  // If target exists, remove it first
  if (fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }
  
  try {
    fs.renameSync(downloadedPath, targetPath);
  } catch (err) {
    if (err.code === 'EXDEV') {
      // Cross-device link: copy then delete (e.g. AppImage temp -> real AppImage dir)
      fs.copyFileSync(downloadedPath, targetPath);
      try {
        fs.unlinkSync(downloadedPath);
      } catch (unlinkErr) {
        console.warn('[software-update-manager] Could not remove temp file:', unlinkErr.message);
      }
    } else {
      throw err;
    }
  }
  
  // Ensure executable on Linux
  if (process.platform === 'linux') {
    try {
      fs.chmodSync(targetPath, 0o755);
    } catch (chmodErr) {
      console.warn('[software-update-manager] Could not set executable bit:', chmodErr.message);
    }
  }
  
  const stats = fs.statSync(targetPath);
  if (!stats.isFile()) {
    throw new Error('Target path is not a file after move');
  }
  
  return targetPath;
}

/**
 * Launch new version executable and exit current process
 */
function launchNewVersion(newExecutablePath) {
  if (!fs.existsSync(newExecutablePath)) {
    throw new Error(`New executable not found: ${newExecutablePath}`);
  }
  
  // Make executable on Linux
  if (process.platform === 'linux') {
    try {
      fs.chmodSync(newExecutablePath, 0o755);
    } catch (err) {
      console.warn('[software-update-manager] Failed to set executable permissions:', err.message);
    }
  }
  
  // Get command-line arguments (skip node/electron and script path)
  const args = process.argv.slice(2);
  
  // Spawn new process
  const options = {
    detached: true,
    stdio: 'ignore'
  };
  
  const child = spawn(newExecutablePath, args, options);
  child.unref();
  
  console.log(`[software-update-manager] Launched new version: ${newExecutablePath}`);
  
  // Exit current process
  const { app } = require('electron');
  app.quit();
}

/**
 * Perform complete update flow
 */
async function performUpdate(entry, progressCallback) {
  if (!entry || !entry.sha256) {
    throw new Error('Invalid entry or missing SHA256');
  }
  
  // Step 1: Verify coremanifest.dat signature
  if (progressCallback) {
    progressCallback({ message: 'Verifying coremanifest signature...', filename: '', current: 0, total: 0, percent: 0 });
  }
  const sigVerify = await verifyCoreManifestSignature();
  if (!sigVerify.valid) {
    throw new Error(`coremanifest.dat signature verification failed: ${sigVerify.error}`);
  }
  
  // Step 2: Re-verify coremanifest.dat matches JSON
  if (progressCallback) {
    progressCallback({ message: 'Verifying manifest integrity...', filename: '', current: 0, total: 0, percent: 0 });
  }
  const manifest = manifestResolver.loadCoreManifest();
  if (!manifest) {
    throw new Error('Failed to load core manifest');
  }
  
  // Verify entry SHA256 matches what we expect
  const expectedSHA256 = entry.sha256;
  if (!expectedSHA256) {
    throw new Error('Entry missing SHA256');
  }
  
  // Step 3: Download update
  if (progressCallback) {
    progressCallback({ message: 'Starting download...', filename: entry.source_filename || entry.target_filename || '', current: 0, total: 0, percent: 0 });
  }
  const downloadedPath = await downloadUpdate(entry, progressCallback);
  
  // Step 4: Move to target location
  const execDir = getExecutableDirectory();
  const filename = entry.target_filename || entry.source_filename;
  const targetPath = path.join(execDir, filename);
  
  if (progressCallback) {
    progressCallback({ message: 'Moving update to target location...', filename: filename, current: 0, total: 0, percent: 0 });
  }
  const movedPath = moveUpdateToTarget(downloadedPath, targetPath);
  
  // Step 5: Final verification
  if (progressCallback) {
    progressCallback({ message: 'Performing final verification...', filename: filename, current: 0, total: 0, percent: 0 });
  }
  
  // Re-read coremanifest.dat
  const sigVerify2 = await verifyCoreManifestSignature();
  if (!sigVerify2.valid) {
    throw new Error(`Final coremanifest.dat signature verification failed: ${sigVerify2.error}`);
  }
  
  // Re-extract JSON and verify entry
  const manifest2 = manifestResolver.loadCoreManifest();
  if (!manifest2) {
    throw new Error('Failed to reload core manifest for final verification');
  }
  
  // Re-verify SHA256 of moved file
  const finalHashVerify = verifyLocalVersionSHA256(movedPath, expectedSHA256);
  if (!finalHashVerify.matches) {
    throw new Error(`Final SHA256 verification failed: ${finalHashVerify.error}`);
  }
  
  if (progressCallback) {
    progressCallback({ message: 'Update verified successfully', filename: filename, current: 0, total: 0, percent: 100 });
  }
  
  return {
    success: true,
    newExecutablePath: movedPath
  };
}

module.exports = {
  checkForUpdate: checkForSoftwareUpdate,
  checkLocalVersionExists,
  verifyLocalVersionSHA256,
  verifyCoreManifestSignature,
  downloadUpdate,
  moveUpdateToTarget,
  launchNewVersion,
  performUpdate,
  formatTimestamp,
  getIPFSGateways,
  getArWeaveGateways,
  buildIPFSUrl,
  buildArWeaveUrl
};
