const { BrowserWindow, app, ipcMain } = require('electron');
const { NostrRuntimeService } = require('./NostrRuntimeService');

let runtimeServiceInstance = null;

function registerNostrRuntimeIPC(dbManager) {
  if (runtimeServiceInstance) {
    return runtimeServiceInstance;
  }

  const service = new NostrRuntimeService(dbManager, { logger: console });
  runtimeServiceInstance = service;

  const broadcastToWindow = (win, status) => {
    if (!win || win.isDestroyed()) return;
    try {
      win.webContents.send('nostr:nrs:status', status);
    } catch (error) {
      console.warn('[NostrRuntimeIPC] Failed to send status to window:', error.message);
    }
  };

  const broadcastToAll = (status) => {
    const snapshot = status || service.getStatusSnapshot();
    BrowserWindow.getAllWindows().forEach((win) => broadcastToWindow(win, snapshot));
    return snapshot;
  };

  service.on('status', (status) => {
    broadcastToAll(status);
  });

  app.on('browser-window-created', (_event, window) => {
    setImmediate(() => {
      broadcastToWindow(window, service.getStatusSnapshot());
    });
  });

  app.on('before-quit', () => {
    service.shutdown({ keepBackground: false });
  });

  service.start();
  service.ensureConnections().catch((error) => {
    console.warn('[NostrRuntimeIPC] Initial connection ensure failed:', error.message);
  });

  ipcMain.handle('nostr:nrs:init', async (_event, args = {}) => {
    try {
      if (args.modePreference && args.applyPreference) {
        service.setMode(args.modePreference);
      }
      const status = service.start();
      await service.ensureConnections();
      return { success: true, status: service.getStatusSnapshot() };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Initialization error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:set-mode', async (_event, { mode } = {}) => {
    try {
      if (!mode) throw new Error('Mode is required');
      const status = service.setMode(mode);
      return { success: true, status };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to set mode:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:limits:get', () => {
    try {
      return { success: true, limits: service.getResourceLimits() };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to get resource limits:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:limits:set', (_event, updates = {}) => {
    try {
      const limits = service.setResourceLimits(updates);
      return { success: true, limits };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to set resource limits:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:relay-categories:get', () => {
    try {
      return { success: true, categories: service.getRelayCategoryPreference() };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to get relay categories:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:relay-categories:set', (_event, categories = []) => {
    try {
      const updated = service.setRelayCategoryPreference(categories);
      return { success: true, categories: updated };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to set relay categories:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:relays:list', (_event, options = {}) => {
    try {
      const relays = service.listRelays(options);
      return { success: true, relays };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to list relays:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:relays:add', (_event, relay = {}) => {
    try {
      const record = service.addRelay(relay);
      return { success: true, relay: record };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to add relay:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:relays:update', (_event, { relayUrl, changes } = {}) => {
    try {
      if (!relayUrl) throw new Error('relayUrl is required');
      const record = service.updateRelay(relayUrl, changes || {});
      return { success: true, relay: record };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to update relay:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:relays:remove', (_event, { relayUrl, force } = {}) => {
    try {
      if (!relayUrl) throw new Error('relayUrl is required');
      const removed = service.removeRelay(relayUrl, { force: !!force });
      return { success: true, removed };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to remove relay:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:follow:list', () => {
    try {
      const follows = service.getManualFollowEntries();
      return { success: true, follows };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to list manual follows:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:follow:update', (_event, { entries } = {}) => {
    try {
      const follows = service.setManualFollowEntries(entries || []);
      return { success: true, follows };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to update manual follows:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:follow:add', (_event, entry = {}) => {
    try {
      const follows = service.addManualFollowEntry(entry);
      return { success: true, follows };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to add manual follow:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:follow:remove', (_event, { pubkey } = {}) => {
    try {
      if (!pubkey) throw new Error('pubkey is required');
      const follows = service.removeManualFollowEntry(pubkey);
      return { success: true, follows };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to remove manual follow:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:publish', async (_event, payload = {}) => {
    try {
      const result = await service.publishEvent(payload);
      return { success: true, ...result };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to enqueue Nostr event:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:queue:list', () => {
    try {
      const snapshot = service.getQueueSnapshot();
      return { success: true, queue: snapshot };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to list queue:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nostr:nrs:shutdown', (_event, options = {}) => {
    try {
      const status = service.shutdown(options);
      return {
        success: true,
        status,
        message: options.keepBackground
          ? 'Nostr runtime service kept in background state.'
          : 'Nostr runtime service stopped.'
      };
    } catch (error) {
      console.error('[NostrRuntimeIPC] Failed to shutdown service:', error);
      return { success: false, error: error.message };
    }
  });

  broadcastToAll(service.getStatusSnapshot());

  return service;
}

module.exports = {
  registerNostrRuntimeIPC
};

