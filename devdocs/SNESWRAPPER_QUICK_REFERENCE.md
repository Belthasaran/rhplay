# SNESWrapper Quick Reference Card

**For:** RHTools USB2SNES Integration  
**Date:** October 13, 2025

---

## 🎯 The Golden Rule

**❌ NEVER** directly import or use `usb2snesTypeA`, `usb2snesTypeB`, etc.  
**✅ ALWAYS** use `SNESWrapper` for all USB2SNES operations

---

## 📁 File Locations

```
electron/main/usb2snes/
├── BaseUsb2snes.js       ← Interface definition (abstract)
├── SNESWrapper.js        ← USE THIS EVERYWHERE
└── usb2snesTypeA.js      ← Implementation (don't use directly)

electron/
├── ipc-handlers.js       ← IPC handlers (uses SNESWrapper)
└── preload.js            ← Renderer API (exposes USB2SNES calls)

electron/renderer/src/
└── App.vue              ← Frontend (uses electronAPI)
```

---

## 🔌 Quick Usage

### From Main Process (Node.js)

```javascript
const { SNESWrapper } = require('./main/usb2snes/SNESWrapper');

// Create wrapper
const snes = new SNESWrapper();

// Connect (method 1: full connect)
const result = await snes.fullConnect('usb2snes_a', 'ws://localhost:64213');
console.log('Connected to:', result.device);

// Connect (method 2: manual)
await snes.setImplementation('usb2snes_a');
await snes.connect('ws://localhost:64213');
const devices = await snes.DeviceList();
await snes.Attach(devices[0]);

// Use
await snes.Reset();
await snes.Menu();
await snes.Boot('/work/rom.sfc');
const data = await snes.GetAddress(0xF50019, 1);  // Read powerup
await snes.PutAddress([[0xF50019, Buffer.from([0x02])]]);  // Grant cape

// Disconnect
await snes.disconnect();
```

### From IPC Handler

```javascript
const { SNESWrapper } = require('./main/usb2snes/SNESWrapper');

let snesWrapper = null;

function getSnesWrapper() {
  if (!snesWrapper) snesWrapper = new SNESWrapper();
  return snesWrapper;
}

ipcMain.handle('usb2snes:connect', async (event, library, address) => {
  const wrapper = getSnesWrapper();
  const result = await wrapper.fullConnect(library, address);
  return { connected: true, device: result.device, ... };
});
```

### From Frontend (Vue/React)

```javascript
// Connect
const result = await window.electronAPI.usb2snesConnect('usb2snes_a', 'ws://localhost:64213');

// Use
await window.electronAPI.usb2snesReset();
await window.electronAPI.usb2snesBoot('/work/rom.sfc');
const {data} = await window.electronAPI.usb2snesReadMemory(0xF50019, 1);

// Disconnect
await window.electronAPI.usb2snesDisconnect();
```

---

## 📡 API Reference

### SNESWrapper Methods

**Configuration:**
```javascript
await setImplementation(type)     // 'usb2snes_a', 'usb2snes_b', 'qusb2snes', 'node-usb'
getImplementationType()            // Get current implementation name
hasImplementation()                // Check if implementation loaded
```

**Connection:**
```javascript
await connect(address)                           // Connect to server
await disconnect()                               // Disconnect
await quickConnect(impl, address)                // Set impl + connect
await fullConnect(impl, address, device=null)    // Set impl + connect + attach
```

**Device Operations:**
```javascript
await DeviceList()                 // Get available devices
await Attach(device)               // Attach to specific device
await Info()                       // Get device info (firmware, version, ROM)
await Name(name)                   // Set client name
```

**Console Control:**
```javascript
await Boot(romPath)                // Boot ROM file
await Menu()                       // Return to menu
await Reset()                      // Reset console
```

**Memory Operations:**
```javascript
await GetAddress(address, size)               // Read memory (returns Buffer)
await PutAddress([[addr, data], ...])         // Write memory (data = Buffer)
```

**File Operations (pending in usb2snes_a):**
```javascript
await PutFile(srcFile, dstFile)    // Upload file to console
await List(dirPath)                // List directory
await MakeDir(dirPath)             // Create directory
await Remove(path)                 // Remove file/directory
```

**State Queries:**
```javascript
getState()                         // Get connection state (0-3)
isConnected()                      // Boolean: connected?
isAttached()                       // Boolean: attached to device?
getDevice()                        // Get device name
```

---

## 🔗 IPC Channels

### Main → Renderer (invoke)

```javascript
'usb2snes:connect'      → {connected, device, firmwareVersion, ...}
'usb2snes:disconnect'   → {connected: false}
'usb2snes:status'       → {hasImplementation, implementationType, connected, ...}
'usb2snes:reset'        → {success: true}
'usb2snes:menu'         → {success: true}
'usb2snes:boot'         → {success: true}
'usb2snes:uploadRom'    → {success: true/false}
'usb2snes:readMemory'   → {data: [byte array]}
'usb2snes:writeMemory'  → {success: true/false}
'usb2snes:listDir'      → {files: [{type, filename}, ...]}
```

### Frontend API (window.electronAPI)

```javascript
usb2snesConnect(library, address)
usb2snesDisconnect()
usb2snesStatus()
usb2snesReset()
usb2snesMenu()
usb2snesBoot(romPath)
usb2snesUploadRom(srcPath, dstPath)
usb2snesReadMemory(address, size)
usb2snesWriteMemory([[addr, data], ...])
usb2snesListDir(dirPath)
```

---

## 🗺️ Memory Map (SMW)

```javascript
// Memory Spaces
ROM_START  = 0x000000
WRAM_START = 0xF50000
WRAM_SIZE  = 0x20000
SRAM_START = 0xE00000

// Common SMW Addresses
0xF50019  // Powerup status (0=normal, 1=super, 2=cape, 3=fire)
0xF50100  // Game mode (0x0b=overworld, 0x0f=enter level)
0xF50109  // Level override
0xF50096  // Timer (3 bytes)
0xF50DBE  // Yoshi coins collected
0xF501F2E // Exit count (2 bytes)
```

---

## ⚙️ Connection States

```javascript
SNES_DISCONNECTED = 0  // Not connected
SNES_CONNECTING   = 1  // Connecting...
SNES_CONNECTED    = 2  // Connected to server
SNES_ATTACHED     = 3  // Attached to device
```

---

## ⚠️ Common Errors

**"No USB2SNES implementation loaded"**
→ Call `setImplementation()` before other methods

**"Cannot change USB2SNES implementation while connected"**
→ Call `disconnect()` before `setImplementation()`

**"Implementation 'usb2snes_b' is not yet implemented"**
→ Only `usb2snes_a` is currently available

**WebSocket connection errors**
→ Ensure `npm install ws` has been run
→ Ensure QUsb2snes/USB2SNES server is running on correct port

---

## 🧪 Testing

```javascript
// Environment variables for tests
USB2SNES_TEST_ADDRESS=ws://localhost:64213
RHDATA_DB_PATH=/tmp/test_rhdata.db

// Run tests
npm test tests/usb2snes/
```

---

## 📦 Required Packages

```bash
# WebSocket library (REQUIRED for usb2snes_a)
npm install ws

# Already installed
npm install better-sqlite3   # For database
npm install electron         # For Electron app
```

---

## 🚀 Quick Start Checklist

- [ ] Install `ws` package: `npm install ws`
- [ ] Complete usb2snesTypeA file operations (PutFile, List, MakeDir, Remove)
- [ ] Update App.vue connectUsb2snes() to use real IPC (remove simulation)
- [ ] Start QUsb2snes or USB2SNES server
- [ ] Test connection from UI
- [ ] Test console control (Reset, Menu, Boot)
- [ ] Test memory operations (read powerup, grant powerup)
- [ ] Create SMWUsb2snes wrapper for game-specific features

---

## 📖 Full Documentation

- **Architecture:** `devdocs/SNESWRAPPER_ARCHITECTURE.md`
- **Implementation Plan:** `devdocs/USB2SNES_IMPLEMENTATION_PLAN.md`
- **Quick Start Guide:** `devdocs/USB2SNES_QUICK_START.md`
- **Summary:** `devdocs/SNESWRAPPER_IMPLEMENTATION_SUMMARY.md`

---

**Remember:** Always use SNESWrapper. Never use implementations directly. 🎯

