# USB2SNES Implementation Plan

## Overview

This document outlines the comprehensive plan for implementing USB2SNES functionality in the RHTools Electron application. The implementation will support multiple USB2SNES library types with a focus on flexibility, testing, and robust Super Mario World (SMW) integration.

**Date Created:** October 13, 2025  
**Status:** Planning Phase

---

## Architecture

### Multi-Library Support

The application will support multiple USB2SNES implementations that can be selected by the user:

1. **usb2snes_a** (Type A - Python Port) - *Primary Implementation*
   - JavaScript port of the existing Python `py2snes` and `SMWUSBTest` modules
   - Based on proven protocol implementation from the project's Python codebase
   - Will serve as the reference implementation

2. **usb2snes_b** (Type B - 3rd Party JS)
   - Integration of existing third-party JavaScript USB2SNES libraries
   - Provides alternative implementation for testing and comparison
   - May offer better performance or different feature sets

3. **qusb2snes** (Local Server)
   - Designed to work with QUsb2snes local server implementation
   - Should follow the same protocol specification
   - Reference: https://github.com/Skarsnik/QUsb2snes/blob/master/docs/Protocol.md

4. **node-usb** (Direct Hardware)
   - Direct USB hardware communication via Node.js native modules
   - Bypasses WebSocket layer for potentially better performance
   - More complex implementation requiring more research
   - Less interoperable but potentially more capable

### Connection Management

- **Single Active Connection:** Only one library implementation can be active at a time
- **Connection State:** Must disconnect before changing library implementation
- **Auto-connect:** Automatic connection can be attempted when USB2SNES actions are initiated
- **Manual Control:** Connect/Disconnect buttons for explicit user control

---

## Implementation Phases

### Phase 1: Core Infrastructure (Current Phase)

**Status:** ✅ Complete

- [x] Add USB2SNES library selection dropdown to USB2SNES Tools modal
- [x] Add "Default usb2snes library" setting in Settings dialog
- [x] Implement Connect/Disconnect button functionality with state management
- [x] Add connection status display with firmware/version information
- [x] Create error handling and diagnostic logging

### Phase 2: usb2snes_a Library (Type A - Python Port)

**Target:** Primary working implementation

#### 2.1 Protocol Layer (`electron/main/usb2snes/usb2snesTypeA.js`)

Port from `py2snes/__init__.py`:

```javascript
// Core protocol implementation
class Usb2snesTypeA {
  constructor() {
    this.state = SNES_DISCONNECTED;
    this.socket = null;
    this.recvQueue = [];
    this.requestLock = false;
    this.isSD2SNES = false;
  }

  // Connection management
  async connect(address = 'ws://localhost:64213')
  async disconnect()
  
  // Device operations
  async DeviceList()
  async Attach(device)
  async Info()
  async Name(name)
  
  // Console control
  async Boot(rom)
  async Menu()
  async Reset()
  
  // Memory operations
  async GetAddress(address, size)
  async PutAddress(writeList)
  
  // File operations
  async PutFile(srcFile, dstFile)
  async List(dirPath)
  async MakeDir(dirPath)
  async Remove(dirPath)
}
```

**Key Protocol Details:**
- WebSocket-based communication
- JSON command format with Opcode/Space/Operands structure
- Binary data transfer for memory read/write
- Special handling for SD2SNES vs other devices (CMD space for SD2SNES writes)
- Memory address mapping:
  - ROM: 0x000000
  - WRAM: 0xF50000 (size: 0x20000)
  - SRAM: 0xE00000

#### 2.2 SMW-Specific Layer (`electron/main/usb2snes/SMWUsb2snes.js`)

Port from `smwusbtest.py` and `sneslink.py`:

```javascript
class SMWUsb2snes extends Usb2snesTypeA {
  // SMW-specific memory addresses and values
  static POWERUP_STATE = 0xF50019;
  static POWERUP_VALUES = {
    'fire': 0x03,
    'cape': 0x02,
    'super': 0x01,
    'normal': 0x00
  };
  
  // Game state detection
  async isInLevel()
  async isAtStartScreen()
  async isAtCredits()
  async isAtGameOver()
  async isSMWRunning()
  
  // Player state
  async getPowerupStatus()
  async getExitCount()
  async getPlayerPosition()
  
  // Player control
  async grantPowerup(type)
  async setTime(seconds)
  async setGameMode(mode)
  
  // Level/World management
  async getOWLocation()
  async setLevelOverride(level)
  
  // Auto-connection with retry
  async readyUp(note = '')
}
```

**Reference Files:**
- `smwusbtest.py` - SMW-specific functionality
- `sneslink.py` - Connection management with auto-retry
- `py2snes/__init__.py` - Core protocol

#### 2.3 IPC Integration (`electron/main/ipc-handlers.js`)

Add IPC handlers for USB2SNES operations:

```javascript
// Connection management
ipcMain.handle('usb2snes:connect', async (event, library, address) => { ... })
ipcMain.handle('usb2snes:disconnect', async () => { ... })
ipcMain.handle('usb2snes:getInfo', async () => { ... })

// Console control
ipcMain.handle('usb2snes:reset', async () => { ... })
ipcMain.handle('usb2snes:menu', async () => { ... })
ipcMain.handle('usb2snes:boot', async (event, romPath) => { ... })
ipcMain.handle('usb2snes:uploadRom', async (event, srcPath, dstPath) => { ... })

// SMW-specific operations
ipcMain.handle('usb2snes:smw:isRunning', async () => { ... })
ipcMain.handle('usb2snes:smw:inLevel', async () => { ... })
ipcMain.handle('usb2snes:smw:getPowerup', async () => { ... })
ipcMain.handle('usb2snes:smw:grantPowerup', async (event, type) => { ... })
ipcMain.handle('usb2snes:smw:checkExits', async () => { ... })
```

### Phase 3: UI Integration & Testing

#### 3.1 USB2SNES Tools Modal Enhancement

Add to the existing modal in `App.vue`:

**Quick Actions Section:**
- Reset SNES console button
- Return to Menu button
- Boot ROM file selector and button
- Upload ROM file selector and button (to `/work` or configured directory)

**SMW Game State Section:**
- Display if SMW is running
- Show if player is in a level
- Show current level/stage if applicable
- Display player powerup status
- Display exit count
- Display screen state (start/credits/game over)

**SMW Actions Section:**
- Grant Powerup dropdown (Cape, Fire, Super, Normal)
- Set Time input and button
- Game mode controls

#### 3.2 Testing Strategy

**Unit Tests (`tests/usb2snes/`):**
- Protocol message formatting
- Memory address calculations
- Device detection logic
- Error handling

**Integration Tests (`tests/usb2snes-integration/`):**
Each test must:
1. Use environment variable for database path (e.g., `RHDATA_DB_PATH_TEST`)
2. Use environment variable for USB2SNES address (e.g., `USB2SNES_TEST_ADDRESS`)
3. Clean up connections properly
4. Run in isolated test environment

Minimum 3 test cases per major feature:
- Connection establishment and disconnection
- Memory read/write operations
- File upload operations
- SMW game state detection
- SMW player control operations

**Test Files:**
- `test_usb2snes_connect.js` - Connection management
- `test_usb2snes_memory.js` - Memory operations
- `test_usb2snes_files.js` - File operations
- `test_usb2snes_smw.js` - SMW-specific features

**Central Test Runner:**
Add to existing test infrastructure in `tests/run_all_tests.sh` or create `tests/run_usb2snes_tests.sh`

### Phase 4: usb2snes_b Library (Type B - 3rd Party)

**Research Phase:**
- Evaluate existing JavaScript USB2SNES libraries
- Consider libraries from:
  - https://github.com/usb2snes/usb2snes.git
  - Community-contributed npm packages
  - Legacy project ports

**Integration:**
- Create adapter layer to match usb2snes_a interface
- Implement same IPC handlers with library selection
- Add library-specific configuration if needed

### Phase 5: Advanced Features

#### 5.1 Savestate Management (from legacy/Savestate2snes)

- List available savestates
- Load savestate
- Save current state
- Analyze game state from savestate files

#### 5.2 Memory Editing (from legacy/goofgenie)

- Game Genie-like code interface
- Direct memory editing UI
- Preset cheat codes for SMW

#### 5.3 Twitch Integration (from chatbot/chatbot.py)

- Twitch chat controlled USB2SNES access
- Integration with existing chatbot
- Command parsing and execution
- Permission/cooldown management

#### 5.4 Protocol Extensions

**SNI/NWA Protocol Support:**
- Research SNI (from legacy/sni)
- Implement NWA protocol if beneficial
- Unified interface for both console and emulator control

**Emulator Bridge (from legacy/emu2api):**
- WebSocket bridge to emulators
- Allows USB2SNES protocol to control emulators
- Broader compatibility

---

## Reference Resources

### Existing Python Implementations (In Project)

1. **`py2snes/py2snes/__init__.py`** - Core protocol implementation
   - WebSocket communication
   - All basic opcodes (DeviceList, Attach, Info, Boot, Reset, Menu, GetAddress, PutAddress, PutFile, List, etc.)
   - SD2SNES special handling

2. **`smwusbtest.py`** - SMW-specific testing and control
   - Game state detection (in level, start screen, credits, game over)
   - Player status (powerup, position)
   - Player control (grant items, set time, etc.)
   - Memory address constants for SMW

3. **`sneslink.py`** - Connection management wrapper
   - Singleton pattern for single connection
   - Auto-retry connection logic (`readyUp()`)
   - Simplified connection workflow

4. **`testusb1.py`, `testusb2.py`** - Test scripts (may contain bugs to fix)

5. **`chatbot/chatbot.py`** - Twitch chatbot using SMWUSBTest

### Project Legacy Tools (For Future Features)

- **`legacy/Savestate2snes`** - Savestate management
- **`legacy/goofgenie`** - Game genie-like memory editing
- **`legacy/usb2snes`** - C implementation
- **`legacy/usb2snes-tests`** - Protocol tests
- **`legacy/usb2snes-cli`** - Rust CLI
- **`legacy/Super-Mario-World-USB2SNES-Twitch-Controlled`** - Twitch integration
- **`legacy/SMAutoTracker`** - Super Metroid tracker
- **`legacy/sni`** - SNI protocol (console/emulator control)
- **`legacy/emu2api`** - Emulator bridge
- **`legacy/romloader.py`**, **`legacy/usb2snes-uploader.py`** - File utilities
- **`legacy/Usb2Snes-Livesplit-Definitions`** - Speedrun timer integration

### External Resources

1. **QUsb2snes Protocol Documentation:**
   - https://github.com/Skarsnik/QUsb2snes/blob/master/docs/Protocol.md
   - Official protocol specification

2. **USB2SNES File Viewer (C#):**
   - https://github.com/RedGuyyyy/usb2snesw/blob/master/usb2snesfileviewer/usb2snesfileviewer.cs
   - Reference implementation

3. **USB2SNES Website:**
   - https://usb2snes.com/
   - Documentation and downloads

4. **LiveSplit USB2SNES Autosplitter:**
   - https://github.com/tewtal/LiveSplit.USB2SNESSplitter
   - Another protocol implementation

### Memory Maps (In Project)

- **`smwc_rammap_index.json`** - SMW RAM addresses
  - Player state, level state, game mode, etc.
  - Critical for SMW-specific features

- **`smwc_rommap_index.json`** - SMW ROM addresses
  - Hardware addresses of significance
  - Used for ROM analysis

---

## USB2SNES Protocol Summary

### Connection Flow

1. **Connect** to WebSocket (default: `ws://localhost:64213`)
2. **DeviceList** - Get available devices
3. **Attach** - Attach to a specific device
4. **Info** - Get firmware/version information
5. **Name** - Set client name (optional)

### Key Opcodes

| Opcode | Space | Operands | Purpose |
|--------|-------|----------|---------|
| DeviceList | SNES | - | List available devices |
| Attach | SNES | [device] | Attach to device |
| Info | SNES | [device] | Get device info |
| Name | SNES | [name] | Set client name |
| Boot | SNES | [rom_path] | Boot ROM file |
| Reset | SNES | - | Reset console |
| Menu | SNES | - | Return to menu |
| GetAddress | SNES | [addr_hex, size_hex] | Read memory |
| PutAddress | SNES/CMD | [addr_hex, size_hex] | Write memory |
| PutFile | SNES | [dst_path, size_hex] | Upload file |
| List | SNES | [path] | List directory |
| MakeDir | SNES | [path] | Create directory |
| Remove | SNES | [path] | Delete file/dir |

### Memory Address Spaces

- **ROM Space:** `0x000000` - ROM data
- **WRAM Space:** `0xF50000` - `0xF5FFFF` (128KB work RAM)
  - SMW uses WRAM extensively
  - WRAM base: `0xF50000`
  - Most game state stored here
- **SRAM Space:** `0xE00000` - Save RAM (cart battery backed)

### SD2SNES Special Handling

For SD2SNES devices, PutAddress uses CMD space with assembly instructions:
- Generates 65816 assembly to write values
- Required for hardware limitations of SD2SNES
- Regular devices use SNES space directly

---

## Desired Features (Immediate)

### Console Control
- ✅ Connect and test connection with firmware info display
- ⬜ Reboot SNES console
- ⬜ Boot specified ROM file
- ⬜ Upload specified ROM file to `/work` (or configured directory)

### SMW Game State Detection
- ⬜ Check if SMW is running
- ⬜ Check if player is in a stage/level
- ⬜ Check if player is in a particular stage/level
- ⬜ Check player powerup status
- ⬜ Check if player is at start screen
- ⬜ Check if player is at credits screen
- ⬜ Check if player is at game over screen
- ⬜ Check player exit count

### SMW Player Control
- ⬜ Grant powerup (Cape/Feather, Fire Flower, Mushroom)
- ⬜ Set game time
- ⬜ Other game modifications

---

## File Structure

### Proposed Module Organization

```
electron/
├── main/
│   ├── usb2snes/
│   │   ├── index.js                    # USB2SNES factory/manager
│   │   ├── usb2snesTypeA.js            # Type A implementation (Python port)
│   │   ├── usb2snesTypeB.js            # Type B implementation (3rd party)
│   │   ├── qusb2snesAdapter.js         # QUsb2snes adapter
│   │   ├── nodeUsbAdapter.js           # node-usb adapter
│   │   ├── SMWUsb2snes.js              # SMW-specific features
│   │   └── constants.js                # Shared constants (opcodes, memory maps)
│   └── ipc-handlers.js                 # IPC handlers (add USB2SNES handlers)
└── renderer/
    └── src/
        └── App.vue                      # UI (already modified)

tests/
├── usb2snes/
│   ├── test_protocol.js                # Protocol unit tests
│   ├── test_memory.js                  # Memory operation tests
│   └── test_smw.js                     # SMW feature tests
└── run_usb2snes_tests.sh               # Test runner

devdocs/
└── USB2SNES_IMPLEMENTATION_PLAN.md     # This document
```

---

## Environment Variables for Testing

All test scripts must support environment variable overrides:

- `USB2SNES_TEST_ADDRESS` - WebSocket address for tests (default: `ws://localhost:64213`)
- `RHDATA_DB_PATH` - Override main database path
- `PATCHBIN_DB_PATH` - Override patchbin database path
- `RHMD_FILE` - Override metadata file path

Example test invocation:
```bash
USB2SNES_TEST_ADDRESS=ws://localhost:8080 \
RHDATA_DB_PATH=/tmp/test_rhdata.db \
npm run test:usb2snes
```

---

## Next Steps

### Immediate Actions

1. ✅ Complete UI implementation (dropdown, settings, connect/disconnect buttons)
2. ⬜ Create `electron/main/usb2snes/usb2snesTypeA.js` - port py2snes
3. ⬜ Create `electron/main/usb2snes/SMWUsb2snes.js` - port SMWUSBTest
4. ⬜ Add IPC handlers for basic operations
5. ⬜ Implement connect/disconnect with real WebSocket
6. ⬜ Test basic connection and firmware info retrieval
7. ⬜ Implement Reset, Menu, Boot operations
8. ⬜ Implement file upload to `/work` directory
9. ⬜ Add SMW game state detection
10. ⬜ Add SMW player control features
11. ⬜ Create comprehensive test suite

### Future Work

- Complete usb2snes_b (3rd party JS library)
- Research and implement qusb2snes adapter
- Research and implement node-usb direct hardware
- Savestate management UI
- Memory editor UI
- Twitch chatbot integration
- SNI/NWA protocol support
- Emulator bridge support

---

## Notes

- The Python implementation in py2snes may have bugs that need to be addressed in the JavaScript port
- Testing should be done against real hardware (SD2SNES/FXPak Pro) and QUsb2snes with emulators
- Connection stability is critical - implement proper error handling and reconnection logic
- Consider rate limiting for rapid memory operations to prevent overwhelming the device
- File uploads can be slow for large ROMs - implement progress indication
- SMW memory addresses may vary for ROM hacks - provide override mechanism if needed

---

## Success Criteria

**Phase 2 Complete When:**
- ✅ usb2snes_a library successfully connects to USB2SNES/QUsb2snes
- ✅ Firmware and device info correctly displayed
- ✅ Can reset console and return to menu
- ✅ Can boot ROM file from console SD card
- ✅ Can upload ROM file to `/work` directory
- ✅ Can detect if SMW is running
- ✅ Can detect player game state (level, screen, powerup)
- ✅ Can grant powerups to player
- ✅ All test cases pass with test database
- ✅ No regression in existing functionality

**Full Implementation Complete When:**
- All 4 library types implemented and working
- All desired features implemented and tested
- Comprehensive test coverage (>80%)
- Integration with Twitch chatbot
- Savestate management functional
- Documentation complete
- User guide created

---

## Changelog

- **2025-10-13:** Initial plan created
  - UI implementation complete (dropdown, settings, connect/disconnect)
  - Phase 1 complete
  - Defined architecture and implementation phases
  - Documented protocol and reference resources

