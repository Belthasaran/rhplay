# fetchpatches.js - Mode 2 Documentation

## Overview

Mode 2 finds and populates missing `file_data` for attachments that have metadata (hashes, file_size) but are missing the actual file content. This mode supports searching multiple sources in a configurable order.

## Purpose

The database can be shipped with complete metadata but without `file_data` to reduce size. Mode 2 allows users to populate `file_data` incrementally by searching various sources (local filesystem, ArDrive, IPFS, download URLs, etc.).

## Usage

```bash
# Basic usage (local search only, default 20 attachments)
node fetchpatches.js mode2

# With search options
node fetchpatches.js mode2 --searchmax=10 --searchipfs
node fetchpatches.js mode2 --searchlocalpath=../backup --download
node fetchpatches.js mode2 --searchardrive --searchipfs --maxfilesize=500MB

# With custom npm script
npm run fetchpatches:mode2 -- --searchmax=5
```

## Search Options

Mode 2 searches for files in the following order (A → F). By default, only Option A is enabled.

### Option A: Local Search (Default)

**Enabled by default** - Searches recursively in default program folders:
- `blobs/`
- `electron/blobs/`
- `patch/`
- `temp/`

**Disable with:** `--nosearchlocal`

**Features:**
- Recursive directory search
- Skips symbolic links
- Matches by filename and file size
- Verifies with SHA-256/SHA-224
- Handles different file extensions

### Option B: Custom Local Paths

**Enable with:** `--searchlocalpath=PATH` (can specify multiple times)

**Examples:**
```bash
--searchlocalpath=../backup
--searchlocalpath=/mnt/storage
--searchlocalpath="C:\Downloads"
--searchlocalpath=/path/to/archive.zip  # Search inside archive
```

**Features:**
- Same as Option A but for custom paths
- Can point to directories or archive files
- Multiple paths can be specified

### Option C: ArDrive Search

**Enable with:** `--searchardrive`

**Searches:**
1. By `arweave_file_id` (if available)
2. By `arweave_file_name` (if available)
3. By `arweave_file_path` (if available)

**Example:**
```bash
node fetchpatches.js mode2 --searchardrive --searchmax=10
```

### Option D: IPFS Search

**Enable with:** `--searchipfs`

**Searches:**
1. Using `file_ipfs_cidv1` (preferred)
2. Using `file_ipfs_cidv0` (fallback)

**Custom gateway:**
```bash
--ipfsgateway=https://ipfs.io
--ipfsgateway=https://gateway.pinata.cloud
--ipfsgateway=https://cloudflare-ipfs.com
```

**Example:**
```bash
node fetchpatches.js mode2 --searchipfs --ipfsgateway=https://gateway.pinata.cloud
```

### Option E: All ArDrive (Not yet implemented)

**Enable with:** `--allardrive`

Broader search of entire ArDrive folder, including searching inside archives.

### Option F: Download URLs

**Enable with:** `--download`

**Searches:**
- Checks `download_urls` field in database
- Supports single URL string or JSON array
- Tries URLs in random order
- Verifies downloaded content with hashes
- Detects and searches inside archives

**Example:**
```bash
node fetchpatches.js mode2 --download --searchmax=20
```

### Option G: API Search (Not yet implemented)

**Enable with:** `--apisearch --apiurl=URL`

POST request to private search API with signature verification.

## General Options

### Search Limits

```bash
--searchmax=N              # Max attachments to search (default: 20)
--maxfilesize=SIZE         # Max file size to download (default: 200MB)
```

**Size formats:**
```bash
--maxfilesize=100MB
--maxfilesize=1GB
--maxfilesize=500MB
```

### Timing Options

```bash
--fetchdelay=MS            # Delay between attachments (default: 1000ms)
```

### Search Behavior

```bash
--ignorefilename           # Search all files by hash only (slower but thorough)
```

When enabled:
- Ignores filename matching
- Checks every file's hash
- Useful for renamed files
- Significantly slower

## How It Works

### 1. Query Phase

Queries attachments where:
- `file_data IS NULL` (missing content)
- `file_size IS NOT NULL` (size is known)
- `file_hash_sha224 IS NOT NULL OR file_hash_sha256 IS NOT NULL` (hash available)

Orders by `last_search ASC NULLS FIRST` (oldest searches first, never-searched first).

### 2. Search Phase

For each attachment:
1. Try Option A: Local search (if enabled)
2. Try Option B: Custom paths (if specified)
3. Try Option C: ArDrive (if enabled)
4. Try Option D: IPFS (if enabled)
5. Try Option F: Download URLs (if enabled)

Stops at first successful match.

### 3. Verification Phase

When a file is found:
1. Calculate SHA-256 hash (preferred)
2. Calculate SHA-224 hash (fallback)
3. Compare against database values
4. Only accept if hash matches

### 4. Update Phase

**If found and verified:**
- Update `file_data` with file content
- Update `updated_time` to current timestamp
- Update `last_search` to current timestamp

**If not found:**
- Update `last_search` to current timestamp only
- Allows retry later (different sources may be added)

## Output Examples

### Successful search:

```
======================================================================
MODE 2: Find Attachment Data
======================================================================

Configuration:
  Search Max: 10 attachments per run
  Fetch Delay: 1000ms between each attachment
  Max File Size: 200MB

Search Options:
  Local Search: Yes
  Local Paths: ../backup
  ArDrive: No
  IPFS: Yes
  Download URLs: Yes
  Ignore Filename: No

Querying attachments with missing file_data...
Found 10 attachments needing file_data

======================================================================
Processing attachments...

[1/10] pblob_11374_7003deed8b (9 remaining)
  auuid: a1b2c3d4-e5f6-7890-abcd-ef1234567890
  size: 182536 bytes
  hashes: SHA256=yes, SHA224=yes
  🔍 Searching local filesystem...
    ✓ Found matching file: /path/to/file
      Verified with SHA-256
  ✓ Found file data from: local:/path/to/file
    Size: 182536 bytes
  ✓ Updated database record

  ⏱ Waiting 1000ms before next search...

[2/10] pblob_12923_4a82423cd8 (8 remaining)
  auuid: b2c3d4e5-f678-9012-bcde-f12345678901
  size: 225648 bytes
  hashes: SHA256=yes, SHA224=yes
  🔍 Searching local filesystem...
    ⚠ Not found locally
  🌐 Searching IPFS...
    Trying: https://ipfs.io/ipfs/QmXxx...
    ✓ Found via IPFS
      Verified with SHA-256
  ✓ Found file data from: ipfs:QmXxx...
    Size: 225648 bytes
  ✓ Updated database record

...

======================================================================

Summary:
  Total attachments checked:     10
  Files found and verified:      7
  Records updated with data:     7
  Files not found:               3
  Still missing file_data:       143

💡 Tip: Run the script again to process more attachments
   Consider adding more search options: --searchipfs, --searchardrive, --download
```

### No attachments need data:

```
======================================================================
MODE 2: Find Attachment Data
======================================================================

...

Querying attachments with missing file_data...
Found 0 attachments needing file_data

✓ No attachments need file_data!
```

## File Matching Logic

### By Default (--ignorefilename not set):

1. **Size check**: File size must match `file_size` (skip if mismatch, unless archive)
2. **Name check**: Filename (without extension) must match (skip if mismatch, unless archive)
3. **Hash verify**: SHA-256 or SHA-224 must match exactly

### With --ignorefilename:

1. **Size check**: File size must match `file_size`
2. **Hash verify**: SHA-256 or SHA-224 must match exactly
3. **Name ignored**: Any filename accepted if hash matches

### Archives (ZIP, 7Z, TAR, ISO):

- Always searched regardless of size/name mismatch
- Contents are examined for matching files
- Individual files inside are verified by hash

## Performance Considerations

### Local Search Speed

- **Fast**: ~1000 files/second (SSD)
- **Slow**: ~100 files/second (HDD)
- With `--ignorefilename`: 10-100x slower (hashes every file)

### Network Search Speed

- **IPFS**: 5-30 seconds per file (variable)
- **ArDrive**: 5-15 seconds per file
- **HTTP URLs**: 1-10 seconds per file

### Recommended Settings

**Quick local check:**
```bash
node fetchpatches.js mode2 --searchmax=100 --fetchdelay=100
```

**Thorough search with network:**
```bash
node fetchpatches.js mode2 --searchmax=20 --searchipfs --download --fetchdelay=2000
```

**Deep search (slow but thorough):**
```bash
node fetchpatches.js mode2 --searchmax=10 --searchipfs --searchardrive --ignorefilename --maxfilesize=1GB
```

## Database Schema Requirements

Mode 2 requires these columns in the `attachments` table:

| Column | Type | Required | Purpose |
|--------|------|----------|---------|
| `auuid` | varchar(255) | Yes | Primary key |
| `file_data` | blob | Yes | File content (NULL = needs data) |
| `file_size` | bigint | Yes | Expected file size in bytes |
| `file_hash_sha224` | varchar(255) | One of | SHA-224 hash for verification |
| `file_hash_sha256` | varchar(255) | One of | SHA-256 hash for verification |
| `file_name` | varchar(255) | Yes | Expected filename |
| `file_ipfs_cidv0` | varchar(255) | Optional | IPFS CID v0 |
| `file_ipfs_cidv1` | varchar(255) | Optional | IPFS CID v1 |
| `arweave_file_id` | varchar(255) | Optional | ArDrive file ID |
| `arweave_file_name` | varchar(255) | Optional | ArDrive filename |
| `arweave_file_path` | varchar(255) | Optional | ArDrive path |
| `download_urls` | varchar(255) | Optional | Download URL(s) |
| `last_search` | timestamp | Yes | Last search attempt |
| `updated_time` | timestamp | Yes | Last update time |

## Integration with Other Modes

### Typical Workflow

1. **Import metadata** (via loaddata.js or similar):
   ```bash
   node loaddata.js
   ```

2. **Populate ArDrive metadata** (Mode 1):
   ```bash
   node fetchpatches.js mode1 --fetchlimit=100
   ```

3. **Search for local files** (Mode 2):
   ```bash
   node fetchpatches.js mode2 --searchmax=50
   ```

4. **Add file sizes** (addsizes mode):
   ```bash
   node fetchpatches.js addsizes
   ```

5. **Search with network** (Mode 2 again):
   ```bash
   node fetchpatches.js mode2 --searchipfs --download --searchmax=20
   ```

## Current Limitations

### Not Yet Implemented

- ❌ Archive file searching (ZIP, 7Z, TAR, ISO) - placeholders exist
- ❌ Option E: All ArDrive search
- ❌ Option G: API search with signatures
- ❌ Progress bar for large operations
- ❌ Parallel downloads (sequential only)
- ❌ Resume after interruption

### Implemented

- ✅ Local filesystem search (recursive)
- ✅ Custom search paths
- ✅ IPFS search via gateways
- ✅ Download URLs search
- ✅ SHA-256/SHA-224 verification
- ✅ File size checking
- ✅ Filename matching
- ✅ last_search timestamp tracking
- ✅ Symbolic link skipping

## Troubleshooting

### "Found 0 attachments needing file_data"

**Causes:**
- All attachments already have `file_data`
- Attachments lack required hashes
- Attachments lack `file_size`

**Check:**
```sql
-- Count attachments by status
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN file_data IS NOT NULL THEN 1 ELSE 0 END) as have_data,
  SUM(CASE WHEN file_size IS NULL THEN 1 ELSE 0 END) as no_size,
  SUM(CASE WHEN file_hash_sha256 IS NULL AND file_hash_sha224 IS NULL THEN 1 ELSE 0 END) as no_hash
FROM attachments;
```

### "Hash mismatch"

File was found but doesn't match expected hash. Could indicate:
- Wrong file (different version)
- Corrupted download
- Incorrect hash in database

### IPFS timeouts

IPFS gateways can be slow or unavailable. Try:
- Different gateway: `--ipfsgateway=https://gateway.pinata.cloud`
- Increase delay: `--fetchdelay=5000`
- Smaller batches: `--searchmax=5`

## Security

### Hash Verification

- **Always uses** SHA-256 (primary) or SHA-224 (secondary)
- **Never uses** weak hashes (MD5, SHA-1, CRC) for verification
- **Rejects** files that don't match expected hash

### Safe Defaults

- **Maximum file size**: 200MB (prevent huge downloads)
- **Delay between requests**: 1000ms (prevent server overload)
- **No automatic execution**: Requires explicit mode/options

## Examples

### Search local and IPFS:
```bash
node fetchpatches.js mode2 --searchmax=10 --searchipfs
```

### Search custom path only:
```bash
node fetchpatches.js mode2 --nosearchlocal --searchlocalpath=/backup
```

### Thorough local search:
```bash
node fetchpatches.js mode2 --ignorefilename --maxfilesize=1GB --searchmax=5
```

### Network-only search:
```bash
node fetchpatches.js mode2 --nosearchlocal --searchipfs --download
```

## Related Documentation

- `FETCHPATCHES_README.md` - Main documentation
- `FETCHPATCHES_PARAMETERS.md` - General parameters
- `FETCHPATCHES_ADDSIZES.md` - addsizes mode
- `electron/sql/patchbin.sql` - Database schema

