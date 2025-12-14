# NodeJS Dependencies added to support future work:

# DID & Ceramic readiness
    "@ceramicnetwork/http-client": "^6.4.0",
    "@didtools/pkh-ethereum": "^0.6.0",
    "did-session": "^4.0.0",

# Identity & keys
    "ethers": "^6.16.0",
    "@scure/bip32": "^2.0.1",
    "@noble/curves": "^2.0.1",
    "@noble/secp256k1": "^3.0.0",

# Mnemonic Seed View
    "@scure/bip39": "^2.0.1",

# Identity Verification Mini‑Spec v0.1

*(Draft for Nostr‑First Identity + Challenge Verification + Anti‑Abuse
Measures)*

------------------------------------------------------------------------

## 1. Overview

This document defines the **v0.1 specification** for:

-   Challenge‑based external account verification (Twitch, etc.)\
-   Minimal public proof strings\
-   Nostr‑native verification events\
-   Optional witness/oracle attestations\
-   Basic anti-abuse protections including client-side Proof‑of‑Work\
-   Future migration points for Ceramic DIDs and `did:pkh` accounts

This system is designed so that **Nostr is sufficient initially**, while
enabling **smooth migration** into Ceramic/DID‑based identity later.

------------------------------------------------------------------------

# 2. Challenge‑Based Verification Protocol (Minimal Format)

## 2.1 Goals

-   **Minimal footprint** placed in the user's public profile on
    Twitch/etc.\
-   Avoid code blocks or large JSON.\
-   Avoid horizontal scrolling or wrapping issues.\
-   The presence of the string in Twitch profile proves **Twitch‑side
    authorization**.\
-   The presence of the Twitch handle in Nostr profile proves
    **Nostr‑side authorization**.\
-   Combined, these two statements create a **bidirectional binding**.

## 2.2 Minimal Proof String

Allowed compact formats:

Option 1:
    nostr-proof:v1:npub1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Option 2
    Nostr-proof npub1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Option 3 - Hyperlink:  
    Any hyperlink ending with  /npub1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    Any hyperlink with any text: with  #npub1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    Or ?npub1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    Example:
    https://m.twitch.tv/username/about#npub1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    https://smwresource.arweave.net/#npub1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

    This allows answering the challenge with the Path or Text of a hyperlink.

Option 3
    SMW Player Proof npub1xxxxx xxxxxxxxxx xxxxxxxxxx xxxxxxxxxx xxxxxxxxx
    RHPlay User Proof npub1xxxxx xxxxxxxxxx xxxxxxxxxx xxxxxxxxxx xxxxxxxxx
    Kaizo Proof npub1xxxxx xxxxxxxxxx xxxxxxxxxx xxxxxxxxxx xxxxxxxxx
    Kaizo Master Proof npub1xxxxx xxxxxxxxxx xxxxxxxxxx xxxxxxxxxx xxxxxxxxx
    
Additional formats can be introduced in future.
All formats translated internally to Option 1.
Allowing the user to choose their string.
Optionally breaking the npub string every 10 characters is designed to allow word wrapping on HTML pages (avoid page widening).


**Components:**

  -----------------------------------------------------------------------
  Field                    Description
  ------------------------ ----------------------------------------------
  `nostr-proof:v1:`        Static prefix enabling automated detection

  `npub...`                The **Nostr public key** of the user claiming
                           the account
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 2.3 Verification Steps (Client-side)

### Step A --- From Twitch/public page:

1.  Fetch public HTML.\
2.  Extract lines matching:
    -   `nostr-proof:v1:npub...`\
    - (Or other allowed verification strings, such as hyperlinks, then internally transforming to the nostr-proof string)
3.  Validate format.

### Step B --- From Nostr user profile:

1.  User must publish metadata containing fields:
    -   `"twitch_handle": "..."`

### Step C --- Verification:

A verifier checks:

1.  Nostr profile lists Twitch handle.
2.  Twitch profile contains a matching minimal string containing same
    `npub`.
3.  If matched → **verified**.

No signatures or heavy parsing required.

------------------------------------------------------------------------

# 3. Nostr Event Definitions

## 3.1 Nostr Profile Metadata (User-Signed)

Users publish a `kind:0` event with:

``` json
{
  "name": "Alice",
  "twitch_handle": "alice_streams",
  "did_pkh": "did:pkh:eip155:1:0xabc123..."
}
```

The user profile is self-signed with their Nostr private key, giving
**Nostr-side authorization**.

------------------------------------------------------------------------

## 3.2 Witness/Oracle Attestation Event (Optional)

Witness publishes a Nostr event:

-   `kind`: **8100**\
-   `pubkey`: witness pubkey\
-   `tags`:
    -   `["p", "<npub_user>"]`\
    -   `["platform", "twitch"]`

**content:**

``` json
{
  "version": 1,
  "type": "external_account_attestation",
  "issuer": "npub_witness...",
  "subject": "npub_user...",
  "platform": "twitch",
  "handle": "alice_streams",
  "status": "valid",
  "verification_method": "challenge",
  "evidence": {
    "challenge_discovery": "https://m.twitch.tv/alice_streams/about",
    "checked_at": "2025-12-13T20:00:00Z"
  }
}
```

------------------------------------------------------------------------

# 4. Proof-of-Work (PoW) Anti‑Abuse Requirement

## 4.1 Purpose

To reduce spam, bots, and verification-flood attacks, **every new
verification request**, profile update, or rating card submission must
include a **small client-side PoW**.

-   Server/witness verifies PoW in **constant time**.\
-   Client must compute PoW over \~50--200ms of work (adjustable).\
-   Prevents a malicious actor from overwhelming the server with
    requests.

## 4.2 PoW Construction

### Given:

-   Message payload `M`
-   Timestamp `T` (UTC seconds)
-   Difficulty `D` (number of hex zeros)

### Client must find a nonce `N` such that:

    SHA256( M || T || N ) begins with D zero-nibbles

Typical difficulty:\
- `D = 4` → \~1/65536 hashes\
- Computationally trivial for server to validate.

## 4.3 Included in Request

``` json
{
  "msg": { ...payload... },
  "timestamp": 1734103000,
  "pow_nonce": "d98cd44ab120f9a0"
}
```

Server rejects if:

-   Timestamp too old (\> 120s drift)\
-   Difficulty not met\
-   Nonce not matching difficulty\
-   Replays detected

------------------------------------------------------------------------

# 5. Oracle/Witness Architecture (Twitch/Discord)

### Goals:

-   Keep OAuth secrets **off client**.\
-   Minimize server risk.\
-   Prevent credential exposure.\
-   Allow **manual fallback**.

## 5.1 Client-Side OAuth First

Client performs OAuth with:

-   Twitch using PKCE/implicit flow\
-   Discord using implicit flow or using DM bot fallback

Client sends to witness:

1.  A **signed Nostr message**:\
    "I, npubX, authenticated as platform Y at time T."\
2.  An **ID token** or short-lived access token.

### Witness responsibilities:

1.  Verify Nostr signature.\
2.  Use its **confidential OAuth client** to:
    -   Validate ID token signature, OR\
    -   Make `/userinfo` / `users/@me` calls.\
3.  Issue attestation.\
4.  Discard tokens (stateless).

------------------------------------------------------------------------

# 6. Relay / Server Abuse Mitigation

### Measures:

1.  **Rate Limit per pubkey / IP**
2.  **Max event size**\
3.  **Reject malformed Nostr events early**
4.  **Require PoW for sensitive requests**
5.  **Cooldowns on verification attempts**
6.  **Optional BrightID/Idena gating for advanced features**

------------------------------------------------------------------------

# 7. Future Extensions

-   Move verification attestations also to **Ceramic ComposeDB**.\
-   Enable linking of Ethereum wallets → `did:pkh`\
-   Add multiple verification providers (ecosystem of oracles)\
-   Enable remote signing UX later (Ledger, WalletConnect, etc.)

------------------------------------------------------------------------

# End of Spec v0.1
