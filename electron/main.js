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
