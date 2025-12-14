# Identity Verification Addendum v0.1

### Social-Link Verification Extensions for Nostr Profiles

This addendum extends the **Identity Verification Mini-Spec v0.1** with
guidelines for validating additional *social identity links* that users
may include in their Nostr profiles.\
These verification methods follow the same principles as the base system
but use **non-transactional**, **no-nonce**, **one-sided declarations**
combined with **Nostr-signed metadata**.

The purpose of this addendum:

-   Provide a **uniform verification model** for several social
    platforms.\
-   Allow clients or witnesses to issue **combined verification
    attestations**.\
-   Define simple rules for **rejection states**.\
-   Require **no challenge posting** and **no nonce**, relying instead
    on the fact that each user must **self-sign their Nostr profile
    metadata**.

------------------------------------------------------------------------

# 1. Verification Philosophy

Unlike Twitch-style challenge proofs, some of these platforms might not support
public text insertion or may have inconsistent UIs.\
When that is the case, verification is based on:

### ✔ Self-signed Nostr profile fields

A user includes a social username or link in their Nostr metadata
(kind:0).\
This proves **the Nostr user is claiming this external identity**.

### ✔ External fetch-based validation

The verifier (client or witness) may check:

-   That the username exists on the platform\
-   That the profile is reachable\
-   That the provided link is a valid profile URL\
-   That no obvious conflict exists (e.g., invalid characters, suspended
    profile)

### ✘ No nonce

Since we cannot rely on full challenge-response, and we aren't embedding
signed statements on the external platform.  We decided to move away
from a full challenge-response system anyway.

### ✔ Optional attestation

A witness may issue:

-   **verified** -- Platform identity verified based on containing simple npub based challenge
string; as with Twitch verification.   Verified is only used if one of the challenge response strings
as with Twitch verificatio nwas found.   Other valid identities are "accepted".

-   **pluasible** -- Platform identity appears correct, but cannot be fully verified\
-   **reject** -- platform identity is obviously invalid, malformed, 
    suspicious \
-   **unknown** -- witness could not verify (timeout, ambiguous data)

------------------------------------------------------------------------

# 2. Nostr Profile Metadata Fields

Users may add any of the following to their Nostr metadata JSON:

``` json
{
  "keyoxide": "https://keyoxide.org/...",
  "smwcentral": "username_here",
  "youtube": "https://www.youtube.com/@ChannelName",
  "steam": "SteamDisplayName",
  "gamerprofiles": "UserName",
  "playtracker": "UserName",
  "github": "GitHubUserName"
}
```

Verification works independently for each entry.

------------------------------------------------------------------------

# 3. Platform-Specific Verification Rules

## 3.1 Keyoxide Profile Link

### What the user includes:

A URL pointing to their Keyoxide profile or a Keyoxide proof hash.

### Verification rules:

1.  If a URL must begin with `https://keyoxide.org/`.\
A keyoxide path may be also specified as  keyoxide.org/aspe:keyoxide.org:xxxxx
2.  Page must resolve with status `200`.\
3.  Page must contain valid Keyoxide structure.\
4.  Verification Requires Identity Claims on the profile Including one of the challenge strings from the
Minimal Proof String  section of the main identity document.

   It is recommended to use a claim such as
    primal.net/p/npub1....

   Where npub1 is a Nostr public key of the user.

5.  Optional deeper validation:
    -   Parse Keyoxide claims (WebFinger proofs, PGP identity proofs).\
    -   Match known proofs against other social links in the Nostr
        profile.

------------------------------------------------------------------------

## 3.2 SMWCentral Username

### What the user includes:

A plain username.

### Verification:

1.  Construct URL:\
    `https://www.smwcentral.net/?p=profile&id=<username or user-id>`\
2.  Check for a valid returned profile page.

### outcomes:

-   **verified** -- User exists, and Profile string found.
-   **accepted** -- user exists\
-   **reject** -- profile not found\
-   **unknown** -- cannot confirm

------------------------------------------------------------------------

## 3.3 YouTube Channel Link

### What the user includes:

A YouTube channel link.

### Verification:

1.  URL must be a valid YouTube channel (format check + page
    existence).\
2.  `@handle` or channel ID must resolve.\
3.  Reject if account is suspended or unreachable.

### outcomes:

-   **verified**  channel page must include a challenge string as per Twitch verification \
-   **accepted**\
-   **reject**\
-   **unknown**

------------------------------------------------------------------------

## 3.4 Steam Name

### What the user includes:

Steam **display name**.

### Verification:

1.  Attempt `https://steamcommunity.com/id/<name>`\
2.  Attempt `https://steamcommunity.com/profiles/<64bitID>` if
    applicable.\
3.  If multiple profiles match, return **unknown**.

### outcomes:

-   **verified** -  User page must include a challenge string anywhere, as per Twitch verification\
-   **accepted**\
-   **reject**\
-   **unknown**

------------------------------------------------------------------------

## 3.5 Gamerprofiles Name

### Verification:

1.  Construct profile URL.\
2.  Confirm valid profile structure.

### outcomes:

-   **verified**\
-   **accepted**\
-   **reject**\
-   **unknown**

------------------------------------------------------------------------

## 3.6 Playtracker Name

### Verification:

1.  Query Playtracker profile page.\
2.  Validate returned data.

### outcomes:

-   **verified**\
-   **accepted**\
-   **reject**\
-   **unknown**

------------------------------------------------------------------------

## 3.7 GitHub Username

### Verification:

1.  Fetch `https://github.com/<username>`.\
2.  Confirm HTTP 200.\
3.  Reject on 404 or placeholder page.

### outcomes:

-   **verified**\
-   **accepted**\
-   **reject**\
-   **unknown**

------------------------------------------------------------------------

# 4. Witness/Oracle Combined Attestation

A witness may issue a **combined multi-platform verification** for
efficiency.

### Example attestation JSON:

``` json
{
  "version": 1,
  "type": "social_link_verification",
  "issuer": "npub_witness...",
  "subject": "npub_user...",
  "results": [
    {
      "platform": "github",
      "value": "AliceDev",
      "status": "accepted",
      "checked_at": "2025-12-14T01:00:00Z"
    },
    {
      "platform": "steam",
      "value": "AliceTheGamer",
      "status": "unknown",
      "reason": "ambiguous username match"
    },
    {
      "platform": "keyoxide",
      "value": "https://keyoxide.org/Alice",
      "status": "reject",
      "reason": "profile not found"
    }
  ]
}
```

Nostr event:\
- `kind`: **8101**\
- `tags`: `["p", "<npub_user>"]`, `["issuer", "<npub_witness>"]`

------------------------------------------------------------------------

# 5. Rejection Rules

A verification result becomes **reject** when:

-   Username/link format is invalid\
-   The service returns a definitive 404/not found\
-   The provided value is impossible for that platform\
-   The account appears removed or suspended

**Unknown** is used for:

-   Ambiguous matches\
-   Temporary timeouts\
-   Unexpected responses

------------------------------------------------------------------------

# 6. Future Extensions

-   Add Mastodon, Bluesky, or other Fediverse/social handles.\
-   Add website DNS TXT verification.\
-   Add composite proofs using Keyoxide claims.\
-   Allow community-run verification hubs to publish attestations.

------------------------------------------------------------------------

# End of Addendum v0.1
