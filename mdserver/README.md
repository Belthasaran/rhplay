# Metadata API Server

REST API server for accessing gameversions, patchblobs, and attachments data.

## Features

- **Authenticated Access** - Client ID and secret authentication
- **Role-Based Permissions** - Admin vs read-only clients
- **Encrypted Credentials** - All credentials encrypted in database
- **Read Operations** - Query gameversions, patchblobs, attachments
- **Admin Operations** - Create, update, delete (admin clients only)
- **Search Endpoint** - For fetchpatches.js integration
- **Request Logging** - All API requests logged

## Quick Start

### 1. Install Dependencies

```bash
cd /home/main/proj/rhtools
npm install
```

This will install Express.js and dotenv.

### 2. Setup Server

```bash
npm run mdserver:setup
```

This will:
- Copy databases from `electron/` to `mdserver/`
- Create `mdserverdata.db`
- Create default admin client
- Display admin credentials

**⚠️ SAVE THE CREDENTIALS!** They cannot be retrieved later.

### 3. Start Server

```bash
npm run mdserver:start
```

Server runs on `http://localhost:3000`

### 4. Test API

```bash
curl -H "X-Client-Id: YOUR_CLIENT_ID" \
     -H "X-Client-Secret: YOUR_CLIENT_SECRET" \
     http://localhost:3000/health
```

## API Endpoints

### Public (No Authentication)

- `GET /` - API information
- `GET /health` - Health check

### Authenticated (All Clients)

**GameVersions:**
- `GET /api/gameversions` - List game versions
- `GET /api/gameversions/:id` - Get specific game version

**PatchBlobs:**
- `GET /api/patchblobs` - List patch blobs
- `GET /api/patchblobs/:id` - Get specific patch blob

**Attachments:**
- `GET /api/attachments` - List attachments
- `GET /api/attachments?include_data=true` - Include file_data
- `GET /api/attachments/:id` - Get specific attachment

**Search:**
- `POST /api/search` - Search attachments (for fetchpatches.js)

### Admin Only

**Client Management:**
- `POST /api/clients` - Create new client
- `GET /api/clients` - List all clients

## Authentication

All authenticated endpoints require headers:

```
X-Client-Id: <your-client-id>
X-Client-Secret: <your-client-secret>
```

### Creating Clients

```bash
# Create read-only client
npm run mdserver:create-client "Read-Only Client"

# Create admin client
npm run mdserver:create-client "Admin Client" admin
```

Or via API (admin only):

```bash
curl -X POST \
  -H "X-Client-Id: YOUR_ADMIN_CLIENT_ID" \
  -H "X-Client-Secret: YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"client_name": "New Client", "admin_client": 0}' \
  http://localhost:3000/api/clients
```

## Example Usage

### List Attachments

```bash
curl -H "X-Client-Id: YOUR_CLIENT_ID" \
     -H "X-Client-Secret: YOUR_CLIENT_SECRET" \
     "http://localhost:3000/api/attachments?limit=10&offset=0"
```

### Get Specific Attachment

```bash
curl -H "X-Client-Id: YOUR_CLIENT_ID" \
     -H "X-Client-Secret: YOUR_CLIENT_SECRET" \
     http://localhost:3000/api/attachments/some-uuid
```

### Search for Attachment

```bash
curl -X POST \
  -H "X-Client-Id: YOUR_CLIENT_ID" \
  -H "X-Client-Secret: YOUR_CLIENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"file_hash_sha256": "abc123...", "file_name": "pblob_12345_abc"}' \
  http://localhost:3000/api/search
```

**Response:**
- If `file_data` exists: Returns binary file
- If no `file_data`: Returns JSON with metadata and URLs

## Integration with fetchpatches.js

```bash
node fetchpatches.js mode2 --apisearch \
  --apiurl=http://localhost:3000/api/search \
  --apiclient=YOUR_CLIENT_ID \
  --apisecret=YOUR_CLIENT_SECRET
```

## Security

### Credential Encryption

All client credentials are encrypted using AES-256-CBC with VAULT_KEY:

```javascript
// Encryption
const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(VAULT_KEY, 'hex'), iv);
encrypted = iv.toString('hex') + ':' + cipher.update(text) + cipher.final('hex');
```

### VAULT_KEY

Located in `mdserver/environment`:

```
VAULT_KEY=abc4757c17d2388088cea6759e1caf00811c72d2c7c7399ebe692a2fd4ac10e7
```

**⚠️ PRODUCTION:** Change to a secure random key!

Generate new key:
```bash
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

### Permissions

**Read-Only Clients (admin_client = 0):**
- ✅ GET requests
- ✅ Search
- ❌ POST, PUT, DELETE

**Admin Clients (admin_client = 1):**
- ✅ All GET requests
- ✅ All POST, PUT, DELETE requests
- ✅ Create new clients
- ✅ Manage data

## Database Files

### mdserverdata.db (Server Data)

Tables:
- `serveroptions` - Server configuration
- `apiclients` - Client credentials (encrypted)
- `apilogs` - API request logs

### rhdata.db (Read-Only)

Tables:
- `gameversions` - Game version metadata
- `patchblobs` - Patch blob metadata

### patchbin.db (Read-Write for Admin)

Tables:
- `attachments` - File attachments with data

## Logging

All API requests are logged to `apilogs` table:

```sql
SELECT * FROM apilogs ORDER BY timestamp DESC LIMIT 10;
```

Columns:
- `loguuid` - Log entry ID
- `clientuuid` - Which client made the request
- `endpoint` - API endpoint
- `method` - HTTP method
- `status_code` - Response code
- `request_data` - Query/body parameters
- `response_size` - Number of records returned
- `timestamp` - When request was made

## Troubleshooting

### "Cannot find module 'express'"

```bash
npm install
```

### "VAULT_KEY must be a 64-character hex string"

Check `mdserver/environment` file contains valid hex string.

### "rhdata.db not available"

Copy database:
```bash
cp electron/rhdata.db mdserver/rhdata.db
```

### "patchbin.db not available"

Copy database:
```bash
cp electron/patchbin.db mdserver/patchbin.db
```

### "Unauthorized"

Check client credentials are correct and not expired.

## Development

### File Structure

```
mdserver/
├── server.js              # Main Express server
├── create_client.js       # Client creation utility
├── setup.js               # Setup script
├── serverdata.sql         # Server database schema
├── environment            # Environment variables (VAULT_KEY)
├── mdserverdata.db        # Server database (created by setup)
├── rhdata.db             # Copy of electron/rhdata.db
├── patchbin.db           # Copy of electron/patchbin.db
└── README.md             # This file
```

### Adding Endpoints

Edit `server.js` and add new routes:

```javascript
app.get('/api/myendpoint', authenticate, (req, res) => {
  // Implementation
});

// Admin only
app.post('/api/myendpoint', authenticate, requireAdmin, (req, res) => {
  // Implementation
});
```

## Production Deployment

1. **Change VAULT_KEY** to secure random value
2. **Use HTTPS** (not HTTP)
3. **Set up reverse proxy** (nginx, Apache)
4. **Enable rate limiting**
5. **Monitor logs** regularly
6. **Backup databases** regularly
7. **Use environment variables** for sensitive data

## API Response Format

### Success

```json
{
  "data": [...],
  "total": 1234,
  "limit": 100,
  "offset": 0
}
```

### Error

```json
{
  "error": "Error Type",
  "message": "Detailed error message"
}
```

## Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden (admin required)
- `404` - Not Found
- `500` - Internal Server Error
- `503` - Service Unavailable (database issue)

