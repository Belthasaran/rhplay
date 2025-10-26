# fetchpatches.js - Patch Attachment Manager

A script to manage patch attachments across ArDrive, IPFS, and local filesystem.

## Overview

`fetchpatches.js` operates in three modes to help manage the `attachments` table in `patchbin.db`:

1. **Mode 1**: Populate ArDrive metadata for attachments
2. **Mode 2**: Find and download missing attachment data (future)
3. **Mode 3**: Retrieve specific attachments (future)

## Prerequisites

- Node.js
- Database files: `electron/patchbin.db` and `electron/rhdata.db`
- Network access to ArDrive (arweave.net)

## Usage

### Display Help

```bash
node fetchpatches.js
# or
npm run fetchpatches
```

### Mode 1: Populate ArDrive Metadata

This mode scans the `attachments` table for records with missing ArDrive metadata (`arweave_file_id`, `arweave_file_name`, or `arweave_file_path` are NULL) and attempts to populate them.

```bash
node fetchpatches.js mode1
# or
npm run fetchpatches:mode1
```

**What it does:**

1. Lists all files in the public ArDrive folder (ID: `07b13d74-e426-4012-8c6d-cba0927012fb`)
2. Queries attachments table for records missing ArDrive metadata
3. Matches files by name (handles `.bin` extension variations)
4. Downloads candidate files from ArDrive
5. Verifies file integrity using cryptographic hashes (SHA-256, SHA-224)
6. Updates database with ArDrive metadata for verified matches

**Hash Verification Priority:**

The script uses secure hashes for verification in this order:
1. SHA-256 (primary)
2. SHA-224 (secondary)
3. Decoded SHA-256 (for encrypted files)
4. Decoded SHA-224 (for encrypted files)

**Note:** Weak hashes (MD5, SHA-1, CRC16, CRC32) are NOT used for verification.

**Example Output:**

```
======================================================================
MODE 1: Populate ArDrive Metadata
======================================================================

Initializing ArDrive client...

Listing files from ArDrive folder: 07b13d74-e426-4012-8c6d-cba0927012fb
Found 5247 items on ArDrive
  5123 files
  124 folders

Querying attachments with missing ArDrive metadata...
Found 2682 attachments with missing ArDrive metadata

======================================================================
Processing attachments...

[1] Matched: pblob_11374_7003deed8b
  ArDrive Path: /SMWRH/pblobs/pblob_11374_7003deed8b
  File ID: abc123-def456-...
  Attachment: pblob_11374_7003deed8b (auuid: xyz789-...)
  Downloading file for verification...
  Downloaded 45678 bytes
    ✓ Verified with SHA-224: 7003deed8bad89e4981fd92cd7dc4260...
  ✓ Updated database record

...

======================================================================

Summary:
  Total attachments checked: 2682
  Files matched by name:     856
  Files verified by hash:    856
  Records updated:           856
  Failed:                    0
  Still missing metadata:    1826
```

### Mode 2: Find Attachment Data (Future)

```bash
node fetchpatches.js mode2
# or
npm run fetchpatches:mode2
```

This mode will:
- Search for attachments with NULL `file_data`
- Attempt to locate files on local filesystem
- Download from ArDrive if available
- Download from IPFS using CIDs
- Verify and populate `file_data` column

### Mode 3: Retrieve Attachment (Future)

```bash
node fetchpatches.js mode3 [options]
# or
npm run fetchpatches:mode3 -- [options]
```

This mode will retrieve specific attachments based on:
- `gameid`
- `file_name`
- `auuid` (attachment UUID)
- `resuuid` (resource UUID)
- `gvuuid` (game version UUID)
- `pbuuid` (patch blob UUID)
- `patch_name`
- `patchblob1_name`
- Cryptographic hashes (SHA-224, SHA-256)
- IPFS CIDs (v0 or v1)

## Database Schema

### Attachments Table (patchbin.db)

Key columns for ArDrive integration:

| Column | Type | Description |
|--------|------|-------------|
| `auuid` | varchar(255) | Primary key (attachment UUID) |
| `file_name` | varchar(255) | File name |
| `file_hash_sha224` | varchar(255) | SHA-224 hash |
| `file_hash_sha256` | varchar(255) | SHA-256 hash |
| `file_ipfs_cidv0` | varchar(255) | IPFS CID v0 |
| `file_ipfs_cidv1` | varchar(255) | IPFS CID v1 |
| `arweave_file_name` | varchar(255) | Name on ArDrive |
| `arweave_file_id` | varchar(255) | ArDrive entity ID |
| `arweave_file_path` | varchar(255) | Full path on ArDrive |
| `file_data` | blob | File content |

## Implementation Details

### File Matching Strategy

1. **Exact name match**: `pblob_11374_7003deed8b`
2. **Name without .bin**: `pblob_11374_7003deed8b.bin` → `pblob_11374_7003deed8b`
3. **Name with .bin added**: `pblob_11374_7003deed8b` → `pblob_11374_7003deed8b.bin`

### Download and Verification

Files are downloaded via:
```
https://arweave.net/{dataTxId}
```

Verification ensures:
- File integrity using strong cryptographic hashes
- No reliance on weak hashes (MD5, SHA-1)
- Support for both raw and decoded (encrypted) file hashes

### ArDrive Integration

The script uses `ardrive-core-js` library:
- Anonymous access (no wallet required for public folders)
- Recursive folder listing with configurable depth
- Direct file access via transaction IDs

## Troubleshooting

### "Error: patchbin.db not found"

Ensure the database exists at `electron/patchbin.db`. Run `node attachblobs.js` first to create and populate it.

### "Error listing ArDrive files"

Check network connectivity to `arweave.net` (port 443).

### "Hash mismatch"

The file on ArDrive doesn't match the expected hash. This could indicate:
- File corruption on ArDrive
- Incorrect hash in database
- Wrong file matched by name

## Related Scripts

- `attachblobs.js` - Attaches local blob files to patchbin.db
- `loaddata.js` - Loads data from rhdata.db
- `ardrive-example-ls.js` - Example ArDrive listing script

## Future Enhancements

- [ ] Implement Mode 2 (find and download missing file_data)
- [ ] Implement Mode 3 (retrieve specific attachment)
- [ ] Add progress bar for long operations
- [ ] Add retry logic for failed downloads
- [ ] Support batch operations with concurrency limits
- [ ] Add dry-run mode
- [ ] Cache ArDrive file listings
- [ ] Support private ArDrive folders
- [ ] Add IPFS gateway support
- [ ] Generate reports of missing/mismatched files

