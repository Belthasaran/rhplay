# SNESWrapper Architecture Documentation

## Overview

The SNESWrapper module provides a unified, abstracted interface for USB2SNES communication in the RHTools application. It implements the **Strategy Pattern** to allow seamless switching between different USB2SNES implementations while providing a consistent API to the rest of the application.

**Created:** October 13, 2025  
**Status:** Implemented and Ready for Use

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Application Layer                       │
│  (App.vue, IPC Handlers, Game Stager, Chatbot, etc.)       │
└────────────────────────────┬────────────────────────────────┘
                             │
                             │ Uses ONLY SNESWrapper
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                        SNESWrapper                           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  • Unified Interface (Facade Pattern)                 │  │
│  │  • Implementation Selection/Switching                 │  │
│  │  • Connection State Management                        │  │
│  │  • Error Handling & Logging                           │  │
│  └───────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────┘
                             │
                    Delegates to selected implementation
                             │
          ┌──────────────────┴──────────────────┐
          │                                     │
          ▼                                     ▼
┌──────────────────┐              ┌──────────────────────────┐
│  usb2snes_a      │              │  usb2snes_b / qusb2snes  │
│  (Type A impl)   │              │  / node-usb              │
│                  │              │  (Other implementations) │
│  Extends         │              │                          │
│  BaseUsb2snes    │              │  Extends BaseUsb2snes    │
└──────┬───────────┘              └──────────────────────────┘
       │
       │ WebSocket Protocol
       ▼
┌─────────────────┐
│  USB2SNES       │
│  Server         │
│  (QUsb2snes)    │
└─────────────────┘
       │
       │ USB/Serial
       ▼
┌─────────────────┐
│  SNES Console   │
│  (SD2SNES, etc) │
└─────────────────┘
```

---

## Component Architecture

### 1. BaseUsb2snes (Abstract Base Class)

**File:** `electron/main/usb2snes/BaseUsb2snes.js`

**Purpose:** Defines the interface that all USB2SNES implementations must implement.

**Key Features:**
- Abstract class - cannot be instantiated directly
- Enforces consistent interface across all implementations
- Provides common constants (connection states, memory addresses)
- Includes helper methods (getState, isConnected, isAttached)

**Interface Methods (Must be implemented by subclasses):**
```javascript
// Connection
async connect(address)
async disconnect()

// Device Operations
async DeviceList()
async Attach(device)
async Info()
async Name(name)

// Console Control
async Boot(romPath)
async Menu()
async Reset()

// Memory Operations
async GetAddress(address, size)
async PutAddress(writeList)

// File Operations
async PutFile(srcFile, dstFile)
async List(dirPath)
async MakeDir(dirPath)
async Remove(path)
```

**Constants:**
```javascript
// Connection States
SNES_DISCONNECTED = 0
SNES_CONNECTING = 1
SNES_CONNECTED = 2
SNES_ATTACHED = 3

// Memory Spaces
ROM_START = 0x000000
WRAM_START = 0xF50000
WRAM_SIZE = 0x20000
SRAM_START = 0xE00000
```

### 2. SNESWrapper (Facade/Strategy Manager)

**File:** `electron/main/usb2snes/SNESWrapper.js`

**Purpose:** Provides unified interface and manages implementation selection.

**Key Responsibilities:**
1. **Implementation Management**
   - Load and instantiate selected implementation
   - Validate implementation type
   - Prevent switching while connected
   - Handle "not implemented" errors gracefully

2. **Request Delegation**
   - Forward all method calls to current implementation
   - Add logging and error handling layer
   - Ensure implementation is loaded before use

3. **State Management**
   - Track current implementation type
   - Monitor connection state
   - Provide state query methods

**Public API:**
```javascript
// Configuration
async setImplementation(type)       // Set implementation ('usb2snes_a', etc.)
getImplementationType()              // Get current implementation type
hasImplementation()                  // Check if implementation loaded

// Connection Management  
async connect(address)               // Connect to USB2SNES server
async disconnect()                   // Disconnect from server
async quickConnect(impl, address)    // Set impl + connect in one call
async fullConnect(impl, address)     // Set impl + connect + attach

// All BaseUsb2snes methods are delegated:
async DeviceList()
async Attach(device)
async Info()
async Name(name)
async Boot(romPath)
async Menu()
async Reset()
async GetAddress(address, size)
async PutAddress(writeList)
async PutFile(srcFile, dstFile)
async List(dirPath)
async MakeDir(dirPath)
async Remove(path)

// State Queries
getState()                          // Get connection state
isConnected()                       // Check if connected
isAttached()                        // Check if attached to device
getDevice()                         // Get device name
```

**Usage Example:**
```javascript
const { SNESWrapper } = require('./usb2snes/SNESWrapper');

const snes = new SNESWrapper();

// Method 1: Manual setup
await snes.setImplementation('usb2snes_a');
await snes.connect('ws://localhost:64213');
const devices = await snes.DeviceList();
await snes.Attach(devices[0]);

// Method 2: Quick connect
await snes.quickConnect('usb2snes_a', 'ws://localhost:64213');

// Method 3: Full connect (recommended)
const result = await snes.fullConnect('usb2snes_a', 'ws://localhost:64213');
console.log('Connected to:', result.device);
console.log('Firmware:', result.info.firmwareversion);

// Use it
await snes.Reset();
await snes.Boot('/work/myhack.sfc');

// Clean up
await snes.disconnect();
```

### 3. Concrete Implementations

#### usb2snesTypeA (Python Port)

**File:** `electron/main/usb2snes/usb2snesTypeA.js`

**Purpose:** JavaScript port of the py2snes Python library.

**Status:** Partial implementation (core methods done, file operations pending)

**Features:**
- WebSocket-based protocol
- Supports standard USB2SNES protocol
- Handles SD2SNES special cases (CMD space for PutAddress)
- Request locking for concurrent operation safety
- Message queue for WebSocket receive handling

**Implemented:**
- ✅ connect/disconnect
- ✅ DeviceList
- ✅ Attach
- ✅ Info
- ✅ Name
- ✅ Boot
- ✅ Menu
- ✅ Reset
- ✅ GetAddress (read memory)
- ✅ PutAddress (write memory - basic, SD2SNES pending)

**Pending:**
- ⏳ PutFile (file upload)
- ⏳ List (directory listing)
- ⏳ MakeDir (create directory)
- ⏳ Remove (delete file/dir)
- ⏳ SD2SNES PutAddress (CMD space assembly generation)

#### Other Implementations (Stubs)

**Files:** 
- `usb2snesTypeB.js` - To be created (3rd party JS library)
- `qusb2snesAdapter.js` - To be created (QUsb2snes specific)
- `nodeUsbAdapter.js` - To be created (Direct USB hardware)

**Status:** Not implemented - will throw "MODULE_NOT_FOUND" error

---

## Integration Points

### 1. IPC Handlers

**File:** `electron/ipc-handlers.js`

**Integration:** USB2SNES handlers use SNESWrapper singleton

```javascript
const { SNESWrapper } = require('./main/usb2snes/SNESWrapper');

let snesWrapper = null;

function getSnesWrapper() {
  if (!snesWrapper) {
    snesWrapper = new SNESWrapper();
  }
  return snesWrapper;
}

// Example handler
ipcMain.handle('usb2snes:connect', async (event, library, address) => {
  const wrapper = getSnesWrapper();
  const result = await wrapper.fullConnect(library, address);
  return {
    connected: true,
    device: result.device,
    firmwareVersion: result.info.firmwareversion,
    ...
  };
});
```

**Available IPC Channels:**
- `usb2snes:connect` - Connect to server
- `usb2snes:disconnect` - Disconnect
- `usb2snes:status` - Get status
- `usb2snes:reset` - Reset console
- `usb2snes:menu` - Return to menu
- `usb2snes:boot` - Boot ROM
- `usb2snes:uploadRom` - Upload file
- `usb2snes:readMemory` - Read memory
- `usb2snes:writeMemory` - Write memory
- `usb2snes:listDir` - List directory

### 2. Preload API

**File:** `electron/preload.js`

**Integration:** Exposes USB2SNES APIs to renderer process

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  // ... other APIs
  
  // USB2SNES Operations
  usb2snesConnect: (library, address) => ipcRenderer.invoke('usb2snes:connect', library, address),
  usb2snesDisconnect: () => ipcRenderer.invoke('usb2snes:disconnect'),
  usb2snesStatus: () => ipcRenderer.invoke('usb2snes:status'),
  usb2snesReset: () => ipcRenderer.invoke('usb2snes:reset'),
  usb2snesMenu: () => ipcRenderer.invoke('usb2snes:menu'),
  usb2snesBoot: (romPath) => ipcRenderer.invoke('usb2snes:boot', romPath),
  usb2snesUploadRom: (srcPath, dstPath) => ipcRenderer.invoke('usb2snes:uploadRom', srcPath, dstPath),
  usb2snesReadMemory: (address, size) => ipcRenderer.invoke('usb2snes:readMemory', address, size),
  usb2snesWriteMemory: (writeList) => ipcRenderer.invoke('usb2snes:writeMemory', writeList),
  usb2snesListDir: (dirPath) => ipcRenderer.invoke('usb2snes:listDir', dirPath),
});
```

### 3. Frontend (Renderer)

**File:** `electron/renderer/src/App.vue`

**Integration:** Uses electronAPI to communicate with USB2SNES

```javascript
async function connectUsb2snes() {
  try {
    const library = usb2snesCurrentLibrary.value;
    const address = settings.usb2snesAddress;
    
    const result = await (window as any).electronAPI.usb2snesConnect(library, address);
    
    usb2snesStatus.connected = true;
    usb2snesStatus.device = result.device;
    usb2snesStatus.firmwareVersion = result.firmwareVersion;
    // ... update UI
  } catch (error) {
    // ... handle error
  }
}
```

---

## Data Flow

### Connection Flow

```
1. User clicks "Connect" in UI (App.vue)
   ↓
2. Frontend calls electronAPI.usb2snesConnect(library, address)
   ↓
3. IPC message sent to main process
   ↓
4. IPC handler (ipc-handlers.js) receives message
   ↓
5. Handler gets/creates SNESWrapper singleton
   ↓
6. SNESWrapper.fullConnect(library, address) called
   ↓
7. SNESWrapper.setImplementation(library)
   - Loads implementation module (e.g., usb2snesTypeA)
   - Creates implementation instance
   - Stores as current implementation
   ↓
8. SNESWrapper.connect(address)
   - Delegates to implementation.connect()
   ↓
9. Implementation connects to WebSocket server
   ↓
10. SNESWrapper.DeviceList()
    - Delegates to implementation.DeviceList()
    ↓
11. SNESWrapper.Attach(device)
    - Delegates to implementation.Attach()
    ↓
12. SNESWrapper.Info()
    - Delegates to implementation.Info()
    ↓
13. Connection info returned through IPC
    ↓
14. Frontend receives result and updates UI
```

### Memory Read Flow

```
1. Frontend: electronAPI.usb2snesReadMemory(0xF50019, 1)
   ↓
2. IPC: 'usb2snes:readMemory' → ipc-handlers.js
   ↓
3. Handler: getSnesWrapper().GetAddress(0xF50019, 1)
   ↓
4. SNESWrapper: delegates to implementation.GetAddress()
   ↓
5. Implementation:
   - Sends JSON: {"Opcode": "GetAddress", "Space": "SNES", "Operands": ["f50019", "1"]}
   - Receives binary data from WebSocket
   - Returns Buffer
   ↓
6. Handler: Converts Buffer to Array for IPC
   ↓
7. Frontend: Receives {data: [0x02]} (cape powerup)
```

---

## Error Handling

### Implementation Not Found

```javascript
// SNESWrapper handles gracefully
try {
  await snes.setImplementation('usb2snes_b');
} catch (error) {
  // Error: "Implementation 'usb2snes_b' is not yet implemented. 
  //         Only usb2snes_a is currently available."
}
```

### Implementation Not Set

```javascript
// SNESWrapper checks before delegating
const snes = new SNESWrapper();
try {
  await snes.connect('ws://localhost:64213');
} catch (error) {
  // Error: "No USB2SNES implementation loaded. Call setImplementation() first."
}
```

### Cannot Change While Connected

```javascript
await snes.fullConnect('usb2snes_a', 'ws://localhost:64213');
try {
  await snes.setImplementation('usb2snes_b');
} catch (error) {
  // Error: "Cannot change USB2SNES implementation while connected. Disconnect first."
}
```

### Connection Errors

```javascript
try {
  await snes.connect('ws://localhost:99999');  // Wrong port
} catch (error) {
  // Error propagated from implementation
  // Connection state reset to DISCONNECTED
}
```

---

## Testing Strategy

### Unit Tests

**Test SNESWrapper in isolation:**

```javascript
describe('SNESWrapper', () => {
  it('should load usb2snes_a implementation', async () => {
    const snes = new SNESWrapper();
    await snes.setImplementation('usb2snes_a');
    expect(snes.getImplementationType()).toBe('usb2snes_a');
  });
  
  it('should prevent implementation change while connected', async () => {
    const snes = new SNESWrapper();
    await snes.fullConnect('usb2snes_a', 'ws://localhost:64213');
    await expect(snes.setImplementation('usb2snes_b'))
      .rejects.toThrow('Cannot change USB2SNES implementation while connected');
  });
});
```

**Test implementations:**

```javascript
describe('usb2snesTypeA', () => {
  it('should connect to USB2SNES server', async () => {
    const impl = new Usb2snesTypeA();
    await impl.connect(process.env.USB2SNES_TEST_ADDRESS || 'ws://localhost:64213');
    expect(impl.getState()).toBe(SNES_CONNECTED);
  });
  
  it('should read memory correctly', async () => {
    // ... test memory operations
  });
});
```

### Integration Tests

**Test full stack:**

```javascript
describe('USB2SNES Integration', () => {
  it('should connect through wrapper and read memory', async () => {
    const snes = new SNESWrapper();
    await snes.fullConnect('usb2snes_a', 'ws://localhost:64213');
    
    // Read powerup status
    const data = await snes.GetAddress(0xF50019, 1);
    expect(data).toBeInstanceOf(Buffer);
    expect(data.length).toBe(1);
    
    await snes.disconnect();
  });
});
```

---

## Benefits of This Architecture

### 1. **Separation of Concerns**
- Application code doesn't know about USB2SNES implementation details
- Easy to mock SNESWrapper for testing
- Implementation can change without affecting application

### 2. **Flexibility**
- Easy to add new implementations
- Can switch implementations at runtime
- Can test different implementations side-by-side

### 3. **Maintainability**
- Single point of change for USB2SNES interface
- Consistent error handling
- Centralized logging

### 4. **Extensibility**
- Can add SMW-specific wrapper on top (SMWUsb2snes extends SNESWrapper)
- Can add middleware (caching, rate limiting, etc.)
- Can add protocol analyzers/debuggers

### 5. **Safety**
- Enforces interface through BaseUsb2snes
- Prevents invalid state transitions
- Type safety through JSDoc comments

---

## Future Enhancements

### 1. SMW-Specific Wrapper

**File:** `electron/main/usb2snes/SMWUsb2snes.js`

```javascript
class SMWUsb2snes {
  constructor(snesWrapper) {
    this.snes = snesWrapper;
  }
  
  async isInLevel() {
    const gameMode = await this.snes.GetAddress(0xF50100, 1);
    // ... SMW-specific logic
  }
  
  async grantPowerup(type) {
    const powerupValues = { cape: 0x02, fire: 0x03, super: 0x01 };
    await this.snes.PutAddress([[0xF50019, Buffer.from([powerupValues[type]])]]);
  }
}
```

### 2. Connection Pool

Support multiple simultaneous connections (if hardware supports):

```javascript
class SNESConnectionPool {
  constructor() {
    this.connections = new Map();
  }
  
  async getConnection(name, implementation) {
    if (!this.connections.has(name)) {
      const snes = new SNESWrapper();
      await snes.setImplementation(implementation);
      this.connections.set(name, snes);
    }
    return this.connections.get(name);
  }
}
```

### 3. Middleware System

Add request/response interceptors:

```javascript
snesWrapper.use(async (method, args, next) => {
  console.log(`USB2SNES: ${method}(${args})`);
  const start = Date.now();
  const result = await next();
  console.log(`USB2SNES: ${method} took ${Date.now() - start}ms`);
  return result;
});
```

---

## File Structure Summary

```
electron/
├── main/
│   └── usb2snes/
│       ├── BaseUsb2snes.js          ← Abstract base class
│       ├── SNESWrapper.js           ← Main facade/wrapper
│       ├── usb2snesTypeA.js         ← Implementation (Python port)
│       ├── usb2snesTypeB.js         ← Implementation (3rd party) [TBD]
│       ├── qusb2snesAdapter.js      ← Implementation (QUsb2snes) [TBD]
│       ├── nodeUsbAdapter.js        ← Implementation (node-usb) [TBD]
│       └── SMWUsb2snes.js           ← SMW-specific wrapper [TBD]
├── ipc-handlers.js                  ← IPC integration
└── preload.js                       ← Renderer API exposure

tests/
└── usb2snes/
    ├── test_wrapper.js              ← SNESWrapper tests
    ├── test_typeA.js                ← usb2snesTypeA tests
    └── test_integration.js          ← Full stack tests
```

---

## Quick Reference

### Creating New Implementation

1. Extend BaseUsb2snes
2. Implement all required methods
3. Save as `electron/main/usb2snes/yourImpl.js`
4. Update SNESWrapper.setImplementation() switch case
5. Add to UI dropdown in App.vue settings
6. Test with `SNESWrapper.setImplementation('yourImpl')`

### Using SNESWrapper in New Code

```javascript
// Import
const { SNESWrapper } = require('./main/usb2snes/SNESWrapper');

// Create and connect
const snes = new SNESWrapper();
await snes.fullConnect('usb2snes_a', 'ws://localhost:64213');

// Use any BaseUsb2snes method
await snes.Reset();
const data = await snes.GetAddress(0xF50019, 1);

// Clean up
await snes.disconnect();
```

**Key Rule:** NEVER directly import or use usb2snesTypeA or other implementations. ALWAYS use SNESWrapper.

---

**Last Updated:** October 13, 2025

