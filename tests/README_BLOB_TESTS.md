# Blob Compatibility Test Suite

## Overview

This directory contains tests to verify that JavaScript-created blobs (via `updategames.js`) are compatible with all decoders in the rhtools ecosystem.

## Running Tests

```bash
# Run blob compatibility tests
npm run test:blob-compat

# Or directly
node tests/test_blob_compatibility.js
```

## Test Coverage

### Test 1: Create Blob with JavaScript ✅
Verifies that `blob-creator.js` can create encrypted blobs successfully.

**Pass Criteria**:
- Blob file created
- Key is 60 characters (double-encoded URL-safe base64)
- Blob hash is calculated correctly

### Test 2: Decode with record-creator.js ✅
Verifies that JavaScript `record-creator.js` can decode JavaScript-created blobs.

**Pass Criteria**:
- Blob decodes without errors
- Decoded hash matches original patch hash
- All `decoded_*` fields can be populated

### Test 3: Decode with loadsm.js Procedure ✅
Verifies that `loadsm.js` can decode JavaScript-created blobs (with auto-detection).

**Pass Criteria**:
- Blob decodes using loadsm.js procedure
- Decoded hash matches original patch hash
- Auto-detection handles double base64 encoding

### Test 4: Decode with Python loadsmwrh.py Procedure ❌
Attempts to decode JavaScript blob with Python Fernet.

**Expected Result**: FAIL (documented incompatibility)

**Reason**: Python Fernet works with raw bytes, JavaScript Fernet works with strings. When Python decrypts a JavaScript blob, it gets a base64 string (not decoded bytes), which cannot be decompressed.

**Impact**: Minimal - Python scripts use Python-created blobs

### Test 5: Verify Key Format ✅
Verifies that keys are stored in the correct Python-compatible format.

**Pass Criteria**:
- Key is 60 characters long
- Key is double-encoded: `base64(urlsafe_base64(32_byte_key))`
- Inner key is 44 characters (URL-safe base64)
- Inner key decodes to 32 bytes

### Test 6: Reference Test with Python Blob ✅
Verifies that our JavaScript decoder works with Python-created blobs.

**Pass Criteria**:
- Can decode legacy Python-created blobs (e.g., game 32593)
- Auto-detection correctly identifies single base64 format
- Decoded hash matches expected value

## Production Readiness Criteria

For `updategames.js` to be considered production ready, the following must pass:

1. ✅ Test 1: JavaScript blob creation
2. ✅ Test 2: record-creator.js decoding
3. ✅ Test 3: loadsm.js decoding
4. ✅ Test 5: Key format verification
5. ✅ Test 6: Python blob compatibility

**Test 4 is EXPECTED to fail** - this is a documented limitation.

## Current Status

**ALL CRITICAL TESTS PASS** ✅

updategames.js is **PRODUCTION READY** for the JavaScript ecosystem with one known limitation:
- Python loadsmwrh.py cannot decode JavaScript blobs (use Python mkblob.py if needed)

## Compatibility Matrix

| Blob Creator | record-creator.js | loadsm.js | loadsmwrh.py |
|--------------|-------------------|-----------|--------------|
| JavaScript updategames.js | ✅ YES | ✅ YES (after fix) | ❌ NO (library incompatibility) |
| Python mkblob.py | ✅ YES | ✅ YES | ✅ YES |

## Utility Scripts

### identify-incompatible-keys.js
Scans database for keys in wrong format.

```bash
npm run utils:identify-keys
# or
node identify-incompatible-keys.js
```

### reprocess-attachments.js
Recreates attachments for existing gameversions.

```bash
npm run utils:reprocess-attachments -- --game-ids=40663
# or
node reprocess-attachments.js --game-ids=40663 --force
```

## Related Documentation

- `docs/UPDATEGAMES_DECODER_001.md` - Complete troubleshooting session documentation
- `docs/NEW_UPDATE_SCRIPT_SPEC.md` - Update script specification

## Test Data

Tests create temporary data in:
- `tests/test_blobs/` - Test blob files (auto-cleaned)
- `tests/test_patches/` - Test patch files (auto-cleaned)
- `tests/test_pat_meta/` - Test metadata (auto-cleaned)

All test data is automatically cleaned up after test completion.

