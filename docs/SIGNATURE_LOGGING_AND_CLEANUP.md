# Signature Logging and Cleanup System

## Overview

The signature system now includes comprehensive logging and automatic cleanup of outdated signatures, with proper file_data exclusion.

## Key Features

### 1. file_data Exclusion

**Critical Security Rule:** `file_data` is NEVER included in signatures or logs.

**Why:**
- File integrity is protected by `file_hash_sha256`
- Signatures verify metadata, hashes verify file content
- Prevents massive log files (file_data can be megabytes)
- Clients must independently verify file hashes

**Excluded from signatures:**
- `file_data` (attachments table)
- `pblobdata` (patchblobs table)
- All timestamp fields
- `siglistuuid` itself

**Excluded from logs:**
- `file_data` is removed from record snapshots
- Binary fields converted to hex (if any remain)

### 2. New Signature Logging

Every new signature is logged to `log_mdsign_new.json`:

```json
{
  "timestamp": "2025-10-11T15:30:00.000Z",
  "action": "new_signature",
  "table": "attachments",
  "record_uuid": "abc-123-def-456",
  "row_version": 2,
  "siglistuuid": "siglist-uuid",
  "signeruuid": "signer-uuid",
  "signature_algorithm": "ED25519",
  "signed_action": "upsert",
  "signature": "hex-signature...",
  "record_snapshot": {
    "auuid": "abc-123-def-456",
    "file_name": "pblob_12345.bin",
    "file_hash_sha256": "hash...",
    "file_size": 123456,
    "row_version": 2
    // file_data EXCLUDED
  }
}
```

**Purpose:**
- Audit trail of all signatures created
- Record snapshot at time of signing
- Debugging signature issues
- Compliance and security monitoring

### 3. Historical Signature Archival

Outdated signatures archived to `log_mdsign_historical.json`:

```json
{
  "timestamp": "2025-10-11T15:35:00.000Z",
  "action": "archive_outdated",
  "reason": "row_version_mismatch",
  "table": "attachments",
  "record_uuid": "abc-123-def-456",
  "old_signaturelist": {
    "siglistuuid": "old-siglist",
    "signed_row_version": 1,
    "created_at": "2025-10-11T14:00:00.000Z"
  },
  "old_signatures": [
    {
      "signature": "old-hex-signature...",
      "signeruuid": "signer-uuid",
      "signer_name": "Admin Signer",
      "signed_at": "2025-10-11T14:00:00.000Z"
    }
  ],
  "current_version": 2,
  "archived_at": "2025-10-11T15:35:00.000Z"
}
```

**Archived when:**
- Row version incremented (old signatures outdated)
- Explicit cleanup run
- Automatic during re-signing

### 4. Automatic Cleanup

Orphaned signatures are automatically archived when:

**During re-signing:**
- Detects version mismatch
- Archives old signatures to historical log
- Deletes old signaturelist and entries
- Creates new signaturelist for current version

**Manual cleanup:**
```bash
npm run mdserver:cleanup-signatures
```

Finds and cleans:
- Orphaned (record deleted)
- Not referenced (siglistuuid doesn't match)
- Outdated (version mismatch)

## Usage

### Sign with Automatic Logging

```bash
# Sign single record
node mdserver/sign_metadata.js \
  --table=attachments \
  --record=abc-123 \
  --keyfile=signer.txt

# Output:
#   ✓ Signature generated
#   ✓ Created new signature entry
#   ✓ Logged to log_mdsign_new.json
```

### Sign All (Batch)

```bash
# Sign all unsigned or outdated records
node mdserver/sign_metadata.js \
  --table=attachments \
  --all \
  --keyfile=signer.txt

# Each signature logged to log_mdsign_new.json
```

### Cleanup Orphaned

```bash
# Preview what would be cleaned
npm run mdserver:cleanup-signatures -- --dry-run

# Actually cleanup
npm run mdserver:cleanup-signatures

# Output:
#   Found 5 orphaned/outdated signaturelist(s)
#   Breakdown by reason:
#     row_version_mismatch: 3
#     record_deleted: 2
#   Total orphaned:       5
#   Archived to log:      5
#   Deleted from database: 5
```

## File Locations

**Log Files:**
- `mdserver/log_mdsign_new.json` - New signatures
- `mdserver/log_mdsign_historical.json` - Archived/outdated signatures

**Databases:**
- `mdserver/patchbin.db` - signaturelists, signaturelistentries
- `mdserver/rhdata.db` - gameversions, patchblobs, rhpatches

## Log Management

### View Recent Signatures

```bash
# Last 5 new signatures
cat mdserver/log_mdsign_new.json | python3 -m json.tool | tail -100

# Last 5 archived signatures
cat mdserver/log_mdsign_historical.json | python3 -m json.tool | tail -100
```

### Count Signatures

```bash
# Count new signatures
cat mdserver/log_mdsign_new.json | python3 -c "import sys,json; print(len(json.load(sys.stdin)))"

# Count archived
cat mdserver/log_mdsign_historical.json | python3 -c "import sys,json; print(len(json.load(sys.stdin)))"
```

### Rotate Logs

```bash
# Backup and rotate (do periodically)
cd mdserver
mv log_mdsign_new.json log_mdsign_new_$(date +%Y%m%d).json.bak
mv log_mdsign_historical.json log_mdsign_historical_$(date +%Y%m%d).json.bak
touch log_mdsign_new.json
echo '[]' > log_mdsign_new.json
echo '[]' > log_mdsign_historical.json
```

## Client Validation (fetchpatches.js)

### file_data Hash Verification

**Implementation needed in fetchpatches.js:**

```javascript
/**
 * Verify file_data hash and invalidate if mismatch
 */
function validateFileData(db, auuid) {
  const attachment = db.prepare(`
    SELECT file_data, file_hash_sha256, file_name
    FROM attachments
    WHERE auuid = ?
  `).get(auuid);
  
  if (!attachment.file_data) {
    return { valid: null, reason: 'no_file_data' };
  }
  
  const actualHash = crypto.createHash('sha256')
    .update(attachment.file_data)
    .digest('hex');
  
  if (actualHash !== attachment.file_hash_sha256) {
    // INVALIDATE corrupted file_data
    db.prepare('UPDATE attachments SET file_data = NULL WHERE auuid = ?')
      .run(auuid);
    
    console.error(`Invalidated corrupted file_data: ${attachment.file_name}`);
    console.error(`  Expected: ${attachment.file_hash_sha256}`);
    console.error(`  Got:      ${actualHash}`);
    
    return { valid: false, reason: 'hash_mismatch' };
  }
  
  return { valid: true };
}
```

**Call after:**
- Downloading file from any source
- Loading file_data from database (periodic check)
- Receiving file from API server
- Any operation that writes file_data

## NPM Scripts

```bash
# Signing
npm run mdserver:sign-metadata -- --table=TABLE --record=UUID --keyfile=KEY.txt
npm run mdserver:sign-metadata -- --table=TABLE --all --keyfile=KEY.txt

# Cleanup
npm run mdserver:cleanup-signatures           # Actual cleanup
npm run mdserver:cleanup-signatures -- --dry-run  # Preview only

# Migration
npm run mdserver:migrate-signatures           # Add columns if needed
```

## Security Benefits

### Logging

- **Audit trail** of all signature operations
- **Forensic analysis** if issues arise
- **Compliance** requirements met
- **Debugging** signature problems

### Cleanup

- **Prevents database bloat** from orphaned records
- **Maintains integrity** by removing outdated signatures
- **Archives history** for audit purposes
- **Automated** during re-signing

### file_data Exclusion

- **Efficient** signatures and logs
- **Clear separation** of concerns (hash vs signature)
- **Client-side validation** enforced
- **Corruption detection** at client side

## Status

✅ **file_data Exclusion:** Implemented in signing and logging  
✅ **New Signature Logging:** Implemented with record snapshots  
✅ **Historical Archival:** Implemented during re-signing  
✅ **Cleanup Tool:** Implemented with dry-run support  
✅ **Log Management:** .gitignore updated  
✅ **Documentation:** Complete  

**Next:** Implement client-side validation in fetchpatches.js

## Related Documentation

- `FILE_DATA_VALIDATION.md` - Client validation requirements
- `ROW_VERSIONING_AND_SIGNATURES.md` - Overall signature system
- `mdserver/SIGNATURES_GUIDE.md` - Signature creation guide
- `FETCHPATCHES_MODE2_SPEC_UPDATED.txt` - Updated specification

