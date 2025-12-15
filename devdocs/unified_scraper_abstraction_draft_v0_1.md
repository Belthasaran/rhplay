# Unified Scraper Abstraction Draft v0.1

### Multi‑Platform Rendering Extraction Framework for Nostr Challenge Verification

### (Electron Option A for Client; Puppeteer Option B for Witness/Oracle)

------------------------------------------------------------------------

# 1. Purpose of This Draft

This document provides a **unified abstraction layer** for challenge
extraction across platforms such as Twitch, YouTube, Steam, Keyoxide,
GitHub, and others.\
It defines:

-   A shared **verifier interface**
-   **Electron-based rendering strategy** for the client app (Option A)
-   **Puppeteer-based rendering strategy** for oracle/witness services
    (Option B)
-   A unified system for locating verification data inside rendered text

**Important design decision:**\
The challenge format is simplified to **any substring containing the
user's `npub1...` key**, with no prefix like `nostr-proof:v1:` required.

This makes the extraction more flexible and user-friendly:

-   Bio/About fields can contain the npub anywhere in the text.
-   No strict punctuation or formatting required.
-   npub appearing inside URLs, markdown links, etc. is acceptable.

------------------------------------------------------------------------

# 2. Problem Summary

Many verification targets (Twitch, YouTube, some Steam pages) are **SPA
websites** that do not expose their About/Bio content in static HTML.\
Rendering is required:

-   React / Vue hydration\
-   JS-generated DOM\
-   Deferred fetch calls

Plain HTTP fetch is insufficient.

Thus, two execution environments must be supported:

  ------------------------------------------------------------------------
  Environment                        Tool              Notes
  ---------------------------------- ----------------- -------------------
  **Client App (Electron)**          Electron          Minimal deps,
                                     WebContents       already embedded.

  **Witness/Oracle Server**          Puppeteer         Best long-term
                                     (headless)        scraper engine.
  ------------------------------------------------------------------------

The unified abstraction must support **both**.

------------------------------------------------------------------------

# 3. Unified Scraper Interface

The abstraction should allow "plugging in" per‑platform verifiers under
a shared interface.

``` ts
export interface RenderedPage {
  url: string;
  html: string;
  text: string;
}

export interface ProofResult {
  proofs: string[];     // matched substrings containing npub1...
  rawText: string;       // full extracted text
}

export interface ProfileVerifier {
  loadProfile(identifier: string): Promise<RenderedPage>;
  extractProof(page: RenderedPage, targetNpub: string): Promise<ProofResult>;
  verify(page: RenderedPage, targetNpub: string): Promise<boolean>;
}
```

All renderers (Electron or Puppeteer) will produce the same
`RenderedPage` output.

------------------------------------------------------------------------

# 4. Text Extraction Rule (Unified)

Verification rule:

> **If the rendered text contains the substring `npub1xxxx...` (full
> match), the challenge is considered present.**\
> There is no need to check surrounding characters.

Meaning:

-   No newline needed\
-   No prefix needed\
-   npub can appear inside other text\
-   npub inside a clickable link or markdown is valid

**Extractor logic pseudocode:**

``` ts
function findNpubMatches(text: string, targetNpub: string): string[] {
  const matches = [];
  let index = text.indexOf(targetNpub);
  while (index !== -1) {
    matches.push(targetNpub);
    index = text.indexOf(targetNpub, index + 1);
  }
  return matches;
}
```

------------------------------------------------------------------------

# 5. Platform-Agnostic Extraction Core

``` ts
export class BaseVerifier implements ProfileVerifier {

  async extractProof(page: RenderedPage, targetNpub: string): Promise<ProofResult> {
    const trimmed = page.text.replace(/\s+/g, " ");
    const proofs = [];
    let idx = trimmed.indexOf(targetNpub);

    while (idx !== -1) {
      proofs.push(targetNpub);
      idx = trimmed.indexOf(targetNpub, idx + 1);
    }

    return {
      proofs,
      rawText: page.text
    };
  }

  async verify(page: RenderedPage, targetNpub: string): Promise<boolean> {
    const result = await this.extractProof(page, targetNpub);
    return result.proofs.length > 0;
  }
}
```

`BaseVerifier` only needs platform-specific subclasses for **page
loading/rendering**.

------------------------------------------------------------------------

# 6. Rendering Backends

## 6.1 Electron-Based Rendering (Client App)

Class structure:

``` ts
export class ElectronRenderer {
  async render(url: string): Promise<RenderedPage> {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    await win.loadURL(url);
    await new Promise(r => setTimeout(r, 4000));

    const html = await win.webContents.executeJavaScript(`document.body.innerHTML`);
    const text = await win.webContents.executeJavaScript(`document.body.innerText`);

    win.destroy();

    return { url, html, text };
  }
}
```

ElectronRenderer can be reused by all platform verifiers:

-   TwitchVerifierElectron\
-   YouTubeVerifierElectron\
-   SteamVerifierElectron\
-   GenericWebsiteVerifierElectron

------------------------------------------------------------------------

## 6.2 Puppeteer-Based Rendering (Witness / Oracle)

``` ts
export class PuppeteerRenderer {
  async render(url: string): Promise<RenderedPage> {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: "networkidle2" });

    const html = await page.evaluate(() => document.body.innerHTML);
    const text = await page.evaluate(() => document.body.innerText);

    await browser.close();

    return { url, html, text };
  }
}
```

This allows massively scalable verification.

------------------------------------------------------------------------

# 7. Platform Verifier Example: Twitch

``` ts
export class TwitchVerifier extends BaseVerifier {
  constructor(private renderer: Renderer) { super(); }

  async loadProfile(username: string): Promise<RenderedPage> {
    const url = `https://m.twitch.tv/${encodeURIComponent(username)}/about`;
    return this.renderer.render(url);
  }
}
```

**Usage (Electron):**

``` ts
const twitch = new TwitchVerifier(new ElectronRenderer());
const page = await twitch.loadProfile("belthasar");
const ok = await twitch.verify(page, targetNpub);
```

**Usage (Puppeteer):**

``` ts
const twitch = new TwitchVerifier(new PuppeteerRenderer());
```

------------------------------------------------------------------------

# 8. Additional Platform Verifier Examples

Each verifier is a tiny class mapping an identifier → URL.

### YouTube

``` ts
export class YouTubeVerifier extends BaseVerifier {
  constructor(private renderer: Renderer) { super(); }

  async loadProfile(channel: string): Promise<RenderedPage> {
    const url = `https://www.youtube.com/@${channel}/about`;
    return this.renderer.render(url);
  }
}
```

### GitHub

``` ts
export class GitHubVerifier extends BaseVerifier {
  constructor(private renderer: Renderer) { super(); }

  async loadProfile(username: string): Promise<RenderedPage> {
    const url = `https://github.com/${username}`;
    return this.renderer.render(url);
  }
}
```

### Generic URL Verifier

``` ts
export class GenericURLVerifier extends BaseVerifier {
  constructor(private renderer: Renderer) { super(); }

  async loadProfile(url: string): Promise<RenderedPage> {
    return this.renderer.render(url);
  }
}
```

------------------------------------------------------------------------

# 9. Verifier Registry (Optional)

A central registry simplifies platform integration:

``` ts
const verifiers = {
  twitch: new TwitchVerifier(renderer),
  youtube: new YouTubeVerifier(renderer),
  github: new GitHubVerifier(renderer)
};

export function getVerifier(platform: string): ProfileVerifier {
  return verifiers[platform];
}
```

This allows the client UI to dynamically choose a verifier based on
profile metadata.

------------------------------------------------------------------------

# 10. Summary

This unified abstraction accomplishes:

-   Shared logic for `npub1...` substring extraction\
-   Environment-specific rendering engines (Electron or Puppeteer)\
-   Minimal boilerplate for adding new platforms\
-   Consistent verification pipelines for clients and server oracles

This provides the foundation for future features such as:

-   Witness attestation generation\
-   Information caching\
-   Rate limiting\
-   Multi-platform verification orchestration

------------------------------------------------------------------------

# End of Unified Scraper Abstraction Draft v0.1
