# Software Update System

**Date**: 2026-02-09  
**Status**: ✅ **COMPLETE**  
**Purpose**: Implement comprehensive software update system with blocking startup check, secure download/verification, and automatic launch of new versions

---

## Overview

The software update system provides automatic update checking at application startup with a blocking dialog that requires user response before the app continues. It also provides manual update checking via the Profile dropdown menu. The system ensures security through signature verification of `coremanifest.dat` and SHA256 verification of downloaded files.

---

## Architecture

### Flow Diagram

```
App Startup
    ↓
Check for Updates (blocking)
    ↓
Update Available?
    ├─ No → Continue normal startup
    └─ Yes → Check if new version file exists locally
              ├─ Exists + SHA256 matches → Show "Old version running" dialog
              │                              ├─ "Exit now" → Exit app
              │                              └─ "Launch old version anyway" → Continue with old version
              └─ Not present → Show update dialog (blocking)
                    ↓
              User Response Required
                    ├─ No → Continue with old version
                    └─ Yes → Verify coremanifest.dat signature
                              → Download new version
                              → Verify SHA256
                              → Move to same directory
                              → Re-verify everything
                              → Launch new version executable
                              → Exit current process
```

---

## Components

### 1. Software Update Manager (`electron/utils/software-update-manager.js`)

Core logic for software updates.

**Key Functions**:
- `checkForUpdate()` - Check if update available (reuses `checkForSoftwareUpdate`)
- `checkLocalVersionExists(entry)` - Check if new version file exists in same directory as `process.execPath`
- `verifyLocalVersionSHA256(filePath, expectedSHA256)` - Verify local file matches expected hash
- `verifyCoreManifestSignature()` - Ensure we're using signed `coremanifest.dat` (not tampered JSON)
- `downloadUpdate(entry, progressCallback)` - Download using catalog-download-manager logic
- `moveUpdateToTarget(downloadedPath, targetPath)` - Move downloaded file to same directory as running executable
- `launchNewVersion(newExecutablePath)` - Launch new version executable and exit current process
- `performUpdate(entry, progressCallback)` - Complete update flow with all verifications
- `formatTimestamp(timestamp)` - Format Unix timestamp to readable date
- `getIPFSGateways()` - Return list of IPFS gateways
- `getArWeaveGateways()` - Return list of ArWeave gateways
- `buildIPFSUrl(cid, gateway)` - Build IPFS gateway URL
- `buildArWeaveUrl(txid, gateway)` - Build ArWeave gateway URL

**Security Features**:
- Always verifies `coremanifest.dat` signature before trusting any update data
- Verifies SHA256 before and after file operations
- Prevents unsigned JSON files from affecting update process
- Uses atomic file moves where possible
- Re-verifies everything after download and move

### 2. Update Dialog Component (`electron/renderer/src/components/SoftwareUpdateDialog.vue`)

Rich Vue component for displaying update information and handling user interaction.

**Props**:
- `visible: boolean` - Controls dialog visibility
- `updateInfo: object` - Update information including:
  - `currentVersion: string`
  - `availableVersion: string`
  - `entry: object` - Core manifest entry with all fields
  - `localVersionExists: boolean` - Whether new version already exists locally
  - `localVersionMatches: boolean` - Whether local version SHA256 matches
  - `updateState: string` - Current state: `'idle' | 'downloading' | 'verifying' | 'completed' | 'error'`
  - `newExecutablePath: string` - Path to new executable (set after successful update)
  - `progress: object` - Download progress: `{ current: number, total: number, message: string }`
- `isBlocking: boolean` - Whether dialog is blocking (startup check)

**Features**:
- Displays current vs available version
- Shows all entry fields:
  - `message` - Optional message block (if JSON string)
  - `link` - Clickable link(s) (if JSON string or array)
  - `pointer` - Clickable link to `arbiscan.io/address/{pointer}`
  - `source_filename`
  - `version`
  - `updated` - Raw number + formatted timestamp in parentheses
  - `sha256`
  - `addr` - Clickable link(s) if specified
  - `baddr` - Display as base64 string
  - `ipfs_cidv1` - Clickable link to `https://check.ipfs.network/?cid={CID}` + dropdown with IPFS gateways
  - `data_txid` - Display as `ar://{DATA_TXID}` + dropdown with ArWeave gateways
- IPFS Gateway Dropdown: List of gateways from `catalog-download-manager.js` IPFS_GATEWAYS
- ArWeave Gateway Dropdown: List of ArWeave gateways
- Progress indicator during download/verification
- Error display on failure
- Success message on completion

**Button States**:
- If `localVersionExists && localVersionMatches`: "Exit now" and "Launch old version anyway"
- If update in progress: Show progress indicator, disable buttons
- If update completed successfully: Show "Launch new version" button and "Cancel"
- Otherwise (initial state): "Yes, update now" and "No, continue with current version"

### 3. Update Window (`electron/utils/software-update-window.js`)

Creates separate BrowserWindow for update dialog.

**Function**: `createUpdateWindow(updateInfo, parentWindow)`

**Returns**: Promise resolving to user choice (`'update' | 'skip' | 'exit' | 'launch-new'`)

**Implementation**:
- Creates new `BrowserWindow` with modal behavior
- Loads Vue component via HTML file with `mode=update` query parameter
- Uses IPC to pass update info and receive user response
- Blocks until user responds (Promise-based)

**IPC Channels**:
- `software-update:get-info` - Return update info to renderer
- `software-update:user-response` - Receive user's choice
- `software-update:open-url` - Open URL in default browser
- `software-update:open-ipfs` - Open IPFS gateway URL
- `software-update:open-arweave` - Open ArWeave gateway URL
- `software-update:progress` - Send progress updates to renderer

---

## Integration

### Startup Check (`electron/main.js`)

The blocking startup check is integrated in `app.whenReady()`:

1. After `bootstrapManifests()`, check for updates
2. If update available:
   - Check if local version exists and matches
   - Create update window (blocking)
   - Wait for user response
   - If "update": Download, verify, move, re-verify, then launch new version and exit
   - If "skip": Continue with old version
   - If "exit": Exit app (if old version dialog)
   - If "launch-new": Launch new version executable and exit current process
3. Continue with normal startup flow (only if update was skipped)

### Manual Check

Manual update check is available via:
- Profile dropdown menu → "Check for Updates"

The manual check:
- Calls `software-update:check-manual` IPC handler
- Creates non-blocking update window (can be dismissed)
- Shows update dialog if update found
- Shows "You are running the latest version" toast if no update available

---

## Update Verification Flow

The `performUpdate()` function implements a complete verification flow:

1. **Verify coremanifest.dat signature**:
   - Load `coremanifest_latest.dat` from userData
   - Use `verifyCoreManifestDat()` from `verify-coremf-dat-internal.js`
   - Ensure signature is valid before proceeding

2. **Re-verify coremanifest.dat matches JSON**:
   - Extract JSON from verified `.dat` file
   - Compare entry data with what we're using
   - Ensure no tampering

3. **Download update**:
   - Use `catalog-download-manager.js` `ensureArtifact()`
   - Create spec object from entry
   - Download to temp directory
   - Verify SHA256 matches `entry.sha256`

4. **Move to target location**:
   - Target: `path.join(path.dirname(process.execPath), entry.target_filename || entry.source_filename)`
   - Use atomic move (rename) if possible
   - Verify SHA256 again after move

5. **Final verification**:
   - Re-read `coremanifest.dat`
   - Re-verify signature
   - Re-extract JSON
   - Re-verify entry SHA256 matches moved file

6. **Launch new version**:
   - Spawn new executable using `spawn()` from Node.js `child_process`
   - Pass through command-line arguments if any
   - Detach process so it continues after current process exits
   - Exit current process (`app.quit()`)
   - New version will start up normally and can check for updates again if needed

---

## Security Considerations

1. **Signature Verification**: Always verify `coremanifest.dat` signature before trusting any update data
2. **SHA256 Verification**: Verify SHA256 before and after file operations
3. **No Local Tampering**: Prevent unsigned JSON files from affecting update process
4. **Atomic Operations**: Use atomic file moves where possible
5. **Re-verification**: Re-verify everything after download and move

---

## Platform Considerations

### Windows
- Executable files have `.exe` extension
- May need to handle spaces in executable path
- Uses `spawn()` with `detached: true` and `stdio: 'ignore'`

### Linux
- AppImage files need execute permissions (`chmod 755`)
- Uses `spawn()` with `detached: true` and `stdio: 'ignore'`

---

## IPC Handlers

All IPC handlers are registered in `electron/ipc-handlers.js`:

- `software-update:get-info` - Get update info for dialog
- `software-update:user-response` - Handle user response from dialog
- `software-update:open-url` - Open URL in default browser
- `software-update:open-ipfs` - Open IPFS gateway URL
- `software-update:open-arweave` - Open ArWeave gateway URL
- `software-update:get-ipfs-gateways` - Get IPFS gateways list
- `software-update:get-arweave-gateways` - Get ArWeave gateways list
- `software-update:check-manual` - Manual update check

All handlers are exposed in `electron/preload.js` for renderer access.

---

## Testing Considerations

1. Test with update available at startup
2. Test with local version already present
3. Test with SHA256 mismatch scenarios
4. Test with network failures
5. Test manual update check
6. Test signature verification failures
7. Test on Windows and Linux platforms
8. Test launching new version after successful update
9. Test that old version exits cleanly when new version is launched

---

## Files

### New Files:
1. `electron/utils/software-update-manager.js` - Core update logic
2. `electron/utils/software-update-window.js` - Window creation and IPC
3. `electron/renderer/src/components/SoftwareUpdateDialog.vue` - Vue component
4. `devdocs/SOFTWARE_UPDATE_SYSTEM.md` - This documentation

### Modified Files:
1. `electron/main.js` - Integrated blocking startup check
2. `electron/ipc-handlers.js` - Added manual check handler and window IPC handlers
3. `electron/preload.js` - Added IPC method exposures
4. `electron/renderer/src/App.vue` - Added manual check menu/button and update dialog integration
5. `docs/PROGRAMS.MD` - Documented software update system
6. `docs/CHANGELOG.md` - Added entry for software update feature

---

## Usage

### Automatic Update Check

The update check runs automatically at application startup. If an update is available, a blocking dialog appears that requires user response before the app continues.

### Manual Update Check

Users can manually check for updates via:
- Profile dropdown menu → "Check for Updates"

This creates a non-blocking dialog that can be dismissed if no update is desired.

---

## Error Handling

- Network errors: Show user-friendly message, allow retry
- SHA256 mismatch: Abort update, show error
- Signature verification failure: Abort update, show security warning
- File move errors: Show error, keep downloaded file in temp location
- Permission errors: Show error with guidance

---

## Future Enhancements

Potential future improvements:
- Background update download option
- Scheduled update checks
- Update rollback capability
- Delta updates for smaller downloads
- Update notification system for non-blocking checks
