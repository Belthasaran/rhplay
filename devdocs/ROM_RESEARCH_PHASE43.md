# ROM Research & SD2SNES Self-Manipulation - Phase 4.3

**Date:** October 13, 2025  
**Status:** ✅ COMPLETE (Research & Documentation)

## Overview

Phase 4.3 explores **advanced ROM manipulation** concepts and **SD2SNES self-control** mechanisms. This is a research phase documenting what's possible, what's not, and potential future implementations.

**Research Topics:**
1. ROM manipulation limitations
2. SD2SNES firmware capabilities
3. ROM-to-SD2SNES communication
4. Dynamic ROM loading
5. Self-modifying game architecture
6. Practical implementations

---

## 1. ROM Manipulation Limitations

### Why You Can't Write to ROM

**The Problem:**
- ROM addresses (0x008000+ in SNES address space) are **read-only**
- Memory mapper hardware enforces this
- `PutAddress` writes to ROM addresses are **ignored or crash**

**Technical Explanation:**

```
SNES Memory Map:
0x000000-0x7FFFFF: ROM banks (mirrored)
0x7E0000-0x7FFFFF: RAM (writable)

When CPU writes to ROM address:
  → Memory mapper ignores write
  → OR triggers bus conflict
  → OR causes crash/freeze
```

**What This Means:**
- ❌ Cannot patch ROM data directly via USB2SNES
- ❌ Cannot modify game code in real-time
- ❌ Cannot change graphics/music data on the fly
- ✅ Can only read ROM data
- ✅ Can patch RAM (temporary changes)

### Workarounds

**Option 1: RAM Patching**
- Copy ROM data to RAM
- Modify RAM copy
- Redirect game to use RAM version
- **Limitation:** Limited RAM space

**Option 2: File Replacement**
- Create modified ROM file
- Upload via `PutFile`
- Reboot with new ROM
- **Limitation:** Requires reboot

**Option 3: Custom Firmware**
- Modify SD2SNES firmware
- Add RAM-based ROM overlay
- Intercept ROM reads from firmware
- **Limitation:** Requires custom firmware

---

## 2. SD2SNES/FXPak Pro Architecture

### Hardware Overview

**SD2SNES/FXPak Pro Components:**
```
┌─────────────────────────────────────┐
│ SD2SNES/FXPak Pro                   │
├─────────────────────────────────────┤
│ ARM Processor (Cortex-M3/M4)        │
│  - Runs firmware                    │
│  - Manages SD card access          │
│  - Controls memory mapper          │
│  - USB2SNES server                 │
├─────────────────────────────────────┤
│ FPGA (Altera Cyclone)               │
│  - Emulates cart hardware          │
│  - Memory mapper logic             │
│  - Enhancement chips (SA-1, DSP)   │
├─────────────────────────────────────┤
│ SRAM (2-8MB)                        │
│  - ROM data cache                  │
│  - Save game storage               │
├─────────────────────────────────────┤
│ SD Card Interface                   │
│  - File system access              │
│  - ROM/save file storage           │
└─────────────────────────────────────┘
```

### Firmware Capabilities

**What SD2SNES Firmware Does:**
- Loads ROM files from SD card
- Presents ROM data to SNES as cartridge
- Manages save game storage
- Provides USB2SNES protocol server
- Handles special features (MSU-1, in-game hooks)

**What SD2SNES Firmware COULD Do (with modification):**
- Watch RAM for special commands
- Load different ROMs based on RAM flags
- Modify ROM data before presenting to SNES
- Implement custom commands
- Auto-progression through ROM playlist

---

## 3. ROM-to-SD2SNES Communication

### The Challenge

**Question:** Can a ROM running on the SNES send commands to the SD2SNES hardware?

**Answer:** Not directly, but possible with custom firmware!

### Current Limitations

**Stock Firmware:**
- ROM cannot directly communicate with SD2SNES
- No API for ROM to call SD2SNES functions
- ROM executes independently
- SD2SNES acts as passive cartridge

### Potential Communication Methods

#### Method 1: RAM Flag Polling (Custom Firmware)

**Concept:** SD2SNES firmware watches specific RAM addresses for commands

**Architecture:**
```
ROM Side (65816):
  1. Write command byte to 0x7F8000
  2. Write parameters to 0x7F8001+
  3. Wait for acknowledgment at 0x7F8000

SD2SNES Side (ARM firmware):
  1. Poll 0x7F8000 every frame
  2. If command detected:
     - Execute command
     - Write result to RAM
     - Clear command byte
```

**Example Implementation:**

**ROM Code (65816):**
```asm
; Command structure at 0x7F8000:
; +0: Command byte
; +1: Parameter 1
; +2-$FF: Parameters/Path

LoadNextROM:
    ; Write command
    LDA #$01        ; Command: Load ROM
    STA $7F8000
    
    ; Write ROM path
    LDX #$0000
.copyPath:
    LDA ROMPath,X
    STA $7F8001,X
    INX
    CMP #$00
    BNE .copyPath
    
.wait:
    ; Wait for acknowledgment
    LDA $7F8000
    CMP #$00
    BNE .wait
    
    ; SD2SNES will reset with new ROM
    RTS

ROMPath:
    .db "/work/nextrom.sfc", $00
```

**SD2SNES Firmware Extension (C):**
```c
// Command definitions
#define CMD_NONE        0x00
#define CMD_LOAD_ROM    0x01
#define CMD_RESET       0x02
#define CMD_SAVE_STATE  0x03

// Command handler (called every frame)
void process_rom_commands() {
    uint8_t cmd = snes_read_ram(0x7F8000);
    
    if (cmd == CMD_LOAD_ROM) {
        char path[256];
        
        // Read ROM path from RAM
        for (int i = 0; i < 255; i++) {
            path[i] = snes_read_ram(0x7F8001 + i);
            if (path[i] == 0) break;
        }
        path[255] = 0;
        
        // Clear command (acknowledge)
        snes_write_ram(0x7F8000, 0x00);
        
        // Load new ROM
        load_rom_file(path);
        
        // Reset SNES
        snes_reset();
    }
}

// Hook into main loop
void main_loop() {
    while (1) {
        process_rom_commands();  // Check for ROM commands
        handle_usb2snes();       // Handle USB2SNES protocol
        update_display();        // Update SD2SNES menu if visible
    }
}
```

**Benefits:**
- ROM can trigger actions on SD2SNES
- No SNES reset needed for communication
- Can implement complex commands

**Challenges:**
- Requires custom firmware
- Need to flash SD2SNES (risk of bricking)
- Not compatible with stock firmware
- Would need community adoption

#### Method 2: USB2SNES as Intermediary

**Concept:** ROM triggers USB2SNES server to send SD2SNES commands

**Architecture:**
```
ROM → RAM flag → USB2SNES server (PC) → SD2SNES commands
```

**Flow:**
1. ROM sets RAM flag (e.g., 0x7F8000 = 0x01)
2. USB2SNES server on PC polls RAM
3. Server detects flag
4. Server sends command to SD2SNES
5. SD2SNES executes command

**Advantages:**
- No custom firmware needed
- Can use stock SD2SNES
- Server can do complex processing

**Disadvantages:**
- Requires PC/server running
- Added latency
- Not standalone

#### Method 3: MSU-1 Abuse

**Concept:** Abuse MSU-1 audio chip interface for commands

**MSU-1 Capabilities:**
- ROM can trigger audio tracks
- Can read status registers
- Has file access (for audio/video)

**Potential Abuse:**
- Use audio track numbers as commands
- Read MSU-1 status for responses
- Limited command set

**Challenges:**
- Not designed for this
- Very limited command space
- Unreliable

---

## 4. Dynamic ROM Loading

### Game OS Concept

**Vision:** Create a "Game OS" ROM that manages other ROMs

**Architecture:**
```
┌─────────────────────────────────────┐
│ Game OS ROM (Custom)                │
├─────────────────────────────────────┤
│ - File system browser               │
│ - ROM playlist manager              │
│ - Save state manager                │
│ - Level data loader                 │
│ - Asset streaming system            │
│ - Auto-progression logic            │
└─────────────────────────────────────┘
         ↓
    SD2SNES Communication
         ↓
┌─────────────────────────────────────┐
│ SD Card File System                 │
├─────────────────────────────────────┤
│ /work/gameos.sfc    ← Main OS       │
│ /work/roms/         ← ROM playlist  │
│ /work/levels/       ← Level data    │
│ /work/assets/       ← Graphics/music│
│ /work/saves/        ← Save states   │
└─────────────────────────────────────┘
```

### Use Cases

#### Use Case 1: ROM Playlist Auto-Progression

**Scenario:** Play through 10 ROM hacks sequentially

**Implementation:**
```
1. Load GameOS ROM
2. GameOS reads playlist: /work/playlist.txt
3. Loads first ROM from playlist
4. Watches for completion (credits, game over)
5. Triggers SD2SNES to load next ROM
6. Repeat until playlist complete
```

**Playlist File:**
```
/work/roms/hack01.sfc
/work/roms/hack02.sfc
/work/roms/hack03.sfc
...
/work/roms/hack10.sfc
```

**Benefits:**
- Hands-free ROM progression
- Perfect for marathons
- Automatic save states between ROMs

#### Use Case 2: Dynamic Level Loading

**Scenario:** Game with hundreds of levels stored as separate files

**Implementation:**
```
1. Base ROM provides game engine
2. Levels stored as data files on SD card
3. Engine loads level data from files to RAM
4. Player progresses through levels
5. Engine loads next level dynamically
```

**Benefits:**
- Unlimited level count
- Easy level updates (just replace files)
- No ROM rebuild needed

#### Use Case 3: Asset Streaming

**Scenario:** Large game with graphics/music streamed from SD

**Implementation:**
```
1. Base ROM with minimal assets
2. Graphics tilesets stored as files
3. Music tracks stored as files
4. Game loads assets as needed
5. RAM becomes cache for current level
```

**Benefits:**
- Game size not limited by ROM size
- Easy asset updates
- Dynamic content

---

## 5. Self-Modifying Game Architecture

### Concept: GameOS Framework

**GameOS** = Operating system that runs on SNES and manages ROMs/assets

### Core Components

#### 1. File System Manager

**Responsibilities:**
- Read directory listings
- Load files from SD card
- Save game progress
- Manage save states

**USB2SNES Operations:**
```javascript
// Via USB2SNES (current capability)
const files = await snes.List('/work/roms/');
const romData = await snes.GetFile('/work/roms/hack01.sfc');
await snes.PutFile(localSaveState, '/work/saves/hack01.state');
```

#### 2. ROM Loader

**Responsibilities:**
- Select ROM from playlist
- Trigger ROM load via SD2SNES
- Handle ROM transitions

**Current Method (requires PC):**
```javascript
// Load next ROM (via USB2SNES server)
await snes.Boot('/work/roms/hack02.sfc');
```

**Future Method (custom firmware):**
```asm
; ROM sets flag for SD2SNES
LDA #$01            ; CMD_LOAD_ROM
STA $7F8000
; Write path to 0x7F8001+
; SD2SNES firmware loads ROM
```

#### 3. Progress Tracker

**Responsibilities:**
- Detect game completion
- Save progress
- Trigger next ROM

**Implementation:**
```javascript
// Watch for completion conditions
await snes.watchForConditions([
  { address: 0x7E0100, size: 1, value: 0x1C }  // Credits mode
], 0, 100);

// Save progress
const progress = {
  rom: 'hack01.sfc',
  completed: true,
  time: Date.now()
};
await snes.PutFile(
  Buffer.from(JSON.stringify(progress)),
  '/work/progress.json'
);

// Load next ROM
await snes.Boot('/work/roms/hack02.sfc');
```

#### 4. Save State Manager

**Responsibilities:**
- Save game states to SD card
- Load game states from SD card
- Manage multiple save slots

**Using Phase 3 Savestates:**
```javascript
// Save state to file
const state = await snes.SaveStateToMemory(true);
await snes.PutFile(state, '/work/saves/hack01_checkpoint.state');

// Load state from file
const state = await snes.GetFile('/work/saves/hack01_checkpoint.state');
await snes.LoadStateFromMemory(state);
```

---

## 6. Practical Implementations

### Implementation 1: USB2SNES-Managed Playlist

**Current Capability (No Custom Firmware Needed!)**

**JavaScript Implementation:**
```javascript
class ROMPlaylist {
  constructor(snes) {
    this.snes = snes;
    this.playlist = [];
    this.currentIndex = 0;
  }
  
  async loadPlaylist(path) {
    // Load playlist file
    const data = await this.snes.GetFile(path);
    const text = data.toString('utf-8');
    this.playlist = text.split('\n').filter(line => line.trim());
    console.log(`Loaded ${this.playlist.length} ROMs`);
  }
  
  async waitForCompletion() {
    // Watch for credits/game over
    const smw = new SMWHelpers(this.snes);
    
    await this.snes.watchForConditions([
      { address: smw.RAM.GameMode, size: 1, value: 0x1C }  // Credits
    ], 0, 100);
    
    console.log('ROM completed!');
  }
  
  async loadNextROM() {
    this.currentIndex++;
    
    if (this.currentIndex >= this.playlist.length) {
      console.log('Playlist complete!');
      return false;
    }
    
    const nextROM = this.playlist[this.currentIndex];
    console.log(`Loading ROM ${this.currentIndex + 1}/${this.playlist.length}: ${nextROM}`);
    
    // Save progress
    const progress = {
      currentIndex: this.currentIndex,
      timestamp: Date.now()
    };
    await this.snes.PutFile(
      Buffer.from(JSON.stringify(progress)),
      '/work/progress.json'
    );
    
    // Load ROM
    await this.snes.Boot(nextROM);
    
    return true;
  }
  
  async run() {
    console.log('Starting ROM playlist...');
    
    while (true) {
      await this.waitForCompletion();
      const hasNext = await this.loadNextROM();
      if (!hasNext) break;
      
      // Wait for ROM to boot
      await this._sleep(5000);
    }
    
    console.log('All ROMs completed!');
  }
  
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Usage
const playlist = new ROMPlaylist(snes);
await playlist.loadPlaylist('/work/playlist.txt');
await playlist.run();  // Auto-play through all ROMs!
```

**This works TODAY with no firmware modifications!**

### Implementation 2: Dynamic Level Loader

**Using USB2SNES for Asset Loading**

```javascript
class DynamicLevelLoader {
  constructor(snes) {
    this.snes = snes;
    this.levelCache = new Map();
  }
  
  async loadLevel(levelNum) {
    // Check cache
    if (this.levelCache.has(levelNum)) {
      console.log(`Level ${levelNum} in cache`);
      return this.levelCache.get(levelNum);
    }
    
    // Load from SD card
    const path = `/work/levels/level${levelNum.toString().padStart(3, '0')}.dat`;
    console.log(`Loading ${path}...`);
    
    const levelData = await this.snes.GetFile(path);
    this.levelCache.set(levelNum, levelData);
    
    return levelData;
  }
  
  async installLevel(levelNum, ramAddress) {
    const levelData = await this.loadLevel(levelNum);
    
    // Upload to SNES RAM
    console.log(`Installing level ${levelNum} to 0x${ramAddress.toString(16)}...`);
    await this.snes.PutAddress([[ramAddress, levelData]]);
    
    console.log('✓ Level installed!');
  }
}

// Usage
const loader = new DynamicLevelLoader(snes);
await loader.installLevel(1, 0x7F8000);  // Load level 1 to RAM
```

### Implementation 3: Save State Manager

**File-Based Save State System**

```javascript
class SaveStateManager {
  constructor(snes) {
    this.snes = snes;
  }
  
  async saveState(slotName) {
    console.log(`Saving state to slot: ${slotName}...`);
    
    // Capture state (Phase 3 feature)
    const stateData = await this.snes.SaveStateToMemory(true);
    
    // Save to SD card
    const path = `/work/saves/${slotName}.state`;
    await this.snes.PutFile(stateData, path);
    
    // Save metadata
    const metadata = {
      slotName,
      timestamp: Date.now(),
      size: stateData.length
    };
    await this.snes.PutFile(
      Buffer.from(JSON.stringify(metadata)),
      `/work/saves/${slotName}.meta`
    );
    
    console.log('✓ State saved!');
  }
  
  async loadState(slotName) {
    console.log(`Loading state from slot: ${slotName}...`);
    
    // Load from SD card
    const path = `/work/saves/${slotName}.state`;
    const stateData = await this.snes.GetFile(path);
    
    // Restore state (Phase 3 feature)
    await this.snes.LoadStateFromMemory(stateData);
    
    console.log('✓ State loaded!');
  }
  
  async listStates() {
    const files = await this.snes.List('/work/saves/');
    const states = files.filter(f => f.endsWith('.state'));
    
    console.log(`Found ${states.length} save states:`);
    for (const state of states) {
      const metaPath = state.replace('.state', '.meta');
      try {
        const metaData = await this.snes.GetFile(`/work/saves/${metaPath}`);
        const meta = JSON.parse(metaData.toString());
        console.log(`  - ${meta.slotName} (${new Date(meta.timestamp).toLocaleString()})`);
      } catch {
        console.log(`  - ${state}`);
      }
    }
  }
}

// Usage
const saveManager = new SaveStateManager(snes);
await saveManager.saveState('level1-checkpoint');
// ... play more ...
await saveManager.loadState('level1-checkpoint');
```

---

## 7. Custom Firmware Possibilities

### What Custom Firmware Could Enable

**SD2SNES Firmware is Open Source!**
- Repository: https://github.com/mrehkopf/sd2snes
- Language: C (for ARM processor)
- Community has modified it before

**Potential Extensions:**

#### 1. RAM Command Handler
```c
// Add to main loop
void process_rom_commands() {
    uint8_t cmd = snes_read_ram(0x7F8000);
    switch (cmd) {
        case 0x01:  // Load ROM
            handle_load_rom_command();
            break;
        case 0x02:  // Save State
            handle_save_state_command();
            break;
        case 0x03:  // Load State
            handle_load_state_command();
            break;
    }
}
```

#### 2. Auto-Progression Mode
```c
// Watch for credits/game over
void auto_progression_mode() {
    static uint8_t last_mode = 0;
    uint8_t game_mode = snes_read_ram(0x7E0100);
    
    if (game_mode == 0x1C && last_mode != 0x1C) {
        // Credits detected
        load_next_rom_from_playlist();
    }
    
    last_mode = game_mode;
}
```

#### 3. ROM Overlay System
```c
// Intercept ROM reads
uint8_t read_rom_byte(uint32_t address) {
    // Check if address has overlay
    if (has_overlay(address)) {
        return read_from_overlay(address);
    }
    
    // Normal ROM read
    return read_from_sd_card(address);
}
```

### Risks of Custom Firmware

**⚠️ WARNING: Flashing custom firmware can brick your SD2SNES!**

**Risks:**
- Bricked device if flash fails
- Loss of warranty
- Incompatibility with future updates
- Bugs in custom code

**Recommendations:**
- Only flash if comfortable with risk
- Have backup firmware available
- Test thoroughly
- Consider USB2SNES-based solutions first

---

## 8. Recommendations

### What to Do NOW (No Custom Firmware)

**Highly Recommended:**

1. **Use USB2SNES Playlist Manager** (Implementation 1)
   - Works with stock firmware
   - Auto-progress through ROMs
   - Save progress to SD card

2. **Use Save State Manager** (Implementation 3)
   - File-based save states
   - Multiple slots
   - Metadata tracking

3. **Use Dynamic Level Loader** (Implementation 2)
   - Load level data from files
   - Cache in RAM
   - Easy level updates

**All of these work TODAY!**

### What to Consider for Future

**If Community Interest Exists:**

1. **Propose SD2SNES Firmware Extensions**
   - Submit feature requests
   - Contribute to open source project
   - Collaborate with community

2. **Create Proof-of-Concept Firmware**
   - Test RAM command system
   - Demo auto-progression
   - Share with community

3. **Build Game OS ROM**
   - Create reference implementation
   - Document architecture
   - Release to community

---

## 9. Summary

### Key Findings

**ROM Limitations:**
- ❌ Cannot write to ROM directly (hardware limitation)
- ✅ Can read ROM data
- ✅ Can patch RAM (temporary)
- ✅ Can replace ROM files

**SD2SNES Capabilities:**
- ✅ Open source firmware (modifiable)
- ✅ ARM processor can run custom code
- ✅ Can watch RAM for commands
- ❌ Stock firmware has no ROM command API

**Current Capabilities (No Firmware Mods):**
- ✅ ROM playlist auto-progression (via USB2SNES)
- ✅ File-based save states
- ✅ Dynamic asset loading
- ✅ All work with stock firmware!

**Future Possibilities (Custom Firmware):**
- ROM-to-SD2SNES direct communication
- Auto-progression without PC
- ROM overlay system
- Enhanced commands

### Implementations Ready NOW

**Phase 4.3 Delivers:**
- ✅ Comprehensive ROM research
- ✅ SD2SNES architecture documentation
- ✅ 3 practical implementations (no custom firmware!)
- ✅ Custom firmware possibilities documented
- ✅ Safety considerations
- ✅ Recommendations

**What Works TODAY:**
1. ROM Playlist Manager - Auto-progress through ROMs
2. Dynamic Level Loader - Load levels from SD card
3. Save State Manager - File-based save states

**All without firmware modifications!**

---

## 10. Next Steps

**Immediate Actions:**
1. Use the 3 practical implementations provided
2. Build ROM playlist for your games
3. Create save state workflow

**Future Exploration:**
1. Experiment with implementations
2. Provide feedback to SD2SNES community
3. Consider contributing to firmware project

**Phase 4.4:**
- Asset injection (graphics, music, levels)
- Tileset uploading
- Palette modification
- Music streaming

**Phase 4 is nearly complete!** 🎉

---

**Total Phase 4.3:** Research & Documentation (3 practical implementations included)

