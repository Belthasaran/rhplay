/**
 * software-update-window.js
 *
 * Creates a separate BrowserWindow for the software update dialog
 */

const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

let updateWindow = null;
let updateInfo = null;
let updateResolve = null;

/**
 * Create update window and wait for user response
 * 
 * @param {Object} info - Update information
 * @param {BrowserWindow} parentWindow - Parent window (optional, should be null for startup check)
 * @returns {Promise<string>} User choice: 'update' | 'skip' | 'exit' | 'launch-new'
 */
function createUpdateWindow(info, parentWindow = null) {
  // Get main window reference if it exists (for manual checks)
  const { BrowserWindow } = require('electron');
  const mainWindow = BrowserWindow.getAllWindows().find(win => win !== updateWindow);
  
  // Use mainWindow as parent if available and parentWindow not specified
  const actualParent = parentWindow || mainWindow || null;
  return new Promise((resolve, reject) => {
    // Store info and resolve function
    updateInfo = info;
    updateResolve = resolve;
    
    // Find renderer HTML path (same logic as main.js)
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
    
    let rendererPath = null;
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        rendererPath = candidate;
        break;
      }
    }
    
    if (!rendererPath) {
      reject(new Error('Renderer HTML not found'));
      return;
    }
    
    // Create window - show immediately for startup update check, delay for manual checks
    const shouldShowImmediately = !actualParent; // Show immediately if no parent (startup check)
    updateWindow = new BrowserWindow({
      width: 800,
      height: 700,
      modal: actualParent ? true : false,
      parent: actualParent || undefined,
      resizable: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: false, // Disable web security for file:// URLs to work properly
        // Store update mode in webPreferences so preload can access it
        updateMode: 'update'
      },
      show: shouldShowImmediately, // Show immediately for startup check
      title: 'Software Update'
    });
    
    // Open DevTools for debugging
    if (process.env.ELECTRON_START_URL || process.env.NODE_ENV === 'development') {
      updateWindow.webContents.openDevTools();
    }
    
    // Set a custom property on webContents to indicate this is an update window
    updateWindow.webContents.updateMode = 'update';
    
    updateWindow.on('closed', () => {
      updateWindow = null;
      if (updateResolve) {
        // Window closed without response - treat as skip
        updateResolve('skip');
        updateResolve = null;
      }
    });
    
    // Load renderer with update mode
    // Use query parameter for better compatibility with main.ts detection
    if (rendererPath.includes('://')) {
      updateWindow.loadURL(`${rendererPath}?mode=update`);
    } else {
      // Use file:// URL with query parameter: file:///path/index.html?mode=update
      // Also set localStorage BEFORE loading as backup
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('updateMode', 'update');
        } catch (e) {
          // Ignore if localStorage not available
        }
      }
      
      const fileUrl = `file://${rendererPath}?mode=update`;
      console.log('[software-update-window] Loading update window with URL:', fileUrl);
      updateWindow.loadURL(fileUrl);
    }
    
    if (shouldShowImmediately) {
      // For startup check, show immediately and focus
      updateWindow.once('ready-to-show', () => {
        updateWindow.show();
        updateWindow.focus();
      });
    } else {
      // For manual checks, wait for ready-to-show
      updateWindow.once('ready-to-show', () => {
        updateWindow.show();
        updateWindow.focus();
      });
    }
    
    // Handle errors
    updateWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('[software-update-window] Failed to load:', errorCode, errorDescription);
      reject(new Error(`Failed to load update window: ${errorDescription}`));
    });
  });
}

/**
 * Handle user response from update dialog
 */
function handleUserResponse(response) {
  if (updateResolve) {
    updateResolve(response);
    updateResolve = null;
  }
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.close();
  }
}

/**
 * Update progress in dialog
 */
function updateProgress(progress) {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send('software-update:progress', progress);
  }
}

/**
 * Close update window
 */
function closeUpdateWindow() {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.close();
  }
  updateWindow = null;
  updateInfo = null;
  if (updateResolve) {
    updateResolve('skip');
    updateResolve = null;
  }
}

/**
 * Get current update info
 */
function getUpdateInfo() {
  return updateInfo;
}

module.exports = {
  createUpdateWindow,
  handleUserResponse,
  updateProgress,
  closeUpdateWindow,
  getUpdateInfo
};
