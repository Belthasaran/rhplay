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
 * Map Content-Type to file extension.
 * @param {string} mime - MIME type from item.getMimeType()
 * @returns {string|null} Extension like '.7z' or '.zip', or null
 */
function extFromMime(mime) {
  if (!mime || typeof mime !== 'string') return null;
  const m = mime.toLowerCase().split(';')[0].trim();
  if (/application\/x-7z(-compressed)?|application\/x-7z/.test(m)) return '.7z';
  if (/application\/zip|application\/x-zip-compressed/.test(m)) return '.zip';
  return null;
}

/**
 * Detect file type from magic bytes (first 6 bytes).
 * @param {string} filePath - Path to file
 * @returns {string|null} Extension like '.zip', '.7z', '.bps', or null
 */
function detectFileTypeFromMagicBytes(filePath) {
  const buf = Buffer.alloc(6);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, 6, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (buf[0] === 0x50 && buf[1] === 0x4B) return '.zip';
  if (buf[0] === 0x37 && buf[1] === 0x7A && buf[2] === 0xBC && buf[3] === 0xAF && buf[4] === 0x27 && buf[5] === 0x1C) return '.7z';
  if (buf[0] === 0x42 && buf[1] === 0x50 && buf[2] === 0x53 && buf[3] === 0x31) return '.bps';
  return null;
}

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
    const extFromMimeVal = extFromMime(item.getMimeType());
    const extFromFilename = path.extname(suggestedName) || (suggestedName.match(/\.(zip|7z|bps|rhpak)$/i)?.[0]);
    const ext = extFromMimeVal || extFromFilename || '.bin';
    const tempPath = path.join(os.tmpdir(), `load-manual-dl-${Date.now()}${ext}`);
    item.setSavePath(tempPath);
    item.once('done', (event, state) => {
      if (state === 'completed' && fs.existsSync(tempPath)) {
        let finalPath = tempPath;
        const currentExt = path.extname(tempPath).toLowerCase();
        let detectedExt = null;
        try {
          detectedExt = detectFileTypeFromMagicBytes(tempPath);
        } catch (err) {
          console.warn('[load-manual-browser-window] Could not detect file type from magic bytes:', err.message);
        }
        if (detectedExt && currentExt !== detectedExt && currentExt !== '.rhpak') {
          const correctPath = tempPath.replace(/\.[^.]+$/, '') + detectedExt;
          try {
            fs.renameSync(tempPath, correctPath);
            finalPath = correctPath;
          } catch (err) {
            console.warn('[load-manual-browser-window] Could not rename to correct extension:', err.message);
          }
        }
        const mainWindow = mainWindowId
          ? BrowserWindow.fromId(mainWindowId)
          : BrowserWindow.getAllWindows().find(w => w !== browserWindow);
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
          mainWindow.webContents.send('loadManual:download-complete', {
            tempPath: finalPath,
            suggestedFilename: suggestedName,
            webContentsId: browserWindow && !browserWindow.isDestroyed() ? browserWindow.webContents.id : null,
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
