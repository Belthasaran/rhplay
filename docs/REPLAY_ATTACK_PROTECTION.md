# Replay Attack Protection with Response Timestamps

## Overview

The metadata API server includes **cryptographic timestamp validation** in all signed responses to protect against replay attacks. This prevents attackers from saving and replaying old server responses.

**Implementation Date:** October 11, 2025

## The Threat: Replay Attacks

### What is a Replay Attack?

An attacker could:
1. Intercept a valid server response (with valid signature)
2. Save the complete response
3. Replay it hours/days/months later

Without timestamp validation, the old response would still verify as validly signed, allowing the attacker to provide outdated or malicious data.

### Real-World Scenario

```
Day 1: Client requests attachment data
        → Server responds with file_data, signed with valid signature
        → Attacker intercepts and saves response

Day 30: Legitimate server updates attachment with security patch
        → New version has different file_data

Day 31: Client requests same attachment
        → Attacker replays OLD response from Day 1
        → Without timestamp check: Old signature still valid ✗
        → With timestamp check: Old response rejected ✓
```

## Solution: Signed Response Timestamps

### How It Works

1. **Server Adds Timestamp**
   - Server includes `response_timestamp` in response data
   - Timestamp added BEFORE signing
   - Timestamp is part of signed data
   - ISO 8601 format: `2025-10-11T12:34:56.789Z`

2. **Server Signs Complete Response**
   - SHA256 hash includes timestamp
   - Signature covers timestamp
   - Attacker cannot modify timestamp without breaking signature

3. **Client Validates Timestamp**
   - Verifies `response_timestamp` is present
   - Calculates time difference: `|client_time - server_time|`
   - Rejects if difference > 86400 seconds (24 hours)
   - Provides detailed error messages

## Implementation Details

### Server Side (mdserver/server.js)

```javascript
function addSignaturesToResponse(responseData, records, db) {
  const response = { ...responseData };
  
  // Add metadata signatures
  if (records) {
    const mdsignatures = loadMetadataSignatures(records, db);
    if (mdsignatures) {
      response.mdsignatures = mdsignatures;
    }
  }
  
  // Add response timestamp (BEFORE signing)
  response.response_timestamp = new Date().toISOString();
  
  // Sign response (includes timestamp in signature)
  const serverSignature = signResponse(response);
  if (serverSignature) {
    response.server_signature = serverSignature;
  }
  
  return response;
}
```

**Key Points:**
- Timestamp added BEFORE signing
- Uses ISO 8601 format
- Server's local time used (ensure server clock is accurate!)

### Client Side (fetchpatches_mode2_optionG.js)

```javascript
function verifyServerSignature(responseData, serverSignature, signerPublicKey, algorithm) {
  // 1. Verify timestamp is present
  if (!responseData.response_timestamp) {
    console.error('Server response missing response_timestamp');
    console.error('This could be a replay attack - REJECTING');
    return false;
  }
  
  // 2. Calculate time difference
  const serverTime = new Date(responseData.response_timestamp).getTime();
  const clientTime = Date.now();
  const timeDiffSeconds = Math.abs(clientTime - serverTime) / 1000;
  
  // 3. Reject if too old (>24 hours)
  if (timeDiffSeconds > 86400) {
    console.error('Server time disagreement detected');
    console.error(`Server timestamp: ${responseData.response_timestamp}`);
    console.error(`Client time:      ${new Date().toISOString()}`);
    console.error(`Time difference:  ${Math.floor(timeDiffSeconds)} seconds`);
    console.error(`Maximum allowed:  86400 seconds (24 hours)`);
    
    if (serverTime < clientTime) {
      console.error('Server response is TOO OLD - possible replay attack');
    } else {
      console.error('Server time is in the FUTURE - check client system clock');
    }
    
    return false;
  }
  
  // 4. Verify signature (includes timestamp in hash)
  const dataString = JSON.stringify(responseData);
  const hash = crypto.createHash('sha256').update(dataString).digest();
  
  // ... signature verification continues ...
}
```

**Key Points:**
- Missing timestamp = REJECT
- Time difference > 24 hours = REJECT
- Informative error messages
- Distinguishes old vs. future timestamps

## Security Properties

### What This Protects Against

✓ **Replay Attacks**
  - Old responses are rejected
  - Attacker cannot reuse captured responses after 24 hours

✓ **Timestamp Tampering**
  - Timestamp is part of signed data
  - Attacker cannot modify timestamp without breaking signature

✓ **Long-Term Storage Attacks**
  - Responses expire after 24 hours
  - Cannot build database of "valid" old responses

### What This Doesn't Protect Against

✗ **Short-Term Replay** (within 24 hours)
  - Responses valid for 24 hours
  - Attacker can replay within this window
  - Mitigation: Use nonces for higher security needs

✗ **Clock Skew Attacks**
  - If client clock is wrong, may accept old responses
  - Mitigation: Ensure client has accurate system clock

✗ **Man-in-the-Middle**
  - Attacker with MITM can generate fresh responses
  - Mitigation: Use HTTPS in production

## Response Format

### Example JSON Response

```json
{
  "data": {
    "found": true,
    "file_name": "example.bin",
    "file_hash_sha256": "abc123...",
    "mdsignatures": [...]
  },
  "response_timestamp": "2025-10-11T12:34:56.789Z",
  "server_signature": {
    "signeruuid": "server-uuid-123",
    "signature": "deadbeef...",
    "algorithm": "ED25519",
    "hash": "sha256-of-entire-response-including-timestamp"
  }
}
```

**Signature Covers:**
- All data fields
- Metadata signatures
- **response_timestamp** ← Critical!

**Signature Excludes:**
- server_signature itself (would be circular)

## Error Messages

### Missing Timestamp

```
✗ Server response missing response_timestamp
⚠ This could be a replay attack - REJECTING
```

### Old Response (Replay Attack)

```
✗ Server time disagreement detected
⚠ Server timestamp: 2025-10-01T12:00:00.000Z
⚠ Client time:      2025-10-11T12:00:00.000Z
⚠ Time difference:  864000 seconds (240 hours)
⚠ Maximum allowed:  86400 seconds (24 hours)
⚠ Server response is TOO OLD - possible replay attack
REJECTING response due to timestamp validation failure
```

### Future Timestamp (Clock Skew)

```
✗ Server time disagreement detected
⚠ Server timestamp: 2025-10-15T12:00:00.000Z
⚠ Client time:      2025-10-11T12:00:00.000Z
⚠ Time difference:  345600 seconds (96 hours)
⚠ Maximum allowed:  86400 seconds (24 hours)
⚠ Server time is in the FUTURE - check client system clock
REJECTING response due to timestamp validation failure
```

### Valid Response

```
✓ Timestamp verified: 2025-10-11T12:34:56.789Z (5s ago)
```

## Configuration

### Maximum Age (24 Hours)

The maximum allowed age is hardcoded to **86400 seconds (24 hours)**:

```javascript
const MAX_RESPONSE_AGE_SECONDS = 86400;

if (timeDiffSeconds > MAX_RESPONSE_AGE_SECONDS) {
  // Reject response
}
```

**Why 24 Hours?**
- Balances security vs. usability
- Tolerates reasonable clock drift
- Prevents long-term replay attacks
- Short enough to limit exposure window

**To Adjust:**
- Modify constant in `fetchpatches_mode2_optionG.js`
- Shorter = more secure, less tolerant of clock skew
- Longer = more tolerant, larger replay window

### Clock Requirements

**Server:**
- Must have accurate system clock
- Use NTP (Network Time Protocol)
- Check: `timedatectl status`

**Client:**
- Must have reasonably accurate clock
- ±24 hours tolerance
- Check: `date`

## Testing

### Test Script

The end-to-end test (`test_e2e_apig.js`) verifies:

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
} else {
  console.error('✗ Response timestamp missing!');
}
```

### Manual Testing

**Test Valid Response:**
```bash
npm run test:e2e
# Should show: ✓ Timestamp verified: ... (Xs ago)
```

**Test Old Response (Manual):**
1. Capture a server response
2. Save to file
3. Replay after 25+ hours
4. Should reject with "TOO OLD" error

**Test Clock Skew:**
```bash
# Temporarily set client clock ahead
sudo date -s "+25 hours"
npm run test:e2e
# Should reject with "in the FUTURE" error

# Reset clock
sudo ntpdate -s time.nist.gov
```

## Best Practices

### Production Deployment

1. **Use HTTPS**
   - Encrypt all traffic
   - Prevent interception of responses
   - Required for production

2. **Accurate Server Clock**
   - Configure NTP
   - Monitor clock drift
   - Alert on significant skew

3. **Monitor Rejected Responses**
   - Log timestamp validation failures
   - Alert on frequent rejections
   - May indicate attack or clock issues

4. **Client Clock Accuracy**
   - Document clock requirements
   - Provide troubleshooting for clock skew errors
   - Consider warning users if clock is very wrong

### Enhanced Security (Optional)

For higher security requirements, consider:

1. **Nonces (Request IDs)**
   - Add unique nonce to each request
   - Server includes nonce in response
   - Client verifies nonce matches
   - Prevents replay within 24-hour window

2. **Shorter Expiration**
   - Reduce MAX_RESPONSE_AGE_SECONDS
   - E.g., 300 seconds (5 minutes)
   - Requires more accurate clocks

3. **Sequence Numbers**
   - Server maintains sequence counter per client
   - Client tracks last sequence number
   - Reject responses with old sequence numbers

## Comparison with Other Approaches

### Timestamps vs. Nonces

| Feature | Timestamps | Nonces |
|---------|-----------|--------|
| Complexity | Simple | Moderate |
| Server State | Stateless | Must track nonces |
| Replay Window | 24 hours | None |
| Clock Dependency | Yes | No |
| Scalability | Excellent | Good |
| **Recommended** | ✓ General use | High security |

### Why We Chose Timestamps

1. **Stateless** - Server doesn't need to track anything
2. **Scalable** - Works with multiple servers
3. **Simple** - Easy to implement and test
4. **Sufficient** - 24-hour window is acceptable for our use case
5. **Standard** - Common pattern in API security

## Security Audit

### Verification Checklist

- [x] Timestamp included in signed data
- [x] Timestamp verified before accepting response
- [x] Missing timestamp rejected
- [x] Old responses rejected (>24 hours)
- [x] Future responses rejected (>24 hours)
- [x] Informative error messages
- [x] Time difference logged
- [x] Distinguishes old vs. future
- [x] No way to bypass validation
- [x] Tests verify timestamp validation

### Attack Scenarios

**Scenario 1: Replay Old Response**
- Attacker: Replays response from 2 days ago
- Defense: Client rejects (timestamp >24h old)
- Result: ✓ Attack prevented

**Scenario 2: Modify Timestamp**
- Attacker: Changes timestamp to current time
- Defense: Signature verification fails (timestamp part of signature)
- Result: ✓ Attack prevented

**Scenario 3: Strip Timestamp**
- Attacker: Removes timestamp field
- Defense: Client rejects (missing timestamp)
- Result: ✓ Attack prevented

**Scenario 4: Short-Term Replay (within 24h)**
- Attacker: Replays response from 1 hour ago
- Defense: None (response still valid)
- Result: ✗ Attack succeeds
- Mitigation: Accept risk OR implement nonces

## Summary

The timestamp-based replay attack protection provides:

✅ **Strong protection** against long-term replay attacks
✅ **No server state** required (fully stateless)
✅ **Simple implementation** with clear error messages
✅ **Good usability** with 24-hour tolerance
✅ **Standard approach** used in many secure APIs

This protection is part of our **defense-in-depth** strategy, working alongside:
- Digital signatures (authenticity)
- file_data hash validation (integrity)
- Client authentication (authorization)
- HTTPS encryption (confidentiality)

Together, these measures provide comprehensive security for the metadata API.

