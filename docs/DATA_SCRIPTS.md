# Data Management Scripts

This document describes the data loading and blob attachment scripts for the rhtools project.

## Scripts Overview

### 1. loaddata.js - Load JSON game data into rhdata.db

**Purpose:** Import game version data from JSON files into the `gameversions`, `rhpatches`, and `patchblobs` tables in `rhdata.db`.

**Usage:**
```bash
node loaddata.js <json-file>
npm run loaddata <json-file>
```

**Examples:**
```bash
node loaddata.js electron/example-rhmd/10012
node loaddata.js mydata.json
npm run loaddata electron/example-rhmd/38595
```

**Features:**
- ✅ Supports single JSON objects or arrays of objects
- ✅ Automatically tracks version numbers for each gameid
- ✅ Detects and skips duplicate records based on multiple fields
- ✅ Tracks changed attributes between versions (stored in `gvchange_attributes`)
- ✅ Stores optimized JSON in `gvjsondata` and `pbjsondata` fields
- ✅ Auto-generates UUIDs for all primary keys
- ✅ Creates entries in `rhpatches` table if `patch` field exists
- ✅ Creates entries in `patchblobs` table if required fields exist

**Input JSON Structure:**
- Required fields: `id` (or `gameid`), `name`
- Optional fields map to `gameversions` table columns
- `type` is automatically mapped to `gametype`
- If `patchblob1_name`, `patchblob1_key`, and `patchblob1_sha224` exist, creates patchblob entry
- If `patch` field exists, creates rhpatches entry

**Duplicate Detection:**
Checks the following fields before inserting:
- `gameid`, `name`, `gametype`, `moderated`, `author`, `authors`
- `submitter`, `demo`, `length`, `difficulty`, `url`, `download_url`
- `size`, `description`, `patchblob1_name`

### 2. attachblobs.js - Attach blob files to patchbin.db

**Purpose:** Search for patchblob files, verify their integrity, decrypt them, calculate hashes/checksums/IPFS CIDs, and insert complete records into the `attachments` table in `patchbin.db`.

**Usage:**
```bash
node attachblobs.js
npm run attachblobs
```

**Features:**
- ✅ Reads all patchblobs records from `rhdata.db`
- ✅ Recursively searches project directories for matching files (excludes symlinks)
- ✅ Verifies file integrity with SHA-224 hash comparison
- ✅ Handles encrypted files (decrypts using LZMA + Fernet with `patchblob1_key`)
- ✅ Calculates multiple hashes: SHA-1, SHA-224, SHA-256, MD5
- ✅ Calculates CRC checksums: CRC16 (BSD), CRC32
- ✅ Calculates IPFS CIDs: CIDv0 and CIDv1 (both for encrypted and decoded data)
- ✅ Verifies decoded data matches `pat_sha224` from patchblobs table
- ✅ Stores complete blob data in `file_data` field
- ✅ Automatically skips duplicates (based on `file_name` + `file_hash_sha224`)
- ✅ Creates `patchbin.db` automatically if it doesn't exist

**Process Flow:**
1. Read patchblobs from `rhdata.db`
2. Search for file matching `patchblob1_name`
3. Verify file SHA-224 matches `patchblob1_sha224`
4. Calculate all file hashes and checksums
5. Calculate IPFS CIDs for encrypted file
6. If `patchblob1_key` exists:
   - Decompress with LZMA
   - Decrypt with Fernet
   - Decompress again with LZMA
   - Verify decoded SHA-224 matches `pat_sha224`
   - Calculate all decoded hashes and IPFS CIDs
7. Insert complete record into `attachments` table

**Decryption Details:**
The script uses the decryption algorithm from `loadsm.js`:
```
Raw File → LZMA Decompress → Fernet Decrypt → LZMA Decompress → Decoded Data
```

**Output Fields in attachments table:**

**File Metadata:**
- `auuid` - Generated UUID
- `pbuuid` - From patchblobs table
- `gvuuid` - From patchblobs table
- `file_name` - Original blob filename
- `filekey` - Encryption key (if encrypted)

**Encrypted File Data:**
- `file_crc16` - BSD 16-bit checksum
- `file_crc32` - CRC32 checksum
- `file_hash_sha1` - SHA-1 hash
- `file_hash_sha224` - SHA-224 hash
- `file_hash_md5` - MD5 hash
- `file_hash_sha256` - SHA-256 hash
- `file_ipfs_cidv0` - IPFS CID version 0 (base58)
- `file_ipfs_cidv1` - IPFS CID version 1 (base32)
- `file_data` - Raw blob data (encrypted)

**Decoded File Data (if encrypted):**
- `decoded_hash_sha1` - SHA-1 hash of decoded data
- `decoded_hash_sha224` - SHA-224 hash of decoded data (verified against `pat_sha224`)
- `decoded_hash_md5` - MD5 hash of decoded data
- `decoded_hash_sha256` - SHA-256 hash of decoded data
- `decoded_ipfs_cidv0` - IPFS CID v0 of decoded data
- `decoded_ipfs_cidv1` - IPFS CID v1 of decoded data

**Additional Fields:**
- `locators` - JSON array of remote URLs/paths (empty by default)
- `parents` - JSON array of parent archive UUIDs (empty by default)
- `updated_time` - Timestamp of record update
- `import_time` - Timestamp of initial import

## Database Schemas

### rhdata.db Tables
- `gameversions` - Game version records with metadata and JSON data
- `rhpatches` - Patch name registry
- `patchblobs` - Patchblob metadata and references

### patchbin.db Tables
- `attachments` - Complete blob files with all hashes, checksums, and IPFS CIDs

## Dependencies

Core dependencies (from package.json):
- `better-sqlite3` - SQLite database access
- `fernet` - Fernet encryption/decryption
- `lzma-native` - LZMA compression/decompression
- `urlsafe-base64` - URL-safe base64 encoding
- `crc` - CRC16 checksums
- `crc-32` - CRC32 checksums
- `multiformats` - IPFS CID calculation

## Examples

### Complete Workflow

1. **Load game data from example files:**
```bash
# Load single game
npm run loaddata electron/example-rhmd/10012

# Load multiple games
for file in electron/example-rhmd/*; do
  npm run loaddata "$file"
done
```

2. **Attach blob files:**
```bash
# Process all patchblobs and attach files
npm run attachblobs
```

3. **Verify results:**
```bash
# Check rhdata.db
cd electron
sqlite3 rhdata.db "SELECT COUNT(*) FROM gameversions;"
sqlite3 rhdata.db "SELECT COUNT(*) FROM patchblobs;"

# Check patchbin.db
sqlite3 patchbin.db "SELECT COUNT(*) FROM attachments;"
sqlite3 patchbin.db "SELECT file_name, file_ipfs_cidv0, decoded_hash_sha224 FROM attachments LIMIT 5;"
```

## Verification

The scripts include comprehensive verification:

**loaddata.js verifies:**
- Duplicate detection before insertion
- Version tracking and change detection
- Field mapping (type → gametype)

**attachblobs.js verifies:**
- File SHA-224 matches `patchblob1_sha224` (encrypted file)
- Decoded SHA-224 matches `pat_sha224` (decoded data)
- Aborts insertion if verification fails
- Warns about hash mismatches

## Performance Notes

- `loaddata.js` processes records quickly (< 1 second per file)
- `attachblobs.js` may take longer due to:
  - Recursive file searching
  - Multiple hash calculations
  - LZMA decompression (slow)
  - Fernet decryption
  - IPFS CID calculation

Typical processing time per blob: 2-5 seconds for encrypted files, < 1 second for unencrypted files.

## Error Handling

Both scripts include comprehensive error handling:
- File not found warnings
- Hash mismatch warnings
- Decryption failure handling
- Duplicate skip notifications
- Database constraint handling

## Testing

Example test results from development:

**loaddata.js:**
- ✅ Successfully loaded 5 test records
- ✅ Duplicate detection working (skips re-imports)
- ✅ Version tracking working (v1, v2, v3 tested)
- ✅ Change attributes properly tracked

**attachblobs.js:**
- ✅ Successfully processed 7 blob files
- ✅ All hashes calculated correctly
- ✅ IPFS CIDs generated (both v0 and v1)
- ✅ Decryption working (verified decoded hashes match pat_sha224)
- ✅ Duplicate detection working (same count on second run)

## Troubleshooting

**"File not found" warnings:**
- Normal if blob files don't exist in project directories
- Script will skip and continue with next record

**"Hash mismatch" warnings:**
- File may be corrupted or wrong file with same name
- Script will continue searching for correct file

**"Decoded hash mismatch" errors:**
- Decryption may have failed
- patchblob1_key may be incorrect
- File may be corrupted
- Script will abort insertion for that record

**"Already exists in database":**
- Normal on subsequent runs
- Duplicate detection is working correctly

