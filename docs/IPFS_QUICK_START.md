# IPFS Gateway Features - Quick Start

## ✅ Addendum Implementation Complete

All features from `MODE2_FUNCTIONS_ADDENDUM1.txt` have been implemented and tested.

## What Was Added

### 1. Priority Column in Database ✅

```sql
-- Added to ipfsgateways table
priority INTEGER DEFAULT 100
notes TEXT
```

### 2. Multiple Gateway Support ✅

```bash
# Use multiple gateways (tries in order)
node fetchpatches.js mode2 --searchipfs \
  --ipfsgateway=https://gateway1.com/ipfs/%CID% \
  --ipfsgateway=https://gateway2.com/ipfs/%CID%
```

### 3. %CID% Placeholder ✅

```bash
# URLs with %CID% get it replaced with actual CID
--ipfsgateway=https://example.com/ipfs/%CID%
# Becomes: https://example.com/ipfs/QmActualCID...

# URLs without %CID% get standard pattern
--ipfsgateway=https://example.com
# Becomes: https://example.com/ipfs/QmActualCID...
```

### 4. Database Gateway Loading ✅

```bash
# If no --ipfsgateway specified, loads from database
node fetchpatches.js mode2 --searchipfs

# Uses gateways from ipfsgateways table + defaults
# Skips gateways that failed in last 10 minutes
```

### 5. Gateway Verification ✅

```bash
# Before searching, verifies each gateway works
# Tests with: bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m
# Expects: "Hello from IPFS Gateway Checker"
# Waits 2 seconds between checks
```

### 6. Failure Tracking ✅

```bash
# Updates database when gateway fails
# Sets notworking_timestamp = NOW
# Stores error message
# Skips for 10 minutes
```

## Quick Setup

### Step 1: Migrate Existing Database

```bash
# Add priority and notes columns to ipfsgateways table
npm run migrate:ipfsgateways
```

### Step 2: Update Gateway URLs

```bash
# Add %CID% placeholders and set priorities
npm run update:ipfsgateways
```

### Step 3: Verify

```bash
# Check database
sqlite3 electron/patchbin.db "SELECT priority, url, notes FROM ipfsgateways ORDER BY priority;"
```

Expected output:
```
10|https://ipfs.io/ipfs/%CID%|Official IPFS gateway
20|https://gateway.pinata.cloud/ipfs/%CID%|Pinata IPFS gateway
40|https://dweb.link/ipfs/%CID%|Protocol Labs gateway
...
```

### Step 4: Test

```bash
# Run test suite
npm run test:mode2

# Test with actual Mode 2
node fetchpatches.js mode2 --searchipfs --searchmax=1
```

## Current Database State

**6 IPFS gateways configured:**

1. ⭐ ipfs.io (Priority 10) - Official
2. ⭐ gateway.pinata.cloud (Priority 20) - Pinata
3. dweb.link (Priority 40) - Protocol Labs
4. ipfs.4everland.io (Priority 50) - 4everland
5. ipfs.filebase.io (Priority 60) - Filebase
6. storry.tv (Priority 70) - Storry

All URLs have `%CID%` placeholder for proper CID replacement.

## Usage Examples

### Use Database Gateways (Recommended)

```bash
node fetchpatches.js mode2 --searchipfs --searchmax=10
```

**Result:**
- Loads 6 gateways from database
- Verifies all (12 seconds)
- Uses working gateways for searches

### Custom Gateway Only

```bash
node fetchpatches.js mode2 --searchipfs --ipfsgateway=https://my-gateway.com/ipfs/%CID% --searchmax=5
```

**Result:**
- Uses only custom gateway
- Verifies (2 seconds)
- Falls back to database gateways if custom fails

### Multiple Custom Gateways

```bash
node fetchpatches.js mode2 --searchipfs \
  --ipfsgateway=https://primary.com/ipfs/%CID% \
  --ipfsgateway=https://backup.com/ipfs/%CID% \
  --searchmax=10
```

**Result:**
- Tries primary first
- Tries backup if primary fails
- Tries database gateways if both fail

## Adding New Gateways

### Via Database

```bash
sqlite3 electron/patchbin.db
```

```sql
INSERT INTO ipfsgateways (gwuuid, url, priority, notes) 
VALUES (
  '12345678-1234-1234-1234-123456789abc',
  'https://my-new-gateway.com/ipfs/%CID%',
  15,
  'My custom IPFS gateway'
);
```

### Via Command Line (One-time use)

```bash
node fetchpatches.js mode2 --searchipfs --ipfsgateway=https://new-gateway.com/ipfs/%CID%
```

## Troubleshooting

### Gateway verification fails

```
Testing: https://ipfs.io/ipfs/%CID%
  ✗ Failed: timeout
```

**Cause:** Network issue, gateway down, or firewall blocking

**Solution:**
- Check internet connection
- Try different gateway: `--ipfsgateway=https://gateway.pinata.cloud/ipfs/%CID%`
- Gateway will be automatically retried after 10 minutes

### No working gateways

```
⚠ No working IPFS gateways available
IPFS search will be skipped
```

**Cause:** All gateways failed verification

**Solution:**
- Check internet connectivity
- Wait 10 minutes (gateways will be retried)
- Add custom working gateway: `--ipfsgateway=https://working-gateway.com/ipfs/%CID%`

### Files not found on IPFS

```
🌐 Searching IPFS...
  Trying gateway 1/6: https://ipfs.io/ipfs/QmTest123
    HTTP 404
  ...
  ✗ File not found on any IPFS gateway
```

**Cause:** File may not be pinned on IPFS, or CID is incorrect

**Solution:**
- Verify CID is correct in database
- Try other search options: `--searchardrive --download`
- File may only exist locally

## Scripts Available

```bash
# Migration and setup
npm run migrate:ipfsgateways    # Add priority/notes columns
npm run update:ipfsgateways     # Update URLs with %CID%

# Testing
npm run test:mode2              # Run full test suite

# Mode 2 with IPFS
npm run fetchpatches:mode2 -- --searchipfs --searchmax=10
```

## Documentation

- **`IPFS_ADDENDUM_IMPLEMENTATION.md`** - Detailed implementation docs
- **`IPFS_ADDENDUM_COMPLETE.txt`** - Status summary
- **`IPFS_QUICK_START.md`** - This guide
- **`MODE2_FUNCTIONS_ADDENDUM1.txt`** - Original specification
- **`FETCHPATCHES_MODE2.md`** - Complete Mode 2 documentation

## Status

✅ **100% Complete**  
✅ **All Tests Passing**  
✅ **Production Ready**  
✅ **6 Gateways Configured**  
✅ **Database Migrated**  

You can now use Mode 2 with full IPFS gateway support! 🎉

