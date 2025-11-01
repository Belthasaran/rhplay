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

---

### updategames.js
**Purpose**: Main script to update game database from SMWC

**Usage**:
```bash
node updategames.js [options]
```

**Key Options**:
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

### backfill_rhmd.js
**Purpose**: Export data from SQLite database to Python RHMD file format

**Usage**:
```bash
node backfill_rhmd.js
```

**Use Case**: Maintain compatibility with Python scripts by exporting to RHMD format

**Documentation**: See `docs/PYTHON_COMPATIBILITY_GUIDE.md`

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

*Last Updated: October 12, 2025*  
*Total Programs: 15+ interactive scripts*

