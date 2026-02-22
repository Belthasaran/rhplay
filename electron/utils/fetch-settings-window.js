/**
 * fetch-settings-window.js
 *
 * Creates a blocking BrowserWindow for the first-run fetch settings dialog
 */

const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const ipfsFetchConfig = require('./ipfs-fetch-config');

let fetchSettingsWindow = null;
let fetchSettingsResolve = null;

/**
 * Find renderer HTML path (same logic as main.js and software-update-window.js)
 * @returns {string|null}
 */
function findRendererPath() {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'electron',
      'renderer',
      'dist',
      'index.html'
    ));
  }
  if (process.execPath) {
    const execDir = path.dirname(process.execPath);
    candidates.push(path.join(execDir, 'resources', 'app.asar.unpacked', 'electron', 'renderer', 'dist', 'index.html'));
    candidates.push(path.join(execDir, 'resources', 'app.asar', 'electron', 'renderer', 'dist', 'index.html'));
  }
  candidates.push(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'));
  if (process.resourcesPath) {
    candidates.push(path.join(
      process.resourcesPath,
      'app.asar',
      'electron',
      'renderer',
      'dist',
      'index.html'
    ));
  }
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Create fetch settings window and wait for user to save
 * @param {BrowserWindow} parentWindow - Parent window (optional, null for startup)
 * @returns {Promise<void>} Resolves when user saves config
 */
function createFetchSettingsWindow(parentWindow = null) {
  return new Promise((resolve, reject) => {
    fetchSettingsResolve = resolve;

    const rendererPath = findRendererPath();
    if (!rendererPath) {
      reject(new Error('Renderer HTML not found'));
      return;
    }

    const mainWindow = BrowserWindow.getAllWindows().find((w) => w !== fetchSettingsWindow);
    const actualParent = parentWindow || mainWindow || null;
    const shouldShowImmediately = !actualParent;

    fetchSettingsWindow = new BrowserWindow({
      width: 800,
      height: 580,
      modal: actualParent ? true : false,
      parent: actualParent || undefined,
      resizable: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: false,
      },
      show: shouldShowImmediately,
      title: 'File Transfer Settings',
    });

    if (process.env.ELECTRON_START_URL || process.env.NODE_ENV === 'development') {
      fetchSettingsWindow.webContents.openDevTools();
    }

    fetchSettingsWindow.on('closed', () => {
      fetchSettingsWindow = null;
      if (fetchSettingsResolve) {
        fetchSettingsResolve();
        fetchSettingsResolve = null;
      }
    });

    const fileUrl = `file://${rendererPath}?mode=fetch-settings`;
    console.log('[fetch-settings-window] Loading with URL:', fileUrl);
    fetchSettingsWindow.loadURL(fileUrl);

    fetchSettingsWindow.once('ready-to-show', () => {
      fetchSettingsWindow.show();
      fetchSettingsWindow.focus();
    });

    fetchSettingsWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error('[fetch-settings-window] Failed to load:', errorCode, errorDescription);
      reject(new Error(`Failed to load fetch settings window: ${errorDescription}`));
    });
  });
}

/**
 * Handle save from renderer - write config and close window
 * @param {object} config - User fetch settings
 */
function handleSave(config) {
  try {
    ipfsFetchConfig.saveFetchSettings(config);
    if (fetchSettingsWindow && !fetchSettingsWindow.isDestroyed()) {
      fetchSettingsWindow.close();
    }
    if (fetchSettingsResolve) {
      fetchSettingsResolve();
      fetchSettingsResolve = null;
    }
  } catch (err) {
    console.error('[fetch-settings-window] Failed to save:', err);
  }
}

/**
 * Close fetch settings window without saving
 */
function closeFetchSettingsWindow() {
  if (fetchSettingsWindow && !fetchSettingsWindow.isDestroyed()) {
    fetchSettingsWindow.close();
  }
  fetchSettingsWindow = null;
  if (fetchSettingsResolve) {
    fetchSettingsResolve();
    fetchSettingsResolve = null;
  }
}

module.exports = {
  createFetchSettingsWindow,
  handleSave,
  closeFetchSettingsWindow,
};
