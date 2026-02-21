const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { DatabaseManager } = require('./database-manager');
const { registerDatabaseHandlers } = require('./ipc-handlers');
const StartupPathValidator = require('./startup-path-validator');
const { queueRhpakPath, drainRhpakQueue } = require('./rhpak-queue');
const { SMW_EXPECTED_SHA224 } = require('../lib/binary-finder');
const { bootstrapManifests, getDbmanifestPath, getUserSpecificTempBase } = require('./utils/manifest-resolver');
const { checkForUpdates: checkCoreManifestUpdates } = require('./utils/coremanifest-updater');
const { checkForSoftwareUpdate } = require('./utils/software-update-check');
const softwareUpdateManager = require('./utils/software-update-manager');
const softwareUpdateWindow = require('./utils/software-update-window');
const databaseUpdateWindow = require('./utils/database-update-window');
const { checkForDatabaseUpdates } = require('./utils/database-update-check');
const { executeDatabaseUpdate, executeReProvision } = require('./utils/database-update-executor');

/**
 * Register software update IPC handlers early (before database initialization)
 */
function setupSoftwareUpdateIpc() {
  const { ipcMain, shell } = require('electron');
  
  // Get update info for dialog
  ipcMain.handle('software-update:get-info', () => {
    return softwareUpdateWindow.getUpdateInfo();
  });
  
  // Handle user response from update dialog
  ipcMain.handle('software-update:user-response', (_event, { response }) => {
    softwareUpdateWindow.handleUserResponse(response);
    return { success: true };
  });
  
  // Open URL in default browser
  ipcMain.handle('software-update:open-url', (_event, { url }) => {
    shell.openExternal(url);
    return { success: true };
  });
  
  // Open IPFS gateway URL
  ipcMain.handle('software-update:open-ipfs', (_event, { cid, gateway }) => {
    const url = softwareUpdateManager.buildIPFSUrl(cid, gateway);
    if (url) {
      shell.openExternal(url);
    }
    return { success: true };
  });
  
  // Open ArWeave gateway URL
  ipcMain.handle('software-update:open-arweave', (_event, { txid, gateway }) => {
    const url = softwareUpdateManager.buildArWeaveUrl(txid, gateway);
    if (url) {
      shell.openExternal(url);
    }
    return { success: true };
  });
  
  // Get IPFS gateways list
  ipcMain.handle('software-update:get-ipfs-gateways', () => {
    return softwareUpdateManager.getIPFSGateways();
  });
  
  // Get ArWeave gateways list
  ipcMain.handle('software-update:get-arweave-gateways', () => {
    return softwareUpdateManager.getArWeaveGateways();
  });
}

/**
 * Register database update IPC handlers
 */
function setupDatabaseUpdateIpc() {
  ipcMain.handle('database-update:get-info', () => {
    return databaseUpdateWindow.getDatabaseUpdateInfo();
  });
  ipcMain.handle('database-update:user-response', (_event, { response }) => {
    databaseUpdateWindow.handleUserResponse(response);
    return { success: true };
  });
}

const DATABASE_FILES = ['clientdata.db', 'rhdata.db', 'patchbin.db', 'resource.db', 'screenshot.db', 'thumbnail_cache.db'];
let handlersRegistered = false;
let mainWindow = null;
let currentMode = 'app';
let rhpakRendererReady = false;

function resolveLogPath() {
    const dirs = [
        process.env.TEMP,
        process.env.TMP,
        getUserSpecificTempBase(),
        os.tmpdir(),
        path.dirname(process.execPath),
        process.cwd(),
    ].filter(Boolean);

    for (const dir of dirs) {
        try {
            // Ensure directory exists before trying to write
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const candidate = path.join(dir, 'rhtools-installer.log');
            fs.appendFileSync(candidate, '', { encoding: 'utf8' });
            return candidate;
        } catch {
            // try next directory
        }
    }
    return null;
}

const tempLogPath = resolveLogPath();
function logTemp(message) {
    if (tempLogPath) {
        try {
            fs.appendFileSync(tempLogPath, `[${new Date().toISOString()}] PID ${process.pid} ${message}\n`, { encoding: 'utf8' });
            return;
        } catch {
            // fall through to console
        }
    }
    console.log(`[installer-log:${process.pid}] ${message}`);
}

logTemp(`argv=${process.argv.join(' ')}`);

function extractRhpakFromArgv(argv = []) {
    if (!Array.isArray(argv)) {
        return null;
    }
    for (const entry of argv) {
        if (typeof entry !== 'string') {
            continue;
        }
        const trimmed = entry.trim();
        if (!trimmed) continue;
        if (trimmed.toLowerCase().endsWith('.rhpak')) {
            return trimmed.replace(/^["']|["']$/g, '');
        }
    }
    return null;
}

function flushPendingRhpakEvents() {
    if (!rhpakRendererReady || !mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    const pending = drainRhpakQueue();
    pending.forEach((filePath) => {
        if (filePath) {
            mainWindow.webContents.send('rhpak:open-from-os', filePath);
        }
    });
}

function handleRhpakFromOS(filePath) {
    if (!filePath) {
        return;
    }
    queueRhpakPath(filePath);
    flushPendingRhpakEvents();
}

function ensureDirectory(dirPath) {
    if (!dirPath) {
        return;
    }
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    } catch (err) {
        console.error('Failed to ensure directory:', dirPath, err);
    }
}

function getUserDataDir() {
    const dir = app.getPath('userData');
    ensureDirectory(dir);
    return dir;
}

function getWorkingDir() {
    const tempBase = process.platform === 'linux' ? getUserSpecificTempBase() : app.getPath('temp');
    const dir = path.join(tempBase, 'RHTools', 'Provisioning');
    ensureDirectory(dir);
    return dir;
}

function getProvisionerPaths() {
    const workingDir = getWorkingDir();
    return {
        workingDir,
        planPath: path.join(workingDir, 'plan.json'),
        summaryPath: path.join(workingDir, 'plan-summary.txt'),
        progressLogPath: path.join(workingDir, 'progress.log'),
        progressDonePath: path.join(workingDir, 'progress.done.json'),
    };
}

function getManifestPath() {
    // Use manifest resolver to get dbmanifest path (will support _latest in future)
    try {
        const resolved = getDbmanifestPath();
        return resolved.path;
    } catch (err) {
        // Fallback to old logic if resolver fails
        const candidates = [
            path.join(process.resourcesPath || '', 'db', 'dbmanifest.json'),
            path.join(process.resourcesPath || '', 'app.asar.unpacked', 'electron', 'dbmanifest.json'),
            path.join(__dirname, 'dbmanifest.json'),
            path.join(__dirname, '..', 'electron', 'dbmanifest.json'),
            path.join(process.cwd(), 'electron', 'dbmanifest.json'),
        ];
        for (const candidate of candidates) {
            if (candidate && fs.existsSync(candidate)) {
                return candidate;
            }
        }
        throw new Error('dbmanifest.json not found in expected locations.');
    }
}

function getProvisionerScriptPath() {
    const candidates = [
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'electron', 'installer', 'prepare_databases.js'),
        path.join(process.resourcesPath || '', 'app.asar', 'electron', 'installer', 'prepare_databases.js'),
        path.join(__dirname, 'installer', 'prepare_databases.js'),
        path.join(__dirname, '..', 'electron', 'installer', 'prepare_databases.js'),
        path.join(process.cwd(), 'electron', 'installer', 'prepare_databases.js'),
    ];
    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error('prepare_databases.js not found in expected locations.');
}

function getMissingDatabases() {
    const isDev = process.env.ELECTRON_START_URL || process.env.NODE_ENV === 'development';
    const isPackaged = process.env.ELECTRON_IS_PACKAGED || process.env.APPIMAGE;
    
    // Use same path resolution logic as database-manager.js
    let basePath;
    try {
        if (isDev || !app || !app.getPath) {
            // Development or testing: Use electron/ directory
            basePath = __dirname;
        } else {
            // Production: Use app user data directory
            basePath = app.getPath('userData');
            ensureDirectory(basePath);
        }
    } catch (error) {
        // Fallback for testing
        basePath = __dirname;
    }
    
    // Databases that require provisioning (exclude thumbnail_cache.db - it's auto-created)
    const PROVISIONING_REQUIRED_DB = ['clientdata.db', 'rhdata.db', 'patchbin.db', 'resource.db', 'screenshot.db'];
    
    // Check each database, respecting environment variable overrides
    const missing = [];
    for (const dbName of DATABASE_FILES) {
        // Skip thumbnail_cache.db - it's auto-created by the database manager, not provisioned
        if (dbName === 'thumbnail_cache.db') {
            continue;
        }
        
        // Only check databases that require provisioning
        if (!PROVISIONING_REQUIRED_DB.includes(dbName)) {
            continue;
        }
        
        let dbPath;
        
        // Check for environment variable override
        if (dbName === 'rhdata.db' && process.env.RHDATA_DB_PATH) {
            dbPath = process.env.RHDATA_DB_PATH;
        } else if (dbName === 'patchbin.db' && process.env.PATCHBIN_DB_PATH) {
            dbPath = process.env.PATCHBIN_DB_PATH;
        } else if (dbName === 'clientdata.db' && process.env.CLIENTDATA_DB_PATH) {
            dbPath = process.env.CLIENTDATA_DB_PATH;
        } else if (dbName === 'resource.db' && process.env.RESOURCE_DB_PATH) {
            dbPath = process.env.RESOURCE_DB_PATH;
        } else if (dbName === 'screenshot.db' && process.env.SCREENSHOT_DB_PATH) {
            dbPath = process.env.SCREENSHOT_DB_PATH;
        } else {
            // Use default path
            dbPath = path.join(basePath, dbName);
        }
        
        if (!fs.existsSync(dbPath)) {
            missing.push(dbName);
        }
    }
    
    return missing;
}

function ensureHandlersRegistered() {
    if (!dbManager) {
        return false;
    }
    if (!handlersRegistered) {
        registerDatabaseHandlers(dbManager);
        handlersRegistered = true;
        console.log('IPC handlers registered');
    }
    return handlersRegistered;
}

const CLI_RUN_FLAG = '--run-cli-script';
const cliFlagIndex = process.argv.indexOf(CLI_RUN_FLAG);
const isInstallerCli = cliFlagIndex !== -1;
if (isInstallerCli) {
    process.env.RHTOOLS_CLI_MODE = '1';
}
logTemp(`isInstallerCli=${isInstallerCli} index=${cliFlagIndex}`);

if (isInstallerCli) {
    process.env.ELECTRON_RUN_AS_NODE = '1';
    if (app && typeof app.disableHardwareAcceleration === 'function') {
        app.disableHardwareAcceleration();
    }
    const scriptPathInput = process.argv[cliFlagIndex + 1];
    const scriptArgs = process.argv.slice(cliFlagIndex + 2);
    (async () => {
        try {
            if (!scriptPathInput) {
                throw new Error('No script path provided to --run-cli-script.');
            }
            const resolvedScript = resolveScriptLocation(scriptPathInput);
            if (!resolvedScript) {
                throw new Error(
                    `CLI script "${scriptPathInput}" not found in expected locations. Checked: ${collectScriptCandidates(
                        scriptPathInput
                    ).join('; ')}`
                );
            }
            logTemp(`Resolved CLI script to ${resolvedScript}`);
            const runnerModule = require(resolvedScript);
            const runner =
                runnerModule && typeof runnerModule.run === 'function'
                    ? runnerModule.run
                    : typeof runnerModule === 'function'
                        ? runnerModule
                        : null;
            if (!runner) {
                throw new Error(`CLI script ${resolvedScript} does not export a run function.`);
            }
            logTemp(`Running CLI script ${resolvedScript} args=${scriptArgs.join(' ')}`);
            await runner(scriptArgs);
            if (app && typeof app.exit === 'function') {
                app.exit(0);
            } else {
                process.exit(0);
            }
        } catch (error) {
            console.error('[installer-cli] Failed to execute script:', error);
            logTemp(`CLI script failed: ${error.stack || error}`);
            if (app && typeof app.exit === 'function') {
                app.exit(1);
            } else {
                process.exit(1);
            }
        }
    })();
}

if (!isInstallerCli) {
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
        app.quit();
    } else {
        app.on('second-instance', (_event, argv) => {
            const rhpakPath = extractRhpakFromArgv(argv);
            if (rhpakPath) {
                handleRhpakFromOS(rhpakPath);
            }
            if (mainWindow) {
                if (mainWindow.isMinimized()) {
                    mainWindow.restore();
                }
                mainWindow.focus();
            }
        });
    }
    const initialRhpak = extractRhpakFromArgv(process.argv);
    if (initialRhpak) {
        queueRhpakPath(initialRhpak);
    }
    app.on('open-file', (event, filePath) => {
        event.preventDefault();
        handleRhpakFromOS(filePath);
    });
}

ipcMain.handle('rhpak:renderer-ready', async () => {
    rhpakRendererReady = true;
    flushPendingRhpakEvents();
    return { success: true };
});

// Initialize database manager
let dbManager = null;

// Track if update check is in progress
let updateCheckInProgress = false;

function setUpdateCheckInProgress(value) {
    updateCheckInProgress = value;
}

function getOrCreateMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        return mainWindow;
    }
    
    // Don't create main window if update check is in progress
    if (updateCheckInProgress) {
        console.log('[main] Update check in progress, delaying main window creation');
        throw new Error('Cannot create main window during update check');
    }
    
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        show: false,
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    if (process.env.ELECTRON_START_URL) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    return mainWindow;
}

function buildRendererUrl(mode) {
    currentMode = mode;
    if (process.env.ELECTRON_START_URL) {
        try {
            const url = new URL(process.env.ELECTRON_START_URL);
            url.searchParams.set('mode', mode);
            return url.toString();
        } catch (err) {
            console.error('Failed to construct dev URL, falling back:', err);
            return process.env.ELECTRON_START_URL;
        }
    }

    // Try multiple possible locations for the renderer HTML
    const candidates = [];
    
    // 1. Try unpacked location (preferred)
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
    
    // 2. Try relative to executable (for portable apps)
    if (process.execPath) {
        const execDir = path.dirname(process.execPath);
        candidates.push(path.join(execDir, 'resources', 'app.asar.unpacked', 'electron', 'renderer', 'dist', 'index.html'));
        candidates.push(path.join(execDir, 'resources', 'app.asar', 'electron', 'renderer', 'dist', 'index.html'));
    }
    
    // 3. Try __dirname (development)
    candidates.push(path.join(__dirname, 'renderer', 'dist', 'index.html'));
    
    // 4. Try ASAR location (fallback)
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

    // Find the first existing candidate
    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
            console.log(`Using renderer HTML from: ${candidate}`);
            return { path: candidate, query: { mode } };
        }
    }

    // If none found, return the first candidate anyway (will fail with better error)
    const fallback = candidates[0] || path.join(__dirname, 'renderer', 'dist', 'index.html');
    console.warn(`Renderer HTML not found in any candidate location, using fallback: ${fallback}`);
    return { path: fallback, query: { mode } };
}

async function loadRendererMode(mode) {
    if (mode === 'app') {
        rhpakRendererReady = false;
    }
    const win = getOrCreateMainWindow();
    const target = buildRendererUrl(mode);

    // Validate file exists before trying to load (for file paths)
    if (typeof target !== 'string' && target.path) {
        if (!fs.existsSync(target.path)) {
            const error = new Error(`Renderer HTML file not found: ${target.path}`);
            console.error(error.message);
            // Try to find an alternative location
            const altPath = path.join(__dirname, 'renderer', 'dist', 'index.html');
            if (fs.existsSync(altPath)) {
                console.log(`Trying alternative path: ${altPath}`);
                target.path = altPath;
            } else {
                throw error;
            }
        }
    }

    return new Promise((resolve, reject) => {
        const onFinished = async () => {
            win.webContents.removeListener('did-fail-load', onFailed);
            if (!win.isVisible()) {
                win.show();
            }
            if (mode === 'app') {
                await runStartupValidation(win);
            }
            resolve();
        };

        const onFailed = (_event, errorCode, errorDescription, validatedURL) => {
            win.webContents.removeListener('did-finish-load', onFinished);
            const errorMsg = `Failed to load renderer: ${errorCode} ${errorDescription}`;
            console.error(errorMsg);
            if (validatedURL) {
                console.error(`Failed URL: ${validatedURL}`);
            }
            reject(new Error(errorMsg));
        };

        win.webContents.once('did-finish-load', onFinished);
        win.webContents.once('did-fail-load', onFailed);

        if (typeof target === 'string') {
            win.loadURL(target);
        } else {
            win.loadFile(target.path, { query: target.query }).catch((err) => {
                win.webContents.removeListener('did-finish-load', onFinished);
                win.webContents.removeListener('did-fail-load', onFailed);
                console.error(`loadFile error: ${err.message}`);
                reject(err);
            });
        }
    });
}

function collectScriptCandidates(target) {
    const candidates = [];
    if (!target) {
        return candidates;
    }

    if (path.isAbsolute(target)) {
        candidates.push(target);
    } else {
        if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
            candidates.push(path.join(process.resourcesPath, target));
            candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', target));
            candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', target));
            candidates.push(path.join(process.resourcesPath, 'app.asar', target));
            candidates.push(path.join(process.resourcesPath, 'app.asar', 'electron', target));
        }
        candidates.push(path.join(__dirname, target));
        candidates.push(path.join(__dirname, '..', target));
        candidates.push(path.join(process.cwd(), target));
        }
    return candidates;
}

function resolveScriptLocation(target) {
    const candidates = collectScriptCandidates(target);
    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        } catch {
            // ignore
        }
    }
    logTemp(`CLI script "${target}" not found. Checked: ${candidates.join('; ')}`);
    return null;
}

async function initializeDatabaseLayer() {
    if (dbManager && handlersRegistered) {
        return;
    }
    try {
        console.log('Initializing database manager with auto-migrations enabled...');
        console.log('Process info:', {
            execPath: process.execPath,
            resourcesPath: process.resourcesPath,
            cwd: process.cwd(),
            __dirname: __dirname,
            isPackaged: process.env.ELECTRON_IS_PACKAGED || false,
        });
        
        dbManager = new DatabaseManager({ autoApplyMigrations: true });
        console.log('Database manager initialized with auto-migrations enabled');
        
        // Ensure migrations are applied to all databases at startup
        // This ensures databases are ready before any operations (like newgame.js) use them
        try {
          console.log('Applying migrations to all databases...');
          const dbNames = ['rhdata', 'patchbin', 'clientdata', 'resource', 'screenshot'];
          for (const dbName of dbNames) {
            try {
              // Trigger getConnection which will apply migrations if needed
              dbManager.getConnection(dbName);
              console.log(`✓ Migrations checked/applied for ${dbName}`);
            } catch (err) {
              console.warn(`⚠ Failed to apply migrations for ${dbName}:`, err.message);
            }
          }
          console.log('Database migrations completed');
        } catch (err) {
          console.error('Error applying database migrations:', err);
          // Don't fail startup, but log the error
        }
        
        ensureHandlersRegistered();

        const { ensureCreatedFp } = require('./ipc-handlers');
        await ensureCreatedFp(dbManager);
    } catch (error) {
        console.error('Failed to initialize database:', error);
        console.error('Error stack:', error.stack);
        // Reset manager so future attempts can retry
        dbManager = null;
        handlersRegistered = false;
        throw error;
    }
}

let activeProvisionerProcess = null;

function sendProvisionerLog(message) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('provisioner:log', message);
    }
}

function sendProvisionerStatus(payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('provisioner:status', payload);
    }
}

async function runProvisionerHelper({ provision }) {
    if (activeProvisionerProcess) {
        throw new Error('Provisioning already in progress.');
    }

    const manifestPath = getManifestPath();
    const userDataDir = getUserDataDir();
    const paths = getProvisionerPaths();
    ensureDirectory(paths.workingDir);

    for (const key of ['planPath', 'summaryPath', 'progressLogPath', 'progressDonePath']) {
        const filePath = paths[key];
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (err) {
            console.warn('Failed to clean previous provisioning file', filePath, err);
        }
    }

    const helperPath = getProvisionerScriptPath();
    const args = [
        helperPath,
        '--manifest',
        manifestPath,
        '--user-data-dir',
        userDataDir,
        '--working-dir',
        paths.workingDir,
        '--ensure-dirs',
        '--write-plan',
        paths.planPath,
        '--write-summary',
        paths.summaryPath,
        '--progress-log',
        paths.progressLogPath,
        '--progress-done',
        paths.progressDonePath,
    ];

    if (provision) {
        args.push('--provision');
    }

    sendProvisionerStatus({ state: 'starting', provision });

    const child = spawn(process.execPath, args, {
        cwd: paths.workingDir,
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeProvisionerProcess = child;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
        chunk
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .forEach((line) => sendProvisionerLog(line));
    });

    child.stderr.on('data', (chunk) => {
        chunk
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .forEach((line) => sendProvisionerLog(`[error] ${line}`));
    });

    return new Promise((resolve, reject) => {
        child.on('error', (err) => {
            activeProvisionerProcess = null;
            sendProvisionerStatus({ state: 'error', provision, error: err.message });
            reject(err);
        });

        child.on('close', (code) => {
            activeProvisionerProcess = null;

            let plan = null;
            let summary = '';

            if (fs.existsSync(paths.planPath)) {
                try {
                    plan = JSON.parse(fs.readFileSync(paths.planPath, 'utf8'));
                } catch (err) {
                    console.warn('Failed to parse provisioning plan:', err);
                }
            }

            if (fs.existsSync(paths.summaryPath)) {
                try {
                    summary = fs.readFileSync(paths.summaryPath, 'utf8');
                } catch (err) {
                    console.warn('Failed to read provisioning summary:', err);
                }
            }

            const missing = getMissingDatabases();
            const payload = {
                success: code === 0 && (!provision || missing.length === 0),
                exitCode: code,
                plan,
                summary,
                missingDatabases: missing,
            };

            if (code === 0) {
                if (payload.success) {
                    sendProvisionerStatus({ state: provision ? 'complete' : 'plan', provision, plan, summary });
                    sendProvisionerLog('[provisioner] Completed successfully.');
                } else {
                    sendProvisionerStatus({
                        state: provision ? 'needs-attention' : 'plan',
                        provision,
                        plan,
                        summary,
                        missing,
                    });
                    sendProvisionerLog('[provisioner] Completed, but some databases still require attention.');
                }
                resolve(payload);
                return;
            }

            sendProvisionerStatus({ state: 'error', provision, exitCode: code, summary, missing });
            sendProvisionerLog(`[provisioner] Failed with exit code ${code}.`);

            const error = new Error(`Provisioner helper exited with code ${code}`);
            error.payload = payload;
            reject(error);
        });
    });
}

/**
 * Check for SMW ROM file without relying on clientdata.db
 * Only checks program data directory and common locations
 */
function checkSmwRomWithoutDb() {
    const userDataDir = getUserDataDir();
    const skipRomPath = path.join(userDataDir, 'skiprom.txt');
    
    // Check for skiprom.txt flag
    if (fs.existsSync(skipRomPath)) {
        console.log('[ROM Check] skiprom.txt found, skipping ROM check');
        return { found: true, path: null, skipped: true };
    }
    
    const checks = [
        // Program data directory
        { name: 'Program data directory', fn: () => path.join(userDataDir, 'smw.sfc') },
        // Environment variable
        { name: 'Environment variable', fn: () => process.env.SMW_SFC_PATH },
        // Common ROM directories
        { name: 'Common ROM dir 1', fn: () => path.join(userDataDir, 'rom', 'smw.sfc') },
        { name: 'Common ROM dir 2', fn: () => path.join(userDataDir, 'roms', 'smw.sfc') },
        // Current working directory
        { name: 'Current directory', fn: () => path.join(process.cwd(), 'smw.sfc') },
        // Project root (if in development)
        { name: 'Project root', fn: () => path.join(__dirname, '..', 'smw.sfc') },
    ];
    
    for (const check of checks) {
        try {
            const romPath = check.fn();
            if (romPath && fs.existsSync(romPath)) {
                // Validate SHA224 hash
                try {
                    const romData = fs.readFileSync(romPath);
                    const hash = crypto.createHash('sha224').update(romData).digest('hex');
                    
                    if (hash === SMW_EXPECTED_SHA224) {
                        console.log(`[ROM Check] ✓ Found valid SMW ROM via ${check.name}: ${romPath}`);
                        return { found: true, path: romPath, hash };
                    } else {
                        console.log(`[ROM Check] ✗ ROM found at ${romPath} but hash mismatch (expected ${SMW_EXPECTED_SHA224}, got ${hash})`);
                    }
                } catch (error) {
                    console.warn(`[ROM Check] Failed to validate ROM at ${romPath}:`, error.message);
                }
            }
        } catch (error) {
            // Silently continue to next check
        }
    }
    
    return { found: false, path: null };
}

/**
 * Validate SMW ROM file by checking SHA224 hash
 */
function validateSmwRom(romPath) {
    try {
        const romData = fs.readFileSync(romPath);
        const hash = crypto.createHash('sha224').update(romData).digest('hex');
        
        return {
            valid: hash === SMW_EXPECTED_SHA224,
            hash: hash,
            expected: SMW_EXPECTED_SHA224,
            size: romData.length
        };
    } catch (error) {
        return {
            valid: false,
            error: error.message
        };
    }
}

/**
 * Copy SMW ROM file to program data directory
 */
function copySmwRomToDataDir(sourcePath) {
    const userDataDir = getUserDataDir();
    const targetPath = path.join(userDataDir, 'smw.sfc');
    
    try {
        // Ensure directory exists
        ensureDirectory(userDataDir);
        
        // Copy file
        fs.copyFileSync(sourcePath, targetPath);
        
        console.log(`[ROM Check] ✓ Copied SMW ROM to ${targetPath}`);
        return { success: true, path: targetPath };
    } catch (error) {
        console.error(`[ROM Check] ✗ Failed to copy ROM:`, error);
        return { success: false, error: error.message };
    }
}

function setupProvisionerIpc() {
    ipcMain.handle('provisioner:get-state', async () => {
        return {
            mode: currentMode,
            userDataDir: getUserDataDir(),
            workingDir: getProvisionerPaths().workingDir,
            manifestPath: getManifestPath(),
            missingDatabases: getMissingDatabases(),
        };
    });
    
    ipcMain.handle('provisioner:check-rom', async () => {
        return checkSmwRomWithoutDb();
    });
    
    ipcMain.handle('provisioner:select-rom-file', async () => {
        const result = await dialog.showOpenDialog(mainWindow || BrowserWindow.getFocusedWindow() || null, {
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
        const validation = validateSmwRom(selectedPath);
        
        return {
            success: validation.valid,
            path: selectedPath,
            validation: validation,
            error: validation.valid ? null : `SHA224 hash mismatch. Expected: ${SMW_EXPECTED_SHA224}, Got: ${validation.hash}`
        };
    });
    
    ipcMain.handle('provisioner:copy-rom', async (_event, sourcePath) => {
        return copySmwRomToDataDir(sourcePath);
    });

    ipcMain.handle('provisioner:run-plan', async () => {
        try {
            const result = await runProvisionerHelper({ provision: false });
            return { success: true, ...result };
        } catch (err) {
            return { success: false, error: err.message, payload: err.payload || null };
        }
    });

    ipcMain.handle('provisioner:run-provision', async () => {
        try {
            const result = await runProvisionerHelper({ provision: true });
            return { success: true, ...result };
        } catch (err) {
            return { success: false, error: err.message, payload: err.payload || null };
        }
    });

    ipcMain.handle('provisioner:open-ardrive', async () => {
        await shell.openExternal('https://app.ardrive.io/#/drives/58677413-8a0c-4982-944d-4a1b40454039?name=SMWRH');
        return { success: true };
    });

    ipcMain.handle('provisioner:launch-main', async () => {
        const missing = getMissingDatabases();
        if (missing.length > 0) {
            return { success: false, missing };
        }
        await initializeDatabaseLayer();
        ensureHandlersRegistered();
        await loadRendererMode('app');
        return { success: true };
    });

    ipcMain.handle('shell:open-external', async (_event, url) => {
      try {
        await shell.openExternal(url);
        return { success: true };
      } catch (error) {
        console.error('Error opening external URL:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('shell:open-path', async (_event, targetPath) => {
        if (!targetPath) {
            return { success: false, error: 'No path specified.' };
        }
        try {
            const resolved = path.resolve(String(targetPath));
            if (!fs.existsSync(resolved)) {
                fs.mkdirSync(resolved, { recursive: true });
            }
            const result = await shell.openPath(resolved);
            if (result) {
                return { success: false, error: result };
            }
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
}

app.whenReady().then(async () => {
    if (isInstallerCli) {
        return;
    }

    // Bootstrap manifest files (_latest.json) from bundled manifests
    try {
        bootstrapManifests();
    } catch (err) {
        console.error('[main] Failed to bootstrap manifests:', err);
        // Continue anyway - app can still work with bundled manifests
    }

    // Register software update and database update IPC handlers early (before update check)
    setupSoftwareUpdateIpc();
    setupDatabaseUpdateIpc();

    // Check for core manifest updates (non-blocking, background)
    (async () => {
        try {
            const result = await checkCoreManifestUpdates(null, { forceCheck: false });
            if (result.updated) {
                console.log(`[main] Core manifest updated to version ${result.newVersion}`);
            } else if (result.error) {
                console.warn(`[main] Core manifest update check failed: ${result.error}`);
            }
        } catch (err) {
            console.warn('[main] Core manifest update check error:', err.message);
            // Non-critical, continue
        }
    })();

    // Check for software updates (blocking - must respond before app continues)
    try {
        // Mark update check as in progress to prevent main window creation
        setUpdateCheckInProgress(true);
        
        const updateCheck = softwareUpdateManager.checkForUpdate();
        if (updateCheck.updateAvailable) {
            console.log(`[main] Software update available: ${updateCheck.currentVersion} -> ${updateCheck.availableVersion}`);
            
            // Check if local version exists
            const localCheck = softwareUpdateManager.checkLocalVersionExists(updateCheck.entry);
            let localVersionMatches = false;
            if (localCheck.exists) {
                const verifyResult = softwareUpdateManager.verifyLocalVersionSHA256(
                    localCheck.path,
                    updateCheck.entry.sha256
                );
                localVersionMatches = verifyResult.matches;
            }
            
            const updateInfo = {
                currentVersion: updateCheck.currentVersion,
                availableVersion: updateCheck.availableVersion,
                entry: updateCheck.entry,
                localVersionExists: localCheck.exists,
                localVersionMatches: localVersionMatches,
                updateState: 'idle'
            };
            
            // Create blocking update window (this will show immediately)
            let updateResult = await softwareUpdateWindow.createUpdateWindow(updateInfo, null);
            
            if (updateResult === 'exit') {
                // User chose to exit (old version dialog)
                app.quit();
                return;
            } else if (updateResult === 'update') {
                // User chose to update - perform update flow
                try {
                    // Update dialog state to downloading
                    updateInfo.updateState = 'downloading';
                    softwareUpdateWindow.updateProgress({
                        message: 'Starting update...',
                        filename: updateCheck.entry.source_filename || updateCheck.entry.target_filename || '',
                        current: 0,
                        total: 0,
                        percent: 0
                    });
                    
                    const progressCallback = (progress) => {
                        console.log('[main] Progress update:', progress);
                        softwareUpdateWindow.updateProgress(progress);
                        // Update state based on progress message
                        if (progress.message && (progress.message.includes('Downloading') || progress.message.includes('Starting download'))) {
                            updateInfo.updateState = 'downloading';
                        } else if (progress.message && (progress.message.includes('Verifying') || progress.message.includes('Performing') || progress.message.includes('Moving'))) {
                            updateInfo.updateState = 'verifying';
                        } else if (progress.message && progress.message.includes('completed successfully')) {
                            updateInfo.updateState = 'completed';
                        }
                    };
                    
                    const result = await softwareUpdateManager.performUpdate(
                        updateCheck.entry,
                        progressCallback
                    );
                    
                    if (result.success) {
                        // Update completed - update dialog state
                        updateInfo.updateState = 'completed';
                        updateInfo.newExecutablePath = result.newExecutablePath;
                        softwareUpdateWindow.updateProgress({
                            message: 'Update completed successfully!',
                            filename: '',
                            current: 0,
                            total: 0,
                            percent: 100
                        });
                        
                        // Update the existing window to show completed state
                        // Send state update via IPC so the dialog shows "Launch new version" button
                        const { BrowserWindow } = require('electron');
                        const windows = BrowserWindow.getAllWindows();
                        const updateWin = windows.find(w => w.getTitle() === 'Software Update');
                        if (updateWin && !updateWin.isDestroyed()) {
                            updateWin.webContents.send('software-update:state-update', {
                                updateState: 'completed',
                                newExecutablePath: result.newExecutablePath
                            });
                        }
                        
                        // Wait for user to click "Launch new version" button
                        // Create a new promise that resolves when user clicks launch
                        updateResult = await softwareUpdateWindow.waitForUserResponse();
                        
                        if (updateResult === 'launch-new') {
                            softwareUpdateManager.launchNewVersion(result.newExecutablePath);
                            // launchNewVersion will call app.quit(), so we won't reach here
                            return;
                        } else if (updateResult === 'exit') {
                            app.quit();
                            return;
                        }
                        // If skip, continue with old version (user chose not to launch new version)
                    } else {
                        throw new Error(result.error || 'Update failed');
                    }
                } catch (err) {
                    console.error('[main] Update failed:', err);
                    // Update dialog state to show error
                    updateInfo.updateState = 'error';
                    updateInfo.error = err.message;
                    softwareUpdateWindow.updateProgress({
                        message: `Update failed: ${err.message}`,
                        current: 0,
                        total: 0
                    });
                    // Re-open dialog with error state
                    const retryResult = await softwareUpdateWindow.createUpdateWindow(updateInfo, null);
                    if (retryResult === 'exit') {
                        app.quit();
                        return;
                    }
                    // Otherwise continue with old version
                }
            } else if (updateResult === 'launch-new') {
                // User clicked "Launch new version" after successful update
                if (updateInfo.newExecutablePath) {
                    softwareUpdateManager.launchNewVersion(updateInfo.newExecutablePath);
                    return;
                }
            }
            // If 'skip' or any other result, continue with normal startup
        }
        
        // Update check complete, allow main window creation
        setUpdateCheckInProgress(false);
    } catch (err) {
        console.warn('[main] Software update check error:', err.message);
        // Continue anyway - non-critical
        setUpdateCheckInProgress(false);
    }

    setupProvisionerIpc();

    try {
        const missing = getMissingDatabases();
        if (missing.length > 0) {
            // Check for SMW ROM before loading provisioner
            const romCheck = checkSmwRomWithoutDb();
            if (!romCheck.found && !romCheck.skipped) {
                // ROM not found and not skipped - load provisioner which will prompt user
                console.log('[ROM Check] SMW ROM not found, loading provisioner to prompt user');
            }
            await loadRendererMode('provisioner');
        } else {
            // Database update check (only when all databases exist)
            const dbUpdateCheck = checkForDatabaseUpdates();
            if (dbUpdateCheck.updatesAvailable && dbUpdateCheck.updates && dbUpdateCheck.updates.length > 0) {
                const dbUpdateInfo = {
                    updates: dbUpdateCheck.updates,
                    updatesAvailable: true,
                    updateState: 'idle',
                    progress: null,
                    error: null
                };
                const paths = getProvisionerPaths();
                const progressCallback = (p) => {
                    databaseUpdateWindow.updateProgress(p);
                };

                const dbResult = await databaseUpdateWindow.createDatabaseUpdateWindow(dbUpdateInfo, null);

                if (dbResult === 'update') {
                    dbUpdateInfo.updateState = 'updating';
                    databaseUpdateWindow.updateProgress({ message: 'Starting database update...', percent: 0 });
                    const result = await executeDatabaseUpdate(dbUpdateCheck.updates, {
                        manifestPath: getManifestPath(),
                        userDataDir: getUserDataDir(),
                        provisionerScriptPath: getProvisionerScriptPath(),
                        workingDir: paths.workingDir,
                        progressCallback
                    });
                    if (!result.success) {
                        dbUpdateInfo.updateState = 'error';
                        dbUpdateInfo.error = result.error;
                        databaseUpdateWindow.updateProgress({ message: `Update failed: ${result.error}`, percent: 0 });
                        await databaseUpdateWindow.createDatabaseUpdateWindow(dbUpdateInfo, null);
                    } else {
                        dbUpdateInfo.updateState = 'completed';
                        dbUpdateInfo.error = null;
                        databaseUpdateWindow.updateProgress({ message: 'Database update completed successfully!', percent: 100 });
                        await databaseUpdateWindow.waitForUserResponse();
                        databaseUpdateWindow.closeDatabaseUpdateWindow();
                    }
                } else if (dbResult === 'reprovision') {
                    dbUpdateInfo.updateState = 'updating';
                    databaseUpdateWindow.updateProgress({ message: 'Re-provisioning databases...', percent: 0 });
                    const result = await executeReProvision({
                        manifestPath: getManifestPath(),
                        userDataDir: getUserDataDir(),
                        provisionerScriptPath: getProvisionerScriptPath(),
                        workingDir: paths.workingDir,
                        progressCallback
                    });
                    if (!result.success) {
                        dbUpdateInfo.updateState = 'error';
                        dbUpdateInfo.error = result.error;
                        databaseUpdateWindow.updateProgress({ message: `Re-provision failed: ${result.error}`, percent: 0 });
                        await databaseUpdateWindow.createDatabaseUpdateWindow(dbUpdateInfo, null);
                    } else {
                        dbUpdateInfo.updateState = 'completed';
                        dbUpdateInfo.error = null;
                        databaseUpdateWindow.updateProgress({ message: 'Database re-provision completed successfully!', percent: 100 });
                        await databaseUpdateWindow.waitForUserResponse();
                        databaseUpdateWindow.closeDatabaseUpdateWindow();
                    }
                } else {
                    databaseUpdateWindow.closeDatabaseUpdateWindow();
                }
            }

            await initializeDatabaseLayer();
            await loadRendererMode('app');
            // Start overlay web server if enabled
            await startOverlayWebServer();
        }
    } catch (err) {
        console.error('Failed to load renderer:', err);
        // Only show error dialog if it's a critical error (not a transient path issue)
        // Transient path issues (like temp directory paths) might resolve on retry
        const isPathError = err.message && (
            err.message.includes('not found') ||
            err.message.includes('ERR_FAILED') ||
            err.message.includes('file://')
        );
        if (!isPathError) {
            dialog.showErrorBox('RHTools Startup Error', `Failed to load application UI: ${err.message}`);
        } else {
            console.warn('Path-related error detected, suppressing error dialog (may retry automatically)');
        }
    }

    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length > 0) {
            return;
        }

        try {
            const missing = getMissingDatabases();
            if (missing.length > 0) {
                await loadRendererMode('provisioner');
            } else {
                await initializeDatabaseLayer();
                await loadRendererMode('app');
                // Start overlay web server if enabled
                await startOverlayWebServer();
            }
        } catch (err) {
            console.error('Failed to activate renderer:', err);
            dialog.showErrorBox('RHTools Activation Error', `Failed to open application window: ${err.message}`);
        }
    });
});

app.on('window-all-closed', () => {
    // Close database connections
    if (dbManager) {
        dbManager.closeAll();
    }
    
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Overlay web server management
let overlayWebServerProcess = null;

async function startOverlayWebServer() {
  if (overlayWebServerProcess) {
    console.log('[Overlay Web Server] Already running');
    return;
  }
  
  try {
    if (!dbManager) {
      console.warn('[Overlay Web Server] Database manager not initialized');
      return;
    }
    
    const db = dbManager.getConnection('clientdata');
    const enabled = db.prepare('SELECT csetting_value FROM csettings WHERE csetting_name = ?').get('overlayWebServerEnabled');
    if (!enabled || enabled.csetting_value !== 'On') {
      console.log('[Overlay Web Server] Not enabled in settings');
      return;
    }
    
    const portRow = db.prepare('SELECT csetting_value FROM csettings WHERE csetting_name = ?').get('overlayWebServerPort');
    const port = portRow ? parseInt(portRow.csetting_value, 10) || 2599 : 2599;
    
    const remoteRow = db.prepare('SELECT csetting_value FROM csettings WHERE csetting_name = ?').get('overlayRemoteConnectionsEnabled');
    const allowRemote = remoteRow && remoteRow.csetting_value === 'On';
    
    const userDataPath = app.getPath('userData');
    const serverScriptPath = path.join(__dirname, 'overlay-web-server.js');
    
    if (!fs.existsSync(serverScriptPath)) {
      console.error('[Overlay Web Server] Server script not found:', serverScriptPath);
      return;
    }
    
    overlayWebServerProcess = utilityProcess.fork(serverScriptPath);
    
    overlayWebServerProcess.on('message', (message) => {
      if (!message || typeof message !== 'object' || !message.type) {
        console.log('[Overlay Web Server] Received invalid message:', message);
        return;
      }
      
      console.log(`[Overlay Web Server] Received message type: ${message.type}`);
      
      if (message.type === 'ready') {
        console.log('[Overlay Web Server] Process ready, starting server...');
        const startMessage = {
          type: 'start',
          options: {
            userDataPath,
            port,
            allowRemote
          }
        };
        console.log('[Overlay Web Server] Sending start message:', JSON.stringify(startMessage));
        try {
          overlayWebServerProcess.postMessage(startMessage);
          console.log('[Overlay Web Server] Start message sent successfully');
        } catch (error) {
          console.error('[Overlay Web Server] Error sending start message:', error);
        }
      } else if (message.type === 'start-ack') {
        console.log('[Overlay Web Server] Start command acknowledged');
      } else if (message.type === 'start-result') {
        if (message.result && message.result.success) {
          console.log(`[Overlay Web Server] Started successfully on port ${message.result.port}`);
        } else {
          console.error('[Overlay Web Server] Failed to start:', message.result ? message.result.error : 'Unknown error');
          overlayWebServerProcess = null;
        }
      } else if (message.type === 'error') {
        console.error('[Overlay Web Server] Error from process:', message.error);
      } else if (message.type === 'log') {
        console.log(`[Overlay Web Server Utility] ${message.message}`);
      }
    });
    
    overlayWebServerProcess.on('exit', (code, signal) => {
      console.log(`[Overlay Web Server] Process exited with code ${code}, signal ${signal}`);
      overlayWebServerProcess = null;
    });
    
    overlayWebServerProcess.on('spawn', () => {
      console.log('[Overlay Web Server] Utility process spawned');
    });
    
    overlayWebServerProcess.on('error', (error) => {
      console.error('[Overlay Web Server] Utility process error:', error);
    });
    
    // Note: UtilityProcess doesn't expose stdout/stderr streams like regular child processes
    // All communication must go through postMessage/on('message')
    
  } catch (error) {
    console.error('[Overlay Web Server] Error starting server:', error);
    overlayWebServerProcess = null;
  }
}

async function stopOverlayWebServer() {
  if (!overlayWebServerProcess) {
    return;
  }
  
  try {
    overlayWebServerProcess.postMessage({ type: 'stop' });
    // Wait for stop confirmation or timeout
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (overlayWebServerProcess) {
          overlayWebServerProcess.kill();
        }
        resolve();
      }, 2000);
      
      const handler = (message) => {
        if (message.type === 'stop-result') {
          clearTimeout(timeout);
          overlayWebServerProcess.removeListener('message', handler);
          overlayWebServerProcess = null;
          resolve();
        }
      };
      
      overlayWebServerProcess.on('message', handler);
    });
  } catch (error) {
    console.error('[Overlay Web Server] Error stopping server:', error);
    if (overlayWebServerProcess) {
      overlayWebServerProcess.kill();
      overlayWebServerProcess = null;
    }
  }
}

// IPC handlers for overlay web server
ipcMain.handle('overlay-web-server:start', async () => {
  await startOverlayWebServer();
  return { success: true };
});

ipcMain.handle('overlay-web-server:stop', async () => {
  await stopOverlayWebServer();
  return { success: true };
});

ipcMain.handle('overlay-web-server:status', async () => {
  return {
    running: overlayWebServerProcess !== null
  };
});

app.on('before-quit', async () => {
    // Stop overlay web server
    await stopOverlayWebServer();
    
    // Ensure databases are closed
    if (dbManager) {
        dbManager.closeAll();
    }
});

/**
 * Run startup path validation and open settings modal if needed
 */
async function runStartupValidation(mainWindow) {
    try {
        console.log('🚀 Starting startup path validation...');
        
        const validator = new StartupPathValidator(dbManager);
        const results = await validator.validateAllPaths();
        
        console.log('📊 Validation results:', results);
        
        // If critical paths are missing, open settings modal
        if (results.needsSettingsModal) {
            console.log('⚠️ Critical paths missing, opening settings modal...');
            
            // Send validation results to renderer
            mainWindow.webContents.send('startup-validation-results', results);
            
            // Open settings modal
            mainWindow.webContents.send('open-settings-modal', {
                reason: 'startup-validation',
                missingPaths: results.missingCriticalPaths,
                message: 'Critical paths need to be configured before using the application.'
            });
        } else {
            console.log('✅ All critical paths validated successfully');
        }
        
    } catch (error) {
        console.error('❌ Error during startup validation:', error);
        
        // Show error dialog
        dialog.showErrorBox(
            'Startup Validation Error',
            'An error occurred during startup validation. Please check the console for details.'
        );
    }
}
