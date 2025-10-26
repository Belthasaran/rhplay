# USB2SNES PutFile Issues - Executive Summary

**Date:** October 13, 2025  
**Issue:** SNES hangs during file upload

---

## 🎯 Root Cause Identified

### PRIMARY CAUSE: **Missing Directory** ⚠️

**Your observation was correct!**

When uploading to `/work/file.sfc` without `/work` existing:
1. Server tries to open file for writing
2. Operation fails (directory doesn't exist)
3. Server **doesn't send error response** (protocol limitation!)
4. Client continues sending binary data anyway
5. Server ignores data (not in receiving state)
6. Device enters error state and **HANGS**

**Solution:** Always check/create directory before PutFile

---

## 🔍 Key Findings from Analysis

### 1. Chunk Size Difference ⚠️

| Implementation | Chunk Size |
|----------------|------------|
| **Our usb2snesTypeA** | 4096 bytes ❌ |
| **Python py2snes** | 4096 bytes ❌ |
| **Rust implementations** | 1024 bytes ✅ |
| **usb2snes-uploader.py** | 1024 bytes ✅ |

**Conclusion:** Our chunks are **4x larger** than working implementations!

---

### 2. No Backpressure Handling ⚠️

**All implementations (including ours):**
```javascript
this.socket.send(chunk);  // Fire and forget! ⚠️
```

**Problem:** WebSocket has internal buffer. We never check it!

**Impact:**
- Buffer overflow
- Message queuing
- Device timeout
- Hang

---

### 3. Protocol Has No Acknowledgment ⚠️

**Critical Discovery:**

USB2SNES PutFile protocol provides:
- ❌ NO progress acknowledgments
- ❌ NO "ready for next chunk" signals
- ❌ NO completion confirmation
- ❌ NO error responses during transfer

**This is a fundamental protocol limitation!**

We must rely on indirect verification (List, delays).

---

### 4. Verification Methods Vary

| Implementation | Verification |
|----------------|--------------|
| **py2snes** | List('/') after 20s delay ❌ |
| **usb2snesTypeA** | List('/') (same) ❌ |
| **Rust** | None ❌ |
| **usb2snes-uploader.py** | Byte count + file exists ✅ |

**Best practice:** usb2snes-uploader.py tracks bytes and verifies file exists

---

## 🛠️ Recommended Fixes (Priority Order)

### Fix #1: Create Directory First ⭐⭐⭐ CRITICAL

```javascript
// Before PutFile, ensure directory exists
const dirPath = dstFile.substring(0, dstFile.lastIndexOf('/'));
try {
  await this.List(dirPath);
} catch (error) {
  await this.MakeDir(dirPath);
}
await this.PutFile(srcFile, dstFile);
```

**Impact:** Prevents hang when directory missing

---

### Fix #2: Reduce Chunk Size ⭐⭐⭐ HIGH

```javascript
// Change from 4096 to 1024
const buffer = Buffer.alloc(1024);
```

**Impact:** Better flow control, less buffer stress

---

### Fix #3: Add Backpressure ⭐⭐ HIGH

```javascript
// Check WebSocket buffer before sending
while (this.socket.bufferedAmount > 16384) {
  await this._sleep(50);
}
this.socket.send(chunk);
```

**Impact:** Prevents buffer overflow

---

### Fix #4: Better Verification ⭐ MEDIUM

```javascript
// After upload, check file exists
const files = await this.List(dirPath);
if (!files.some(f => f.filename === fileName)) {
  throw new Error('Upload failed - file not found');
}
```

**Impact:** Detects silent failures

---

## 📊 Implementation Comparison

**Best Reference Implementation:** `legacy/usb2snes-uploader.py`

Why it's better:
- ✅ 1024-byte chunks
- ✅ Path validation
- ✅ Byte count verification
- ✅ Clean error handling
- ✅ No arbitrary delays

**We should model our fixes after this!**

---

## 🎯 Quick Action Items

### Immediate (to fix hang):
1. Add directory check/create to upload IPC handler
2. Add to UI: "Create Required Upload Directory" button (already done!)
3. Test with directory creation first

### Short-term (to improve reliability):
4. Change chunk size from 4096 to 1024
5. Add `bufferedAmount` checking
6. Improve verification method
7. Remove arbitrary 20s delay

### Long-term:
8. Consider SNI protocol (more robust)
9. Add progress tracking
10. Implement retry logic

---

## 💡 Key Insights

1. **Your observation was spot-on** - missing directory causes the hang
2. **Protocol has no error feedback** - this is by design (limitation)
3. **Our chunk size is too large** - 1024 bytes is more reliable
4. **No backpressure handling** - we need to check socket buffer
5. **py2snes has same issues** - we faithfully ported the bugs!

---

## ✅ Already Fixed

- ✅ "Create Required Upload Directory" button added
- ✅ Shows which directory will be created
- ✅ Handles "already exists" gracefully

**Recommendation:** Always click this button before uploading files!

---

## 📚 Full Analysis

See: `devdocs/STUDY_USB2SNES_PUTFILE.md` for complete analysis

---

**Conclusion:** The hang is likely due to missing directory + our implementation flooding the WebSocket buffer with large chunks. Fix by creating directory first and reducing chunk size!

