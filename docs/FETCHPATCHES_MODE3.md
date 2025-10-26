# fetchpatches.js Mode 3 - Retrieve Specific Attachment/Metadata

## Overview

Mode 3 is designed to retrieve and display or save specific patch data or metadata based on flexible search criteria. It provides precise control over what to retrieve and how to output it.

**Implementation Date:** October 11, 2025

## Purpose

Mode 3 serves three main purposes:

1. **Metadata Query** - Display game version information as JSON
2. **Raw Patch Retrieval** - Extract encrypted patchblob data
3. **Decoded Patch Retrieval** - Decrypt and verify patch data

If the requested file data is not found in the database, Mode 3 automatically triggers a Mode 2 search to locate and download it.

## Command Format

```bash
node fetchpatches.js mode3 <search_value> [options]
```

## Search Options (-b, --by=)

Specifies what field to search by:

| Option | Description | Searches In | Example |
|--------|-------------|-------------|---------|
| `gameid` | Game ID (uses highest version) | gameversions | "Super Mario World" |
| `file_name` | File name | attachments | "patch.bin" |
| `gvuuid` | Game Version UUID | gameversions | "abc-123-def-456" |
| `pbuuid` | Patch Blob UUID | patchblobs | "xyz-789-uvw-012" |

**Default:** `file_name`

**Fallback:** If search by `file_name` fails, automatically tries `gameid` (TODO: implement)

### gameid Search Behavior

When searching by `gameid`:
- If multiple game versions exist, uses the one with **highest version number**
- Use `--multiple` flag to include all versions in output

## Query Options (-q, --query=)

Specifies what data to retrieve:

| Option | Description | Output Type | Use Case |
|--------|-------------|-------------|----------|
| `gameversions` | Game version metadata | JSON | View game info |
| `rawpblob` | Encrypted patchblob data | Binary | Get raw patch file |
| `patch` | Decrypted patch data | Binary | Get decoded patch |

**Default:** `gameversions`

### Query Types Explained

#### 1. gameversions

Returns JSON metadata from the `gameversions` table:

```json
[
  {
    "gvuuid": "abc-123-def-456",
    "game_id": "Super Mario World",
    "version": "1.0",
    "pbuuid": "xyz-789",
    "game_name": "Super Mario World",
    ...
  }
]
```

**Options:**
- `--multiple` - Include all versions (default: only highest)

#### 2. rawpblob

Returns the encrypted patchblob data from `attachments.file_data`:

- **Format:** Binary (encrypted with AES-256-CBC)
- **Use:** When you need the exact encrypted file as stored
- **Note:** This is the file before decryption

#### 3. patch

Returns the decrypted and verified patch data:

- **Format:** Binary (decrypted patch)
- **Decryption:** Uses key/IV from patchblobs table
- **Verification:** Validates decoded_hash_sha256
- **Use:** When you need the actual patch content

## Output Options

### -p, --print

Print output to stdout:

**Metadata (JSON):**
```bash
node fetchpatches.js mode3 "Mario" -b gameid -p
```

Output:
```json
[
  {
    "gvuuid": "...",
    "game_id": "Super Mario World",
    ...
  }
]
```

**Binary Data:**
```bash
node fetchpatches.js mode3 test.bin -q rawpblob -p
```

Output:
```
<Binary data: 1024 bytes>
Use -o option to save to file
```

### -o, --output=FILE

Save output to specified file:

```bash
node fetchpatches.js mode3 "Mario" -b gameid -q patch -o mario_patch.bin
```

### Auto Output

If neither `-p` nor `-o` is specified:

- **Metadata (gameversions):** Prints to stdout
- **Binary (rawpblob, patch):** Saves to `temp/` directory

**Filename:** Shake128 hash of content (compatible with repatch.py)

### Shake128 Filename Format

For compatibility with Python scripts (`repatch.py`, `pb_repatch.py`):

```
filename = base64(shake128(data).digest(24), b"_-")
```

**Example:**
```
temp/rjvc8EmGqOfd2ZrJSCVGk-wyymzj7SeM
```

- **Length:** 32 characters
- **Encoding:** URL-safe base64 (+ → _, / → -)
- **Hash:** Shake128 (24-byte output)

## Mode 2 Integration

If `file_data` is NULL when querying rawpblob or patch, Mode 3 automatically runs a Mode 2 search.

### Passing Mode 2 Options

All Mode 2 search options can be used:

```bash
node fetchpatches.js mode3 test.bin -q patch \
  --searchipfs \
  --ipfsgateway=https://ipfs.io/ipfs/%CID% \
  --download
```

**Available Options:**
- `--searchlocal` / `--nosearchlocal`
- `--searchlocalpath=PATH`
- `--searchardrive`
- `--searchipfs`
- `--ipfsgateway=URL`
- `--download`
- `--apisearch` / `--apiurl=URL` / `--apiclient=ID` / `--apisecret=SECRET`
- `--maxfilesize=SIZE`

### Mode 2 Search Flow

```
1. Check if file_data exists in database
   ├─> Exists? → Use it
   └─> NULL? → Continue to Mode 2

2. Display: "Running Mode 2 search for this attachment..."

3. Initialize search options (ArDrive, IPFS, etc.)

4. Search for file using all specified options

5. Verify file hash (SHA256)

6. Update database with file_data

7. Continue with original query
```

## Examples

### Example 1: View Game Metadata

**Get latest version:**
```bash
node fetchpatches.js mode3 "Super Mario World" -b gameid
```

**Get all versions:**
```bash
node fetchpatches.js mode3 "Super Mario World" -b gameid --multiple
```

### Example 2: Extract Raw Patchblob

```bash
node fetchpatches.js mode3 patch_file.bin -b file_name -q rawpblob -o encrypted.bin
```

### Example 3: Get Decoded Patch

```bash
node fetchpatches.js mode3 <gvuuid> -b gvuuid -q patch -o decoded_patch.bin
```

### Example 4: Retrieve with IPFS Search

If file not in database, search IPFS:

```bash
node fetchpatches.js mode3 test.bin -q patch \
  --searchipfs \
  --ipfsgateway=https://ipfs.io/ipfs/%CID%
```

### Example 5: Auto-Named Output

Save to temp/ with shake128 filename:

```bash
node fetchpatches.js mode3 test.bin -q patch
```

Output:
```
✓ Saved to: temp/rjvc8EmGqOfd2ZrJSCVGk-wyymzj7SeM
  Size: 1024 bytes
```

### Example 6: Search by UUID

```bash
node fetchpatches.js mode3 abc-123-def-456 -b pbuuid -q patch -p
```

## Output Format

### Success Output

```
======================================================================
MODE 3: Retrieve Attachment/Metadata
======================================================================

Search Configuration:
  Search By:    gameid
  Search Value: Super Mario World
  Query Type:   gameversions
  Output:       auto

Searching...
Found:
  Game Versions: 1
  Patch Blobs:   1
  Attachments:   1

Output:
======================================================================
[
  {
    "gvuuid": "abc-123",
    "game_id": "Super Mario World",
    ...
  }
]
======================================================================
```

### Mode 2 Search Output

```
⚠ Attachment file_data is NULL
Running Mode 2 search for this attachment...

Mode 2 Search Options:
  Local Search:  Yes
  ArDrive:       No
  IPFS:          Yes
  Download URLs: No
  API Search:    No

Initializing IPFS gateways...
...

✓ Found and verified file data
  Source: ipfs:bafkre...@https://ipfs.io
✓ Updated attachment record

Decrypting patchblob...
✓ Decoded hash verified (SHA256)
✓ Saved to: output.bin
  Size: 2048 bytes
```

### Error Output

**No records found:**
```
Searching...
Found:
  Game Versions: 0
  Patch Blobs:   0
  Attachments:   0

✗ No records found
```

**File not found after search:**
```
⚠ Attachment file_data is NULL
Running Mode 2 search for this attachment...

...

✗ File not found in any source
✗ Could not retrieve file data
```

**Decryption failure:**
```
Decrypting patchblob...
✗ Decoded hash mismatch!
  Expected: abc123...
  Got:      def456...
```

## Database Relationships

Mode 3 automatically follows database relationships:

```
Search by gameid
  ↓
gameversions table (highest version)
  ↓ (via pbuuid)
patchblobs table
  ↓ (via auuid)
attachments table
  ↓
file_data (binary)
```

## Use Cases

### 1. Game Development

View all versions of a game:

```bash
node fetchpatches.js mode3 "My Game" -b gameid --multiple -p
```

### 2. Patch Extraction

Extract decoded patch for analysis:

```bash
node fetchpatches.js mode3 <gvuuid> -b gvuuid -q patch -o patch_to_analyze.bin
```

### 3. Backup

Get raw encrypted patchblobs for backup:

```bash
node fetchpatches.js mode3 patch.bin -q rawpblob -o backup/patch_encrypted.bin
```

### 4. Integration with repatch.py

Generate files compatible with Python scripts:

```bash
# Generates temp/SHAKE128HASH file
node fetchpatches.js mode3 test.bin -q patch

# Use in repatch.py
python repatch.py temp/SHAKE128HASH
```

## Decryption Details

When querying with `-q patch`:

### 1. Retrieve Encrypted Data

From `attachments.file_data`

### 2. Get Decryption Key

From `patchblobs` table:
- `pbkey` - AES-256-CBC key (hex)
- `pbiv` - Initialization vector (hex)

### 3. Decrypt

```javascript
const decipher = crypto.createDecipheriv(
  'aes-256-cbc',
  Buffer.from(pbkey, 'hex'),
  Buffer.from(pbiv, 'hex')
);
const decrypted = Buffer.concat([
  decipher.update(encrypted),
  decipher.final()
]);
```

### 4. Verify

Compare SHA256 hash with `decoded_hash_sha256`:

```javascript
const actualHash = crypto.createHash('sha256')
  .update(decrypted)
  .digest('hex');

if (actualHash === decoded_hash_sha256) {
  // ✓ Verified
} else {
  // ✗ Decryption failed
}
```

## Performance

### Speed

- **Metadata query:** Instant (database lookup only)
- **Raw patchblob:** Fast (no decryption needed)
- **Decoded patch:** Fast (AES-256-CBC decryption)
- **With Mode 2 search:** Depends on search options

### Memory

- Loads entire file into memory for:
  - Hash calculation
  - Decryption
  - Output

**Consideration:** For very large files (>1GB), use streaming in future version

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| No records found | Invalid search value | Check spelling, try different search type |
| No attachments found | pbuuid/gvuuid has no linked attachment | Check database relationships |
| Missing encryption key | patchblobs missing pbkey/pbiv | Cannot decrypt, use rawpblob instead |
| Decryption failed | Wrong key or corrupted data | Check patchblobs table |
| Hash mismatch | Decryption error or tampered data | File integrity compromised |
| File not found | file_data is NULL and Mode 2 failed | Try more search options |

## Troubleshooting

### Issue: "No records found"

**Check:**
1. Is search value correct?
2. Is search type (-b) correct?
3. Does record exist in database?

**Try:**
```bash
# Search by different field
node fetchpatches.js mode3 "value" -b gvuuid
node fetchpatches.js mode3 "value" -b file_name
```

### Issue: "Could not retrieve file data"

**Check:**
1. Is file_data NULL in database?
2. Are Mode 2 search options provided?

**Try:**
```bash
# Add search options
node fetchpatches.js mode3 test.bin -q patch \
  --searchipfs --download --apisearch
```

### Issue: "Decoded hash mismatch"

**Cause:** Decryption key is wrong or data is corrupted

**Solution:**
1. Check patchblobs table has correct pbkey/pbiv
2. Try rawpblob to get encrypted data
3. Verify file_data hash matches file_hash_sha256

## Future Enhancements (TODO)

### 1. patch_name Search

```bash
node fetchpatches.js mode3 "patch_v1.0" -b patch_name
```

### 2. Fallback Search

If file_name not found, automatically try gameid

### 3. Streaming Support

For very large files:

```bash
node fetchpatches.js mode3 largefile.bin -q patch --stream -o output.bin
```

### 4. Multiple File Output

When `--multiple` returns multiple attachments:

```bash
node fetchpatches.js mode3 "Game" -b gameid -q patch --multiple -o output_dir/
```

### 5. JSON Output for Binary

Option to output file info as JSON instead of binary:

```bash
node fetchpatches.js mode3 test.bin -q patch --json
```

Output:
```json
{
  "file_name": "test.bin",
  "file_size": 1024,
  "file_hash_sha256": "abc123...",
  "source": "database",
  "output_file": "temp/shake128hash"
}
```

## Summary

Mode 3 provides:

✅ **Flexible Search** - By gameid, file_name, gvuuid, or pbuuid  
✅ **Multiple Query Types** - Metadata, raw, or decoded  
✅ **Auto Output** - Smart defaults for metadata vs binary  
✅ **Mode 2 Integration** - Automatic search if file not found  
✅ **Verification** - Hash verification for decoded patches  
✅ **Python Compatibility** - Shake128 filenames for repatch.py  

**Status:** ✅ Fully implemented and ready for use!

