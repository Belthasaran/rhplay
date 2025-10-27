const { app, BrowserWindow } = require('electron');
const path = require('path');
const { DatabaseManager } = require('./database-manager');
const { registerDatabaseHandlers } = require('./ipc-handlers');

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

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
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
        
        // Try multiple possible paths for the renderer files
        const possiblePaths = [
            path.join(__dirname, 'renderer', 'dist', 'index.html'),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'renderer', 'dist', 'index.html'),
            path.join(process.resourcesPath, 'electron', 'renderer', 'dist', 'index.html'),
            path.join(__dirname, '..', 'electron', 'renderer', 'dist', 'index.html')
        ];
        
        let foundPath = null;
        for (const testPath of possiblePaths) {
            console.log('Checking path:', testPath);
            if (require('fs').existsSync(testPath)) {
                console.log('Found renderer at:', testPath);
                foundPath = testPath;
                break;
            }
        }
        
        if (foundPath) {
            mainWindow.loadFile(foundPath);
        } else {
            console.error('Could not find renderer index.html in any expected location');
            // Fallback: try to load from asar directly
            const asarPath = path.join(process.resourcesPath, 'app.asar', 'electron', 'renderer', 'dist', 'index.html');
            console.log('Trying asar path:', asarPath);
            mainWindow.loadFile(asarPath);
        }
    }
    
    return mainWindow;
}

app.whenReady().then(() => {
    // Initialize database manager
    try {
        dbManager = new DatabaseManager();
        console.log('Database manager initialized');
        
        // Register IPC handlers
        registerDatabaseHandlers(dbManager);
        console.log('IPC handlers registered');
    } catch (error) {
        console.error('Failed to initialize database:', error);
        // Continue anyway - will show error in UI
    }

    createMainWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
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
