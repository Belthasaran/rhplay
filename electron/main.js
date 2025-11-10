const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { DatabaseManager } = require('./database-manager');
const { registerDatabaseHandlers } = require('./ipc-handlers');
const StartupPathValidator = require('./startup-path-validator');

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

const CLI_RUN_FLAG = '--run-cli-script';
const cliFlagIndex = process.argv.indexOf(CLI_RUN_FLAG);
const isInstallerCli = cliFlagIndex !== -1;
logTemp(`isInstallerCli=${isInstallerCli} index=${cliFlagIndex}`);

if (isInstallerCli) {
    process.env.ELECTRON_RUN_AS_NODE = '1';
    if (app && typeof app.disableHardwareAcceleration === 'function') {
        app.disableHardwareAcceleration();
    }
    const scriptPath = process.argv[cliFlagIndex + 1];
    const scriptArgs = process.argv.slice(cliFlagIndex + 2);
    (async () => {
        try {
            if (!scriptPath) {
                throw new Error('No script path provided to --run-cli-script.');
            }
            const resolvedScript = path.resolve(scriptPath);
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

// Initialize database manager
let dbManager = null;

function createMainWindow() {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        show: false,
    });

    // Open DevTools automatically in development
    if (process.env.ELECTRON_START_URL) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.once('ready-to-show', async () => {
        mainWindow.show();
        
        // Run startup path validation
        await runStartupValidation(mainWindow);
    });

    if (process.env.ELECTRON_START_URL) {
        console.log('Loading URL:', process.env.ELECTRON_START_URL);
        mainWindow.loadURL(process.env.ELECTRON_START_URL);
        
        // Log any load errors
        mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            console.error('Failed to load:', errorCode, errorDescription);
        });
        
        // Log when loaded
        mainWindow.webContents.on('did-finish-load', () => {
            console.log('Page loaded successfully');
        });
    } else {
        // Production: Load from packaged renderer
        console.log('Production mode - looking for renderer files...');
        console.log('__dirname:', __dirname);
        console.log('process.resourcesPath:', process.resourcesPath);
        
        // Since we're unpacking renderer/dist files, they should be in app.asar.unpacked
        const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'renderer', 'dist', 'index.html');
        console.log('Loading from unpacked path:', unpackedPath);
        
        // Check if file exists
        if (require('fs').existsSync(unpackedPath)) {
            console.log('Found unpacked renderer files');
            mainWindow.loadFile(unpackedPath);
        } else {
            console.error('Unpacked renderer files not found at:', unpackedPath);
            
            // Fallback: try asar path
            const asarPath = path.join(process.resourcesPath, 'app.asar', 'electron', 'renderer', 'dist', 'index.html');
            console.log('Trying asar path:', asarPath);
            mainWindow.loadFile(asarPath);
        }
    }
    
    return mainWindow;
}

if (!isInstallerCli) {
    app.whenReady().then(async () => {
        // Initialize database manager with auto-migrations enabled for GUI mode
        try {
            console.log('Initializing database manager with auto-migrations enabled...');
            console.log('Process info:', {
                execPath: process.execPath,
                resourcesPath: process.resourcesPath,
                cwd: process.cwd(),
                __dirname: __dirname,
                isPackaged: process.env.ELECTRON_IS_PACKAGED || false
            });
            
            dbManager = new DatabaseManager({ autoApplyMigrations: true });
            console.log('Database manager initialized with auto-migrations enabled');
            
            // Register IPC handlers
            registerDatabaseHandlers(dbManager);
            console.log('IPC handlers registered');
            
            // Ensure createdfp is populated
            const { ensureCreatedFp } = require('./ipc-handlers');
            await ensureCreatedFp(dbManager);
        } catch (error) {
            console.error('Failed to initialize database:', error);
            console.error('Error stack:', error.stack);
            // Continue anyway - will show error in UI
        }

        createMainWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createMainWindow();
            }
        });
    });
}

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
