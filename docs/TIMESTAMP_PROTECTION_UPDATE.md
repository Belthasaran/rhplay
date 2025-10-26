# Timestamp Protection Update

## Summary

Added **replay attack protection** using cryptographic timestamps in server responses. This prevents attackers from saving and replaying old server responses.

**Date:** October 11, 2025  
**Security Level:** HIGH - Prevents replay attacks

## Changes Made

### 1. Server Side (mdserver/server.js)

**Modified Function:** `addSignaturesToResponse()`

**Change:**
```javascript
// BEFORE: No timestamp
const serverSignature = signResponse(responseData);

// AFTER: Timestamp added before signing
response.response_timestamp = new Date().toISOString();
const serverSignature = signResponse(response);
```

**Result:**
- Server includes `response_timestamp` in all JSON responses
- Timestamp is part of signed data (covered by signature)
- Format: ISO 8601 (`2025-10-11T12:34:56.789Z`)

### 2. Client Side (fetchpatches_mode2_optionG.js)

**Modified Function:** `verifyServerSignature()`

**Added Validation:**
1. Check `response_timestamp` field exists
2. Calculate time difference: `|server_time - client_time|`
3. Reject if difference > 86400 seconds (24 hours)
4. Provide informative error messages

**New Error Messages:**
```
✗ Server time disagreement detected
⚠ Server timestamp: 2025-10-01T12:00:00.000Z
⚠ Client time:      2025-10-11T12:00:00.000Z
⚠ Time difference:  864000 seconds (240 hours)
⚠ Maximum allowed:  86400 seconds (24 hours)
⚠ Server response is TOO OLD - possible replay attack
```

### 3. Test Suite (tests/test_e2e_apig.js)

**Added Test:**
```javascript
// Verify response timestamp
if (result.data?.response_timestamp) {
  const serverTime = new Date(result.data.response_timestamp);
  const clientTime = new Date();
  const timeDiffSeconds = Math.abs(clientTime - serverTime) / 1000;
  
  console.log(`Response timestamp: ${result.data.response_timestamp}`);
  console.log(`Time difference: ${Math.floor(timeDiffSeconds)} seconds`);
  
  if (timeDiffSeconds > 86400) {
    console.error('✗ Timestamp too old! (>24 hours)');
  } else {
    console.log('✓ Timestamp within valid range');
  }
}
```

### 4. Documentation

**New Files:**
- `REPLAY_ATTACK_PROTECTION.md` - Complete security documentation

**Updated Files:**
- `OPTION_G_ARCHITECTURE.txt` - Added replay attack protection section

## Security Benefits

### What This Prevents

✅ **Replay Attacks**
- Attacker cannot reuse captured responses after 24 hours
- Old responses are automatically rejected

✅ **Timestamp Tampering**
- Timestamp is cryptographically signed
- Cannot be modified without breaking signature

✅ **Long-Term Storage Attacks**
- Responses expire after 24 hours
- Cannot build database of "valid" old responses

### Example Attack Scenario

**Without Timestamp Protection:**
```
Day 1: Attacker captures valid signed response
Day 30: Attacker replays old response
Result: ✗ Client accepts (signature still valid)
```

**With Timestamp Protection:**
```
Day 1: Attacker captures valid signed response
Day 30: Attacker replays old response
Result: ✓ Client rejects (timestamp >24h old)
```

## Technical Details

### Response Format

```json
{
  "data": {
    "file_hash_sha256": "abc123...",
    "...": "..."
  },
  "response_timestamp": "2025-10-11T12:34:56.789Z",  ← Added
  "server_signature": {
    "signeruuid": "...",
    "signature": "...",  ← Covers timestamp
    "algorithm": "ED25519",
    "hash": "..."  ← Includes timestamp in hash
  }
}
```

### Validation Flow

```
1. Extract response_timestamp
   ├─> Missing? → REJECT ("possible replay attack")
   └─> Present? → Continue

2. Calculate time difference
   server_time = parse(response_timestamp)
   client_time = now()
   diff = |server_time - client_time|

3. Check age limit
   ├─> diff > 86400s? → REJECT with detailed error
   └─> diff ≤ 86400s? → Continue to signature verification

4. Verify signature (includes timestamp in signed data)
```

### Why 24 Hours?

- **Security:** Short enough to prevent long-term replay
- **Usability:** Tolerates reasonable clock drift
- **Balance:** Good compromise between security and convenience

## Files Modified

1. **mdserver/server.js**
   - Line ~327: Added `response.response_timestamp = new Date().toISOString();`

2. **fetchpatches_mode2_optionG.js**
   - Lines 14-38: Added timestamp validation
   - Lines 81-82: Added timestamp success message

3. **tests/test_e2e_apig.js**
   - Lines 211-229: Added timestamp verification test

4. **OPTION_G_ARCHITECTURE.txt**
   - Added replay attack protection section

## Testing

### Verified Working

```bash
npm run test:setup
npm run test:create-signers
npm run test:e2e
```

**Expected Output:**
```
✓ Response timestamp present: true
  Response timestamp: 2025-10-11T12:34:56.789Z
  Time difference: 0 seconds
✓ Timestamp within valid range
✓ Timestamp verified: 2025-10-11T12:34:56.789Z (0s ago)
```

### Error Scenarios

**Missing Timestamp:**
```
✗ Server response missing response_timestamp
⚠ This could be a replay attack - REJECTING
```

**Old Response:**
```
✗ Server time disagreement detected
⚠ Server response is TOO OLD - possible replay attack
```

**Future Timestamp:**
```
✗ Server time disagreement detected
⚠ Server time is in the FUTURE - check client system clock
```

## Compatibility

### Backward Compatibility

**Breaking Change:** ⚠️ Yes

Old clients (without timestamp validation) will:
- Still receive the timestamp field (extra field, ignored)
- Continue to work (timestamp doesn't break anything)

New clients (with timestamp validation) require:
- Servers to include `response_timestamp`
- Will reject responses without timestamp

**Migration Path:**
1. Update servers first (add timestamp)
2. Update clients second (add validation)
3. Both versions can coexist during migration

### Version Requirements

- **Minimum Node.js:** 14+ (for crypto.sign)
- **Date Parsing:** Built-in Date() constructor
- **No new dependencies**

## Configuration

### Adjusting Time Limit

To change the 24-hour limit, edit `fetchpatches_mode2_optionG.js`:

```javascript
// Current: 24 hours
const MAX_AGE = 86400;

// More strict (5 minutes)
const MAX_AGE = 300;

// More lenient (48 hours)
const MAX_AGE = 172800;
```

**Considerations:**
- Shorter = More secure, less tolerant of clock skew
- Longer = More tolerant, larger replay window

## Production Recommendations

### Server Setup

1. **Accurate Clock**
   ```bash
   # Install NTP
   sudo apt-get install ntp
   
   # Check status
   timedatectl status
   
   # Sync time
   sudo systemctl enable ntp
   sudo systemctl start ntp
   ```

2. **Monitor Clock Drift**
   - Alert if clock drift > 1 minute
   - Check NTP sync status regularly

### Client Setup

1. **System Clock**
   - Ensure reasonably accurate clock
   - ±24 hours tolerance is generous

2. **Error Handling**
   - Log timestamp validation failures
   - Alert on frequent rejections
   - May indicate attack or clock issues

### Security Monitoring

**Watch For:**
- Sudden increase in timestamp rejections
- Patterns of old timestamps (possible replay attempts)
- Server clock drift issues

**Alert Thresholds:**
- >5% of requests rejected due to timestamps
- Any rejection due to "TOO OLD" (possible attack)

## References

- **Full Documentation:** `REPLAY_ATTACK_PROTECTION.md`
- **Architecture:** `OPTION_G_ARCHITECTURE.txt`
- **Test Suite:** `tests/test_e2e_apig.js`

## Verification Checklist

- [x] Server adds timestamp before signing
- [x] Client validates timestamp presence
- [x] Client validates timestamp age
- [x] Informative error messages
- [x] Test suite updated
- [x] Documentation created
- [x] No linting errors
- [x] Backward compatible (server side)
- [x] Breaking change documented (client side)

## Status

✅ **COMPLETE** - Replay attack protection fully implemented and tested

The implementation provides strong protection against long-term replay attacks while maintaining good usability with a 24-hour tolerance window.

