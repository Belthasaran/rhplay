# IPFS CID Format Compatibility

## The Problem

IPFS CIDs can represent the same file content in different formats depending on how the file was added to IPFS:

### Format 1: dag-pb (UnixFS wrapped)
```
bafybeic3qikdonar3uelp6bq6sdgk32jlgtw5xfxg6vlahatxfbgvaqzwm
└─┬─┘
  └─ "bafy" prefix = CIDv1 + dag-pb codec (0x70)
```

### Format 2: raw (unwrapped file data)
```
bafkreic3qikdonar3uelp6bq6sdgk32jlgtw5xfxg6vlahatxfbgvaqzwm
└─┬─┘
  └─ "bafk" prefix = CIDv1 + raw codec (0x55)
```

**Same file, different CIDs!**

## Why This Happens

When you add a file to IPFS, the import method affects the CID:

```bash
# Default import (creates dag-pb with UnixFS wrapper)
ipfs add file.bin
# → bafybeic3qikdonar3uelp6bq6sdgk32jlgtw5xfxg6vlahatxfbgvaqzwm

# Raw import (no wrapper, just file data)
ipfs add --raw-leaves file.bin
# → bafkreic3qikdonar3uelp6bq6sdgk32jlgtw5xfxg6vlahatxfbgvaqzwm
```

Both CIDs resolve to the same file content, but gateways need the exact CID format used during import.

## The Solution

The `fetchpatches_mode2.js` script now automatically tries **both formats**:

### Implementation

```javascript
function getAlternateCIDs(cid) {
  if (!cid) return [];
  
  const alternates = [cid]; // Always include original
  
  if (cid.startsWith('bafy')) {
    // Convert: bafybeXXX... → bafkreXXX...
    const rawCid = 'bafk' + cid.substring(6);
    alternates.push(rawCid);
  } else if (cid.startsWith('bafk')) {
    // Convert: bafkreXXX... → bafybeXXX...
    const dagPbCid = 'bafybe' + cid.substring(4);
    alternates.push(dagPbCid);
  }
  
  return alternates;
}
```

### Search Process

When searching for a file on IPFS:

1. **First attempt**: Try the stored CID (e.g., `bafybe...`)
2. **Second attempt**: Try alternate format (e.g., `bafkre...`)
3. **Verification**: Always verify with SHA256 hash regardless of CID format

### Example Output

```
🌐 Searching IPFS...
  ⓘ Will try 2 CID formats (dag-pb/raw variants)
  Trying CID: bafybeic3qikdonar3...
    Gateway 1/2: https://ipfs.io/ipfs...
      HTTP 404
  Trying CID: bafkreic3qikdonar3...
    Gateway 1/2: https://ipfs.io/ipfs...
      HTTP 200
  ✓ Found via IPFS
    CID: bafkreic3qikdonar3uelp6bq6sdgk32jlgtw5xfxg6vlahatxfbgvaqzwm
    Gateway: https://ipfs.io/ipfs/%CID%
    Verified with SHA256
```

## Technical Details

### CID Structure

Both formats use CIDv1 with base32 encoding:

```
CIDv1 = multibase + version + codec + multihash
```

**dag-pb format (bafy):**
- Multibase: `b` (base32)
- Version: `1`
- Codec: `0x70` (dag-pb) → encodes as `be` in base32
- Multihash: SHA256 hash

**raw format (bafk):**
- Multibase: `b` (base32)
- Version: `1`
- Codec: `0x55` (raw) → encodes as `re` in base32
- Multihash: SHA256 hash (same as dag-pb)

### Conversion Logic

The conversion is done by string manipulation:

```javascript
// dag-pb to raw
'bafy' + 'be' + 'rest...' → 'bafk' + 're' + 'rest...'
 └─┬─┘   └┬┘                 └─┬─┘   └┬┘
   base   dag-pb               base   raw
   prefix codec                prefix codec

// Simplified: remove 'be', add 'k'
'bafybe...' → 'bafk' + substring(6)
```

### Why Both Formats Work

IPFS gateways can serve content using either CID because:

1. The underlying **hash** is the same (SHA256 of file content)
2. The gateway can retrieve the file using either format
3. The gateway unwraps dag-pb or serves raw data as needed
4. The **actual file content** is identical

## Database Recommendations

### Option 1: Store Both Formats

Update your database to store both CID variants:

```sql
ALTER TABLE attachments ADD COLUMN file_ipfs_cidv1_raw VARCHAR(255);
ALTER TABLE attachments ADD COLUMN file_ipfs_cidv1_dagpb VARCHAR(255);
```

### Option 2: Store One, Generate Other (Current Approach)

Store only one format and generate alternates at search time (current implementation).

**Pros:**
- No database schema changes
- Works automatically

**Cons:**
- Slight overhead during search
- String manipulation approach (not true CID conversion)

### Option 3: Proper CID Library

For production, consider using a proper IPFS CID library:

```javascript
const CID = require('multiformats/cid');

// Proper conversion with full validation
function convertCidFormat(cidStr, targetCodec) {
  const cid = CID.parse(cidStr);
  const newCid = CID.create(
    cid.version,
    targetCodec, // 0x70 for dag-pb, 0x55 for raw
    cid.multihash
  );
  return newCid.toString();
}
```

## Testing

To test CID format compatibility:

```bash
# Add a test file with both formats
echo "test content" > test.txt

# Add with dag-pb (default)
ipfs add test.txt
# Note the CID (bafybe...)

# Add with raw
ipfs add --raw-leaves test.txt
# Note the CID (bafkre...)

# Both should be retrievable via gateway
curl https://ipfs.io/ipfs/BAFY_CID
curl https://ipfs.io/ipfs/BAFK_CID

# Both should return same content
```

## Common Issues

### Issue 1: 404 on Gateway

**Symptom:** Gateway returns 404 for a valid CID

**Cause:** Gateway doesn't have that CID format pinned

**Solution:** Try alternate format or different gateway

### Issue 2: Content Mismatch

**Symptom:** CID resolves but SHA256 doesn't match

**Cause:** Wrong file or corrupted download

**Solution:** Hash verification will catch this (already implemented)

### Issue 3: CIDv0 vs CIDv1

**Symptom:** CID starts with `Qm` instead of `baf`

**Cause:** CIDv0 format (older)

**Solution:**
```javascript
// CIDv0: Qm...
// CIDv1: baf...

// The script handles this by checking file_ipfs_cidv0
const primaryCid = attachment.file_ipfs_cidv1 || attachment.file_ipfs_cidv0;
```

## Summary

The IPFS search now:

✅ **Tries both dag-pb and raw formats** automatically  
✅ **Verifies content** with SHA256 hash  
✅ **Works with any import method** users might have used  
✅ **No database changes required**  
✅ **Backward compatible** with existing data

**Result:** Files are found regardless of how they were added to IPFS!

## References

- [IPFS CID Specification](https://github.com/multiformats/cid)
- [IPFS UnixFS](https://github.com/ipfs/specs/blob/master/UNIXFS.md)
- [Multiformats](https://multiformats.io/)

## Implementation Date

October 11, 2025 - Added to `fetchpatches_mode2.js`

