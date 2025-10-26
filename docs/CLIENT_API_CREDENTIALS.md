# Client API Server Credentials Storage

## Overview

The client application can securely store multiple metadata API server credentials in the `clientdata.db` database. Credentials are encrypted using AES-256-CBC encryption.

**Implementation Date:** October 11, 2025

## Database Schema

### apiservers Table

```sql
CREATE TABLE apiservers (
    apiserveruuid VARCHAR(255) PRIMARY KEY,
    server_name VARCHAR(255),
    api_url TEXT NOT NULL,
    encrypted_clientid TEXT,
    encrypted_clientsecret TEXT,
    is_active INTEGER DEFAULT 1,
    last_used TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);
```

**Fields:**
- `apiserveruuid` - Unique identifier for the server entry
- `server_name` - Friendly name (e.g., "Production", "Test Server")
- `api_url` - Base URL of the metadata API server
- `encrypted_clientid` - Client UUID encrypted with AES-256-CBC
- `encrypted_clientsecret` - Client secret encrypted with AES-256-CBC
- `is_active` - Whether this server is currently active (1=yes, 0=no)
- `last_used` - Timestamp of last successful use
- `created_at` - When the entry was created
- `notes` - Optional notes about the server

## Encryption

### Current Implementation

Credentials are encrypted using **AES-256-CBC** with a key from the `RHTCLIENT_VAULT_KEY` environment variable.

**Format:**
```
encrypted_value = IV:CIPHERTEXT
```

Where:
- `IV` - 16-byte initialization vector (hex encoded)
- `CIPHERTEXT` - Encrypted data (hex encoded)

### Encryption Key Source

**Current:** Environment variable `RHTCLIENT_VAULT_KEY`
- Must be a 64-character hexadecimal string (256 bits)
- Example: `openssl rand -hex 32`

**Future (TODO):** OS-specific secure keychain
- **Windows:** Windows Credential Manager
- **macOS:** Keychain Access
- **Linux:** Secret Service API (libsecret)

## Setup

### 1. Migration

Add the `apiservers` table to existing databases:

```bash
# Default location (./clientdata.db)
npm run client:migrate-apiserver

# Custom location
node electron/migrate_apiservers.js /path/to/clientdata.db
```

**Output:**
```
======================================================================
Migration: Add apiservers table to clientdata.db
======================================================================

Database: /home/user/clientdata.db

Creating apiservers table...
✓ Created apiservers table
✓ Table has 9 columns:
    - apiserveruuid (VARCHAR(255))
    - server_name (VARCHAR(255))
    - api_url (TEXT)
    - encrypted_clientid (TEXT)
    - encrypted_clientsecret (TEXT)
    - is_active (INTEGER)
    - last_used (TIMESTAMP)
    - created_at (TIMESTAMP)
    - notes (TEXT)

======================================================================
Migration completed successfully!
======================================================================
```

### 2. Generate Encryption Key

```bash
# Linux/macOS
export RHTCLIENT_VAULT_KEY=$(openssl rand -hex 32)

# Windows (PowerShell)
$env:RHTCLIENT_VAULT_KEY = -join ((1..32 | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }))

# Windows (CMD)
# Generate manually at: https://www.random.org/bytes/
set RHTCLIENT_VAULT_KEY=<64-char-hex-string>
```

**⚠️ Important:** Save this key securely! You'll need it to decrypt credentials.

### 3. Add API Server

```bash
npm run client:add-apiserver
```

**Interactive prompts:**
```
======================================================================
Add API Server
======================================================================

Server name (e.g., "Production", "Test"): Production Server
API URL (e.g., "https://api.example.com"): https://api.example.com
Client ID (UUID): 12345678-1234-1234-1234-123456789abc
Client Secret: ********************************
Notes (optional): Primary production server

Encrypting credentials...
✓ API server added successfully!

  UUID: 87654321-4321-4321-4321-cba987654321
  Name: Production Server
  URL: https://api.example.com
```

## Management Commands

### List Servers

```bash
npm run client:list-apiservers
```

**Output:**
```
======================================================================
API Servers
======================================================================

[1] Production Server
    UUID:   87654321-4321-4321-4321-cba987654321
    URL:    https://api.example.com
    Active: Yes
    Last:   2025-10-11 14:30:00
    Notes:  Primary production server

[2] Test Server
    UUID:   11111111-2222-3333-4444-555555555555
    URL:    http://localhost:3001
    Active: Yes

Total: 2 server(s)
```

### Remove Server

```bash
node electron/manage_apiserver.js remove <uuid>
```

**Example:**
```
======================================================================
Remove API Server
======================================================================

Server to remove:
  Name: Test Server
  URL:  http://localhost:3001

Are you sure? (yes/no): yes
✓ Server removed
```

### Test Connection

```bash
npm run client:test-apiserver <uuid>
```

**Example:**
```
======================================================================
Test API Server Connection
======================================================================

Server: Production Server
URL: https://api.example.com

Decrypting credentials...
✓ Credentials decrypted

Testing connection...
✓ Health check passed

Testing authentication...
✓ Authentication successful
✓ Server connection working!
```

## Usage in fetchpatches.js

### Automatic Discovery

If the `apiservers` table exists and has entries, the `--apiurl` option is implied:

```bash
# Uses first active server from apiservers table
node fetchpatches.js mode2 --apisearch

# Explicit URL overrides database
node fetchpatches.js mode2 --apisearch --apiurl=https://custom.api.com
```

### Integration Example

```javascript
const Database = require('better-sqlite3');
const crypto = require('crypto');

// Load API server credentials
function loadAPIServer(db) {
  const server = db.prepare(`
    SELECT api_url, encrypted_clientid, encrypted_clientsecret
    FROM apiservers
    WHERE is_active = 1
    ORDER BY last_used DESC NULLS LAST
    LIMIT 1
  `).get();
  
  if (!server) return null;
  
  const clientId = decrypt(server.encrypted_clientid);
  const clientSecret = decrypt(server.encrypted_clientsecret);
  
  return {
    url: server.api_url,
    clientId,
    clientSecret
  };
}

// Use in Mode 2
if (searchOptions.searchAPI) {
  if (!searchOptions.apiUrl) {
    const apiServer = loadAPIServer(clientDb);
    if (apiServer) {
      searchOptions.apiUrl = apiServer.url;
      searchOptions.apiClient = apiServer.clientId;
      searchOptions.apiSecret = apiServer.clientSecret;
    }
  }
}
```

## Security Considerations

### Current Security Model

✅ **Encryption at Rest**
- Credentials encrypted with AES-256-CBC
- Unique IV per encryption operation
- Strong 256-bit key

⚠️ **Key Storage**
- Environment variable (not ideal for long-term)
- User must manage key securely
- Risk of exposure in process list/environment

❌ **Transport Security**
- Credentials decrypted in memory during use
- Plain text passed to API (over HTTPS)

### Future Security Improvements

**1. OS Keychain Integration (TODO)**

Move encryption key to OS-specific secure storage:

```javascript
// Future implementation
const keytar = require('keytar');

async function getVaultKey() {
  return await keytar.getPassword('rhtools', 'vault_key');
}

async function setVaultKey(key) {
  await keytar.setPassword('rhtools', 'vault_key', key);
}
```

**Benefits:**
- OS-managed encryption (hardware-backed on modern systems)
- Protected by user login
- No environment variable exposure

**2. Per-Server Key Derivation**

Derive unique keys per server:

```javascript
const serverKey = crypto.pbkdf2Sync(
  VAULT_KEY,
  server.apiserveruuid,
  100000,
  32,
  'sha256'
);
```

**3. Memory Protection**

Clear sensitive data after use:

```javascript
function clearString(str) {
  if (Buffer.isBuffer(str)) {
    str.fill(0);
  }
}

// After use
clearString(clientSecret);
```

## Environment Variables

### RHTCLIENT_VAULT_KEY

**Format:** 64-character hexadecimal string (256 bits)

**Generation:**
```bash
# Linux/macOS
openssl rand -hex 32

# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Python
python3 -c "import secrets; print(secrets.token_hex(32))"
```

**Storage:**
- Add to `.bashrc`, `.zshrc`, or similar
- Use `.env` file (with proper permissions)
- Never commit to version control

**Example `.env` file:**
```bash
# .rhtools.env
RHTCLIENT_VAULT_KEY=a1b2c3d4e5f6...64chars...xyz
CLIENTDATA_DB=/path/to/clientdata.db
```

Load with:
```bash
source .rhtools.env
node fetchpatches.js mode2 --apisearch
```

### CLIENTDATA_DB

**Optional:** Override default database path

```bash
export CLIENTDATA_DB=/custom/path/clientdata.db
npm run client:list-apiservers
```

## Migration Guide

### From Manual Configuration

**Before:** Command-line arguments
```bash
node fetchpatches.js mode2 \
  --apisearch \
  --apiurl=https://api.example.com \
  --apiclient=12345678-1234-1234-1234-123456789abc \
  --apisecret=secret-here
```

**After:** Stored credentials
```bash
# One-time setup
export RHTCLIENT_VAULT_KEY=$(openssl rand -hex 32)
npm run client:add-apiserver
# Enter details interactively

# Usage (much simpler!)
node fetchpatches.js mode2 --apisearch
```

### From Environment Variables

**Before:** `.env` file
```bash
API_URL=https://api.example.com
API_CLIENT_ID=12345678-1234-1234-1234-123456789abc
API_CLIENT_SECRET=secret-here
```

**After:** Encrypted storage
```bash
# Convert to encrypted storage
npm run client:add-apiserver
# Paste values from .env

# Remove from .env (optional)
```

## Troubleshooting

### Error: RHTCLIENT_VAULT_KEY not set

**Solution:**
```bash
export RHTCLIENT_VAULT_KEY=$(openssl rand -hex 32)
```

### Error: RHTCLIENT_VAULT_KEY must be 64 characters

**Cause:** Key is wrong length

**Solution:** Regenerate key
```bash
export RHTCLIENT_VAULT_KEY=$(openssl rand -hex 32)
```

### Error: Invalid encrypted data format

**Cause:** Wrong encryption key or corrupted data

**Solutions:**
1. Verify you're using the correct `RHTCLIENT_VAULT_KEY`
2. Re-add the server if key is lost

### Error: Database not found

**Cause:** `clientdata.db` doesn't exist

**Solution:** Run migration first
```bash
npm run client:migrate-apiserver
```

### Authentication Failed

**Cause:** Wrong credentials or server issue

**Solutions:**
1. Test connection: `npm run client:test-apiserver <uuid>`
2. Verify credentials on server
3. Re-add server with correct credentials

## Best Practices

### Development

1. **Separate Keys:** Use different `RHTCLIENT_VAULT_KEY` for dev/prod
2. **Test Servers:** Mark test servers in notes
3. **Regular Testing:** Test connections periodically

### Production

1. **Secure Key Storage:** Use OS keychain when available (future)
2. **Key Rotation:** Rotate encryption keys periodically
3. **Backup:** Backup encrypted database (requires same key)
4. **Access Control:** Restrict database file permissions

### Team Usage

1. **Shared Servers:** Each user adds their own credentials
2. **Key Management:** Don't share `RHTCLIENT_VAULT_KEY`
3. **Documentation:** Document which servers are available

## Examples

### Complete Setup

```bash
# 1. Generate encryption key
export RHTCLIENT_VAULT_KEY=$(openssl rand -hex 32)

# 2. Save key securely
echo "export RHTCLIENT_VAULT_KEY=$RHTCLIENT_VAULT_KEY" >> ~/.rhtools_env
chmod 600 ~/.rhtools_env

# 3. Run migration
npm run client:migrate-apiserver

# 4. Add production server
npm run client:add-apiserver
# Enter: Production, https://api.prod.example.com, credentials

# 5. Add test server
npm run client:add-apiserver
# Enter: Test, http://localhost:3001, test credentials

# 6. List servers
npm run client:list-apiservers

# 7. Use in fetchpatches
node fetchpatches.js mode2 --apisearch --searchmax=5
```

### Multiple Environments

```bash
# Development
export RHTCLIENT_VAULT_KEY=dev_key_here
export CLIENTDATA_DB=./dev_clientdata.db
npm run client:add-apiserver

# Production
export RHTCLIENT_VAULT_KEY=prod_key_here
export CLIENTDATA_DB=./prod_clientdata.db
npm run client:add-apiserver
```

## Summary

The client API credentials storage provides:

✅ **Secure storage** - AES-256-CBC encryption  
✅ **Multiple servers** - Store credentials for many servers  
✅ **Easy management** - Simple CLI tools  
✅ **Auto-discovery** - Automatic credential loading  
✅ **Future-proof** - Designed for OS keychain integration  

**Status:** ✅ Implemented and ready for use

**Next Steps:**
1. TODO: Integrate OS keychain for key storage
2. TODO: Add automatic key rotation
3. TODO: Implement memory protection for sensitive data

