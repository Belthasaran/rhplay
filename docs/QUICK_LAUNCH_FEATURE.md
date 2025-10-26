# Quick Launch Feature Implementation

## Date: October 13, 2025

## Overview
Implemented the "Start" button functionality in the main GUI that allows users to quickly stage and launch games (1-21 at a time) without creating a run. This provides a streamlined workflow for players who want to try specific games directly.

## Key Features Implemented

### 1. Start Button Enhancement
- **Previous behavior**: Disabled unless exactly 1 game selected
- **New behavior**: Enabled when 1-21 games are selected
- Provides immediate feedback if user selects 0 or >21 games

### 2. Temporary Directory Override Setting
Added optional setting in Settings dialog to override the base path for temporary directories:
- **Setting name**: `tempDirOverride`
- **Default**: Uses OS-specific temp directory (`os.tmpdir()`)
- **Validation**: Ensures path exists and is a directory before saving
- **Storage**: Saved in `csettings` table as `tempDirOverride` and `tempDirValid`

### 3. Quick Launch Staging Process

#### File Organization
Files are staged in: `<temp_base>/RHTools-QuickLaunch/`
- SFC files: `smw<GAMEID>_<VERSION>.sfc`
- Metadata files: `md<GAMEID>_<VERSION>.json`

#### Staging Workflow
1. User selects 1-21 games in main view
2. Clicks "Start" button
3. System validates settings (vanilla ROM, FLIPS)
4. Progress modal displays real-time staging progress
5. For each selected game:
   - Retrieves latest version from database
   - Extracts and decodes patchblob from patchbin.db
   - Applies patch using FLIPS to create SFC file
   - Saves game metadata as JSON file
6. Success modal displays with:
   - Number of games staged
   - Folder path (with "Open Folder" button)
   - Launch instructions

### 4. Progress Tracking
**Quick Launch Progress Modal** shows:
- Visual progress bar
- Current/Total count (e.g., "3 / 5")
- Current game being processed

### 5. Success Modal
**Quick Launch Success Modal** provides:
- Count of successfully staged games
- Folder path with button to open in file manager
- Step-by-step launch instructions:
  1. Navigate to folder
  2. Find SFC file(s)
  3. Load in emulator/device
  4. Check JSON for metadata
- Tip to configure launch program in Settings

## Technical Implementation

### Frontend (App.vue)
- Added `canStartGames` computed property (checks 1-21 selections)
- Implemented `startSelected()` async function
- Added progress/success modal states and UI components
- Added `tempDirOverride` to settings reactive object
- Added path validation in `saveSettings()`
- Added CSS styling for launch instructions panel

### Backend (game-stager.js)
- Created `getQuickLaunchBasePath(tempDirOverride)` function
- Implemented `stageQuickLaunchGames()` function:
  - Accepts array of game IDs
  - Retrieves latest version for each game from `gameversions` table in `rhdata.db`
  - Creates SFC and JSON files
  - Provides progress callbacks
  - Returns success/error with folder path

**Note on Schema**: The `gameversions` table in `rhdata.db` contains all game information including the game name - there is no separate `games` table.

### IPC Layer
- **New channel**: `db:games:quick-launch-stage`
- **Handler**: In `ipc-handlers.js` - calls `gameStager.stageQuickLaunchGames()`
- **Progress events**: `quick-launch-progress` sent to renderer
- **Preload**: Exposed as `stageQuickLaunchGames()` method

### Path Validation
- **New channel**: `file:validate-path`
- **Handler**: Checks if path exists and is a directory
- **Preload**: Exposed as `validatePath()` method

## Files Modified

1. **electron/renderer/src/App.vue**
   - Updated Start button disabled condition
   - Added `canStartGames` computed property
   - Implemented `startSelected()` function
   - Added quick launch modal states and components
   - Added `tempDirOverride` setting with validation
   - Added CSS styling for launch instructions

2. **electron/game-stager.js**
   - Updated `getStagingBasePath()` to accept `tempDirOverride`
   - Added `getQuickLaunchBasePath()` function
   - Implemented `stageQuickLaunchGames()` function
   - Exported new functions in module.exports

3. **electron/ipc-handlers.js**
   - Added `db:games:quick-launch-stage` handler
   - Added `file:validate-path` handler

4. **electron/preload.js**
   - Exposed `stageQuickLaunchGames()` IPC method
   - Exposed `validatePath()` IPC method

## Usage Flow

### For Users
1. Open RHTools Electron GUI
2. Filter/search for desired games
3. Select 1-21 games using checkboxes
4. Click "Start" button in top-right toolbar
5. Wait for staging progress (shows progress bar)
6. View success modal with folder location
7. Click "Open Folder" button or navigate manually
8. Load `smw<GAMEID>_<VERSION>.sfc` in emulator
9. Optionally check `md<GAMEID>_<VERSION>.json` for game info

### For Developers
```javascript
// Quick launch staging API
const result = await window.electronAPI.stageQuickLaunchGames({
  gameIds: ['12345', '67890'],
  vanillaRomPath: '/path/to/smw.sfc',
  flipsPath: '/path/to/flips',
  tempDirOverride: '/custom/temp/dir'  // Optional
});

// Returns:
// {
//   success: true,
//   folderPath: '/tmp/RHTools-QuickLaunch',
//   gamesStaged: 2
// }

// JSON metadata file format (md<GAMEID>_<VERSION>.json):
// {
//   gameid: string,
//   version: number,
//   name: string,
//   authors: string,
//   author: string,
//   gametype: string,
//   length: string,
//   difficulty: string,
//   demo: string,
//   featured: string,
//   description: string,
//   added: string,
//   moderated: string,
//   staged_at: string (ISO timestamp),
//   sfc_file: string (filename)
// }
```

## Validation & Error Handling
- Validates 1-21 game selection range
- Checks vanilla ROM and FLIPS are configured
- Validates custom temp directory if specified
- Shows specific error messages for each failure case
- Continues staging remaining games if one fails
- Reports partial success with error details

## Future Enhancements
- Auto-launch games with configured launch program
- Support for USB2SNES upload integration
- Batch operations (e.g., "Stage all filtered games")
- Remember last staged games for quick re-launch
- Integration with external emulator frontends

## Testing Notes
To test the complete flow:
1. Ensure vanilla ROM and FLIPS are configured in Settings
2. Select 1-21 games from the main list
3. Click "Start" button
4. Verify progress modal shows correct information
5. Verify success modal displays folder path
6. Click "Open Folder" and verify files exist
7. Test with custom temp directory override setting
8. Test error cases (no ROM, no FLIPS, >21 selections)

