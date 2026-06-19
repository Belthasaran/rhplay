# Programs and Utilities

This document lists all interactive programs and utilities in the rhtools project that can be invoked as scripts.

---

## Main Programs

### Electron App (electron/)
**Purpose**: Multi-platform desktop GUI for browsing games, rating, and planning challenge runs

**Usage**:
```bash
# Development mode
cd electron
./smart-start.sh

# Or manually
cd electron/renderer && npm run dev &
cd /home/main/proj/rhtools && npx electron electron/main.js
```

**Features**:
- Load Manual: add games from local BPS/ZIP/7z/RHPAK or URL, with BPS picker and metadata pre-population from JSON
- Browse 3,168+ SMW ROM hacks from database
- Triple rating system (Difficulty, Review, Skill Level)
- Version management with version-specific annotations
- Challenge run planning and execution
- Settings persistence (ROMs, tools, launch config)

**Key Files**:
- `electron/main.js` - Main Electron process
- `electron/renderer/src/App.vue` - Vue.js UI (1900+ lines)
- `electron/database-manager.js` - Database connections
- `electron/ipc-handlers.js` - IPC request handlers

**Documentation**:
- `docs/ELECTRON_APP_MASTER_REFERENCE.md` - **Complete technical reference (850+ lines)**
- `docs/RUN_EXECUTION_IMPLEMENTATION.md` - Run execution system (Start, Cancel, Next, Skip)
- `docs/ELECTRON_APP_QUICK_START.md` - User guide
- `docs/ELECTRON_DATABASE_INTEGRATION_PLAN.md` - Integration architecture
- `docs/ELECTRON_IPC_ARCHITECTURE.md` - IPC specifications
- `docs/ENHANCED_RATINGS_AND_RUN_SYSTEM.md` - Rating + run system
- `docs/CLIENTDATA_USER_ANNOTATIONS.md` - User annotation guide
- `devdocs/SOFTWARE_UPDATE_SYSTEM.md` - Software update system documentation

### RHTools Launcher (`rhtools-launcher/`)

**Purpose**: Optional separate Electron app to download RHPlay into the program data `releases/` folder, run database provisioning/updates in-process (no `prepare_databases` subprocess), and launch verified binaries (SHA256 must match the manifest entry or `launcher_allowlist`).

**Development** (from repo root; clears `ELECTRON_RUN_AS_NODE` so `require('electron')` resolves to the real API):

```bash
npm run launcher:renderer:build   # first time / after UI changes
npm run launcher:dev              # Vite URL on 5174 + launcher main
# or
./rhtools-launcher/smart-start.sh
```

**Production builds** (outputs under `dist-builds-launcher/`): installs `rhtools-launcher` production deps, `launcher:install-app-deps`, `launcher:prune-for-pack`, then packages.

```bash
npm run build:launcher:win
npm run build:launcher:linux
```

Helper scripts (also invoked by the build lines above): `launcher:install-app-deps` (uses repo `scripts/launcher-install-app-deps.cjs` so Windows `cmd.exe` does not break on `../node_modules/.bin/...`), `launcher:prune-for-pack`.

**Documentation**: `docs/RHTOOLS_LAUNCHER.md`

---

### gameversions27zfolder.js
**Purpose**: Backfill SMWC catalog tree and `smwchack_(GAMEID).7z` archives for games already in `gameversions`

**Usage**:
```bash
enode.sh gameversions27zfolder.js --target-7zfolder=~/proj/example \
  --sourcezips-folder=~/proj/zips --gameids=all
```

**Key Options**:
- `--target-7zfolder=<path>` - Catalog output root (required)
- `--sourcezips-folder=<path>` - Recursive local ZIP search root (required)
- `--gameids=all|<ids>` - Latest row per gameid (required)
- `--rhdata-db=<path>` - Override rhdata.db (default: `electron/rhdata.db`, env `RHDATA_DB_PATH`)
- `--skip-existing` - Skip when `games/{id}.json` and `smwchack_{id}.7z` exist
- `--no-download` - Do not download missing ZIPs
- `--skip-catalog-images` / `--skip-catalog-7z` - Same as updategames catalog flags

**Documentation**: See `docs/UPDATEGAMES_QUICK_START.md` (catalog export section)

---

### updategames.js
**Purpose**: Main script to update game database from SMWC

**Usage**:
```bash
node updategames.js [options]
```

**Key Options**:
- `--target-7zfolder=<path>` - SMWC catalog export root (default: `$HOME/proj/smwcgamesYYYYMMDD`)
- `--skip-catalog-images` - Skip screenshot downloads for catalog export
- `--skip-catalog-7z` - Skip building `smwchack_(GAMEID).7z` archives
- `--continue-on-catalog-errors` - Commit DB/folder export even if catalog step fails
- `--game-ids=<ids>` - Process specific game IDs only
- `--all-patches` - Process all patches, not just primary
- `--dry-run` - Preview changes without modifying database
- `--resume` - Resume from interrupted run
- `--use-js-blobs` - Use JavaScript blob creator (default: Python)

**Documentation**: See `docs/UPDATEGAMES_*.md` files

---

## Blob Management

### list-unuploaded-blobs.js
**Purpose**: List blob files that haven't been uploaded to cloud providers

**Usage**:
```bash
node list-unuploaded-blobs.js [options]
```

**Key Options**:
- `--provider=<name>` - Check provider (ipfs, arweave, ardrive, all)
- `--create-archive` - Create ZIP of unuploaded files
- `--scan-ipfs` - Check IPFS gateway availability
- `--scan-ardrive=<folder>` - Scan ArDrive folder
- `--output=<file>` - Save list to file

**Examples**:
```bash
# List unuploaded to Arweave
node list-unuploaded-blobs.js

# Create archive for IPFS upload
node list-unuploaded-blobs.js --provider=ipfs --create-archive

# Check IPFS and list missing
node list-unuploaded-blobs.js --provider=ipfs --scan-ipfs --verbose
```

**Documentation**: Auto-creates `upload_status` table in `patchbin.db`

---

### mark-upload-done.js
**Purpose**: Mark blob files as uploaded to a provider

**Usage**:
```bash
node mark-upload-done.js --provider=<name> [files...]
node mark-upload-done.js --provider=<name> --file=<list.txt>
cat files.txt | node mark-upload-done.js --provider=<name> --stdin
```

**Key Options**:
- `--provider=<name>` - Provider name (required)
- `--file=<path>` - Read file names from file
- `--stdin` - Read from stdin
- `--txid=<id>` - Arweave transaction ID
- `--cid=<cid>` - IPFS CID
- `--dry-run` - Preview without updating

**Examples**:
```bash
# Mark specific files
node mark-upload-done.js --provider=ipfs pblob_123.bin pblob_456.bin

# Mark from list
node mark-upload-done.js --provider=arweave --file=uploaded.txt

# Mark from stdin
cat uploaded.txt | node mark-upload-done.js --provider=ipfs --stdin

# With metadata
node mark-upload-done.js --provider=arweave --txid=abc123 pblob_123.bin
```

**Documentation**: Updates `upload_status` table in `patchbin.db`

---

### reprocess-attachments.js
**Purpose**: Reprocess attachments for existing game versions

**Usage**:
```bash
node reprocess-attachments.js --game-ids=<ids> [options]
```

**Key Options**:
- `--game-ids=<ids>` - Game IDs to reprocess (required)
- `--all-patches` - Process all patches
- `--dry-run` - Preview without changes

**Use Case**: Fix attachments with missing decoded fields without deleting gameversions

**Documentation**: See `docs/UPDATEGAMES_DECODER_001.md`

---

## Verification Tools

### verify-all-blobs.js
**Purpose**: Verify blob integrity (JavaScript version)

**Usage**:
```bash
node verify-all-blobs.js [options]
```

**Key Options**:
- `--verify-blobs=<source>` - Source: 'db' or 'files'
- `--gameid=<id>` - Verify specific game
- `--file-name=<name>` - Verify specific blob
- `--full-check` - Test with flips
- `--verify-result` - Verify result hash
- `--newer-than=<value>` - Only verify recent blobs
- `--log-file=<path>` - Log results

**Examples**:
```bash
# Basic verification
node verify-all-blobs.js

# Full check with result verification
node verify-all-blobs.js --full-check --verify-result

# Verify recent blobs only
node verify-all-blobs.js --newer-than="2025-10-12"

# Verify from database
node verify-all-blobs.js --verify-blobs=db
```

**Documentation**: See `docs/VERIFICATION_TOOLS.md`

---

### verify-all-blobs.py
**Purpose**: Verify blob integrity (Python version)

**Usage**:
```bash
python3 verify-all-blobs.py [options]
```

**Key Options**:
- `--dbtype=<type>` - Database: 'sqlite' or 'rhmd'
- `--verify-blobs=<source>` - Source: 'db' or 'files'
- `--gameid=<id>` - Verify specific game
- `--full-check` - Test with flips
- `--verify-result` - Verify result hash
- `--newer-than=<value>` - Only verify recent blobs

**Examples**:
```bash
# Verify SQLite database
python3 verify-all-blobs.py --dbtype=sqlite

# Verify RHMD file
python3 verify-all-blobs.py --dbtype=rhmd

# Full check with result verification
python3 verify-all-blobs.py --full-check --verify-result
```

**Documentation**: See `docs/VERIFICATION_TOOLS.md`

---

## Data Management

### loadsm.js
**Purpose**: JavaScript utility for loading hack data including blob decoding

**Usage**: Typically used as a library, but can be invoked directly

**Features**:
- Blob decoding (JavaScript and Python-created blobs)
- LZMA decompression
- Hash verification

**Documentation**: Compatible with both JavaScript and Python blob formats

---

### newgame.js
**Purpose**: Interactive assistant for preparing JSON skeletons and managing database records when onboarding a new game.

**Usage**:
```bash
# Launch the interactive wizard (creates or updates JSON skeleton)
enode.sh jstools/newgame.js ~/rhplay/work/newhack.json --create

# Validate skeleton and database availability
enode.sh jstools/newgame.js ~/rhplay/work/newhack.json --check

# Add or update records (gameversions, patchblobs, attachments)
enode.sh jstools/newgame.js ~/rhplay/work/newhack.json --add

# Remove records that were inserted from the skeleton
enode.sh jstools/newgame.js ~/rhplay/work/newhack.json --remove --force --purge-files

# Package prepared artifacts into a .rhpak bundle
enode.sh jstools/newgame.js ~/rhplay/work/newhack.json --package=newhack.rhpak

# Extract a package to a JSON skeleton and artifact folder
enode.sh jstools/newgame.js ~/rhplay/work/newhack.rhpak --extract-package --output-json=newhack-import.json

# Import a package directly into the databases (no files left behind)
enode.sh jstools/newgame.js ~/rhplay/work/newhack.rhpak --import

# Verify a prepared package without importing
enode.sh jstools/newgame.js ~/rhplay/work/newhack.rhpak --verify-package

# Uninstall a JSON skeleton or rhpak from the databases
enode.sh jstools/newgame.js ~/rhplay/work/newhack.json --uninstall
enode.sh jstools/newgame.js ~/rhplay/work/newhack.rhpak --uninstall
```

**Modes**:
- `--create` — wizard-style prompts for major fields; updates JSON defaults when re-run.
- `--prepare` — stages patch files, resources, and screenshots (encrypts/stores artifacts, populates metadata in `resources`/`screenshots` arrays). Must be executed before `--add`.
- `--check` — validates required fields, confirms patch file presence, inspects target databases.
- `--add` — verifies staged artifacts, ingests patch/resource/screenshot metadata into `rhdata.db`, `patchbin.db`, `resource.db`, and `screenshot.db`; refuses to run if `--prepare` has not been executed and only updates rows with matching `rhpakuuid`.
- `--remove` — legacy removal path that deletes records by game identifiers; requires `--force` and should be used with caution. Prefer `--uninstall`.
- `--uninstall` — removes all database rows associated with the skeleton or `.rhpak` by `rhpakuuid`, and optionally purges staged files when invoked against JSON.
- `--package=FILE` — produces a `.rhpak` archive with the skeleton JSON plus all staged artifacts, using paths relative to the JSON directory.
- `--extract-package` — expands a `.rhpak` package into a JSON skeleton and artifact files on disk so the contents can be reviewed or edited before adding.
- `--verify-package` — extracts a `.rhpak` (without importing), recalculates raw and encoded hashes for every artifact, and reports any mismatches.
- `--import` — imports a `.rhpak` package directly into the databases after verifying hashes; any temporary files are cleaned up automatically.

**Options**:
- `--rhdatadb=<path>`, `--patchbindb=<path>` — override database locations (also via `RHDATA_DB_PATH`, `PATCHBIN_DB_PATH`).
- `--resourcedb=<path>`, `--screenshotdb=<path>` — override resource/screenshot staging databases (defaults to `electron/resource.db` and `electron/screenshot.db`).
- `--output-json=<path>` — destination for `--extract-package` skeleton output (defaults to `<package-name>.json` in the current directory).
- `--force` — required only with `--remove` to acknowledge the legacy workflow.
- `--purge-files` — delete staged patch/blob files while removing or uninstalling from a JSON skeleton.

**Notes**:
- Skeleton JSON keeps UUIDs and generated hashes so repeated runs stay idempotent.
- `--prepare` assigns persistent `metadata.rhpakuuid` and human-readable `metadata.rhpakname` values so packages can be tracked across systems; these are honored by `--add`, `--uninstall`, and `--package`.
- `--prepare` encrypts staged resources/screenshots with Fernet, writes reusable tokens alongside the JSON (relative paths), and deduplicates by file hash (resources) or hash/URL (screenshots).
- `resource.db` gains a `res_attachments` table paralleling `patchbin.attachments`; `screenshot.db` gains `res_screenshots` with partial uniqueness (URL or SHA-256) to deter duplicates while allowing URL-only entries.
- Successful adds register the `rhpakuuid` and package name in the new `rhpakages` table so installed bundles can be audited and uninstalled later.
- `--import` performs its work in a temporary directory, validating artifacts and writing directly to the databases without leaving extracted files behind on disk.
- Patch and resource metadata rely on SHA-1/224/256, CRC16/CRC32, and IPFS CID generation identical to existing blob tooling.

---

### backfill_rhmd.js
**Purpose**: Export data from SQLite database to Python RHMD file format

**Usage**:
```bash
node backfill_rhmd.js
```

**Use Case**: Maintain compatibility with Python scripts by exporting to RHMD format

**Documentation**: See `docs/PYTHON_COMPATIBILITY_GUIDE.md`

---

### readd_diffs.js
**Purpose**: Generate batched SQL UPDATE scripts that restore `attachments.file_data` blobs in stripped `patchbin.db` copies.

**Usage**:
```bash
enode.sh electron/db_temp/readd_diffs.js <original.db> <target.db> \
  --output-dir=/path/to/output \
  --output-prefix=patchXX \
  --batchsize=300MB
```

**Key Options**:
- `--output-dir` - Directory that will receive the SQL batches.
- `--output-prefix` - Filename prefix for generated batches (default: `patchset`).
- `--batchsize` - Target maximum file size per batch (megabytes).
- `--original`, `--target` - Explicit database paths (fallback to positional args or environment variables).
- `--help` - Show usage details.

**Environment Overrides**:
- `PATCHBIN_DB_PATH` - Supplies default original database path.
- `PATCHBIN_TARGET_DB_PATH` - Supplies default target database path.

**Output**: One or more `.sql` files containing `UPDATE attachments SET file_data = ...` statements wrapped in transactions, sized to stay within the requested batch threshold.

---

### update_dbmanifest.js
**Purpose**: Maintain `dbmanifest.json` entries for patchbin distributions by adding SQL patch metadata and syncing ArDrive upload details.

**Usage**:
```bash
enode.sh electron/db_temp/update_dbmanifest.js electron/db_temp/dbmanifest.json \
  --target patchbin.db \
  --add-sqlpatches readd_output/*.sql.xz

enode.sh electron/db_temp/update_dbmanifest.js electron/db_temp/dbmanifest.json \
  --target patchbin.db \
  --update-from-ardrive
```

**Key Options**:
- `--target <dbfile>` - Manifest entry to update (defaults to `PATCHBIN_DB_PATH` basename or `patchbin.db`).
- `--add-sqlpatches <files...>` - Append/update compressed SQL patch metadata (size, SHA-256, IPFS CIDv1).
- `--update-from-ardrive` - Populate missing ArDrive identifiers from drive `58677413-8a0c-4982-944d-4a1b40454039`, folder `1e42b095-4fbf-4411-bcc9-688917d5a5af`.
- `--patchbin-db <path>` - Optional explicit database path for validation.
- `--help` - Show usage details.

**Environment Overrides**:
- `PATCHBIN_DB_PATH` - Supplies default database path and target name when `--target` is omitted.

**Output**:
- Ensures `sqlpatches` array entries have `file_name`, `format`, `type`, `sha256`, `ipfs_cidv1`, and `size`.
- Optionally fills in ArDrive metadata fields (`ardrive_file_name`, `ardrive_file_id`, `ardrive_file_path`, `data_txid`, `metadata_txid`, `ardrive_drive_id`, `ardrive_folder_id`) when files are located on ArDrive.

---

### update_coremf.js
**Purpose**: Update coremanifest.json targets (MANIFEST_PKG, win64/portable, linux64/AppImage) with new file metadata

**Usage**:
```bash
enode.sh update_coremf.js <coremanifest.json> --target <key> [options]
```

**Options**:
- `--target <key>` - Target entry (e.g., `beta/MANIFEST_PKG`, `beta/RHPLAY/win64/portable`)
- `--zipfile <path>` - (MANIFEST_PKG) Path to ZIP file
- `--exe <path>` - (Software) Path to executable file
- `--file <path>` - (Software) Path to file (alternative to --exe)
- `--sha256 <hex>` - SHA256 hash (compute if omitted)
- `--size <bytes>` - File size in bytes (compute if omitted)
- `--ipfs-cid <cid>` - IPFS CIDv1 (compute if omitted)
- `--url <url>`, `--baddr <base64>`, ArDrive options - Download source metadata
- `--bump-lastupdated` - Update lastupdated to current time
- `--bump-versionid` - Increment versionid

**Examples**:
```bash
# Update MANIFEST_PKG with new ZIP
enode.sh update_coremf.js electron/coremanifest.json --target beta/MANIFEST_PKG --zipfile manifest.zip

# Update Windows portable executable
enode.sh update_coremf.js electron/coremanifest.json --target beta/RHPLAY/win64/portable --exe RHTools.exe --bump-lastupdated
```

**See Also**: `docs/ONCHAIN_POINTER_DISCUSSION.md`, `docs/PointerRegistry.sol`

---

### create_coremf_dat.js
**Purpose**: Create coremanifest.dat binary file from coremanifest.json with LZMA compression, SHA512 digest, and Ed25519 signature

**Usage**:
```bash
enode.sh create_coremf_dat.js --coremanifest <path> --key <pem_path> [--output <path>] [--passphrase-env VAR]
```

**Options**:
- `--coremanifest <path>` - Path to coremanifest.json
- `--key <pem_path>` - Path to PEM-encoded AES-256-encrypted Ed25519 private key
- `--output <path>` - Output path for coremanifest.dat (default: same dir as input)
- `--passphrase-env VAR` - Environment variable name containing passphrase

**Example**:
```bash
enode.sh create_coremf_dat.js --coremanifest electron/coremanifest.json --key keys/coremanifest_key.pem --passphrase-env COREMF_KEY_PASSPHRASE
```

**Format**: Binary file with [8-byte lastupdated][8-byte versionid][4-byte compressed_size][LZMA(JSON)][64-byte SHA512][64-byte Ed25519 signature of SHA512]

**See Also**: `verify_coremf_dat.js`, `docs/ONCHAIN_POINTER_DISCUSSION.md`

---

### verify_coremf_dat.js
**Purpose**: Verify coremanifest.dat binary file integrity (SHA512 and Ed25519 signature), optionally extract JSON

**Usage**:
```bash
enode.sh verify_coremf_dat.js --input <path> [--extract <path>] [--verify-only]
```

**Options**:
- `--input <path>` - Path to coremanifest.dat
- `--extract <path>` - Optional: Extract decompressed JSON to this path
- `--verify-only` - Only verify, do not extract

**Example**:
```bash
enode.sh verify_coremf_dat.js --input coremanifest.dat --extract coremanifest_verified.json
```

**See Also**: `create_coremf_dat.js`, `docs/ONCHAIN_POINTER_DISCUSSION.md`

---

### update_bpsarchives.js
**Purpose**: Manage `bpsarchives.json` manifest for catalog and BPS archive downloads

**Usage**:
```bash
enode.sh update_bpsarchives.js <manifest.json> [options]
```

**Options**:
- `--target <name>` - Manifest entry to update (e.g., `bps_00.7z`, `rhsearch_cat.db`)
- `--add-archive <file>` - Add a BPS archive 7z file to the manifest
- `--calculate-ipfs` - Calculate IPFS CIDv1 for entries missing it
- `--update-from-ardrive` - Populate missing ArDrive metadata from the configured folder
- `--ardrive-drive-id <id>` - ArDrive drive ID (default: `d3338fab-d24c-4d75-9e78-d3024befc225`)
- `--ardrive-folder-id <id>` - ArDrive folder ID (default: `a6130936-d92e-45ac-a004-273d96e9ec9d`)
- `--help` - Show help message

**What it does**:
- Calculates SHA256 hash of archive files
- Calculates IPFS CIDv1 hashes (using `ipfs-only-hash`)
- Fetches ArDrive metadata from public folder
- Updates or creates manifest entries

**Examples**:
```bash
# Add a new BPS archive to manifest
enode.sh update_bpsarchives.js electron/bpsarchives.json \
  --target bps_00.7z --add-archive bps_00.7z

# Calculate IPFS CIDs for all entries
enode.sh update_bpsarchives.js electron/bpsarchives.json \
  --target bps_00.7z --calculate-ipfs

# Update ArDrive metadata
enode.sh update_bpsarchives.js electron/bpsarchives.json \
  --target bps_00.7z --update-from-ardrive
```

**Documentation**: See `docs/CATALOG_DOWNLOAD_SYSTEM.md` for complete documentation

---

### arjson2tree.js
**Purpose**: Parse JSON input containing ArDrive file metadata and generate an HTML index file with a table displaying file information in a tree-like structure.

**Usage**:
```bash
./enode.sh jsutils/arjson2tree.js < input.json > index.html
./enode.sh jsutils/arjson2tree.js --input=input.json --output=index.html
./enode.sh jsutils/arjson2tree.js --ltrim=2 < input.json > index.html
```

**Key Options**:
- `--input=PATH` - Path to input JSON file (default: read from stdin).
- `--output=PATH` - Path to output HTML file (default: write to stdout).
- `--ltrim=N` - Number of path components to remove from links (default: 2).
- `--help` - Show usage details.

**Features**:
- Generates HTML table with columns: Name, Size, LastModified, DataContentType, Path, entityType, entityId, parentFolderId.
- Clickable Name and Path columns with relative HTTP links (first N path components removed).
- Expandable rows showing txIdPath and entityIdPath on click.
- Dark theme styling matching project aesthetic.
- Inline CSS (no external dependencies).

**Output**: HTML file with styled table and interactive row expansion.

---

### process_arcsfc.js
**Purpose**: Process SNES ROM files, standardize headers, and create BPS patches

**Usage**:
```bash
node process_arcsfc.js <sfcsource_filename> [sfcarchive_filename]
node process_arcsfc.js --help
```

**Arguments**:
- `sfcsource_filename` (required): Path to the source .sfc ROM file
- `sfcarchive_filename` (optional): Path to the .7z archive file

**What it does**:
- Detects whether ROM is headered or unheadered
- Standardizes ROM headers using snesheader.exe via Wine
- Creates standardized versions (both headered and unheadered)
- Calculates SHA1 and SHA256 hashes for all ROM variants
- Generates BPS patches against `/home/me/smwdb/smw.sfc`
- Extracts metadata from filenames (title, author, version, date, language, etc.)
- Verifies archive contents if archive is provided
- Organizes processed files into `done/`, `output/`, and `error/` directories

**Requirements**:
- Linux platform
- Wine installed
- `K:\snesheader.exe` available via wine
- `flips` utility in PATH
- `7z` utility in PATH
- Must be run from a subdirectory of `/home/me/smwdb/`
- **`os-lock`** — optional npm dependency at repo root (`optionalDependencies`); installs on Linux for file locking. Omitted on Windows when the native build fails so `npm install` still succeeds; this script is Linux-only.

**Output Files**:
- `output/<sha1_hash>.bps` - BPS patch file
- `output/<sha1_hash>.json` - Metadata JSON with extracted information
- `output/log.txt` - Operation log

**Documentation**: See `docs/PROCESS_ARCSFC.md` for complete documentation

**Examples**:
```bash
# Process a ROM file with an archive
node process_arcsfc.js example.sfc example.7z

# Process a ROM file without an archive
node process_arcsfc.js game.sfc
```

---

### process_arcsfc_runner.js
**Purpose**: Batch runner that scans for matching .sfc/.7z file pairs and processes them sequentially

**Usage**:
```bash
node process_arcsfc_runner.js
node process_arcsfc_runner.js --help
```

**What it does**:
- Scans the current working directory for .sfc files
- For each .sfc file, looks for a matching .7z archive (same base name, different extension)
- Runs `process_arcsfc.js` for each matching pair sequentially
- Captures all stdout and stderr from each run
- Appends all output to `output/log2.txt` with timestamps
- Processes files one at a time to avoid conflicts

**Features**:
- Handles special characters in filenames correctly (no shell expansion)
- Sequential processing to avoid file lock conflicts
- Comprehensive logging of all operations
- Summary report at the end

**Output**:
- All processing results appended to `output/log2.txt`
- Each run includes command, exit code, stdout, and stderr
- Summary statistics at the end

**Examples**:
```bash
# Run from a directory containing .sfc and .7z files
cd /path/to/roms
node ~/rhplay/jstools/process_arcsfc_runner.js
```

**Note**: This script is designed to work with `process_arcsfc.js` and must be run from a directory where both .sfc and .7z files are present.

---

### process_index7zs.js
**Purpose**: Index BPS files from 7z archives and consolidate JSON metadata from multiple sources

**Usage**:
```bash
enode.sh process_index7zs.js <JSON File Tree> <BPS Index Folder> <BPS Archives Folder> [options]
enode.sh process_index7zs.js --help
```

**Arguments**:
- `JSON File Tree` (required): Directory tree containing JSON metadata files
- `BPS Index Folder` (required): Directory where master JSON index files will be created/updated
- `BPS Archives Folder` (required): Directory containing 7z archives with BPS files

**Options**:
- `--checkrom`: Extract BPS files, apply to smw.sfc, verify SHA1, and get ROM size
- `--try-lmfilter`: If lmfilter is missing, attempt to generate it (requires --checkrom)
- `--try-levelread`: If levelread is missing, attempt to generate it (requires --checkrom)
- `--try-translevels`: If translevels is missing, attempt to generate it (requires --checkrom)
- `--update-ardrive`: Scan ArDrive and update metadata for 7z archives
- `--help, -h`: Show help message

**What it does**:
- Scans 7z archives in the BPS Archives Folder for BPS patch files
- Lists contents of each archive to find BPS files (named by SHA1 hash)
- Searches the JSON File Tree recursively for matching JSON files:
  * `<sha1>.json` (main metadata)
  * `<sha1>_levelread.json` (level names)
  * `<sha1>_lmfilter.json` (level filter list)
  * `<sha1>_translevel.json` (translevel data)
- Creates or updates master JSON files in BPS Index Folder
- Merges data from multiple source JSON files
- Handles duplicate JSON files by tracking SHA256 hashes
- Normalizes lmfilter data to 3-character level codes
- Tracks folder categories from all source locations

**Features**:
- Handles malformed JSON files (single-line files with trailing commas)
- Atomic file writes (writes to .temp file, then renames)
- Deep merging of JSON data (preserves existing fields)
- Duplicate detection using SHA256 hashes
- Optional ROM verification and metadata generation

**Requirements**:
- `7z` utility in PATH (for listing/extracting archives)
- `flips` utility in PATH (for --checkrom option)
- `/home/me/smwdb/smw.sfc` (for --checkrom option)
- Python scripts: `try_lmfilter.py`, `findtranslevels/find_translevels.py` (for --try-* options)
- `level_reader` binary (for --try-levelread option)
- `lmlevelinfo/level_info1` binary (optional; inspect LM level headers/object data and export MWL)
- `ipfs-only-hash` package (for IPFS CID calculation)
- `ardrive-core-js` and `arweave` packages (for --update-ardrive option)

**Output Files**:
- `<sha1>.json` - Master JSON index file in BPS Index Folder
- `temp/` - Temporary directory for extracted files (when using --checkrom)
- `temp/output/` - Generated JSON files for manual review (when using --try-* options)

**Examples**:
```bash
# Basic indexing (no ROM verification)
enode.sh process_index7zs.js ~/rhplay/refmaterial/arcsfc1 ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/

# With ROM verification and size calculation
enode.sh process_index7zs.js ~/rhplay/refmaterial/arcsfc1 ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/ --checkrom

# Generate missing metadata files
enode.sh process_index7zs.js ~/rhplay/refmaterial/arcsfc1 ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/ --checkrom --try-lmfilter --try-levelread --try-translevels

# Update ArDrive metadata for 7z archives
enode.sh process_index7zs.js ~/rhplay/refmaterial/arcsfc1 ~/rhplay/refmaterial/index7z ~/rhplay/refmaterial/bps7z/ --update-ardrive
```

**Documentation**: See `docs/PROCESS_INDEX7ZS_SPEC.md` for complete specification

---

## SMWC Waiting and Ad-Hoc Intake

### update_waiting_index.js
**Purpose**: Update waiting_index.csv for SMWC Waiting pipeline (append/update or full rebuild). Optionally updates waiting_index_ar.csv with data_txid from ArDrive waiting folder.

**Usage**:
```bash
enode.sh jstools/update_waiting_index.js [--full-rebuild] [--no-copy] [--no-ardrive]
```

**Options**: `--full-rebuild`, `--no-copy`, `--no-ardrive` (skip ArDrive stage), `--ardrive-drive-id`, `--ardrive-folder-id`, `--help`

**Default**: Non-destructively appends/updates entries from games/*.json; copies result to upload/ for distribution. Use `--full-rebuild` for full rewrite.

**Documentation**: See `docs/SMWC_WAITING_AUTOMATION.md`

---

### smwcw_waiting_build7z.js
**Purpose**: Build 7z waiting packages for SMWC Waiting games (port of enter.py). By default includes extras (text/README/images from `smwc_world/extras`) in each 7z.

**Usage**:
```bash
enode.sh jstools/smwcw_waiting_build7z.js <GAMEID>
enode.sh jstools/smwcw_waiting_build7z.js --all [--dry-run] [--no-extras]
```

**Options**: `--all`, `--dry-run`, `--no-extras`, `--help`

**Documentation**: See `docs/SMWC_WAITING_AUTOMATION.md`

---

### smwcw_waiting_periodic.js
**Purpose**: Periodic runner for SMWC Waiting pipeline (compare, fetch, build7z, update waiting_index.csv)

**Usage**:
```bash
enode.sh jstools/smwcw_waiting_periodic.js [--dry-run] [--skip-compare] [--skip-fetch] [--only-build-7z] [--max-games N]
```

**Options**: `--dry-run`, `--skip-compare`, `--skip-fetch`, `--only-build-7z`, `--max-games N`, `--help`

**Documentation**: See `docs/SMWC_WAITING_AUTOMATION.md`

---

### smwcw_waiting_upload.js
**Purpose**: Upload waiting 7z packages to IPFS and Pixeldrain

**Usage**:
```bash
enode.sh jstools/smwcw_waiting_upload.js [--dry-run] [--skip-ipfs] [--skip-pd]
```

**Environment**: `PIXELDRAIN_API_KEY` required for Pixeldrain upload

**Documentation**: See `docs/SMWC_WAITING_AUTOMATION.md`

---

### intake_bps_metadata.js
**Purpose**: Interactive BPS metadata enrichment for ad-hoc intake

**Usage**:
```bash
enode.sh jstools/intake_bps_metadata.js --input-dir <dir> [--interactive] [--batch] [--apply] [--dry-run]
```

**Options**: `--input-dir`, `--output-dir`, `--interactive`, `--batch`, `--apply`, `--csv`, `--dry-run`, `--help`

**Documentation**: See `docs/ADHOC_INTAKE.md`

---

### intake_adhoc.js
**Purpose**: Orchestrate ad-hoc catalog intake for contests and one-off hacks

**Usage**:
```bash
enode.sh jstools/intake_adhoc.js --input-dir <dir> --mode bps|zip|sfc [--metadata-script] [--dry-run]
```

**Options**: `--input-dir`, `--mode`, `--metadata-script`, `--dry-run`, `--help`

**Documentation**: See `docs/ADHOC_INTAKE.md`

---

### intake_pack_and_index.js
**Purpose**: Pack BPS into 7z and run process_index7zs + search_build. By default includes extras from `smwc_world/extras` (by BPS hash) in each 7z.

**Usage**:
```bash
enode.sh jstools/intake_pack_and_index.js --json-dir <dir> --bps-dir <dir> [options]
```

**Options**: `--json-dir`, `--bps-dir`, `--index7z`, `--bps7z`, `--batch-prefix`, `--max-per-7z`, `--max-size-mb`, `--dry-run`, `--skip-search`, `--no-extras`, `--extras-dir <dir>`, `--help`

**Documentation**: See `docs/ADHOC_INTAKE.md`

---

### promote_catalog_to_rhpak.js
**Purpose**: Promote search catalog item to RHPAK file

**Usage**:
```bash
enode.sh jstools/promote_catalog_to_rhpak.js --from-json <path> --bps-path <path> [--output <path>]
```

**Options**: `--from-json`, `--bps-path`, `--metadata-file`, `--add-screenshots`, `--output`, `--help`

**Documentation**: See `docs/PROMOTE_CATALOG.md`

---

### promote_catalog_to_db.js
**Purpose**: Promote search catalog item to main database (rhdata.db, etc.)

**Usage**:
```bash
enode.sh jstools/promote_catalog_to_db.js --from-json <path> --bps-path <path> [options]
```

**Options**: `--from-json`, `--bps-path`, `--metadata-file`, `--add-screenshots`, `--skip-rhpak`, `--skeleton`, `--help`

**Environment**: `RHDATA_DB_PATH`, `PATCHBIN_DB_PATH` for tests

**Documentation**: See `docs/PROMOTE_CATALOG.md`

---

### prepare_databases.js
**Purpose**: Produce a provisioning plan for installer builds by inspecting `dbmanifest.json`, evaluating existing databases in the user settings directory, and staging manifest resources.

**Usage**:
```bash
enode.sh electron/installer/prepare_databases.js \
  --ensure-dirs \
  --provision \
  --write-plan=/tmp/rhtools-plan.json \
  --overwrite rhdata.db,patchbin.db
```

**IPFS / Fetch Configuration**: Uses `user-fetch-settings.json` in user data directory (when present) for IPFS gateway and fetch mode. Environment variables override file: `IPFS_FETCH_MODE` (basic|helia), `IPFS_PARALLEL_FETCH` (0=sequential, N=concurrency), `IPFS_GATEWAY_SELECTION` (standard|replace|append|prepend), `IPFS_GATEWAY_LIST` (comma-separated or JSON array).

**Key Options**:
- `--manifest <path>` - Path to manifest (defaults to `electron/dbmanifest.json`).
- `--user-data-dir <path>` - Override detected settings directory.
- `--working-dir <path>` - Override temporary working directory.
- `--overwrite <csv>` - Force provisioning for listed databases.
- `--ensure-dirs` - Create settings + working directories and copy manifest + embedded seeds.
- `--provision` - Execute downloads, extraction, SQL patching, and final copy steps.
- `--write-plan <path>` - Persist JSON action plan.
- `--write-summary <path>` - Persist human-readable summary (used by installers for UI).
- `--help` - Show usage information.

**Output**: JSON summary describing directory paths, planned actions per database (`skip`, `copy-embedded`, `provision-from-manifest`), downloads required, and—when `--provision` is set—the execution results for each database (completed, skipped, errors).

---

## Utilities

### identify-incompatible-keys.js
**Purpose**: Audit database for incompatible encryption key formats

**Usage**:
```bash
node identify-incompatible-keys.js
```

**Use Case**: Find blobs with keys that need format conversion

**Documentation**: See `docs/UPDATEGAMES_DECODER_001.md`

---

## Python Utilities

### blob_crypto.py
**Purpose**: Standalone Python library for blob encryption/decryption

**Usage**:
```bash
# Encrypt
python3 blob_crypto.py encrypt <input_file> <output_file> <key>

# Decrypt
python3 blob_crypto.py decrypt <input_file> <key> <expected_hash> <output_file>

# Generate key
python3 blob_crypto.py generate-key
```

**Features**:
- PBKDF2HMAC key derivation
- Fernet encryption/decryption
- Auto-detection of blob formats
- Compatible with JavaScript-created blobs

**Documentation**: See `docs/PYTHON_COMPATIBILITY_GUIDE.md`

---

### create_blob_python.py
**Purpose**: Create blobs using Python (called by blob-creator.js)

**Usage**:
```bash
python3 create_blob_python.py <patch_file> <gameid> <blobs_dir> <pat_sha224> [result_file]
```

**Use Case**: Ensure universal compatibility by creating blobs in Python format

---

### loadsmwrh_compat.py
**Purpose**: Compatibility wrapper for loadsmwrh.py

**Use Case**: Allow Python scripts to work with JavaScript-created blobs

**Documentation**: See `docs/PYTHON_COMPATIBILITY_GUIDE.md`

---

## SMW ROM Analysis Tools

### smw_level_analyzer.py
**Purpose**: Extract and compare level data from Super Mario World ROM files

**Usage**:
```bash
# List all valid/modified levels in a ROM
./smw_level_analyzer.py --list <romfile.sfc> [--filter-vanilla]

# List levels with English names
./smw_level_analyzer.py --list <romfile.sfc> --filter-vanilla --show-names

# Compare two ROMs to find changed levels
./smw_level_analyzer.py --compare <rom1.sfc> <rom2.sfc>

# Extract detailed level information to JSON (includes names)
./smw_level_analyzer.py --extract <romfile.sfc> --output levels.json

# Use custom vanilla ROM for comparison
./smw_level_analyzer.py --list hack.sfc --vanilla custom_base.sfc --filter-vanilla
```

**Features**:
- Detects 512-byte copier headers automatically
- Reads Layer 1, Layer 2, and Sprite pointer tables
- Compares ROMs to find modified levels
- Exports level metadata (pointers, settings, vertical/horizontal mode)
- **Shows English level names** with `--show-names` flag
- Automatically includes level names in JSON export
- Supports custom vanilla ROM via `--vanilla` flag or `SMW_VANILLA_ROM` environment variable

**Output Formats**: Text list, JSON (with level names)

**Documentation**: `devdocs/SMW_ROM_STRUCTURE.md`, `devdocs/SMW_CHARACTER_ENCODING.md`

### level_fingerprint.js
**Purpose**: Dump Layer1 screen fingerprints (v1) from a ROM for JIT.Score originality corpus

**Usage**:
```bash
./enode.sh jstools/level_fingerprint.js --rom path/to.sfc [--gameid ID] [--out fingerprints.txt]
./enode.sh jstools/level_fingerprint.js --help
```

**Output**: TSV rows `gameid,levelid,screen,fingerprint` (gameid `0` = unknown)

**Documentation**: `devdocs/JIT_LEVELS1.md`

---

### smw_level_names.py
**Purpose**: Extract level names from Super Mario World ROM files

**Usage**:
```bash
# List all level names
./smw_level_names.py <romfile.sfc> --list

# Extract specific level name
./smw_level_names.py <romfile.sfc> --level 0x105

# Export all names to JSON
./smw_level_names.py <romfile.sfc> --export --output names.json

# Show raw tile hex values
./smw_level_names.py <romfile.sfc> --list --raw
```

**Features**:
- Extracts level names as they appear on overworld
- Handles chunk-based name assembly format
- Supports both hex and decimal level IDs
- Raw tile mode for debugging

**Note**: Level name decoding is approximate - actual text depends on loaded graphics

**Documentation**: `devdocs/SMW_ROM_STRUCTURE.md`

---

### smw_compare_names.py
**Purpose**: Compare level names between two SMW ROM files

**Usage**:
```bash
# Compare level names between two ROMs
./smw_compare_names.py <rom1.sfc> <rom2.sfc>

# Show unchanged names too
./smw_compare_names.py <rom1.sfc> <rom2.sfc> --show-unchanged

# Export to JSON
./smw_compare_names.py <rom1.sfc> <rom2.sfc> --output changes.json

# Show raw tile values
./smw_compare_names.py <rom1.sfc> <rom2.sfc> --raw
```

**Features**:
- Compares English level names between two ROM files
- Reports changed, added, and removed level names
- Shows which names are unique to each ROM
- Optional display of unchanged names
- JSON export for programmatic use

**Use Cases**:
- Track level name changes between ROM versions
- Verify overworld modifications
- Find renamed levels in ROM hacks

**Documentation**: `devdocs/SMW_CHARACTER_ENCODING.md`

---

### smw_empirical_analysis.py
**Purpose**: Empirical ROM analysis - verify offsets against actual ROM behavior

**Usage**:
```bash
# Verify documented offsets are correct
./smw_empirical_analysis.py --verify-offsets vanilla.sfc hack.sfc

# Find all changes between two ROMs
./smw_empirical_analysis.py --find-changes rom1.sfc rom2.sfc

# Scan a specific memory region
./smw_empirical_analysis.py --scan-region rom.sfc 0x2E000 256
```

**Features**:
- Empirical verification of ROM structure documentation
- Compares Layer 1, Layer 2, and Sprite pointer tables
- Scans for differences across all 512 level slots
- Hex dump of specific memory regions
- Ground truth analysis - what actually happens beats documentation

**Output**: Detailed comparison reports, optional JSON export

**Documentation**: `devdocs/SMW_ROM_STRUCTURE.md`

---

### smw_level_force.py
**Purpose**: Create ROMs that ALWAYS load a specific level (fixes asm1.py issues)

**Usage**:
```bash
# Force a specific level to always load
./smw_level_force.py <input.sfc> --level 0x105 --output forced.sfc

# Use aggressive patching mode
./smw_level_force.py <input.sfc> --level 261 --patch-type aggressive -o test.sfc

# Show the ASM patch before applying
./smw_level_force.py <input.sfc> --level 0x105 --show-patch
```

**Features**:
- Hooks ALL level entry points (initial, death, midway, retry, continue)
- Fixes asm1.py's death/respawn problem
- SA-1 ROM support
- Universal and aggressive patch modes
- Skips intro automatically
- Short timer for faster testing

**Use Cases**:
- Test specific levels in isolation
- Create level-specific challenge ROMs
- Debug individual levels without overworld interference

**Improvements over asm1.py**:
- ✓ Works on death/respawn (asm1.py didn't)
- ✓ Works on midway respawn (asm1.py didn't)
- ✓ Works with instant retry systems (asm1.py didn't)
- ✓ Simple CLI (asm1.py was complex)

**Documentation**: `devdocs/SMW_LEVEL_LOADING_ANALYSIS.md`, `devdocs/SMW_LEVEL_ID_CALCULATION.md`

---

### smw_batch_test_levels.py
**Purpose**: Create test ROMs for multiple levels at once

**Usage**:
```bash
# Auto-detect modified levels and create test ROM for each
./smw_batch_test_levels.py <input.sfc> --auto-detect --vanilla smw.sfc

# Limit to first 10 levels
./smw_batch_test_levels.py <input.sfc> --auto-detect --limit 10

# Use custom level list from JSON
./smw_batch_test_levels.py <input.sfc> --levels levels.json --output-dir my_tests/
```

**Features**:
- Auto-detect modified levels from vanilla comparison
- Batch create test ROMs
- Integrated with smw_level_analyzer.py
- Progress reporting

**Output**: Creates `test_level_XXX.sfc` for each level in output directory

**Documentation**: `FINAL_SUMMARY_SMW_LEVEL_FORCE.md`

---

### smw_headless_test.py
**Purpose**: Automated headless testing for SMW ROM patches with input simulation and RAM sampling

**Usage**:
```bash
# Test if level 0x106 loads correctly
./pytools/smw_headless_test.py rom.sfc --target-level 0x106

# With screenshots
./pytools/smw_headless_test.py rom.sfc --target-level 0x106 --screenshot-dir screenshots

# Save results to JSON
./pytools/smw_headless_test.py rom.sfc --target-level 0x106 --output results.json

# Use different emulator
./pytools/smw_headless_test.py rom.sfc --target-level 0x106 --emulator bizhawk
```

**Features**:
- Headless emulator execution (suitable for CI/CD)
- Automatic input simulation (Start button, menu navigation, level entry)
- RAM sampling at execution points (game mode, level IDs, submap, flags)
- Optional screenshot capture at key moments
- JSON results export for analysis
- Supports BizHawk (recommended), RetroArch, Mesen-S

**Use Cases**:
- Automated testing of ASM patches (e.g., `test5.asm`)
- Verify level override patches work correctly
- Regression testing across multiple level IDs
- CI/CD integration for patch validation

**Output**: JSON file with RAM samples, screenshots, test completion status

**Documentation**: `devdocs/SMW_HEADLESS_TESTING.md`

**See Also**: `luatools/smw_headless_test.lua` - Standalone Lua script for BizHawk

---

### smw_overworld_analyzer.py
**Purpose**: Analyze overworld starting positions and data

**Usage**:
```bash
# Read starting position
./smw_overworld_analyzer.py <rom.sfc> --read-start

# Show just Mario's data
./smw_overworld_analyzer.py <rom.sfc> --read-start --player mario

# Export to JSON
./smw_overworld_analyzer.py <rom.sfc> --read-start --output pos.json
```

**Features**:
- Reads initial overworld position data (offset 0x09EF0)
- Shows Mario and Luigi starting positions
- Parses submap, coordinates, animation state
- JSON export

**Documentation**: `devdocs/SMW_OVERWORLD_PROJECT_STATUS.md`

---

## USB2SNES Server Testing

### test_usbfxp_server.js
**Purpose**: Standalone test utility for the embedded USB2SNES/FXP server

**Usage**:
```bash
enode.sh test_usbfxp_server.js [options]
```

**Key Options**:
- `--port, -p <number>` - WebSocket port (default: 64213)
- `--dummy, -d` - Use dummy USB device for testing

---

### test_usbfxp_server_rust.js
**Purpose**: Standalone test utility for the embedded USB2SNES/FXP server using Rust native module

**Usage**:
```bash
enode.sh test_usbfxp_server_rust.js [options]
```

**Key Options**:
- `--start-server, -s` - Start the server within this script (for standalone testing)
- `--port, -p <number>` - WebSocket port when starting server (default: 64213)
- `--dummy, -d` - Use dummy USB device for testing
- `--verbose` - Show detailed logs
- `-i, --info` - Test Info command
- `-r, --reset` - Test Reset command
- `-b, --boot` - Test Boot command
- `-m, --menu` - Test Menu command
- `--putfile` - Test PutFile command
- `--list` - Test List command
- `--all` - Run all tests

**Examples**:
```bash
# Test Info command (server must be running separately)
enode.sh test_usbfxp_server_rust.js --info

# Start server and test Info command (standalone mode)
enode.sh test_usbfxp_server_rust.js --start-server --info --verbose

# Test Reset command with server auto-start
enode.sh test_usbfxp_server_rust.js --start-server --reset

# Run all tests with server auto-start and dummy device
enode.sh test_usbfxp_server_rust.js --start-server --dummy --all --verbose
```

**What it tests**:
- Server startup and initialization
- WebSocket connection to server
- Device attachment
- Info command (firmware version, ROM name)
- Reset command (SNES reset)
- Boot/Menu/List/PutFile commands
- Rust native module integration
- `--verbose, -v` - Enable verbose logging
- `--help, -h` - Show help message

**Examples**:
```bash
# Test with default settings
enode.sh test_usbfxp_server.js

# Test with dummy device
enode.sh test_usbfxp_server.js --dummy

# Test on different port with verbose logging
enode.sh test_usbfxp_server.js --port 8080 --verbose
```

**What it tests**:
- Server startup and initialization
- WebSocket connection to server
- DeviceList command
- Attach command
- Info command (device information)
- Server shutdown

**Exit Codes**:
- `0` - All tests passed
- `1` - Server failed to start
- `2` - Connection failed
- `3` - Test failures

**Use Case**: Quick testing of the USB2SNES/FXP server without launching the full Electron app

---

## Testing

### tests/test_blob_compatibility.js
**Purpose**: Test blob format compatibility

**Usage**:
```bash
node tests/test_blob_compatibility.js
# or
npm run test:blob-compat
```

**What it tests**:
- JavaScript blob creation
- Decoding by record-creator.js
- Decoding by loadsm.js
- Decoding by blob_crypto.py
- Key format compatibility
- Python-created blob compatibility

---

### tests/test_python_script_compat.js
**Purpose**: Test integration with Python scripts

**Usage**:
```bash
node tests/test_python_script_compat.js
# or
npm run test:python-compat
```

**What it tests**:
- blob_crypto.py decryption
- loadsmwrh_compat.py wrapper
- RHMD export
- Python decoding of exported metadata

---

## NPM Scripts

Convenient aliases for common operations:

```bash
# Testing
npm run test:blob-compat          # Blob compatibility tests
npm run test:python-compat         # Python script compatibility tests

# Verification
npm run verify:blobs               # Verify from files
npm run verify:blobs-db            # Verify from database
npm run verify:blobs-full          # Full check with flips
npm run verify:blobs-result        # Full check with result verification

# Utilities
npm run utils:identify-keys        # Identify incompatible keys
npm run utils:reprocess-attachments # Reprocess attachments
npm run utils:backfill-rhmd        # Backfill RHMD file
```

---

## Database Schema

### Migration Scripts

Located in `electron/sql/migrations/`:
- `001_add_fields_type_raw_difficulty.sql`
- `002_add_combinedtype.sql`
- `003_backfill_combinedtype.js`
- `004_add_local_resource_tracking.sql`

See `docs/DBMIGRATE.md` for detailed migration instructions.

---

## Documentation Reference

### Complete Documentation

**Electron App**:
- `docs/ELECTRON_APP_MASTER_REFERENCE.md` - **Complete technical reference (850+ lines)** - Covers gameversions table, run system, ratings, settings, UI, IPC, and everything needed for new developers/agents
- `docs/ELECTRON_APP_QUICK_START.md` - User guide
- `docs/ELECTRON_DATABASE_INTEGRATION_PLAN.md` - Integration architecture
- `docs/ELECTRON_IPC_ARCHITECTURE.md` - IPC specifications
- `docs/ENHANCED_RATINGS_AND_RUN_SYSTEM.md` - Rating + run system
- `docs/CLIENTDATA_USER_ANNOTATIONS.md` - User annotation guide

**Database & Schema**:
- `docs/SCHEMACHANGES.md` - Database schema changes log
- `docs/DBMIGRATE.md` - Migration commands
- `docs/GAMEVERSIONS_TABLE_SCHEMA.md` - gameversions table documentation

**Verification & Compatibility**:
- `docs/VERIFICATION_TOOLS.md` - Verification scripts guide
- `docs/UPDATEGAMES_DECODER_001.md` - Blob format troubleshooting
- `docs/PYTHON_COMPATIBILITY_GUIDE.md` - Python integration
- `docs/BLOB_COMPATIBILITY_SOLUTION.md` - Compatibility solution
- `docs/VERIFY_RESULT_FEATURE.md` - Result verification
- `docs/NEWER_THAN_FEATURE.md` - Incremental verification

**Search Catalog System**:
- `docs/SEARCH_CATALOG_SYSTEM.md` - Complete search catalog system documentation
- `docs/CATALOG_DOWNLOAD_SYSTEM.md` - Download manager and manifest system documentation

### Nostr Runtime Tools

### nostr-status.js
**Purpose**: Inspect the local Nostr Runtime Service health, relay cooldowns, and outgoing queue priorities from the command line.

**Usage**:
```bash
enode.sh cli/nostr-status.js [--details] [--json] [--limit <n>]
```

**Key Options**:
- `--details` - include queued event samples and extended metadata
- `--json` - emit the full status snapshot as formatted JSON
- `--limit <n>` - number of queued events to sample (default: 50)

**Output Highlights**:
- Current operating mode and runtime heartbeat
- Per-relay health with cooldown/backoff timers
- Outgoing queue counts with priority bucket summaries
- Optional pending-event listing with kind/table metadata

### Testing Documentation
- `tests/README_BLOB_TESTS.md` - Test suite documentation

---

## Adding New Programs

When creating new scripts:

1. **Make executable**: `chmod +x script.js`
2. **Add shebang**: `#!/usr/bin/env node` (for Node.js)
3. **Add --help option**: Provide usage information
4. **Document here**: Add to this file
5. **Add to package.json**: Create npm script if appropriate
6. **Write tests**: Add test cases in `tests/` directory

---

### search_build1.js
**Purpose**: Stage 1 of search catalog build - Ingest and normalize master JSON files

**Usage**:
```bash
enode.sh search_build1.js <index7z folder> <bps7z folder> [options]
```

**Options**:
- `--rhsearchdb=FILE` - Path to search catalog database (default: rhsearch_cat.db)
- `--rhsearchzip=FILE` - Path to JSON ZIP archive (default: rhsearch.zip)
- `--incremental <json-file>` - Incremental mode: add a single JSON file to existing catalog
- `--help, -h` - Show help message

**What it does**:
- Scans index7z folder recursively for master JSON files
- Normalizes and extracts standard fields (title, author, version, tags, etc.)
- Creates/updates SQLite database with items table
- Packages all JSON files into a ZIP archive with high compression

**Incremental Mode**:
- `--incremental <json-file>` - Add a single JSON file to existing catalog without full rebuild
- Much faster for adding individual items
- Updates both database and ZIP archive
- Requires existing catalog database to be present

**Incremental Mode**:
- `--incremental <json-file>` - Add a single JSON file to existing catalog without full rebuild
- Much faster for adding individual items
- Updates both database and ZIP archive

**Output**:
- `rhsearch_cat.db` - SQLite database with items table
- `rhsearch.zip` - ZIP archive containing all master JSON files

**Documentation**: See `docs/SEARCH_CATALOG_SYSTEM.md` for complete documentation

---

### search_build2.js
**Purpose**: Stage 2 of search catalog build - Entity resolution and grouping

**Usage**:
```bash
enode.sh search_build2.js <index7z folder> <bps7z folder> [options]
```

**Options**:
- `--rhsearchdb=FILE` - Path to search catalog database (default: rhsearch_cat.db)
- `--rhsearchzip=FILE` - Path to JSON ZIP archive (default: rhsearch.zip)
- `--help, -h` - Show help message

**What it does**:
- Reads items from Stage 1 database
- Performs deterministic grouping (by gameid, title+author, etc.)

---

### search_rebuild_fts5.js
**Purpose**: Quick FTS5 index rebuild without running full Stage 2

**Usage**:
```bash
enode.sh search_rebuild_fts5.js [options]
```

**Options**:
- `--rhsearchdb=FILE` - Path to search catalog database (default: auto-detect)
- `--help, -h` - Show help message

**What it does**:
- Quickly rebuilds the FTS5 search index when it gets out of sync
- Drops and recreates the FTS5 table and triggers
- Much faster than running the full Stage 2 (only takes seconds)
- Use this when you get "missing row" errors from FTS5

**Example**:
```bash
# Quick rebuild when FTS5 index is out of sync
enode.sh search_rebuild_fts5.js --rhsearchdb=~/rhplay/refmaterial/rhsearch_cat.db
```
- Performs probabilistic merge pass (similarity-based)
- Creates groups and edges tables for relationships
- Builds FTS5 full-text search index

**Output**:
- Updates `rhsearch_cat.db` with groups, items_groups, edges tables
- Creates FTS5 virtual table for fast searching

**Documentation**: See `docs/SEARCH_CATALOG_SYSTEM.md` for complete documentation

---

### search_smwhacks.js
**Purpose**: Command-line search tool for SMW hacks (proof of concept)

**Usage**:
```bash
enode.sh search_smwhacks.js <search phrases...> [options]
```

**Arguments**:
- `search phrases` - One or more search phrases (searched in title, author, description, tags)

**Options**:
- `--rhsearchdb=FILE` - Path to search catalog database
- `--rhsearchzip=FILE` - Path to JSON ZIP archive
- `--help, -h` - Show help message

**What it does**:
- Searches the SMW hack catalog using FTS5 full-text search
- Displays results with title, author, version, description, tags
- Shows group information for related hacks
- Automatically finds database/ZIP files if not specified (like database-manager.js)

**Environment Variables**:
- `RHSEARCH_DB_PATH` - Path to search catalog database
- `RHSEARCH_ZIP_PATH` - Path to JSON ZIP archive

**Examples**:
```bash
# Search by title
enode.sh search_smwhacks.js invictus

# Search multiple terms
enode.sh search_smwhacks.js kaizo intermediate

# Search with specific database
enode.sh search_smwhacks.js --rhsearchdb=search.db --rhsearchzip=search.zip "super mario"
```

**Documentation**: See search catalog system documentation

---

## lmlevelinfo utilities

### map16-parity
**Purpose**: Debug/compare Callisto text Map16 exports under `resources/all_map16/` against an optional `AllMap16.map16` LM16 binary.

**Usage** (from `lmlevelinfo/`):
```bash
make map16-parity
./map16-parity test/akogare/resources/all_map16 test/akogare/AllMap16.map16
./map16-parity --thorough test/akogare/resources/all_map16 test/akogare/AllMap16.map16
./map16-parity --help
```

**Options**: `--thorough` enables full text-vs-binary scan (same as `MAP16_PARITY_THOROUGH=1` in `levelinfo_tests`).

**Documentation**: See [`lmlevelinfo/test/README.md`](../lmlevelinfo/test/README.md) Map16 text export parity section.

---

*Last Updated: December 2025*  
*Total Programs: 18+ interactive scripts*

