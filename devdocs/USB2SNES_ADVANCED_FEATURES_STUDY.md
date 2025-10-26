# USB2SNES Advanced Features Study

**Date:** October 13, 2025  
**Purpose:** Identify advanced features in C#/C/Rust implementations not yet in JavaScript/Python  
**Goal:** Plan enhancements for usb2snesTypeA and py2snes

---

## 📋 Current Implementation Status

### What We Have ✅

**Basic Protocol:**
- Connect/Disconnect/Attach
- DeviceList, Info, Name
- Boot, Menu, Reset

**Memory Operations:**
- GetAddress (read single address)
- PutAddress (write single/multiple addresses)
- Full SD2SNES support (65816 assembly)

**File Operations:**
- PutFile (upload with reliability fixes)
- PutFileBlocking (guaranteed completion)
- List (directory listing)
- MakeDir, Remove

**SMW-Specific:**
- Cape powerup, timer manipulation
- In-level detection

---

## 🔍 Feature Gap Analysis

### 1. **GetFile - File Download from Console** ⚠️ MISSING

**Status:** Commented out in py2snes, not implemented in usb2snesTypeA

**Found in:**
- ✅ Rust usb2snes-cli (lines 246-264)
- ✅ Rust goofgenie (same implementation)
- ❌ Our Python py2snes (commented out, lines 298-333)
- ❌ Our JavaScript usb2snesTypeA (not implemented)

**Rust Implementation:**
```rust
pub fn get_file(&mut self, path: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    // Send GetFile command
    self.send_command(Command::GetFile, &[Cow::Borrowed(path)])?;
    
    // Get size from reply
    let string_hex = self.get_reply()?.Results[0].to_string();
    let size = usize::from_str_radix(&string_hex, 16)?;
    
    // Read binary data in loop until complete
    let mut data: Vec<u8> = Vec::with_capacity(size);
    loop {
        let reply = self.client.read()?;
        match reply {
            Message::Binary(msgdata) => {
                data.extend(&msgdata);
            }
            _ => Err("Error getting a reply")?,
        }
        if data.len() == size {
            break;
        }
    }
    Ok(data)
}
```

**Protocol:**
1. Send JSON: `{"Opcode": "GetFile", "Space": "SNES", "Operands": [filepath]}`
2. Receive JSON reply with size in hex: `{"Results": ["<size_hex>"]}`
3. Receive binary data in chunks until complete

**Use Cases:**
- Download ROM files from console
- Extract savestates
- Backup files from SD card
- Analyze ROM data
- Export game data

**Reliability Concerns:**
- Same issues as PutFile (no acknowledgment protocol)
- May need timeout handling
- May need verification
- Should track progress

**Recommendation:**
✅ Implement GetFile with same reliability features as PutFile:
- Progress callback support
- Byte count verification
- Timeout protection (GetFileBlocking)
- Configurable chunk size for reading

---

### 2. **Savestate Management** ⚠️ MISSING

**Found in:** Savestate2snes (C++ Qt application)

**How it Works:**

**Memory Interface Addresses:**
```cpp
// Firmware v11+:
savestateInterfaceAddress = 0xFE1000;
savestateDataAddress = 0xF00000;

// Firmware < v11:
savestateInterfaceAddress = 0xFC2000;
savestateDataAddress = 0xF00000;

// Interface structure:
$FC2000/$FE1000: saveState flag (1 = trigger save)
$FC2001/$FE1001: loadState flag (1 = trigger load)
$FC2002/$FE1002: saveButton (controller shortcut)
$FC2004/$FE1004: loadButton (controller shortcut)
```

**Save State Process:**
1. Check interface bytes are 0 (safe state)
2. Write 1 to saveState flag (0xFC2000)
3. Poll until flag returns to 0 (save complete)
4. Read 320KB from savestateDataAddress (0xF00000)
5. Save to file

**Load State Process:**
1. Read savestate file (320KB)
2. Check interface bytes are 0 (safe state)
3. Write savestate data to savestateDataAddress (0xF00000)
4. Write 1 to loadState flag (0xFC2001)
5. Poll until flag returns to 0 (load complete)

**Features:**
- Requires ROM patch (included in Savestate2snes)
- Works with SD2SNES firmware 6+
- 320KB savestate size
- Controller button shortcuts
- Safe state detection (waits for safe moment)

**Implementation Complexity:** MEDIUM

**Use Cases:**
- Practice difficult sections
- Speedrun practice
- Game state management
- Training mode
- Challenge runs

**Recommendation:**
✅ Implement savestate management:
- Add `SaveState()` method
- Add `LoadState(data)` method
- Add `GetSavestateData()` method (reads 320KB)
- Add firmware version detection
- Add safe state polling
- Requires ROM patching (can use existing patches)

---

### 3. **Efficient Multi-Address Operations** ⚠️ PARTIALLY IMPLEMENTED

**Found in:** Rust goofgenie (lines 295-327)

**get_addresses (batch read):**
```rust
pub fn get_addresses(&mut self, pairs: &[(u32, usize)]) -> Result<Vec<Vec<u8>>, Box<dyn Error>> {
    // Build operands for multiple addresses
    let mut args = Vec::with_capacity(pairs.len() * 2);
    let mut total_size = 0;
    for &(address, size) in pairs.iter() {
        args.push(Cow::Owned(format!("{:x}", address)));
        args.push(Cow::Owned(format!("{:x}", size)));
        total_size += size;
    }
    
    // Send single GetAddress command with multiple address/size pairs
    self.send_command_with_space(Command::GetAddress, Some(Space::SNES), &args)?;
    
    // Read all data
    let mut data: Vec<u8> = Vec::with_capacity(total_size);
    loop {
        let reply = self.client.read()?;
        match reply {
            Message::Binary(msgdata) => {
                data.extend(&msgdata);
            }
            _ => Err("Error getting a reply")?,
        }
        if data.len() == total_size {
            break;
        }
    }
    
    // Split data into individual results
    let mut ret: Vec<Vec<u8>> = Vec::with_capacity(pairs.len());
    let mut consumed = 0;
    for &(_address, size) in pairs.iter() {
        ret.push(data[consumed..consumed + size].into());
        consumed += size;
    }
    Ok(ret)
}
```

**Current Implementation:**
- ✅ We have PutAddress with multiple addresses (writeList)
- ❌ We only support single-address GetAddress
- ❌ No batch GetAddress support

**Benefits of Batch Operations:**
- **Much faster** - one WebSocket round-trip instead of many
- **Atomic** - reads happen at same time
- **Less overhead** - single request lock, single command
- **Better for polling** - read multiple game state variables at once

**Example Use Case:**
```javascript
// Instead of this (slow):
const powerup = await snes.GetAddress(0xF50019, 1);
const lives = await snes.GetAddress(0xF50DBE, 1);
const coins = await snes.GetAddress(0xF50DBF, 1);
const timer1 = await snes.GetAddress(0xF50F31, 1);
const timer2 = await snes.GetAddress(0xF50F32, 1);
const timer3 = await snes.GetAddress(0xF50F33, 1);

// Do this (fast):
const results = await snes.GetAddresses([
  [0xF50019, 1],  // powerup
  [0xF50DBE, 1],  // lives
  [0xF50DBF, 1],  // coins
  [0xF50F31, 3]   // timer (all 3 bytes at once)
]);
```

**Recommendation:**
✅ Implement `GetAddresses(addressList)` method:
- Takes array of [address, size] tuples
- Sends single GetAddress command with multiple operands
- Receives all data in one response
- Returns array of Buffers
- Much more efficient for game state polling

---

### 4. **ROM Space Access** ⚠️ PARTIALLY SUPPORTED

**Current Status:**
- ✅ ROM_START constant defined (0x000000)
- ✅ GetAddress can read ROM space
- ✅ PutAddress can write ROM space (on emulators)
- ❌ Not tested/verified for ROM manipulation
- ❌ No ROM-specific helpers

**Memory Map:**
```
ROM Space:  0x000000 - 0x3FFFFF (4MB max)
WRAM Space: 0xF50000 - 0xF6FFFF (128KB)
SRAM Space: 0xE00000 - 0xE1FFFF (128KB)
```

**Use Cases:**
- **ROM Analysis:** Read ROM headers, level data, graphics
- **Live ROM Patching:** Modify ROM data without saving to file
- **Dynamic Level Loading:** Swap level data on-the-fly
- **Asset Replacement:** Replace graphics/music in memory
- **ROM Hacking:** Test changes without flashing ROM

**Capability:**
✅ **We CAN already do this!** GetAddress/PutAddress work on ROM space.

**What's Missing:**
- ROM-specific helper functions
- Documentation of ROM addresses
- Tools for ROM manipulation
- Integration with our ROM tools (FLIPS, etc.)

**Hypothetical Use Cases:**

**1. Live Patch Application:**
```javascript
// Read ROM into memory
const romData = await snes.GetAddress(ROM_START, romSize);

// Apply BPS/IPS patch in JavaScript
const patchedRom = applyBPSPatch(romData, patchFile);

// Write patched ROM back to console
await snes.PutAddress([[ROM_START, patchedRom]]);

// Reboot to apply changes
await snes.Reset();
```

**2. Dynamic Level Swapping:**
```javascript
// Read level data from alternate ROM
const levelData = readLevelFromFile('custom-level.bin');

// Write to ROM space where current level loads from
await snes.PutAddress([[ROM_LEVEL_ADDRESS, levelData]]);

// Trigger level reload
await snes.Menu();
await snes.Boot('/work/rom.sfc');
```

**Limitations:**
- **ROM writes may not persist** - depends on device
- **SD2SNES ROM space is READ-ONLY** - cannot write to ROM on hardware
- **Emulators allow ROM writes** - can patch live
- **Would need to patch WRAM** - where ROM data is copied during execution

**Recommendation:**
✅ Add ROM analysis helpers:
- `GetROMHeader()` - Read ROM header
- `GetROMData(offset, size)` - Convenience wrapper
- `AnalyzeROM()` - Extract ROM info
- Document ROM address space
- Add examples for ROM reading

⚠️ Live ROM patching limited by hardware:
- Works on emulators
- SD2SNES ROM is read-only
- Must patch WRAM where code executes
- Or upload pre-patched ROM file

---

### 5. **Batched PutAddress Operations** ⚠️ COULD BE BETTER

**Current Implementation:**
```javascript
// We support multiple addresses in one call:
await snes.PutAddress([
  [0xF50019, Buffer.from([0x02])],
  [0xF50DBE, Buffer.from([0x99])],
  [0xF50DBF, Buffer.from([0x99])]
]);
```

**But:** Each address sends separately (not truly batched)

**From py2snes (lines 282-292):**
```python
for address, data in write_list:
    PutAddress_Request['Operands'] = [hex(address)[2:], hex(len(data))[2:]]
    await self.socket.send(json.dumps(request))  # Separate request!
    await self.socket.send(data)
```

**Protocol Note (from py2snes comment line 284):**
```
#will pack those requests as soon as qusb2snes actually supports that for real
```

**Meaning:** QUsb2snes doesn't actually support batched PutAddress properly!

**Current Approach:**
- Multiple separate PutAddress requests
- Each has overhead
- Not atomic

**Potential Improvement:**
If protocol supported it:
- Single PutAddress with multiple address/size/data tuples
- Would be atomic
- Less overhead

**Recommendation:**
⏸️ Wait for protocol support:
- Current approach is correct given protocol limitations
- Monitor QUsb2snes development for batch PutAddress support
- Can optimize later if protocol adds it

---

### 6. **Savestate Slot Management** ⚠️ MISSING

**Found in:** Savestate2snes application

**Capabilities:**
- Multiple savestate slots per game
- Organize by categories and subcategories
- Quick load/save with keyboard shortcuts
- Controller button shortcuts (Select+L/R)
- Training timer integration
- Practice mode features

**Memory Interface:**
```
Savestate Interface (0xFC2000 or 0xFE1000):
+0x00: saveState flag
+0x01: loadState flag
+0x02-0x03: saveButton shortcut
+0x04-0x05: loadButton shortcut

Savestate Data (0xF00000):
- 320KB savestate data buffer
```

**Implementation Requirements:**
1. **ROM Patch:** Must patch ROM with savestate handler
   - Patches available in Savestate2snes/Patches/
   - savestatev7.ips, savestatev8.ips
2. **Safe State Detection:** Wait for both flags = 0
3. **Data Transfer:** Read/Write 320KB to/from 0xF00000
4. **Controller Detection:** Monitor button combinations

**Features to Implement:**

**Core:**
- `CheckSavestateSupport()` - Detect if ROM is patched
- `SaveStateToMemory()` - Trigger save, read 320KB data
- `LoadStateFromMemory(data)` - Write 320KB, trigger load
- `WaitForSafeState()` - Poll until safe to save/load

**Advanced:**
- `SetSaveShortcut(buttons)` - Configure save button combo
- `SetLoadShortcut(buttons)` - Configure load button combo
- `DetectControllerSave()` - Monitor for user pressing save combo
- `DetectControllerLoad()` - Monitor for user pressing load combo

**Slot Management (Application Level):**
- Save to file: `savestate_<game>_<slot>.sav`
- Load from file
- List available slots
- Manage categories

**Implementation Complexity:** MEDIUM-HIGH

**Use Cases:**
- Practice mode for difficult sections
- Speedrun practice and routing
- Challenge runs with checkpoints
- Training timers
- Game state experiments

**Recommendation:**
✅ HIGH PRIORITY - Implement savestate management:
- Very useful for speedrunning and practice
- Well-documented in Savestate2snes
- ROM patches already exist
- Clear memory interface
- Would integrate well with RHTools

---

### 7. **Memory Watching / Polling** ⚠️ PARTIALLY POSSIBLE

**Found in:** Savestate2snes, SMAutoTracker

**Current Support:**
- ✅ Can poll with `GetAddress()` in a loop
- ❌ No optimized polling mechanism
- ❌ No batch read support

**Use Case (from Savestate2snes):**
```cpp
// Poll savestate interface every 30ms
memoryToCheck << QPair<quint32, quint8>(savestateInterfaceAddress, 0x16);
usb2snes->getAsyncAddress(memoryToCheck);

// On data received:
void onGetAddressDataReceived() {
    const QByteArray& data = usb2snes->getAsyncAdressData();
    // Process state changes
}
```

**Optimal Implementation:**
1. Use `GetAddresses()` (batch read) for multiple locations
2. Poll at configurable interval (e.g., 30ms, 100ms, 1000ms)
3. Detect changes and trigger callbacks
4. Efficient for game state monitoring

**Use Cases:**
- Item tracker (like SMAutoTracker)
- Game state detection (in level, at menu, etc.)
- Automatic actions based on game state
- Livesplit auto-splitter integration
- Twitch integration

**Recommendation:**
✅ Implement efficient memory watching:
- `WatchMemory(addresses, interval, callback)` helper
- Uses batch GetAddresses for efficiency
- Detects changes and triggers callbacks
- Can stop/start watching
- Foundation for advanced features

---

### 8. **Async/Non-Blocking Operations** ⚠️ PARTIALLY SUPPORTED

**Found in:** C++ Savestate2snes uses Qt's signal/slot system

**Current:**
- ✅ JavaScript is inherently async
- ✅ Python uses asyncio
- ❌ No event-based notifications
- ❌ All operations are "pull" not "push"

**C++ Approach:**
```cpp
// Request data asynchronously
usb2snes->getAsyncAddress(address, size);

// Data arrives later via signal
connect(usb2snes, &USB2snes::getAddressDataReceived, 
        this, &Handler::onDataReceived);

void onDataReceived() {
    const QByteArray& data = usb2snes->getAsyncAdressData();
    // Process data
}
```

**Our Approach:**
```javascript
// Already async, just await
const data = await snes.GetAddress(address, size);
```

**Already Good!** Our async/await is cleaner than C++ callbacks.

**Recommendation:**
✅ Current approach is fine
- JavaScript/Python async/await is modern and clean
- No need for complex event system
- Can add events on top if needed for UI

---

### 9. **ROM Patching (BPS/IPS)** ⚠️ POSSIBLE BUT NOT IMPLEMENTED

**Current Support:**
- ✅ We have FLIPS tool integration (apply patches to files)
- ❌ No live memory patching
- ❌ No in-memory patch application

**Hypothetical Live Patching:**

**Scenario 1: Patch ROM File Then Upload**
```javascript
// This already works in RHTools!
1. Read vanilla ROM file
2. Apply BPS/IPS patch with FLIPS
3. Upload patched ROM with PutFile
4. Boot patched ROM
```

**Scenario 2: Patch Loaded ROM in Memory (Emulator Only)**
```javascript
// Read current ROM from emulator memory
const romData = await snes.GetAddress(ROM_START, romSize);

// Apply patch in JavaScript (would need BPS/IPS library)
const patchedData = applyBPSPatch(romData, patchFile);

// Write back (emulator only - ROM writable)
await snes.PutAddress([[ROM_START, patchedData]]);

// Reset to apply
await snes.Reset();
```

**Scenario 3: Patch WRAM Where Code Executes**
```javascript
// Find code location in WRAM
const codeAddress = 0xF50000 + offset;

// Read current code
const code = await snes.GetAddress(codeAddress, codeSize);

// Patch code bytes
const patchedCode = applyPatch(code, patch);

// Write patched code
await snes.PutAddress([[codeAddress, patchedCode]]);

// Code executes with patches!
```

**Limitations:**
- **SD2SNES ROM is READ-ONLY** - can't patch ROM on hardware
- **Only works on emulators** for ROM space writes
- **WRAM patching works everywhere** but requires finding code in WRAM
- **Temporary** - resets on reboot

**Recommendation:**
✅ Add BPS/IPS JavaScript library integration:
- Can patch files before upload (already works via FLIPS)
- Can patch memory (WRAM) for live changes
- Document ROM vs WRAM patching
- Add helper functions for common patches

⚠️ Live ROM patching limited to emulators only

---

### 10. **GetFile Implementation** ⚠️ MISSING - HIGH PRIORITY

**Protocol:** (from Rust implementation)

```
1. Send: {"Opcode": "GetFile", "Space": "SNES", "Operands": [filepath]}
2. Receive JSON: {"Results": ["<size_hex>"]}
3. Receive binary data chunks until size reached
```

**Should Implement With:**
- Progress callback (like PutFile)
- Timeout protection
- Verification (size check)
- GetFileBlocking version
- Configurable buffer size

**Implementation:**
```javascript
async GetFile(filepath, progressCallback = null) {
  // Acquire lock
  await this.requestLock;
  
  try {
    // Send command
    const request = {
      Opcode: "GetFile",
      Space: "SNES",
      Operands: [filepath]
    };
    this.socket.send(JSON.stringify(request));
    
    // Get size from reply
    const reply = await this._waitForResponse(5000);
    const sizeHex = reply.Results[0];
    const size = parseInt(sizeHex, 16);
    
    // Progress: initial
    if (progressCallback) progressCallback(0, size);
    
    // Read binary data
    let data = Buffer.alloc(0);
    while (data.length < size) {
      const chunk = await this._waitForBinaryResponse(5000);
      if (!chunk) break;
      data = Buffer.concat([data, chunk]);
      
      // Progress: update
      if (progressCallback) progressCallback(data.length, size);
    }
    
    // Verify size
    if (data.length !== size) {
      throw new Error(`GetFile incomplete: ${data.length}/${size} bytes`);
    }
    
    return data;
  } finally {
    this.requestLock = false;
  }
}

async GetFileBlocking(filepath, timeoutMs = null, progressCallback = null) {
  // Similar to PutFileBlocking
  const result = await Promise.race([
    this.GetFile(filepath, progressCallback),
    timeoutPromise
  ]);
  return result;
}
```

**Recommendation:**
✅ IMPLEMENT GetFile/GetFileBlocking:
- Mirror PutFile reliability features
- Enable ROM/file downloads
- Foundation for savestate retrieval
- Needed for backup/analysis features

---

### 11. **Stream/Bulk Memory Operations** ⚠️ OPTIMIZATION

**Observed in:** Some implementations use larger buffers for bulk operations

**Current:**
- PutAddress: Can write multiple locations
- GetAddress: Single location only

**Potential Optimization:**
```javascript
// Bulk write to contiguous memory
async PutMemoryBulk(startAddress, data) {
  // Split into optimal chunks (e.g., 1024 bytes)
  // Send as multiple PutAddress operations
  // More efficient than many small writes
}

// Bulk read from contiguous memory
async GetMemoryBulk(startAddress, size, progressCallback) {
  // Read in optimal chunks
  // Combine results
  // Progress updates during read
}
```

**Use Cases:**
- Downloading large WRAM dumps
- Uploading large data blocks
- Memory analysis tools
- Save data manipulation

**Recommendation:**
✅ Add convenience helpers:
- `GetMemoryBulk(start, size, callback)` - chunked read
- `PutMemoryBulk(start, data, callback)` - chunked write
- Handle chunking automatically
- Progress tracking
- Better for large transfers

---

## 📊 Feature Priority Matrix

| Feature | Priority | Complexity | Impact | Effort |
|---------|----------|------------|--------|--------|
| **GetFile/GetFileBlocking** | 🔴 HIGH | Low | High | 1-2 days |
| **GetAddresses (batch)** | 🔴 HIGH | Low | High | 1 day |
| **Savestate Management** | 🟡 MEDIUM | Medium | Very High | 3-5 days |
| **Memory Watching** | 🟡 MEDIUM | Low | Medium | 1-2 days |
| **ROM Analysis Helpers** | 🟡 MEDIUM | Low | Medium | 1 day |
| **Bulk Memory Operations** | 🟢 LOW | Low | Low | 1 day |
| **Live ROM Patching** | 🟢 LOW | High | Low | N/A (hardware limited) |

---

## 🔧 Recommended Implementation Order

### Phase 1: Essential Missing Features (HIGH PRIORITY)

**1. GetFile/GetFileBlocking** (1-2 days)
- Mirror PutFile implementation
- Progress callback support
- Reliability features (timeout, verification)
- Enable file downloads from console

**2. GetAddresses - Batch Read** (1 day)
- Much more efficient than multiple GetAddress calls
- Single WebSocket round-trip
- Critical for polling game state
- Foundation for advanced features

---

### Phase 2: Advanced Features (MEDIUM PRIORITY)

**3. Savestate Management** (3-5 days)
- Read/write savestate data (320KB)
- Interface with 0xFC2000/0xFE1000
- Safe state detection
- Controller shortcut support
- File management (slot system)
- **HIGH VALUE for users!**

**4. Memory Watching System** (1-2 days)
- Efficient polling with GetAddresses
- Change detection
- Callback system
- Foundation for trackers/automation

**5. ROM Analysis Helpers** (1 day)
- GetROMHeader()
- Analyze ROM info
- Documentation of ROM addresses
- Integration with existing ROM tools

---

### Phase 3: Optimizations (LOW PRIORITY)

**6. Bulk Memory Helpers** (1 day)
- GetMemoryBulk, PutMemoryBulk
- Automatic chunking
- Progress tracking
- Convenience wrappers

---

## 💡 Advanced Use Case Scenarios

### Use Case #1: Speedrun Practice with Savestates

```javascript
// Save practice checkpoint
const savestateData = await snes.SaveStateToMemory();
await saveToFile(savestateData, 'practice_checkpoint_1.sav');

// Practice section...

// Restore checkpoint instantly
const savestateData = await readFromFile('practice_checkpoint_1.sav');
await snes.LoadStateFromMemory(savestateData);
```

**Enables:**
- Instant retry of difficult sections
- Practice routing
- Training mode
- Challenge runs with checkpoints

---

### Use Case #2: Efficient Game State Polling

```javascript
// Instead of 6 separate calls:
const powerup = await snes.GetAddress(0xF50019, 1);
const gameMode = await snes.GetAddress(0xF50100, 1);
const paused = await snes.GetAddress(0xF513D4, 1);
// ... etc

// Single batched call:
const [powerup, gameMode, paused, animation, keyhole, timer] = 
  await snes.GetAddresses([
    [0xF50019, 1],  // powerup
    [0xF50100, 1],  // gameMode
    [0xF513D4, 1],  // paused
    [0xF50071, 1],  // animation
    [0xF51434, 1],  // keyhole
    [0xF51493, 1]   // timer
  ]);

// Much faster! Single WebSocket round-trip.
```

**Enables:**
- Real-time game state monitoring
- Item trackers (like SMAutoTracker)
- Auto-splitters (like Livesplit)
- Twitch integration
- Bot commands

---

### Use Case #3: ROM Analysis and Verification

```javascript
// Download ROM from console
const romData = await snes.GetFileBlocking('/work/rom.sfc', null, (progress, total) => {
  console.log(`Download: ${Math.round(progress/total*100)}%`);
});

// Analyze ROM header
const header = analyzeROMHeader(romData);
console.log('Game:', header.title);
console.log('Region:', header.region);

// Verify ROM matches expected
const hash = calculateSHA256(romData);
if (hash !== expectedHash) {
  throw new Error('ROM mismatch!');
}

// Save locally
await fs.writeFile('/local/backup.sfc', romData);
```

**Enables:**
- ROM verification
- Backup from console
- ROM analysis
- Version detection

---

### Use Case #4: Dynamic Content Loading

```javascript
// Read alternate level data from file
const customLevel = await fs.readFile('custom-level.bin');

// Patch into WRAM where level loads
await snes.PutAddress([[LEVEL_DATA_ADDRESS, customLevel]]);

// Trigger level reload
await snes.Reset();

// Custom level loads without permanent ROM modification!
```

**Enables:**
- Dynamic level switching
- Asset swapping
- Testing ROM hacks without flashing
- Temporary modifications

---

### Use Case #5: Live Memory Editing (Game Genie-like)

```javascript
// Read memory location
const currentValue = await snes.GetAddress(0xF50019, 1);

// Apply cheat/modification
await snes.PutAddress([[0xF50019, Buffer.from([0xFF])]]);  // Invincibility?

// Watch for changes
const watcher = new MemoryWatcher(snes);
watcher.watch(0xF50019, 1, (oldValue, newValue) => {
  console.log(`Powerup changed: ${oldValue} -> ${newValue}`);
});
```

**Enables:**
- Game Genie-like cheat codes
- Live memory editing
- Real-time game modification
- Training/practice modes

---

## 🔬 Reliability Improvements for Existing Operations

### GetAddress - Already Good ✅

**Current Implementation:**
- Uses request lock
- Has timeout (5 seconds)
- Reads until size complete
- Error handling

**Potential Improvements:**
- Progress callback for large reads
- Batch reading (GetAddresses)
- Configurable timeout

**Priority:** LOW - works well enough

---

### List - Could Be More Robust ⚠️

**Current Implementation:**
- Validates path format
- Checks parent directories exist
- Parses alternating type/filename pairs

**Potential Issues:**
- If directory doesn't exist, throws error (good)
- No timeout on directory listing
- No retry logic

**Potential Improvements:**
- Add timeout for List operation
- Cache directory listings for performance
- Add `ListRecursive(path)` for deep listings

**Priority:** LOW - works adequately

---

### GetAddress Batch Operations - HIGH VALUE ⭐

**Current:** Each GetAddress is separate call

**Improvement:** GetAddresses for batch reading

**Implementation:**
```javascript
async GetAddresses(addressList) {
  // addressList: [[addr1, size1], [addr2, size2], ...]
  
  await this.requestLock;
  try {
    // Build operands
    const operands = [];
    let totalSize = 0;
    for (const [addr, size] of addressList) {
      operands.push(addr.toString(16));
      operands.push(size.toString(16));
      totalSize += size;
    }
    
    // Send command
    const request = {
      Opcode: "GetAddress",
      Space: "SNES",
      Operands: operands
    };
    this.socket.send(JSON.stringify(request));
    
    // Read all data
    let data = Buffer.alloc(0);
    while (data.length < totalSize) {
      const chunk = await this._waitForBinaryResponse(5000);
      data = Buffer.concat([data, chunk]);
    }
    
    // Split into individual results
    const results = [];
    let consumed = 0;
    for (const [_, size] of addressList) {
      results.push(data.slice(consumed, consumed + size));
      consumed += size;
    }
    
    return results;
  } finally {
    this.requestLock = false;
  }
}
```

**Impact:**
- **10x+ faster** for reading multiple locations
- Enables efficient polling
- Foundation for trackers/automation
- Critical for game state monitoring

**Priority:** HIGH - Should implement soon

---

## 🎯 Recommended Roadmap

### Immediate (Next Week)

**1. GetFile + GetFileBlocking**
- Critical missing feature
- Mirrors PutFile
- Enables downloads/backups
- Low complexity

**2. GetAddresses (Batch Read)**
- High performance impact
- Low complexity
- Enables advanced features
- Foundation for polling

---

### Short-term (Next Month)

**3. Savestate Management**
- Very valuable for users
- Medium complexity
- Well-documented
- ROM patches exist
- Integration with practice modes

**4. Memory Watching System**
- Built on GetAddresses
- Enables automation
- Foundation for trackers
- Medium complexity

---

### Long-term (Future)

**5. ROM Analysis Helpers**
- Useful for ROM hacking
- Low complexity
- Documentation effort
- Nice-to-have

**6. Advanced Savestate Features**
- Slot management UI
- Category organization
- Keyboard shortcuts
- Training timers

**7. SNI Protocol Support**
- More modern protocol
- Better error handling
- Broader device support
- High complexity

---

## 📚 Reference Implementations

### For GetFile:
- `legacy/usb2snes-cli/src/main.rs` (lines 246-264) - Rust
- `legacy/goofgenie/src/usb2snes.rs` (lines 246-264) - Rust

### For Savestates:
- `legacy/Savestate2snes/handlestuffusb2snes.cpp` - C++ Qt
- `legacy/Savestate2snes/Patches/savestatev7.ips` - ROM patch
- Memory addresses and protocol documented in C++ code

### For Batch Operations:
- `legacy/goofgenie/src/usb2snes.rs` (lines 295-327) - get_addresses
- `legacy/usb2snes-cli/src/main.rs` (lines 295-327) - same

### For ROM Operations:
- Our existing ROM tools (FLIPS integration)
- Could integrate with JavaScript BPS/IPS libraries

---

## 🔍 C#/C Features We're Missing

### From Savestate2snes (C++ Qt):
1. ❌ Savestate save/load (320KB data transfer)
2. ❌ Safe state detection (polling interface)
3. ❌ Controller button shortcuts
4. ❌ Training timer integration
5. ❌ Category/slot management UI
6. ✅ Basic USB2SNES operations (we have these)

### From SMAutoTracker (C# WPF):
1. ❌ Continuous memory watching with change detection
2. ❌ Item tracking display
3. ❌ Efficient polling (likely uses batch reads)
4. ✅ Basic memory reads (we have GetAddress)

### From Rust Implementations:
1. ❌ GetFile (download files)
2. ❌ GetAddresses (batch read)
3. ✅ All other operations (we have these)

---

## 💡 Novel Features We Could Add

### 1. **Automated Challenge System**

Using our RHTools challenge runs + USB2SNES:

```javascript
// Detect level completion
const exitCount = await snes.GetAddress(0xF51F2E, 1);
if (exitCount[0] > previousExits) {
  // Level completed!
  await recordChallengeResult(currentChallenge, 'completed');
  await selectNextChallenge();
}
```

### 2. **Live Leaderboard Integration**

```javascript
// Detect level completion time
const time = await snes.GetTime();

// Submit to leaderboard
await submitTime(levelId, time);

// Display rank
showRank(await getLeaderboardRank(levelId, time));
```

### 3. **Twitch Integration Enhancement**

```javascript
// Chat command: !cape
await snes.GrantCape();
await sendTwitchMessage('Cape powerup granted to streamer!');

// Chat command: !timer 5
await snes.SetTime(5);
await sendTwitchMessage('Timer set to 5 seconds!');
```

### 4. **Practice Mode with Auto-Save**

```javascript
// Auto-save every 60 seconds during practice
setInterval(async () => {
  if (await snes.InLevel()) {
    const savestate = await snes.SaveStateToMemory();
    await saveToFile(savestate, 'auto-checkpoint.sav');
  }
}, 60000);
```

### 5. **ROM Randomizer Integration**

```javascript
// Generate randomized data
const randomizedLevel = randomizeLevel(baseLevelData);

// Patch into memory
await snes.PutAddress([[LEVEL_ADDRESS, randomizedLevel]]);

// No file modification needed!
```

---

## 🛠️ Implementation Plan

### Step 1: Core Missing Features (Week 1)

**GetFile + GetFileBlocking:**
- Port from Rust implementation
- Add progress callbacks
- Add timeout protection
- Add verification
- Add to BaseUsb2snes, SNESWrapper, usb2snesTypeA, py2snes
- Add IPC handlers
- Test with ROM downloads

**GetAddresses (Batch Read):**
- Port from Rust implementation
- Add to all layers
- Add IPC handler
- Test with game state reading
- Document performance improvements

---

### Step 2: Savestate System (Week 2-3)

**Phase 1: Core Protocol**
- Detect firmware version
- Implement SaveStateToMemory()
- Implement LoadStateFromMemory()
- Add safe state detection
- Test with patched ROM

**Phase 2: File Management**
- Save to file system
- Load from file system
- Slot management
- Naming/organization

**Phase 3: UI Integration**
- Savestate list view
- Load/Save buttons
- Slot selection
- Progress indication

---

### Step 3: Optimization & Polish (Week 4)

**Memory Watching:**
- Build on GetAddresses
- Add change detection
- Add callback system
- Test with trackers

**Bulk Memory Operations:**
- GetMemoryBulk, PutMemoryBulk
- Automatic chunking
- Progress tracking

**ROM Helpers:**
- GetROMHeader
- AnalyzeROM
- Documentation

---

## 📖 Protocol Extensions to Research

### SNI Protocol (from legacy/sni/)

**Benefits:**
- gRPC-based (more modern)
- Better error handling
- Supports more devices (consoles + emulators)
- Streaming support
- Progress notifications built-in

**Consideration:**
- More complex to implement
- Requires gRPC libraries
- Broader scope than USB2SNES
- Could be library option #5?

**Recommendation:**
⏸️ Future consideration:
- After completing USB2SNES features
- As "sni-grpc" library option
- For broader device support

---

## 🎓 Conclusions

### What's Missing (Actionable):

1. **GetFile/GetFileBlocking** - Critical, implement next
2. **GetAddresses** - High value, implement next
3. **Savestate Management** - Very valuable, implement soon
4. **Memory Watching** - Useful, implement after batch reads

### What's Limited by Hardware:

1. **Live ROM Patching** - SD2SNES ROM is read-only
   - Only works on emulators
   - Can patch WRAM instead
   - Or upload pre-patched ROM

2. **Batch PutAddress** - Protocol doesn't support properly
   - Current approach is correct
   - Wait for protocol improvement

### What We Already Have:

1. ✅ All basic operations
2. ✅ Reliable file uploads
3. ✅ SD2SNES support
4. ✅ Memory read/write
5. ✅ SMW-specific features

---

## 📝 Summary

**Current State:** Production-ready for basic operations

**Next Steps:**
1. Implement GetFile (download files)
2. Implement GetAddresses (batch read)
3. Implement savestate management
4. Add memory watching system

**Long-term:**
- ROM analysis tools
- SNI protocol support
- Advanced game-specific features
- Twitch/tracker integration

**The foundation is solid - now we can build amazing features on top!** 🚀

---

**Last Updated:** October 13, 2025  
**Next Phase:** GetFile + GetAddresses implementation

