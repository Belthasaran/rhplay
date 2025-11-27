# Run Timing System Review and Proposed Changes

**Date**: January 2025  
**Status**: 📋 **REVIEW IN PROGRESS**

---

## Overview

This document reviews the current implementation of elapsed time tracking during runs and proposes changes to ensure precise timing calculations that match the original specifications. The review was prompted by reports of negative elapsed times when resuming runs after restarting the program.

## Critical Principle: Timestamps Are Never Adjusted

**IMPORTANT**: Run start timestamps (`started_at`) and completion timestamps (`completed_at`) represent the **exact wall-clock time** when events occurred. These timestamps are **NEVER modified or adjusted**, even when pausing, unpausing, or resuming runs.

- `started_at` = The exact time the run started (set once, never changed)
- `completed_at` = The exact time a challenge/run completed (set when event occurs)
- Pause time is tracked separately in `pause_seconds` and subtracted during calculation
- The elapsed time formula is: `(current_time - started_at) - pause_seconds - pending_pause_time`

**This principle applies to both run-level and challenge-level timestamps.**

---

## Original Specifications

### Goals
- Ensure run timings for elapsed time are accurate
- During an active run, keep timings with real-time display for:
  - Entire run (cumulative elapsed time)
  - Active challenge/item (run segment - cumulative elapsed time)
  - Pause time (both run and segment)

### System Clock Accuracy
- When "Start Run" is pressed, attempt to quickly ascertain clock accuracy by briefly comparing to network-based time
- Record difference between system clock and network time if possible (asynchronously, without delaying run start)
- If possible, record attribute in run results storage for network time comparison and run validity status

### Real-Time Timer Display
- Visual estimate tracking run times down to hours, minutes, and seconds
- Can work by any method (e.g., count up every second, or at least once per minute)
- When performing Done, Skip, or Undo: time displays should be synchronized based on authoritative calculation from saved timestamps

### Elapsed Time Formula
```
Elapsed time = (Finished at timestamp OR Current timestamp as of now for an active segment)
             - (Started at timestamp)
             - (Tallied pause time)
             - (Pending pause time; For an active segment: if the run is currently paused)
```

**IMPORTANT**: Timestamps (started_at, completed_at) are NEVER adjusted. They represent the exact wall-clock time when events occurred. Pause time is tracked separately in pause_seconds and subtracted during calculation only.

### Pause Time Tracking
- Visualized in real-time: both cumulative timer for run, and timers on active and past challenges
- At end of each run or run segment: save completion timestamp with millisecond precision (display to nearest second)
- Elapsed time can be computed based on two timestamps and total tallied pause time
- Elapsed time should also be saved

### Recording Run Times

#### Run-Level Tracking
Each run should have:
1. **Run start time**: Complete timestamp accounting for date and time the run started. Hours, Seconds, and Milliseconds saved. Display precision: nearest second.
2. **Run ending time**: Complete timestamp when run ends. Including Hours, Seconds, and Milliseconds.
3. **Cumulative Pause Time**: Total amount of time spent in pause state during run.
   - Store data value representing start timestamp of most recent pause
   - After pause concludes (unpause chosen): Calculate time spent during pause = (current timestamp - pause start time)
   - Stored pause time increases by that amount
   - Pause time should internally have precision to nearest millisecond, but display in seconds
   - Do NOT remember start and end times for each individual pause
   - Current pause's time is added to pause time when pause concludes
   - While pause is ongoing, pending pause time counts towards pause time in real-time display, but recording occurs after unpause

#### Total Elapsed Time Formula
```
Total elapsed time = (Time finished OR current time)
                   - (Time the run started at)
                   - (Pause time total)

Pause time total = (Tallied pause time) + (Pending pause time if run/segment not finished yet and still paused)
```

#### Pause Behavior
- Pause time only occurs if runner specifically chooses Pause action
- Run or segment where pause has not been pressed has zero pause time
- Exiting program and restarting allows Resuming the run, but does NOT imply a pause in the clock nor add pause time, unless run was Paused manually first before exit

#### Pause Tracking Implementation
- Timestamp saved when pause begins (both to run and current segment)
- Timestamp saved as pause end (both to run and current segment) when pause ends
- Timestamp precision: date and time to nearest millisecond, displayed to nearest second
- Total pause time calculated when pause ends and added to cumulative pause time

### Per-Challenge Times (Split Times)

#### Requirements
- Same kind of timers for each specific challenge in a run
- Same millisecond precision, but display precision to nearest second
- Per-challenge times are a fraction of total cumulative run time
- Total time elapsed during run should equal sum of elapsed times for all challenges

#### Undo/Back Button Behavior
- Later stages can be undone
- Pressing Undo (if successfully reverting to earlier active challenge) clears elapsed time and start time on later challenge
- Time that was spent on that challenge counts towards earlier challenge instead
- Any current pause or pause time that had been used on challenge being undone moves to earlier challenge
- After Undo: later stage considered as NOT been attempted yet
- No time considered as having been spent on later change
- All that time (elapsed time or pause time) is attributed to prior stage instead

#### Reconciliatio
- On conclusion of any run segment or run as whole: reconciled times calculated based on timestamps for start, end, and pause times
- These are the authoritative results to be saved and shown

---

## Current Implementation Review

### Database Schema

#### Runs Table (from Migration 007)
- `started_at TIMESTAMP` - When run started
- `completed_at TIMESTAMP` - When run ended (NULL if active)
- `pause_seconds INTEGER DEFAULT 0` - Total paused time (in seconds)
- `pause_start TIMESTAMP NULL` - When pause started (NULL if not paused)
- `pause_end TIMESTAMP NULL` - When last pause ended
- `status VARCHAR(20)` - 'preparing', 'active', 'completed', 'cancelled'

#### Run Results Table (Per-Challenge)
- `started_at TIMESTAMP` - When challenge started
- `completed_at TIMESTAMP` - When challenge completed (NULL if pending)
- `duration_seconds INTEGER` - Elapsed time for this challenge
- `pause_seconds INTEGER DEFAULT 0` - Per-challenge pause time
- `pause_start TIMESTAMP NULL` - Challenge pause start
- `pause_end TIMESTAMP NULL` - Challenge pause end
- `status VARCHAR(20)` - 'pending', 'success', 'ok', 'skipped'

### Frontend Implementation (App.vue)

#### Timer Calculation (Lines 19521-19536)
```javascript
runTimerInterval.value = window.setInterval(() => {
  if (runStartTime.value) {
    runElapsedSeconds.value = Math.floor((Date.now() - runStartTime.value) / 1000);
    // Update current challenge duration
    if (currentChallengeIndex.value < challengeResults.value.length) {
      const current = challengeResults.value[currentChallengeIndex.value];
      if (current.status === 'pending') {
        // Calculate duration since this challenge started
        const prevDuration = challengeResults.value
          .slice(0, currentChallengeIndex.value)
          .reduce((sum, r) => sum + r.durationSeconds, 0);
        current.durationSeconds = runElapsedSeconds.value - prevDuration;
      }
    }
  }
}, 1000);
```

**Issues Identified**:
1. ❌ **No pause time subtraction**: Formula is `Date.now() - runStartTime.value`, missing pause time
2. ❌ **runStartTime.value set incorrectly on resume**: When resuming, `runStartTime.value` may be set to current time instead of original start time from database
3. ❌ **No synchronization with database**: Timer relies on frontend `runStartTime` which may be incorrect
4. ⚠️ **runStartTime should never be adjusted**: The original start timestamp must remain unchanged; pause time is subtracted during calculation, not by modifying the timestamp

#### Pause/Unpause Functions (Lines 19616-19657)

**pauseRun()**:
- Sets `isRunPaused.value = true`
- Calls backend `pauseRun(currentRunUuid.value)`
- Does NOT stop the timer interval

**unpauseRun()**:
- Gets `pauseSeconds` from backend result
- Sets `runPauseSeconds.value = result.pauseSeconds || 0`
- Sets `isRunPaused.value = false`
- Does NOT adjust `runStartTime` to account for pause time

**Issues Identified**:
1. ❌ **Timer continues during pause**: The interval timer keeps running even when paused
2. ❌ **No adjustment of runStartTime**: When unpausing, `runStartTime` should be adjusted forward by pause duration

### Backend Implementation (ipc-handlers.js)

#### Start Run (Lines 2090-2136)
```javascript
UPDATE runs 
SET status = 'active', 
    started_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE run_uuid = ?
```

**Issues Identified**:
1. ⚠️ **Overwrites started_at on resume**: If run is resumed, `started_at` is updated to current timestamp, losing original start time

#### Record Challenge Result (Lines 2142-2211)
```javascript
duration_seconds = CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)
```

**Issues Identified**:
1. ❌ **No pause time subtraction**: Formula doesn't subtract `pause_seconds` from duration
2. ❌ **Uses 'now' instead of completed_at**: Should use `completed_at` timestamp if available

#### Pause/Unpause (Lines 2405-2499)

**pauseRun()**:
- Sets `pause_start = CURRENT_TIMESTAMP` for run and current challenge
- Sets `pause_end = NULL`

**unpauseRun()**:
- Calculates pause duration: `(Date.now() - pauseStart) / 1000`
- Adds to `pause_seconds`: `totalPaused = (run.pause_seconds || 0) + pauseDuration`
- Sets `pause_start = NULL`, `pause_end = CURRENT_TIMESTAMP`

**Issues Identified**:
1. ✅ Pause tracking appears correct
2. ✅ Timestamps are not modified (started_at, completed_at remain as actual event times)

### Resume Logic (Not Found)

**Critical Issue**: The resume logic that restores a run after program restart is not found in the current codebase search. This is likely where the negative time bug originates.

**Expected Behavior**:
- When resuming, `runStartTime.value` should be set to the database's `started_at` timestamp
- Elapsed time calculation should account for pause time already accumulated
- Timer interval should resume with correct base time

---

## Issues Identified

### Critical Issues

1. **❌ Elapsed Time Formula Missing Pause Time**
   - **Location**: `App.vue` line 19523
   - **Current**: `runElapsedSeconds.value = Math.floor((Date.now() - runStartTime.value) / 1000);`
   - **Should be**: `runElapsedSeconds.value = Math.floor((Date.now() - runStartTime.value - runPauseSeconds.value) / 1000);`
   - **Impact**: Elapsed time includes pause time, making runs appear longer than actual play time

2. **❌ Challenge Duration Missing Pause Time**
   - **Location**: `ipc-handlers.js` line 2165
   - **Current**: `duration_seconds = CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)`
   - **Should be**: `duration_seconds = CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER) - pause_seconds`
   - **Impact**: Challenge durations include pause time

3. **❌ Resume Logic Missing or Incorrect**
   - **Location**: Not found (possibly in startup code)
   - **Expected**: When resuming, restore `runStartTime` from database `started_at` and account for existing pause time
   - **Impact**: Negative elapsed times when resuming runs

4. **❌ Timer Continues During Pause**
   - **Location**: `App.vue` timer interval
   - **Current**: Timer interval runs continuously, even when paused
   - **Should be**: Timer should stop incrementing during pause, or adjust calculation to exclude pause time

### Medium Issues

5. **⚠️ started_at Overwritten on Resume**
   - **Location**: `ipc-handlers.js` line 2096
   - **Current**: `started_at = CURRENT_TIMESTAMP` on every start
   - **Should be**: Only set `started_at` on first start, not on resume
   - **Impact**: Original start time lost if run is resumed
   - **Principle**: `started_at` represents the exact wall-clock time the run started and must NEVER be modified, even when resuming

6. **⚠️ No Network Time Comparison**
   - **Location**: Not implemented
   - **Requirement**: Compare system clock to network time on run start (async)
   - **Impact**: No clock accuracy validation

### Minor Issues

7. **⚠️ No Millisecond Precision Storage**
   - **Location**: Database schema uses INTEGER seconds
   - **Requirement**: Store timestamps with millisecond precision
   - **Impact**: Loss of precision, though acceptable for display purposes

8. **⚠️ Undo Logic Time Transfer**
   - **Location**: `undoChallenge()` function
   - **Requirement**: Transfer time from undone challenge to previous challenge
   - **Status**: Needs verification

---

## Proposed Changes

### Change 1: Fix Elapsed Time Calculation (Frontend)

**File**: `electron/renderer/src/App.vue`

**Current Code** (line ~19523):
```javascript
runElapsedSeconds.value = Math.floor((Date.now() - runStartTime.value) / 1000);
```

**Proposed Code**:
```javascript
// Calculate elapsed time: (current time - start time - pause time)
// IMPORTANT: runStartTime.value is the original start timestamp, NEVER adjusted
// If currently paused, include pending pause time
const now = Date.now();
const baseElapsed = Math.floor((now - runStartTime.value) / 1000);

// Calculate pending pause time if currently paused
let pendingPauseSeconds = 0;
if (isRunPaused.value && runPauseStartTime.value) {
  pendingPauseSeconds = Math.floor((now - runPauseStartTime.value) / 1000);
}

// Final elapsed time: base elapsed minus tallied pause time minus pending pause time
runElapsedSeconds.value = Math.max(0, baseElapsed - runPauseSeconds.value - pendingPauseSeconds);
```

**Additional State Needed**:
- Add `const runPauseStartTime = ref<number | null>(null);` to track when current pause started

**Key Principle**: `runStartTime.value` is set once from the database's `started_at` timestamp and NEVER modified, even when pausing/unpausing.

### Change 2: Fix Challenge Duration Calculation (Backend)

**File**: `electron/ipc-handlers.js`

**Current Code** (line ~2165):
```javascript
duration_seconds = CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)
```

**Proposed Code**:
```javascript
// Get pause_seconds for this challenge
const challenge = db.prepare(`
  SELECT pause_seconds FROM run_results WHERE result_uuid = ?
`).get(result.result_uuid);

const pauseSeconds = challenge?.pause_seconds || 0;

// Calculate duration: (completed_at - started_at - pause_seconds)
duration_seconds = CAST(
  ((julianday('now') - julianday(started_at)) * 86400) - pauseSeconds AS INTEGER
)
```

### Change 3: Implement Resume Logic

**File**: `electron/renderer/src/App.vue` (new function)

**Proposed Function**:
```javascript
async function resumeRunFromDatabase() {
  if (!currentRunUuid.value) return;
  
  try {
    // Get run data from database
    const run = await (window as any).electronAPI.getRun({ runUuid: currentRunUuid.value });
    if (!run || run.status !== 'active') return;
    
    // IMPORTANT: Use the original started_at timestamp from database, NEVER modify it
    const startedAt = new Date(run.started_at).getTime();
    const now = Date.now();
    
    // Get pause information
    let pauseSeconds = run.pause_seconds || 0;
    let isCurrentlyPaused = false;
    let pauseStartTime: number | null = null;
    
    // If currently paused, calculate pending pause time
    if (run.pause_start && !run.pause_end) {
      isCurrentlyPaused = true;
      pauseStartTime = new Date(run.pause_start).getTime();
      // Don't add pending pause to pauseSeconds yet (it will be added on unpause)
    }
    
    // Set runStartTime to original start time from database (NEVER modified after this)
    runStartTime.value = startedAt;
    
    // Set pause state
    runPauseSeconds.value = pauseSeconds;
    isRunPaused.value = isCurrentlyPaused;
    if (pauseStartTime) {
      runPauseStartTime.value = pauseStartTime;
    }
    
    // Calculate initial elapsed time using the formula from Change 1
    const baseElapsed = Math.floor((now - startedAt) / 1000);
    if (isCurrentlyPaused && pauseStartTime) {
      const pendingPauseSeconds = Math.floor((now - pauseStartTime) / 1000);
      runElapsedSeconds.value = Math.max(0, baseElapsed - pauseSeconds - pendingPauseSeconds);
    } else {
      runElapsedSeconds.value = Math.max(0, baseElapsed - pauseSeconds);
    }
    
    // Restore challenge results and times from database
    const results = await (window as any).electronAPI.getRunResults({ runUuid: currentRunUuid.value });
    // ... restore challengeResults.value with durations from database
    
    // Start timer interval (will use corrected calculation from Change 1)
    if (runTimerInterval.value) clearInterval(runTimerInterval.value);
    runTimerInterval.value = window.setInterval(() => {
      // Timer calculation happens in Change 1, which properly accounts for pause time
    }, 1000);
    
  } catch (error) {
    console.error('Error resuming run:', error);
  }
}
```

**Key Principle**: `runStartTime.value` is set once from `run.started_at` and NEVER modified. All pause adjustments happen through `runPauseSeconds.value` and the calculation formula.

### Change 4: Fix Start Run to Preserve Original Start Time

**File**: `electron/ipc-handlers.js`

**Current Code** (line ~2096):
```javascript
UPDATE runs 
SET status = 'active', 
    started_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE run_uuid = ?
```

**Proposed Code**:
```javascript
// Only set started_at if it's NULL (first start)
// If resuming, preserve the original started_at timestamp
// IMPORTANT: started_at represents the exact wall-clock time the run started, never modified
UPDATE runs 
SET status = 'active', 
    started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP
WHERE run_uuid = ?
```

**Key Principle**: `started_at` is set once on first start and NEVER modified, even when resuming. It represents the exact time the run began.

### Change 5: Update Pause/Unpause to Stop Timer During Pause

**File**: `electron/renderer/src/App.vue`

**Proposed pauseRun()**:
```javascript
async function pauseRun() {
  if (!currentRunUuid.value || isRunPaused.value) return;
  
  try {
    // Record pause start time
    runPauseStartTime.value = Date.now();
    
    if (isElectronAvailable()) {
      await (window as any).electronAPI.pauseRun(currentRunUuid.value);
    }
    
    isRunPaused.value = true;
    console.log('Run paused');
    
    // Timer interval will continue, but calculation in Change 1 will exclude pause time
  } catch (error) {
    console.error('Error pausing run:', error);
    alert('Error pausing run');
  }
}
```

**Proposed unpauseRun()**:
```javascript
async function unpauseRun() {
  if (!currentRunUuid.value || !isRunPaused.value) return;
  
  try {
    if (isElectronAvailable()) {
      const result = await (window as any).electronAPI.unpauseRun(currentRunUuid.value);
      console.log('Unpause result:', result);
      
      if (result && result.success) {
        // Update pause time with the returned value (includes the pause that just ended)
        runPauseSeconds.value = result.pauseSeconds || 0;
        isRunPaused.value = false;
        runPauseStartTime.value = null; // Clear pause start time
        
        // IMPORTANT: Do NOT adjust runStartTime.value
        // The elapsed time calculation in Change 1 will automatically account for
        // the updated runPauseSeconds.value
        
        console.log('Run unpaused, total pause time:', runPauseSeconds.value);
      } else {
        console.error('Unpause failed:', result);
        alert('Failed to unpause run: ' + (result?.error || 'Unknown error'));
      }
    } else {
      isRunPaused.value = false;
      runPauseStartTime.value = null;
    }
  } catch (error) {
    console.error('Error unpausing run:', error);
    alert('Error unpausing run: ' + error);
  }
}
```

### Change 6: Add Network Time Comparison (Future Enhancement)

**File**: New file or add to startup logic

**Proposed Implementation**:
- On run start, asynchronously fetch network time (e.g., from NTP server or time API)
- Calculate difference: `clockOffset = networkTime - systemTime`
- Store in run record: `clock_offset_ms INTEGER` (milliseconds)
- Store run validity: `clock_validated BOOLEAN DEFAULT 0`

**Note**: This is a future enhancement and not critical for fixing the negative time bug.

---

## Testing Plan

### Test 1: Fresh Start Run
1. Start a new run
2. Let timer run for 30 seconds
3. Verify elapsed time shows ~30 seconds
4. Complete run
5. Verify final elapsed time matches expected

### Test 2: Pause/Unpause
1. Start a run
2. Let timer run for 30 seconds
3. Pause for 60 seconds
4. Unpause
5. Let timer run for 30 more seconds
6. Verify elapsed time shows ~60 seconds (not 120)
7. Verify pause time shows ~60 seconds

### Test 3: Resume After Restart (Negative Time Bug)
1. Start a run
2. Let timer run for 30 seconds
3. Close program
4. Restart program
5. Resume run
6. **Verify elapsed time shows ~30 seconds (not negative)**
7. Continue run for 30 more seconds
8. Verify elapsed time shows ~60 seconds

### Test 4: Resume After Pause
1. Start a run
2. Let timer run for 30 seconds
3. Pause for 60 seconds
4. Close program (while paused)
5. Restart program
6. Resume run (should be in paused state)
7. Verify elapsed time shows ~30 seconds
8. Verify pause time shows ~60+ seconds (includes time while app was closed)
9. Unpause
10. Continue for 30 seconds
11. Verify elapsed time shows ~60 seconds

### Test 5: Challenge Duration Accuracy
1. Start a run
2. Complete challenge 1 (note duration)
3. Pause for 30 seconds
4. Unpause
5. Complete challenge 2 (note duration)
6. Verify challenge 1 duration doesn't include pause time
7. Verify challenge 2 duration doesn't include pause time
8. Verify sum of challenge durations equals total elapsed time

### Test 6: Undo Challenge Time Transfer
1. Start a run
2. Complete challenge 1 (duration: 30s)
3. Complete challenge 2 (duration: 30s)
4. Undo challenge 2
5. Verify challenge 2 duration resets to 0
6. Complete challenge 2 again (duration: 30s)
7. Verify total elapsed time is correct (60s total, not 90s)

---

## Implementation Priority

1. **P0 - Critical**: Change 1 (Fix Elapsed Time Calculation) - Fixes negative time bug
2. **P0 - Critical**: Change 3 (Implement Resume Logic) - Fixes negative time bug
3. **P0 - Critical**: Change 2 (Fix Challenge Duration) - Ensures accurate split times
4. **P1 - High**: Change 4 (Preserve Original Start Time) - Prevents data loss
5. **P1 - High**: Change 5 (Update Pause/Unpause) - Ensures correct pause behavior
6. **P2 - Medium**: Change 6 (Network Time Comparison) - Future enhancement

---

## Questions for Review

1. **Resume Logic Location**: Where is the resume logic currently implemented? It was not found in the search.
2. **Clock Precision**: Should we store timestamps with millisecond precision in the database, or is second precision sufficient?
3. **Undo Time Transfer**: Is the current undo implementation correctly transferring time between challenges?
4. **Network Time Validation**: Should network time comparison be implemented now or deferred?

---

## Next Steps

1. ✅ **Document Review**: Complete this review document
2. ⏳ **Code Investigation**: Find and review actual resume logic implementation
3. ⏳ **Implementation**: Apply proposed changes in priority order
4. ⏳ **Testing**: Execute test plan to verify fixes
5. ⏳ **Verification**: Confirm negative time bug is resolved

---

*Document Status: Initial review complete. Awaiting code investigation and implementation.*
