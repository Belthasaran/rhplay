# USB2SNES Implementation Quick Start Guide

## What's Been Completed

✅ **UI Components (Phase 1 - Complete)**
- USB2SNES library selector dropdown in USB2SNES Tools modal
- "Default usb2snes library" setting in Settings dialog  
- Connect/Disconnect button functionality
- Enhanced status display with firmware/version info fields
- Connection state management
- Library change restrictions while connected

## Next Steps - Implementing usb2snes_a (Type A)

### Step 1: Create Core Protocol Module

Create: `electron/main/usb2snes/usb2snesTypeA.js`

**Key Components to Port from `py2snes/__init__.py`:**

```javascript
// Connection states
const SNES_DISCONNECTED = 0;
const SNES_CONNECTING = 1;
const SNES_CONNECTED = 2;
const SNES_ATTACHED = 3;

// Memory spaces
const ROM_START = 0x000000;
const WRAM_START = 0xF50000;
const WRAM_SIZE = 0x20000;
const SRAM_START = 0xE00000;

class Usb2snesTypeA {
  constructor() {
    this.state = SNES_DISCONNECTED;
    this.socket = null;
    this.recvQueue = [];
    this.requestLock = false;
    this.isSD2SNES = false;
  }

  // Core methods to implement:
  async connect(address)      // Lines 35-55 in py2snes
  async DeviceList()           // Lines 57-83
  async Attach(device)         // Lines 85-110
  async Info()                 // Lines 111-140
  async Name(name)             // Lines 142-157
  async Boot(rom)              // Lines 159-174
  async Menu()                 // Lines 176-191
  async Reset()                // Lines 193-207
  async GetAddress(addr, size) // Lines 209-243
  async PutAddress(writeList)  // Lines 245-296
  async PutFile(src, dst)      // Lines 334-368
  async List(path)             // Lines 385-414
  async recvLoop()             // Lines 370-383
}
```

**Key Protocol Details:**
- Use WebSocket (`ws` npm package or native WebSocket API)
- Commands are JSON: `{"Opcode": "...", "Space": "...", "Operands": [...]}`
- Binary data follows JSON commands for memory/file operations
- SD2SNES requires special CMD space for PutAddress (see lines 257-280)

### Step 2: Create SMW-Specific Module

Create: `electron/main/usb2snes/SMWUsb2snes.js`

**Key Components to Port from `smwusbtest.py`:**

```javascript
class SMWUsb2snes extends Usb2snesTypeA {
  // Constants from smwusbtest.py lines 27-92
  static POWERUP_STATE = 0xF50019;
  static POWERUP_VALUES = {
    'fire': 0x03,
    'cape': 0x02,
    'super': 0x01,
    'normal': 0x00
  };

  // Key methods to implement:
  async isInLevel()           // Lines 693-700
  async grantPowerup(type)    // Lines 203-205
  async setTime(seconds)      // Lines 344-345
  async isSMWRunning()        // Detect SMW from memory
  
  // Connection management from sneslink.py:
  async readyUp(note = '')    // Lines 33-50 - auto-connect with retry
}
```

### Step 3: Add IPC Handlers

Modify: `electron/main/ipc-handlers.js`

```javascript
// Add near top with other requires
const SMWUsb2snes = require('./usb2snes/SMWUsb2snes');

// Global USB2SNES instance
let usb2snesInstance = null;

// Connection handlers
ipcMain.handle('usb2snes:connect', async (event, library, address) => {
  if (library !== 'usb2snes_a') {
    throw new Error(`${library} not implemented yet`);
  }
  
  usb2snesInstance = new SMWUsb2snes();
  await usb2snesInstance.connect(address);
  
  const devices = await usb2snesInstance.DeviceList();
  if (devices && devices.length > 0) {
    await usb2snesInstance.Attach(devices[0]);
    const info = await usb2snesInstance.Info();
    return {
      connected: true,
      device: devices[0],
      firmwareVersion: info.firmwareversion,
      versionString: info.versionstring,
      romRunning: info.romrunning
    };
  }
  throw new Error('No devices found');
});

ipcMain.handle('usb2snes:disconnect', async () => {
  if (usb2snesInstance && usb2snesInstance.socket) {
    await usb2snesInstance.socket.close();
    usb2snesInstance = null;
  }
  return { connected: false };
});

ipcMain.handle('usb2snes:reset', async () => {
  if (!usb2snesInstance) throw new Error('Not connected');
  await usb2snesInstance.Reset();
});

ipcMain.handle('usb2snes:menu', async () => {
  if (!usb2snesInstance) throw new Error('Not connected');
  await usb2snesInstance.Menu();
});

ipcMain.handle('usb2snes:boot', async (event, romPath) => {
  if (!usb2snesInstance) throw new Error('Not connected');
  await usb2snesInstance.Boot(romPath);
});

// ... more handlers
```

### Step 4: Update Frontend to Use Real IPC

Modify: `electron/renderer/src/App.vue`

Update the `connectUsb2snes()` function (around line 1461):

```javascript
async function connectUsb2snes() {
  usb2snesStatus.lastAttempt = new Date().toLocaleString();
  try {
    const library = usb2snesCurrentLibrary.value;
    const address = settings.usb2snesAddress;
    
    const result = await (window as any).electronAPI.usb2snesConnect(library, address);
    
    usb2snesStatus.connected = true;
    usb2snesStatus.device = result.device;
    usb2snesStatus.firmwareVersion = result.firmwareVersion;
    usb2snesStatus.versionString = result.versionString;
    usb2snesStatus.romRunning = result.romRunning;
    usb2snesStatus.lastError = '';
    
    alert(`Connected successfully using ${library}\nDevice: ${result.device}`);
  } catch (error) {
    usb2snesStatus.lastError = String(error);
    usb2snesStatus.connected = false;
    alert(`Connection failed: ${error}`);
  }
}

async function disconnectUsb2snes() {
  try {
    await (window as any).electronAPI.usb2snesDisconnect();
    
    usb2snesStatus.connected = false;
    usb2snesStatus.device = '';
    usb2snesStatus.firmwareVersion = '';
    usb2snesStatus.versionString = '';
    usb2snesStatus.romRunning = '';
    
    alert('Disconnected from USB2SNES');
  } catch (error) {
    usb2snesStatus.lastError = String(error);
    alert(`Disconnection error: ${error}`);
  }
}
```

### Step 5: Add Preload API Definitions

Modify: `electron/preload.js`

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  // ... existing APIs ...
  
  // USB2SNES APIs
  usb2snesConnect: (library, address) => ipcRenderer.invoke('usb2snes:connect', library, address),
  usb2snesDisconnect: () => ipcRenderer.invoke('usb2snes:disconnect'),
  usb2snesReset: () => ipcRenderer.invoke('usb2snes:reset'),
  usb2snesMenu: () => ipcRenderer.invoke('usb2snes:menu'),
  usb2snesBoot: (romPath) => ipcRenderer.invoke('usb2snes:boot', romPath),
  usb2snesUploadRom: (srcPath, dstPath) => ipcRenderer.invoke('usb2snes:uploadRom', srcPath, dstPath),
  // ... more as needed
});
```

## Testing Strategy

### Manual Testing Checklist

1. **Connection Test**
   - [ ] Start QUsb2snes or USB2SNES server
   - [ ] Open USB2SNES Tools modal
   - [ ] Select usb2snes_a library
   - [ ] Click Connect
   - [ ] Verify firmware info displays correctly
   - [ ] Click Disconnect
   - [ ] Verify connection closes cleanly

2. **Console Control Test**
   - [ ] Connect to USB2SNES
   - [ ] Test Reset button - console should reset
   - [ ] Test Menu button - console should return to menu
   - [ ] Test Boot with ROM path - console should boot ROM

3. **File Upload Test**
   - [ ] Select ROM file for upload
   - [ ] Upload to /work directory
   - [ ] Verify file appears on console/emulator

4. **SMW Detection Test**
   - [ ] Boot Super Mario World
   - [ ] Verify "SMW Running" detection works
   - [ ] Enter a level
   - [ ] Verify "In Level" detection works
   - [ ] Check powerup status display

### Automated Testing

Create test files in `tests/usb2snes/`:

```javascript
// tests/usb2snes/test_connect.js
const assert = require('assert');
const SMWUsb2snes = require('../../electron/main/usb2snes/SMWUsb2snes');

describe('USB2SNES Connection', () => {
  it('should connect to USB2SNES server', async () => {
    const address = process.env.USB2SNES_TEST_ADDRESS || 'ws://localhost:64213';
    const snes = new SMWUsb2snes();
    
    await snes.connect(address);
    assert.strictEqual(snes.state, 2); // SNES_CONNECTED
    
    const devices = await snes.DeviceList();
    assert(devices.length > 0, 'Should find at least one device');
    
    await snes.Attach(devices[0]);
    assert.strictEqual(snes.state, 3); // SNES_ATTACHED
    
    const info = await snes.Info();
    assert(info.firmwareversion !== undefined);
    
    await snes.socket.close();
  });
});
```

## Python Reference Files

**Primary References (in project):**
- `py2snes/py2snes/__init__.py` - Core protocol (507 lines)
- `smwusbtest.py` - SMW features (730 lines)
- `sneslink.py` - Connection management (83 lines)

**Supporting References:**
- `testusb1.py`, `testusb2.py` - Example usage
- `chatbot/chatbot.py` - Real-world usage example

## Common Pitfalls to Avoid

1. **WebSocket Message Handling**
   - JSON messages and binary data are separate WebSocket messages
   - Must queue and process in order
   - Use async queue for proper sequencing

2. **SD2SNES vs Regular Devices**
   - SD2SNES requires CMD space for writes
   - Generate 65816 assembly for SD2SNES PutAddress
   - Regular devices use SNES space directly

3. **Memory Address Calculations**
   - WRAM starts at 0xF50000 (not 0x7E0000)
   - SD2SNES assembly uses 0x7E0000 base
   - Must convert: WRAM_addr = 0xF50000 + offset

4. **Error Handling**
   - WebSocket can close unexpectedly
   - Implement reconnection logic
   - Clear state properly on disconnect

5. **File Operations**
   - Large file uploads need delays (see py2snes line 363-367)
   - Use List() to confirm upload complete
   - Handle progress for user feedback

## Quick Command Reference

**Basic Connection Flow:**
```javascript
const snes = new SMWUsb2snes();
await snes.connect('ws://localhost:64213');
const devices = await snes.DeviceList();
await snes.Attach(devices[0]);
const info = await snes.Info();
```

**Console Control:**
```javascript
await snes.Reset();      // Reset console
await snes.Menu();       // Return to menu
await snes.Boot('/path/to/rom.sfc');  // Boot ROM
```

**Memory Operations:**
```javascript
// Read powerup status
const powerup = await snes.GetAddress(0xF50019, 1);

// Grant cape powerup
await snes.PutAddress([[0xF50019, Buffer.from([0x02])]]);
```

**File Operations:**
```javascript
// Upload ROM to console
await snes.PutFile('/local/path/hack.sfc', '/work/hack.sfc');

// List files
const files = await snes.List('/work');
```

## Resources

- **Implementation Plan:** `devdocs/USB2SNES_IMPLEMENTATION_PLAN.md`
- **Protocol Docs:** https://github.com/Skarsnik/QUsb2snes/blob/master/docs/Protocol.md
- **USB2SNES Website:** https://usb2snes.com/
- **RAM Map:** `smwc_rammap_index.json` - SMW memory addresses
- **ROM Map:** `smwc_rommap_index.json` - ROM addresses

## Support

If you encounter issues:
1. Check QUsb2snes/USB2SNES server is running
2. Verify WebSocket address is correct (default: ws://localhost:64213)
3. Check console logs for connection errors
4. Review Python implementation for protocol details
5. Test with simpler operations first (DeviceList, Info) before complex ones

---

**Last Updated:** October 13, 2025

