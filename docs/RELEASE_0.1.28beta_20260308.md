# Release Summary: 0.1.28beta (March 8, 2026)

This document summarizes updates and changes made in the two weeks leading to the 0.1.28beta release (February 22 – March 8, 2026).

---

## Core Manifest & Update System

### DNS-based Pointer Support
- **DNS pointer as secondary mechanism** for core manifest updates, running after on-chain check. Uses `dns-pointer.js` to query DNS TXT (metadata) and URI (RFC 7553) records via `dns-query`.
- Section-specific or top-level `dnshost_pointer` from manifest. Separate caches: `corepointer.json` (on-chain) and `dns_corepointer.json` (DNS), updated only when respective source is verified.
- New dependency: `dns-query`.

### Wayfinder for Arweave URLs
- Core manifest update flow now uses Wayfinder for `ar://` fallback URLs in brefs—`downloadCoremanifestDat` detects `ar://`, calls `arweaveFetchConfig.resolveArweaveDownloadUrl`, then fetches via resolved gateway.
- **Arweave resiliency**: Wayfinder no longer depends on a single host. Uses `CompositeGatewaysProvider` with multiple trusted peers (permagate.io, ardrive.net, ar-io.net, arweave.net) in fallback order.
- **resolveArweaveDownloadUrl fix**: Correct handling of Wayfinder `resolveUrl` returning a `URL` object instead of `{ url }`; fixes "need txid or path" errors during catalog downloads.
- **arweave.net down temp fix** when primary gateway is unavailable.
- **prepare_databases**: Unpacked `@ar.io/wayfinder-core` and dependencies (arweave-fetch-config, form-data, ethers, opentelemetry, etc.) so the prepare-databases script can load Wayfinder in packaged builds.

---

## Load Manual Feature

### New Feature: Load Manual Dialog
- "Load Manual" button opens a modal to create a temporary RHPAK and install games from:
  - Local files (BPS, ZIP, 7z, RHPAK)
  - Direct URL
  - Browser (From Page / From SMWC Game ID)
- Pre-checks archives: lists BPS files, BPS picker when multiple BPS exist, metadata pre-population from bpsindex/games JSON.
- "Scrape Metadata" extracts name, authors, difficulty, type from SMWC page DOM.

### Fixes & Enhancements
- **7z in packaged app**: Fixed "7za not found" in packaged builds by using `get7zaPath()` (same unpacked 7za path as catalog/game-stager) in `load-manual-utils.js`.
- **Open Page download file type detection**: Correct identification of 7z, ZIP, BPS, RHPAK using Content-Type header, filename extension, and magic-byte fallback. Fixed "Invalid or unsupported zip format" for 7z files.
- **7z BPS extraction**: Awaited `extractAllFrom7z` so `findBps` runs after extraction; metadata from bpsindex/*.json now read correctly for Name/Author/Difficulty/Type prepopulation.
- **Quick chips**: Added quick-access chips (SMWC, RHDN, SMWC_W, SMWDB, RHR) in From Page tab.
- **Open from page fixes** and Manual Load dialog improvements.

---

## IPFS & Fetch Infrastructure

- **IPFS Helia fallback**: When `@helia/verified-fetch` cannot be loaded (e.g. packaged AppImage), ipfs-fetch-config falls back to basic HTTP gateway fetch.
- **Helio fallback**: Switched back to basic fetch when Helio appears to hang.
- **Vue app IPFS fetching enhancement** and improved `prepare_databases` IPFS-first for rhdata.
- **prepare_databases IPFS error logging**: Logs `[download-error] ... via ipfs -> ...` when IPFS fails and fallback occurs.
- **Catalog download progress UI lag fix**: Throttled progress IPC to every 5% change (or 250ms for unknown total) to prevent IPC queue flooding. Explicit `downloadComplete: true` for immediate progress bar clearance.

---

## UI & Usability

### Maps Reference
- **SMWCentral.net Maps Reference** added to USB2SNES Quick Actions. Modal to browse SMW memory map JSON files (RAM Map, ROM Map, Registers, SRAM, SMWhijacks). Data from IPFS (CID from coremanifest smwcmaps), cached in userData/smwcmaps.

### Filters
- **Custom Patches list filtering**: Filter/search in Advanced Patch and Start (Apply Extra Patches, Edit System Patch Definitions) and Set Global Conditions.
- **Installed RHPaks filter**: Filter by Name, UUID, or JSON File; "Clear RHPAK Display Filters" button.

### Other
- **File Transfer Settings** z-index fix: Opens above the Settings dialog (no longer hidden).
- **HTML index for waiting** queue items.

---

## Moderation & Tooling

- **Enter moderation results** for waiting queue items.
- **Links update** for documentation and references.

---

## Version History (This Period)

- 0.1.24 (Feb 23)
- 0.1.25beta (Feb 24)
- 0.1.26beta (Feb 25)
- 0.1.27b (Mar 5)
- **0.1.28beta (Mar 8)**

---

For detailed change history, see `docs/CHANGELOG.md` (P20260222 and related entries).
