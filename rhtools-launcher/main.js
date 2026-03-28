/**
 * RHTools Launcher — separate Electron app for downloads, DB updates, and launching RHPlay.
 */

// If ELECTRON_RUN_AS_NODE is set, `require('electron')` resolves to the npm path string (breaks app, BrowserWindow, etc.).
if (process.env.ELECTRON_RUN_AS_NODE) {
  delete process.env.ELECTRON_RUN_AS_NODE;
}

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const { getElectronRoot, getRepoRoot } = require('./paths');

const electronRoot = getElectronRoot();
const repoRoot = getRepoRoot();

function requireFromElectron(rel) {
  return require(path.join(electronRoot, rel));
}

const manifestResolver = requireFromElectron(path.join('utils', 'manifest-resolver.js'));
const { checkForUpdates: checkCoreManifestUpdates } = requireFromElectron(
  path.join('utils', 'coremanifest-updater.js')
);
const {
  getCurrentPlatform,
  compareVersions,
  findManifestEntryForApp
} = requireFromElectron(path.join('utils', 'software-update-check.js'));
const softwareUpdateManager = requireFromElectron(path.join('utils', 'software-update-manager.js'));
const launcherSoftware = requireFromElectron(path.join('utils', 'launcher-software.js'));
const smwRom = requireFromElectron(path.join('utils', 'smw-rom.js'));
const { checkForDatabaseUpdates } = requireFromElectron(path.join('utils', 'database-update-check.js'));
const {
  executeDatabaseUpdateInProcess,
  executeReProvisionInProcess,
  executeProvisionFullInProcess
} = requireFromElectron(path.join('utils', 'database-update-inprocess.js'));

function getRhtoolsUserDataPath() {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'RHTools');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'RHTools');
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'RHTools');
}

const LAUNCHER_CONFIG_NAME = 'launcher-config.json';

function getLauncherConfigPath() {
  return path.join(getRhtoolsUserDataPath(), LAUNCHER_CONFIG_NAME);
}

function readLauncherConfig() {
  try {
    const p = getLauncherConfigPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (err) {
    console.warn('[launcher] config read failed:', err.message);
  }
  return { channel: 'beta' };
}

function writeLauncherConfig(cfg) {
  const dir = getRhtoolsUserDataPath();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(getLauncherConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
}

function getUserDataDir() {
  return manifestResolver.getUserDataDir();
}

function getWorkingDirForDb() {
  const base =
    process.platform === 'linux'
      ? manifestResolver.getUserSpecificTempBase()
      : app.getPath('temp');
  return path.join(base, 'RHTools', 'LauncherDbWork');
}

function getDbManifestPathForLauncher() {
  return manifestResolver.getDbmanifestPath();
}

function bootstrapManifestsSafe() {
  try {
    manifestResolver.bootstrapManifests();
  } catch (err) {
    console.warn('[launcher] bootstrapManifests:', err.message);
  }
}

let mainWindow = null;

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  const devUrl = process.env.ELECTRON_START_URL || process.env.VITE_DEV_SERVER_URL;
  mainWindow = new BrowserWindow({
    width: 920,
    height: 720,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'dist', 'index.html'));
  }
}

function registerIpc() {
  ipcMain.handle('launcher:get-state', async () => {
    const cfg = readLauncherConfig();
    const { platform, format } = getCurrentPlatform();
    const manifest = manifestResolver.loadCoreManifest();
    let entry = null;
    let entryError = null;
    if (manifest && platform && format) {
      const found = findManifestEntryForApp(manifest, cfg.channel || 'beta', 'RHPLAY', platform, format);
      entry = found ? found.entry : null;
      if (!found) {
        entryError = `No manifest entry for ${cfg.channel}/RHPLAY/${platform}/${format}`;
      }
    }
    const ud = getUserDataDir();
    const installed = launcherSoftware.listInstalledReleases(ud, 'RHPLAY');
    let bestLaunchCandidate = null;
    if (manifest && platform && format) {
      bestLaunchCandidate = launcherSoftware.findBestLaunchCandidate(
        ud,
        manifest,
        cfg.channel || 'beta',
        platform,
        format
      );
    }
    return {
      userDataDir: ud,
      releasesDir: launcherSoftware.getReleasesRoot(ud),
      channel: cfg.channel || 'beta',
      platform,
      format,
      manifestLoaded: !!manifest,
      rhplayEntry: entry,
      entryError,
      installedRhplay: installed,
      bestLaunchCandidate,
      workingDir: getWorkingDirForDb()
    };
  });

  ipcMain.handle('launcher:set-channel', async (_e, channel) => {
    const cfg = readLauncherConfig();
    cfg.channel = channel || 'beta';
    writeLauncherConfig(cfg);
    return { success: true, channel: cfg.channel };
  });

  ipcMain.handle('launcher:refresh-core-manifest', async () => {
    try {
      const result = await checkCoreManifestUpdates(null, { forceCheck: true });
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('launcher:download-rhplay', async (_event, progress) => {
    const cfg = readLauncherConfig();
    const { platform, format } = getCurrentPlatform();
    const manifest = manifestResolver.loadCoreManifest();
    if (!manifest) {
      return { success: false, error: 'No core manifest loaded' };
    }
    const found = findManifestEntryForApp(manifest, cfg.channel || 'beta', 'RHPLAY', platform, format);
    if (!found || !found.entry) {
      return { success: false, error: 'No RHPLAY manifest entry for this platform' };
    }
    const entry = found.entry;
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const progressCallback = (payload) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('launcher:download-progress', payload);
      }
    };
    try {
      const result = await launcherSoftware.performDownloadToReleases(
        entry,
        'RHPLAY',
        getUserDataDir(),
        progressCallback
      );
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('launcher:pick-executable', async () => {
    const filters =
      process.platform === 'win32'
        ? [{ name: 'Executable', extensions: ['exe'] }]
        : [{ name: 'All files', extensions: ['*'] }];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select RHPlay build',
      filters,
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) {
      return { canceled: true };
    }
    return { path: result.filePaths[0] };
  });

  ipcMain.handle('launcher:launch-rhplay', async (_e, exePath) => {
    /**
     * Env for spawning RHPlay from this process. Must not inherit:
     * - ELECTRON_START_URL / VITE_DEV_SERVER_URL: launcher dev uses these (e.g. port 5174); RHPlay's main.js
     *   would load that URL and show the launcher UI again instead of the packaged renderer.
     * - ELECTRON_RUN_AS_NODE
     * - On Linux, parent AppImage vars (APPDIR, …) — see docs.appimage.org packaging guide.
     */
    function childEnvForSpawnedRhplay(resolvedPath) {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.ELECTRON_START_URL;
      delete env.VITE_DEV_SERVER_URL;
      if (process.platform === 'linux') {
        const lower = resolvedPath.toLowerCase();
        delete env.APDIR;
        delete env.OWD;
        delete env.ARGV0;
        delete env.APPIMAGE;
        if (lower.endsWith('.appimage')) {
          env.APPIMAGE = resolvedPath;
        }
      }
      return env;
    }

    try {
      let manifest;
      try {
        manifest = manifestResolver.loadCoreManifest();
      } catch (err) {
        return { success: false, error: err.message || String(err) };
      }
      if (!manifest) {
        return { success: false, error: 'No manifest' };
      }
      const cfg = readLauncherConfig();
      const { platform, format } = getCurrentPlatform();
      const found = findManifestEntryForApp(manifest, cfg.channel || 'beta', 'RHPLAY', platform, format);
      const gate = launcherSoftware.isExecutableAllowedToRun(exePath, manifest, found ? found.entry : null);
      if (!gate.ok) {
        return { success: false, error: gate.error || 'Not allowed to run' };
      }

      const resolved = path.resolve(exePath);
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'File does not exist' };
      }

      if (process.platform === 'linux') {
        try {
          fs.chmodSync(resolved, 0o755);
        } catch (_) {
          /* ignore */
        }
        const child = spawn(resolved, [], {
          detached: true,
          stdio: 'ignore',
          env: childEnvForSpawnedRhplay(resolved)
        });
        child.on('error', (err) => console.error('[launcher] spawn error:', err.message));
        child.unref();
        return { success: true };
      }

      if (process.platform === 'win32') {
        const child = spawn(resolved, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
          env: childEnvForSpawnedRhplay(resolved)
        });
        child.on('error', (err) => console.error('[launcher] spawn error:', err.message));
        child.unref();
        return { success: true };
      }

      const child = spawn(resolved, [], {
        detached: true,
        stdio: 'ignore',
        env: childEnvForSpawnedRhplay(resolved)
      });
      child.on('error', (err) => console.error('[launcher] spawn error:', err.message));
      child.unref();
      return { success: true };
    } catch (err) {
      console.error('[launcher] launch-rhplay:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('launcher:check-rom', async () => {
    return smwRom.checkSmwRomWithoutDb(getUserDataDir, {
      projectRootForDevCheck: repoRoot
    });
  });

  ipcMain.handle('launcher:select-rom-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Super Mario World ROM File',
      filters: [
        { name: 'SNES ROM Files', extensions: ['sfc', 'smc'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    const selectedPath = result.filePaths[0];
    const validation = smwRom.validateSmwRom(selectedPath);
    return {
      success: validation.valid,
      path: selectedPath,
      validation,
      error: validation.valid ? null : `SHA224 hash mismatch. Expected: ${smwRom.SMW_EXPECTED_SHA224}, Got: ${validation.hash}`
    };
  });

  ipcMain.handle('launcher:copy-rom', async (_e, sourcePath) => {
    return smwRom.copySmwRomToDataDir(getUserDataDir, sourcePath, manifestResolver.ensureDirectory);
  });

  ipcMain.handle('launcher:check-db-updates', async () => {
    try {
      const info = checkForDatabaseUpdates();
      return { success: true, ...info };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('launcher:provision-databases', async () => {
    const manifestPath = getDbManifestPathForLauncher();
    if (!manifestPath || !fs.existsSync(manifestPath)) {
      return { success: false, error: `dbmanifest not found: ${manifestPath}` };
    }
    const userDataDir = getUserDataDir();
    const workingDir = getWorkingDirForDb();
    manifestResolver.ensureDirectory(workingDir);
    try {
      const r = await executeProvisionFullInProcess({
        manifestPath,
        userDataDir,
        workingDir,
        overwrite: null
      });
      return r;
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('launcher:run-db-update', async () => {
    const manifestPath = getDbManifestPathForLauncher();
    if (!manifestPath || !fs.existsSync(manifestPath)) {
      return { success: false, error: `dbmanifest not found: ${manifestPath}` };
    }
    const userDataDir = getUserDataDir();
    const workingDir = getWorkingDirForDb();
    manifestResolver.ensureDirectory(workingDir);
    try {
      const check = checkForDatabaseUpdates();
      if (!check.updatesAvailable || !check.updates || check.updates.length === 0) {
        return { success: true, message: 'No database updates pending', skipped: true };
      }
      const result = await executeDatabaseUpdateInProcess(check.updates, {
        manifestPath,
        userDataDir,
        workingDir
      });
      return result;
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('launcher:reprovision-databases', async () => {
    const manifestPath = getDbManifestPathForLauncher();
    if (!manifestPath || !fs.existsSync(manifestPath)) {
      return { success: false, error: `dbmanifest not found: ${manifestPath}` };
    }
    const userDataDir = getUserDataDir();
    const workingDir = getWorkingDirForDb();
    manifestResolver.ensureDirectory(workingDir);
    try {
      return await executeReProvisionInProcess({ manifestPath, userDataDir, workingDir });
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('shell:open-path', async (_e, p) => {
    if (!p) return { success: false };
    const err = await shell.openPath(p);
    return err ? { success: false, error: err } : { success: true };
  });
}

app.setPath('userData', getRhtoolsUserDataPath());

app.whenReady().then(async () => {
  bootstrapManifestsSafe();
  registerIpc();
  createWindow();

  (async () => {
    try {
      await checkCoreManifestUpdates(null, { forceCheck: false });
    } catch (err) {
      console.warn('[launcher] core manifest check:', err.message);
    }
  })();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
