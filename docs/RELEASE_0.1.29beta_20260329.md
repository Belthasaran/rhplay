# Release Summary: 0.1.29beta (March 29, 2026)

This document summarizes changes between git tag **`rel0_1_28beta`** and the **0.1.29beta** tree (`package.json` version **0.1.29beta**). It merges the narrative used in [`CHANGELOG.md`](CHANGELOG.md) for this period with a concise survey of repository diffs.

**Git:** 29 commits on the main line from `rel0_1_28beta` to current HEAD; **~49 files** touched, **+4393 / −1331** lines (per `git diff --stat`).

---

## RHTools Launcher (new optional app)

The **`rhtools-launcher/`** Electron app downloads RHPlay (and future apps) from the signed `coremanifest.json` into `releases/<AppId>/<version>/` under shared program data, enforces SHA256 against the manifest and `launcher_allowlist`, and can run database provisioning / updates by spawning `prepare_databases.js` with live progress. See [`RHTOOLS_LAUNCHER.md`](RHTOOLS_LAUNCHER.md) and [`PROGRAMS.MD`](PROGRAMS.MD).

**Highlights (also listed in CHANGELOG):**

- **Launch** beside **Download** when an installed build meets or exceeds the manifest version (`findBestLaunchCandidate`). Child RHPlay is started without inheriting launcher dev URLs (`ELECTRON_START_URL`, `VITE_DEV_SERVER_URL`); on Linux, AppImage-related parent environment is sanitized and `APPIMAGE` is set for the target.
- **Databases** UI: per-database installed vs target, status via `getDatabaseProvisionStatus`; `getDbmanifestPath()` returns a path string (fixes `dbmanifest not found: [object Object]`).
- **Progress** child window (`progress-window.html`, loaded with `loadFile`): bar, status, scrollback; stays open until the user clicks **Close** (releases the long-operation lock). `beginLongOperation` reloads the page when starting a new operation so logs reset. `asarUnpack` and explicit FileSet ensure the HTML ships in AppImage/portable builds.
- **Channel** `beta` / `stable` in `launcher-config.json`.
- **SMW ROM** flow aligned with the main provisioner (`electron/utils/smw-rom.js`, legal notice parity).
- **After a successful RHPlay download:** prompt to run DB updates, then full provisioning if still needed.
- **Catalog / Arweave HTTP path:** `downloadTracker.complete` only after SHA-256 verify and rename so a hash failure does not fall through to the next source (e.g. IPFS).
- **Change Download Settings:** button next to **Refresh core manifest** opens the same **File Transfer and Peer-to-Peer** options as the main app; reads/writes shared **`user-fetch-settings.json`** via `fetch-settings:get-config` / `fetch-settings:save-config` and [`electron/utils/ipfs-fetch-config.js`](../electron/utils/ipfs-fetch-config.js).

**Launcher packaging & size (CHANGELOG):**

- Runtime dependencies live under **`rhtools-launcher/package.json`** (IPFS/Arweave, `ethers`, `dns-query`, `better-sqlite3`, `lzma-native`, `tar`, etc.) instead of vendoring the entire repo `node_modules`. Scripts: `npm install --prefix rhtools-launcher`, `launcher:install-app-deps`, `launcher:prune-for-pack`, then `electron-builder`.
- **`electron-builder.cjs`:** `electronVersion` from root `node_modules/electron`; no duplicate manual `node_modules` FileSet (avoids EINST/EEXIST); `lib/` limited to **`binary-finder.js`** for SMW ROM checks; `vue` dev-only (renderer pre-built).
- **Windows:** [`scripts/launcher-install-app-deps.cjs`](../scripts/launcher-install-app-deps.cjs) runs `install-app-deps` with `cwd` set to `rhtools-launcher` (avoids `cmd.exe` **`'..' is not recognized`** from `cd ... && ../node_modules/...`).
- Main app **`build.files`** and launcher filters exclude build-only packages from `app.asar` where applicable; `extraResources` / `7zip-min` paths corrected; duplicate unpacks reduced.

**User data path:** Launcher **`app.setPath('userData')`** now matches the main app: Electron default from root **`name`** (`rhtools`) — e.g. `%APPDATA%\rhtools`, `~/.config/rhtools` — not `RHTools`. Non-Electron fallback in `manifest-resolver.getUserDataDir()` updated for parity. UI shows **Database folder** and `provisioned.json` near dbmanifest.

**Core manifest (schema note):** [`SCHEMACHANGES.md`](SCHEMACHANGES.md) documents optional launcher entries and future self-update key patterns (JSON only; no SQL migration). `electron/coremanifest.json` / `coremanifest.dat` updated in-tree for this release cycle.

---

## Main app: downloads, updates, and databases

**Catalog / software-update downloads (CHANGELOG):**

- Default artifact source order when URLs exist: **`url` → `ipfs` → `ardrive`** (HTTP before IPFS).
- When comparing a file’s digest to the manifest, **hex string** representations are compared in a **letter-case–insensitive** way (`A`–`F` vs `a`–`f`). The underlying **32-byte** SHA-256 value is unchanged; only how the hex text is written varies. That avoids treating a good HTTP download as a mismatch (then retrying via IPFS) when the manifest uses uppercase hex and the computed hash is lowercase (or the reverse).
- Each `ensureArtifact` source pass **returns early** if `destPath` already matches the manifest hash.

**Software update download progress:** In `electron/utils/software-update-manager.js`, progress callbacks for the same integer percent are limited to **at most once per 500ms** (launcher and main app).

**Database update flow:** Continued work on startup checks, `prepare_databases` integration, executor progress, and in-process helper [`electron/utils/database-update-inprocess.js`](../electron/utils/database-update-inprocess.js). Launcher-oriented pieces include [`electron/utils/launcher-software.js`](../electron/utils/launcher-software.js) and updates to [`database-update-check.js`](../electron/utils/database-update-check.js), [`database-update-executor.js`](../electron/utils/database-update-executor.js), and [`software-update-check.js`](../electron/utils/software-update-check.js).

**`prepare_databases.js` (installer):**

- Progress logging: **`finalizeProgress`** restores `console.log` / `console.error` after streaming logs; resets initialization state; clears `progressDonePath` appropriately.
- Optional **`RHPLAY_PREPARE_DB_THROW=1`** throws instead of JSON exit for tooling/tests.
- **`detectUserDataDir`** uses folder name **`rhtools`** (not `RHTools`) on Windows, macOS, and Linux for consistency with the Electron app.

**IPFS / Arweave config:** Touch-ups in [`ipfs-fetch-config.js`](../electron/utils/ipfs-fetch-config.js) and [`arweave-fetch-config.js`](../electron/utils/arweave-fetch-config.js) aligned with shared `user-fetch-settings.json`.

**Main process:** [`electron/main.js`](../electron/main.js) updated for launcher-related IPC, software/update paths, and related behavior (see git diff for detail).

---

## UI, legal, and developer diagnostics

- **Provisioner / prep:** Disclaimer copy and flow adjusted — extra prominent disclaimer notice; disclaimers **joined with the prep dialog** where applicable ([`Provisioner.vue`](../electron/renderer/src/Provisioner.vue)).
- **LICENSE:** Added a standard **AS IS** / limited liability / non-infringement disclaimer block after the copyright line.
- **Renderer `index.html`:** Early **diagnostic** logging (load/DOMContentLoaded), **Vue mount fallback** panel (hidden unless Vue fails to mount within 2s). Useful for debugging blank-window issues in dev; shipped builds include the same structure.

---

## Tooling and repository maintenance

- **`os-lock`:** Moved to **`optionalDependencies`** so a failed native build on Windows does not break `npm install`. [`jstools/process_arcsfc.js`](../jstools/process_arcsfc.js) loads it with try/catch. Minor doc touch in [`PROCESS_ARCSFC.md`](PROCESS_ARCSFC.md).
- **Core manifest refresh:** `electron/coremf_ar_refresh1.sh` and manifest payload fixes — e.g. **baddr attribute** corrections on coremf-related data (`fix baddr attributes on coremf` in git history).
- **SMWC waiting queue / HTML tooling:** Updates under `jstools/smwc_world/` (queue JSON, CSV indices, moderated packages) and [`jstools/make_waiting_html.py`](../jstools/make_waiting_html.py) for generated waiting-list pages.
- **Root scripts:** Small change to [`runonce.sh`](../runonce.sh).
- **`package.json`:** New launcher-related npm scripts (`launcher:*`, `build:launcher:*`), dependency reshaping for optional native modules and launcher-local installs.

---

## Reference

- **Prior release note:** [`RELEASE_0.1.28beta_20260308.md`](RELEASE_0.1.28beta_20260308.md)
- **Rolling changelog (this cycle entries at top):** [`CHANGELOG.md`](CHANGELOG.md)
- **Launcher manual:** [`RHTOOLS_LAUNCHER.md`](RHTOOLS_LAUNCHER.md)
</think>


<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>
Glob