const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherAPI', {
  getState: () => ipcRenderer.invoke('launcher:get-state'),
  setChannel: (channel) => ipcRenderer.invoke('launcher:set-channel', channel),
  refreshCoreManifest: () => ipcRenderer.invoke('launcher:refresh-core-manifest'),
  downloadRhplay: () => ipcRenderer.invoke('launcher:download-rhplay'),
  onDownloadProgress: (cb) => {
    ipcRenderer.on('launcher:download-progress', (_e, payload) => cb(payload));
  },
  onOperationProgress: (cb) => {
    ipcRenderer.on('launcher:operation-progress', (_e, payload) => cb(payload));
  },
  closeProgressWindow: () => ipcRenderer.invoke('launcher:close-progress-window'),
  pickExecutable: () => ipcRenderer.invoke('launcher:pick-executable'),
  launchRhplay: (exePath) => ipcRenderer.invoke('launcher:launch-rhplay', exePath),
  checkRom: () => ipcRenderer.invoke('launcher:check-rom'),
  selectRomFile: () => ipcRenderer.invoke('launcher:select-rom-file'),
  copyRom: (sourcePath) => ipcRenderer.invoke('launcher:copy-rom', sourcePath),
  checkDbUpdates: () => ipcRenderer.invoke('launcher:check-db-updates'),
  provisionDatabases: () => ipcRenderer.invoke('launcher:provision-databases'),
  runDbUpdate: () => ipcRenderer.invoke('launcher:run-db-update'),
  reprovisionDatabases: () => ipcRenderer.invoke('launcher:reprovision-databases'),
  openPath: (p) => ipcRenderer.invoke('shell:open-path', p)
});
