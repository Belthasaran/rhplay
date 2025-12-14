# Keyguard Encrypted Data Inventory

**Last Updated:** 2025-01-XX  
**Purpose:** Complete inventory of all data encrypted with the Profile Guard (Keyguard) key

## Overview

This document lists all database columns that contain data encrypted with the Profile Guard keyguard key. When the master password is changed, **ALL** of these fields must be re-encrypted with the new key in a single atomic transaction.

## Encryption Format

All encrypted data uses AES-256-CBC encryption with the format:
```
IV:HEX_ENCRYPTED_DATA
```
Where:
- `IV` = 16-byte initialization vector (hex encoded)
- `HEX_ENCRYPTED_DATA` = Encrypted data (hex encoded)

## Database: clientdata.db

### Table: `user_profiles`

#### Column: `encrypted_master_seed`
- **Type:** TEXT
- **Description:** Encrypted 256-bit (32-byte) master seed for profile key generation
- **Format:** IV:HEX_ENCRYPTED_SEED
- **Migration:** 060_clientdata_user_profiles_master_seed.sql
- **Re-encrypt on password change:** ✅ YES

#### Column: `encrypted_ethereum_private_key`
- **Type:** TEXT
- **Description:** Encrypted secp256k1 private key for Ethereum wallet
- **Format:** IV:HEX_ENCRYPTED_KEY
- **Migration:** 065_clientdata_user_profiles_ethereum_wallet.sql
- **Re-encrypt on password change:** ✅ YES

### Table: `profile_keypairs`

#### Column: `encrypted_private_key`
- **Type:** TEXT
- **Description:** Encrypted private key for profile keypairs (Nostr, etc.)
- **Format:** IV:HEX_ENCRYPTED_KEY
- **Migration:** 029_clientdata_profile_keypairs.sql
- **Re-encrypt on password change:** ✅ YES
- **Note:** Applies to ALL rows in this table

### Table: `admin_keypairs`

#### Column: `encrypted_private_key`
- **Type:** TEXT
- **Description:** Encrypted private key for admin keypairs
- **Format:** IV:HEX_ENCRYPTED_KEY
- **Migration:** 015_clientdata_admin_keypairs.sql
- **Re-encrypt on password change:** ✅ YES
- **Note:** Applies to ALL rows where `encrypted_private_key IS NOT NULL`

### Table: `admin_seeds`

#### Column: `encrypted_master_seed`
- **Type:** TEXT NOT NULL
- **Description:** Encrypted 256-bit (32-byte) master seed for admin keypair generation
- **Format:** IV:HEX_ENCRYPTED_SEED
- **Migration:** 063_clientdata_admin_seeds_table.sql
- **Re-encrypt on password change:** ✅ YES
- **Note:** Applies to ALL rows in this table

### Table: `twitch_integration`

#### Column: `encrypted_access_token`
- **Type:** TEXT NOT NULL
- **Description:** Encrypted Twitch OAuth access token
- **Format:** IV:HEX_ENCRYPTED_TOKEN
- **Migration:** 053_clientdata_twitch_integration.sql
- **Re-encrypt on password change:** ✅ YES
- **Note:** Applies to ALL rows in this table

#### Column: `encrypted_refresh_token`
- **Type:** TEXT NOT NULL
- **Description:** Encrypted Twitch OAuth refresh token
- **Format:** IV:HEX_ENCRYPTED_TOKEN
- **Migration:** 053_clientdata_twitch_integration.sql
- **Re-encrypt on password change:** ✅ YES
- **Note:** Applies to ALL rows in this table

### Table: `encryption_keys`

#### Column: `keydata`
- **Type:** TEXT
- **Description:** Encrypted key material (only if `encrypted = 1`)
- **Format:** IV:HEX_ENCRYPTED_KEYDATA
- **Re-encrypt on password change:** ✅ YES
- **Note:** Only re-encrypt rows where `encrypted = 1` AND `keydata IS NOT NULL`

## NOT Encrypted with Keyguard Key

The following tables contain encrypted data but use **different encryption keys** and should **NOT** be re-encrypted when changing the Keyguard password:

### Table: `apiservers`
- **Columns:** `encrypted_clientid`, `encrypted_clientsecret`
- **Encryption Key:** `RHTCLIENT_VAULT_KEY` (environment variable)
- **Re-encrypt on password change:** ❌ NO (uses different key)

## Summary

**Total encrypted columns using Keyguard key:** 8
- `user_profiles.encrypted_master_seed`
- `user_profiles.encrypted_ethereum_private_key`
- `profile_keypairs.encrypted_private_key` (all rows)
- `admin_keypairs.encrypted_private_key` (rows where not null)
- `admin_seeds.encrypted_master_seed` (all rows)
- `twitch_integration.encrypted_access_token` (all rows)
- `twitch_integration.encrypted_refresh_token` (all rows)
- `encryption_keys.keydata` (rows where encrypted=1 and not null)

## Implementation

### Re-encryption Function

The `KeyguardReencryption.reencryptAllSecrets()` function in `electron/utils/KeyguardReencryption.js` handles atomic re-encryption of all secrets.

### Atomic Transaction Requirements

When changing the master password:
1. **ALL** of the above fields must be re-encrypted
2. Re-encryption must occur in a **single SQL transaction** using `BEGIN IMMEDIATE TRANSACTION`
3. Database must use **WAL mode** (enforced before transaction)
4. Transaction must be **atomic** - either all succeed or all fail
5. On any error, transaction must **rollback completely** using `ROLLBACK`
6. No partial updates allowed
7. After re-encryption, verification function ensures all secrets can be decrypted with new key

### Verification

The `KeyguardReencryption.verifyReencryption()` function verifies that all re-encrypted secrets can be successfully decrypted with the new keyguard key. This provides an additional safety check after the transaction commits.

### Error Handling

If ANY secret fails to decrypt or re-encrypt during the transaction:
- The entire transaction is rolled back
- No secrets are updated
- No Keyguard settings are changed
- The operation returns an error with details about which secret failed

This guarantees that the password change operation is **all-or-nothing** - there is no partial state.

