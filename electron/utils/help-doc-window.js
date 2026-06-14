/**
 * help-doc-window.js - In-app BrowserWindow for emulator setup help pages.
 */

const { BrowserWindow, shell } = require('electron');

let helpWindow = null;

function attachExternalLinkHandlers(win) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

function openHelpDocWindow(filePath, title = 'Setup Instructions') {
  if (!filePath) {
    throw new Error('Help document path is required');
  }

  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.loadFile(filePath);
    helpWindow.setTitle(title);
    helpWindow.focus();
    return { windowId: helpWindow.id };
  }

  helpWindow = new BrowserWindow({
    width: 760,
    height: 680,
    title,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  attachExternalLinkHandlers(helpWindow);
  helpWindow.loadFile(filePath);

  helpWindow.on('closed', () => {
    helpWindow = null;
  });

  return { windowId: helpWindow.id };
}

function closeHelpDocWindow() {
  if (helpWindow && !helpWindow.isDestroyed()) {
    helpWindow.close();
    helpWindow = null;
  }
}

module.exports = {
  openHelpDocWindow,
  closeHelpDocWindow,
};
