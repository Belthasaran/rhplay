# Witness / Oracle Scraper Runtime Specification v0.1

### Companion Document to the Unified Scraper Abstraction

### Server-Side Rendering, Verification, Attestation, and Anti-Abuse Architecture

------------------------------------------------------------------------

# 1. Purpose of This Document

This specification defines the **witness/oracle runtime** used to:

-   Perform **server-side challenge extraction** for platforms requiring
    JavaScript rendering\
-   Verify social proof claims (e.g., Twitch, YouTube, GitHub, Steam,
    Keyoxide, URLs)\
-   Produce **signed verification attestations** (Nostr events)\
-   Provide robust **job scheduling**, **timeouts**, **rate limiting**,
    and **anti-abuse protections**\
-   Support pluggable scrapers following the *Unified Scraper
    Abstraction v0.1*

The runtime is separate from the client app:

  ------------------------------------------------------------------------
  Location                  Engine               Purpose
  ------------------------- -------------------- -------------------------
  **Client App (Electron)** Electron WebContents Local validation with
                                                 user interaction

  **Witness / Oracle**      **Puppeteer**        Centralized
                                                 high-reliability
                                                 scraping, attestation
                                                 generation
  ------------------------------------------------------------------------

------------------------------------------------------------------------

# 2. Runtime Goals

The oracle must:

1.  Load pages using **headless Chromium** (via Puppeteer)\
2.  Extract About/Bio text and search for **npub1xxxx substrings**\
3.  Feed platform verifiers from the unified abstraction\
4.  Produce a deterministic **VerificationResult**\
5.  Optionally sign and publish a **Nostr attestation event**\
6.  Operate safely under heavy load with **predictable resource use**\
7.  Provide **modular support** for adding new platforms

------------------------------------------------------------------------

# 3. Runtime Architecture

### 3.1 High-Level Components

     ┌────────────────────────┐
     │ Verification Requester │  (Client, Bot, Admin, etc.)
     └──────────────┬─────────┘
                    │
            (Nostr DM, REST, RPC)
                    │
     ┌──────────────▼──────────────┐
     │   Witness Runtime Gateway    │
     │  - Routing                   │
     │  - Validation of parameters  │
     │  - Rate limiting             │
     └──────────────┬──────────────┘
                    │
          ┌────────▼────────┐
          │   Job Queue     │
          │ (Redis, local)  │
          └--------┬---------┘
                   │
            ┌──────▼────────┐
            │ Scraper Pool  │
            │ (Puppeteer)   │
            └──────┬────────┘
                   │
          ┌────────▼─────────┐
          │ Platform Verifier │
          │  (Twitch, YT...)  │
          └────────┬─────────┘
                   │
          ┌────────▼────────┐
          │ Verification     │
          │ Evaluation Core  │
          └────────┬────────┘
                   │
          ┌────────▼─────────────┐
          │ Attestation Generator │
          └────────┬─────────────┘
                   │
          ┌────────▼──────────────┐
          │  Nostr Event Publisher │
          └────────────────────────┘

------------------------------------------------------------------------

# 4. Job Workflow

## 4.1 Request Ingress

Requests may come from:

-   Local client writes to a Nostr event requesting verification\
-   Scheduled rechecks\
-   Admin API\
-   Peer applications

Minimal required info per job:

``` json
{
  "platform": "twitch",
  "identifier": "belthasar",
  "expected_npub": "npub1xyz...",
  "requester": "npub1requester..."
}
```

------------------------------------------------------------------------

## 4.2 Queue Processing Rules

-   Max concurrency: configurable (e.g., 2--8 parallel scrapers)
-   Hard timeout per job: **10--15 seconds**
-   Kill browser instance after timeout
-   Automatic retry: max 1 additional attempt

Jobs failing twice are marked `"status": "error"`.

------------------------------------------------------------------------

# 5. Scraper Execution (Puppeteer Runtime)

## 5.1 Required Puppeteer Settings

``` ts
const browser = await puppeteer.launch({
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check"
  ]
});
```

Rationale:

-   **--no-sandbox** required for many container environments\
-   **--disable-dev-shm-usage** prevents shared memory overflows\
-   Headless Chrome "new" API is more stable

------------------------------------------------------------------------

# 6. Renderer Implementation Contract

The Puppeteer renderer implements:

``` ts
export interface Renderer {
  render(url: string): Promise<RenderedPage>;
}
```

Rendering steps:

1.  Navigate with:

    ``` ts
    await page.goto(url, { waitUntil: "networkidle2" });
    ```

2.  Extract rendered text:

    ``` ts
    const text = await page.evaluate(() => document.body.innerText || "");
    ```

3.  Extract rendered HTML:

    ``` ts
    const html = await page.evaluate(() => document.body.innerHTML || "");
    ```

Timeout is enforced at the **job level**, not Puppeteer level.

------------------------------------------------------------------------

# 7. Platform Verifier Integration

The witness uses the same abstraction as the client:

``` ts
const verifier = new TwitchVerifier(new PuppeteerRenderer());
const page = await verifier.loadProfile(username);
const verified = await verifier.verify(page, expectedNpub);
```

All logic for:

-   URL construction\
-   DOM expectations\
-   Platform quirks

resides in the platform-specific verifier.

------------------------------------------------------------------------

# 8. Verification Decision Rules

Given rendered text: - Find all occurrences of `expectedNpub` - If at
least one match exists → `status = "valid"`

Otherwise:

  Condition                          Status
  ---------------------------------- -------------
  Page loads but contains no match   `not_found`
  Page fails to load                 `error`
  Unexpected HTML                    `malformed`
  DOM too short / empty              `empty`

The runtime returns:

``` json
{
  "status": "valid",
  "matches": ["npub1xyz..."],
  "rawTextLength": 4821
}
```

------------------------------------------------------------------------

# 9. Witness Attestation Generation

When verification succeeds:

``` ts
const nostrEvent = {
  kind: 8101,
  content: JSON.stringify({
    platform: "twitch",
    identifier: username,
    result: "valid",
    matches: proofs,
    checked_at: new Date().toISOString()
  }),
  tags: [
    ["p", expectedNpub],
    ["witness", witnessPubkey]
  ],
  created_at: Math.floor(Date.now() / 1000)
};
```

The witness signs using its Nostr key and publishes to configured
relays.

------------------------------------------------------------------------

# 10. Anti-Abuse Considerations

To prevent system overload:

### Input Rate Limits

-   IP-based throttle\
-   Requester npub throttle\
-   Platform-specific throttle

### Platform Load Limits

-   Twitch: max 1--3 calls per second\
-   YouTube: stricter delays to avoid temporary soft blocks

### Rendering Safety

-   Browser restart every N jobs\
-   Memory ceiling enforcement\
-   Kill browser on navigation loops

### Attested Output Controls

-   Limit attestations per user\
-   Re-check existing verification before scraping again\
-   Delay repeated checks (min 1--3 hours)

------------------------------------------------------------------------

# 11. Logging & Monitoring Requirements

Each job emits:

    JobStarted(platform, identifier)
    NavigationSuccess(url)
    TextExtracted(bytes)
    ProofFound(count)
    VerificationStatus(status)
    AttestationPublished(eventId)
    JobCompleted(durationMs)

Errors must include:

    PageLoadFailed
    TimeoutExceeded
    DOMTooSmall
    RendererCrashed
    ProofExtractionError

------------------------------------------------------------------------

# 12. Configuration

``` jsonc
{
  "concurrency": 4,
  "timeoutMs": 15000,
  "retryCount": 1,
  "puppeteerArgs": ["--no-sandbox", "--disable-dev-shm-usage"],
  "platformLimits": {
    "twitch": { "minDelayMs": 1500 },
    "youtube": { "minDelayMs": 2500 }
  },
  "nostrRelays": [
    "wss://relay1.example",
    "wss://relay2.example"
  ]
}
```

------------------------------------------------------------------------

# 13. Deployment Model

### Supported environments:

-   Docker\
-   Node LTS\
-   Kubernetes (with Puppeteer sidecar or Chrome stable package)\
-   Standalone VM

### Resource expectations:

  Component              Approx
  ---------------------- -------------
  Puppeteer instance     150--300 MB
  One Chrome tab         40--90 MB
  Max safe concurrency   2--8 tabs

------------------------------------------------------------------------

# 14. Summary

The witness/oracle runtime:

-   Implements the **Unified Scraper Abstraction** using Puppeteer\
-   Provides robust, scalable rendering + extraction\
-   Issues Nostr attestations for verified profile claims\
-   Enforces strong anti-abuse and job scheduling policies\
-   Is suitable for deployment in cloud or server environments

This forms the backbone of the platform verification ecosystem that
complements the local Electron client.

------------------------------------------------------------------------

# End of Witness / Oracle Scraper Runtime Spec v0.1
