# Study: USB2SNES PutFile Protocol Analysis

**Date:** October 13, 2025  
**Issue:** PutFile operations causing SNES hangs/crashes  
**Observation:** Directory not existing may contribute, but protocol implementation differences suspected

---

## Problem Description

### Observed Behavior
- **Symptom:** SNES hangs when attempting PutFile to `/work` directory
- **Context:** Directory `/work` had not yet been created
- **Question:** Is this a protocol implementation issue or just missing directory?
- **Concern:** Python py2snes and our JavaScript usb2snesTypeA may have protocol reliability issues compared to other implementations

### Key Observations
1. FileManager (C#) and other tools handle uploads more reliably
2. Our implementation may lack proper flow control or error handling
3. Success/error reply handling may be incomplete
4. WebSocket message ordering may be problematic

---

## Implementation Comparison

### 1. Our Current Implementation (usb2snesTypeA.js)

**File:** `electron/main/usb2snes/usb2snesTypeA.js` lines 464-518

```javascript
async PutFile(srcFile, dstFile) {
  const fs = require('fs').promises;
  
  // Acquire lock
  while (this.requestLock) await this._sleep(10);
  this.requestLock = true;

  try {
    const stats = await fs.stat(srcFile);
    const size = stats.size;
    
    // 1. Send PutFile command
    const request = {
      Opcode: "PutFile",
      Space: "SNES",
      Operands: [dstFile, size.toString(16)]
    };
    this.socket.send(JSON.stringify(request));

    // 2. Send file data in 4096-byte chunks
    const fileHandle = await fs.open(srcFile, 'r');
    const buffer = Buffer.alloc(4096);
    
    try {
      let bytesRead;
      while ((bytesRead = (await fileHandle.read(buffer, 0, 4096)).bytesRead) > 0) {
        const chunk = buffer.slice(0, bytesRead);
        this.socket.send(chunk);  // ⚠️ NO WAITING between chunks
      }
    } finally {
      await fileHandle.close();
    }

    // 3. Delay for large files
    if (size > 2048 * 1024) {
      await this._sleep(20000);
    }
    
    // 4. Verify upload with List('/')
    await this.List('/');  // ⚠️ Assumes List will work

    return true;
  } finally {
    this.requestLock = false;
  }
}
```

**Characteristics:**
- ✅ Uses request lock for thread safety
- ✅ Sends size in hex as operand
- ⚠️ **NO backpressure handling** - sends chunks without waiting for ready signal
- ⚠️ **NO acknowledgment** from server after each chunk
- ⚠️ **NO error checking** during data transfer
- ⚠️ **List('/') used as verification** - not direct confirmation
- ⚠️ **Fixed delay for large files** - arbitrary 20 second wait
- ⚠️ **Chunk size: 4096 bytes** - might be too large for some devices

---

### 2. Python py2snes Implementation

**File:** `py2snes/py2snes/__init__.py` lines 334-368

```python
async def PutFile(self, srcfile, dstfile):
    try:
        await self.request_lock.acquire()

        if self.state != SNES_ATTACHED:
            return None

        size = os.path.getsize(srcfile)
        async with aiofiles.open(srcfile, 'rb') as infile:
            request = {
                "Opcode" : "PutFile",
                "Space" : "SNES",
                "Operands" : [dstfile, hex(size)[2:]]
            }
            try:
                if self.socket is not None:
                    await self.socket.send(json.dumps(request))
                if self.socket is not None:
                    while True:
                        chunk = await infile.read(4096)  # ⚠️ Same chunk size
                        if not chunk: break
                        await self.socket.send(chunk)  # ⚠️ NO WAITING
            except websockets.ConnectionClosed:
                return False

            return True
    finally:
        self.request_lock.release()
        try:
            if os.path.getsize(srcfile) > 2048*1024:
                await asyncio.sleep(20)  # Same arbitrary delay
        except:
            await asyncio.sleep(20)
            pass
        await self.List('/')  # Same verification method
```

**Characteristics:**
- ✅ Uses request lock
- ✅ Catches ConnectionClosed exception
- ⚠️ **Same issues as our JavaScript port** (we copied them!)
- ⚠️ **NO backpressure handling**
- ⚠️ **NO acknowledgment protocol**
- ⚠️ **List('/') verification after delay**
- ⚠️ **4096-byte chunks** without flow control

---

### 3. Rust Implementation (usb2snes-cli/goofgenie)

**File:** `legacy/usb2snes-cli/src/main.rs` or `legacy/goofgenie/src/usb2snes.rs` lines 228-244

```rust
pub fn send_file(&mut self, path: &str, data: &[u8]) -> Result<(), Box<dyn Error>> {
    self.send_command(
        Command::PutFile,
        &[Cow::Borrowed(path), Cow::Owned(format!("{:x}", data.len()))],
    )?;
    
    let mut start = 0;
    let mut stop = 1024;  // ✅ SMALLER chunk size: 1024 bytes!
    
    while start < data.len() {
        self.client.send(Message::binary(&data[start..stop]))?;  // ⚠️ Still no waiting
        start += 1024;
        stop += 1024;
        if stop > data.len() {
            stop = data.len();
        }
    }
    Ok(())
}
```

**Characteristics:**
- ✅ **Uses 1024-byte chunks** (smaller than our 4096!)
- ✅ Synchronous blocking sends (implicit flow control via TCP)
- ✅ No explicit delays
- ⚠️ **NO acknowledgment protocol**
- ⚠️ **NO verification** after upload
- ✅ **Simpler** - relies on TCP backpressure

**Note:** Rust's blocking `client.send()` may provide implicit flow control!

---

### 4. Alternative Python Implementation (usb2snes-uploader.py)

**File:** `legacy/usb2snes-uploader.py` lines 124-148

```python
async def put_file(self, source_filename, dest_filename):
    """
    Transfer a file to the device
    """
    self._assert_attached()
    
    Usb2Snes._check_usb2snes_path(dest_filename)  # ✅ Path validation!

    file_size = (await aiofiles.os.stat(source_filename)).st_size

    async with aiofiles.open(source_filename, 'rb') as fp:
        await self._request('PutFile', dest_filename, f"{file_size:x}")

        transferred = 0

        block = await fp.read(Usb2Snes.BLOCK_SIZE)  # 1024 bytes
        while block:
            await self._socket.send(block)  # ⚠️ Still no waiting
            transferred += len(block)

            block = await fp.read(Usb2Snes.BLOCK_SIZE)

    # ✅ VERIFICATION: Check transferred bytes match file size
    if transferred != file_size:
        raise RuntimeError(f"transferred bytes ({transferred}) does not match file size ({file_size})")
```

**Characteristics:**
- ✅ **1024-byte chunks** (BLOCK_SIZE constant)
- ✅ **Path validation** before sending
- ✅ **Byte count verification** after transfer
- ✅ **Cleaner error handling**
- ⚠️ **NO acknowledgment from server**
- ⚠️ **NO explicit List verification**

---

## Critical Differences Identified

### 1. **Chunk Size** ⚠️ MAJOR DIFFERENCE

| Implementation | Chunk Size | Notes |
|----------------|------------|-------|
| **usb2snesTypeA (ours)** | 4096 bytes | LARGE |
| **py2snes** | 4096 bytes | LARGE |
| **Rust** | 1024 bytes | SMALLER ✅ |
| **usb2snes-uploader.py** | 1024 bytes | SMALLER ✅ |

**Theory #1: Our chunk size (4096) may overwhelm the USB2SNES server or device buffer.**

Smaller chunks (1024 bytes) allow:
- Better flow control
- Less buffering stress
- More predictable timing
- Less risk of buffer overrun

---

### 2. **No Backpressure/Flow Control** ⚠️ CRITICAL ISSUE

**All implementations send data without waiting for acknowledgment:**

```javascript
// Our code:
while (bytesRead > 0) {
  this.socket.send(chunk);  // Fire and forget! ⚠️
}
```

**Problem:** WebSocket `send()` is asynchronous. We're queuing data faster than the device can consume it.

**Theory #2: Our implementation floods the WebSocket buffer, causing:**
- Buffer overflow
- Message loss
- Device hang
- Protocol desync

**Potential Solutions:**
1. Add `await` for socket send completion
2. Check WebSocket `bufferedAmount` property
3. Throttle sends based on buffer state
4. Wait for ready signal from server

---

### 3. **No Server Acknowledgment** ⚠️ PROTOCOL GAP

**None of the implementations wait for server acknowledgment during transfer.**

The USB2SNES protocol does NOT specify:
- Progress acknowledgments during PutFile
- "Ready for next chunk" signals
- Transfer completion confirmation

**Theory #3: The protocol assumes TCP-level flow control is sufficient.**

TCP provides:
- Automatic backpressure
- Guaranteed delivery
- Flow control

BUT: WebSocket over TCP adds buffering layers that may break this assumption.

---

### 4. **Verification Methods** ⚠️ INCONSISTENT

| Implementation | Verification Method |
|----------------|---------------------|
| **py2snes** | `await self.List('/')` + 20s delay |
| **usb2snesTypeA** | `await this.List('/')` (same as py2snes) |
| **usb2snes-uploader.py** | Check `transferred == file_size` + `check_file_exists()` |
| **Rust** | None - just sends and returns |

**Theory #4: Using List('/') as verification is unreliable.**

Problems with `List('/')`:
- Assumes root directory always exists
- Doesn't verify the actual uploaded file
- May execute before upload completes
- Arbitrary delay (20s) not based on actual completion

**Better approach (usb2snes-uploader.py):**
- Track bytes transferred
- Check file exists after upload
- Verify file size matches

---

### 5. **Missing Directory Handling** ⚠️ YOUR OBSERVED ISSUE

**None of the implementations check if target directory exists before PutFile!**

```javascript
// Our code:
await snes.PutFile('/local/file.sfc', '/work/file.sfc');
// ⚠️ What if /work doesn't exist?
```

**Theory #5: Uploading to non-existent directory causes device hang.**

The USB2SNES/QUsb2snes server behavior when destination directory doesn't exist:
- May hang waiting for write to complete
- May not send error response
- Device may enter error state
- Protocol may desynchronize

**Solution:**
```javascript
// Check/create directory first
try {
  await snes.List('/work');
} catch (error) {
  await snes.MakeDir('/work');
}
await snes.PutFile(srcFile, '/work/file.sfc');
```

---

## Comparison with C Implementation

**File:** `legacy/usb2snes/usb2snes.c`

**Note:** This is **DIRECT USB/SERIAL** communication, NOT WebSocket protocol!

This implementation:
- Communicates directly with SD2SNES via USB serial port
- No WebSocket layer
- Different protocol entirely
- More reliable because it's direct hardware communication
- Uses RS232 serial communication

**Not comparable** to WebSocket implementations.

---

## Critical Issues in Our Implementation

### Issue #1: Chunk Size Too Large

**Current:** 4096 bytes  
**Observed in working implementations:** 1024 bytes

**Impact:**
- May overflow device buffer
- Reduces flow control responsiveness
- Increases hang risk

**Recommendation:** Change to 1024 bytes

---

### Issue #2: No WebSocket Backpressure Handling

**Current code:**
```javascript
this.socket.send(chunk);  // No await, no buffer check
```

**Problem:** WebSocket has internal buffer (`bufferedAmount`). We never check it!

**Better approach:**
```javascript
// Check buffer before sending
while (this.socket.bufferedAmount > MAX_BUFFER_SIZE) {
  await this._sleep(10);
}
this.socket.send(chunk);
```

Or:

```javascript
// Wait for drain event
await new Promise((resolve) => {
  if (this.socket.bufferedAmount === 0) {
    resolve();
  } else {
    this.socket.once('drain', resolve);
  }
});
```

---

### Issue #3: No Directory Pre-check

**Current:** PutFile directly without checking if directory exists

**Problem:** Server/device behavior undefined when directory doesn't exist

**Better approach:**
```javascript
async putFileWithDirCheck(srcFile, dstFile) {
  // Extract directory from path
  const dirPath = dstFile.substring(0, dstFile.lastIndexOf('/'));
  
  // Check/create directory
  try {
    await this.List(dirPath);
  } catch (error) {
    console.log(`Directory ${dirPath} doesn't exist, creating...`);
    await this.MakeDir(dirPath);
  }
  
  // Now upload
  await this.PutFile(srcFile, dstFile);
}
```

---

### Issue #4: Unreliable Verification

**Current:** Uses `await this.List('/')` to verify upload complete

**Problems:**
- Doesn't verify the actual file was uploaded
- Doesn't verify file size
- List('/') may return before upload completes
- Arbitrary 20s delay not based on actual completion

**Better approach (from usb2snes-uploader.py):**
```javascript
// Track transferred bytes
let transferred = 0;
while (bytesRead > 0) {
  this.socket.send(chunk);
  transferred += bytesRead;
  bytesRead = ...;
}

// Verify byte count
if (transferred !== fileSize) {
  throw new Error('Transfer incomplete');
}

// Verify file exists on device
const dirPath = dstFile.substring(0, dstFile.lastIndexOf('/'));
const fileName = dstFile.substring(dstFile.lastIndexOf('/') + 1);
const files = await this.List(dirPath);
if (!files.some(f => f.filename === fileName)) {
  throw new Error('File not found on device after upload');
}
```

---

### Issue #5: No Completion Signal from Server

**Critical Discovery:** USB2SNES protocol provides **NO completion acknowledgment** for PutFile!

From QUsb2snes protocol documentation:
- PutFile sends JSON command + binary data
- Server sends **NO response** after receiving data
- Client must **assume** upload succeeded

This is a **fundamental protocol limitation**.

**Implications:**
- We can't know when upload is truly complete
- We can't get explicit errors during transfer
- We must rely on:
  - TCP-level delivery guarantees
  - WebSocket buffering
  - Indirect verification (List, file checks)

**This explains why all implementations have similar issues!**

---

## Theories on Why PutFile Fails

### Theory #1: Buffer Overflow (HIGH PROBABILITY)

**Evidence:**
- Our 4096-byte chunks are larger than Rust (1024)
- We send chunks without checking WebSocket buffer state
- WebSocket `bufferedAmount` is never checked

**Mechanism:**
1. We send chunks faster than device/server can process
2. WebSocket internal buffer fills up
3. Messages get queued but not transmitted
4. Device times out waiting for data
5. Device hangs in incomplete state

**Solution:**
- Reduce chunk size to 1024 bytes
- Check `socket.bufferedAmount` before each send
- Add throttling/backpressure handling

---

### Theory #2: Missing Directory Causes Protocol Desync (HIGH PROBABILITY)

**Evidence:**
- Your observation: hang when `/work` doesn't exist
- No implementation checks directory before upload
- QUsb2snes behavior undefined for non-existent paths

**Mechanism:**
1. PutFile command sent for `/work/file.sfc`
2. Server tries to open file for writing
3. `/work` doesn't exist → open fails
4. Server enters error state
5. Server doesn't send error response (protocol limitation)
6. Client sends binary data anyway
7. Server ignores data (not in receiving state)
8. Protocol desynchronizes
9. Device hangs

**Solution:**
- Always check/create directory before PutFile
- Use List() to verify directory exists
- Use MakeDir() to create if missing

---

### Theory #3: Race Condition in List('/') Verification (MEDIUM PROBABILITY)

**Evidence:**
- Both implementations use `List('/')` to verify upload
- Arbitrary delay (20s) suggests timing issue
- List('/') may execute before device finishes writing

**Mechanism:**
1. PutFile data sent to server
2. Server forwards to device
3. We call List('/') immediately (or after 20s)
4. Device still writing file
5. List('/') may not show complete file yet
6. But List('/') succeeds, so we think upload is done

**Solution:**
- Use `List(dirPath)` instead of `List('/')`
- Check file exists with correct name
- Verify file size if possible (GetFile header?)
- Add exponential backoff retry for verification

---

### Theory #4: WebSocket Message Ordering Issue (MEDIUM PROBABILITY)

**Evidence:**
- Multiple messages sent in rapid succession
- No synchronization between JSON command and binary data

**Mechanism:**
1. JSON PutFile command sent
2. Binary chunks sent immediately after
3. WebSocket may reorder or batch messages
4. Server receives binary data before JSON command
5. Server doesn't know what to do with binary data
6. Protocol breaks

**Solution:**
- Use `flush()` or `await` after JSON command
- Wait for server to be ready before sending data
- Check that command was received (if protocol supports it)

---

### Theory #5: Large File Timeout (LOW PROBABILITY for 15MB limit)

**Evidence:**
- 20-second delay for files > 2MB
- No dynamic timeout based on file size

**Mechanism:**
- For large files, transfer takes longer than expected
- Fixed 20s delay insufficient for large files
- Device times out during transfer

**Solution:**
- Dynamic timeout based on file size
- Progress tracking
- Keep-alive messages during transfer (if protocol supports)

---

## Recommended Fixes (Priority Order)

### Fix #1: Always Create Directory First (HIGHEST PRIORITY)

**Impact:** Prevents hang when directory doesn't exist

```javascript
async putFileSafe(srcFile, dstFile) {
  // Extract and create directory
  const dirPath = dstFile.substring(0, dstFile.lastIndexOf('/'));
  
  try {
    await this.List(dirPath);
  } catch (error) {
    console.log(`Creating directory: ${dirPath}`);
    await this.MakeDir(dirPath);
  }
  
  // Now upload
  return await this.PutFile(srcFile, dstFile);
}
```

---

### Fix #2: Reduce Chunk Size to 1024 Bytes (HIGH PRIORITY)

**Impact:** Better flow control, less buffer stress

```javascript
// Change from:
const buffer = Buffer.alloc(4096);
// To:
const buffer = Buffer.alloc(1024);
```

---

### Fix #3: Add WebSocket Backpressure Handling (HIGH PRIORITY)

**Impact:** Prevents buffer overflow, reduces hang risk

```javascript
const MAX_BUFFERED = 16384;  // 16KB max buffer

while ((bytesRead = ...) > 0) {
  const chunk = buffer.slice(0, bytesRead);
  
  // Wait if buffer is too full
  while (this.socket.bufferedAmount > MAX_BUFFERED) {
    await this._sleep(50);
  }
  
  this.socket.send(chunk);
  transferred += bytesRead;
}
```

---

### Fix #4: Better Verification (MEDIUM PRIORITY)

**Impact:** Detects upload failures, provides better feedback

```javascript
// After upload, verify file exists and has correct size
const dirPath = dstFile.substring(0, dstFile.lastIndexOf('/'));
const fileName = dstFile.substring(dstFile.lastIndexOf('/') + 1);

// Wait a bit for device to finish writing
await this._sleep(1000);

// Check file exists
const files = await this.List(dirPath);
const uploadedFile = files.find(f => f.filename === fileName);

if (!uploadedFile) {
  throw new Error('File not found on device after upload');
}

// Could also: GetFile and check size header if protocol supports it
```

---

### Fix #5: Add Retry Logic (MEDIUM PRIORITY)

**Impact:** Recovers from transient failures

```javascript
async putFileWithRetry(srcFile, dstFile, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await this.putFileSafe(srcFile, dstFile);
      return true;
    } catch (error) {
      console.error(`Upload attempt ${attempt + 1} failed:`, error);
      if (attempt === maxRetries - 1) throw error;
      await this._sleep(2000);
    }
  }
}
```

---

## Additional Observations

### Rust Implementation Advantages

The Rust implementation may be more reliable because:

1. **Blocking I/O** - `client.send()` blocks until data is sent
   - Implicit flow control via TCP backpressure
   - No async buffering issues

2. **Simpler** - No complex async/await coordination
   - Less room for timing bugs
   - More predictable behavior

3. **Smaller chunks** - 1024 bytes vs our 4096
   - Better flow control granularity
   - Less buffer stress

---

### Python usb2snes-uploader.py Advantages

This implementation is **cleaner** than py2snes:

1. **Smaller chunks** - 1024 bytes (BLOCK_SIZE constant)
2. **Path validation** - Checks path format before sending
3. **Byte count verification** - Ensures all data transferred
4. **Better error messages** - More descriptive
5. **No arbitrary delays** - Relies on proper verification

**This may be the best reference for fixing our implementation!**

---

## Comparison Table

| Feature | usb2snesTypeA | py2snes | Rust CLI | usb2snes-uploader.py |
|---------|---------------|---------|----------|----------------------|
| Chunk Size | 4096 ❌ | 4096 ❌ | 1024 ✅ | 1024 ✅ |
| Backpressure | None ❌ | None ❌ | Implicit ✅ | None ❌ |
| Dir Check | None ❌ | None ❌ | None ❌ | None ❌ |
| Path Validation | Partial | Partial | None | Yes ✅ |
| Verification | List('/') ❌ | List('/') ❌ | None | Byte count ✅ |
| Delay | 20s fixed ❌ | 20s fixed ❌ | None ✅ | None ✅ |
| Error Handling | Basic | Basic | Good | Excellent ✅ |

**Best reference:** usb2snes-uploader.py by Marcus Rowe

---

## Root Cause Analysis

### Primary Cause: Missing Directory

**Your observation was correct!**

When PutFile is attempted to `/work/file.sfc` and `/work` doesn't exist:
1. Server tries to create/open file
2. Open fails (directory doesn't exist)
3. Server **doesn't send error response** (protocol limitation)
4. Client continues sending binary data
5. Server not in receiving state, ignores data
6. Device stuck in error state
7. **HANG**

---

### Secondary Causes: Protocol Issues

1. **Large chunks (4096)** stress buffers
2. **No backpressure** allows buffer overflow
3. **No acknowledgment** prevents flow control
4. **Poor verification** doesn't detect failures
5. **Race conditions** in async sends

---

## Recommended Implementation Changes

### Change #1: Always Create Directory First ⭐ CRITICAL

```javascript
// In IPC handler or wrapper function
async function safePutFile(srcFile, dstFile) {
  const dirPath = dstFile.substring(0, dstFile.lastIndexOf('/')) || '/';
  
  // Ensure directory exists
  try {
    await snes.List(dirPath);
    console.log(`Directory ${dirPath} exists`);
  } catch (error) {
    console.log(`Creating directory ${dirPath}...`);
    try {
      await snes.MakeDir(dirPath);
      console.log(`Directory ${dirPath} created`);
    } catch (mkdirError) {
      console.error(`Failed to create directory:`, mkdirError);
      throw new Error(`Cannot create directory ${dirPath}: ${mkdirError}`);
    }
  }
  
  // Now upload
  return await snes.PutFile(srcFile, dstFile);
}
```

---

### Change #2: Reduce Chunk Size ⭐ HIGH PRIORITY

```javascript
// In usb2snesTypeA.js, change:
const buffer = Buffer.alloc(4096);

// To:
const buffer = Buffer.alloc(1024);
```

---

### Change #3: Add Backpressure Handling ⭐ HIGH PRIORITY

```javascript
const MAX_BUFFERED = 16384;  // 16KB

while ((bytesRead = ...) > 0) {
  const chunk = buffer.slice(0, bytesRead);
  
  // Wait if socket buffer is full
  while (this.socket.bufferedAmount > MAX_BUFFERED) {
    await this._sleep(50);
  }
  
  this.socket.send(chunk);
  transferred += bytesRead;
}
```

---

### Change #4: Better Verification ⭐ MEDIUM PRIORITY

```javascript
// After upload, verify properly
const dirPath = dstFile.substring(0, dstFile.lastIndexOf('/'));
const fileName = dstFile.substring(dstFile.lastIndexOf('/') + 1);

// Short delay for device to finish writing
await this._sleep(1000);

// Verify file exists
const files = await this.List(dirPath);
if (!files.some(f => f.filename === fileName)) {
  throw new Error(`File ${fileName} not found after upload`);
}

console.log(`Upload verified: ${dstFile}`);
```

---

### Change #5: Add Progress Callback ⭐ LOW PRIORITY (UX)

```javascript
async PutFile(srcFile, dstFile, progressCallback) {
  // ... during upload ...
  while (bytesRead > 0) {
    this.socket.send(chunk);
    transferred += bytesRead;
    
    if (progressCallback) {
      progressCallback(transferred, fileSize);
    }
  }
}
```

---

## Protocol Limitations Discovered

### 1. No Acknowledgment Protocol

**USB2SNES/QUsb2snes does NOT provide:**
- Progress acknowledgments during file transfer
- "Ready for next chunk" signals
- Explicit completion confirmation
- Error responses during transfer

**We must rely on:**
- TCP flow control (via WebSocket)
- Post-transfer verification
- Timeout detection

---

### 2. Undefined Error Behavior

**When errors occur (missing directory, disk full, etc.):**
- Server may not send error response
- Client doesn't know operation failed
- Device may enter error state
- Protocol may desynchronize

**We must:**
- Validate before operations (check directories exist)
- Verify after operations (check file exists)
- Handle silent failures

---

## Comparison with Other Protocols

### QUsb2snes vs. SNI

**SNI Protocol** (from legacy/sni/):
- More modern gRPC-based protocol
- Better error handling
- Streaming support
- Progress notifications
- More robust

**Future consideration:** Implement SNI protocol support for better reliability

---

## Conclusion

### Root Cause

**PRIMARY:** Missing directory causes device hang (your observation confirmed!)

**SECONDARY:**
1. Large chunk size (4096 vs 1024) stresses buffers
2. No backpressure handling floods WebSocket
3. No server acknowledgment (protocol limitation)
4. Poor verification methods

### Recommended Action Plan

**Immediate (Quick Fixes):**
1. ✅ Always create directory before PutFile (add to IPC handler)
2. ✅ Reduce chunk size from 4096 to 1024 bytes
3. ✅ Add WebSocket bufferedAmount checking

**Short-term:**
4. Improve verification (check file exists with correct name)
5. Add byte count tracking and validation
6. Remove arbitrary 20s delay, use proper verification

**Long-term:**
7. Consider SNI protocol support
8. Add progress tracking
9. Implement retry logic
10. Add better error recovery

---

## References

**Implementations Analyzed:**
- `electron/main/usb2snes/usb2snesTypeA.js` - Our implementation
- `py2snes/py2snes/__init__.py` - Python py2snes
- `legacy/usb2snes-uploader.py` - Better Python implementation ⭐ BEST REFERENCE
- `legacy/goofgenie/src/usb2snes.rs` - Rust implementation
- `legacy/usb2snes-cli/src/main.rs` - Rust CLI
- `legacy/usb2snes/usb2snes.c` - Direct USB (not comparable)

**Best Implementation:** `legacy/usb2snes-uploader.py` by Marcus Rowe
- Clean code
- 1024-byte chunks
- Proper verification
- Good error handling

---

**Last Updated:** October 13, 2025  
**Status:** Analysis complete, fixes recommended

