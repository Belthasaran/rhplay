# Quick Launch Feature - Test Plan

## Date: October 13, 2025

## Prerequisites
1. RHTools Electron application installed and running
2. Database files populated (`rhdata.db`, `patchbin.db`, `clientdata.db`)
3. Vanilla SMW ROM configured in Settings
4. FLIPS executable configured in Settings

## Test Cases

### Test 1: Basic Single Game Launch
**Steps:**
1. Open RHTools GUI
2. Select exactly 1 game from the list
3. Verify "Start" button is enabled
4. Click "Start" button
5. Observe progress modal appears
6. Wait for completion
7. Verify success modal shows:
   - "1 game file has been prepared"
   - Folder path displayed
   - Launch instructions visible
8. Click "Open Folder" button
9. Verify folder opens in file manager
10. Verify files exist:
    - `smw<GAMEID>_<VERSION>.sfc`
    - `md<GAMEID>_<VERSION>.json`
11. Open JSON file and verify metadata is correct
12. Load SFC file in emulator and verify it launches

**Expected Result:** ✅ Single game staged successfully, files created correctly

---

### Test 2: Multiple Games (5 games)
**Steps:**
1. Select 5 different games from the list
2. Verify "Start" button is enabled
3. Click "Start" button
4. Observe progress modal shows "1 / 5", "2 / 5", etc.
5. Verify game names displayed during staging
6. Wait for completion
7. Verify success modal shows "5 game files have been prepared"
8. Open folder and verify 10 files total (5 SFC + 5 JSON)
9. Verify each game has correct naming pattern

**Expected Result:** ✅ Multiple games staged successfully in sequence

---

### Test 3: Maximum Selection (21 games)
**Steps:**
1. Select exactly 21 games
2. Verify "Start" button is enabled
3. Click "Start" button
4. Wait for all games to stage
5. Verify success modal shows "21 game files have been prepared"
6. Verify 42 files in folder (21 SFC + 21 JSON)

**Expected Result:** ✅ Maximum allowed games staged successfully

---

### Test 4: Invalid Selection (0 games)
**Steps:**
1. Ensure no games are selected
2. Verify "Start" button is disabled
3. Attempt to click (should not be possible)

**Expected Result:** ✅ Button disabled, no action taken

---

### Test 5: Invalid Selection (>21 games)
**Steps:**
1. Select 22 or more games
2. Verify "Start" button is disabled
3. Attempt to click (should not be possible)

**Expected Result:** ✅ Button disabled, no action taken

---

### Test 6: Missing ROM Configuration
**Steps:**
1. Open Settings
2. Clear or remove vanilla ROM path
3. Save settings
4. Select 1 game
5. Click "Start" button
6. Verify alert message: "Please configure a valid vanilla SMW ROM in Settings"
7. Verify Settings dialog opens automatically

**Expected Result:** ✅ Proper error message and settings prompt

---

### Test 7: Missing FLIPS Configuration
**Steps:**
1. Open Settings
2. Clear or remove FLIPS path (keep ROM configured)
3. Save settings
4. Select 1 game
5. Click "Start" button
6. Verify alert message: "Please configure FLIPS executable in Settings"
7. Verify Settings dialog opens automatically

**Expected Result:** ✅ Proper error message and settings prompt

---

### Test 8: Temporary Directory Override (Default)
**Steps:**
1. Open Settings
2. Leave "Temporary Directory Override" blank
3. Save settings
4. Stage 1 game
5. Verify folder path uses OS temp directory (e.g., `/tmp/RHTools-QuickLaunch/` on Linux)

**Expected Result:** ✅ Uses default OS temp directory

---

### Test 9: Temporary Directory Override (Custom Valid Path)
**Steps:**
1. Create a custom directory (e.g., `/home/user/rhtools-temp`)
2. Open Settings
3. Enter custom path in "Temporary Directory Override"
4. Save settings
5. Verify ✓ appears next to setting (indicating valid path)
6. Stage 1 game
7. Verify folder path uses custom directory (e.g., `/home/user/rhtools-temp/RHTools-QuickLaunch/`)
8. Verify files created in custom location

**Expected Result:** ✅ Custom temp directory used successfully

---

### Test 10: Temporary Directory Override (Invalid Path)
**Steps:**
1. Open Settings
2. Enter non-existent path (e.g., `/nonexistent/path`)
3. Click "Save Changes and Close"
4. Verify alert: "Temporary directory override path does not exist or is not a directory"
5. Verify ✗ appears next to setting
6. Verify Settings dialog remains open

**Expected Result:** ✅ Invalid path rejected, user notified

---

### Test 11: Progress Modal Display
**Steps:**
1. Select 3 games
2. Click "Start" button
3. Observe progress modal:
   - Progress bar fills incrementally
   - Text shows "1 / 3", "2 / 3", "3 / 3"
   - Game names displayed during processing
   - Modal closes automatically on completion

**Expected Result:** ✅ Progress accurately tracked and displayed

---

### Test 12: Success Modal - Open Folder
**Steps:**
1. Stage any number of games
2. In success modal, click "📁 Open Folder" button
3. Verify system file manager opens
4. Verify correct folder is displayed
5. Verify all expected files are present

**Expected Result:** ✅ Folder opens correctly in file manager

---

### Test 13: File Naming Pattern
**Steps:**
1. Note the game IDs of selected games
2. Stage the games
3. Verify file names match pattern:
   - SFC: `smw<GAMEID>_<VERSION>.sfc` (e.g., `smw12345_1.sfc`)
   - JSON: `md<GAMEID>_<VERSION>.json` (e.g., `md12345_1.json`)
4. Verify version numbers are correct (usually 1 for latest)

**Expected Result:** ✅ Files follow exact naming convention

---

### Test 14: JSON Metadata Content
**Steps:**
1. Stage 1 game
2. Open corresponding JSON file
3. Verify contains:
   - `gameid`
   - `version`
   - `name`
   - `authors`
   - `author`
   - `gametype`
   - `length`
   - `difficulty`
   - `demo`
   - `featured`
   - `description`
   - `added`
   - `moderated`
   - `staged_at` (ISO timestamp)
   - `sfc_file` (filename reference)

**Expected Result:** ✅ JSON contains complete metadata

---

### Test 15: Re-staging Same Game
**Steps:**
1. Stage game ID 12345
2. Verify files created
3. Stage same game again (ID 12345)
4. Verify files are overwritten/updated
5. Check `staged_at` timestamp is newer

**Expected Result:** ✅ Files overwritten with fresh copies

---

### Test 16: Mixed Game Types
**Steps:**
1. Select mixture of:
   - Standard hacks
   - Kaizo hacks
   - Troll hacks
   - Other types
2. Stage all selected games
3. Verify all types process correctly
4. Check JSON metadata reflects correct game types

**Expected Result:** ✅ All game types handled properly

---

### Test 17: Error Handling - Corrupted Patchblob
**Steps:**
1. Identify a game with potential patchblob issues
2. Attempt to stage
3. Verify error message is specific and helpful
4. Verify other games (if multiple selected) continue processing
5. Verify partial success reported

**Expected Result:** ✅ Graceful error handling, clear messaging

---

### Test 18: Launch Instructions Display
**Steps:**
1. Complete any staging operation
2. In success modal, verify instructions section shows:
   - "🚀 How to Launch:" heading
   - Numbered steps (1-4)
   - Code examples for file patterns
   - Tip about configuring launch program
3. Verify formatting is clear and readable

**Expected Result:** ✅ Instructions clear and helpful

---

### Test 19: Settings Persistence
**Steps:**
1. Set custom temp directory override
2. Save and close Settings
3. Close RHTools application
4. Reopen RHTools
5. Open Settings
6. Verify temp directory override still set
7. Stage a game to verify it uses saved setting

**Expected Result:** ✅ Setting persists across sessions

---

### Test 20: Button State Management
**Steps:**
1. Start with no selection → Button disabled
2. Select 1 game → Button enabled
3. Select 21 games → Button enabled
4. Select 22 games → Button disabled
5. Uncheck to 15 games → Button enabled
6. Uncheck all → Button disabled

**Expected Result:** ✅ Button state correctly reflects selection count

---

## Performance Tests

### Test P1: Large Batch Performance
**Steps:**
1. Select 21 games
2. Note start time
3. Stage all games
4. Note end time
5. Calculate average time per game

**Expected Result:** ✅ Reasonable performance (depends on hardware, typically 2-10 seconds per game)

---

### Test P2: Quick Re-launch
**Steps:**
1. Stage multiple games
2. Close success modal
3. Immediately select same games again
4. Stage again
5. Verify process completes quickly (files overwritten)

**Expected Result:** ✅ Re-staging is efficient

---

## Edge Cases

### Test E1: Special Characters in Game Names
**Steps:**
1. Find games with special characters in names
2. Stage these games
3. Verify filenames are valid
4. Verify JSON metadata preserves original names

**Expected Result:** ✅ Special characters handled correctly

---

### Test E2: Very Long Game Names
**Steps:**
1. Find games with long names
2. Stage these games
3. Verify no truncation issues
4. Verify files created successfully

**Expected Result:** ✅ Long names handled properly

---

### Test E3: Disk Space Exhaustion
**Steps:**
1. Select large number of games
2. If disk space becomes critical, verify:
   - Error message is clear
   - Process stops gracefully
   - No partial/corrupted files

**Expected Result:** ✅ Graceful failure on disk full

---

## Regression Tests

### Test R1: Run Staging Still Works
**Steps:**
1. Create a new run
2. Add games to run
3. Click "Stage and Save"
4. Verify run staging still works correctly
5. Verify files go to `RHTools-Runs/` folder, not `RHTools-QuickLaunch/`

**Expected Result:** ✅ Run staging unaffected

---

### Test R2: Other Settings Unaffected
**Steps:**
1. Verify other settings still work:
   - ROM path
   - FLIPS path
   - Launch method
   - USB2SNES settings
2. Verify no regressions introduced

**Expected Result:** ✅ Other settings function normally

---

## Test Summary Template

```
Test Run Date: _______________
Tester: _______________

Total Tests: 25
Passed: ___
Failed: ___
Skipped: ___

Critical Issues: ___________
Minor Issues: ___________
Notes: ___________
```

---

## Known Limitations
1. Maximum 21 games per staging operation (by design)
2. Files overwrite if same game staged multiple times
3. No automatic cleanup of old staged files
4. Launch program integration not yet implemented (manual launch only)

---

## Bug Reporting
If you encounter issues:
1. Note the exact steps to reproduce
2. Check console logs (Ctrl+Shift+I in Electron)
3. Record error messages
4. Note OS, game IDs, and configuration details
5. Create issue with "quick-launch" tag

