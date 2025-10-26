# Digital Signature System Guide

## Overview

The metadata server supports two types of digital signatures:

1. **Metadata Signatures** - For records in gameversions, patchblobs, rhpatches, attachments
2. **Server Signatures** - For server API responses

## Signer Types

### Metadata Signers

- **Purpose:** Sign metadata records offline by admin
- **Private Key:** Stored in secure key files (not on server)
- **Public Key:** Stored in signers table (patchbin.db)
- **Signed By:** Admin users offline
- **Used For:** Verifying authenticity of metadata records

### Server Signers

- **Purpose:** Sign server API responses
- **Private Key:** Stored in server environment file
- **Public Key:** Stored in signers table (patchbin.db)
- **Signed By:** Server automatically
- **Used For:** Verifying server responses haven't been tampered with

## Quick Start

### 1. Create a Metadata Signer

```bash
cd mdserver
node create_signer.js
```

Interactive prompts:
```
Select signer type (1 or 2): 1          # 1 = metadata
Enter signer name: Admin Metadata Signer
Select algorithm (1 or 2): 1            # 1 = ED25519 (recommended)
```

**Output:**
- Creates keypair file: `signer_metadata_<uuid>_<timestamp>.txt`
- Adds signer to `patchbin.db` signers table
- Displays public key

⚠️ **IMPORTANT:** Save the keypair file securely! Private key cannot be retrieved.

### 2. Create a Server Signer

```bash
cd mdserver
node create_signer.js
```

Interactive prompts:
```
Select signer type (1 or 2): 2          # 2 = server
Enter signer name: Production Server Signer
Select algorithm (1 or 2): 1            # 1 = ED25519
```

**Output:**
- Creates keypair file with server configuration
- Shows environment variables to add

### 3. Configure Server Signing

Add to `mdserver/environment`:

```bash
# Server Response Signing
SERVER_SIGNER_UUID=<uuid-from-create-signer>
SERVER_SIGNER_ALGORITHM=ED25519
SERVER_PRIVATE_KEY_HEX=<hex-from-create-signer>
```

### 4. Restart Server

```bash
pkill -f "node mdserver/server.js"
npm run mdserver:start
```

Server will now sign all JSON responses.

## Signing Metadata Records

### Sign a Single Record

```bash
node mdserver/sign_metadata.js \
  --table=attachments \
  --record=abc-123-def-456 \
  --keyfile=signer_metadata_abc_2025.txt
```

**What it does:**
1. Loads record from database
2. Creates canonical string (excluding siglistuuid, timestamps)
3. Signs with SHA-256 hash
4. Creates signaturelist if needed
5. Adds signature to signaturelistentries
6. Updates record's siglistuuid

### Sign Multiple Records

```bash
# Create a batch signing script
for uuid in $(sqlite3 patchbin.db "SELECT auuid FROM attachments LIMIT 10"); do
  node sign_metadata.js --table=attachments --record=$uuid --keyfile=signer_key.txt
done
```

## Database Schema

### signaturelists Table

Tracks signature lists for records:

```sql
CREATE TABLE signaturelists (
  siglistuuid VARCHAR(255) PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  record_type VARCHAR(255),    -- 'attachments', 'gameversions', etc.
  record_uuid VARCHAR(255)      -- UUID of the signed record
);
```

### signaturelistentries Table

Stores actual signatures:

```sql
CREATE TABLE signaturelistentries (
  entryuuid VARCHAR(255) PRIMARY KEY,
  siglistuuid VARCHAR(255),              -- Links to signaturelists
  signeruuid VARCHAR(255),               -- Links to signers
  signature TEXT NOT NULL,               -- Hex-encoded signature
  signature_algorithm VARCHAR(255),      -- 'ED25519' or 'RSA'
  hash_algorithm VARCHAR(255),           -- 'SHA256'
  signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(siglistuuid, signeruuid)        -- One signature per signer per record
);
```

### Signed Tables

Tables that support signatures need a `siglistuuid` column:

```sql
ALTER TABLE gameversions ADD COLUMN siglistuuid VARCHAR(255);
ALTER TABLE patchblobs ADD COLUMN siglistuuid VARCHAR(255);
ALTER TABLE rhpatches ADD COLUMN siglistuuid VARCHAR(255);
ALTER TABLE attachments ADD COLUMN siglistuuid VARCHAR(255);
```

## Signature Algorithms

### ED25519 (Recommended)

- **Key Size:** 256 bits (32 bytes)
- **Signature Size:** 512 bits (64 bytes)
- **Speed:** Very fast
- **Security:** Excellent
- **Use Case:** Default choice for most applications

### RSA

- **Key Size:** 4096 bits (512 bytes)
- **Signature Size:** 4096 bits (512 bytes)
- **Speed:** Slower than ED25519
- **Security:** Excellent
- **Use Case:** When compatibility with legacy systems is needed

## Canonical String Format

When signing a record, fields are:

1. **Included:**
   - All data fields (file_name, file_hash_sha256, etc.)
   - UUIDs (auuid, pbuuid, gvuuid, etc.)
   - File hashes and CIDs
   - Binary data (converted to hex)

2. **Excluded:**
   - siglistuuid (signature field itself)
   - timestamp fields (import_time, updated_time, etc.)
   - Any field containing 'signature'

3. **Format:**
   - Sorted alphabetically by field name
   - Format: `field1=value1&field2=value2&field3=value3`
   - NULL values: `field=null`
   - Binary values: `field=<hex>`

4. **Hashing:**
   - Canonical string → SHA-256 → Sign hash

## Server Response Signatures

When server signing is enabled, all JSON responses include:

### mdsignatures

Metadata signatures from signaturelistentries table:

```json
{
  "mdsignatures": {
    "siglist-uuid-1": [
      {
        "signeruuid": "metadata-signer-uuid",
        "signature": "hex-encoded-signature",
        "signature_algorithm": "ED25519",
        "hash_algorithm": "SHA256",
        "signed_at": "2025-10-11T12:00:00.000Z",
        "signer_name": "Admin Metadata Signer",
        "publickey_type": "ED25519"
      }
    ]
  }
}
```

### server_signature

Server's signature of the response data:

```json
{
  "server_signature": {
    "signeruuid": "server-signer-uuid",
    "signature": "hex-encoded-signature",
    "algorithm": "ED25519",
    "hash": "sha256-of-response-data"
  }
}
```

## Verification

### Verify Metadata Signature

```javascript
const crypto = require('crypto');

// 1. Get signer's public key from database
const signer = db.prepare('SELECT publickey FROM signers WHERE signeruuid = ?')
  .get(signeruuid);

const publicKey = crypto.createPublicKey({
  key: Buffer.from(signer.publickey, 'hex'),
  format: 'der',
  type: 'spki'
});

// 2. Recreate canonical string from record
const canonical = createCanonicalString(record);

// 3. Hash the canonical string
const hash = crypto.createHash('sha256').update(canonical).digest();

// 4. Verify signature
const isValid = crypto.verify(
  null,  // for ED25519
  hash,
  publicKey,
  Buffer.from(signature, 'hex')
);

console.log(`Signature valid: ${isValid}`);
```

### Verify Server Signature

```javascript
// 1. Get server signer's public key
const signer = db.prepare('SELECT publickey FROM signers WHERE signeruuid = ?')
  .get(response.server_signature.signeruuid);

// 2. Hash the response data
const dataString = JSON.stringify(response.data);
const hash = crypto.createHash('sha256').update(dataString).digest();

// 3. Verify matches provided hash
console.assert(hash.toString('hex') === response.server_signature.hash);

// 4. Verify signature
const publicKey = crypto.createPublicKey({
  key: Buffer.from(signer.publickey, 'hex'),
  format: 'der',
  type: 'spki'
});

const isValid = crypto.verify(
  null,
  hash,
  publicKey,
  Buffer.from(response.server_signature.signature, 'hex')
);

console.log(`Server signature valid: ${isValid}`);
```

## Key File Format

Keypair files are saved as text files with structure:

```
# Digital Signature Signer Credentials
# Created: 2025-10-11T15:00:00.000Z
# Type: metadata

SIGNER_UUID=abc-123-def-456
SIGNER_NAME=Admin Metadata Signer
SIGNER_TYPE=metadata
ALGORITHM=ED25519

# Public Key (PEM format) - Can be shared
PUBLIC_KEY_PEM<<EOF
-----BEGIN PUBLIC KEY-----
...
-----END PUBLIC KEY-----
EOF

# Public Key (Hex format) - Stored in database
PUBLIC_KEY_HEX=302a300506032b6570032100...

# Private Key (PEM format) - KEEP SECRET!
PRIVATE_KEY_PEM<<EOF
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
EOF

# Private Key (Hex format) - KEEP SECRET!
PRIVATE_KEY_HEX=302e020100300506032b657004220420...

# WARNING: This file contains SECRET KEYS!
```

**Security:**
- File permissions: 600 (owner read/write only)
- Not committed to git (in .gitignore)
- Backed up securely offline

## Usage Examples

### Create Metadata Signer

```bash
cd mdserver
node create_signer.js
# Type: 1 (metadata)
# Name: "Production Metadata Signer"
# Algorithm: 1 (ED25519)
```

### Sign Attachment Record

```bash
node sign_metadata.js \
  --table=attachments \
  --record=9bc96ea9-63e9-44e2-9bba-f386824e8bf7 \
  --keyfile=signer_metadata_abc123_2025.txt
```

### Sign GameVersion Record

```bash
node sign_metadata.js \
  --table=gameversions \
  --record=gv-uuid-here \
  --keyfile=signer_metadata_abc123_2025.txt
```

### Create Server Signer

```bash
cd mdserver
node create_signer.js
# Type: 2 (server)
# Name: "Production Server"
# Algorithm: 1 (ED25519)

# Then add output to environment file
```

## Security Best Practices

1. **Key Files**
   - Store in secure location (encrypted volume)
   - Restrict permissions (chmod 600)
   - Never commit to version control
   - Regular backups to offline storage

2. **Server Keys**
   - Only server signer keys on server
   - Metadata signer keys kept offline
   - Rotate keys periodically
   - Use different keys for different environments

3. **Signature Verification**
   - Always verify signatures before trusting data
   - Check signer is authorized
   - Verify signature hasn't expired (if needed)

4. **Access Control**
   - Only admin clients can create signatures
   - Metadata signing done offline
   - Server signing automatic

## Troubleshooting

### "Invalid key file format"

Check key file has all required fields (SIGNER_UUID, ALGORITHM, PRIVATE_KEY_HEX or PRIVATE_KEY_PEM).

### "Table does not have siglistuuid column"

Run migration:
```sql
ALTER TABLE attachments ADD COLUMN siglistuuid VARCHAR(255);
```

### "Signature already exists for this signer"

The tool updates the existing signature. Each signer can only have one signature per record.

### Server signatures not appearing

Check:
1. SERVER_SIGNER_UUID is set in environment
2. SERVER_PRIVATE_KEY_HEX is set in environment
3. Server was restarted after adding keys
4. No errors in server logs

## NPM Scripts

```bash
# Create signer (interactive)
npm run mdserver:create-signer

# Sign metadata record
npm run mdserver:sign-metadata -- --table=attachments --record=UUID --keyfile=FILE.txt

# Or directly:
node mdserver/create_signer.js
node mdserver/sign_metadata.js --table=attachments --record=UUID --keyfile=FILE.txt
```

## Integration

Signatures are automatically included in API responses when:

1. Record has `siglistuuid` set (metadata signatures)
2. Server has signing key configured (server signatures)

Clients can verify signatures using public keys from the `signers` table.

## Related Files

- `mdserver/create_signer.js` - Generate keypairs and signers
- `mdserver/sign_metadata.js` - Sign metadata records
- `mdserver/signatures_schema.sql` - Database schema
- `mdserver/server.js` - Server with signature support

