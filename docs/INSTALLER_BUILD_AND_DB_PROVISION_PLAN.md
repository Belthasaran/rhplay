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
   - Default action is “skip” when file already present; user may opt into overwrite.
2. **Working directory selection**
   - Prompt when any database requires provisioning/overwrite.
   - Default to per-OS working directory table above; allow override.
   - Copy `electron/dbmanifest.json` into the working directory for transparency.
3. **Artifact sourcing**
   - Required files:
     - Base archive (`tar.xz`) per database (`manifest.<db>.base`).
     - SQL patch archives (`manifest.<db>.sqlpatches[]`).
   - Manual option: present ArDrive link for self-download; verify by filename and SHA-256.
   - Automated flow (`prepare_databases.js --provision`) attempts:
     1. IPFS retrieval using `ipfs_cidv1` (via multiple gateways with raw-leaf CIDv1 handling).
     2. Fallback HTTP download from Arweave/ArDrive (`data_txid` or `ardrive_file_path`).
   - Every artifact is written to the working directory and verified against SHA-256.
4. **Assembly**
   - Decompress `.tar.xz` to `.tar`, extract requested file (`extract_file`) into staging, verify hash.
   - Iterate patches in lexicographic order; decompress `.sql.xz`, run SQL statements against staging database (transaction-wrapped), delete temporary SQL.
   - Copy finished database to settings directory; keep archives for reuse.
5. **Embedded databases**
   - `clientdata.db` seed bundled under `extraResources` (`db/clientdata.db.initial.xz`), decompressed, and copied automatically.
6. **Post-provision tasks**
   - Copy portable runtime to install location (`%LOCALAPPDATA%\Programs\RHTools`, `/Applications/RHTools.app`, `/opt/RHTools`, or user-selected path).
   - Create version-agnostic launcher and platform-appropriate shortcuts/menu entries.

### Build Pipeline Changes
1. **Shared tooling**
   - `electron/installer/prepare_databases.js` now supports both planning and full provisioning (`--provision`).
   - Script leverages IPFS > ArDrive download order, `tar` + `lzma-native` for extraction, and `better-sqlite3` for patch execution.
2. **Installer packaging**
   - Added `electron-builder` installer targets:
     - Windows: `portable` (existing) + `nsis` (`npm run build:installer:win`).
     - Linux: `AppImage` (existing) + `deb` (`npm run build:installer:linux`).
     - macOS: `zip` (existing) + `dmg` (`npm run build:installer:mac`).
   - Manifest + embedded seeds shipped via `extraResources/db/`.
3. **Testing**
   - Add automated smoke tests invoking `prepare_databases.js --ensure-dirs --provision --write-plan` against temporary directories.
   - Validate hash comparisons and patch sequencing; ensure offline-friendly failure messaging.

### Windows Installer Interaction
- Custom NSIS page (before Finish) runs the provisioning script in “plan” mode (`--ensure-dirs --write-plan --write-summary`) after files are copied.
- The page displays a detailed summary, highlights which databases need work, and links directly to the ArDrive folder for manual downloads.
- Users can trigger “Re-scan” to regenerate the plan after placing files manually.
- Proceeding past the page prompts for confirmation and, if approved, runs `--provision`. Failures keep the user on the page with clear guidance; success requires all remaining actions to resolve before finishing.
- Install flow is strictly per-user (`allowElevation: false`, no “all users” option).
- Text/JSON summaries are written to `%TEMP%\rhtools-plan.{txt,json}` for diagnostics.

### Next Steps
1. Expand automated testing to cover interactive installer flows (plan, rescan, provision success/failure).
2. Finalize downloader + patch applier implementations with retry/backoff, streaming decompression, and hash verification.
3. Integrate per-OS installer builders, wiring UI to the provisioning module.
4. Author end-user docs describing installer choices, manual download option, and recovery steps.

