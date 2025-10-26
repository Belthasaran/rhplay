# Test Suite for fetchpatches.js and mdserver

This directory contains comprehensive test infrastructure for testing `fetchpatches.js` (especially Option G with API search) and the metadata server (`mdserver`).

## Overview

The test suite creates isolated test databases with sample data, test signers (metadata and server), and a test server instance running on port 3001. This allows full end-to-end testing without impacting production databases.

## Test Structure

```
tests/
├── setup_test_env.js       # Creates test databases with sample data
├── create_test_signers.js  # Generates test signing keypairs
├── test_server.js          # Launches test server with test databases
├── test_e2e_apig.js        # End-to-end test for Option G (API search)
├── test_data/              # Generated test data directory
│   ├── test_patchbin.db
│   ├── test_rhdata.db
│   ├── test_mdserverdata.db
│   ├── test_environment    # Test environment variables
│   ├── test_config.json    # Test configuration
│   ├── test_signers.json   # Test signer UUIDs
│   └── test_metadata_signer_*.key  # Private key for metadata signing
└── README_TESTS.md         # This file
```

## Quick Start

Run these commands in order:

```bash
# 1. Create test databases with sample data
npm run test:setup

# 2. Generate test signing keypairs
npm run test:create-signers

# 3. Run end-to-end test (launches server automatically)
npm run test:e2e
```

Or to run the server manually:

```bash
# Terminal 1: Start test server
npm run test:server

# Terminal 2: Run tests
npm run test:e2e
```

## Test Scripts

### 1. setup_test_env.js

Creates isolated test databases:

- **test_patchbin.db**: Contains test attachments, signers, IPFS gateways
- **test_rhdata.db**: Contains minimal gameversions schema
- **test_mdserverdata.db**: Server's internal database

Sample test attachments created:
- Attachment without file_data (for testing search)
- Attachment with ArDrive metadata
- Attachment with file_data (for verification)

```bash
npm run test:setup
```

### 2. create_test_signers.js

Generates cryptographic keypairs:

- **Metadata Signer**: ED25519 keypair for signing metadata records
  - Public key stored in `signers` table
  - Private key saved to `test_data/test_metadata_signer_*.key`
  
- **Server Signer**: ED25519 keypair for server response signing
  - Public key stored in `signers` table
  - Private key stored in test environment file

Creates `test_data/test_environment` with:
- VAULT_KEY for encrypting client credentials
- SERVER_SIGNER_UUID and SERVER_PRIVATE_KEY_HEX
- PORT=3001 (to avoid conflict with production server)

```bash
npm run test:create-signers
```

### 3. test_server.js

Launches the mdserver with test databases:

- Uses test databases via command-line arguments
- Loads test environment (port 3001, test signers)
- Allows testing without affecting production data

```bash
npm run test:server
```

The server will run on http://localhost:3001

### 4. test_e2e_apig.js

End-to-end test for Option G (API Search):

**Test Flow:**
1. ✓ Start test server
2. ✓ Create test API client
3. ✓ Sign test attachment metadata
4. ✓ Test direct API call to `/api/search`
5. ✓ Verify server signature
6. ✓ Verify metadata signatures
7. ✓ Run fetchpatches.js with `--apisearch` option

**Tests:**
- Server starts successfully
- API authentication works
- Server signs responses correctly
- Metadata signatures are attached
- fetchpatches.js can consume the API
- Signature verification works end-to-end

```bash
npm run test:e2e
```

## Test Configuration Files

After running setup and signer creation, you'll have:

### test_config.json
```json
{
  "testDir": "/path/to/tests/test_data",
  "databases": {
    "patchbin": "/path/to/test_patchbin.db",
    "rhdata": "/path/to/test_rhdata.db",
    "serverdata": "/path/to/test_mdserverdata.db"
  },
  "testAttachments": [...],
  "created": "2025-10-11T..."
}
```

### test_signers.json
```json
{
  "metadata": {
    "uuid": "...",
    "algorithm": "ED25519",
    "privateKeyFile": "..."
  },
  "server": {
    "uuid": "...",
    "algorithm": "ED25519"
  }
}
```

### test_environment
```
VAULT_KEY=...
SERVER_SIGNER_UUID=...
SERVER_SIGNER_ALGORITHM=ED25519
SERVER_PRIVATE_KEY_HEX=...
PORT=3001
```

## Database Path Configuration

Both the server and client support custom database paths via command-line arguments:

### Server (mdserver/server.js)
```bash
node mdserver/server.js \
  --serverdatadb=/path/to/db \
  --rhdatadb=/path/to/rhdata.db \
  --patchbindb=/path/to/patchbin.db
```

### Client (fetchpatches.js)
```bash
node fetchpatches.js mode2 \
  --patchbindb=/path/to/patchbin.db \
  --rhdatadb=/path/to/rhdata.db \
  --apisearch \
  --apiurl=http://localhost:3001/api/search \
  --apiclient=YOUR_CLIENT_ID \
  --apisecret=YOUR_CLIENT_SECRET
```

## Testing Option G (API Search)

The test suite validates:

1. **Server Response Signing**
   - Server signs all JSON responses with its private key
   - Signature includes SHA256 hash of response data
   - Client verifies signature using server's public key

2. **Metadata Signatures**
   - Attachments are signed offline by metadata signer
   - Signatures stored in `signaturelists` and `signaturelistentries`
   - Server includes metadata signatures in responses
   - Client verifies metadata signatures

3. **file_data Validation**
   - Client ALWAYS verifies SHA256 hash of file_data
   - Invalid file_data is rejected (not stored)
   - Hash validation is separate from signature verification

4. **Security Features**
   - Unsigned responses are rejected
   - Invalid signatures are rejected
   - Unknown signers are rejected
   - Server-type signers verified for server responses

## Cleanup

To clean up test data:

```bash
rm -rf tests/test_data
```

Then re-run setup scripts to recreate test environment.

## Troubleshooting

**Server won't start:**
- Check if port 3001 is already in use
- Verify test_environment file exists
- Check database paths in test_config.json

**Client authentication fails:**
- Ensure test client was created
- Check VAULT_KEY matches in test_environment
- Verify client ID and secret

**Signature verification fails:**
- Ensure test signers were created
- Check signer UUIDs match in database
- Verify private keys exist and are readable

**Database errors:**
- Run `npm run test:setup` again to recreate databases
- Check file permissions
- Verify disk space

## Integration with Production

To use the test patterns in production:

1. Use separate production databases
2. Generate production signers with `npm run mdserver:create-signer`
3. Set production environment variables
4. Use production port (3000)
5. Create production API clients with `npm run mdserver:create-client`

The test suite demonstrates the full workflow but is isolated from production data.

