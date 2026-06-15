/**
 * Twitch Configuration Helper
 * 
 * Reads Twitch client ID from:
 * - Environment variable (RHPLAY_TW_CLIENT_ID) in development
 * - Bundled config file in production builds
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Get the Twitch client ID
 * In dev: reads from RHPLAY_TW_CLIENT_ID environment variable
 * In production: reads from bundled twitch-config.json file
 */
function getTwitchClientId() {
  const isDev = process.env.ELECTRON_START_URL || process.env.NODE_ENV === 'development';
  const isPackaged = app && app.isPackaged;
  
  if (isDev && !isPackaged) {
    // Development mode: Use environment variable
    const clientId = process.env.RHPLAY_TW_CLIENT_ID;
    if (!clientId) {
      console.warn('[Twitch Config] RHPLAY_TW_CLIENT_ID environment variable not set');
      return null;
    }
    return clientId;
  }
  
  // Production mode: Read from bundled config file
  try {
    let configPath;
    
    if (isPackaged) {
      // In packaged app, config is in extraResources (typically in app.asar.unpacked or resources)
      // electron-builder places extraResources in different locations:
      // - macOS: <app>/Contents/Resources/
      // - Windows: <app>/resources/
      // - Linux: <app>/resources/
      const resourcesPath = process.resourcesPath || app.getAppPath();
      configPath = path.join(resourcesPath, 'twitch-config.json');
      
      // Fallback: try resources directory
      if (!fs.existsSync(configPath)) {
        const altPath = path.join(resourcesPath, '..', 'resources', 'twitch-config.json');
        if (fs.existsSync(altPath)) {
          configPath = altPath;
        }
      }
    } else {
      // Unpackaged production build (for testing)
      configPath = path.join(__dirname, 'twitch-config.json');
    }
    
    if (!fs.existsSync(configPath)) {
      console.warn('[Twitch Config] Config file not found at:', configPath);
      return null;
    }
    
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);
    
    // Decode the client ID (simple base64 decode for obscurity, not security)
    // The build script encodes it as base64
    if (config.clientId) {
      try {
        const decoded = Buffer.from(config.clientId, 'base64').toString('utf8');
        return decoded;
      } catch (e) {
        // If decoding fails, maybe it's stored plain (fallback)
        return config.clientId;
      }
    }
    
    return null;
  } catch (error) {
    console.error('[Twitch Config] Error reading config file:', error);
    return null;
  }
}

/**
 * Loopback ports for system-browser OAuth (each must be registered in Twitch Developer Console).
 * Tried in order when the preferred port is already in use.
 */
const TWITCH_OAUTH_LOOPBACK_PORTS = [47832, 56218, 51158];

/** @deprecated Use TWITCH_OAUTH_LOOPBACK_PORTS[0] */
const TWITCH_OAUTH_LOOPBACK_PORT = TWITCH_OAUTH_LOOPBACK_PORTS[0];

/**
 * Get the redirect URI for embedded in-app OAuth window
 */
function getTwitchRedirectUri() {
  return 'https://localhost';
}

/**
 * Get the redirect URI for system-browser OAuth via local loopback server.
 * Must use the localhost hostname (not 127.0.0.1) — Twitch rejects HTTP redirect URIs on IP addresses.
 * @param {number} [port]
 */
function getTwitchLoopbackRedirectUri(port = TWITCH_OAUTH_LOOPBACK_PORTS[0]) {
  return `http://localhost:${port}/`;
}

module.exports = {
  TWITCH_OAUTH_LOOPBACK_PORT,
  TWITCH_OAUTH_LOOPBACK_PORTS,
  getTwitchClientId,
  getTwitchRedirectUri,
  getTwitchLoopbackRedirectUri,
};

