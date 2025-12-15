# Twitch Challenge Extraction Draft Specification v0.1

### Approaches to Rendering-Based Scraping, Verification Abstractions, and the "TwitchVerifier Concept"

------------------------------------------------------------------------

# 1. Problem Statement

Nostr-linked identity verification requires clients (and optional
witness services) to:

1.  Fetch a user's Twitch profile "About" section\

2.  Inspect user-provided text\

3.  Locate a minimal verification marker, e.g.:

        npub1xxxx...

However, Twitch does **not** deliver this content in static HTML.
Instead:

-   The page at `https://m.twitch.tv/<username>/about` is a **React
    Single-Page Application**.
-   The initial HTML is a near-empty DOM containing only:
    -   `<div id="root"></div>`
    -   JS bundles\
-   The About/Bio content is dynamically rendered client-side.

As a result:

-   A simple HTTP fetch **cannot** retrieve the About/Bio text.
-   The extractor must execute Twitch's client-side JavaScript.
-   This requires **browser execution** or an equivalent JavaScript
    runtime.

This document provides a discussion of two viable approaches, and
proposes an initial "TwitchVerifier" abstraction suitable for both the
Electron client app and the server-based Oracle/Witness.

------------------------------------------------------------------------

# 2. Rendering-Based Solutions

Two approaches are viable:

------------------------------------------------------------------------

## 2.1 Option A --- Use Electron's Internal Browser Engine (for Client App)

Because the main app is already an Electron application, it includes a
full Chrome rendering engine via Chromium. This allows:

-   Creating an **offscreen BrowserWindow**\
-   Loading Twitch URLs directly\
-   Executing page JavaScript\
-   Extracting the fully-rendered DOM through `executeJavaScript()`\
-   Searching for verification markers in the body text

### Advantages

-   No additional dependencies (reuses Chromium inside Electron).
-   Fully sandboxed to the local user environment.
-   Easy to deploy to all client machines.
-   Excellent for local, user-driven verification.

### Limitations

-   Not usable inside backend Oracle/Witness environments.
-   DOM may change, requiring updates.
-   Electron updates must be coordinated with releases.

### Suitability for Other Platforms

  ------------------------------------------------------------------------------
  Platform             Works with Option A?                   Notes
  -------------------- -------------------------------------- ------------------
  Twitch               ✔                                      SPA content loads
                                                              fine.

  YouTube              ✔                                      Also SPA-heavy;
                                                              requires
                                                              rendering.

  GitHub               ✔                                      Largely
                                                              server-rendered.

  Steam                ✔                                      Some dynamic
                                                              rendering but
                                                              works.
  ------------------------------------------------------------------------------

------------------------------------------------------------------------

## 2.2 Option B --- Use Puppeteer (for Oracle/Witness or Headless Environments)

Puppeteer is a headless Chrome automation framework.

### Advantages

-   Very stable for scraping and automation.
-   Fully independent of Electron.
-   Works in CI, Docker, servers, or cloud environments.
-   Ideal for a centralized witness oracle.

### Limitations

-   Larger dependency footprint.
-   May require sandbox adjustments in Docker.
-   Adds a headless browser to server deployments.

### Suitability for Other Platforms

  ------------------------------------------------------------------------
  Platform                Puppeteer Works?                   Notes
  ----------------------- ---------------------------------- -------------
  Twitch                  ✔                                  Fully
                                                             supported;
                                                             widely used.

  YouTube                 ✔                                  Excellent for
                                                             SPA sites.

  GitHub                  ✔                                  Very stable
                                                             for scraping.

  Steam                   ✔                                  Requires some
                                                             delays for
                                                             dynamic
                                                             content.
  ------------------------------------------------------------------------

------------------------------------------------------------------------

# 3. Hybrid Long-Term Strategy

  Environment             Recommended Method
  ----------------------- -------------------------------------
  Electron Client App     **Option A** (Electron WebContents)
  Witness/Oracle Server   **Option B** (Puppeteer)

This provides:

-   Minimal dependencies for client users\
-   Maximum flexibility for server tasks\
-   Redundancy in case Twitch alters site structure

------------------------------------------------------------------------

# 4. Verification Abstraction Model

A shared abstraction ensures all platform verifiers follow a uniform
workflow.

### Interface Concept

``` ts
interface ProfileVerifier {
  loadProfile(identifier: string): Promise<RenderedProfile>;
  extractProof(rendered: RenderedProfile): Promise<ProofResult>;
  verifyProof(result: ProofResult, expectedNpub: string): VerificationStatus;
}

interface RenderedProfile {
  html: string;
  text: string;
  url: string;
}

interface ProofResult {
  proofs: string[];
  rawText: string;
}

type VerificationStatus = "valid" | "not_found" | "malformed" | "error";
```

Workflow:

    load (render page) → extract text → locate proof → produce verification result

Each platform (Twitch, YouTube, GitHub, Steam) gets its own
implementation.

------------------------------------------------------------------------

# 5. Draft "TwitchVerifier Concept"

Two implementations:

-   `TwitchVerifierElectron` --- For client-side verifications.
-   `TwitchVerifierPuppeteer` --- For server-based witness/oracle
    verifications.

Both implement `ProfileVerifier`.

------------------------------------------------------------------------

## 5.1 Workflow

### 1. Load the URL

    https://m.twitch.tv/<username>/about

### 2. Wait for DOM hydration

Twitch loads the About/Bio asynchronously via React.

### 3. Extract text

Simplest reliable method:

``` js
document.body.innerText
```

### 4. Identify verification markers

The challenge format must be compact, e.g.:

    <npub>

Extraction logic:

``` js
text.split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("npub"));
```

### 5. Return ProofResult

Used by the caller to validate Nostr keys.

------------------------------------------------------------------------

# 5.2 Example: Electron Implementation

``` ts
import { BrowserWindow } from "electron";

export class TwitchVerifierElectron {
  async loadProfile(username: string): Promise<RenderedProfile> {
    const url = `https://m.twitch.tv/${encodeURIComponent(username)}/about`;

    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    await win.loadURL(url);
    await new Promise(r => setTimeout(r, 4000)); // wait for hydration

    const text = await win.webContents.executeJavaScript(`document.body.innerText || ""`);
    const html = await win.webContents.executeJavaScript(`document.body.innerHTML || ""`);

    win.destroy();

    return { html, text, url };
  }

  async extractProof(rendered: RenderedProfile): Promise<ProofResult> {
    const lines = rendered.text.split("\n").map(l => l.trim()).filter(Boolean);
    const proofs = lines.filter(l => l.startsWith("npub"));
    return { proofs, rawText: rendered.text };
  }
}
```

------------------------------------------------------------------------

# 5.3 Example: Puppeteer Implementation

``` ts
import puppeteer from "puppeteer";

export class TwitchVerifierPuppeteer {
  async loadProfile(username: string): Promise<RenderedProfile> {
    const url = `https://m.twitch.tv/${encodeURIComponent(username)}/about`;

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: "networkidle2" });

    const text = await page.evaluate(() => document.body.innerText || "");
    const html = await page.evaluate(() => document.body.innerHTML || "");

    await browser.close();

    return { html, text, url };
  }

  async extractProof(rendered: RenderedProfile): Promise<ProofResult> {
    const lines = rendered.text.split("\n").map(l => l.trim()).filter(Boolean);
    const proofs = lines.filter(l => l.startsWith("npub"));
    return { proofs, rawText: rendered.text };
  }
}
```

------------------------------------------------------------------------

# 6. Future Refinements

-   Rate limiting for anti-abuse protection\
-   Better selectors for finding About/Bio blocks\
-   Twitch GraphQL API fallback (if permitted)\
-   Cross-platform verifier registry\
-   Consistent error codes and messages

------------------------------------------------------------------------

# End of Draft Specification v0.1
