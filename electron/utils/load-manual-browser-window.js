/**
 * load-manual-browser-window.js
 *
 * Creates a BrowserWindow for Load Manual "From Page" / "From SMWC" modes.
 * User navigates to a page (e.g. SMWC game page) and downloads a file.
 * We intercept the download, save to temp, and notify the main window.
 */

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let browserWindow = null;

/**
 * Create browser window for Load Manual page/SMWC mode
 * @param {Object} opts - { url: string, mainWindowId?: number }
 * @returns {Object} { windowId: number }
 */
function createLoadManualBrowserWindow(opts = {}) {
  const url = opts.url || 'about:blank';
  const mainWindowId = opts.mainWindowId;

  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.loadURL(url);
    browserWindow.focus();
    return { windowId: browserWindow.id, webContentsId: browserWindow.webContents.id };
  }

  browserWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'Load Manual – Browser',
  });

  const session = browserWindow.webContents.session;
  session.on('will-download', (_event, item, webContents) => {
    const suggestedName = item.getFilename() || 'download';
    const ext = path.extname(suggestedName) || (suggestedName.match(/\.(zip|7z|bps|rhpak)$/i)?.[0]) || '.zip';
    const tempPath = path.join(os.tmpdir(), `load-manual-dl-${Date.now()}${ext}`);
    item.setSavePath(tempPath);
    item.once('done', (event, state) => {
      if (state === 'completed' && fs.existsSync(tempPath)) {
        const mainWindow = mainWindowId
          ? BrowserWindow.fromId(mainWindowId)
          : BrowserWindow.getAllWindows().find(w => w !== browserWindow);
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
          mainWindow.webContents.send('loadManual:download-complete', {
            tempPath,
            suggestedFilename: suggestedName,
          });
        }
      } else if (state === 'interrupted') {
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch (_) {}
      }
    });
  });

  browserWindow.loadURL(url);

  browserWindow.on('closed', () => {
    browserWindow = null;
  });

  return { windowId: browserWindow.id, webContentsId: browserWindow.webContents.id };
}

/**
 * Close the browser window if open
 */
function closeLoadManualBrowserWindow() {
  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.close();
    browserWindow = null;
  }
}

module.exports = {
  createLoadManualBrowserWindow,
  closeLoadManualBrowserWindow,
};
