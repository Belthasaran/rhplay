/**
 * software-update-check.js
 *
 * Check for software updates by comparing version in core manifest with current app version
 */

const manifestResolver = require('./manifest-resolver');
const path = require('path');

/**
 * Get current app version from package.json
 */
function getCurrentAppVersion() {
  try {
    const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
    const packageJson = require(packageJsonPath);
    return packageJson.version || null;
  } catch (err) {
    console.warn('[software-update-check] Failed to read package.json:', err.message);
    return null;
  }
}

/**
 * Determine current channel (default: beta)
 */
function getCurrentChannel() {
  // For now, always beta. Could be read from config or build flags later
  return 'beta';
}

/**
 * Determine current platform and format
 */
function getCurrentPlatform() {
  const platform = process.platform;
  const arch = process.arch;
  
  // Check if running as AppImage
  const isAppImage = process.env.APPIMAGE !== undefined;
  
  if (platform === 'win32' && arch === 'x64') {
    // Check if portable (no installer)
    const execPath = process.execPath;
    const isPortable = execPath.toLowerCase().includes('portable') || 
                      !execPath.toLowerCase().includes('program files');
    return { platform: 'win64', format: 'portable' };
  }
  
  if (platform === 'linux' && arch === 'x64') {
    if (isAppImage) {
      return { platform: 'linux64', format: 'AppImage' };
    }
    // Could be other formats later
    return { platform: 'linux64', format: 'AppImage' };
  }
  
  // Default/unknown
  return { platform: null, format: null };
}

/**
 * Compare version strings
 * Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
  if (!v1 && !v2) return 0;
  if (!v1) return -1;
  if (!v2) return 1;
  
  // Try to parse as semantic version or numeric
  const parts1 = v1.split(/[.-]/).map(p => parseInt(p, 10) || 0);
  const parts2 = v2.split(/[.-]/).map(p => parseInt(p, 10) || 0);
  
  const maxLen = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLen; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  
  return 0;
}

/**
 * Find manifest entry for current channel/platform
 */
function findManifestEntry(manifest, channel, platform, format) {
  // Build key: channel/RHPLAY/platform/format (case-insensitive)
  const key = `${channel}/RHPLAY/${platform}/${format}`;
  
  // Search case-insensitively
  const normalizedKey = key.toLowerCase();
  for (const manifestKey of Object.keys(manifest)) {
    if (manifestKey.toLowerCase() === normalizedKey) {
      return { key: manifestKey, entry: manifest[manifestKey] };
    }
  }
  
  return null;
}

/**
 * Find manifest entry for an arbitrary app id (e.g. RHPLAY, RHToolsLauncher).
 */
function findManifestEntryForApp(manifest, channel, appId, platform, format) {
  const key = `${channel}/${appId}/${platform}/${format}`;
  const normalizedKey = key.toLowerCase();
  for (const manifestKey of Object.keys(manifest)) {
    if (manifestKey.toLowerCase() === normalizedKey) {
      return { key: manifestKey, entry: manifest[manifestKey] };
    }
  }
  return null;
}

/**
 * Check for software updates
 * 
 * @returns {Object} { updateAvailable: boolean, currentVersion: string, availableVersion: string|null, entry: object|null, error?: string }
 */
function checkForSoftwareUpdate() {
  try {
    // Load active core manifest
    const manifest = manifestResolver.loadCoreManifest();
    if (!manifest) {
      return {
        updateAvailable: false,
        currentVersion: null,
        availableVersion: null,
        entry: null,
        error: 'Failed to load core manifest'
      };
    }
    
    // Get current app version
    const currentVersion = getCurrentAppVersion();
    if (!currentVersion) {
      return {
        updateAvailable: false,
        currentVersion: null,
        availableVersion: null,
        entry: null,
        error: 'Failed to determine current app version'
      };
    }
    
    // Get channel and platform
    const channel = getCurrentChannel();
    const { platform, format } = getCurrentPlatform();
    
    if (!platform || !format) {
      return {
        updateAvailable: false,
        currentVersion,
        availableVersion: null,
        entry: null,
        error: `Unsupported platform: ${process.platform}/${process.arch}`
      };
    }
    
    // Find manifest entry
    const entryInfo = findManifestEntry(manifest, channel, platform, format);
    if (!entryInfo) {
      return {
        updateAvailable: false,
        currentVersion,
        availableVersion: null,
        entry: null,
        error: `No manifest entry found for ${channel}/RHPLAY/${platform}/${format}`
      };
    }
    
    const { entry } = entryInfo;
    const availableVersion = entry.version || null;
    
    if (!availableVersion) {
      return {
        updateAvailable: false,
        currentVersion,
        availableVersion: null,
        entry,
        error: 'Manifest entry missing version field'
      };
    }
    
    // Compare versions
    const comparison = compareVersions(currentVersion, availableVersion);
    const updateAvailable = comparison < 0; // current < available
    
    return {
      updateAvailable,
      currentVersion,
      availableVersion,
      entry,
      channel,
      platform,
      format
    };
    
  } catch (err) {
    return {
      updateAvailable: false,
      currentVersion: null,
      availableVersion: null,
      entry: null,
      error: err.message
    };
  }
}

module.exports = {
  checkForSoftwareUpdate,
  getCurrentAppVersion,
  getCurrentChannel,
  getCurrentPlatform,
  compareVersions,
  findManifestEntryForApp
};
