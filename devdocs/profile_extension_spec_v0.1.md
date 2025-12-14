# Client Profile Extension Spec v0.1

### Master Seed, Encrypted Profile Storage, Ethereum Wallet & did:pkh Generation

### + UI Foundations for Future Ceramic Integration & Social Link Verification

This document defines **immediate implementation steps** for extending
the client's profile system with:

-   A new **master seed** stored in encrypted profile data\
-   Derivation of a built-in **Ethereum wallet**\
-   Creation of a **did:pkh** identifier\
-   Backup behavior updates\
-   Early integration points for **Ceramic-compatible identities**\
-   UI requirements for adding/editing social-link profile fields\
-   Verification-support metadata (no nonces required)

This addendum focuses specifically on **client-side identity primitives
& user experience**.

------------------------------------------------------------------------

# 1. Master Seed in Encrypted Profile Data

## 1.1 Purpose

Introducing a **master seed** enables:

-   Deterministic generation of future keys\
-   Easier backup and restoration\
-   Containment of identity primitives within a single encrypted object\
-   Future remote-signing or external-wallet migration paths\
-   Compatibility with Ceramic DID standards (via secp256k1 → did:pkh or
    did:key)

## 1.2 Seed Format

-   256-bit random value (32 bytes).\
-   Stored **only in the encrypted user profile data**.\
-   Never transmitted to networks or relays.\
-   Must be backed up whenever the user exports their encrypted profile.
-   There should be an option to display the profile master seed as a Bip39 mnemonic.

## 1.3 Seed Derivation Paths (initial)

    m/identity/master              → master seed (root)
    m/identity/nostr/0            → future Nostr key (optional)
    m/identity/ethereum/0         → Ethereum wallet private key
    m/identity/didpkh/0           → did:pkh DID (derived from Ethereum wallet)
    m/identity/dm/0               → future messaging encryption key
    m/identity/app/0              → app-specific signing keys

Initially, only the **Ethereum wallet** and **did:pkh** will be derived
and used.

Existing Nostr keys remain untouched unless the user later chooses
migration.

------------------------------------------------------------------------

# 2. Ethereum Wallet Generation

## 2.1 Algorithm

From `m/identity/ethereum/0` derive:

-   **secp256k1 private key**
-   Corresponding Ethereum address
-   **did:pkh** DID:

```{=html}
<!-- -->
```
    did:pkh:eip155:1:<EthereumAddress>

## 2.2 Storage

-   Private key stored inside encrypted profile blob.\
-   Address and DID may be exposed in the public Nostr profile metadata
    (optional for now).\
-   Private key must NEVER appear in logs or plaintext.

## 2.3 Usage (initial)

-   No on-chain operations required\
-   DID is reserved for future Ceramic-compatible identity documents\
-   Ethereum wallet is not shown to the user unless advanced UI is
    enabled later

------------------------------------------------------------------------

# 3. Ceramic Integration Points (Foundational)

Although Ceramic support is not enabled yet, we define **future
compatibility points**.

## 3.1 Profile Metadata Field (public)

Add optional fields to `kind:0` Nostr metadata:

``` json
{
  "did_pkh": "did:pkh:eip155:1:0xabc123...",
  "ceramic_ready": true
}
```

This does not activate Ceramic; it only signals:

-   A deterministic DID exists\
-   Clients may optionally query Ceramic when support is added

## 3.2 Internal Storage Format

Encrypted profile should store:

``` json
{
  "master_seed": "<32-byte hex or base64>",
  "ethereum_privkey": "<derived>",
  "ethereum_address": "0x...",
  "did_pkh": "did:pkh:eip155:1:0x...",
  "dm_key": null,
  "app_signing_key": null,
  "nostr_keypair": {
    "pub": "<existing npub>",
    "priv": "<existing nsec>"
  }
}
```

------------------------------------------------------------------------

# 4. Profile Backup Requirements

## 4.1 What must be included

A **single encrypted profile backup** must contain:

-   Master seed\
-   Ethereum wallet private key\
-   did:pkh\
-   Nostr private key (if not seed-derived)\
-   All future derived keys\
-   User social-link configuration\
-   Verification metadata (optional)

## 4.2 Deterministic Recovery

Restoring from the encrypted profile backup:

1.  Load master seed\
2.  Reconstruct Ethereum wallet\
3.  Recreate did:pkh\
4.  Recreate any deterministic keys added later

This ensures stable identity across devices.

------------------------------------------------------------------------

# 5. Social Profile Links -- Client UI Requirements

The app must provide a consistent UI for adding/editing the following
fields:

-   `keyoxide`
-   `smwcentral`
-   `youtube`
-   `steam`
-   `gamerprofiles`
-   `playtracker`
-   `github`
-   `twitch`

### 5.1 UI Guidelines

1.  **Simple text-entry fields**
    -   Username or URL depending on platform.
    -   Auto-normalize entries (trim whitespace, enforce lowercase where
        applicable).
2.  **Validation feedback**
    -   "Looks like a valid GitHub username"\
    -   "This YouTube link format is recognized"
3.  **Clear optionality**
    -   No required fields.
4.  **Verification status badges**
    -   ⏳ pending\
    -   ✅ verified\
    -   ⚠ unknown\
    -   ❌ rejected
5.  **Recheck button**
    -   Manual revalidation on demand.
6.  **No nonce fields**
    -   For this class of platforms, no nonce is required.

### 5.2 Verification Workflow

1.  Parse social link value.\
2.  Construct canonical profile URL when possible.\
3.  Perform platform-specific fetch+validation.\
4.  Update status indicator.\
5.  Optionally publish a local verification result event.

------------------------------------------------------------------------

# 6. Witness Attestation Readiness

The client must be prepared to:

-   Consume witness attestations (`kind:8101`)\
-   Display combined verification summaries\
-   Respect rejection flags\
-   Store attestation metadata locally

No witness implementation required yet---only client-side support.

------------------------------------------------------------------------

# 7. Security Notes

-   Master seed must remain encrypted at rest.\
-   Ethereum private key must not be visible in UI.\
-   did:pkh is safe to reveal publicly.\
-   Social links are "soft proofs," not strong identity proofs.

------------------------------------------------------------------------

# 8. Implementation Checklist

### Identity Layer

-   [ ] Generate master seed for new users\
-   [ ] Derive Ethereum wallet & did:pkh\
-   [ ] Add these fields to encrypted profile

### Public Metadata

-   [ ] Add optional did_pkh to Nostr profile

### UI & UX

-   [ ] Add new social link fields\
-   [ ] Add verification badges\
-   [ ] Add verification recheck functionality

### Backups

-   [ ] Ensure master seed + derived keys included in encrypted backup

------------------------------------------------------------------------

# End of Client Profile Extension Spec v0.1
