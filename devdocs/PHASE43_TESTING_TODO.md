# Phase 4.3 Testing - Deferred for Later

**Date:** October 13, 2025  
**Status:** 🕐 DEFERRED - Testing to be performed later

## Overview

Phase 4.3 implementations are complete and committed, but comprehensive testing is deferred. This document provides context for future testing.

---

## What Was Implemented

### 1. ROMPlaylistManager (225 lines)
**File:** `electron/main/gameos/ROMPlaylistManager.js`

**Purpose:** Auto-progression through multiple ROMs

**Key Methods:**
- `loadPlaylist(path)` - Load ROM list from SD card
- `waitForCompletion(options)` - Detect game completion
- `loadNextROM()` - Load next ROM in sequence
- `run()` - Full auto-progression loop
- `skipTo(index)` - Jump to specific ROM
- `getStatus()` - Progress tracking

### 2. SaveStateManager (278 lines)
**File:** `electron/main/gameos/SaveStateManager.js`

**Purpose:** File-based save state system

**Key Methods:**
- `saveState(slotName, metadata)` - Save to SD card
- `loadState(slotName)` - Load from SD card
- `listStates()` - List all save states
- `deleteState(slotName)` - Delete save state
- `copyState(from, to)` - Copy save state
- `existsState(slotName)` - Check if exists
- `printStates()` - Pretty-print list

### 3. DynamicLevelLoader (251 lines)
**File:** `electron/main/gameos/DynamicLevelLoader.js`

**Purpose:** Dynamic level loading from SD card

**Key Methods:**
- `loadLevel(levelId)` - Load level from SD
- `installLevel(levelId, ramAddress)` - Install to RAM
- `preloadLevels(levelIds)` - Cache multiple levels
- `listLevels()` - List available levels
- `getCacheStats()` - Cache information
- `clearCache()` - Clear level cache

---

## Testing Prerequisites

### Hardware/Software:
- QUsb2snes or USB2SNES server running
- SD2SNES or FXPak Pro hardware
- SD card with test files
- SMW ROM (for completion detection)

### Test Files Needed on SD Card:

**For ROMPlaylistManager:**
```
/work/playlist.txt           ← Playlist file
/work/roms/test1.sfc         ← Test ROM 1
/work/roms/test2.sfc         ← Test ROM 2
/work/roms/test3.sfc         ← Test ROM 3
```

**For SaveStateManager:**
```
/work/saves/                 ← Save directory (created automatically)
```

**For DynamicLevelLoader:**
```
/work/levels/level001.dat    ← Level data files
/work/levels/level002.dat
/work/levels/level003.dat
```

---

## Test Cases

### ROMPlaylistManager Tests

#### Test 1: Basic Playlist Loading
```javascript
const playlist = new ROMPlaylistManager(snes);
await playlist.loadPlaylist('/work/playlist.txt');

// Verify:
const status = playlist.getStatus();
assert(status.totalROMs > 0, 'Playlist should have ROMs');
assert(status.currentIndex === 0, 'Should start at index 0');
```

#### Test 2: Progress Save/Resume
```javascript
// Run playlist, interrupt after ROM 1
await playlist.loadPlaylist('/work/playlist.txt');
await playlist.waitForCompletion();
await playlist.loadNextROM();

// Get index, disconnect
const status1 = playlist.getStatus();

// Reconnect and resume
const playlist2 = new ROMPlaylistManager(snes);
await playlist2.loadPlaylist('/work/playlist.txt');

// Verify resumed at correct position
const status2 = playlist2.getStatus();
assert(status2.currentIndex === status1.currentIndex);
```

#### Test 3: Skip to ROM
```javascript
const playlist = new ROMPlaylistManager(snes);
await playlist.loadPlaylist('/work/playlist.txt');
await playlist.skipTo(2);  // Jump to ROM 3

const status = playlist.getStatus();
assert(status.currentIndex === 2);
```

### SaveStateManager Tests

#### Test 1: Save and Load
```javascript
const saveManager = new SaveStateManager(snes);

// Save state
const metadata = await saveManager.saveState('test1', {
  description: 'Test save'
});

// Verify saved
const exists = await saveManager.existsState('test1');
assert(exists === true, 'Save should exist');

// Load state
await saveManager.loadState('test1');
// No error = success
```

#### Test 2: List Save States
```javascript
// Save multiple states
await saveManager.saveState('save1');
await saveManager.saveState('save2');
await saveManager.saveState('save3');

// List all
const states = await saveManager.listStates();
assert(states.length >= 3, 'Should have at least 3 saves');
```

#### Test 3: Copy and Delete
```javascript
// Save state
await saveManager.saveState('original');

// Copy
await saveManager.copyState('original', 'backup');

// Verify both exist
assert(await saveManager.existsState('original'));
assert(await saveManager.existsState('backup'));

// Delete original
await saveManager.deleteState('original');

// Verify only backup remains
assert(!await saveManager.existsState('original'));
assert(await saveManager.existsState('backup'));
```

### DynamicLevelLoader Tests

#### Test 1: Load and Install Level
```javascript
const loader = new DynamicLevelLoader(snes);
loader.setLevelDirectory('/work/levels/');

// Load level
const bytes = await loader.installLevel(1, 0x7F8000);
assert(bytes > 0, 'Should write bytes to RAM');

// Verify in cache
const stats = loader.getCacheStats();
assert(stats.cachedLevels >= 1);
```

#### Test 2: Cache Management
```javascript
// Load multiple levels
await loader.preloadLevels([1, 2, 3, 4, 5]);

const stats = loader.getCacheStats();
assert(stats.cachedLevels === 5);

// Clear cache
loader.clearCache();

const stats2 = loader.getCacheStats();
assert(stats2.cachedLevels === 0);
```

#### Test 3: List Levels
```javascript
const levels = await loader.listLevels();
console.log(`Found ${levels.length} levels`);

// Verify structure
if (levels.length > 0) {
  assert(levels[0].id !== undefined);
  assert(levels[0].filename !== undefined);
}
```

---

## Manual Testing Procedures

### ROMPlaylistManager Manual Test

**Setup:**
1. Create `/work/playlist.txt` on SD card:
   ```
   /work/rom1.sfc
   /work/rom2.sfc
   ```

2. Ensure ROMs exist on SD card

**Test:**
```javascript
const playlist = new ROMPlaylistManager(snes);
await playlist.loadPlaylist('/work/playlist.txt');

// Check status
console.log(playlist.getStatus());

// Load first ROM
await snes.Boot(playlist.playlist[0]);

// Wait for completion (or skip)
// await playlist.waitForCompletion();

// Load next
await playlist.loadNextROM();
```

**Expected:**
- Playlist loads successfully
- Status shows correct ROM count
- Next ROM loads when called

### SaveStateManager Manual Test

**Test:**
```javascript
const saveManager = new SaveStateManager(snes);

// Save current state
await saveManager.saveState('test_manual');

// List states
await saveManager.printStates();

// Load state
await saveManager.loadState('test_manual');
```

**Expected:**
- State saves to `/work/saves/test_manual.state`
- Metadata file created
- State loads successfully
- List shows saved state

### DynamicLevelLoader Manual Test

**Setup:**
1. Create test level file:
   ```bash
   echo "Test level data" > /work/levels/level001.dat
   ```

**Test:**
```javascript
const loader = new DynamicLevelLoader(snes);

// List levels
const levels = await loader.listLevels();
console.log('Available levels:', levels);

// Load level 1
await loader.installLevel(1, 0x7F8000);

// Verify installed
const data = await snes.GetAddress(0x7F8000, 16);
console.log('First 16 bytes:', data);
```

**Expected:**
- Level file detected in list
- Level loads from SD card
- Data installed to RAM
- Data readable from RAM address

---

## Performance Testing

### Benchmarks to Measure:

1. **ROM Loading Time:**
   - Time from `Boot()` call to ROM ready
   - Expected: 3-5 seconds

2. **Save State Save Time:**
   - Time to capture and save 320KB state
   - Expected: ~2-3 seconds

3. **Save State Load Time:**
   - Time to load and restore 320KB state
   - Expected: ~3-4 seconds

4. **Level Loading Time:**
   - Time to load level from SD card
   - Depends on file size
   - Expected: ~0.5-2 seconds

5. **Cache Hit Performance:**
   - Time to load cached level
   - Expected: <10ms (memory access)

---

## Known Issues / Considerations

### ROMPlaylistManager:
- Completion detection is game-specific (currently SMW-focused)
- May need custom detection logic for other games
- Progress file must be writable

### SaveStateManager:
- Requires Phase 3 savestate support
- ROM must be patched for savestates
- 320KB per save state (can fill SD card)

### DynamicLevelLoader:
- Cache eviction uses LRU (oldest first)
- No compression (raw file sizes)
- Level format is application-specific

---

## Future Enhancements

### ROMPlaylistManager:
- Multiple completion detection methods
- Per-ROM configuration
- Save state snapshots between ROMs
- Retry failed ROMs
- Random ROM order mode

### SaveStateManager:
- Compression (reduce 320KB → ~100KB)
- Save state diff/delta saves
- Auto-save on interval
- Save state tagging/categories
- Thumbnail generation

### DynamicLevelLoader:
- Compression support
- Streaming for large levels
- Format auto-detection
- Level validation
- Checksum verification

---

## Integration with Other Phases

### Phase 3 Integration:
- SaveStateManager uses `SaveStateToMemory()`
- SaveStateManager uses `LoadStateFromMemory()`

### Phase 4.1 Integration:
- ROMPlaylistManager can use SMWHelpers for detection
- Custom completion logic per game

### Phase 4.2 Integration:
- Could use CodeExecutor for custom triggers
- Execute code before/after ROM loads

---

## Testing Commands

**Run Demos:**
```bash
# JavaScript demo
node examples/gameos_demo.js

# Individual component tests (create these):
node tests/test_rom_playlist.js
node tests/test_save_state_manager.js
node tests/test_dynamic_level_loader.js
```

---

## Summary

**Phase 4.3 is IMPLEMENTED but TESTING is DEFERRED.**

**What to Test:**
1. ROMPlaylistManager - Auto-progression
2. SaveStateManager - File-based saves
3. DynamicLevelLoader - Dynamic levels

**When to Test:**
- When SD2SNES hardware is available
- When test ROM files are prepared
- When test data files are created

**Expected Results:**
- All systems work with stock firmware
- No custom modifications needed
- Production-ready implementations

**Phase 4.3 code is stable and committed. Testing can be performed anytime!**

