# Row Versioning and Signature System

## Overview

The metadata system now supports **row versioning** with digital signatures to track changes to metadata records and ensure data integrity.

## Key Concepts

### Row Versioning

Each signed table has a `row_version` column:
- **Initial value:** 1
- **Increments:** When legitimate in-place changes invalidate existing signatures
- **Purpose:** Track which version of a record was signed

### Signature Lists

Each signed record can have a `siglistuuid` that links to:
- **signaturelists table:** Metadata about the signature
  - Which version was signed (`signed_row_version`)
  - What action to take (`signed_action`: upsert/delete)
  - When it was signed (`signlist_timestamp`)
  
- **signaturelistentries table:** Actual signatures
  - Multiple signers per record supported
  - One signature per signer per record
  - Includes algorithm, hash type, timestamp

## Database Schema

### Row Version Columns

Added to all signed tables:

```sql
-- Attachments, GameVersions, PatchBlobs, RhPatches, Signers
ALTER TABLE <table> ADD COLUMN row_version INTEGER DEFAULT 1;
ALTER TABLE <table> ADD COLUMN siglistuuid VARCHAR(255);
```

### Enhanced signaturelists Table

```sql
CREATE TABLE signaturelists (
  siglistuuid VARCHAR(255) PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  signlist_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  record_type VARCHAR(255),              -- Table name
  record_uuid VARCHAR(255),              -- Record UUID
  signed_row_version INTEGER DEFAULT 1,  -- Which version was signed
  signed_action VARCHAR(255) DEFAULT 'upsert'  -- Action: 'upsert' or 'delete'
);
```

### signaturelistentries Table (Unchanged)

```sql
CREATE TABLE signaturelistentries (
  entryuuid VARCHAR(255) PRIMARY KEY,
  siglistuuid VARCHAR(255),
  signeruuid VARCHAR(255),
  signature TEXT NOT NULL,
  signature_algorithm VARCHAR(255) DEFAULT 'ED25519',
  hash_algorithm VARCHAR(255) DEFAULT 'SHA256',
  signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(siglistuuid, signeruuid)
);
```

## Workflow

### 1. Record Created

```sql
INSERT INTO attachments (...) VALUES (...);
-- row_version = 1 (default)
-- siglistuuid = NULL (unsigned)
```

### 2. Record Signed

```bash
node sign_metadata.js --table=attachments --record=abc-123 --keyfile=signer.txt
```

**Result:**
- Creates signaturelist with `signed_row_version = 1`
- Adds signature to signaturelistentries
- Updates record: `siglistuuid = <new-uuid>`

### 3. Record Updated (Version Bump)

When making legitimate changes that invalidate signatures:

```sql
UPDATE attachments 
SET file_name = 'new_name',
    row_version = row_version + 1
WHERE auuid = 'abc-123';

-- Now: row_version = 2
-- Old: signed_row_version = 1 (signatures now outdated)
```

### 4. Record Re-Signed

```bash
node sign_metadata.js --table=attachments --record=abc-123 --keyfile=signer.txt
```

**Result:**
- Detects version mismatch (row_version=2, signed_row_version=1)
- Deletes old signaturelist and signatures
- Creates new signaturelist with `signed_row_version = 2`
- Adds new signatures

## Signing Operations

### Sign Single Record

```bash
node sign_metadata.js \
  --table=attachments \
  --record=abc-123-def-456 \
  --keyfile=signer_metadata_key.txt
```

**What happens:**
1. Loads record from database
2. Checks `row_version` (e.g., 2)
3. Checks if `siglistuuid` exists and matches version
4. If version mismatch, removes old signatures
5. Creates new signaturelist with current `signed_row_version`
6. Generates signature
7. Saves to database

### Sign All Unsigned/Outdated Records

```bash
node sign_metadata.js \
  --table=attachments \
  --all \
  --keyfile=signer_metadata_key.txt
```

**What happens:**
1. Finds all records where:
   - `siglistuuid IS NULL` (never signed)
   - `row_version > signed_row_version` (outdated signature)
2. Signs each record
3. Reports: total, signed, errors

### Sign for Deletion

```bash
node sign_metadata.js \
  --table=attachments \
  --record=abc-123 \
  --keyfile=signer.txt \
  --action=delete
```

**What happens:**
- Creates signaturelist with `signed_action = 'delete'`
- Client should delete this record when receiving the update

## Server Response Format

### With Metadata Signatures

```json
{
  "data": {
    "auuid": "abc-123",
    "file_name": "test.bin",
    "row_version": 2,
    "siglistuuid": "siglist-uuid-1",
    ...
  },
  "mdsignatures": {
    "siglist-uuid-1": [
      {
        "signeruuid": "signer-1",
        "signature": "hex-signature...",
        "signature_algorithm": "ED25519",
        "hash_algorithm": "SHA256",
        "signed_at": "2025-10-11T12:00:00.000Z",
        "signer_name": "Admin Signer",
        "publickey_type": "ED25519"
      }
    ]
  },
  "server_signature": {
    "signeruuid": "server-signer-uuid",
    "signature": "hex-signature...",
    "algorithm": "ED25519",
    "hash": "sha256-of-response..."
  }
}
```

### Metadata Updates in Response

Server can include `metadata_updates` in any response:

```json
{
  "data": {...},
  "metadata_updates": [
    {
      "table": "attachments",
      "action": "upsert",
      "record": {
        "auuid": "new-123",
        "file_name": "new_file.bin",
        "row_version": 1,
        "siglistuuid": "siglist-new",
        ...
      },
      "signed_row_version": 1,
      "signed_action": "upsert"
    },
    {
      "table": "gameversions",
      "action": "delete",
      "record_uuid": "old-456",
      "signed_row_version": 3,
      "signed_action": "delete"
    }
  ],
  "mdsignatures": {
    "siglist-new": [...],
    ...
  },
  "server_signature": {...}
}
```

## Client Validation Rules

### Server Signature Validation

**REQUIRED for all JSON responses:**

1. Extract `server_signature` from response
2. Get server signer's public key from local signers table
3. Verify signer type is 'server'
4. Recreate hash of response data
5. Verify signature matches
6. **REJECT response if:**
   - No server_signature
   - Signature invalid
   - Signer not in client's signers table
   - Signer type is not 'server'

### Metadata Signature Validation

**Optional for reading, REQUIRED for storing updates:**

**Client can read unsigned metadata** but will **not store updates** unless:

1. Record has `siglistuuid`
2. Signature exists in `mdsignatures`
3. Signer is in client's signers table
4. Signer type is 'metadata' (not 'server')
5. Signature validates correctly
6. `signed_row_version` matches or is newer than client's version

### Update Application Rules

When client receives `metadata_updates`:

1. **Verify server signature** (REQUIRED)
2. For each update:
   - Find corresponding signature in `mdsignatures`
   - Verify metadata signature (REQUIRED for updates)
   - Check signer is authorized
   - Check `signed_action`:
     - **'upsert':** Insert or update record
     - **'delete':** Delete record from client database
   - Apply update if all validations pass
   - Skip update if any validation fails

## Version Conflict Resolution

### Scenario: Client has v2, Server sends v1

```
Client record: row_version = 2
Server update: row_version = 1, signed_row_version = 1
```

**Action:** Skip update (client has newer version)

### Scenario: Client has v1, Server sends v2

```
Client record: row_version = 1
Server update: row_version = 2, signed_row_version = 2
```

**Action:** Apply update (server has newer version)

### Scenario: Versions match

```
Client record: row_version = 2
Server update: row_version = 2, signed_row_version = 2
```

**Action:** Skip or merge (client already has this version)

## Migration

### Existing Databases

```bash
# Add row_version and siglistuuid columns
npm run mdserver:migrate-signatures
```

**What it does:**
- Creates signaturelists and signaturelistentries tables
- Adds `row_version` column to all signed tables (default: 1)
- Adds `siglistuuid` column to all signed tables
- Adds new columns to signaturelists table

### Existing Signed Records

If records were signed before row versioning:

```sql
-- Find records with old signatures (no signed_row_version)
SELECT a.*, sl.signed_row_version
FROM attachments a
JOIN signaturelists sl ON a.siglistuuid = sl.siglistuuid
WHERE sl.signed_row_version IS NULL;

-- These need to be re-signed or updated
```

## Best Practices

### When to Bump row_version

**DO bump version when:**
- Changing data fields (file_name, hashes, etc.)
- Updating metadata that affects signature
- Making intentional corrections

**DON'T bump version when:**
- Updating timestamps (import_time, updated_time)
- Changing non-signed fields
- Adding file_data (if not signed)

### Signing Workflow

**For new records:**
1. Create record (row_version = 1 default)
2. Sign: `node sign_metadata.js --table=X --record=UUID --keyfile=KEY.txt`
3. Record now has signatures

**For updated records:**
1. Make changes and bump version: `UPDATE ... SET ..., row_version = row_version + 1`
2. Re-sign: `node sign_metadata.js --table=X --record=UUID --keyfile=KEY.txt`
3. Old signatures automatically replaced

**For batch signing:**
1. Import many records
2. Sign all: `node sign_metadata.js --table=X --all --keyfile=KEY.txt`
3. All unsigned records now signed

### Deletion Workflow

**To mark record for deletion:**
```bash
node sign_metadata.js \
  --table=attachments \
  --record=abc-123 \
  --keyfile=signer.txt \
  --action=delete
```

**Client behavior:**
- Receives record with `signed_action = 'delete'`
- Verifies signature
- Deletes record from local database

## Security Implications

### Version Tracking

- Prevents replay attacks (old versions can't overwrite new)
- Tracks metadata evolution
- Enables audit trails

### Signature Invalidation

- Changing data requires re-signing
- Old signatures automatically removed
- Forces explicit approval of changes

### Multi-Signer Support

- Multiple signers can sign same record
- Each signature independent
- Client can require N-of-M signatures

## Examples

### Example 1: Create and Sign

```bash
# Insert new attachment
sqlite3 mdserver/patchbin.db "INSERT INTO attachments (auuid, file_name, ...) VALUES (...);"

# Sign it
node mdserver/sign_metadata.js --table=attachments --record=NEW_UUID --keyfile=signer.txt

# Result:
# - row_version = 1
# - siglistuuid = <new-siglist>
# - signed_row_version = 1
```

### Example 2: Update and Re-Sign

```bash
# Update record
sqlite3 mdserver/patchbin.db "
  UPDATE attachments 
  SET file_name = 'updated_name', 
      row_version = row_version + 1 
  WHERE auuid = 'abc-123';
"

# Re-sign
node mdserver/sign_metadata.js --table=attachments --record=abc-123 --keyfile=signer.txt

# Result:
# - Old signaturelist deleted
# - New signaturelist created with signed_row_version = 2
# - New signatures added
```

### Example 3: Batch Sign All

```bash
# Sign all attachments
node mdserver/sign_metadata.js --table=attachments --all --keyfile=signer.txt

# Output:
# Total records:    150
# Successfully signed: 150
# Errors:           0
```

## Client Implementation (fetchpatches.js)

When implementing Option G (--apisearch), the client must:

### 1. Verify Server Signature (Always)

```javascript
// Extract server_signature from response
const serverSig = response.server_signature;

// Get server signer from local signers table
const signer = db.prepare(`
  SELECT publickey, publickey_type FROM signers 
  WHERE signeruuid = ? AND signer_name LIKE '%server%'
`).get(serverSig.signeruuid);

// Verify signature
const isValid = verifySignature(
  response.data,
  serverSig.signature,
  signer.publickey,
  signer.publickey_type
);

if (!isValid) {
  throw new Error('Server signature invalid - REJECT RESPONSE');
}
```

### 2. Verify Metadata Signatures (For Updates)

```javascript
// For each metadata update
for (const update of response.metadata_updates) {
  const siglistuuid = update.record.siglistuuid;
  const signatures = response.mdsignatures[siglistuuid];
  
  if (!signatures || signatures.length === 0) {
    console.log('No signatures - skip update');
    continue;
  }
  
  // Verify at least one valid signature from authorized metadata signer
  let validSignature = false;
  
  for (const sig of signatures) {
    const signer = getLocalSigner(sig.signeruuid);
    
    if (!signer) continue; // Unknown signer
    if (signer.signer_type === 'server') continue; // Wrong type
    
    const isValid = verifyMetadataSignature(update.record, sig, signer);
    
    if (isValid) {
      validSignature = true;
      break;
    }
  }
  
  if (!validSignature) {
    console.log('No valid metadata signature - skip update');
    continue;
  }
  
  // Apply update
  applyMetadataUpdate(update);
}
```

### 3. Handle Signed Actions

```javascript
function applyMetadataUpdate(update) {
  if (update.signed_action === 'delete') {
    // Delete record
    db.prepare(`DELETE FROM ${update.table} WHERE ${pk} = ?`)
      .run(update.record_uuid);
    console.log(`Deleted ${update.table} record: ${update.record_uuid}`);
    
  } else {
    // Upsert record
    // Check version conflict
    const existing = db.prepare(`SELECT row_version FROM ${update.table} WHERE ${pk} = ?`)
      .get(update.record[pk]);
    
    if (existing && existing.row_version >= update.record.row_version) {
      console.log(`Skipped ${update.table} (local version >= remote)`);
      return;
    }
    
    // Insert or update
    upsertRecord(update.table, update.record);
    console.log(`Updated ${update.table} to version ${update.record.row_version}`);
  }
}
```

## Usage Examples

### Create Metadata Signer

```bash
cd mdserver
node create_signer.js

# Interactive prompts:
# Type: 1 (metadata)
# Name: "Production Metadata Signer"
# Algorithm: 1 (ED25519)

# Saves: signer_metadata_<uuid>_<timestamp>.txt
```

### Sign Single Record

```bash
node mdserver/sign_metadata.js \
  --table=attachments \
  --record=9bc96ea9-63e9-44e2-9bba-f386824e8bf7 \
  --keyfile=signer_metadata_abc123_2025.txt
```

### Sign All Unsigned

```bash
node mdserver/sign_metadata.js \
  --table=attachments \
  --all \
  --keyfile=signer_metadata_abc123_2025.txt
```

### Sign for Deletion

```bash
node mdserver/sign_metadata.js \
  --table=gameversions \
  --record=old-version-uuid \
  --keyfile=signer_metadata_abc123_2025.txt \
  --action=delete
```

## Migration Checklist

For existing deployments:

- [x] Run `npm run mdserver:migrate-signatures`
- [ ] Create metadata signer
- [ ] Sign existing records (optional)
- [ ] Create server signer (optional)
- [ ] Configure server signing (optional)
- [ ] Implement client-side verification in fetchpatches.js

## Security Benefits

### Version Tracking
- ✅ Prevents rollback attacks
- ✅ Tracks metadata evolution
- ✅ Enables audit trails

### Signature Validation
- ✅ Ensures data integrity
- ✅ Proves authenticity
- ✅ Prevents tampering

### Multi-Signer Trust
- ✅ Multiple authorities can sign
- ✅ Client can require specific signers
- ✅ Distributed trust model

## Status

✅ **Row Versioning:** Fully implemented  
✅ **Signature Schema:** Updated  
✅ **Migration Tool:** Complete  
✅ **Signing Tool:** Enhanced with version support  
✅ **Batch Signing:** Implemented  
✅ **Server Integration:** Complete  
✅ **Documentation:** Complete  

**Next:** Implement client-side verification in fetchpatches.js Option G

