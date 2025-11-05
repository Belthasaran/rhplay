# Trust Declarations: Nostr Signing Mechanism

## Overview

This document explains how Nostr keys are used to sign trust declarations and admin declarations. Unlike traditional cryptographic keys (ED25519, RSA, ML-DSA), Nostr keys require a special signing approach that creates proper Nostr events using the `finalizeEvent()` function from `nostr-tools`.

## Key Concepts

### Nostr Keys vs. Traditional Keys

**Traditional Keys (ED25519, RSA, ML-DSA):**
- Sign arbitrary data directly
- Create signatures over SHA256 hashes
- Can be used independently for any signing operation

**Nostr Keys:**
- Must create proper Nostr events
- Use Schnorr signatures over secp256k1
- Events are the fundamental unit of signing in Nostr
- Required for publishing to Nostr relays

### Why Nostr Keys Are Different

Nostr uses an event-based architecture where all data must be structured as **events**. An event is a JSON object with:
- `kind`: The event type (e.g., 31106 for admin declarations)
- `created_at`: Unix timestamp
- `tags`: Array of tag arrays
- `content`: The actual data payload
- `pubkey`: The public key (derived from private key)
- `id`: SHA256 hash of the event
- `sig`: Schnorr signature over the event

Signing with Nostr keys requires creating this event structure and using `finalizeEvent()` to compute the `id` and `sig`.

## Implementation

### Signing Process for Nostr Keys

When signing a trust declaration with a Nostr key:

1. **Create Format 2 Signed Data**
   - Declaration UUID
   - Declaration type
   - Content JSON (SHA256 hash)
   - Signing keypair canonical name
   - Signing keypair fingerprint
   - Target keypair information
   - Validity dates
   - Signing timestamp

2. **Create Nostr Event Template**
   ```javascript
   const eventTemplate = {
     kind: 31106,  // Admin declarations event kind
     created_at: Math.floor(Date.now() / 1000),  // Unix timestamp
     tags: [
       ['d', declarationRecord.declaration_uuid],  // Declaration UUID tag
       ['t', declarationRecord.declaration_type || 'trust-declaration'],  // Type tag
     ],
     content: signedDataJson  // Format 2 signed data as JSON string
   };
   ```

3. **Finalize the Event**
   ```javascript
   const { finalizeEvent } = require('nostr-tools');
   const privateKeyBytes = new Uint8Array(Buffer.from(signingKeypair.privateKey, 'hex'));
   const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);
   ```

4. **Extract Signature and Event ID**
   - `signature = signedEvent.sig`  // Schnorr signature
   - `nostr_event_id = signedEvent.id`  // Event ID (SHA256 of event)

5. **Create Format 3 with Nostr Event**
   - Include the full signed Nostr event in `signed_data`
   - Store `nostr_event_id` for publication
   - Store full `nostr_event` JSON for verification

### Signing Process for Non-Nostr Keys

For ED25519, RSA, and ML-DSA keys:

1. **Create Format 2 Signed Data** (same as above)

2. **Hash the Signed Data**
   ```javascript
   const signedDataHash = crypto.createHash('sha256')
     .update(signedDataJson)
     .digest('hex');
   ```

3. **Sign the Hash**
   - ED25519: `crypto.sign(null, hashBuffer, privateKey)`
   - RSA: `crypto.sign('sha256', hashBuffer, { key: privateKey, padding: ... })`
   - ML-DSA: (Placeholder - not yet implemented)

4. **Create Format 3 with Signature**
   - Include signature in `signed_data`
   - No Nostr event is created

## Wrapping Non-Nostr Signatures for Nostr Publication

### Requirement

**Non-Nostr key signatures cannot be published directly to Nostr.** They must be wrapped inside a Nostr event signed by a Nostr key.

### Why This Is Necessary

1. Nostr relays only accept properly formatted Nostr events
2. Nostr events must have a `kind`, `tags`, `content`, `id`, and `sig`
3. The signature must be a Schnorr signature over the event structure
4. Non-Nostr signatures are not compatible with Nostr's event model

### Implementation Strategy

When publishing a declaration signed with a non-Nostr key:

1. **Create Wrapper Event**
   - `kind`: 31106 (admin declarations)
   - `tags`: Include declaration UUID and type
   - `content`: Full Format 3 signed data (including non-Nostr signature)
   - `created_at`: Current timestamp

2. **Sign with Nostr Key**
   - Use an administrator's Nostr key to sign the wrapper event
   - This requires at least one Nostr key in the admin keypairs

3. **Store Both Signatures**
   - Original signature (non-Nostr) in `signed_data`
   - Wrapper event signature (Nostr) in `nostr_event` field
   - Both signatures are valid for verification

### Administrator Requirement

**The administrator must have at least 1 Nostr key at all times** to be able to:
- Sign declarations directly with Nostr keys
- Wrap non-Nostr signatures for Nostr publication
- Publish declarations to Nostr relays

## Countersignatures

### Nostr Key Countersignatures

When adding a countersignature with a Nostr key:
- Create a new Nostr event with the same content
- Use `finalizeEvent()` to sign it
- Store the event in the `countersignatures` JSON array
- Each countersignature is a separate Nostr event

### Non-Nostr Key Countersignatures

When adding a countersignature with a non-Nostr key:
- Create a standard signature over the `signed_data_sha256` hash
- Store the signature in the `countersignatures` JSON array
- When publishing, wrap the entire declaration (including countersignatures) in a Nostr event

## Database Schema

### Nostr-Specific Fields

The `admindeclarations` table includes:

- `nostr_event_id VARCHAR(64)`: The Nostr event ID (SHA256 hash of event)
- `nostr_event TEXT`: Full signed Nostr event JSON (for Nostr-signed declarations)
- `nostr_kind INTEGER DEFAULT 31106`: Event kind (31106 for admin declarations)
- `nostr_tags TEXT`: JSON array of Nostr tags
- `nostr_published_at TIMESTAMP`: When published to Nostr
- `nostr_published_to_relays TEXT`: JSON array of relay URLs
- `nostr_publish_status VARCHAR(50)`: pending, published, failed, retrying

### Usage

- **Nostr-signed declarations**: `nostr_event_id` and `nostr_event` are populated during signing
- **Non-Nostr-signed declarations**: These fields are `NULL` until wrapped for publication
- **Wrapped declarations**: `nostr_event` contains the wrapper event; original signature remains in `signed_data`

## Code Implementation

### Location

- **Signing Logic**: `electron/utils/AdminDeclaration.js`
  - `signDeclaration()` static method
  - Handles both Nostr and non-Nostr key signing

- **IPC Handler**: `electron/ipc-handlers.js`
  - `online:admin-declaration:sign` handler
  - Updates database with `nostr_event_id` for Nostr keys

### Key Functions

```javascript
// Check if key is Nostr type
const isNostrKey = (signingKeypair.type === 'Nostr' || 
                    signingKeypair.type?.toLowerCase().includes('nostr') ||
                    signingKeypair.algorithm === 'Nostr' ||
                    signingKeypair.algorithm?.toLowerCase().includes('nostr'));

// Create and sign Nostr event
if (isNostrKey) {
  const { finalizeEvent } = require('nostr-tools');
  const privateKeyBytes = new Uint8Array(Buffer.from(signingKeypair.privateKey, 'hex'));
  const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);
  // Extract signature and event ID...
}
```

## Verification

### Verifying Nostr-Signed Declarations

1. **Verify Nostr Event Signature**
   ```javascript
   const { verifyEvent } = require('nostr-tools');
   const isValid = verifyEvent(signedEvent);
   ```

2. **Verify Content Hash**
   - Parse `signed_data` from `nostr_event.content`
   - Verify `content_hash_sha256` matches actual content

3. **Verify Declaration Structure**
   - Check `declaration_uuid` in tags
   - Check `declaration_type` in tags
   - Validate JSON structure

### Verifying Non-Nostr-Signed Declarations

1. **Verify Standard Signature**
   - Use appropriate crypto function (ED25519, RSA, etc.)
   - Verify signature over `signed_data_sha256`

2. **Verify Content Hash**
   - Recompute `content_hash_sha256`
   - Compare with stored value

3. **Verify Declaration Structure**
   - Validate JSON structure
   - Check validity dates
   - Verify issuer permissions

## Publishing to Nostr

### Direct Publication (Nostr-Signed)

When a declaration is signed with a Nostr key:
- The `nostr_event` is already created and signed
- Can be published directly to Nostr relays
- No additional wrapping required

### Wrapped Publication (Non-Nostr-Signed)

When a declaration is signed with a non-Nostr key:
1. Create wrapper Nostr event
2. Sign wrapper with Nostr key
3. Publish wrapper event to relays
4. Original signature remains in `signed_data` for verification

## Future Work

### Planned Enhancements

1. **Automatic Wrapping**
   - Detect non-Nostr signatures
   - Automatically create wrapper events
   - Sign with available Nostr key

2. **Publication Workflow**
   - UI for selecting relays
   - Automatic retry on failure
   - Status tracking per relay

3. **Verification UI**
   - Display Nostr event details
   - Show verification status
   - Link to Nostr relays

4. **Countersignature UI**
   - Add countersignatures with Nostr keys
   - Wrap multiple countersignatures
   - Display all signatures

## References

- **Nostr Protocol**: https://nostr.com/
- **nostr-tools Documentation**: https://github.com/nbd-wtf/nostr-tools
- **Admin Declarations Schema Plan**: `devdocs/nostr/admin-declarations-schema-plan.md`
- **Trust Declarations Summary**: `devdocs/nostr/trust-declarations-summary.md`

