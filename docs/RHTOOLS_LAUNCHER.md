# RHTools Launcher

The RHTools Launcher is an optional Electron application in `rhtools-launcher/`. It shares the same RHTools program data directory as the main RHPlay app (`%APPDATA%/RHTools` on Windows, `~/.config/RHTools` on Linux).

## Purpose

- Download RHPlay (and future apps) from the signed `coremanifest.json` into `releases/<AppId>/<version>/` under program data.
- Enforce launch safety: an executable is only started if its SHA256 matches the manifest entry for that platform or appears in `launcher_allowlist` (past official builds).
- Run database provisioning and in-place updates by spawning `prepare_databases.js` via `electron/utils/database-update-executor.js` (same streaming progress as the main app’s Database Update flow), with a modal progress window (`rhtools-launcher/progress-window.html`, loaded via `loadFile` with inline script so it works under `file://` without a separate Vite bundle) fed by `launcher:operation-progress`. In-process `database-update-inprocess.js` remains available for tooling/tests.
- Prompt for the Super Mario World ROM when required, using the same legal notice and warranty text as the Database Provisioner (`electron/utils/smw-rom.js`, UI aligned with `Provisioner.vue`).
- Channel selection (`beta` / `stable`) is stored in `launcher-config.json`; only beta entries exist in the manifest today.

## Development

From the repository root:

```bash
npm run launcher:renderer:build
npm run launcher:dev
```

If `require('electron')` fails with `app` undefined, ensure `ELECTRON_RUN_AS_NODE` is unset (the `launcher:dev` script clears it). Running with plain `node` or with `ELECTRON_RUN_AS_NODE=1` makes `require('electron')` resolve to the npm path string instead of the Electron API.

## Builds

```bash
npm run build:launcher:win
npm run build:launcher:linux
```

Artifacts are written to `dist-builds-launcher/` (e.g. `rhtools-launcher-<version>-portable.exe`, `rhtools-launcher-<version>.AppImage`).

## Core manifest conventions

- App packages use keys such as `beta/RHPLAY/<platform>/<format>` (e.g. `beta/RHPLAY/win64/portable`).
- Future launcher self-updates may use keys like `beta/RHToolsLauncher/win64/portable` once published.
- `launcher_allowlist` in the manifest lists `[note, sha256]` pairs for older binaries that are still allowed to run.

## Related code

- `electron/utils/launcher-software.js` — releases paths, download-to-releases, allowlist checks.
- `electron/utils/smw-rom.js` — shared ROM validation and copy.
- `electron/utils/database-update-executor.js` — spawn `prepare_databases` for provision/update/reprovision (launcher uses this).
- `electron/utils/database-update-inprocess.js` — optional in-process `prepare_databases.run()` for tests/tooling.
- `electron/installer/prepare_databases.js` — `RHPLAY_PREPARE_DB_THROW=1` causes `exitWithError` to throw instead of `process.exit` when embedded in-process.
