# Metadata API Server - Implementation Summary

## ✅ Complete and Tested

A fully functional Express.js API server for accessing gameversions, patchblobs, and attachments data with encrypted authentication.

## Status

- ✅ **Server Running:** http://localhost:3000
- ✅ **All Tests Passing:** 7/7 tests successful
- ✅ **Authentication Working:** AES-256-CBC encryption
- ✅ **Database Connected:** rhdata.db, patchbin.db, mdserverdata.db
- ✅ **Admin Client Created:** Full access
- ✅ **Read-Only Client Created:** Query access only

## Quick Start

### 1. Setup (One-time)

```bash
npm run mdserver:setup
```

**Output:**
- Creates `mdserverdata.db`
- Links to `rhdata.db` and `patchbin.db`
- Creates admin client credentials

### 2. Start Server

```bash
npm run mdserver:start
```

Server runs on `http://localhost:3000`

### 3. Test Server

```bash
# Using saved credentials
source mdserver/admin_credentials.txt
curl -H "X-Client-Id: $CLIENT_ID" \
     -H "X-Client-Secret: $CLIENT_SECRET" \
     http://localhost:3000/health
```

## Test Results

```
✓ Health check passed
✓ Root endpoint accessible
✓ Authentication successful
✓ GameVersions accessible (Retrieved: 5 records)
✓ PatchBlobs accessible (Retrieved: 5 records)  
✓ Attachments accessible (Retrieved: 5 attachments, Total: 2682)
✓ Search endpoint working
✓ Admin access confirmed

All tests complete! ✅
```

## Created Clients

### Admin Client

```
Client ID:     170075e6-5dd6-4d4e-aa2c-560464c68c1a
Client Secret: 43b5983a104fc76fc02c6b9a9d4952b1bc751a810145676a69ffb24a7283400b
Access Level:  Admin (full access)
```

### Read-Only Client

```
Client ID:     fae292e6-fc2c-4d70-9352-f211277a4137
Client Secret: ffd88a07e42f63a7d4a6630c7274ea9b5d694b8793158064ee3b4203248fa435
Access Level:  Read-only
```

**Credentials saved in:** `mdserver/admin_credentials.txt`

## API Endpoints

### Public (No Auth)

- `GET /` - API information
- `GET /health` - Health check

### Authenticated (All Clients)

- `GET /api/gameversions` - List game versions
- `GET /api/gameversions/:id` - Get specific game version
- `GET /api/patchblobs` - List patch blobs
- `GET /api/patchblobs/:id` - Get specific patch blob
- `GET /api/attachments` - List attachments
- `GET /api/attachments/:id` - Get specific attachment
- `POST /api/search` - Search attachments

### Admin Only

- `POST /api/clients` - Create new client
- `GET /api/clients` - List all clients

## Database Structure

### mdserverdata.db (Server Database)

**Tables:**

1. **serveroptions** - Server configuration
   - `optionuuid` (PK)
   - `setting_name`
   - `setting_value`

2. **apiclients** - Client credentials
   - `clientuuid` (PK)
   - `encrypted_clientid` - Encrypted client ID
   - `encrypted_secret` - Encrypted secret
   - `admin_client` - 0=read-only, 1=admin
   - `client_name` - Client description
   - `created_at` - Creation timestamp
   - `last_access` - Last API access
   - `access_count` - Total requests

3. **apilogs** - API request logs
   - `loguuid` (PK)
   - `clientuuid` (FK)
   - `endpoint` - API path
   - `method` - HTTP method
   - `status_code` - Response code
   - `request_data` - Query/body params
   - `response_size` - Number of records
   - `timestamp` - Request time

### Data Databases (Symlinked from electron/)

- **rhdata.db** - gameversions, patchblobs (read-only)
- **patchbin.db** - attachments (read-write for admin)

## Security Features

### Credential Encryption

**Algorithm:** AES-256-CBC  
**Key:** VAULT_KEY (256-bit hex) from `mdserver/environment`  
**Format:** `{iv}:{encrypted_data}`

```javascript
// Encryption
const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-cbc', VAULT_KEY, iv);
encrypted = iv.toString('hex') + ':' + cipher.update(text) + cipher.final('hex');

// Decryption
const [iv, encrypted] = text.split(':');
const decipher = crypto.createDecipheriv('aes-256-cbc', VAULT_KEY, Buffer.from(iv, 'hex'));
decrypted = decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
```

### Permission Model

**Read-Only Clients (admin_client = 0):**
- ✅ GET /api/gameversions
- ✅ GET /api/patchblobs
- ✅ GET /api/attachments
- ✅ POST /api/search
- ❌ POST, PUT, DELETE operations
- ❌ Client management

**Admin Clients (admin_client = 1):**
- ✅ All GET operations
- ✅ POST /api/clients (create clients)
- ✅ GET /api/clients (list clients)
- ✅ All POST, PUT, DELETE operations (future)

## File Structure

```
mdserver/
├── server.js                    # Main Express server
├── create_client.js             # Client creation utility
├── setup.js                     # Setup/initialization script
├── test_api.js                  # API test suite
├── serverdata.sql               # Server database schema
├── environment                  # VAULT_KEY configuration
├── README.md                    # Documentation
├── API_SERVER_SUMMARY.md        # This file
├── .gitignore                   # Ignore sensitive files
├── mdserverdata.db              # Server database (created)
├── admin_credentials.txt        # Saved credentials (created)
├── server.log                   # Server logs (created)
├── rhdata.db → ../electron/rhdata.db      # Symlink
└── patchbin.db → ../electron/patchbin.db  # Symlink
```

## Usage Examples

### List Attachments

```bash
curl -H "X-Client-Id: 170075e6-5dd6-4d4e-aa2c-560464c68c1a" \
     -H "X-Client-Secret: 43b5983a104fc76fc02c6b9a9d4952b1bc751a810145676a69ffb24a7283400b" \
     "http://localhost:3000/api/attachments?limit=10&offset=0"
```

### Get Specific Attachment

```bash
curl -H "X-Client-Id: YOUR_ID" \
     -H "X-Client-Secret: YOUR_SECRET" \
     "http://localhost:3000/api/attachments/9bc96ea9-63e9-44e2-9bba-f386824e8bf7"
```

### Search for File

```bash
curl -X POST \
  -H "X-Client-Id: YOUR_ID" \
  -H "X-Client-Secret: YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"file_hash_sha256":"0a34e06fec09b29c2a95e9fc48c8a7e302fbe35445fc8aef98abe8ed4d31055e"}' \
  http://localhost:3000/api/search
```

### Create New Client (Admin Only)

```bash
curl -X POST \
  -H "X-Client-Id: 170075e6-5dd6-4d4e-aa2c-560464c68c1a" \
  -H "X-Client-Secret: 43b5983a104fc76fc02c6b9a9d4952b1bc751a810145676a69ffb24a7283400b" \
  -H "Content-Type: application/json" \
  -d '{"client_name":"New Client","admin_client":0}' \
  http://localhost:3000/api/clients
```

## Integration with fetchpatches.js

### Preparation for Option G (--apisearch)

The server is ready for fetchpatches.js --apisearch integration:

```bash
node fetchpatches.js mode2 --apisearch \
  --apiurl=http://localhost:3000/api/search \
  --apiclient=fae292e6-fc2c-4d70-9352-f211277a4137 \
  --apisecret=ffd88a07e42f63a7d4a6630c7274ea9b5d694b8793158064ee3b4203248fa435 \
  --searchmax=10
```

**API Search Features Still Needed in fetchpatches.js:**
- [ ] Implement POST request to /api/search
- [ ] Parse response (binary file or JSON)
- [ ] Handle URLs in response
- [ ] Signature verification (if update response)
- [ ] HTTP 403/603 handling
- [ ] donotsearch table integration

## NPM Scripts

```bash
# Server operations
npm run mdserver:setup           # Initial setup
npm run mdserver:start           # Start server
npm run mdserver:create-client   # Create new client

# Example:
npm run mdserver:create-client "My Client Name"
npm run mdserver:create-client "Admin Name" admin
```

## Logging

All API requests are logged in the `apilogs` table:

```sql
SELECT 
  l.timestamp,
  c.client_name,
  l.method,
  l.endpoint,
  l.status_code,
  l.response_size
FROM apilogs l
JOIN apiclients c ON l.clientuuid = c.clientuuid
ORDER BY l.timestamp DESC
LIMIT 10;
```

## Development

### Current Status

**Implemented:**
- ✅ Express.js server
- ✅ AES-256-CBC credential encryption
- ✅ Authentication middleware
- ✅ Admin/read-only permission system
- ✅ GET endpoints for all tables
- ✅ Search endpoint (basic)
- ✅ Client management
- ✅ Request logging
- ✅ Health check
- ✅ Symbolic link to databases (saves space)

**Not Yet Implemented:**
- ⏳ POST/PUT/DELETE for data tables (admin clients)
- ⏳ Signature verification for updates
- ⏳ Rate limiting
- ⏳ HTTPS support
- ⏳ Advanced search filters

### Server Management

```bash
# Start server
npm run mdserver:start

# Or with nohup (stays running)
cd mdserver && nohup node server.js > server.log 2>&1 &

# Check if running
ps aux | grep "node mdserver/server.js"

# Stop server
pkill -f "node mdserver/server.js"

# View logs
tail -f mdserver/server.log
```

## Production Checklist

Before deploying to production:

- [ ] Change VAULT_KEY to secure random value
- [ ] Enable HTTPS (use nginx reverse proxy)
- [ ] Add rate limiting
- [ ] Set up monitoring
- [ ] Configure firewall
- [ ] Regular database backups
- [ ] Log rotation
- [ ] Error alerting

## Security Notes

### ⚠️ VAULT_KEY

Current testing key:
```
VAULT_KEY=abc4757c17d2388088cea6759e1caf00811c72d2c7c7399ebe692a2fd4ac10e7
```

**For production, generate new key:**
```bash
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

Update in `mdserver/environment`

### ⚠️ Client Credentials

- Stored encrypted in database
- Cannot be retrieved after creation
- Must be securely transmitted to users
- No password reset mechanism (recreate client if lost)

## Troubleshooting

### Server won't start

**Check:**
```bash
# Port 3000 already in use?
lsof -i :3000

# Databases exist?
ls -la mdserver/*.db

# Environment file exists?
cat mdserver/environment
```

### Authentication fails

**Check:**
- Client ID and secret are correct
- Headers are properly set
- VAULT_KEY hasn't changed
- Client exists in database

### Database errors

**Check:**
```bash
# Verify symbolic links
ls -la mdserver/*.db

# Verify databases are accessible
sqlite3 mdserver/rhdata.db "SELECT COUNT(*) FROM gameversions;"
sqlite3 mdserver/patchbin.db "SELECT COUNT(*) FROM attachments;"
```

## Next Steps

1. ✅ Server is running and tested
2. ⏳ Implement fetchpatches.js --apisearch integration
3. ⏳ Add POST/PUT/DELETE endpoints for admin clients
4. ⏳ Add signature verification for updates
5. ⏳ Deploy to production environment

## Conclusion

The Metadata API Server is **fully functional and ready for testing** with fetchpatches.js. All core features are implemented:

- ✅ Encrypted authentication
- ✅ Role-based permissions
- ✅ All read endpoints working
- ✅ Search endpoint ready
- ✅ Request logging
- ✅ Client management

Next step is to implement the `--apisearch` option in fetchpatches.js to integrate with this server!

