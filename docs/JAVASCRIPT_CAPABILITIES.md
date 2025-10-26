# RHTools JavaScript Capabilities Reference

**Last Updated:** October 13, 2025

This document provides a comprehensive overview of all JavaScript-based features, capabilities, and libraries in the RHTools project.

---

## Table of Contents

1. [Electron Desktop Application](#electron-desktop-application)
2. [Core JavaScript Utilities](#core-javascript-utilities)
3. [Library Modules (lib/)](#library-modules-lib)
4. [Database Scripts](#database-scripts)
5. [Testing Suite](#testing-suite)
6. [Metadata Server (mdserver/)](#metadata-server-mdserver)
7. [Native Dependencies](#native-dependencies)
8. [Build & Deployment](#build--deployment)

---

## Electron Desktop Application

### Architecture
- **Framework:** Electron 30.0.0 + Vue 3 + TypeScript + Vite
- **Process Model:** Main process + Renderer process with IPC communication
- **State Management:** Vue 3 Composition API with reactive state
- **UI Components:** Custom Vue components with themeable CSS

### Main Files

#### `electron/main.js`
- **Purpose:** Electron main process entry point
- **Features:**
  - Creates and manages application windows
  - Initializes database connections
  - Registers IPC handlers
  - Handles application lifecycle events

#### `electron/preload.js`
- **Purpose:** Secure IPC bridge between main and renderer processes
- **Exposes APIs:**
  - Database operations (games, stages, runs, settings)
  - File operations (validation, browsing)
  - USB2SNES communication
  - Game staging and launching

#### `electron/ipc-handlers.js`
- **Purpose:** IPC request handlers for renderer communication
- **Handler Categories:**
  - Database queries (games, stages, user data)
  - Settings management (ROM paths, tool paths, preferences)
  - USB2SNES operations (connect, upload, console control)
  - SMW-specific game actions (grant cape, timer challenge)
  - File validation (ROM checksums, executable checks)
  - Game staging and launch preparation

#### `electron/database-manager.js`
- **Purpose:** Centralized database connection manager
- **Features:**
  - Manages three SQLite databases: `rhdata.db`, `patchbin.db`, `clientdata.db`
  - Thread-safe connection handling
  - Migration support
  - Graceful shutdown

#### `electron/game-stager.js`
- **Purpose:** Prepares game files for launching
- **Features:**
  - Applies BPS patches to vanilla ROM
  - Decrypts and decompresses patch blobs
  - Creates staged game files with metadata
  - Supports Quick Launch and Run staging modes
  - Generates unique filenames: `smw<GAMEID>_<VERSION>.sfc`

#### `electron/seed-manager.js`
- **Purpose:** Manages random seed generation and validation
- **Features:**
  - Cryptographically secure random seed generation
  - Seed persistence in database
  - Deterministic game selection using seeds

### USB2SNES System

#### SNESWrapper Architecture (`electron/main/usb2snes/`)

**`SNESWrapper.js`** - Unified Interface
- **Pattern:** Strategy Pattern / Facade Pattern
- **Purpose:** Single entry point for all USB2SNES operations
- **Features:**
  - Implementation switching (Type A, Type B, qusb2snes, node-usb)
  - Connection state management
  - Error handling and logging
  - Prevents implementation changes while connected

**`BaseUsb2snes.js`** - Abstract Base Class
- **Purpose:** Defines interface for all USB2SNES implementations
- **Interface Methods:**
  - Connection: `connect()`, `disconnect()`
  - Device: `DeviceList()`, `Attach()`, `Info()`, `Name()`
  - Console Control: `Boot()`, `Menu()`, `Reset()`
  - Memory: `GetAddress()`, `PutAddress()`
  - File Operations: `PutFile()`, `List()`, `MakeDir()`, `Remove()`

**`usb2snesTypeA.js`** - Type A Implementation ✅ COMPLETE
- **Based on:** JavaScript port of py2snes Python library
- **Protocol:** WebSocket communication with USB2SNES server
- **Features:**
  - Full SD2SNES support with 65816 assembly generation for CMD space writes
  - Memory read/write operations
  - File upload with progress tracking
  - Directory operations
  - Device management and firmware detection

**SMW-Specific Functions:**
- `usb2snes:smw:grantCape` - Grant cape powerup
- `usb2snes:smw:inLevel` - Check if player is in a level
- `usb2snes:smw:setTime` - Set game timer
- `usb2snes:smw:timerChallenge` - Wait for level entry, set 1-second timer

### Vue Renderer Application (`electron/renderer/`)

#### `electron/renderer/src/App.vue`
**Main GUI Component** - Single File Component (2000+ lines)

**Features:**
- **Game List Management:**
  - Searchable/filterable table with 12+ columns
  - Multi-select with bulk operations
  - User annotations (ratings, notes, status)
  - Hide/show/finished filtering

- **Advanced Search/Filters:**
  - Full-text search across all fields
  - Attribute search syntax: `<attribute>:<value>`
  - Comparison operators: `rating:>3`, `rating:<=4`
  - Filter tags for quick filtering
  - Keyboard shortcut: `/` to open filters

- **Theming System:**
  - 4 themes: Light, Dark, Onyx, Ash
  - Dynamic CSS custom properties
  - Text size control (Small to Extra Large)
  - Persistent theme preferences

- **Settings Dialog:**
  - ROM/tool file import (drag-drop + browse)
  - File validation (checksums, executables)
  - Launch method configuration
  - USB2SNES preferences
  - Temporary directory customization

- **USB2SNES Tools Modal:**
  - Library implementation selector
  - Connection management
  - Device diagnostics (firmware, version, ROM)
  - Console control (reboot, menu)
  - SMW quick actions (cape, timer challenge)
  - File upload with progress

- **Run Preparation:**
  - Drag-drop reorderable run list
  - Random game selection with filters
  - Seed-based deterministic selection
  - Stage-level run support
  - Run staging and upload

- **Quick Launch:**
  - Direct game launching (1-21 games)
  - Progress modal with real-time updates
  - Automatic folder creation
  - File staging to temporary directory

#### `electron/renderer/src/themeConfig.ts`
- **Purpose:** Centralized theme configuration
- **Features:**
  - Theme definitions with CSS variable mappings
  - Default theme constant
  - Type-safe TypeScript definitions

---

## Core JavaScript Utilities

### Blob and Patch Management

#### `loaddata.js`
- **Purpose:** Load game metadata from JSON files into rhdata.db
- **Features:**
  - Scans `hacks/` directory for JSON metadata files
  - Validates and normalizes game data
  - Inserts/updates gameversions table
  - Preserves user annotations during updates
  - Environment variable support: `RHDATA_DB_PATH`

#### `attachblobs.js`
- **Purpose:** Link patch files to database records
- **Features:**
  - Scans patchblobs and creates attachments records
  - `--newonly` flag for incremental processing (20x faster)
  - Deduplication by filename
  - Progress reporting
  - Environment variable: `PATCHBIN_DB_PATH`
  - `--help` option for usage information

#### `fetchpatches.js`
- **Purpose:** Download and process game patches
- **Modes:**
  - `mode1` - Basic patch download
  - `mode2` - Enhanced processing with version tracking
  - `mode3` - Advanced search and metadata extraction
  - `addsizes` - Add file size information
- **Features:**
  - Automated ZIP download from multiple sources
  - Patch extraction (BPS/IPS/UPS)
  - Blob creation with encryption
  - Database record updates

#### `fetchpatches_mode2.js` & `fetchpatches_mode2_optionG.js`
- **Purpose:** Enhanced patch fetching with resource tracking
- **Features:**
  - HTTP HEAD requests for efficient change detection
  - Resource URL tracking and versioning
  - Content-Length and Last-Modified monitoring
  - Minimal re-download of unchanged content

#### `verify-all-blobs.js`
- **Purpose:** Verify integrity of patch blobs
- **Features:**
  - Validates blob checksums (SHA-224, SHA-1, SHAKE-128)
  - Compares database records with files
  - `--verify-blobs=files` or `--verify-blobs=db`
  - `--full-check` for comprehensive validation
  - `--verify-result` for patched ROM validation
  - Generates verification reports

#### `list-unuploaded-blobs.js`
- **Purpose:** Identify blobs not yet uploaded to distributed storage
- **Providers:**
  - `--provider=ipfs` - IPFS/Filecoin
  - `--provider=arweave` - Arweave
  - `--provider=ardrive` - ArDrive
- **Features:**
  - Filters by upload status
  - Lists pending uploads
  - Export to various formats

#### `mark-upload-done.js`
- **Purpose:** Mark blobs as uploaded after distribution
- **Features:**
  - Updates upload status in database
  - Tracks upload timestamps
  - Supports batch operations

### Game Processing

#### `updategames.js`
- **Purpose:** Automated game metadata updates from SMWC
- **Features:**
  - Fetches latest game information
  - Detects version changes
  - Updates ratings, descriptions, authors
  - Tracks download URL changes
  - Preserves user annotations
- **Options:**
  - `--all-patches` - Process all games
  - `--dry-run` - Test without database changes
  - `--limit=N` - Limit processing to N games
  - `--resume` - Continue from last checkpoint
- **Environment variable:** `RHDATA_DB_PATH`

#### `reprocess-attachments.js`
- **Purpose:** Rebuild attachment records
- **Features:**
  - Rescans patchblob directory
  - Recreates attachment linkages
  - Fixes corrupted records
  - Validates file integrity

#### `backfill_rhmd.js`
- **Purpose:** Backfill rhmd (ROM hack metadata) files
- **Features:**
  - Generates missing metadata files
  - Creates JSON descriptors for patched ROMs
  - Populates rhmd/ directory structure

### Database Utilities

#### `test_run_start.js`
- **Purpose:** Test database initialization
- **Features:**
  - Creates test databases
  - Runs SQL migrations
  - Validates schema

#### `loadsm.js`
- **Purpose:** Load SMW-specific metadata
- **Features:**
  - Imports level data
  - Processes exit information
  - Updates stage tables

#### `identify-incompatible-keys.js`
- **Purpose:** Find blob decryption key mismatches
- **Features:**
  - Tests blob keys against database
  - Identifies corrupted or mismatched keys
  - Reports incompatible blobs

#### `test-blob-decode.js`
- **Purpose:** Test blob decryption
- **Features:**
  - Validates blob decryption process
  - Tests encryption keys
  - Verifies patch extraction

#### `test-key-decode.js`
- **Purpose:** Test encryption key decoding
- **Features:**
  - Validates key formats
  - Tests base64 encoding/decoding
  - Verifies key derivation

### IPFS Gateway Management

#### `migrate_ipfsgateways.js`
- **Purpose:** Migrate IPFS gateway configurations
- **Features:**
  - Updates gateway URLs
  - Migrates database schema
  - Preserves gateway preferences

#### `update_ipfs_gateways.js`
- **Purpose:** Update IPFS gateway list
- **Features:**
  - Fetches latest public gateways
  - Tests gateway availability
  - Updates database records

### API Server Management

#### `electron/migrate_apiservers.js`
- **Purpose:** Migrate API server configurations
- **Features:**
  - Schema migration for apiserver table
  - Preserves endpoint configurations
  - Updates authentication credentials

#### `electron/manage_apiserver.js`
- **Purpose:** API server management CLI
- **Commands:**
  - `add` - Add new API server
  - `list` - List configured servers
  - `test` - Test server connectivity
- **Features:**
  - Interactive prompts
  - Connection validation
  - Credential management

---

## Library Modules (lib/)

Reusable JavaScript modules for common operations:

### `lib/database.js`
- **Purpose:** Database operations wrapper
- **Features:**
  - SQLite connection management
  - Query builders
  - Transaction support
  - Error handling

### `lib/blob-creator.js`
- **Purpose:** Create encrypted patch blobs
- **Features:**
  - Compression (LZMA)
  - AES-256-CBC encryption
  - Key generation and storage
  - SHA checksums (SHA-224, SHA-1, SHAKE-128)

### `lib/record-creator.js`
- **Purpose:** Create/update database records
- **Features:**
  - Normalized value binding for SQLite
  - Combined type computation from fields
  - Locked attribute preservation
  - Version-aware updates

### `lib/patch-processor.js`
- **Purpose:** Extract and test patches from ZIPs
- **Features:**
  - Multi-format support (BPS/IPS/UPS)
  - Automatic extraction
  - Patch validation with FLIPS
  - Result verification

### `lib/smwc-fetcher.js`
- **Purpose:** Fetch metadata from SMW Central
- **Features:**
  - HTML scraping for game details
  - Rating extraction
  - Author and tag parsing
  - URL normalization

### `lib/game-downloader.js`
- **Purpose:** Download game ZIP files
- **Features:**
  - HTTP/HTTPS download with progress
  - Retry logic
  - Timeout handling
  - Stream processing

### `lib/flips-finder.js`
- **Purpose:** Locate FLIPS patcher binary
- **Features:**
  - Multi-path search
  - Version detection
  - Platform compatibility
  - Extends `binary-finder.js`

### `lib/binary-finder.js`
- **Purpose:** Generic binary/file locator
- **Features:**
  - Path resolution (absolute, relative, PATH)
  - File validation (checksums, executability)
  - SMW ROM validation (SHA-224 hash check)
  - Multiple search locations

### `lib/change-detector.js`
- **Purpose:** Detect and classify game changes
- **Features:**
  - Field-level change detection
  - Change classification (major, minor, metadata)
  - Version comparison logic
  - Update recommendation

### `lib/resource-manager.js`
- **Purpose:** HTTP resource optimization
- **Features:**
  - HTTP HEAD requests for change detection
  - Content-Length tracking
  - Last-Modified header parsing
  - Minimal bandwidth usage

### `lib/url-comparator.js`
- **Purpose:** URL change detection logic
- **Features:**
  - URL normalization
  - Protocol-agnostic comparison
  - Path equivalence checking
  - Query parameter handling

### `lib/stats-manager.js`
- **Purpose:** Game version statistics
- **Features:**
  - Version counting
  - Update frequency tracking
  - Change history
  - Aggregate statistics

### `lib/update-processor.js`
- **Purpose:** Process updates to existing games
- **Features:**
  - Incremental update detection
  - Conflict resolution
  - User annotation preservation
  - Atomic updates

---

## Database Scripts

### Migration Scripts (`electron/sql/migrations/`)

#### `001_add_fields_type_raw_difficulty.sql`
- Adds `fields_type`, `raw_difficulty` columns to gameversions

#### `001_clientdata_user_annotations.sql`
- Creates user annotation tables in clientdata.db

#### `002_add_combinedtype.sql`
- Adds `combinedtype` computed field

#### `002_clientdata_enhanced_ratings_and_runs.sql`
- Enhanced rating system and run tracking

#### `003_backfill_combinedtype.js`
- Backfills combinedtype for existing records

#### `003_clientdata_skill_rating_and_conditions.sql`
- Adds skill-based rating and conditional logic

#### `004_add_local_resource_tracking.sql`
- Adds resource URL tracking columns

#### `004_clientdata_fix_run_results_gameid.sql`
- Fixes run results game ID references

#### `005_add_local_runexcluded.sql`
- Adds run exclusion tracking

#### `006_clientdata_seed_mappings.sql`
- Seed-to-game mapping for deterministic selection

#### `007_clientdata_pause_and_staging.sql`
- Pause state and staging directory tracking

### Schema Files (`electron/sql/`)

#### `rhdata.sql`
- **Tables:** `gameversions`, `ipfsgateways`, `local_resources`
- Complete schema for game metadata

#### `patchbin.sql`
- **Tables:** `patchblobs`, `attachments`, `blobsets`
- Patch blob and attachment management

#### `clientdata.sql`
- **Tables:** `settings`, `user_games`, `user_stages`, `runs`, `run_entries`, `apiservers`, `seed_mappings`
- User data and preferences

---

## Testing Suite

### Test Files (`tests/`)

#### `tests/setup_test_env.js`
- **Purpose:** Initialize test environment
- **Features:**
  - Creates test databases
  - Seeds test data
  - Cleans up after tests

#### `tests/create_test_signers.js`
- **Purpose:** Generate test cryptographic keys
- **Features:**
  - Creates ED25519 key pairs
  - Generates signing credentials
  - Stores in test environment

#### `tests/test_attachblobs.js`
- **Purpose:** Test `attachblobs.js` functionality
- **Tests:**
  - Attachment creation
  - `--newonly` flag behavior
  - Deduplication logic
- **Documentation:** `tests/README_ATTACHBLOBS_TESTS.md`

#### `tests/test_blob_compatibility.js`
- **Purpose:** Verify blob format compatibility
- **Tests:**
  - Encryption/decryption
  - Compression/decompression
  - Cross-version compatibility

#### `tests/test_python_script_compat.js`
- **Purpose:** Test Python-JavaScript interoperability
- **Tests:**
  - Blob format compatibility with Python scripts
  - Key format compatibility
  - Checksum validation

#### `tests/test_updategames.js`
- **Purpose:** Test game update logic
- **Tests:**
  - Metadata update detection
  - User annotation preservation
  - Version change handling

#### `tests/test_mode2.js`
- **Purpose:** Test fetchpatches mode2
- **Tests:**
  - Resource tracking
  - Change detection
  - Download optimization

#### `tests/test_mode3.js`
- **Purpose:** Test fetchpatches mode3
- **Tests:**
  - Advanced search
  - Metadata extraction
  - Multi-source fetching

#### `tests/test_mode3_enhanced_search.js`
- **Purpose:** Enhanced search functionality tests
- **Tests:**
  - Search query parsing
  - Filter application
  - Result ranking

#### `tests/test_loaddata.js`
- **Purpose:** Test loaddata.js
- **Tests:**
  - JSON parsing
  - Database insertion
  - Update logic

#### `tests/test_locked_attributes.js`
- **Purpose:** Test locked attribute preservation
- **Tests:**
  - Attribute locking
  - Version update preservation
  - User overrides

#### `tests/test_phase2_resource_tracking.js`
- **Purpose:** Test resource tracking features
- **Tests:**
  - URL monitoring
  - Change detection
  - Resource versioning

#### `tests/test_phase2_change_detection.js`
- **Purpose:** Test change detection system
- **Tests:**
  - Field-level changes
  - Classification logic
  - Update triggers

### Electron Tests (`electron/tests/`)

#### `electron/tests/test_integration.js`
- **Purpose:** Integration tests for Electron app
- **Tests:**
  - IPC communication
  - Database operations
  - File handling

#### `electron/tests/test_enhanced_ratings.js`
- **Purpose:** Test rating system
- **Tests:**
  - Rating calculation
  - Rating persistence
  - Rating aggregation

#### `electron/tests/test_clientdata_annotations.js`
- **Purpose:** Test user annotations
- **Tests:**
  - Note creation/editing
  - Status updates
  - Rating changes

### Server Tests (`tests/` - mdserver related)

#### `tests/test_server.js`
- **Purpose:** Test metadata API server
- **Tests:**
  - API endpoints
  - Authentication
  - Data retrieval

#### `tests/test_e2e_apig.js`
- **Purpose:** End-to-end API gateway tests
- **Tests:**
  - Full request/response cycle
  - Error handling
  - Rate limiting

---

## Metadata Server (mdserver/)

### Overview
RESTful API server for game metadata distribution with encrypted client authentication.

### `mdserver/server.js`
- **Purpose:** Main API server
- **Framework:** Express.js
- **Features:**
  - Read-only and admin client support
  - Encrypted credentials with Fernet
  - JWS signature verification
  - Query gameversions, patchblobs, attachments
  - Paginated responses
  - Request logging

**API Endpoints:**
- `GET /api/gameversions` - List game versions (with filters)
- `GET /api/patchblobs` - List patch blobs
- `GET /api/attachments` - List attachments
- `GET /api/patchblob/:blobname` - Get specific blob
- Admin-only endpoints for modifications

**Authentication:**
- Bearer token with encrypted client UUID
- JWS signature validation
- Role-based access (read-only vs admin)

### `mdserver/setup.js`
- **Purpose:** Initialize server environment
- **Features:**
  - Creates `.env` file
  - Generates VAULT_KEY
  - Sets up database paths

### `mdserver/create_client.js`
- **Purpose:** Create API client credentials
- **Features:**
  - Generates client UUID
  - Creates encrypted bearer tokens
  - Assigns roles (read-only/admin)

### `mdserver/create_signer.js`
- **Purpose:** Create signing key pairs
- **Features:**
  - Generates ED25519 keys
  - Creates JWS signing credentials
  - Stores in clients table

### `mdserver/sign_metadata.js`
- **Purpose:** Sign metadata records
- **Features:**
  - JWS signature creation
  - Timestamp inclusion
  - Signature verification

### `mdserver/migrate_signatures.js`
- **Purpose:** Migrate signature formats
- **Features:**
  - Updates signature schema
  - Preserves existing signatures
  - Validates migrations

### `mdserver/cleanup_signatures.js`
- **Purpose:** Clean up old signatures
- **Features:**
  - Removes expired signatures
  - Prunes invalid signatures
  - Database optimization

### `mdserver/test_api.js`
- **Purpose:** API testing utility
- **Features:**
  - Test all endpoints
  - Validate responses
  - Performance testing

---

## Native Dependencies

### Production Dependencies

#### `better-sqlite3` (v11.0.0)
- **Purpose:** Fast, synchronous SQLite3 database
- **Native:** Yes (C++ binding)
- **Usage:** All database operations

#### `lzma-native` (v8.0.6)
- **Purpose:** LZMA compression/decompression
- **Native:** Yes (liblzma binding)
- **Usage:** Blob compression

#### `@poeticode/js-lzma` (v1.0.0)
- **Purpose:** Pure JavaScript LZMA
- **Native:** No
- **Usage:** Fallback compression

#### `node-liblzma` (v1.1.9)
- **Purpose:** Alternative LZMA binding
- **Native:** Yes
- **Usage:** Alternative compression

#### `adm-zip` (v0.5.10)
- **Purpose:** ZIP file handling
- **Usage:** Patch extraction

#### `ws` (v8.18.3)
- **Purpose:** WebSocket client/server
- **Usage:** USB2SNES communication

#### `express` (v4.21.2)
- **Purpose:** Web framework
- **Usage:** Metadata API server

#### `node-jose` (v2.2.0)
- **Purpose:** JWS/JWE cryptography
- **Usage:** API signature verification

#### `fernet` (v0.3.2)
- **Purpose:** Symmetric encryption
- **Usage:** Client credential encryption

#### `crc` & `crc-32`
- **Purpose:** CRC checksums
- **Usage:** File integrity verification

#### `dotenv` (v16.6.1)
- **Purpose:** Environment variable loading
- **Usage:** Server configuration

#### `multiformats` (v9.9.0)
- **Purpose:** Multiformat encodings (CID, multihash)
- **Usage:** IPFS integration

#### `urlsafe-base64` (v1.0.0)
- **Purpose:** URL-safe base64 encoding
- **Usage:** Key encoding

### Development Dependencies

#### `electron` (v30.0.0)
- **Purpose:** Desktop app framework
- **Usage:** Main application

#### `electron-builder` (v26.0.12)
- **Purpose:** Build and packaging
- **Usage:** Creating Windows/Linux builds

#### `@electron/rebuild` (v4.0.1)
- **Purpose:** Rebuild native modules
- **Usage:** Platform-specific compilation

#### `cross-env` (v7.0.3)
- **Purpose:** Cross-platform environment variables
- **Usage:** Development scripts

#### `npm-run-all` (v4.1.5)
- **Purpose:** Run multiple npm scripts
- **Usage:** Parallel dev server + electron

### Renderer Dependencies (`electron/renderer/`)

#### `vue` (v3.4.0)
- **Purpose:** UI framework
- **Usage:** Renderer application

#### `vite` (v5.0.0)
- **Purpose:** Build tool and dev server
- **Usage:** Fast HMR development

#### `@vitejs/plugin-vue` (v5.0.0)
- **Purpose:** Vue 3 plugin for Vite
- **Usage:** SFC compilation

#### `typescript` (v5.4.0)
- **Purpose:** Type checking
- **Usage:** Type-safe development

---

## Build & Deployment

### Build Configuration

**`package.json` - Build Scripts:**
```bash
npm run build:win          # Portable Windows .exe
npm run build:win-all      # Portable + Installer
npm run build:linux        # Linux AppImage
```

**electron-builder Configuration:**
- **App ID:** `com.rhtools.app`
- **Product Name:** RHTools
- **Output Directory:** `dist-builds/`
- **Windows Target:** Portable executable (x64)
- **Linux Target:** AppImage

### Build Features
- Cross-platform builds from Linux
- Automatic native module rebuilding
- Portable executable (no installation)
- All dependencies bundled
- ~150-250MB output size (includes Electron runtime)

### File Exclusions
Build excludes:
- Test data and test files
- Backup databases
- Temporary DB files (`.db-shm`, `.db-wal`)
- Development source files
- Node modules for renderer (uses compiled dist)

### Platform Support
- **Windows:** 10, 11 (portable executable)
- **Linux:** AppImage (most distributions)
- **Cross-compilation:** Build Windows from Linux

### Documentation
- `docs/BUILD_WINDOWS.md` - Comprehensive build guide
- `docs/CHANGELOG.md` - Feature changelog
- `.gitignore` - Excludes `dist-builds/`

---

## Key Technologies Summary

### Languages & Frameworks
- **JavaScript:** ES2020+ with async/await
- **TypeScript:** Type-safe Vue components
- **Vue 3:** Composition API with `<script setup>`
- **Electron:** Desktop app framework
- **Node.js:** v18+ required

### Databases
- **SQLite3:** Three databases (rhdata, patchbin, clientdata)
- **better-sqlite3:** Synchronous API
- **Migrations:** SQL and JavaScript-based

### Cryptography
- **AES-256-CBC:** Blob encryption
- **SHA-224/SHA-1:** Checksums
- **SHAKE-128:** Alternative hashing
- **ED25519:** Digital signatures
- **Fernet:** Symmetric encryption for credentials
- **JWS:** JSON Web Signatures

### Compression
- **LZMA:** Primary compression (native + pure JS)
- **GZIP:** Alternative compression

### Network Protocols
- **HTTP/HTTPS:** Game downloads, API requests
- **WebSocket:** USB2SNES communication
- **REST:** Metadata API server

### File Formats
- **JSON:** Metadata storage
- **BPS/IPS/UPS:** Patch formats
- **ZIP:** Archive handling
- **SQLite:** Database files

---

## Environment Variables

Scripts support these environment variable overrides:

- `RHDATA_DB_PATH` - Path to rhdata.db database
- `PATCHBIN_DB_PATH` - Path to patchbin.db database
- `RHMD_FILE` - Path to rhmd metadata file

**Usage Example:**
```bash
RHDATA_DB_PATH=/tmp/test_rhdata.db node loaddata.js
```

---

## Related Documentation

- `docs/BUILD_WINDOWS.md` - Windows build guide
- `docs/CHANGELOG.md` - Feature changelog
- `docs/SCHEMACHANGES.md` - Database schema changes
- `docs/DBMIGRATE.md` - Migration commands
- `electron/GUI_README.md` - GUI component reference
- `devdocs/SNESWRAPPER_ARCHITECTURE.md` - USB2SNES architecture
- `devdocs/USB2SNES_IMPLEMENTATION_PLAN.md` - Implementation roadmap
- `tests/README_ATTACHBLOBS_TESTS.md` - Attachment tests

---

## Future JavaScript Capabilities (Planned)

Based on the codebase structure:

- **usb2snes_b, qusb2snes, node-usb implementations** - Additional USB2SNES libraries
- **Enhanced metadata signing** - Distributed trust system
- **IPFS/Arweave upload automation** - Decentralized storage integration
- **Advanced level picker** - Custom ASM patch generation
- **Web-based client** - Browser version of Electron app
- **CI/CD automation** - GitHub Actions for builds

---

**End of JavaScript Capabilities Reference**

