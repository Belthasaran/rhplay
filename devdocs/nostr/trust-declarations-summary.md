# Trust Declarations Implementation Summary

## Overview

This document provides a comprehensive summary of all work completed on the Trust Declarations system for RHTools. Trust declarations are digitally signed statements that establish trust relationships, grant privileges, delegate powers, and authorize administrative actions in the decentralized game rating platform.

## Project Goals

1. **Trust Relationships**: Establish trust between admin keypairs, operational admins, and user profiles
2. **Privilege Management**: Grant or revoke privileges to users and profiles
3. **Delegation**: Delegate moderation powers and metadata update authorities
4. **Moderation Actions**: Issue blocking, freezing, and other moderation directives
5. **Metadata Updates**: Authorize specific users to update game metadata
6. **Nostr Publishing**: Publish declarations to Nostr relays for peer-to-peer distribution
7. **Extensibility**: Support future use cases (forum moderation, messaging controls, etc.)

---

## Database Schema

### Table: `admindeclarations`

Created in `clientdata.db` with the following structure:

#### Core Fields
- `declaration_uuid VARCHAR(255) PRIMARY KEY`: Unique identifier
- `declaration_type VARCHAR(50)`: Type of declaration (trust-declaration, privilege-grant, etc.)
- `content_json TEXT`: JSON content of the declaration
- `content_hash_sha256 VARCHAR(64)`: SHA256 hash of content
- `status VARCHAR(50) DEFAULT 'Draft'`: Draft, Finalized, Published, Signed

#### Signing Fields
- `signing_keypair_uuid VARCHAR(255)`: UUID of keypair that signed
- `signing_keypair_fingerprint VARCHAR(64)`: Fingerprint of signing keypair
- `signing_keypair_canonical_name VARCHAR(255)`: Canonical name of signing keypair
- `digital_signature TEXT`: The digital signature
- `signed_data TEXT`: Format 3 signed data (with signature)
- `signed_data_sha256 VARCHAR(64)`: Hash of Format 3 (for countersigners)
- `signing_timestamp TIMESTAMP`: When the declaration was signed

#### Nostr Publishing Fields
- `nostr_event_id VARCHAR(64)`: Nostr event ID (for Nostr-signed declarations)
- `nostr_event TEXT`: Full signed Nostr event JSON
- `nostr_kind INTEGER DEFAULT 31106`: Nostr event kind
- `nostr_tags TEXT`: JSON array of Nostr tags
- `nostr_published_at TIMESTAMP`: When published to Nostr
- `nostr_published_to_relays TEXT`: JSON array of relay URLs
- `nostr_publish_status VARCHAR(50)`: pending, published, failed, retrying

#### Status and Versioning Fields
- `status VARCHAR(50) DEFAULT 'Draft'`: Draft, Finalized, Published, Signed
- `schema_version VARCHAR(10) DEFAULT '1.0'`: Schema version for compatibility
- `content_version INTEGER DEFAULT 1`: Version number for updates
- `original_declaration_uuid VARCHAR(255)`: For updates/revokes referencing original
- `is_update BOOLEAN DEFAULT 0`: Whether this is an update/revoke
- `update_chain_uuid VARCHAR(255)`: Links updates to same original
- `is_revoked BOOLEAN DEFAULT 0`: Whether this declaration is revoked
- `revoked_at TIMESTAMP`: When revoked
- `revoked_by_declaration_uuid VARCHAR(255)`: Declaration that revoked this

#### Metadata Fields
- `valid_from TIMESTAMP`: Start of validity period
- `valid_until TIMESTAMP`: End of validity period (NULL = permanent)
- `issued_at TIMESTAMP`: When declaration was issued
- `updated_at TIMESTAMP`: Last update timestamp
- `created_at TIMESTAMP`: Creation timestamp

#### Network Discovery Fields
- `discovered_from_relay TEXT`: Relay where this was discovered
- `discovered_at TIMESTAMP`: When discovered
- `is_local BOOLEAN DEFAULT 1`: Whether created locally or discovered
- `verification_status VARCHAR(50)`: pending, verified, failed

### Migrations

Two SQL migration files were created:

1. **`021_clientdata_admindeclarations_updates.sql`**
   - Adds status, Nostr publishing, update tracking, and schema versioning fields
   - Includes indexes for performance

2. **`022_clientdata_admindeclarations_signing_fields.sql`**
   - Adds signing-related fields
   - Adds indexes for signing queries

Both migrations are registered in `jsutils/migratedb.js` and run automatically on app startup.

---

## AdminDeclaration Class

### Location

`electron/utils/AdminDeclaration.js`

### Purpose

Encapsulates logic for managing and providing various JSON representations of admin declarations.

### Key Methods

#### `loadFromDatabase(uuid, ipcGetFunction)` (static)
- Loads a declaration from the database
- Returns a new `AdminDeclaration` instance

#### `getContentJson()`
- Returns Format 1: Content JSON alone
- Parses `content_json` field

#### `getSignedData(signingTimestamp, signingKeypair)`
- Returns Format 2: Content + database fields to be signed
- Includes: declaration_uuid, declaration_type, content_hash, signing info, validity dates, timestamp
- This is what gets hashed and signed

#### `getSignedDataWithSignature(signingTimestamp, signingKeypair)`
- Returns Format 3: Format 2 + signature information
- Includes signature object with canonical_name, fingerprint, hash algorithm, signature, timestamp
- For Nostr keys: Also includes `nostr_event_id` and `nostr_event`

#### `getCompleteExport()`
- Returns Format 4: All non-signed database fields
- Used for database extraction/import utilities

#### `signDeclaration(declarationRecord, signingKeypair, signingTimestamp)` (static)
- Signs a declaration with the specified keypair
- Handles both Nostr and non-Nostr keys differently:
  - **Nostr keys**: Creates a Nostr event using `finalizeEvent()` from `nostr-tools`
  - **Non-Nostr keys**: Uses standard crypto signing (ED25519, RSA, ML-DSA placeholder)
- Returns object with `signed_data`, `signed_data_sha256`, `digital_signature`, `signing_timestamp`, etc.
- For Nostr keys: Also returns `nostr_event_id` and `nostr_event`

### JSON Format Specifications

#### Format 1: Content Only
```json
{
  "schema_version": "1.0",
  "declaration_type": "trust-declaration",
  "content": { ... }
}
```

#### Format 2: Signed Data (Before Signing)
```json
{
  "declaration_uuid": "...",
  "declaration_type": "...",
  "content_hash_sha256": "...",
  "signing_keypair_canonical_name": "...",
  "signing_keypair_fingerprint": "...",
  "target_keypair_uuid": "...",
  "target_keypair_canonical_name": "...",
  "target_keypair_fingerprint": "...",
  "valid_from": "...",
  "valid_until": null,
  "signing_timestamp": "..."
}
```

#### Format 3: Signed Data with Signature
```json
{
  ...Format 2 fields...,
  "signature": {
    "canonical_name": "...",
    "fingerprint": "...",
    "signature_hash_algorithm": "SHA-256",
    "signature_hash_value": "...",
    "digital_signature": "...",
    "signed_at": "..."
  },
  "nostr_event_id": "...",  // Only for Nostr keys
  "nostr_event": { ... }     // Only for Nostr keys
}
```

#### Format 4: Complete Export
- All database fields except signed data
- Used for database utilities

---

## IPC Handlers

### Location

`electron/ipc-handlers.js` - Within `registerDatabaseHandlers()` function

### Handlers Implemented

#### `online:trust-declarations:list`
- Lists all trust declarations from `admindeclarations` table
- Returns array of declarations

#### `online:admin-declaration:save`
- Creates or updates an admin declaration
- Generates UUID if new
- Computes content hash
- Handles Draft status

#### `online:admin-declaration:update-status`
- Updates the status field (Draft → Finalized → Signed)
- Used for finalizing and publishing workflow

#### `online:admin-declaration:get`
- Retrieves a specific declaration by UUID
- Returns full declaration record

#### `online:admin-declaration:sign`
- Signs a declaration with a specified keypair
- Handles both admin and user-op keypairs
- Decrypts private key using Profile Guard key
- Calls `AdminDeclaration.signDeclaration()`
- Updates database with signature and Nostr event data (if Nostr key)
- Changes status from 'Finalized' to 'Signed'

### Preload Exposure

All IPC handlers are exposed via `electron/preload.js`:
- `listTrustDeclarations`
- `saveAdminDeclaration`
- `updateAdminDeclarationStatus`
- `getAdminDeclaration`
- `signAdminDeclaration`

---

## UI Implementation

### Location

`electron/renderer/src/App.vue`

### Trust Declarations Tab

Added a new "Trust Declarations" tab to the "Online" dropdown dialog.

#### Features
- Lists all trust declarations
- Shows status (Draft, Finalized, Signed)
- Displays key metadata (type, issuer, subject, validity)
- Action dropdown for each declaration

#### Actions
- **View/Edit Trust Declaration**: Opens detailed modal
- **Create New Declaration**: Opens wizard
- **Publish**: (Future - publish to Nostr relays)
- **Export**: (Future - export declaration)
- **Import**: (Future - import declaration backup)
- **Delete**: Remove declaration

### Create Trust Declaration Wizard

Full-screen modal wizard for creating new declarations.

#### Steps

1. **Issuer Selection**
   - Dropdown of available keypairs (admin, User Op, or User keys)
   - Shows name/label and canonical_key_name
   - Warning if private key not available

2. **Validity Dates**
   - Start date (defaults to current time)
   - Optional end date (NULL = permanent)
   - Considers parent declaration restrictions

3. **Subject Information**
   - Type dropdown: keypair, profile, user, system, or declaration
   - Canonical name dropdown for keypairs

4. **Content Page**
   - **Advanced Mode**: Text editor for raw JSON
     - Client-side validation
     - "Save Draft" and "Next" buttons
     - Warning if invalid JSON
   - **Form Mode**: Guided form for common types
     - "Save Draft and Next" button
     - Form fields for "New Delegation" type
     - Trust level selection (Master Admin, Operating Admin, Authorized Admin)
     - Usage types, scopes, permissions

5. **Finalize Step**
   - Scrollable text viewer showing full declaration JSON
   - "Finalize" button (changes status to Finalized)
   - "Finish Later" button (closes wizard, leaves as Draft)

### Trust Declaration Details Modal

Tabbed modal for viewing and editing declarations.

#### Tabs

1. **Summary and Metadata**
   - Basic details (UUID, type, status)
   - Read-only text summary
   - Reason and Comment fields
   - Editable if status is Draft

2. **Issuer**
   - Issuer keypair information
   - Canonical name, fingerprint
   - Editable if status is Draft

3. **Subject**
   - Subject type and information
   - Canonical name, fingerprint
   - Editable if status is Draft

4. **Validity**
   - Start date, end date
   - Date range validation
   - Editable if status is Draft

5. **Content**
   - Content JSON display
   - Advanced mode editor (if Draft)
   - Read-only if Finalized or Signed

6. **Status and Signatures**
   - Current status (Draft, Finalized, Signed)
   - List of signatures
   - Validity test results
   - Trust status
   - **"Finalize and Reload" button** (if Draft)
     - Validates declaration
     - Changes status to Finalized
     - Reloads with read-only fields
   - **"Issuer Sign" button** (if Finalized and not signed)
     - Signs with issuer keypair
     - Changes status to Signed
     - Shows warning if keypair not available
   - **"Add Signature" button** (if already signed)
     - Adds countersignature
     - (Future implementation)

#### State Management

- Declaration is only editable if status is "Draft"
- Finalized declarations: Content, validity, issuer, subject are read-only
- Signed declarations: All fields are read-only
- Status changes trigger UI updates

---

## Nostr Integration

### Key Type Support

Added "Nostr" as a keypair type option in:
- User profile keypair generation
- Admin keypair generation
- Master admin keypair generation

### Nostr Key Properties

- **Algorithm**: secp256k1 with Schnorr signatures
- **Canonical Name**: Public key in Bech32 format (e.g., `npub1...`)
- **Local Name**: `<username>_<public_key>` (no abbreviation)

### Signing with Nostr Keys

See `devdocs/nostr/trust-declarations-nostr-signing.md` for detailed explanation.

**Key Points:**
- Must create proper Nostr events (kind 31106)
- Use `finalizeEvent()` from `nostr-tools`
- Store `nostr_event_id` and `nostr_event` in database
- Non-Nostr signatures must be wrapped in Nostr events for publication

### Dependencies

- `nostr-tools`: ^2.4.0 (for `finalizeEvent`, `generateSecretKey`, `getPublicKey`)
- `@noble/secp256k1`: (transitive via `@nostr-dev-kit/ndk`) for Schnorr signatures

---

## Schema Versioning

### Current Version

**Schema Version: `1.0`**

### Critical vs. Non-Critical Fields

- **Critical fields**: If client doesn't understand, must reject declaration
- **Non-critical fields**: If client doesn't understand, can ignore and process declaration

### Extensibility

- Schema version in `content_json` allows backward compatibility
- New fields can be added as non-critical
- Old clients can still process declarations they understand

---

## Trust Levels

### Hierarchy

1. **Master Admin**
   - Highest level
   - Can issue Operating Admin and Authorized Admin declarations
   - Can sign any type of declaration

2. **Operating Admin**
   - Can issue Authorized Admin declarations
   - Can sign moderation and metadata update declarations
   - Cannot issue Master Admin declarations

3. **Authorized Admin**
   - Can sign specific delegated actions
   - Cannot issue new delegations affecting Master/Operating Admin
   - Can only revoke/modify lower-level declarations

### Restrictions

- **Authorized Admin**:
  - Cannot sign New Delegations affecting Master/Operating Admin
  - Cannot sign Updates or Revocations affecting Master/Operating Admin
  - Can revoke/modify Moderator, Updater, Contributor declarations
  - Can only revoke/reduce other Authorized Admin declarations that rely on their signature
  - Cannot grant permissions they don't have
  - When signing Authorized Admin declaration: Can only grant same/fewer privileges, same/narrower scope, same/reduced validity period

---

## Declaration Types

### Supported Types

1. **trust-declaration**: Establishes trust relationship
2. **privilege-grant**: Grants privileges to subject
3. **privilege-revoke**: Revokes previously granted privileges
4. **moderation-action**: Issues moderation directive (block, freeze, etc.)
5. **metadata-delegation**: Delegates metadata update authority
6. **admin-control-message**: Administrative control message
7. **declaration-update**: Updates a past declaration
8. **declaration-revoke**: Revokes a past declaration

### Update and Revocation

- **Updates**: Can modify validity period, permissions, scope
- **Retroactive Effects**: Can void or change permissions retroactively
- **Cascade Revocations**: Revoking a declaration can cascade to dependent declarations

---

## Workflow

### Creating a Declaration

1. **Draft**: User creates declaration in wizard
   - Status: "Draft"
   - All fields editable
   - Saved to database

2. **Finalize**: User clicks "Finalize" button
   - Validates declaration
   - Status: "Finalized"
   - Content, validity, issuer, subject become read-only

3. **Sign**: User clicks "Issuer Sign" button
   - Signs with issuer keypair
   - Status: "Signed"
   - All fields read-only

4. **Publish**: (Future) User clicks "Publish" button
   - Publishes to Nostr relays
   - Status: "Published"
   - `nostr_publish_status` updated

### Editing a Declaration

- Only editable if status is "Draft"
- Once Finalized, only Status tab allows changes (Finalize and Reload)
- Once Signed, no changes allowed

---

## Code Structure

### Files Created/Modified

#### New Files
1. `electron/utils/AdminDeclaration.js` - AdminDeclaration class
2. `electron/sql/migrations/021_clientdata_admindeclarations_updates.sql` - Schema updates
3. `electron/sql/migrations/022_clientdata_admindeclarations_signing_fields.sql` - Signing fields
4. `devdocs/nostr/admin-declarations-schema-plan.md` - Schema plan document
5. `devdocs/nostr/trust-declarations-nostr-signing.md` - Nostr signing guide
6. `devdocs/nostr/trust-declarations-summary.md` - This document

#### Modified Files
1. `electron/renderer/src/App.vue` - UI implementation
2. `electron/ipc-handlers.js` - IPC handlers
3. `electron/preload.js` - IPC exposure
4. `jsutils/migratedb.js` - Migration registration

---

## Testing

### Manual Testing

- ✅ Create Draft declaration
- ✅ Save Draft declaration
- ✅ Finalize declaration
- ✅ Sign declaration with Nostr key
- ✅ Sign declaration with ED25519 key
- ✅ View declaration details
- ✅ Edit Draft declaration
- ✅ List declarations
- ✅ Delete declaration

### Future Testing Needs

- [ ] Publish to Nostr relays
- [ ] Countersignatures
- [ ] Wrapping non-Nostr signatures
- [ ] Declaration updates
- [ ] Declaration revocations
- [ ] Cascade revocations
- [ ] Network discovery
- [ ] Verification

---

## Known Limitations

1. **Publishing to Nostr**: Not yet implemented
   - UI exists but no backend
   - Need to implement relay connection
   - Need to handle retries and status tracking

2. **Countersignatures**: Partial implementation
   - UI exists but not fully functional
   - Need to implement countersignature logic
   - Need to handle Nostr vs. non-Nostr countersignatures

3. **Wrapping Non-Nostr Signatures**: Not yet implemented
   - Logic exists for Nostr signing
   - Need to implement wrapper event creation
   - Need to ensure at least one Nostr key exists

4. **Network Discovery**: Not yet implemented
   - Database fields exist
   - Need to implement relay listening
   - Need to implement verification logic

5. **Declaration Updates**: Schema supports it, but UI not complete
   - Need to implement update workflow
   - Need to handle retroactive effects
   - Need to handle cascade revocations

---

## Future Work

### Short Term

1. **Complete Countersignatures**
   - Implement countersignature logic
   - Support both Nostr and non-Nostr countersignatures
   - Update UI to show all signatures

2. **Implement Publishing**
   - Connect to Nostr relays
   - Publish declarations
   - Track publication status
   - Handle retries

3. **Wrapping Non-Nostr Signatures**
   - Automatically detect non-Nostr signatures
   - Create wrapper events
   - Sign with Nostr key
   - Store wrapper event

### Medium Term

4. **Network Discovery**
   - Listen to Nostr relays
   - Discover declarations from network
   - Verify signatures
   - Store discovered declarations

5. **Declaration Updates**
   - Implement update workflow
   - Handle retroactive effects
   - Cascade revocations
   - Update UI

6. **Verification UI**
   - Show verification status
   - Display trust chain
   - Show validity tests
   - Link to Nostr relays

### Long Term

7. **Forum Moderation**
   - Use declarations for forum moderation
   - Delegate moderation powers
   - Issue moderation actions

8. **Messaging Controls**
   - Use declarations for messaging permissions
   - Group messaging controls
   - Private messaging authorization

9. **Advanced Features**
   - Multi-signature requirements
   - Time-based permissions
   - Scope-based restrictions

---

## References

### Documentation

1. **Schema Plan**: `devdocs/nostr/admin-declarations-schema-plan.md`
2. **Nostr Signing Guide**: `devdocs/nostr/trust-declarations-nostr-signing.md`
3. **This Summary**: `devdocs/nostr/trust-declarations-summary.md`

### External Resources

- **Nostr Protocol**: https://nostr.com/
- **nostr-tools**: https://github.com/nbd-wtf/nostr-tools
- **NIP-29**: Relay-Based Groups
- **NIP-28**: Public Chat

---

## Conclusion

The Trust Declarations system provides a solid foundation for decentralized trust and authority management in RHTools. The implementation includes:

- ✅ Complete database schema
- ✅ AdminDeclaration class with 4 JSON formats
- ✅ Nostr key signing support
- ✅ Non-Nostr key signing support
- ✅ Full UI for creating and managing declarations
- ✅ Wizard for creating declarations
- ✅ Details modal for viewing/editing
- ✅ Signing workflow
- ✅ Status management

Future work will focus on publishing, network discovery, countersignatures, and advanced features like updates and revocations.

