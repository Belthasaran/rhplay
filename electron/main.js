const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { DatabaseManager } = require('./database-manager');
const { registerDatabaseHandlers } = require('./ipc-handlers');
const StartupPathValidator = require('./startup-path-validator');
const { queueRhpakPath, drainRhpakQueue } = require('./rhpak-queue');

const DATABASE_FILES = ['clientdata.db', 'rhdata.db', 'patchbin.db'];
let handlersRegistered = false;
let mainWindow = null;
let currentMode = 'app';
let rhpakRendererReady = false;

function resolveLogPath() {
    const dirs = [
        process.env.TEMP,
        process.env.TMP,
        os.tmpdir(),
        path.dirname(process.execPath),
        process.cwd(),
    ].filter(Boolean);

    for (const dir of dirs) {
        try {
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
    const dir = path.join(app.getPath('temp'), 'RHTools', 'Provisioning');
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
    const userDataDir = getUserDataDir();
    return DATABASE_FILES.filter((name) => !fs.existsSync(path.join(userDataDir, name)));
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

function getOrCreateMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        return mainWindow;
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

    setupProvisionerIpc();

    try {
        const missing = getMissingDatabases();
        if (missing.length > 0) {
            await loadRendererMode('provisioner');
        } else {
            await initializeDatabaseLayer();
            await loadRendererMode('app');
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

app.on('before-quit', () => {
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
