# Quick Reference Card - fetchpatches.js & mdserver

## fetchpatches.js - Quick Commands

### Mode 1: Populate ArDrive Metadata
```bash
node fetchpatches.js mode1                    # Default (20 attachments)
node fetchpatches.js mode1 --fetchlimit=50    # Process 50 attachments
```

### Mode 2: Find Missing Files
```bash
# Default (local search only)
node fetchpatches.js mode2

# IPFS search (with CID auto-conversion: bafy ↔ bafk)
node fetchpatches.js mode2 --searchipfs

# Download from URLs
node fetchpatches.js mode2 --download

# API search (with signatures + timestamp validation)
node fetchpatches.js mode2 --apisearch \
  --apiurl=https://api.example.com/search \
  --apiclient=YOUR_UUID \
  --apisecret=YOUR_SECRET

# Combined search
node fetchpatches.js mode2 --searchipfs --download --apisearch
```

### Mode 3: Retrieve Specific Data
```bash
# View game metadata (JSON)
node fetchpatches.js mode3 "Super Mario World" -b gameid

# View all versions
node fetchpatches.js mode3 "Mario" -b gameid --multiple

# Get raw patchblob (encrypted)
node fetchpatches.js mode3 patch.bin -q rawpblob -o output.bin

# Get decoded patch (decrypted + verified)
node fetchpatches.js mode3 <gvuuid> -b gvuuid -q patch

# Auto-named output (shake128 hash in temp/)
node fetchpatches.js mode3 test.bin -q patch

# Search by UUID
node fetchpatches.js mode3 <auuid> -b file_name -q patch -o my_patch.bin

# With IPFS search if not found
node fetchpatches.js mode3 test.bin -q patch --searchipfs
```

### Add Sizes
```bash
node fetchpatches.js addsizes    # Populate file_size from file_data
```

---

## mdserver - Quick Commands

### Initial Setup
```bash
npm run mdserver:setup                # Initialize server environment
npm run mdserver:create-signer        # Create signing keypairs
npm run mdserver:sign-metadata -- --all  # Sign all metadata
npm run mdserver:create-client        # Create API client
```

### Running
```bash
npm run mdserver:start                # Start on port 3000
```

### Maintenance
```bash
npm run mdserver:migrate-signatures   # Update database schema
npm run mdserver:cleanup-signatures   # Archive old signatures
```

---

## Client API Credentials

### Setup
```bash
# 1. Set encryption key
export RHTCLIENT_VAULT_KEY=$(openssl rand -hex 32)

# 2. Add apiservers table
npm run client:migrate-apiserver

# 3. Add server credentials
npm run client:add-apiserver
```

### Management
```bash
npm run client:list-apiservers         # List all servers
npm run client:test-apiserver <uuid>   # Test connection
node electron/manage_apiserver.js remove <uuid>  # Remove server
```

---

## Testing

### Complete Test Workflow
```bash
npm run test:setup            # Create test databases
npm run test:create-signers   # Generate test signers
npm run test:mode3            # Create Mode 3 test data
npm run test:e2e              # Run end-to-end test
```

### Individual Tests
```bash
npm run test:server           # Launch test server (port 3001)
npm run test:mode3            # Setup Mode 3 test data
```

---

## Common Options

### Global Options (all modes)
```bash
--fetchlimit=N       # Limit attachments (default: 20)
--fetchdelay=MS      # Delay between downloads (default: 2000ms)
--patchbindb=PATH    # Custom patchbin.db (testing)
--rhdatadb=PATH      # Custom rhdata.db (testing)
```

### Mode 2 Search Options
```bash
--searchmax=N              # Max attachments to search
--maxfilesize=SIZE         # Max download size (default: 200MB)
--nosearchlocal            # Disable local search
--searchlocalpath=PATH     # Add local path
--searchardrive            # Search ArDrive
--searchipfs               # Search IPFS (auto CID conversion)
--ipfsgateway=URL          # IPFS gateway (supports %CID%)
--download                 # Try download_urls
--apisearch                # Use API
--apiurl=URL               # API endpoint
--apiclient=ID             # API client UUID
--apisecret=SECRET         # API client secret
```

### Mode 3 Options
```bash
-b, --by=TYPE        # Search by: gameid, file_name, gvuuid, pbuuid
-q, --query=TYPE     # Query: gameversions, rawpblob, patch
-p, --print          # Print to stdout
-o, --output=FILE    # Save to file
--multiple           # All versions (gameversions query)
+ Mode 2 options     # If file not found
```

---

## Environment Variables

### Client
```bash
RHTCLIENT_VAULT_KEY    # 64-char hex (for API credentials)
CLIENTDATA_DB          # Path to clientdata.db (optional)
```

### Server
```bash
VAULT_KEY              # 64-char hex (for client credentials)
SERVER_SIGNER_UUID     # Server signer UUID
SERVER_PRIVATE_KEY_HEX # Server private key (hex)
PORT                   # Server port (default: 3000)
```

---

## Quick Troubleshooting

### "No server signature - REJECTING"
- Server not configured with signing key
- Check SERVER_SIGNER_UUID and SERVER_PRIVATE_KEY_HEX

### "Server response is TOO OLD"
- Timestamp >24 hours (replay attack protection)
- Check server and client clocks

### "file_data hash validation failed"
- Downloaded file doesn't match expected hash
- File may be corrupted or wrong file

### "IPFS file not found"
- Try both CID formats (auto-converted: bafy ↔ bafk)
- Try different gateway
- Check CID is correct

### "Authentication failed"
- Check API client credentials
- Verify VAULT_KEY matches on server
- Test connection: `npm run client:test-apiserver <uuid>`

---

## File Locations

### Databases
```
electron/rhdata.db         # Game versions (read-only)
electron/patchbin.db       # Patches, attachments, signatures
clientdata.db              # Client settings, API credentials
mdserver/mdserverdata.db   # Server internal data
```

### Output
```
temp/                      # Auto-generated files (shake128 names)
```

### Logs
```
mdserver/log_mdsign_new.json         # New signatures
mdserver/log_mdsign_historical.json  # Archived signatures
```

---

## Security Checklist

### For Production

- [ ] Use HTTPS for API server
- [ ] Setup NTP on server (accurate time)
- [ ] Generate unique VAULT_KEY (client and server)
- [ ] Store keys securely (not in version control)
- [ ] Create production signers (metadata + server)
- [ ] Sign all metadata records
- [ ] Create API clients with strong secrets
- [ ] Test API authentication
- [ ] Monitor timestamp rejections
- [ ] TODO: Integrate OS keychain

---

## Performance Tips

### Mode 1
- Use `--fetchlimit` to control batch size
- Add `--fetchdelay` to avoid server overload

### Mode 2
- Start with `--searchlocal` (fastest)
- Add `--searchipfs` if needed
- Use `--apisearch` last (requires network)
- Set `--maxfilesize` to avoid huge downloads

### Mode 3
- Search by UUID is fastest
- Use `--patchbindb` for testing
- Decoded patches cached in database

---

## Links to Full Documentation

- **Option G:** `docs/OPTION_G_IMPLEMENTATION.md`
- **Mode 3:** `docs/FETCHPATCHES_MODE3.md`
- **API Credentials:** `docs/CLIENT_API_CREDENTIALS.md`
- **Security:** `docs/REPLAY_ATTACK_PROTECTION.md`
- **IPFS:** `docs/IPFS_CID_FORMATS.md`
- **Testing:** `tests/README_TESTS.md`
- **Complete Summary:** `docs/SESSION_SUMMARY.md`

---

**Last Updated:** October 11, 2025

