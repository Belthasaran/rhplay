# Electron App Database Integration Plan

**Date**: October 12, 2025  
**Status**: Ready for Implementation  
**Phase**: 2 - Database Integration

---

## Overview

This document outlines the complete plan for integrating the SQLite databases (rhdata.db, patchbin.db, clientdata.db) with the Electron app using IPC (Inter-Process Communication) for cross-platform compatibility.

---

## Architecture

### Multi-Process Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Electron Application                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────┐         ┌────────────────────────┐ │
│  │   Renderer Process  │         │    Main Process        │ │
│  │   (Vue.js App)      │◄────────┤    (Node.js)           │ │
│  │                     │   IPC   │                        │ │
│  │  - UI Components    │         │  - Database Access     │ │
│  │  - User Interactions│         │  - Business Logic      │ │
│  │  - Display Logic    │         │  - File System         │ │
│  └─────────────────────┘         └────────────────────────┘ │
│           ▲                               │                  │
│           │                               ▼                  │
│           │                      ┌─────────────────┐        │
│           │                      │  better-sqlite3 │        │
│           │                      └─────────────────┘        │
│           │                               │                  │
│           └───────────────────────────────┤                  │
│                                           ▼                  │
│                                  ┌─────────────────┐        │
│                                  │  SQLite Files   │        │
│                                  │  - rhdata.db    │        │
│                                  │  - patchbin.db  │        │
│                                  │  - clientdata.db│        │
│                                  └─────────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

### Why This Architecture?

1. **Security**: Renderer process is sandboxed, no direct file system access
2. **Performance**: Database operations run in main process (Node.js)
3. **Portability**: Works consistently across Windows, Linux, macOS
4. **Stability**: Database connections managed in main process

---

## Database Locations

### Cross-Platform Paths

```javascript
// main.js
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function getDatabasePaths() {
  const isProduction = !process.env.ELECTRON_START_URL;
  
  if (isProduction) {
    // Production: Use ProgramData (Windows) or app data directory
    const appDataPath = app.getPath('userData');
    
    return {
      rhdata: path.join(appDataPath, 'rhdata.db'),
      patchbin: path.join(appDataPath, 'patchbin.db'),
      clientdata: path.join(appDataPath, 'clientdata.db'),
    };
  } else {
    // Development: Use electron/ directory
    const electronDir = path.join(__dirname);
    
    return {
      rhdata: path.join(electronDir, 'rhdata.db'),
      patchbin: path.join(electronDir, 'patchbin.db'),
      clientdata: path.join(electronDir, 'clientdata.db'),
    };
  }
}

// Platform-specific paths:
// Windows: C:\Users\<User>\AppData\Roaming\rhtools\
// Linux: ~/.config/rhtools/
// macOS: ~/Library/Application Support/rhtools/
```

### Environment Variable Override

```javascript
function getDatabasePaths() {
  const appDataPath = app.getPath('userData');
  
  return {
    rhdata: process.env.RHDATA_DB_PATH || 
            path.join(appDataPath, 'rhdata.db'),
    patchbin: process.env.PATCHBIN_DB_PATH || 
              path.join(appDataPath, 'patchbin.db'),
    clientdata: process.env.CLIENTDATA_DB_PATH || 
                path.join(appDataPath, 'clientdata.db'),
  };
}
```

---

## IPC Communication Pattern

### Channel Naming Convention

```
Format: 'db:<database>:<operation>:<entity>'

Examples:
- db:rhdata:get:games
- db:rhdata:get:game
- db:rhdata:get:versions
- db:clientdata:get:annotation
- db:clientdata:set:annotation
- db:clientdata:get:stages
- db:settings:get:all
- db:settings:set:value
```

### Request/Response Flow

```javascript
// Renderer Process (Vue component)
async function loadGames() {
  const games = await window.electronAPI.getGames();
  // Use games in UI
}

// Preload Script (preload.js)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getGames: () => ipcRenderer.invoke('db:rhdata:get:games'),
  getGame: (gameid, version) => 
    ipcRenderer.invoke('db:rhdata:get:game', { gameid, version }),
  // ... more API methods
});

// Main Process (main.js)
const { ipcMain } = require('electron');

ipcMain.handle('db:rhdata:get:games', async (event) => {
  const db = getDatabaseConnection('rhdata');
  const games = db.prepare(`
    SELECT 
      gameid, name, author, difficulty, combinedtype, version,
      local_runexcluded
    FROM gameversions
    WHERE version = (
      SELECT MAX(version) 
      FROM gameversions gv2 
      WHERE gv2.gameid = gameversions.gameid
    )
    ORDER BY name
  `).all();
  return games;
});
```

---

## Implementation Plan

### Step 1: Setup Database Manager (main.js)

```javascript
const Database = require('better-sqlite3');

class DatabaseManager {
  constructor() {
    this.connections = {};
    this.paths = getDatabasePaths();
  }
  
  getConnection(dbName) {
    if (!this.connections[dbName]) {
      const dbPath = this.paths[dbName];
      
      // Ensure database file exists
      this.ensureDatabaseExists(dbName, dbPath);
      
      // Create connection
      this.connections[dbName] = new Database(dbPath);
      this.connections[dbName].pragma('journal_mode = WAL');
    }
    
    return this.connections[dbName];
  }
  
  ensureDatabaseExists(dbName, dbPath) {
    if (!fs.existsSync(dbPath)) {
      console.log(`Creating ${dbName} at ${dbPath}`);
      
      // Create empty database
      const db = new Database(dbPath);
      
      // Apply schema
      const schemaPath = path.join(__dirname, 'sql', `${dbName}.sql`);
      if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf8');
        db.exec(schema);
      }
      
      db.close();
    }
  }
  
  closeAll() {
    Object.values(this.connections).forEach(db => db.close());
    this.connections = {};
  }
}

const dbManager = new DatabaseManager();
```

### Step 2: Define IPC Handlers

Create a new file: `electron/ipc-handlers.js`

```javascript
const { ipcMain } = require('electron');

function registerDatabaseHandlers(dbManager) {
  // =========================================================================
  // Game Data Operations (rhdata.db)
  // =========================================================================
  
  // Get all games (latest versions only)
  ipcMain.handle('db:rhdata:get:games', async () => {
    const db = dbManager.getConnection('rhdata');
    const clientDb = dbManager.getConnection('clientdata');
    
    // Attach clientdata for JOIN
    db.exec(`ATTACH DATABASE '${clientDb.name}' AS clientdata`);
    
    const games = db.prepare(`
      SELECT 
        gv.gameid as id,
        gv.name,
        gv.author,
        gv.length,
        gv.combinedtype as type,
        gv.legacy_type as legacyType,
        gv.difficulty as publicDifficulty,
        gv.version as currentVersion,
        gv.local_runexcluded as localRunExcluded,
        gv.gvjsondata as jsonData,
        COALESCE(uga.status, 'Default') as status,
        uga.user_difficulty_rating as myDifficultyRating,
        uga.user_review_rating as myReviewRating,
        COALESCE(uga.hidden, 0) as hidden,
        COALESCE(uga.exclude_from_random, 0) as excludeFromRandom,
        uga.user_notes as mynotes
      FROM gameversions gv
      LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
      WHERE gv.removed = 0
        AND gv.version = (
          SELECT MAX(version) FROM gameversions gv2 
          WHERE gv2.gameid = gv.gameid
        )
      ORDER BY gv.name
    `).all();
    
    db.exec('DETACH DATABASE clientdata');
    
    // Parse JSON data
    return games.map(g => ({
      ...g,
      jsonData: g.jsonData ? JSON.parse(g.jsonData) : null,
      hidden: Boolean(g.hidden),
      excludeFromRandom: Boolean(g.excludeFromRandom),
      localRunExcluded: Boolean(g.localRunExcluded),
    }));
  });
  
  // Get all versions of a specific game
  ipcMain.handle('db:rhdata:get:versions', async (event, { gameid }) => {
    const db = dbManager.getConnection('rhdata');
    
    const versions = db.prepare(`
      SELECT DISTINCT version 
      FROM gameversions 
      WHERE gameid = ?
      ORDER BY version DESC
    `).all(gameid);
    
    return versions.map(v => v.version);
  });
  
  // Get specific game version
  ipcMain.handle('db:rhdata:get:game', async (event, { gameid, version }) => {
    const db = dbManager.getConnection('rhdata');
    const clientDb = dbManager.getConnection('clientdata');
    
    db.exec(`ATTACH DATABASE '${clientDb.name}' AS clientdata`);
    
    const game = db.prepare(`
      SELECT 
        gv.gameid as id,
        gv.name,
        gv.author,
        gv.length,
        gv.combinedtype as type,
        gv.legacy_type as legacyType,
        gv.difficulty as publicDifficulty,
        gv.version as currentVersion,
        gv.gvjsondata as jsonData,
        -- Check for version-specific annotation first
        COALESCE(ugva.status, uga.status, 'Default') as status,
        COALESCE(ugva.user_difficulty_rating, uga.user_difficulty_rating) as myDifficultyRating,
        COALESCE(ugva.user_review_rating, uga.user_review_rating) as myReviewRating,
        COALESCE(uga.hidden, 0) as hidden,
        COALESCE(uga.exclude_from_random, 0) as excludeFromRandom,
        COALESCE(ugva.user_notes, uga.user_notes) as mynotes
      FROM gameversions gv
      LEFT JOIN clientdata.user_game_annotations uga ON gv.gameid = uga.gameid
      LEFT JOIN clientdata.user_game_version_annotations ugva 
        ON gv.gameid = ugva.gameid AND gv.version = ugva.version
      WHERE gv.gameid = ? AND gv.version = ?
    `).get(gameid, version);
    
    db.exec('DETACH DATABASE clientdata');
    
    if (!game) return null;
    
    return {
      ...game,
      jsonData: game.jsonData ? JSON.parse(game.jsonData) : null,
      hidden: Boolean(game.hidden),
      excludeFromRandom: Boolean(game.excludeFromRandom),
    };
  });
  
  // =========================================================================
  // User Annotation Operations (clientdata.db)
  // =========================================================================
  
  // Save game annotation
  ipcMain.handle('db:clientdata:set:annotation', async (event, annotation) => {
    const db = dbManager.getConnection('clientdata');
    
    const {
      gameid,
      status,
      myDifficultyRating,
      myReviewRating,
      hidden,
      excludeFromRandom,
      mynotes
    } = annotation;
    
    db.prepare(`
      INSERT OR REPLACE INTO user_game_annotations
        (gameid, status, user_difficulty_rating, user_review_rating, 
         hidden, exclude_from_random, user_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      gameid,
      status,
      myDifficultyRating,
      myReviewRating,
      hidden ? 1 : 0,
      excludeFromRandom ? 1 : 0,
      mynotes
    );
    
    return { success: true };
  });
  
  // Save version-specific annotation
  ipcMain.handle('db:clientdata:set:version-annotation', async (event, annotation) => {
    const db = dbManager.getConnection('clientdata');
    
    const {
      gameid,
      version,
      status,
      myDifficultyRating,
      myReviewRating,
      mynotes
    } = annotation;
    
    const annotationKey = `${gameid}-${version}`;
    
    db.prepare(`
      INSERT OR REPLACE INTO user_game_version_annotations
        (annotation_key, gameid, version, status, 
         user_difficulty_rating, user_review_rating, user_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      annotationKey,
      gameid,
      version,
      status,
      myDifficultyRating,
      myReviewRating,
      mynotes
    );
    
    return { success: true };
  });
  
  // Get stages for a game
  ipcMain.handle('db:clientdata:get:stages', async (event, { gameid }) => {
    const db = dbManager.getConnection('clientdata');
    
    const stages = db.prepare(`
      SELECT 
        gs.stage_key as key,
        gs.gameid as parentId,
        gs.exit_number as exitNumber,
        gs.description,
        gs.public_rating as publicRating,
        usa.user_difficulty_rating as myDifficultyRating,
        usa.user_review_rating as myReviewRating,
        usa.user_notes as myNotes
      FROM game_stages gs
      LEFT JOIN user_stage_annotations usa ON gs.stage_key = usa.stage_key
      WHERE gs.gameid = ?
      ORDER BY gs.exit_number
    `).all(gameid);
    
    return stages;
  });
  
  // Save stage annotation
  ipcMain.handle('db:clientdata:set:stage-annotation', async (event, annotation) => {
    const db = dbManager.getConnection('clientdata');
    
    const {
      gameid,
      exitNumber,
      myDifficultyRating,
      myReviewRating,
      myNotes
    } = annotation;
    
    const stageKey = `${gameid}-${exitNumber}`;
    
    db.prepare(`
      INSERT OR REPLACE INTO user_stage_annotations
        (stage_key, gameid, exit_number, user_difficulty_rating, 
         user_review_rating, user_notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      stageKey,
      gameid,
      exitNumber,
      myDifficultyRating,
      myReviewRating,
      myNotes
    );
    
    return { success: true };
  });
  
  // =========================================================================
  // Settings Operations (clientdata.db csettings table)
  // =========================================================================
  
  // Get all settings
  ipcMain.handle('db:settings:get:all', async () => {
    const db = dbManager.getConnection('clientdata');
    
    const rows = db.prepare(`
      SELECT csetting_name, csetting_value
      FROM csettings
    `).all();
    
    // Convert to object
    const settings = {};
    rows.forEach(row => {
      settings[row.csetting_name] = row.csetting_value;
    });
    
    return settings;
  });
  
  // Set a setting
  ipcMain.handle('db:settings:set:value', async (event, { name, value }) => {
    const db = dbManager.getConnection('clientdata');
    
    const uuid = require('crypto').randomUUID();
    
    db.prepare(`
      INSERT OR REPLACE INTO csettings (csettinguid, csetting_name, csetting_value)
      VALUES (?, ?, ?)
    `).run(uuid, name, value);
    
    return { success: true };
  });
  
  // Set multiple settings
  ipcMain.handle('db:settings:set:bulk', async (event, { settings }) => {
    const db = dbManager.getConnection('clientdata');
    
    const transaction = db.transaction((settingsObj) => {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO csettings (csettinguid, csetting_name, csetting_value)
        VALUES (?, ?, ?)
      `);
      
      Object.entries(settingsObj).forEach(([name, value]) => {
        const uuid = require('crypto').randomUUID();
        stmt.run(uuid, name, value);
      });
    });
    
    transaction(settings);
    
    return { success: true };
  });
}

module.exports = { registerDatabaseHandlers };
```

### Step 3: Update preload.js

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Game data
  getGames: () => ipcRenderer.invoke('db:rhdata:get:games'),
  getGame: (gameid, version) => 
    ipcRenderer.invoke('db:rhdata:get:game', { gameid, version }),
  getVersions: (gameid) => 
    ipcRenderer.invoke('db:rhdata:get:versions', { gameid }),
  
  // User annotations
  saveAnnotation: (annotation) => 
    ipcRenderer.invoke('db:clientdata:set:annotation', annotation),
  saveVersionAnnotation: (annotation) => 
    ipcRenderer.invoke('db:clientdata:set:version-annotation', annotation),
  
  // Stages
  getStages: (gameid) => 
    ipcRenderer.invoke('db:clientdata:get:stages', { gameid }),
  saveStageAnnotation: (annotation) => 
    ipcRenderer.invoke('db:clientdata:set:stage-annotation', annotation),
  
  // Settings
  getSettings: () => ipcRenderer.invoke('db:settings:get:all'),
  setSetting: (name, value) => 
    ipcRenderer.invoke('db:settings:set:value', { name, value }),
  saveSettings: (settings) => 
    ipcRenderer.invoke('db:settings:set:bulk', { settings }),
});
```

### Step 4: Update main.js

```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerDatabaseHandlers } = require('./ipc-handlers');

// Create database manager
const Database = require('better-sqlite3');
const fs = require('fs');

class DatabaseManager {
  // ... (implementation from Step 1)
}

const dbManager = new DatabaseManager();

// Register IPC handlers
registerDatabaseHandlers(dbManager);

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

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (process.env.ELECTRON_START_URL) {
    mainWindow.loadURL(process.env.ELECTRON_START_URL);
  } else {
    const prodIndex = path.join(__dirname, 'renderer', 'dist', 'index.html');
    mainWindow.loadFile(prodIndex);
  }
}

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  dbManager.closeAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

### Step 5: Update App.vue to use electronAPI

Replace dummy data with database calls:

```javascript
// Instead of:
const items = reactive<Item[]>([...]);

// Use:
const items = reactive<Item[]>([]);

async function loadGames() {
  try {
    const games = await window.electronAPI.getGames();
    items.splice(0, items.length, ...games);
  } catch (error) {
    console.error('Failed to load games:', error);
  }
}

// Call on mount
import { onMounted } from 'vue';
onMounted(async () => {
  await loadGames();
  await loadSettings();
});

// Watch for changes and save
import { watch } from 'vue';
watch(selectedItem, async (newVal, oldVal) => {
  if (oldVal && newVal && oldVal.Id === newVal.Id) {
    // Item was modified, save to database
    await window.electronAPI.saveAnnotation(newVal);
  }
}, { deep: true });
```

---

## Error Handling

```javascript
// In IPC handlers
ipcMain.handle('db:rhdata:get:games', async () => {
  try {
    const db = dbManager.getConnection('rhdata');
    const games = db.prepare(query).all();
    return { success: true, data: games };
  } catch (error) {
    console.error('Database error:', error);
    return { success: false, error: error.message };
  }
});

// In renderer
async function loadGames() {
  const result = await window.electronAPI.getGames();
  if (result.success) {
    items.splice(0, items.length, ...result.data);
  } else {
    alert(`Error loading games: ${result.error}`);
  }
}
```

---

## Testing Plan

### Unit Tests

1. Test database manager initialization
2. Test IPC handler responses
3. Test error handling

### Integration Tests

1. Test game loading from rhdata.db
2. Test annotation saving to clientdata.db
3. Test settings persistence
4. Test cross-database queries

### Manual Testing Checklist

- [ ] Fresh install creates databases
- [ ] Games load correctly
- [ ] Annotations save and persist
- [ ] Version switching works
- [ ] Settings save and load
- [ ] Stage annotations work
- [ ] Cross-platform paths work

---

## Performance Considerations

1. **Connection Pooling**: Single connection per database, reused
2. **WAL Mode**: `PRAGMA journal_mode = WAL` for better concurrency
3. **Prepared Statements**: Reuse for repeated queries
4. **Batch Operations**: Use transactions for multiple writes
5. **Lazy Loading**: Load stages only when needed

---

## Security Considerations

1. **No SQL Injection**: Use prepared statements exclusively
2. **Context Isolation**: Renderer has no direct database access
3. **Preload Whitelist**: Only expose necessary API methods
4. **Input Validation**: Validate all inputs in main process

---

## Migration Path

When schema changes:

1. Detect schema version on startup
2. Apply migrations in main process
3. Use transaction for safety
4. Backup before migration

```javascript
function applyMigrations(db, currentVersion, targetVersion) {
  for (let v = currentVersion + 1; v <= targetVersion; v++) {
    const migrationPath = path.join(__dirname, 'sql', 'migrations', `${String(v).padStart(3, '0')}_*.sql`);
    const migrationFile = fs.readdirSync(path.dirname(migrationPath))
      .find(f => f.startsWith(String(v).padStart(3, '0')));
    
    if (migrationFile) {
      const migration = fs.readFileSync(path.join(path.dirname(migrationPath), migrationFile), 'utf8');
      db.exec(migration);
    }
  }
}
```

---

## Next Steps

1. Implement DatabaseManager class
2. Create ipc-handlers.js
3. Update preload.js
4. Update main.js
5. Refactor App.vue to use electronAPI
6. Test on all platforms
7. Create installer packages

---

*Last Updated: October 12, 2025*  
*Status: Ready for Implementation*

