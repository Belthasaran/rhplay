## Installer Build & Database Provision Plan

### Objectives
- Keep existing portable artifacts (AppImage, Windows portable EXE, macOS ZIP) untouched.
- Add per-platform graphical installers that provision required databases (`rhdata.db`, `patchbin.db`, `clientdata.db`) automatically using `electron/dbmanifest.json`.
- Reuse project distribution assets (ArDrive drive [SMWRH](https://app.ardrive.io/#/drives/58677413-8a0c-4982-944d-4a1b40454039?name=SMWRH)) and provide fallback guidance when automatic download fails.

### Current Packaging Baseline
- `electron-builder` configuration in `package.json` already emits:
  - Linux AppImage (`npm run build:linux`)
  - Windows portable EXE (`npm run build:win`)
  - macOS ZIP (`npm run build:mac`)
- Portable outputs remain first-class deliverables; installer is an additional artifact generated from the same build pipeline.

### OS-Specific Paths
| Platform | Default settings directory (`userData`) | Default installer working directory |
|----------|-----------------------------------------|-------------------------------------|
| Windows  | `%APPDATA%/RHTools`                     | `%LOCALAPPDATA%/RHTools/InstallerTemp` |
| macOS    | `~/Library/Application Support/RHTools` | `~/Library/Application Support/RHTools/InstallerTemp` |
| Linux    | `$XDG_CONFIG_HOME/RHTools` or `~/.config/RHTools` | `$XDG_DATA_HOME/rhtools-installer` or `~/.local/share/rhtools-installer` |

Installers must create the settings directory when missing, but never overwrite existing databases unless the user opts in.

### Database Provision Workflow
1. **Pre-flight summary**
   - Enumerate `clientdata.db`, `rhdata.db`, `patchbin.db`.
   - Present current status (exists, size, SHA-256) with default action “skip” when file already present.
2. **Working directory selection**
   - Prompt when any database requires provisioning/overwrite.
   - Default to per-OS working directory table above; allow override.
   - Copy `electron/dbmanifest.json` into the working directory for transparency.
3. **Artifact sourcing**
   - Required files:
     - Base archive (`tar.xz`) per database (`manifest.<db>.base`).
     - SQL patch archives (`manifest.<db>.sqlpatches[]`).
   - Give users the option to download manually (link to ArDrive folder); validate presence by filename + SHA-256.
   - Automated flow attempts:
     1. IPFS retrieval using `ipfs_cidv1` (CIDv1 hashes computed with raw leaves).
     2. Fallback ArDrive download via anonymous client.
     3. Persist each downloaded file in working directory and verify SHA-256.
4. **Assembly**
   - Extract base archive to temporary file, ensure hash matches manifest `sha256`.
   - Stream patches in manifest order:
     - Decompress `.sql.xz` into temp SQL file.
     - Apply patch (direct SQLite execution).
     - Delete temp SQL after successful application.
   - On completion, rename temp database to canonical name and move into settings directory.
   - Leave downloaded archives intact for possible re-run.
5. **Embedded databases**
   - `clientdata.db` seed copied from repository assets packaged inside installer (no download required).
6. **Post-provision tasks**
   - Copy portable runtime to install location (`%LOCALAPPDATA%\Programs\RHTools`, `/Applications/RHTools.app`, `/opt/RHTools` or user specified).
   - Create launcher with version-agnostic name.
   - Register shortcuts/menu entries per platform.

### Build Pipeline Changes
1. **Shared tooling**
   - New Node utilities under `electron/installer/` for:
     - Path detection and provisioning (`prepare_databases.js` – see companion script).
     - Manifest-driven download/apply operations (future modules).
2. **Installer packaging**
   - Extend build scripts to invoke installer-specific packagers after `npm run renderer:build`.
   - Candidate frameworks:
     - Windows: NSIS/MSIX via `electron-builder` `nsis` target.
     - macOS: `dmg` with custom `beforePack` hook or `.pkg`.
     - Linux: `.deb` or graphical AppImage installer wrapper.
   - Provide consistent CLI: `npm run build:installer:win`, `:mac`, `:linux`.
3. **Testing**
   - Add automated smoke tests for database provisioning (assemble into temp dir, verify final SHA-256).
   - Ensure ArDrive/IPFS fallback gracefully skips in offline CI.

### Next Steps
1. Implement shared provisioning module (`prepare_databases.js` scaffolded) to drive both installer UIs and CLI testing.
2. Finalize downloader + patch applier implementations with retry/backoff, streaming decompression, and hash verification.
3. Integrate per-OS installer builders, wiring UI to the provisioning module.
4. Author end-user docs describing installer choices, manual download option, and recovery steps.

