/**
 * database-update-window.js
 *
 * Creates a separate BrowserWindow for the database update dialog.
 * Mirrors software-update-window.js structure.
 */

const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

let dbUpdateWindow = null;
let dbUpdateInfo = null;
let dbUpdateResolve = null;

/**
 * Find renderer HTML path (same logic as main.js and software-update-window)
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
 * Create database update window and wait for user response
 *
 * @param {Object} info - { updates: [...], updatesAvailable: boolean }
 * @param {BrowserWindow} parentWindow - Parent window (optional, null for startup)
 * @returns {Promise<string>} User choice: 'skip' | 'update' | 'reprovision'
 */
function createDatabaseUpdateWindow(info, parentWindow = null) {
  const mainWindow = BrowserWindow.getAllWindows().find(win => win !== dbUpdateWindow);
  const actualParent = parentWindow || mainWindow || null;

  return new Promise((resolve, reject) => {
    dbUpdateInfo = info;
    dbUpdateResolve = resolve;

    const rendererPath = findRendererPath();
    if (!rendererPath) {
      reject(new Error('Renderer HTML not found'));
      return;
    }

    const shouldShowImmediately = !actualParent;
    dbUpdateWindow = new BrowserWindow({
      width: 650,
      height: 550,
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
      title: 'Database Update'
    });

    if (process.env.ELECTRON_START_URL || process.env.NODE_ENV === 'development') {
      dbUpdateWindow.webContents.openDevTools();
    }

    dbUpdateWindow.on('closed', () => {
      dbUpdateWindow = null;
      if (dbUpdateResolve) {
        dbUpdateResolve('skip');
        dbUpdateResolve = null;
      }
    });

    const fileUrl = `file://${rendererPath}?mode=db-update`;
    console.log('[database-update-window] Loading with URL:', fileUrl);
    dbUpdateWindow.loadURL(fileUrl);

    dbUpdateWindow.once('ready-to-show', () => {
      dbUpdateWindow.show();
      dbUpdateWindow.focus();
    });

    dbUpdateWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('[database-update-window] Failed to load:', errorCode, errorDescription);
      reject(new Error(`Failed to load database update window: ${errorDescription}`));
    });
  });
}

/**
 * Handle user response from database update dialog
 */
function handleUserResponse(response) {
  if (dbUpdateResolve) {
    dbUpdateResolve(response);
    dbUpdateResolve = null;
  }
  const isProcessing = dbUpdateInfo && (dbUpdateInfo.updateState === 'downloading' || dbUpdateInfo.updateState === 'updating');
  if (response === 'skip' && !isProcessing) {
    if (dbUpdateWindow && !dbUpdateWindow.isDestroyed()) {
      dbUpdateWindow.close();
    }
  }
}

/**
 * Update progress in dialog
 */
function updateProgress(progress) {
  if (dbUpdateWindow && !dbUpdateWindow.isDestroyed()) {
    const fullProgress = {
      message: progress.message || 'Processing...',
      filename: progress.filename || '',
      current: progress.current || 0,
      total: progress.total || 0,
      percent: progress.percent !== undefined ? progress.percent : (progress.total > 0 ? Math.floor((progress.current / progress.total) * 100) : 0)
    };
    if (progress.logEntries && Array.isArray(progress.logEntries)) {
      fullProgress.logEntries = progress.logEntries;
    }
    dbUpdateWindow.webContents.send('database-update:progress', fullProgress);
  }
}

/**
 * Update info in place (no new window) - use when error/partial success to update existing dialog
 */
function updateInfoInPlace(info) {
  dbUpdateInfo = info;
  if (dbUpdateWindow && !dbUpdateWindow.isDestroyed()) {
    dbUpdateWindow.webContents.send('database-update:info-update', info);
  }
}

/**
 * Close database update window
 */
function closeDatabaseUpdateWindow() {
  if (dbUpdateWindow && !dbUpdateWindow.isDestroyed()) {
    dbUpdateWindow.close();
  }
  dbUpdateWindow = null;
  dbUpdateInfo = null;
  if (dbUpdateResolve) {
    dbUpdateResolve('skip');
    dbUpdateResolve = null;
  }
}

/**
 * Get current database update info
 */
function getDatabaseUpdateInfo() {
  return dbUpdateInfo;
}

/**
 * Wait for user response from the existing window (e.g. after update completes, wait for "Continue")
 */
function waitForUserResponse() {
  return new Promise((resolve) => {
    if (!dbUpdateResolve) {
      dbUpdateResolve = resolve;
    } else {
      const originalResolve = dbUpdateResolve;
      dbUpdateResolve = (response) => {
        originalResolve(response);
        resolve(response);
      };
    }
  });
}

module.exports = {
  createDatabaseUpdateWindow,
  handleUserResponse,
  updateProgress,
  updateInfoInPlace,
  closeDatabaseUpdateWindow,
  getDatabaseUpdateInfo,
  waitForUserResponse
};
