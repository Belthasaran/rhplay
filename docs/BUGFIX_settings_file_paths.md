# Bug Fix: Settings File Paths Not Being Saved/Loaded

**Date**: October 13, 2025  
**Issue**: Vanilla ROM path configured in database wasn't being used, Browse buttons and drag/drop weren't implemented  
**Status**: ✅ **FIXED**

---

## Problem

When clicking "Stage and Save" in the Prepare RSun Dialog, the error "Vanilla ROM not found. Please configure in Settings" appeared even though the `vanillaRomPath` was correctly set in the `csettings` table of `clientdata.db`.

Investigation revealed multiple issues:

1. **Missing Path Properties**: The settings object only had validation flags (`vanillaRomValid`, `flipsValid`, etc.) but not the actual file paths (`vanillaRomPath`, `flipsPath`, etc.)

2. **Not Loading Paths**: The `loadSettings()` function wasn't loading the file paths from the database

3. **Not Saving Paths**: The `saveSettings()` function wasn't saving the file paths to the database

4. **Browse/Drag-Drop Not Implemented**: All Browse button and drag/drop handlers were TODO placeholders

5. **Wrong Property Name**: `stageRunGames()` was trying to access `settings.romPath` instead of `settings.vanillaRomPath`

---

## Solution

### 1. Added File Path Properties to Settings Object

**File**: `electron/renderer/src/App.vue`

Updated the settings reactive object to include path properties:

```typescript
const settings = reactive({
  vanillaRomPath: '',
  vanillaRomValid: false,
  flipsPath: '',
  flipsValid: false,
  asarPath: '',
  asarValid: false,
  uberAsmPath: '',
  uberAsmValid: false,
  // ... other settings
});
```

### 2. Updated loadSettings() to Load File Paths

Modified `loadSettings()` to load the path values from the database:

```typescript
if (savedSettings.vanillaRomPath) settings.vanillaRomPath = savedSettings.vanillaRomPath;
if (savedSettings.flipsPath) settings.flipsPath = savedSettings.flipsPath;
if (savedSettings.asarPath) settings.asarPath = savedSettings.asarPath;
if (savedSettings.uberAsmPath) settings.uberAsmPath = savedSettings.uberAsmPath;
```

### 3. Updated saveSettings() to Save File Paths

Modified `saveSettings()` to include the path values when saving:

```typescript
const settingsToSave = {
  vanillaRomPath: settings.vanillaRomPath,
  vanillaRomValid: String(settings.vanillaRomValid),
  flipsPath: settings.flipsPath,
  flipsValid: String(settings.flipsValid),
  // ... etc
};
```

### 4. Added IPC Handlers for File Selection and Validation

**File**: `electron/ipc-handlers.js`

Added new IPC handlers:

- `file:select` - Opens native file selection dialog
- `file:validate-rom` - Validates ROM file with SHA-224 hash check
- `file:validate-flips` - Validates FLIPS executable
- `file:validate-asar` - Validates ASAR executable  
- `file:validate-uberasm` - Validates UberASM executable

**File**: `electron/preload.js`

Exposed the new APIs to the renderer:

```javascript
selectFile: (options) => ipcRenderer.invoke('file:select', options),
validateRomFile: (filePath) => ipcRenderer.invoke('file:validate-rom', { filePath }),
validateFlipsFile: (filePath) => ipcRenderer.invoke('file:validate-flips', { filePath }),
// ... etc
```

### 5. Implemented Browse Button Handlers

**File**: `electron/renderer/src/App.vue`

Implemented all Browse button handlers:

- `browseRomFile()` - Opens file dialog for ROM selection
- `browseFlipsFile()` - Opens file dialog for FLIPS selection
- `browseAsarFile()` - Opens file dialog for ASAR selection
- `browseUberAsmFile()` - Opens file dialog for UberASM selection

Each handler:
1. Opens a native file selection dialog with appropriate filters
2. Validates the selected file via IPC
3. Updates the settings object with the path and validation status
4. Shows error messages if validation fails

### 6. Implemented Drag/Drop Handlers

Implemented drag/drop handlers for all file types:

- `handleRomDrop()` - Handles ROM file drops
- `handleFlipsDrop()` - Handles FLIPS file drops
- `handleAsarDrop()` - Handles ASAR file drops
- `handleUberAsmDrop()` - Handles UberASM file drops

Each handler extracts the file path and validates it using the same validation functions.

### 7. Fixed stageRunGames() Property Access

Changed the property name from `settings.romPath` to `settings.vanillaRomPath`:

```typescript
const stagingResult = await (window as any).electronAPI.stageRunGames({
  runUuid,
  vanillaRomPath: settings.vanillaRomPath,  // Fixed property name
  flipsPath: settings.flipsPath
});
```

### 8. Added UI Display for Current Paths

Added display of currently configured paths in the Settings dialog:

```html
<div v-if="settings.vanillaRomPath" class="setting-current-path">
  Current: <code>{{ settings.vanillaRomPath }}</code>
</div>
```

Added CSS styling to make the current path display visually distinct (green color with light green background).

---

## Validation

The ROM validation uses SHA-224 hash checking to ensure the file is a valid vanilla SMW ROM:

```javascript
const EXPECTED_SHA224 = 'fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08';
```

For executables (FLIPS, ASAR, UberASM), the validation checks:
- File exists
- File is executable (Unix permissions or .exe extension on Windows)

---

## How to Use

1. **Open Settings Dialog**: Click the Settings button in the toolbar

2. **Configure Vanilla ROM**:
   - Click "Browse" to select your SMW ROM file, OR
   - Drag and drop the ROM file onto the drop zone
   - The system will validate the ROM's SHA-224 hash
   - A green checkmark (✓) will appear if valid
   - The current path will be displayed below the controls

3. **Configure FLIPS**: Same process as ROM

4. **Configure ASAR**: Same process as ROM (optional)

5. **Configure UberASM**: Same process as ROM (optional)

6. **Save Changes**: Click "Save Changes and Close"

All settings are now properly saved to the `csettings` table in `clientdata.db` and will be loaded when you restart the application.

---

## Technical Details

### Database Storage

All settings are stored in the `csettings` table:

```sql
CREATE TABLE csettings (
    csettinguid VARCHAR(255) PRIMARY KEY,
    csetting_name VARCHAR(255) UNIQUE,
    csetting_value TEXT NOT NULL,
    csetting_binary BLOB
);
```

Example records:
- `csetting_name = 'vanillaRomPath'`, `csetting_value = '/home/main/proj/rhtools/smw.sfc'`
- `csetting_name = 'vanillaRomValid'`, `csetting_value = 'true'`

### File Path Priority

When staging a run, the system now correctly uses:
1. Settings loaded from the database at startup
2. Updated via Settings dialog Browse/drag-drop
3. Saved back to database when "Save Changes" is clicked

---

## Files Modified

1. `electron/renderer/src/App.vue` - Settings object, load/save functions, Browse/drag-drop handlers, UI display
2. `electron/ipc-handlers.js` - File selection and validation IPC handlers
3. `electron/preload.js` - Exposed file selection APIs to renderer

