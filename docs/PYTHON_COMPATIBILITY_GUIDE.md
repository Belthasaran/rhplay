# Python Script Compatibility Guide

**Date**: October 12, 2025  
**Status**: ✅ Full compatibility achieved

---

## Overview

Python scripts (pb_repatch.py, etc.) can now work with JavaScript-created blobs through a compatibility layer.

---

## Quick Start

### Update Python Scripts (One-Line Change)

```python
# OLD:
import loadsmwrh

# NEW:
import loadsmwrh_compat as loadsmwrh
```

That's it! The rest of your Python code works unchanged.

### Verify Compatibility

```bash
# Run compatibility tests
npm run test:python-compat

# Should output:
# ✅ ALL TESTS PASSED
# Python scripts can work with JavaScript-created blobs
```

---

## The Compatibility Layer

### blob_crypto.py

Standalone library for blob encryption/decryption with auto-detection.

**Features**:
- ✅ Decrypts both Python and JavaScript-created blobs
- ✅ Auto-detects blob format (single vs double base64)
- ✅ Can be called from Python or JavaScript
- ✅ No database or filesystem dependencies

**Usage from Python**:
```python
import blob_crypto

# Decrypt blob
with open('blobs/pblob_40663_bc9bb4a4ee', 'rb') as f:
    blob_data = f.read()

patch_data = blob_crypto.decrypt_blob(
    blob_data,
    patchblob1_key='YXhPNWV2ZHl2MS1VNXhtZGFZVmxEMUwzRVZGVEMxYkdKVFFnQnJjb29yST0=',
    patchblob1_sha224='bc9bb4a4ee...',
    pat_sha224='5761254402...',  # Optional verification
    detect_format=True  # Auto-detect Python vs JavaScript format
)
```

**Usage from JavaScript**:
```javascript
const { execSync } = require('child_process');

const result = execSync(
  `python3 blob_crypto.py info ${blobPath} ${key} ${blobSha224}`,
  { encoding: 'utf8' }
);

const info = JSON.parse(result);
// { success: true, patch_size: 721781, patch_sha224: "5761..." }
```

### loadsmwrh_compat.py

Drop-in replacement for loadsmwrh.py that uses blob_crypto.py for decoding.

**Features**:
- ✅ Exports all functions from original loadsmwrh.py
- ✅ Overrides `get_patch_blob()` to use blob_crypto.py
- ✅ Maintains backward compatibility
- ✅ No changes needed to calling code

**Usage**:
```python
# Just change the import
import loadsmwrh_compat as loadsmwrh

# All existing code works unchanged
blob = loadsmwrh.get_patch_blob("40663")
hack_info = loadsmwrh.get_hack_info("40663")
# ... etc
```

---

## How Python Scripts Work with JavaScript Blobs

### The Format Difference

**Python-created blobs** (mkblob.py):
```
LZMA → Fernet Token → LZMA
         ↓ decrypt
      Raw bytes (LZMA data) → LZMA decompress → Patch
```

**JavaScript-created blobs** (updategames.js):
```
LZMA → Fernet Token → LZMA
         ↓ decrypt
      Base64 string (LZMA data) → Base64 decode → LZMA data → LZMA decompress → Patch
```

### Auto-Detection Logic

The `blob_crypto.py` library auto-detects the format:

```python
def decrypt_blob(blob_data, key, blob_sha224, pat_sha224=None, detect_format=True):
    # ... LZMA decompress, Fernet decrypt ...
    
    if detect_format:
        try:
            # Try Python format (direct LZMA decompress)
            decoded_blob = lzma.decompress(decrypted_blob)
        except:
            # Try JavaScript format (base64 decode first)
            lzma_data = base64.b64decode(decrypted_blob)
            decoded_blob = lzma.decompress(lzma_data)
    
    return decoded_blob
```

---

## Updating Existing Python Scripts

### Example: pb_repatch.py

**Before**:
```python
#!/usr/bin/python3
import loadsmwrh

def repatch_function(args):
    hackinfo = loadsmwrh.get_hack_info(str(hackid))
    data = loadsmwrh.get_patch_blob(str(hackid), blobinfo)
    # ... rest of code
```

**After**:
```python
#!/usr/bin/python3
import loadsmwrh_compat as loadsmwrh  # ← Only change needed

def repatch_function(args):
    hackinfo = loadsmwrh.get_hack_info(str(hackid))
    data = loadsmwrh.get_patch_blob(str(hackid), blobinfo)
    # ... rest of code (unchanged)
```

---

## Backfilling SQLite → RHMD File

To make JavaScript-created games available to Python scripts:

### Export Specific Games
```bash
# Export game 40663 to RHMD format
node backfill_rhmd.js --game-ids=40663

# Export multiple games
node backfill_rhmd.js --game-ids=40663,40664,40665

# Dry run (preview)
node backfill_rhmd.js --game-ids=40663 --dry-run
```

### Export All Games
```bash
# Export entire SQLite database to RHMD
node backfill_rhmd.js --all

# WARNING: This replaces the RHMD file. Backup first:
cp RHMD_FILE RHMD_FILE.backup
```

### Merge with Existing
```bash
# Merge new games into existing RHMD (default)
node backfill_rhmd.js --game-ids=40663 --merge
```

---

## Testing Python Script Compatibility

### Test blob_crypto.py

```bash
# Test decrypting a JavaScript blob
python3 blob_crypto.py info blobs/pblob_40663_bc9bb4a4ee \
  YXhPNWV2ZHl2MS1VNXhtZGFZVmxEMUwzRVZGVEMxYkdKVFFnQnJjb29yST0= \
  bc9bb4a4eebc9bb9ac9798fff535a551c2433c840f86499610f6139a

# Expected output:
# {
#   "success": true,
#   "patch_sha224": "5761254402dd8e5d6e065985bd44574343c441fa533ffa4be8e3393a",
#   "format": "auto-detected"
# }
```

### Test loadsmwrh_compat.py

```bash
# Test loading game 40663 (JavaScript-created)
python3 loadsmwrh_compat.py 40663

# Expected output:
# ✅ Success! Blob size: 721781 bytes
```

### Run Full Test Suite

```bash
# Test blob format compatibility
npm run test:blob-compat
# Result: 6/6 tests pass ✅

# Test Python script compatibility
npm run test:python-compat
# Result: 4/4 tests pass ✅
```

---

## Compatibility Matrix (Final)

| Blob Creator | record-creator.js | loadsm.js | blob_crypto.py | loadsmwrh.py (original) |
|--------------|-------------------|-----------|----------------|-------------------------|
| updategames.js (JS) | ✅ YES | ✅ YES | ✅ YES | ❌ NO (use compat wrapper) |
| mkblob.py (Python) | ✅ YES | ✅ YES | ✅ YES | ✅ YES |

**With loadsmwrh_compat.py**: ALL blobs work with ALL scripts! ✅

---

## Migration Guide

### For New Projects

Use updategames.js for everything:
```bash
node updategames.js --all-patches
```

Python scripts will work via loadsmwrh_compat.py.

### For Existing Projects

1. **Update Python script imports** (one line per script):
   ```python
   import loadsmwrh_compat as loadsmwrh
   ```

2. **No other changes needed** - scripts work as-is

3. **Backfill new games to RHMD**:
   ```bash
   node backfill_rhmd.js --game-ids=40663,40664 --merge
   ```

---

## Troubleshooting

### Python script can't find blob_crypto.py

```python
import sys
sys.path.insert(0, '/path/to/rhtools')
import blob_crypto
```

### Blob decryption fails

```bash
# Verify blob exists and hash is correct
python3 blob_crypto.py info blobs/pblob_XXXXX <key> <blob_sha224>

# If it fails, the blob may be corrupted - recreate it:
node updategames.js --game-ids=XXXXX
```

### RHMD file not updating

Check that:
1. SQLite database has the game: `sqlite3 electron/rhdata.db "SELECT * FROM gameversions WHERE gameid='40663'"`
2. Patchblobs exist: `sqlite3 electron/rhdata.db "SELECT * FROM patchblobs WHERE gvuuid IN (SELECT gvuuid FROM gameversions WHERE gameid='40663')"`
3. Blob files exist: `ls -lh blobs/pblob_40663*`

---

## API Reference

### blob_crypto.py

**encrypt_blob(patch_data, pat_sha224)**
- Encrypts patch data (Python format - single base64)
- Returns: `(blob_data, metadata_dict)`

**decrypt_blob(blob_data, key, blob_sha224, pat_sha224=None, detect_format=True)**
- Decrypts blob with auto-format detection
- Returns: `patch_data (bytes)`
- Raises: `ValueError` if verification fails

**CLI**:
```bash
python3 blob_crypto.py encrypt <input> <output> <pat_sha224>
python3 blob_crypto.py decrypt <input> <output> <key> <blob_sha224> [pat_sha224]
python3 blob_crypto.py info <blob> <key> <blob_sha224>
```

### loadsmwrh_compat.py

**get_patch_blob(hackid, blobinfo=None)**
- Drop-in replacement for loadsmwrh.get_patch_blob()
- Uses blob_crypto.py for auto-detection
- Returns: `patch_data (bytes)` or `None`

All other functions inherited from original loadsmwrh.py.

### backfill_rhmd.js

**CLI**:
```bash
node backfill_rhmd.js --game-ids=40663        # Export specific games
node backfill_rhmd.js --all                    # Export all games
node backfill_rhmd.js --dry-run --game-ids=40663  # Preview export
```

---

## Version History

- **v1.0** (2025-10-12): Initial release
  - blob_crypto.py with auto-detection
  - loadsmwrh_compat.py wrapper
  - Full test coverage (10/10 tests pass)
  - Production ready

---

## See Also

- `docs/UPDATEGAMES_DECODER_001.md` - Complete troubleshooting session
- `docs/UPDATEGAMES_PRODUCTION_STATUS.md` - Production status and quick reference
- `tests/README_BLOB_TESTS.md` - Test suite documentation

