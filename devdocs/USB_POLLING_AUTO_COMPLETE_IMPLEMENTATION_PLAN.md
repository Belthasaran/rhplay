# USB Polling Auto-Complete Implementation Plan

**Date**: January 2025  
**Status**: 🚧 **In Progress**  
**Feature**: Automatic challenge completion detection via USB2SNES memory polling

---

## Overview

This feature enables automatic detection of challenge completion events by polling SMW memory addresses through USB2SNES. When enabled, the system monitors game state and automatically advances challenges when completion conditions are detected.

---

## Current Status

### ✅ Completed
1. **Modal Close Prevention** - Prepare Run dialog now only closes via X button
2. **Poll USB Button UI** - Toggle button added to left of Pause button
3. **State Variables** - All necessary reactive refs declared
4. **Basic Infrastructure** - Toggle function, start/stop logic, state persistence skeleton

### 🚧 In Progress
- Foundation code structure in place

### ⏳ Pending
- Complete memory polling implementation
- SNES Info polling and ROM verification
- Condition A timing logic
- Goal event detection
- Auto-advance logic
- Auto button color feedback
- IPC handlers for config updates
- Integration with run lifecycle

---

## Requirements

### 1. UI Changes

#### 1.1 Modal Close Prevention ✅
- **Location**: `electron/renderer/src/App.vue` line 1082
- **Status**: ✅ Complete
- **Details**: Removed `@click.self="closeRunModal"` from modal backdrop
- **Result**: Modal can only be closed via X button

#### 1.2 Poll USB Toggle Button ✅
- **Location**: `electron/renderer/src/App.vue` line 1111
- **Status**: ✅ Complete (UI structure)
- **Requirements**:
  - Appears only when `currentChallenge && currentChallengeSfcPath` (same condition as Launch button)
  - Positioned to left of Pause button
  - Checkbox-style toggle (checkbox input + label)
  - Shows "active" state when enabled
  - State remembered across run restarts

**TODO**: Add CSS styling for `.btn-poll-usb` and `.poll-checkbox`

### 2. State Management

#### 2.1 Reactive State Variables ✅
- **Location**: `electron/renderer/src/App.vue` lines 17825-17832
- **Status**: ✅ Complete

**Variables**:
```typescript
const usbPollingEnabled = ref<boolean>(false);
const usbPollingInterval = ref<number | null>(null);
const usbPollingLastPollTime = ref<number | null>(null);
const usbPollingConditionATime = ref<number>(0);
const usbPollingLastMemoryValues = ref<Record<string, number>>({});
const usbPollingCurrentMemoryValues = ref<Record<string, number>>({});
const usbPollingLastSnesInfo = ref<string | null>(null);
```

#### 2.2 State Persistence ⏳
- **Save State**: Function skeleton exists (`saveUsbPollingState`)
- **Load State**: Function skeleton exists (`loadUsbPollingState`)
- **Storage**: `runs.config_json` field
- **TODO**: Complete IPC handler for `updateRunConfig`

### 3. USB2SNES Connection Polling

#### 3.1 Connection Status Check ⏳
- **Frequency**: Every 1 second
- **Action**: Check if USB2SNES is connected and attached
- **Auto-Reconnect**: If disconnected and not already reconnecting, trigger connect
- **Status**: Skeleton exists in `performUsbPollingCycle()`

**Required IPC**: `usb2snes:status` (already exists ✅)
**Required IPC**: `usb2snes:connect` (already exists ✅)

#### 3.2 SNES Info Polling ⏳
- **Frequency**: Every 1 second (during polling cycle)
- **Purpose**: Verify correct ROM file is loaded
- **Format**: Extract filename from Info result (after trailing `/`)
- **Comparison**: Match against `currentChallengeSfcPath`
- **Action**: Hold Condition A at 0 if wrong file, change Auto button to Orange

**Required IPC**: `usb2snes:info` - **NEEDS TO BE EXPOSED**
- Base implementation exists in `usb2snesTypeA.js` ✅
- Need to expose via IPC handler and preload

### 4. Memory Address Polling

#### 4.1 Memory Addresses to Poll
**Location**: `electron/renderer/src/App.vue` lines 26810-26829 ✅

```typescript
const USB_POLLING_ADDRESSES = {
  animation: 0x7E0071,
  regularlevel: 0x7E0D9B,
  run_game: 0x7E0010,
  paused: 0x7E13D4,
  endtimer: 0x7E1493,
  keyhole_timer: 0x7E1434,
  fanfare: 0x7E0906,
  victory: 0x7E1B99,
  yellowSwitch: 0x7E1f28,
  greenSwitch: 0x7E1f27,
  blueSwitch: 0x7E1F29,
  redSwitch: 0x7E1f2a,
  roomCounter: 0x7E141A,
  yoshiBan: 0x7E1B9B,
  bossDefeat: 0x7E13C6,
  bowserPal: 0x7E1429,
  peach: 0x7E190D
};
```

#### 4.2 Address Conversion ⏳
- **Function**: `convertToUsb2SnesAddress()` exists ✅
- **Logic**: Convert 0x7Exxxx → 0xF5xxxx (USB2SNES protocol)
- **Implementation**: Complete ✅

#### 4.3 Batch Memory Read ⏳
- **Frequency**: Every 1 second (if preconditions met)
- **IPC**: `usb2snesReadMemoryBatch` (already exists ✅)
- **Format**: Array of `[protocolAddress, size]` tuples
- **Size**: 1 byte for each address
- **Result**: Store in `usbPollingCurrentMemoryValues`
- **Status**: Skeleton exists, needs full implementation

#### 4.4 Memory Value Tracking ⏳
- **Previous Values**: Store in `usbPollingLastMemoryValues`
- **Current Values**: Store in `usbPollingCurrentMemoryValues`
- **Comparison**: Compare previous cycle vs current cycle
- **Purpose**: Detect state changes for goal events

### 5. Condition A Checks

#### 5.1 Condition A Definition
All of the following must be `0x00`:
- `run_game` (0x7E0010)
- `paused` (0x7E13D4)
- `animation` (0x7E0071)
- `regularlevel` (0x7E0D9B)
- `endtimer` (0x7E1493)
- `keyhole_timer` (0x7E1434)

#### 5.2 Prerequisites for Condition A ⏳
Before Condition A can start tracking:
1. Challenge timer must be running (not paused)
2. Auto option checked (polling enabled) ✅
3. At least 5 seconds elapsed on current challenge
4. Challenge must be launched (game file loaded and verified)

#### 5.3 Condition A Timing ⏳
- **Threshold**: Must remain true for **10000ms** (10 seconds) consecutive polls
- **Reset Conditions**:
  - Advancing to next challenge (Done/Skip/auto-advance)
  - Condition A becomes false (timer resets to 0)
  - Game file changes (wrong file loaded)
  - Challenge not launched yet
- **Tracking**: `usbPollingConditionATime` (in milliseconds)

#### 5.4 Game File Verification ⏳
- **Check**: After challenge advance, verify game is launched
- **Method**: Query SNES Info, extract ROM filename
- **Comparison**: Match against `currentChallengeSfcPath`
- **Action**: If mismatch, clamp Condition A time to 0, change Auto button to Orange

### 6. Goal Event Detection

#### 6.1 Goal Events (After Condition A Threshold Reached) ⏳
Detect when these values change from 0 to non-zero (since last poll):
1. **endtimer** (0x7E1493) - Level end timer starts
2. **fanfare** (0x7E0906) - Victory fanfare plays
3. **bossDefeat** (0x7E13C6) - Boss defeated
4. **keyhole_timer** (0x7E1434) - Keyhole exit timer starts
5. **Switches** - Any switch changes from 0 to non-zero:
   - `yellowSwitch` (0x7E1f28)
   - `greenSwitch` (0x7E1f27)
   - `blueSwitch` (0x7E1F29)
   - `redSwitch` (0x7E1f2a)
6. **peach** (0x7E190D) - Changes from 0 to 1 (Princess saved)
7. **victory** (0x7E1B99) - Changes from 0 to non-zero (Victory state)

#### 6.2 Detection Logic ⏳
- **Compare**: `usbPollingLastMemoryValues` vs `usbPollingCurrentMemoryValues`
- **Trigger**: Value was 0 (or falsy) last cycle, now non-zero
- **Timing**: Only after Condition A threshold (10 seconds) reached
- **Context**: Must have correct game file loaded

### 7. Auto-Advance Logic ⏳

#### 7.1 When Goal Event Detected
1. **Check if Done button enabled**:
   - If enabled: Call `nextChallenge()` (automatic Done)
   - If disabled (failed win rule): Call `skipChallenge()` (automatic Skip)

2. **After Challenge Advance**:
   - If not last challenge: Automatically call `launchCurrentChallenge()` for next challenge
   - If last challenge: Complete run (call Done if enabled, else Skip)

#### 7.2 Challenge Advance Reset ⏳
When advancing to next challenge:
- Reset `usbPollingConditionATime` to 0
- Clear memory value tracking
- Wait for game launch verification before starting Condition A tracking

### 8. Auto Button Color Feedback ⏳

#### 8.1 Color States ✅
- **Light Blue**: Polling within 1.3 seconds (1300ms) ✅
- **Light Red**: Polling exceeds 1.3 seconds (1300ms) ✅
- **Orange**: Wrong game file loaded (SNES Info mismatch) ✅

#### 8.2 Polling Performance ✅
- **Measure**: Time between polls (compare `usbPollingLastPollTime`) ✅
- **Threshold**: 1300ms (1.3 seconds) ✅
- **Update**: Apply CSS class to Poll USB button dynamically ✅

**TODO**: 
- Find Auto button in DOM
- Add CSS classes: `.poll-status-good`, `.poll-status-slow`, `.poll-status-wrong-file`
- Apply classes based on polling performance

### 9. Integration Points

#### 9.1 Run Start ⏳
- **Location**: `startRun()` function
- **Action**: Call `loadUsbPollingState()` after run loads
- **Timing**: After prediction state loaded, before other initialization

#### 9.2 Challenge Advance ⏳
- **Locations**: 
  - `nextChallenge()` - Manual Done
  - `skipChallenge()` - Manual Skip
  - Auto-advance (from polling)
- **Action**: Reset Condition A time, clear memory tracking

#### 9.3 Run Stop/Cancel ⏳
- **Location**: `cancelRun()`, `completeRun()`
- **Action**: Stop polling, clear interval, reset state

#### 9.4 Pause/Unpause ⏳
- **Location**: `pauseRun()`, `unpauseRun()`
- **Action**: Stop polling when paused, resume when unpaused
- **Note**: Condition A requires timer running (not paused)

### 10. IPC Handlers

#### 10.1 Required New Handlers ⏳

##### `usb2snes:info`
- **Purpose**: Get SNES Info (firmware, ROM filename, etc.)
- **Location**: `electron/ipc-handlers.js`
- **Implementation**: Call `snesWrapper.Info()`
- **Returns**: `{ firmwareversion, versionstring, romrunning, flag1, flag2 }`
- **Exposure**: Add to `electron/preload.js`

##### `db:runs:update-config`
- **Purpose**: Update `runs.config_json` field
- **Location**: `electron/ipc-handlers.js`
- **Parameters**: `{ runUuid, configJson }`
- **Action**: Parse existing config, merge updates, save back
- **Exposure**: Add to `electron/preload.js`

#### 10.2 Existing Handlers Used ✅
- `usb2snes:status` - Connection status
- `usb2snes:connect` - Connect/reconnect
- `usb2snesReadMemoryBatch` - Batch memory read

---

## Implementation Steps

### Phase 1: Complete State Management ✅
- [x] Add state variables
- [x] Create toggle function skeleton
- [ ] Complete `saveUsbPollingState()` implementation
- [ ] Complete `loadUsbPollingState()` implementation
- [ ] Add IPC handler for `db:runs:update-config`
- [ ] Test state persistence across restarts

### Phase 2: IPC Infrastructure ⏳
- [ ] Implement `usb2snes:info` IPC handler
- [ ] Expose `usb2snes:info` in preload.js
- [ ] Implement `db:runs:update-config` IPC handler
- [ ] Expose `db:runs:update-config` in preload.js
- [ ] Test IPC handlers

### Phase 3: Connection & Info Polling ⏳
- [ ] Complete connection status check in polling cycle
- [ ] Implement auto-reconnect logic
- [ ] Implement SNES Info polling
- [ ] Implement ROM filename extraction
- [ ] Implement game file verification
- [ ] Add Orange button state for wrong file

### Phase 4: Memory Polling Infrastructure ⏳
- [ ] Complete `pollMemoryAddresses()` function
- [ ] Implement address batch conversion
- [ ] Implement batch memory read call
- [ ] Implement memory value storage
- [ ] Implement previous/current value comparison
- [ ] Test memory polling

### Phase 5: Condition A Logic ⏳
- [ ] Implement prerequisite checks (timer running, 5+ seconds)
- [ ] Implement Condition A evaluation (all zeros check)
- [ ] Implement Condition A timing (10 second threshold)
- [ ] Implement Condition A reset logic
- [ ] Test Condition A tracking

### Phase 6: Goal Event Detection ⏳
- [ ] Implement change detection for each goal event
- [ ] Implement goal event triggers (after Condition A threshold)
- [ ] Test each goal event type
- [ ] Handle edge cases (multiple events, timing)

### Phase 7: Auto-Advance Logic ⏳
- [ ] Implement auto Done/Skip on goal detection
- [ ] Implement auto Launch for next challenge
- [ ] Implement run completion logic
- [ ] Test auto-advance flow
- [ ] Handle edge cases (last challenge, disabled buttons)

### Phase 8: Auto Button Color Feedback ✅
- [x] Implement polling performance measurement (Phase 3)
- [x] Add CSS classes for color states (Phase 3)
- [x] Implement dynamic class application (Phase 3)
- [ ] Test color changes
- [ ] Handle edge cases

### Phase 9: Integration & Cleanup ✅
- [x] Integrate with `startRun()` ✅
- [x] Integrate with challenge advance functions ✅
- [x] Integrate with pause/unpause ✅
- [x] Integrate with run stop/cancel ✅
- [x] Clean up polling on run end ✅
- [ ] Test full lifecycle

### Phase 10: UI Polish ⏳
- [ ] Add CSS styling for Poll USB button
- [ ] Style checkbox toggle
- [ ] Add active state styling
- [ ] Test UI responsiveness
- [ ] Verify button visibility conditions

### Phase 11: Testing & Refinement ⏳
- [ ] Test all goal events
- [ ] Test Condition A edge cases
- [ ] Test state persistence
- [ ] Test auto-reconnect
- [ ] Test performance under load
- [ ] Fix any bugs
- [ ] Optimize polling efficiency

---

## Technical Details

### Memory Address Format
- **Input**: SNES RAM addresses (0x7Exxxx format)
- **Conversion**: 0x7E0000-0x7FFFFF → 0xF50000-0xF6FFFF
- **Protocol**: USB2SNES GetAddress format
- **Batch**: All addresses in single GetAddress call

### Polling Frequency
- **Main Cycle**: 1000ms (1 second)
- **Performance Threshold**: 1300ms (1.3 seconds)
- **Condition A Threshold**: 10000ms (10 seconds)
- **Challenge Prerequisite**: 5000ms (5 seconds)

### State Persistence Format
```json
{
  "usbPolling": {
    "enabled": true,
    "updatedAt": 1234567890
  }
}
```

### SNES Info Format
From `usb2snesTypeA.Info()`:
```javascript
{
  firmwareversion: string,  // e.g., "1.11.0"
  versionstring: string,    // e.g., "FW 1.11.0"
  romrunning: string,       // e.g., "/work/run251130_1837/30_1764463051_2lvno11.sfc"
  flag1: string,
  flag2: string
}
```

### Goal Event Detection Format
Compare memory values between cycles:
```typescript
// Last cycle values
usbPollingLastMemoryValues = {
  endtimer: 0,
  fanfare: 0,
  // ...
}

// Current cycle values
usbPollingCurrentMemoryValues = {
  endtimer: 5,  // Changed from 0 → non-zero = TRIGGER
  fanfare: 0,
  // ...
}
```

---

## File Changes Summary

### Files to Modify
1. **electron/renderer/src/App.vue**
   - ✅ Modal close prevention (line 1082)
   - ✅ Poll USB button UI (line 1111)
   - ✅ State variables (lines 17825-17832)
   - ✅ Foundation functions (lines 26805-26989)
   - ⏳ Complete all polling logic
   - ⏳ Add integration points
   - ⏳ Add CSS styles

2. **electron/ipc-handlers.js**
   - ⏳ Add `usb2snes:info` handler
   - ⏳ Add `db:runs:update-config` handler

3. **electron/preload.js**
   - ⏳ Expose `usb2snesInfo`
   - ⏳ Expose `updateRunConfig`

4. **electron/main/usb2snes/usb2snesTypeA.js**
   - ✅ `Info()` method exists (line 316)

### Files to Create
- None (all changes in existing files)

---

## Testing Checklist

### Basic Functionality
- [ ] Poll USB button appears when Launch button appears
- [ ] Toggle enables/disables polling
- [ ] State persists across run restarts
- [ ] Polling stops when run ends/cancels

### Connection Management
- [ ] Auto-reconnects when disconnected
- [ ] Handles connection errors gracefully
- [ ] Doesn't spam reconnect attempts

### Game Verification
- [ ] Detects correct game file
- [ ] Detects wrong game file
- [ ] Orange button state works
- [ ] Condition A holds at 0 for wrong file

### Condition A
- [ ] Requires 5+ seconds elapsed
- [ ] Requires timer running (not paused)
- [ ] Requires all values at 0x00
- [ ] Tracks 10-second threshold correctly
- [ ] Resets on challenge advance
- [ ] Resets when condition becomes false

### Goal Detection
- [ ] Detects endtimer change
- [ ] Detects fanfare change
- [ ] Detects bossDefeat change
- [ ] Detects keyhole_timer change
- [ ] Detects switch changes
- [ ] Detects peach change (0→1)
- [ ] Detects victory change
- [ ] Only triggers after Condition A threshold

### Auto-Advance
- [ ] Auto-clicks Done when enabled
- [ ] Auto-clicks Skip when Done disabled
- [ ] Auto-launches next challenge
- [ ] Handles last challenge correctly
- [ ] Resets Condition A after advance

### Performance
- [ ] Polls within 1.3 seconds
- [ ] Blue button when performing well
- [ ] Red button when slow
- [ ] Doesn't block UI

### Edge Cases
- [ ] Multiple goal events simultaneously
- [ ] Polling disabled mid-challenge
- [ ] Run paused during polling
- [ ] Challenge skipped manually
- [ ] Network interruptions
- [ ] USB2SNES device unplugged

---

## Notes & Considerations

### Performance
- Batch memory reads are more efficient than individual reads
- 1-second polling interval is reasonable for game state detection
- Should not impact game performance significantly

### Reliability
- Auto-reconnect handles temporary disconnections
- Game file verification prevents false positives
- Condition A threshold prevents premature triggers

### User Control
- User can disable polling at any time
- Manual controls (Done/Skip) still work
- Polling respects pause state

### Future Enhancements
- Could add configurable polling interval
- Could add more goal events
- Could add polling statistics/analytics
- Could add prediction integration

---

## References

### Related Documentation
- `devdocs/USB2SNES_COMPLETE_SUMMARY.md` - USB2SNES integration details
- `devdocs/USB2SNES_IMPLEMENTATION_PLAN.md` - Previous USB2SNES work
- `docs/RUN_EXECUTION_IMPLEMENTATION.md` - Run system architecture
- `docs/COMPLETE_RUN_SYSTEM_SUMMARY.md` - Run system details

### Related Code
- `electron/main/usb2snes/usb2snesTypeA.js` - USB2SNES protocol implementation
- `electron/main/chat/SMWChatCommands.js` - Memory address conversion example
- `electron/renderer/src/App.vue` - Main application UI and logic

---

**Last Updated**: January 2025  
**Next Steps**: Continue with Phase 1 completion (IPC handlers and state persistence)

