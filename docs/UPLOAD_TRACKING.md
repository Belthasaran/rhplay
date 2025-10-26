# Upload Tracking System Documentation

**Date**: October 12, 2025  
**Scripts**: `list-unuploaded-blobs.js`, `mark-upload-done.js`  
**Database**: `patchbin.db` (upload_status table)

---

## Overview

The upload tracking system helps manage blob file uploads to multiple cloud storage providers (IPFS, Arweave, ArDrive, etc.) by:

1. **Tracking upload status** across multiple providers independently
2. **Listing unuploaded files** efficiently  
3. **Avoiding re-uploads** of already-uploaded files
4. **Creating archives** of files that need uploading
5. **Verifying availability** on IPFS gateways
6. **Maintaining metadata** like CIDs, transaction IDs, and file IDs

---

## Database Schema

### upload_status Table

Located in: `electron/patchbin.db`

**Auto-created** by scripts on first run.

```sql
CREATE TABLE IF NOT EXISTS upload_status (
  file_name TEXT PRIMARY KEY,           -- Blob file name (pblob_* or rblob_*)
  
  -- Upload flags (0 = not uploaded, 1 = uploaded)
  uploaded_ipfs INTEGER DEFAULT 0,
  uploaded_arweave INTEGER DEFAULT 0,
  uploaded_ardrive INTEGER DEFAULT 0,
  
  -- Upload timestamps
  ipfs_uploaded_time TIMESTAMP NULL,
  arweave_uploaded_time TIMESTAMP NULL,
  ardrive_uploaded_time TIMESTAMP NULL,
  
  -- Provider-specific identifiers
  ipfs_cid TEXT NULL,                   -- IPFS Content Identifier (CIDv1)
  arweave_txid TEXT NULL,               -- Arweave transaction ID
  ardrive_file_id TEXT NULL,            -- ArDrive file ID
  
  -- Extensibility
  notes TEXT NULL,                      -- Additional metadata or custom providers
  
  -- Audit trail
  created_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Design Principles

1. **Independence**: Each provider has its own flag, timestamp, and metadata
2. **Extensibility**: New providers can be added via additional columns
3. **Custom providers**: Use `notes` field for non-standard providers
4. **Upsert support**: ON CONFLICT clause enables idempotent updates

---

## list-unuploaded-blobs.js

### Purpose
Lists blob files that haven't been uploaded to specified provider(s).

### Basic Usage

```bash
# List files not uploaded to Arweave (default)
node list-unuploaded-blobs.js

# List files not uploaded to IPFS
node list-unuploaded-blobs.js --provider=ipfs

# List files not uploaded to ArDrive
node list-unuploaded-blobs.js --provider=ardrive

# Show all providers' status
node list-unuploaded-blobs.js --provider=all --verbose
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--provider=<name>` | Provider to check (ipfs, arweave, ardrive, all) | arweave |
| `--create-archive` | Create ZIP of unuploaded files | false |
| `--archive-name=<name>` | Name for archive file | unuploaded-blobs.zip |
| `--scan-ardrive=<folder>` | Scan ArDrive folder, exclude uploaded | - |
| `--scan-ipfs` | Check IPFS gateways for CIDv1 | false |
| `--ipfs-gateway=<url>` | IPFS gateway to check | https://ipfs.io |
| `--output=<file>` | Save list to file instead of stdout | - |
| `--verbose, -v` | Show detailed information | false |

### Examples

#### List Unuploaded Files

```bash
# Simple list (to Arweave)
node list-unuploaded-blobs.js > unuploaded_arweave.txt

# List for IPFS with verbose output
node list-unuploaded-blobs.js --provider=ipfs --verbose

# Save to file
node list-unuploaded-blobs.js --provider=ipfs --output=ipfs_todo.txt
```

#### Create Upload Archive

```bash
# Create ZIP of files needing Arweave upload
node list-unuploaded-blobs.js --create-archive --archive-name=arweave_batch1.zip

# Create ZIP for IPFS upload
node list-unuploaded-blobs.js --provider=ipfs --create-archive
```

#### Check IPFS Availability

```bash
# Check if files are actually on IPFS (using decoded_ipfs_cidv1)
node list-unuploaded-blobs.js --provider=ipfs --scan-ipfs --verbose

# Use custom IPFS gateway
node list-unuploaded-blobs.js \
  --provider=ipfs \
  --scan-ipfs \
  --ipfs-gateway=https://dweb.link

# Only list files NOT found on IPFS
node list-unuploaded-blobs.js --provider=ipfs --scan-ipfs > truly_missing.txt
```

#### Show All Provider Status

```bash
# Verbose output showing all providers
node list-unuploaded-blobs.js --provider=all --verbose | head -50
```

### Output Format

**Standard output** (one file per line):
```
pblob_40663_60a76bf9c7
pblob_40663_29346ea804
pblob_40663_ba6b76e954
```

**Verbose output**:
```
======================================================================
UNUPLOADED BLOBS SCANNER
======================================================================
Provider: ipfs
Scan IPFS: true
Create Archive: false

✓ Upload status table verified
Querying unuploaded blobs...
Found 1234 potentially unuploaded blobs

Checking IPFS gateway availability...
[1/1234] Checking pblob_123.bin...
  ✓ Available on IPFS: bafk...

After IPFS check: 1200 blobs need uploading

======================================================================
Total unuploaded blobs: 1200
======================================================================
```

---

## mark-upload-done.js

### Purpose
Marks blob files as uploaded to a specific provider.

### Basic Usage

```bash
# Mark specific files
node mark-upload-done.js --provider=ipfs pblob_123.bin pblob_456.bin

# Mark from list file
node mark-upload-done.js --provider=arweave --file=uploaded.txt

# Mark from stdin
cat uploaded.txt | node mark-upload-done.js --provider=ipfs --stdin

# Dry run (preview without changes)
node mark-upload-done.js --provider=ipfs --file=list.txt --dry-run
```

### Options

| Option | Description | Required |
|--------|-------------|----------|
| `--provider=<name>` | Provider name (ipfs, arweave, ardrive, custom) | Yes |
| `--file=<path>` | Read file names from file (one per line) | No |
| `--stdin` | Read file names from stdin | No |
| `--txid=<id>` | Arweave transaction ID | No |
| `--cid=<cid>` | IPFS Content Identifier | No |
| `--file-id=<id>` | ArDrive file ID | No |
| `--dry-run` | Show what would be marked without updating | No |
| `--verbose, -v` | Show detailed information | No |

### Examples

#### Mark from Command Line

```bash
# Mark single file
node mark-upload-done.js --provider=ipfs pblob_40663_60a76bf9c7

# Mark multiple files
node mark-upload-done.js --provider=arweave \
  pblob_123.bin pblob_456.bin pblob_789.bin

# With metadata
node mark-upload-done.js \
  --provider=arweave \
  --txid=abc123xyz \
  pblob_40663_60a76bf9c7
```

#### Mark from File

```bash
# Create list file
node list-unuploaded-blobs.js --provider=ipfs > to_upload.txt

# ... upload files ...

# Mark them all as uploaded
node mark-upload-done.js --provider=ipfs --file=to_upload.txt
```

#### Mark from Stdin

```bash
# From pipe
node list-unuploaded-blobs.js --provider=ipfs | head -10 | \
  node mark-upload-done.js --provider=ipfs --stdin

# From here-doc
cat <<EOF | node mark-upload-done.js --provider=ipfs --stdin
pblob_123.bin
pblob_456.bin
pblob_789.bin
EOF
```

#### Dry Run

```bash
# Preview what would be marked
node mark-upload-done.js \
  --provider=ipfs \
  --file=uploaded.txt \
  --dry-run

# Output:
# DRY RUN - No changes will be made
# 
# Would mark the following files as uploaded to ipfs:
#   - pblob_123.bin
#   - pblob_456.bin
```

### Output Format

```
======================================================================
RESULTS
======================================================================
Total processed: 150
✓ Marked as uploaded: 150
  - New records: 120
  - Updated records: 30
✗ Errors: 0
======================================================================
```

With errors:
```
======================================================================
RESULTS
======================================================================
Total processed: 150
✓ Marked as uploaded: 148
  - New records: 118
  - Updated records: 30
✗ Errors: 2

Failed files:
  - pblob_invalid.bin: no such file
  - pblob_corrupt.bin: database locked
======================================================================
```

---

## Complete Workflow Examples

### Workflow 1: Initial IPFS Upload

```bash
# 1. List files needing upload
node list-unuploaded-blobs.js --provider=ipfs --output=ipfs_todo.txt

# 2. Create archive for upload
node list-unuploaded-blobs.js --provider=ipfs --create-archive --archive-name=ipfs_batch1.zip

# 3. Upload to IPFS (external tool)
ipfs add -r unzipped_files/

# 4. Mark files as uploaded
node mark-upload-done.js --provider=ipfs --file=ipfs_todo.txt

# 5. Verify
node list-unuploaded-blobs.js --provider=ipfs --verbose
```

### Workflow 2: Arweave Upload with Transaction ID

```bash
# 1. List unuploaded files
node list-unuploaded-blobs.js --provider=arweave > arweave_batch.txt

# 2. Upload and get transaction ID
# ardrive upload-file --parent-folder-id=XYZ --local-path=file.bin
# Returns: Transaction ID: abc123xyz

# 3. Mark with transaction ID
node mark-upload-done.js \
  --provider=arweave \
  --txid=abc123xyz \
  pblob_40663_60a76bf9c7

# 4. Bulk mark remaining files
node mark-upload-done.js --provider=arweave --file=arweave_batch.txt
```

### Workflow 3: Verify IPFS Before Upload

```bash
# 1. List files marked as not uploaded
node list-unuploaded-blobs.js --provider=ipfs --output=ipfs_unchecked.txt

# 2. Check which are actually on IPFS already
node list-unuploaded-blobs.js \
  --provider=ipfs \
  --scan-ipfs \
  --verbose \
  --output=truly_missing.txt

# 3. Only upload the truly missing files
# (upload truly_missing.txt files)

# 4. Mark all as uploaded (including ones already on IPFS)
node mark-upload-done.js --provider=ipfs --file=ipfs_unchecked.txt
```

### Workflow 4: Multi-Provider Upload

```bash
# 1. Check all providers' status
node list-unuploaded-blobs.js --provider=all --verbose | tee status.log

# 2. Upload to IPFS
node list-unuploaded-blobs.js --provider=ipfs > ipfs_files.txt
# ... upload to IPFS ...
node mark-upload-done.js --provider=ipfs --file=ipfs_files.txt

# 3. Upload to Arweave
node list-unuploaded-blobs.js --provider=arweave > arweave_files.txt
# ... upload to Arweave ...
node mark-upload-done.js --provider=arweave --file=arweave_files.txt

# 4. Upload to ArDrive
node list-unuploaded-blobs.js --provider=ardrive > ardrive_files.txt
# ... upload to ArDrive ...
node mark-upload-done.js --provider=ardrive --file=ardrive_files.txt

# 5. Final status check
node list-unuploaded-blobs.js --provider=all --verbose
```

---

## Querying Upload Status

### SQL Queries

```bash
# Check upload status for specific file
sqlite3 electron/patchbin.db << 'EOF'
SELECT * FROM upload_status 
WHERE file_name = 'pblob_40663_60a76bf9c7';
EOF

# Count uploads by provider
sqlite3 electron/patchbin.db << 'EOF'
SELECT 
  SUM(uploaded_ipfs) as ipfs_count,
  SUM(uploaded_arweave) as arweave_count,
  SUM(uploaded_ardrive) as ardrive_count,
  COUNT(*) as total
FROM upload_status;
EOF

# Find files uploaded to all providers
sqlite3 electron/patchbin.db << 'EOF'
SELECT file_name 
FROM upload_status 
WHERE uploaded_ipfs = 1 
  AND uploaded_arweave = 1 
  AND uploaded_ardrive = 1;
EOF

# Find files only on IPFS
sqlite3 electron/patchbin.db << 'EOF'
SELECT file_name 
FROM upload_status 
WHERE uploaded_ipfs = 1 
  AND (uploaded_arweave = 0 OR uploaded_arweave IS NULL);
EOF

# Recent uploads
sqlite3 electron/patchbin.db << 'EOF'
SELECT 
  file_name,
  uploaded_ipfs,
  ipfs_uploaded_time,
  uploaded_arweave,
  arweave_uploaded_time
FROM upload_status 
WHERE updated_time >= datetime('now', '-7 days')
ORDER BY updated_time DESC;
EOF
```

---

## Integration with Other Tools

### With updategames.js

```bash
# After running updategames for new games
node updategames.js --game-ids=40663,40664 --all-patches

# Find newly created blobs
node list-unuploaded-blobs.js --provider=all --verbose

# Upload new blobs
# ...

# Mark as uploaded
node mark-upload-done.js --provider=ipfs --file=new_blobs.txt
```

### With ardrive-cli

```bash
# List files for ArDrive
node list-unuploaded-blobs.js \
  --provider=ardrive \
  --create-archive \
  --archive-name=ardrive_batch.zip

# Upload with ardrive-cli
ardrive upload-file \
  --parent-folder-id=YOUR_FOLDER_ID \
  --local-path=ardrive_batch.zip

# Mark files as uploaded
unzip -l ardrive_batch.zip | awk '{print $4}' | \
  node mark-upload-done.js --provider=ardrive --stdin --file-id=FILE_ID
```

### With IPFS CLI

```bash
# Create archive
node list-unuploaded-blobs.js \
  --provider=ipfs \
  --create-archive \
  --archive-name=ipfs_batch.zip

# Extract and upload
unzip ipfs_batch.zip -d /tmp/ipfs_upload
ipfs add -r /tmp/ipfs_upload

# Mark as uploaded (assuming files have decoded_ipfs_cidv1)
node mark-upload-done.js \
  --provider=ipfs \
  --file=ipfs_batch_list.txt
```

---

## Troubleshooting

### "No files listed" but files exist

**Cause**: Files already marked as uploaded

**Solution**:
```bash
# Check upload status
sqlite3 electron/patchbin.db \
  "SELECT * FROM upload_status WHERE file_name = 'pblob_XYZ';"

# Reset if needed (CAUTION!)
sqlite3 electron/patchbin.db \
  "UPDATE upload_status SET uploaded_ipfs = 0 WHERE file_name = 'pblob_XYZ';"
```

### "Archive creation failed"

**Cause**: Blob files missing from `blobs/` directory

**Solution**:
```bash
# Verify blobs exist
node verify-all-blobs.js --verify-blobs=files

# If missing, check database
node verify-all-blobs.js --verify-blobs=db

# Recreate missing files from database
sqlite3 electron/patchbin.db << 'EOF'
SELECT writefile('blobs/' || file_name, file_data) 
FROM attachments 
WHERE file_name = 'pblob_XYZ';
EOF
```

### "IPFS check timeout"

**Cause**: Gateway slow or file not pinned

**Solution**:
```bash
# Use different gateway
node list-unuploaded-blobs.js \
  --provider=ipfs \
  --scan-ipfs \
  --ipfs-gateway=https://cloudflare-ipfs.com

# Or skip IPFS check
node list-unuploaded-blobs.js --provider=ipfs
```

---

## Best Practices

### 1. Regular Backups
```bash
# Backup upload status before bulk operations
cp electron/patchbin.db electron/patchbin.db.backup-$(date +%Y%m%d)
```

### 2. Dry Run First
```bash
# Always test with --dry-run
node mark-upload-done.js --provider=ipfs --file=big_list.txt --dry-run
```

### 3. Small Batches
```bash
# Process in batches for large uploads
node list-unuploaded-blobs.js --provider=ipfs | head -100 > batch1.txt
node list-unuploaded-blobs.js --provider=ipfs | head -200 | tail -100 > batch2.txt
```

### 4. Verify After Upload
```bash
# After marking as uploaded, verify with IPFS check
node list-unuploaded-blobs.js --provider=ipfs --scan-ipfs
```

### 5. Audit Trail
```bash
# Log all operations
node list-unuploaded-blobs.js --provider=ipfs --verbose 2>&1 | \
  tee upload_audit_$(date +%Y%m%d).log
```

---

## Performance

### Listing Performance
- ~0.5-1 second for 3,000 blobs
- No expensive computations
- Simple database queries

### Archive Creation
- Depends on file sizes
- ~5-10 seconds for 100 files (100MB total)
- Memory efficient (streaming)

### IPFS Checking
- **Slow**: 5 seconds per file (gateway timeout)
- Recommended: Use in batches
- Recommended: Only for critical files

---

## See Also

- `docs/PROGRAMS.MD` - Complete programs list
- `docs/SCHEMACHANGES.md` - Database schema documentation
- `docs/DBMIGRATE.md` - Migration commands
- `docs/VERIFICATION_TOOLS.md` - Blob verification tools

---

*Last Updated: October 12, 2025*  
*Scripts Version: 1.0*

