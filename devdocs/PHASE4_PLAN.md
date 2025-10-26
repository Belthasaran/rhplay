# Phase 4 Implementation Plan: SMW Helpers & Advanced Code Execution

**Date:** October 13, 2025  
**Status:** 🚧 IN PROGRESS

## Overview

Phase 4 focuses on **game-specific helpers** and **advanced code execution** techniques:

1. **SMW Helper Library** - Common RAM manipulations and game state changes
2. **Custom Code Execution** - Execute assembly on the console
3. **Advanced ROM Concepts** - ROM manipulation strategies and SD2SNES control
4. **Asset Injection** - Dynamic asset loading

---

## Phase 4 Components

### 1. SMW Helper Library (HIGH PRIORITY)

**Goal:** Create a comprehensive library of SMW-specific helper functions

**Features:**
- RAM address constants (from smwdisc_ram.txt)
- Player state helpers (lives, coins, powerup, position, speed)
- Level state helpers (vertical level, water level, screens, game mode)
- Sprite manipulation (spawn, move, kill)
- Yoshi helpers (color, wings, on/off)
- Item helpers (P-switch, ON/OFF blocks)
- Status helpers (animation states, flags)
- Advanced helpers (random bytes, timers, tweakers)

**Implementation:**
```javascript
// SMWHelpers.js
class SMWHelpers {
  constructor(snesWrapper) {
    this.snes = snesWrapper;
    this.RAM = { /* address constants */ };
  }
  
  // Player
  async getPowerup() { ... }
  async setPowerup(value) { ... }
  async getLives() { ... }
  async setLives(count) { ... }
  async getCoins() { ... }
  async setCoins(count) { ... }
  async getPosition() { ... }
  async setPosition(x, y) { ... }
  
  // Level State
  async getGameMode() { ... }
  async isInLevel() { ... }
  async isVerticalLevel() { ... }
  async isWaterLevel() { ... }
  
  // Yoshi
  async hasYoshi() { ... }
  async giveYoshi(color) { ... }
  async removeYoshi() { ... }
  
  // Advanced
  async freezeSprites(freeze) { ... }
  async setTimer(seconds) { ... }
  async triggerPSwitch() { ... }
}
```

**Use Cases:**
- Practice mode: Save lives/coins before attempt
- Challenge modes: Enforce specific powerup
- Speedrun tools: Check game state
- Auto-manipulation: SetPosition for testing
- TAS tools: Frame-perfect inputs

---

### 2. Custom Code Execution System (MEDIUM PRIORITY)

**Goal:** Execute custom 65816 assembly code on the SNES

**Concepts:**

#### A. CMD Space Execution (SD2SNES/FXPak Pro)
- Write assembly to CMD space (0x002C00)
- Trigger execution via hijack
- Return control to game
- **Limitations:** ~1KB code space, temporary

**Example:**
```javascript
// Execute custom code
const code = assemble65816(`
  LDA #$02      ; Cape powerup
  STA $0019     ; Store to powerup address
  RTS           ; Return
`);

await snes.ExecuteCode(code);
```

#### B. Free RAM Execution
- Write code to free RAM (0x7F8000+)
- Use NMI/IRQ hijack to call
- Persistent until reset
- **Limitations:** Must not conflict with game

#### C. Hook Injection
- Hijack existing game routines
- JSL to custom code
- Common hijacks: NMI, GameMode, PlayerCode
- **Limitations:** Requires ROM knowledge

**Implementation Strategy:**
1. Create assembly templates
2. Build 65816 assembler wrapper
3. Implement code upload system
4. Create hijack helpers

---

### 3. Advanced ROM Concepts (RESEARCH)

**Goal:** Explore ROM manipulation and SD2SNES self-control

#### A. ROM Limitations
- **Cannot PutAddress to ROM** - Memory mapper is read-only
- ROM at 0x008000+ (mirrored across banks)
- Writes ignored or crash console
- **Workaround:** PutAddress to RAM, then copy to ROM via custom code (some mappers)

#### B. Dynamic ROM Loading
**Concept:** Game ROMs that control SD2SNES

**Potential Methods:**
1. **USB2SNES Commands from ROM:**
   - ROM communicates with USB2SNES server
   - Sends commands via special RAM addresses
   - Server responds and loads next ROM
   - **Challenge:** ROM → Server communication

2. **SD2SNES Direct Control:**
   - SD2SNES has ARM processor
   - Custom firmware could watch RAM flags
   - ROM sets flag → SD2SNES loads next file
   - **Challenge:** Custom firmware required

3. **File Switching via MSU-1:**
   - MSU-1 audio chip can read files
   - Abuse for file enumeration/loading
   - **Challenge:** MSU-1 limitations

#### C. Self-Modifying Game
**Concept:** Create a "game OS" that can:
- Load level data dynamically
- Switch between ROMs
- Auto-progress through ROM playlist
- Never needs USB upload (pre-staged files)

**Architecture:**
```
GameOS ROM (Custom):
  - Manages file system on SD card
  - Loads level/asset data to RAM
  - Interprets level format
  - Communicates with SD2SNES (if possible)
  - Auto-loads next ROM on completion
  
SD Card Layout:
  /work/gameos.sfc     - Main OS ROM
  /work/levels/        - Level data files
  /work/roms/          - ROM playlist
  /work/assets/        - Graphics/music
```

**Implementation Challenges:**
1. ROM → SD2SNES communication
2. Custom ROM development
3. File format design
4. SD2SNES firmware limitations

---

### 4. Asset Injection (MEDIUM PRIORITY)

**Goal:** Dynamically load graphics/music/levels

#### A. Graphics Injection
- Upload tileset data to VRAM addresses
- Update palette data
- Refresh screen
- **Use case:** Custom graphics without ROM rebuild

#### B. Level Data Injection
- Upload level data to RAM
- Trigger level reload
- **Use case:** Dynamic level loading

#### C. Music Injection
- Upload SPC700 data
- Trigger music change
- **Use case:** Custom soundtrack

**Implementation:**
```javascript
class AssetInjector {
  async injectGraphics(tilesetData) { ... }
  async injectPalette(paletteData) { ... }
  async injectLevel(levelData) { ... }
  async injectMusic(spcData) { ... }
}
```

---

## Implementation Phases

### Phase 4.1: SMW Helper Library ⭐ (CURRENT)

**Tasks:**
1. Parse smwdisc_ram.txt into address constants
2. Create SMWHelpers class (JavaScript)
3. Create SMWHelpers class (Python)
4. Implement core helper functions:
   - Player state (lives, coins, powerup)
   - Position manipulation
   - Yoshi helpers
   - Game mode queries
   - Sprite locking
5. Create test cases
6. Document all helpers

**Files:**
- `electron/main/smw/SMWHelpers.js` (new)
- `electron/main/smw/SMWAddresses.js` (new)
- `py2snes/smw_helpers.py` (new)
- `py2snes/smw_addresses.py` (new)
- `devdocs/SMW_HELPERS_GUIDE.md` (new)

**Estimated:** ~400 lines of code

---

### Phase 4.2: Custom Code Execution

**Tasks:**
1. Research CMD space execution
2. Implement ExecuteCode() method
3. Create assembly templates
4. Test with simple examples
5. Document execution methods

**Files:**
- `electron/main/usb2snes/CodeExecutor.js` (new)
- `py2snes/code_executor.py` (new)
- `devdocs/CODE_EXECUTION_GUIDE.md` (new)

**Estimated:** ~300 lines of code

---

### Phase 4.3: Advanced ROM Research

**Tasks:**
1. Document ROM limitations
2. Research SD2SNES firmware
3. Prototype ROM → SD2SNES communication
4. Document findings
5. Create proof-of-concept if feasible

**Files:**
- `devdocs/ROM_MANIPULATION_STUDY.md` (new)
- `devdocs/SD2SNES_CONTROL_RESEARCH.md` (new)

**Estimated:** Research & documentation

---

### Phase 4.4: Asset Injection

**Tasks:**
1. Research VRAM addresses
2. Implement graphics injection
3. Implement palette injection
4. Test with example assets
5. Document asset formats

**Files:**
- `electron/main/smw/AssetInjector.js` (new)
- `devdocs/ASSET_INJECTION_GUIDE.md` (new)

**Estimated:** ~250 lines of code

---

## Technical Deep Dive

### SMW Memory Map Overview

**SNES Address Ranges:**
- `0x7E0000-0x7E1FFF` - Low RAM (8KB) - Fast access, game state
- `0x7F0000-0x7FFFFF` - High RAM (64KB) - Extended data
- `0x000000-0x3FFFFF` - ROM banks (mirrored)

**SMW-Specific Regions:**
```
0x7E0000-0x00FF: Direct page (fast access)
0x7E0100-0x01FF: Stack
0x7E0013-0x0014: Frame counters
0x7E0015-0x0018: Controller input
0x7E0019: Mario powerup (in level)
0x7E0071-0x007D: Mario animation/state
0x7E0094-0x0097: Mario position
0x7E009D: Sprites locked flag
0x7E009E-0x16FF: Sprite tables
0x7E0DB4-0x0DC1: Player status (lives, coins, powerup, yoshi)
0x7E1400+: Various flags and timers
```

---

### Custom Code Execution Methods

#### Method 1: CMD Space (SD2SNES)
**Pros:**
- Simple to implement
- No ROM modification
- Works immediately

**Cons:**
- Limited space (~1KB)
- Temporary (lost on reset)
- SD2SNES/FXPak Pro only

**Process:**
1. Write assembly to 0x002C00 (CMD space)
2. Write JMP/JSL to hook point in RAM
3. Trigger execution
4. Code runs, returns control

#### Method 2: RAM Hijack
**Pros:**
- More space (64KB+ available)
- Can persist during gameplay
- Works on all hardware

**Cons:**
- Must find safe RAM
- Need to hijack game routine
- More complex setup

**Process:**
1. Find free RAM (0x7F8000+)
2. Upload code to RAM
3. Hijack game routine (NMI, GameMode, etc.)
4. Route to custom code
5. Return to game

#### Method 3: ROM Patch Upload
**Pros:**
- Persistent across resets
- Full ROM access
- Most flexible

**Cons:**
- Cannot write ROM directly
- Must upload new ROM file
- Requires reboot

**Process:**
1. Patch ROM file locally
2. Upload via PutFile
3. Reboot with new ROM
4. Changes active

---

### SD2SNES Self-Manipulation Research

#### Concept: Game Controls Console

**Goal:** Create a ROM that can command SD2SNES to load files

**Potential Architecture:**

```
ROM Side (65816):
  - Set flag in RAM: "Load next ROM"
  - Write ROM path to RAM
  - Wait for acknowledgment
  - SD2SNES loads new ROM

SD2SNES Side (ARM):
  - Custom firmware watches RAM
  - Detects flags
  - Reads ROM path from RAM
  - Loads requested file
  - Clears flag
```

**Challenges:**
1. **Firmware Modification:**
   - SD2SNES firmware is open source
   - Could add RAM watching feature
   - Requires flashing custom firmware
   - Risk of bricking device

2. **Communication Protocol:**
   - ROM writes to special RAM addresses
   - SD2SNES ARM polls these addresses
   - Define command structure
   - Handle errors/timeouts

3. **USB2SNES Integration:**
   - Could ROM talk to USB2SNES server?
   - Server could act as intermediary
   - ROM → RAM → USB2SNES → SD2SNES
   - Requires server modifications

**Potential Implementation:**

```c
// SD2SNES Firmware Extension (ARM side)
void watch_control_ram() {
  uint8_t command = snes_read_ram(0x7F8000);
  
  if (command == CMD_LOAD_ROM) {
    char path[256];
    snes_read_ram_block(0x7F8001, path, 256);
    
    // Load ROM file
    load_rom_file(path);
    
    // Clear command
    snes_write_ram(0x7F8000, 0);
  }
}
```

```asm
; ROM Side (65816)
LoadNextROM:
    LDA #$01        ; Command: Load ROM
    STA $7F8000     ; Write to control address
    
    LDX #$0000      ; Copy ROM path
.loop:
    LDA ROMPath,X
    STA $7F8001,X
    INX
    CMP #$00
    BNE .loop
    
.wait:
    LDA $7F8000     ; Wait for acknowledgment
    CMP #$00
    BNE .wait
    
    ; SD2SNES will reboot with new ROM
    RTS
    
ROMPath:
    .db "/work/nextrom.sfc", $00
```

---

## Use Case Examples

### 1. Practice Mode Helper

```javascript
const smw = new SMWHelpers(snes);

// Save practice state
const checkpoint = {
  lives: await smw.getLives(),
  coins: await smw.getCoins(),
  powerup: await smw.getPowerup(),
  position: await smw.getPosition(),
  yoshi: await smw.hasYoshi()
};

// Restore practice state
await smw.setLives(checkpoint.lives);
await smw.setCoins(checkpoint.coins);
await smw.setPowerup(checkpoint.powerup);
await smw.setPosition(checkpoint.position.x, checkpoint.position.y);
```

### 2. Challenge Mode Setup

```javascript
// Enforce "Small Mario Only" challenge
await smw.setPowerup(0);  // Small Mario
await smw.setLives(1);    // One life
await smw.removeYoshi();  // No Yoshi

// Watch for powerup changes
const watcher = snes.createMemoryWatcher(
  [[smw.RAM.MarioPowerUp, 1]],
  100,
  async (changes) => {
    if (changes[0].newValue[0] !== 0) {
      await smw.setPowerup(0);  // Enforce small
      console.log('Challenge violation! Reverted to small Mario.');
    }
  }
);
```

### 3. Auto-Progression System

```javascript
// Game OS concept
class GameOS {
  constructor(smw) {
    this.smw = smw;
    this.currentROM = 0;
    this.romPlaylist = [
      '/work/rom1.sfc',
      '/work/rom2.sfc',
      '/work/rom3.sfc'
    ];
  }
  
  async waitForCompletion() {
    // Watch for game over or victory
    await snes.watchForConditions([
      { address: smw.RAM.GameMode, size: 1, value: 0x1C }  // Credits
    ], 0, 100);
  }
  
  async loadNextROM() {
    this.currentROM++;
    if (this.currentROM >= this.romPlaylist.length) {
      console.log('Playlist complete!');
      return false;
    }
    
    const nextROM = this.romPlaylist[this.currentROM];
    console.log(`Loading ${nextROM}...`);
    
    // Method 1: Via USB2SNES (current capability)
    await snes.PutFile(nextROM, '/work/current.sfc');
    await snes.Boot('/work/current.sfc');
    
    // Method 2: Via ROM command (future, requires firmware)
    // await this.smw.sendSD2SNESCommand('LOAD_ROM', nextROM);
    
    return true;
  }
  
  async run() {
    while (true) {
      await this.waitForCompletion();
      const hasNext = await this.loadNextROM();
      if (!hasNext) break;
    }
  }
}
```

---

## Resources

### Files Available
- `smwdisc_ram.txt` - RAM address map (130+ addresses)
- `SMWDisC.txt` - Full game disassembly (122K+ lines)
- `legacy/smwc_*_list.py` - Scrapy scripts for SMWC data

### External Resources
- SMW Central: https://www.smwcentral.net/
- Memory Map: https://www.smwcentral.net/?p=memorymap
- ROM Map: https://www.smwcentral.net/?p=memorymap&region=rom
- SRAM Map: https://www.smwcentral.net/?p=memorymap&region=sram
- Hijack Discussion: https://www.smwcentral.net/?p=viewthread&t=20182

### Tools
- Lunar Magic - SMW level editor (has many hijacks)
- ASAR - 65816 assembler
- Mesen-S - SNES emulator with debugger

---

## Success Criteria

### Phase 4.1 Complete When:
- ✅ SMW Helper library created (JS + Python)
- ✅ 20+ helper functions implemented
- ✅ Test cases pass
- ✅ Documentation complete
- ✅ Examples provided

### Phase 4.2 Complete When:
- ✅ ExecuteCode() method working
- ✅ Can run simple assembly
- ✅ Assembly templates created
- ✅ Documentation complete

### Phase 4.3 Complete When:
- ✅ ROM limitations documented
- ✅ SD2SNES research complete
- ✅ Communication methods explored
- ✅ Feasibility assessed

### Phase 4.4 Complete When:
- ✅ Asset injection working
- ✅ Graphics upload functional
- ✅ Examples provided
- ✅ Documentation complete

---

## Timeline Estimate

- **Phase 4.1:** 2-3 hours (SMW Helpers)
- **Phase 4.2:** 3-4 hours (Code Execution)
- **Phase 4.3:** 2-3 hours (Research)
- **Phase 4.4:** 2-3 hours (Asset Injection)

**Total:** ~10-13 hours for complete Phase 4

---

## Next Steps

1. ✅ Create Phase 4 plan (THIS DOCUMENT)
2. → Parse smwdisc_ram.txt to JSON
3. → Create SMWAddresses.js
4. → Implement SMWHelpers.js
5. → Implement smw_helpers.py
6. → Create test cases
7. → Document helpers

**Let's start with Phase 4.1!** 🚀

