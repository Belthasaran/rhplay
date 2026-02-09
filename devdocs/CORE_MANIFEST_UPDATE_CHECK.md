---
name: Core Manifest and Update Checking
overview: Plan for implementing the core manifest as the master manifest (with on-chain pointer), _latest manifest resolution in the app data directory, coremanifest.dat binary format with signing/verification scripts, update_coremf maintenance script, and the full "check for updates" flow (on-chain pointer, download, verify, apply) plus bpsarchives_latest out-of-date warning when opening Global Search.
todos: []
isProject: false
---

# Core Manifest and Update Checking Plan

## Context

- **Core manifest** ([electron/coremanifest.json](electron/coremanifest.json)) is the master manifest: it points to current versions of dbmanifest, bpsarchives, and app executables (Windows portable EXE, Linux AppImage) per channel (e.g. `beta`). It will be the payload referenced on-chain via [docs/PointerRegistry.sol](docs/PointerRegistry.sol) (Arbitrum One).
- **Manifest resolution**: Bundled manifests live in the app (e.g. `electron/dbmanifest.json`, `electron/bpsarchives.json`). User-data **latest** files (e.g. `coremanifest_latest.json`, `bpsarchives_latest.json`, eventually `dbmanifest_latest.json`) live in the app data directory and, when **valid** and **newer** (by `lastupdated`), must supersede the bundled copy.
- **Data directory**: Electron `app.getPath('userData')` (e.g. `%APPDATA%\RHTools` on Windows, `~/.config/RHTools` or similar on Linux; app name from package.json [package.json](package.json) / productName "RHTools").
- **On-chain**: Contract `latest()` returns `currentVersion`, `updatedAt`, `payloadSha256`, `payloadSize`, `cid`, `brefs` (base64-encoded URLs). The payload is the **coremanifest.dat** file (binary format below).

---

## 1. Manifest resolution and _latest lifecycle

### 1.1 Resolution order and validity

- **Core manifest**: Resolve **active** core manifest as:  
`userData/coremanifest_latest.json` if it exists, is valid JSON, has `lastupdated`, and `lastupdated <= now_utc_seconds`; else use bundled `coremanifest.json`.  
Treat any manifest with `lastupdated > now_utc_seconds` as invalid (never use or save).
- **bpsarchives**: Same pattern: prefer `userData/bpsarchives_latest.json` if valid and `lastupdated <= now`; else bundled `bpsarchives.json`.  
**Valid** for _latest to “win”: parseable, has `lastupdated`, `lastupdated <= now`, and (when comparing to bundled) `lastupdated >= bundled.lastupdated` so we never replace with older.
- **dbmanifest** (future): Same rule for `dbmanifest_latest.json` vs bundled `dbmanifest.json`; only priority when valid and newer.

### 1.2 Bootstrap / overwrite of _latest from bundled

- **On first run** (or when no valid _latest exists):  
If `coremanifest_latest.json` is missing in userData, copy bundled `coremanifest.json` to `userData/coremanifest_latest.json` (after validating `lastupdated <= now`).  
Same for `bpsarchives_latest.json` (and later `dbmanifest_latest.json`).
- **Overwrite from bundled**: If bundled manifest’s `lastupdated` is **greater** than the _latest file’s `lastupdated`, overwrite the _latest file with the bundled copy (so a fresh install with a newer bundled manifest refreshes _latest).  
Do **not** overwrite when bundled is older; the _latest may have been updated by the “check for updates” flow.

**Files to change:**

- Add a small **manifest-resolver** module (e.g. under [electron/utils/](electron/utils/)) used by main process and (where needed) by prepare_databases when run by the app:
  - `getCoreManifestPath()`, `loadCoreManifest()`: userData `coremanifest_latest.json` vs bundled `coremanifest.json`.
  - `getBpsarchivesManifestPath()`, `loadBpsarchivesManifest()`: userData `bpsarchives_latest.json` vs bundled `bpsarchives.json`.
  - `getDbmanifestPath()` (for future): userData `dbmanifest_latest.json` vs bundled `dbmanifest.json`.
  - Shared helper: read JSON, validate `lastupdated` present (string or number), normalize to integer, and require `lastupdated <= now`; return path or null and parsed object.
- **Bootstrap on app startup** (in [electron/main.js](electron/main.js)): ensure userData dir exists; for core and bpsarchives (and later dbmanifest), if _latest missing or bundled `lastupdated` > _latest `lastupdated`, write bundled → _latest (only when bundled `lastupdated <= now`).
- **Call sites**: Replace direct use of bundled paths with resolver:
  - [electron/main.js](electron/main.js): `getManifestPath()` → use resolver so dbmanifest resolution can later use `dbmanifest_latest.json`; provisioner and `runProvisionerHelper` use resolved path.
  - [electron/utils/catalog-manifest-utils.js](electron/utils/catalog-manifest-utils.js): `locateBpsArchivesManifest()` / `loadBpsArchivesManifest()` → use resolver (userData first, then bundled).
  - [electron/installer/prepare_databases.js](electron/installer/prepare_databases.js): when invoked with `--user-data-dir`, consider resolving dbmanifest from userData (e.g. `dbmanifest_latest.json`) first when that option is implemented; for now document that dbmanifest resolution will be extended in a follow-up.

### 1.3 lastupdated format and validation

- All manifests: `lastupdated` may be **either** a **string** containing the Unix seconds (e.g. `"1770624417"`) **or** a **numeric type** in the JSON (e.g. `1770624417`). Code must accept both and treat as an integer for validation and comparison.
- Reject if missing, not parseable (e.g. string that is not a valid number), or `> Math.floor(Date.now()/1000)`.
- Normalize to integer when comparing or validating (e.g. `Number(parsed.lastupdated)` or parse string to number).

---

## 2. Core manifest structure and naming

- Keep [electron/coremanifest.json](electron/coremanifest.json) structure. Keys are logical identifiers, not filesystem paths:
  - `beta/RHPLAY/win64/portable`: Windows 64-bit portable EXE (case-insensitive).
  - `beta/RHPLAY/linux64/AppImage`: Linux 64-bit AppImage.
  - `beta/dbmanifest.json`, `beta/bpsarchives.json`: metadata (version, updated time) for that channel’s manifests.
  - `beta/MANIFEST_PKG`: ZIP containing `dbmanifest.json` and `bpsarchives.json` (see `contents`); has `sha256`, `size`, `ipfs_cidv1`, ArDrive/URL fields.
- Default channel: `beta`. Client identifies “current channel” (e.g. from build or config) to pick the right entry for app updates and for manifest package.

---

## 3. update_coremf script

- **Location**: e.g. [jsutils/update_coremf.js](jsutils/update_coremf.js) (invoked via `enode.sh` per project rules).
- **Purpose**: After preparing an update (new ZIP, new EXE, or new URLs), update [electron/coremanifest.json](electron/coremanifest.json) for the given target.
- **Options** (examples):
  - `--target <key>`: e.g. `beta/MANIFEST_PKG`, `beta/RHPLAY/win64/portable`, `beta/RHPLAY/linux64/AppImage`.
  - For **MANIFEST_PKG**: `--zipfile <path>`, optionally `--sha256`, `--size`, `--ipfs-cid` (compute if omitted), `--url` / ArDrive-related flags to set URLs and ArDrive metadata.
  - For **software targets**: `--exe <path>` or `--file <path>`, compute sha256/size/ipfs_cidv1 if not provided; options to set URL and ArDrive attributes.
- **Behavior**: Read coremanifest.json, normalize target key (case-insensitive), update the entry, optionally bump `lastupdated`/`versionid` at top level, write back. Use existing patterns from [jsutils/update_bpsarchives.js](jsutils/update_bpsarchives.js) / [jsutils/update_dbmanifest.js](jsutils/update_dbmanifest.js) (e.g. ipfs-only-hash, crypto for sha256).
- **Docs**: Add to [docs/PROGRAMS.MD](docs/PROGRAMS.MD); brief note in [docs/CHANGELOG.md](docs/CHANGELOG.md).

---

## 4. coremanifest.dat binary format and scripts

### 4.1 Format (octet stream)


| Offset  | Size | Content                                                     |
| ------- | ---- | ----------------------------------------------------------- |
| 0       | 8    | `lastupdated` (Unix seconds) as **big-endian uint64**       |
| 8       | 8    | `versionid` as **big-endian uint64**                        |
| 16      | 4    | Compressed size in bytes as **big-endian uint32**           |
| 20      | N    | **LZMA**-compressed UTF-8 bytes of full `coremanifest.json` |
| 20+N    | 64   | **SHA512** of bytes from offset 0 to 20+N-1 (inclusive)     |
| 20+N+64 | 64   | **Ed25519** signature of that SHA512 digest (64 bytes)      |


- All multi-byte integers: **network (big-endian) byte order**.
- **Signing**: Compute SHA512 of the range from offset 0 to 20+N-1 (header + LZMA payload); append that 64-byte digest. Then **sign the SHA512 digest** (the 64 bytes) with Ed25519 and append the 64-byte signature. The signature is over the hash, not the full payload.
- **Verification**: Recompute SHA512(header + LZMA); compare with the stored 64-byte digest; then verify the Ed25519 signature against that digest (not against the raw payload) using the known public key.

### 4.2 Script: create coremanifest.dat

- **Script**: e.g. [jsutils/create_coremf_dat.js](jsutils/create_coremf_dat.js) or similar name.
- **Inputs**: Path to `coremanifest.json`; path to **PEM-encoded, AES-256-encrypted Ed25519 private key** (OpenSSL format: `-----BEGIN ENCRYPTED PRIVATE KEY-----` … `-----END ENCRYPTED PRIVATE KEY-----`).
- **Steps**:
  1. Read and parse `coremanifest.json`; validate `lastupdated <= now`.
  2. Serialize JSON to UTF-8 (deterministic: e.g. `JSON.stringify(parsed)` with no extra whitespace).
  3. Compress with LZMA (use existing [lzma-native](https://www.npmjs.com/package/lzma-native) as in [lib/blob-creator.js](lib/blob-creator.js)).
  4. Build binary: 8-byte lastupdated, 8-byte versionid, 4-byte compressed length, LZMA blob.
  5. Compute SHA512(header + LZMA blob) and append the 64-byte digest.
  6. Decrypt and load Ed25519 private key from PEM (prompt for passphrase or use env); **sign the SHA512 digest** (the 64 bytes from step 5); append 64-byte signature.
  7. Write `coremanifest.dat`.
- **Public key**: Hardcode the expected public key (you specified):  
`-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAg2OfoECrhroIOmtHhn2mPMtXBN9NspqN8VNO1v3lBxg=\n-----END PUBLIC KEY-----`
- **CLI**: `--help`, `--coremanifest <path>`, `--key <pem path>`, `--output <path>`; optional `--passphrase-env VAR`.

### 4.3 Script: verify (and optionally extract) coremanifest.dat

- **Script**: e.g. [jsutils/verify_coremf_dat.js](jsutils/verify_coremf_dat.js).
- **Options**: `--input <path>`, `--extract <path>` (optional: write decompressed JSON to file), `--verify-only` (default: verify and optionally extract).
- **Steps**:
  1. Read file; parse header: lastupdated (8), versionid (8), compressed size (4). Validate `lastupdated <= now`.
  2. Read LZMA payload (length from header).
  3. Compute SHA512(header + LZMA); compare with next 64 bytes; fail if mismatch.
  4. Verify Ed25519 signature (next 64 bytes) **over the SHA512 digest** (the 64 bytes from step 3) using the hardcoded public key; fail if invalid.
  5. If `--extract`: LZMA-decompress and write JSON to specified path.
- **Docs**: List in [docs/PROGRAMS.MD](docs/PROGRAMS.MD).

---

## 5. Check for updates (core manifest) flow

### 5.1 When to run

- **At launch**: Run once per session.
- **Skip** if we already have a “current” core manifest: e.g. a small cache file in userData (e.g. `corepointer.json` or similar) storing last seen on-chain `currentVersion` (and optionally `updatedAt`); if `latest().currentVersion` equals cached version and we have a valid `coremanifest_latest.json` with matching or newer semantics, do not re-download. Otherwise, or on **manual “Check for updates”**, run the full flow.

### 5.2 Fetch pointer from chain

- Use an **Arbitrum One** RPC endpoint (configurable or list of public RPCs with fallback; see [docs/ONCHAIN_POINTER_DISCUSSION.md](docs/ONCHAIN_POINTER_DISCUSSION.md)).
- Call contract `latest()` (read-only). Contract address from active core manifest’s `pointer` (e.g. per-target or a single default; clarify in implementation: e.g. use one pointer for “the” core manifest payload).
- Parse: `currentVersion`, `updatedAt`, `payloadSha256`, `payloadSize`, `cid`, `brefs`. Decode **brefs** from base64 to get URLs.

### 5.3 Decide if update needed

- If on-chain `currentVersion` (or equivalent) is **not greater** than the version we already have (from cache + current `coremanifest_latest.json`), consider up to date: do not replace files; do not check again until next launch or manual check.

### 5.4 Download and verify

- **Download**: Fetch payload (coremanifest.dat) from IPFS (using `cid`) or from brefs URLs (base64-decoded) until one succeeds. Prefer same order as contract/docs (e.g. IPFS then brefs).
- **Verify in order**:
  1. **On-chain SHA256**: `sha256(downloaded_bytes) === payloadSha256` (use bytes32 from contract). If mismatch, discard and do not replace any file.
  2. **.dat integrity**: Parse .dat; verify SHA512 and Ed25519 signature (same logic as verify script). If either fails, discard and do not replace.
  3. **lastupdated**: From decompressed JSON, read `lastupdated` (accept either string or number); normalize to integer and require `lastupdated <= now_utc_seconds`; if in future, reject.
  4. **Monotonicity**: Only accept if new manifest’s `lastupdated` is **greater** than current active core manifest’s `lastupdated`.
- **Commit**: Only after all checks pass: write downloaded bytes to `userData/coremanifest_latest.dat` and write decompressed JSON to `userData/coremanifest_latest.json`; update corepointer cache (e.g. store `currentVersion`, `updatedAt`). Do not modify existing files until verification is complete (write to temp then rename if desired).

### 5.5 Implementation points

- **RPC**: Use `eth_call` to `latest()` (no gas). A small module (e.g. in electron or jsutils) that takes contract address and ABI slice for `latest()`, returns decoded struct. Consider `ethers` or `web3` already in use; otherwise add minimal dependency.
- **Download**: Reuse patterns from [electron/utils/catalog-download-manager.js](electron/utils/catalog-download-manager.js) or prepare_databases (IPFS + URL fallback). Decode brefs from base64 for fetch.
- **Integrate in main process**: Call this flow from [electron/main.js](electron/main.js) after app ready (or after first window), non-blocking; persist result in userData and optionally expose “update available” state to renderer for a simple warning (no auto-download of app yet).

---

## 6. Software update (app executable) check

- **Source of truth**: Active core manifest (resolved via section 1). Determine current **channel** (e.g. `beta`) and **platform** (win64/portable vs linux64/AppImage) from environment (e.g. `process.platform`, `process.arch`, and whether running as AppImage/portable).
- **Entry**: Resolve key case-insensitively (e.g. `beta/RHPLAY/win64/portable` or `beta/RHPLAY/linux64/AppImage`). Compare `version` (or equivalent) in that entry to current app version (e.g. from package.json or build).
- **Phase 1**: If a newer version is available, **warn only** (e.g. toast or dialog at launch or in a “Check for updates” action).
- **Phase 2 (later)**: Add UI to **download** the latest executable (from that entry’s URLs/IPFS/ArDrive) and **save** it to the **same parent directory** as the running executable (e.g. `path.dirname(process.execPath)`), with clear user confirmation.

---

## 7. bpsarchives_latest out-of-date warning (Global Search)

- **When**: User opens **Global Search** (catalog search). Integration point: [electron/renderer/src/App.vue](electron/renderer/src/App.vue) – `openCatalogSearchModal` / `actuallyOpenCatalogSearchModal`; backend already calls `catalogCheckAvailability` and `catalogCheckUpdates` ([electron/ipc-handlers.js](electron/ipc-handlers.js) around 16795).
- **Logic**: After resolving bpsarchives manifest (userData `bpsarchives_latest.json` or bundled), decide if “manifest is out of date”:
  - Option A: Compare `lastupdated` of current bpsarchives to the **core manifest**’s `beta/bpsarchives.json` entry’s `updated` (or equivalent). If core says there’s a newer bpsarchives available (e.g. core’s `updated` > current manifest’s `lastupdated`), show warning.
  - Option B: Expose an IPC that checks “is there a newer bpsarchives in the MANIFEST_PKG / core manifest?” and return a boolean + optional message.
- **UI**: When opening catalog search, if manifest is out of date: show a **warning** (e.g. banner or dialog) with an option to **“Update manifest”**. “Update manifest” can: trigger download of `beta/MANIFEST_PKG` ZIP, extract `bpsarchives.json`, validate `lastupdated <= now` and `lastupdated > current`, then write `userData/bpsarchives_latest.json`. Reuse download/verify patterns from catalog or prepare_databases; verification: at least SHA256 of ZIP from core manifest entry.

---

## 8. Core pointer cache and contract address

- **Cache file**: e.g. `userData/corepointer.json` (or similar): store `currentVersion`, `updatedAt`, and optionally `payloadSha256` from last successful `latest()` so we can skip re-download when unchanged.
- **Contract address**: Read from active core manifest. In [electron/coremanifest.json](electron/coremanifest.json), targets include `"pointer": "0x43535E8280C0Ec9e845Cacb456C45f576d6D581a"`. Decide whether the “core” payload (coremanifest.dat) is always from one contract address (e.g. a single global pointer in the JSON) or per-target; the doc suggests one pointer for the canonical core manifest payload. Implement with one pointer for the core manifest update flow.

---

## 9. Documentation and project rules

- **docs/PROGRAMS.MD**: Add `update_coremf.js`, `create_coremf_dat.js` (or chosen names), `verify_coremf_dat.js` with one-line descriptions and usage.
- **docs/CHANGELOG.md**: Short entry for core manifest and update-checking feature set.
- **docs/ONCHAIN_POINTER_DISCUSSION.md** / **docs/PointerRegistry.sol**: No change required; plan aligns with existing contract and discussion. Optionally add a pointer to a short “Core manifest and update flow” section in docs or devdocs describing resolution order, .dat format, and when _latest is used.
- **Environment variables**: If any script needs override for manifest or key paths, follow project rule (e.g. `COREMF_FILE`, `COREMF_KEY_PATH`) and document in script `--help`.

---

## 10. Testing and edge cases

- **Manifest resolution**: Unit or integration tests for resolver: missing _latest; _latest invalid (bad JSON, future `lastupdated`); bundled newer vs older than _latest; `lastupdated <= now` enforced. Test that `lastupdated` is accepted as both string and number in JSON.
- **.dat creation/verification**: Test create then verify; verify with wrong key or tampered payload fails; future `lastupdated` in JSON rejected.
- **Update flow**: Mock RPC returning `latest()`; mock download; assert that on mismatch (SHA256, SHA512, or signature) we do not write `coremanifest_latest.json`/`.dat`.
- **dbmanifest.json**: There is a typo in the existing [electron/dbmanifest.json](electron/dbmanifest.json) line 2 (`"lastupdated" : " 1770624417` – missing closing quote). Fix separately or as part of manifest tooling; ensure `lastupdated` is a string of digits for consistency with bpsarchives/coremanifest.

---

## 11. Implementation order (suggested)

1. **Manifest resolver and bootstrap** (section 1): shared module, bootstrap in main, wire core + bpsarchives resolution in catalog-manifest-utils and main (getManifestPath for provisioner). Fix dbmanifest.json typo if touching it.
2. **coremanifest.dat scripts** (section 4): create and verify scripts; document.
3. **update_coremf** (section 3): script to update coremanifest.json targets.
4. **Check for updates flow** (section 5): RPC + download + verify + write _latest and cache; integrate at launch + manual trigger.
5. **Software update check** (section 6): read active core manifest, compare version, warn (Phase 1).
6. **bpsarchives_latest warning** (section 7): when opening Global Search, check “manifest out of date” and offer “Update manifest” (download MANIFEST_PKG, extract bpsarchives.json, write bpsarchives_latest.json).
7. **dbmanifest_latest** (section 1.2 + prepare_databases): when ready, add resolution and bootstrap for dbmanifest_latest.json and wire prepare_databases to use it.

---

## Diagram: Core manifest and update flow

```mermaid
sequenceDiagram
  participant App
  participant Resolver
  participant UserData
  participant Bundled
  participant Chain
  participant IPFS

  App->>Resolver: getCoreManifestPath()
  Resolver->>UserData: coremanifest_latest.json valid?
  alt valid and lastupdated <= now
    Resolver-->>App: userData path
  else missing or invalid
    Resolver->>Bundled: coremanifest.json
    Resolver-->>App: bundled path
  end

  App->>Resolver: loadCoreManifest()
  Resolver-->>App: parsed core manifest

  Note over App: Check for updates (launch or manual)
  App->>Chain: latest() on Arbitrum One
  Chain-->>App: currentVersion, payloadSha256, cid, brefs
  alt currentVersion > cached
    App->>IPFS: fetch payload (or brefs URLs)
    IPFS-->>App: coremanifest.dat bytes
    App->>App: verify SHA256, then .dat SHA512 + Ed25519
    alt all pass and lastupdated > current and <= now
      App->>UserData: write coremanifest_latest.dat + .json
    end
  end
```



---

## Summary

- **Manifest resolution**: _latest in userData overrides bundled when valid and (for overwrite rule) bundled can refresh _latest when newer.
- **coremanifest.dat**: Fixed binary layout (lastupdated, versionid, size, LZMA(JSON), SHA512 digest, Ed25519 signature of that digest); create script (PEM key), verify script (hardcoded public key). `lastupdated` in manifest JSONs may be string or number.
- **update_coremf**: CLI to update coremanifest.json targets (MANIFEST_PKG, win64/portable, linux64/AppImage) with new file, sha256, size, IPFS, URLs.
- **Update flow**: Query Arbitrum One `latest()`, decode brefs, download .dat, verify on-chain SHA256 then .dat SHA512 + signature, then lastupdated and monotonicity; only then write _latest and cache.
- **App update**: Compare version from active core manifest entry (channel + platform) to current app; warn first; later add download-to-same-folder UI.
- **Catalog**: When opening Global Search, warn if bpsarchives manifest is out of date (vs core manifest) and offer “Update manifest” (MANIFEST_PKG → bpsarchives_latest.json).

