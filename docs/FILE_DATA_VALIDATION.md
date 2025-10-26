# file_data Validation and Integrity

## Critical Security Rule

**file_data is NEVER included in digital signatures.**

The `file_hash_sha256` field in the attachments table provides cryptographic integrity for `file_data`. Clients MUST independently verify file_data matches the expected hash.

## Why file_data is Not Signed

1. **Size:** Binary file data can be megabytes, signing would be expensive
2. **Redundancy:** `file_hash_sha256` already provides cryptographic integrity
3. **Flexibility:** File data can be fetched from multiple sources (local, IPFS, ArDrive)
4. **Signature Focus:** Signatures verify metadata authenticity, not file content

## Client Validation Requirements

### MUST Verify file_data Hash

Whenever a client has `file_data` for an attachment record:

```javascript
const crypto = require('crypto');

// Calculate SHA-256 hash of file_data
const actualHash = crypto.createHash('sha256')
  .update(attachment.file_data)
  .digest('hex');

// Compare with expected hash from metadata
const expectedHash = attachment.file_hash_sha256;

if (actualHash !== expectedHash) {
  console.error(`file_data hash mismatch for ${attachment.file_name}`);
  console.error(`  Expected: ${expectedHash}`);
  console.error(`  Actual:   ${actualHash}`);
  
  // SET file_data TO NULL - data is INVALID
  db.prepare('UPDATE attachments SET file_data = NULL WHERE auuid = ?')
    .run(attachment.auuid);
  
  console.log('  ✗ file_data invalidated and set to NULL');
}
```

### When to Validate

**Always validate when:**
- Receiving file_data from server API
- Loading file_data from local database
- Downloading file from IPFS/ArDrive
- Reading file from local filesystem
- Receiving file_data in any form

**Validation frequency:**
- On first load: Always
- Periodic: Optional but recommended
- Before use: Critical operations only
- After corruption suspicion: Always

## Canonical String Exclusions

The signing process explicitly excludes:

```javascript
// In createCanonicalString():
if (key === 'file_data') return false;      // EXCLUDED
if (key === 'pblobdata') return false;      // EXCLUDED (binary in patchblobs)
if (key === 'siglistuuid') return false;    // EXCLUDED (signature field)
if (key.includes('signature')) return false; // EXCLUDED
if (key.includes('import_time')) return false; // EXCLUDED (mutable)
if (key.includes('updated_time')) return false; // EXCLUDED (mutable)
```

### What IS Signed

The signature covers:
- ✅ `file_hash_sha256` (this protects file_data)
- ✅ `file_hash_sha224` (additional integrity)
- ✅ `file_hash_md5`, `file_hash_sha1` (legacy hashes)
- ✅ `file_name` (filename)
- ✅ `file_size` (expected size)
- ✅ `file_ipfs_cidv0`, `file_ipfs_cidv1` (IPFS identifiers)
- ✅ All other metadata fields

## Server Response Handling

### Binary File Response

```http
Content-Type: application/octet-stream
X-File-Name: pblob_12345.bin
X-File-Size: 123456
X-Signature-List-UUID: siglist-uuid (optional)

<binary file data>
```

**Client must:**
1. Read binary data
2. Calculate SHA-256 hash
3. Query local database for expected hash
4. Verify hash matches
5. If mismatch: Discard data, do not store

### JSON Metadata Response

```json
{
  "data": {
    "auuid": "abc-123",
    "file_hash_sha256": "expected-hash",
    "file_ipfs_cidv1": "bafyxxx",
    ...
  },
  "mdsignatures": {...},
  "server_signature": {...}
}
```

**Client must:**
1. Verify server_signature (REQUIRED)
2. Verify mdsignatures (for storing updates)
3. Note: file_data not in response (must fetch separately)
4. When file_data is fetched, verify hash

## Hash Mismatch Scenarios

### Scenario 1: Downloaded file doesn't match

```
Download from IPFS: bafyxxx
Calculate hash: abc123def456...
Expected hash:  789ghi012jkl...
```

**Action:**
- Do not store file_data
- Do not update database
- Try alternative source (ArDrive, different IPFS gateway)
- Log the mismatch

### Scenario 2: Database file_data corrupted

```
Load from database
Calculate hash: corrupted_hash
Expected hash:  correct_hash
```

**Action:**
- Set file_data = NULL
- Update last_search = NULL (mark for re-fetch)
- Log corruption event
- Alert user/admin

### Scenario 3: Server sends wrong file

```
Server returns binary file
Calculate hash: server_hash
Expected hash:  different_hash
```

**Action:**
- Reject file
- Do not store
- Log incident
- Consider adding server to donotsearch (if repeated)

## Implementation in fetchpatches.js

### Mode 2: After downloading file

```javascript
// After downloading from any source
const fileData = await downloadFile(source);

// Calculate hash
const actualHash = crypto.createHash('sha256')
  .update(fileData)
  .digest('hex');

// Verify
if (actualHash !== attachment.file_hash_sha256) {
  console.error(`Hash mismatch for ${attachment.file_name}`);
  console.error(`  Source: ${source}`);
  console.error(`  Expected: ${attachment.file_hash_sha256}`);
  console.error(`  Got:      ${actualHash}`);
  
  // Do not store invalid data
  return null;
}

// Hash verified - safe to store
db.prepare('UPDATE attachments SET file_data = ? WHERE auuid = ?')
  .run(fileData, attachment.auuid);
```

### Option G: From API server

```javascript
// Binary response
if (response.headers['content-type'] === 'application/octet-stream') {
  const fileData = response.body;
  const fileName = response.headers['x-file-name'];
  
  // Get expected hash from local database
  const attachment = db.prepare(`
    SELECT file_hash_sha256 FROM attachments WHERE file_name = ?
  `).get(fileName);
  
  // Verify hash
  const actualHash = crypto.createHash('sha256')
    .update(fileData)
    .digest('hex');
  
  if (actualHash !== attachment.file_hash_sha256) {
    console.error(`Server sent file with invalid hash`);
    // Do not store
    return null;
  }
  
  // Verified - store
  db.prepare('UPDATE attachments SET file_data = ? WHERE file_name = ?')
    .run(fileData, fileName);
}
```

### Periodic Validation (Optional)

```javascript
// Validate all file_data in database
const attachments = db.prepare(`
  SELECT auuid, file_name, file_data, file_hash_sha256 
  FROM attachments 
  WHERE file_data IS NOT NULL
`).all();

let corrupted = 0;

for (const attachment of attachments) {
  const actualHash = crypto.createHash('sha256')
    .update(attachment.file_data)
    .digest('hex');
  
  if (actualHash !== attachment.file_hash_sha256) {
    console.error(`Corrupted: ${attachment.file_name}`);
    
    // Invalidate
    db.prepare('UPDATE attachments SET file_data = NULL WHERE auuid = ?')
      .run(attachment.auuid);
    
    corrupted++;
  }
}

console.log(`Found and invalidated ${corrupted} corrupted file(s)`);
```

## Signature Logging

### New Signatures (log_mdsign_new.json)

Every new signature is logged:

```json
[
  {
    "timestamp": "2025-10-11T15:00:00.000Z",
    "action": "new_signature",
    "table": "attachments",
    "record_uuid": "abc-123",
    "row_version": 2,
    "siglistuuid": "siglist-new",
    "signeruuid": "signer-uuid",
    "signature_algorithm": "ED25519",
    "signed_action": "upsert",
    "signature": "hex-signature...",
    "record_snapshot": {
      "auuid": "abc-123",
      "file_name": "test.bin",
      "file_hash_sha256": "hash...",
      "row_version": 2
      // Note: file_data EXCLUDED from snapshot
    }
  }
]
```

### Historical Signatures (log_mdsign_historical.json)

Outdated signatures are archived:

```json
[
  {
    "timestamp": "2025-10-11T15:05:00.000Z",
    "action": "archive_outdated",
    "reason": "row_version_mismatch",
    "table": "attachments",
    "record_uuid": "abc-123",
    "old_signaturelist": {
      "siglistuuid": "old-siglist",
      "signed_row_version": 1
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
    "archived_at": "2025-10-11T15:05:00.000Z"
  }
]
```

## Cleanup Operations

### Find Orphaned Signatures

```bash
# Dry run (see what would be cleaned)
npm run mdserver:cleanup-signatures -- --dry-run

# Actual cleanup
npm run mdserver:cleanup-signatures
```

**Finds and archives:**
- Signaturelists not referenced by any record (record deleted)
- Signaturelists with outdated versions (row_version mismatch)
- Signaturelists for unknown tables
- Orphaned signaturelistentries

**Archives to:** `log_mdsign_historical.json`

## Best Practices

### For Clients

1. **Always validate file_data hash** before storing
2. **Set file_data = NULL** if hash mismatch
3. **Log validation failures** for debugging
4. **Re-fetch corrupted files** from reliable sources
5. **Periodic integrity checks** (optional but recommended)

### For Servers

1. **Never send file_data** without clients being able to verify hash
2. **Include file_hash_sha256** in metadata
3. **Sign metadata** but not file_data
4. **Log all signature operations** to JSON files
5. **Regular cleanup** of orphaned signatures

### For Admins

1. **Monitor signature logs** for unusual activity
2. **Regular cleanup** (`npm run mdserver:cleanup-signatures`)
3. **Backup log files** before cleanup
4. **Review historical logs** for audit trails
5. **Rotate logs** periodically to manage size

## Security Implications

### Hash Provides Integrity

- **SHA-256** is cryptographically secure
- **Collision resistance:** Practically impossible to find two files with same hash
- **Pre-image resistance:** Cannot generate file from hash
- **Verification:** Simple and fast

### Signature Provides Authenticity

- **Proves** metadata came from trusted signer
- **Doesn't prove** file content (hash does that)
- **Complements** hash verification
- **Together:** Complete integrity and authenticity

## Example Validation Flow

```
┌─────────────────────────────────────┐
│ Receive attachment metadata        │
│ (includes file_hash_sha256)        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Verify metadata signature          │
│ (if present and storing updates)   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Fetch file_data from source        │
│ (IPFS, ArDrive, API, local)        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Calculate SHA-256 of file_data     │
└──────────────┬──────────────────────┘
               │
               ▼
      ┌────────────────┐
      │ Hash matches?  │
      └───┬────────┬───┘
          │        │
        Yes        No
          │        │
          ▼        ▼
    ┌─────────┐ ┌──────────────────┐
    │ Store   │ │ Reject & set     │
    │ file_data│ │ file_data = NULL │
    └─────────┘ └──────────────────┘
```

## Tools Reference

### Sign with Logging

```bash
# Signs record and logs to log_mdsign_new.json
node mdserver/sign_metadata.js \
  --table=attachments \
  --record=abc-123 \
  --keyfile=signer.txt
```

### Batch Sign with Logging

```bash
# Signs all unsigned/outdated, logs each to log_mdsign_new.json
node mdserver/sign_metadata.js \
  --table=attachments \
  --all \
  --keyfile=signer.txt
```

### Cleanup Outdated

```bash
# Archives to log_mdsign_historical.json and deletes from database
npm run mdserver:cleanup-signatures

# Dry run to preview
npm run mdserver:cleanup-signatures -- --dry-run
```

## Conclusion

**file_data integrity is protected by SHA-256 hashes, not signatures.**

Clients MUST:
- ✅ Verify file_data hash independently
- ✅ Set file_data = NULL if hash mismatch
- ✅ Never trust file_data without hash verification
- ✅ Use file_hash_sha256 from signed metadata

This provides strong security:
- Metadata authenticity via signatures
- File integrity via hashes
- Independent verification at each step

