# Release Summary: 0.1.30beta (March 31, 2026)

This document summarizes changes between git tag **`rel0_1_29beta`** and the current tree for the **0.1.30beta** launcher cycle.

**Git:** 9 commits from `rel0_1_29beta` to HEAD (`git describe`: `rel0_1_29beta-9-g5300d12`).  
**Diffstat:** 18 files changed, **+695 / −235** lines (plus updated binary manifests).

---

## RHTools Launcher (Windows + Linux)

### Core manifest handling (signed `.dat` + `.json`)

- **Bundled signed core manifest included in launcher builds**: Launcher packaging now includes `electron/coremanifest.dat` so the launcher can bootstrap and/or repair `userData/coremanifest_latest.dat` on fresh installs (especially important on Windows portable, where console logs are not visible by default).
- **Bootstrap now creates `coremanifest_latest.dat`**: `manifest-resolver.bootstrapManifests()` now bootstraps both:
  - `coremanifest_latest.json` (from bundled `coremanifest.json`)
  - `coremanifest_latest.dat` (from bundled `coremanifest.dat`)
- **Refresh no longer “lies” on missing signed DAT**: The launcher refresh IPC path now checks that `coremanifest_latest.dat` exists after refresh and returns an error if it is still missing.

### Core manifest updater safety improvements

- **No downgrades during refresh**: The core manifest updater is hardened to **refuse downgrades** (e.g., if DNS points to a newer manifest than the on-chain pointer).
- **DNS “newer” must be proven**: When DNS claims a newer version, the updater only treats it as usable if it can **download + SHA-256 verify + Ed25519 verify** the corresponding `coremanifest.dat`. If that fails, it falls back to other viable sources (still without downgrading).
- **Consistency repair**: When `coremanifest_latest.dat` verifies but `coremanifest_latest.json` is missing/invalid/inconsistent, the updater repairs the JSON from the verified DAT payload.

### Launcher UX improvements

- **Launch button feedback**: Launch buttons now give immediate temporary feedback (button label switches to **Launching…** and a status message is shown) so users see responsiveness while RHPlay startup takes time on Windows.
- **Visible active core manifest identity**: Launcher UI now shows the **active core manifest** `version_string` / `versionid` and **`lastupdated`** (Unix + local time) above the RHPlay manifest-entry version line, so it’s obvious which core manifest is in effect.

### Windows portable debugging

- **Opt-in backend log file**: The launcher supports file logging for main-process output in environments without an attached console:
  - set `RH_LAUNCHER_LOG=1` (writes to `userData/launcher-backend.log`), or
  - pass `--log-file <path>` when launching the EXE.

---

## Manifest payload updates

- Updated bundled `electron/coremanifest.json` / `electron/coremanifest.dat` and `electron/dbmanifest.json` as part of the release cycle.
- Change to avoid embedding large screenshots/resources in launcher-related contexts (per commit history).

---

## Reference

- Prior release note: [`RELEASE_0.1.29beta_20260329.md`](RELEASE_0.1.29beta_20260329.md)
- Rolling changelog: [`CHANGELOG.md`](CHANGELOG.md)

