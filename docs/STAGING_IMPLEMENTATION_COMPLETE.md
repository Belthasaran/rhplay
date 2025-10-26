# Run Staging Implementation - Complete

## Date: October 13, 2025

## Overview
Implemented the complete run staging system that prepares game files while maintaining challenge secrecy until the appropriate time.

## Key Features Implemented

### 1. Run Staging Workflow

**Stage and Save** button triggers:
1. Creates run record in database
2. Saves run plan entries
3. **Expands plan to run_results**:
   - For specific games: stores gameid and name
   - For random games: 
     - Internally selects game using seed-based selection
     - Stores actual `gameid` (needed for SFC file creation)
     - Keeps `game_name = '???'` (masked for UI)
     - Sets `revealed_early = 0`
4. **Creates SFC files**:
   - Generates unique run folder: `Run251013_0430/`
   - Patches each game using FLIPS
   - Creates numbered SFC files: `01.sfc`, `02.sfc`, etc.
   - Generates `runinfo.json` with run metadata
5. **Shows staging success modal** with:
   - Folder path display
   - "Open Folder" button
   - Conditional action buttons based on settings

### 2. Staging Progress Modal

Shows real-time progress:
- Progress bar (visual)
- Current/Total count
- Current game name being processed

### 3. Staging Success Modal

Displays after successful staging with:
- Number of games staged
- Run folder path (read-only field)
- "Open Folder" button (opens system file manager)
- **Conditional buttons** based on user settings:

#### Launch Program Option
```javascript
if (settings.launchMethod === 'program' && settings.launchProgram)
```
Shows: **🚀 Launch Game** button

#### USB2SNES Auto Upload
```javascript
if (settings.launchMethod === 'usb2snes' && settings.usb2snesUploadPref !== 'manual')
```
Shows: **📤 Upload to USB2SNES** button

#### USB2SNES Manual Transfer
```javascript
if (settings.launchMethod === 'usb2snes' && settings.usb2snesUploadPref === 'manual')
```
Shows: 
- Instructions panel with upload directory
- **✓ Manually Uploaded - Launch USB2SNES** button

### 4. Game Secrecy System

**Random games are masked until reached:**

At staging time:
- `gameid`: Actual ID stored (for file creation)
- `game_name`: '???' (masked)
- `stage_description`: NULL (masked)  
- `revealed_early`: 0

During run:
- Games show as '???' until user reaches them
- When reached, revealed with `revealed_early = 0`
- If user moves forward then uses Back button, future challenges marked `revealed_early = 1`

### 5. revealed_early Flag Logic

The `revealed_early` flag tracks if a user gained an unfair advantage:

**Normal flow (revealed_early = 0):**
1. User on Challenge 1
2. Completes Challenge 1
3. Moves to Challenge 2
4. Challenge 2 revealed normally

**Early reveal (revealed_early = 1):**
1. User on Challenge 1
2. Completes Challenge 1
3. Moves to Challenge 2 (sees it)
4. Clicks **Back** button
5. Returns to Challenge 1
6. Challenge 2 now marked `revealed_early = 1` (they've seen the future)

This flag can be used in results/statistics to indicate the run had "peeking" advantage.

## Files Modified

### Frontend
- `electron/renderer/src/App.vue`:
  - Added staging progress modal
  - Added staging success modal  
  - Conditional buttons based on settings
  - Updated `undoChallenge()` to mark future challenges as revealed early
  - Updated `skipChallenge()` to reveal normally (not early)
  - Added `stageRunGames()`, `openStagingFolder()`, placeholders for launch/upload functions

### Backend  
- `electron/ipc-handlers.js`:
  - Added `db:runs:expand-and-prepare` handler (expands plan, selects random games, keeps masked)
  - Updated `db:runs:stage-games` handler (reads from run_results, creates SFC files)
  - Updated `db:runs:start` handler (no longer expands, just activates)
  - Added `db:runs:mark-revealed-early` handler (marks challenges seen via Back button)
  - Fixed `INSERT` statements to include `revealed_early` column

### IPC Layer
- `electron/preload.js`:
  - Added `expandAndStageRun()`
  - Added `markChallengeRevealedEarly()`
  - Added `ipcRenderer` access for event listeners
  - Added `shell.openPath()` for opening folders

## Database Schema

The `run_results` table stores:
- `gameid`: Actual game ID (even for masked randoms)
- `game_name`: '???' for unrevealed, actual name when revealed
- `stage_description`: NULL for unrevealed, actual description when revealed
- `was_random`: 1 if random challenge, 0 if specific
- `revealed_early`: 0 if normal reveal, 1 if seen via Back button

## Testing Notes

To test the complete flow:
1. Create a run with random games (count > 1 to test expansion)
2. Click "Stage and Save"
3. Enter run name
4. Watch staging progress modal
5. Verify staging success modal shows:
   - Correct folder path
   - Correct game count
   - Appropriate buttons for your settings
6. Click "Open Folder" to verify SFC files exist
7. Click "Start Run"
8. Verify random games show as "???"
9. Complete/skip challenges to move forward
10. Use "Back" button
11. Verify challenges you've seen are now marked `revealed_early`

## Future Work (Placeholders Created)

Functions created but not yet implemented:
- `launchGameProgram()`: Launch configured emulator/program with first SFC
- `uploadToUsb2Snes()`: Auto-upload run folder via USB2SNES websocket
- `manuallyUploadedConfirm()`: Launch USB2SNES after manual upload confirmation

These will be implemented in a future phase.

## Summary

The staging system now:
✅ Selects all random games during staging (for SFC file creation)
✅ Keeps random games masked in UI until reached
✅ Creates SFC files in uniquely named run folders
✅ Shows progress and success modals
✅ Provides conditional action buttons based on settings
✅ Tracks `revealed_early` for competitive integrity
✅ Maintains game secrecy while enabling file preparation

The implementation satisfies all requirements for preparing run files while maintaining challenge secrecy and tracking any competitive advantages gained through the Back button.

