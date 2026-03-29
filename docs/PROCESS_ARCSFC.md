# process_arcsfc.js - SNES ROM Processing and BPS Patch Creation

## Overview

`process_arcsfc.js` is a command-line tool designed to process SNES ROM files, detect and standardize ROM headers, calculate cryptographic hashes, and generate BPS (Binary Patch System) patches. The script is designed to be run from subdirectories of `/home/me/smwdb/` and handles both individual ROM files and archived ROM files.

## Purpose

This script automates the process of:
- Detecting whether a SNES ROM is headered or unheadered
- Standardizing ROM headers using `snesheader.exe` via Wine
- Creating standardized versions (both headered and unheadered)
- Calculating SHA1 and SHA256 hashes for all ROM variants
- Generating BPS patches against a base ROM (`/home/me/smwdb/smw.sfc`)
- Extracting metadata from filenames
- Verifying archive contents
- Organizing processed files into appropriate directories

## Requirements

### Platform
- **Linux only** - The script uses Wine to run Windows executables

### Dependencies
- **Wine** - Required to run `snesheader.exe`
- **snesheader.exe** - Must be available at `K:\snesheader.exe` (accessible via Wine)
- **flips** - BPS patch creation utility (must be in PATH)
- **7z** - Archive extraction utility (must be in PATH)
- **os-lock** - Optional npm package at the repo root (listed under `optionalDependencies` in `package.json`). Used for inter-process locking; installs on Linux. On Windows it may be skipped so `npm install` does not fail; this tool is not intended to run on Windows anyway.

### File System
- Script must be run from a subdirectory of `/home/me/smwdb/`
- Base ROM must exist at `/home/me/smwdb/smw.sfc`

## Usage

### Basic Syntax

```bash
node process_arcsfc.js <sfcsource_filename> [sfcarchive_filename]
```

### Arguments

- **sfcsource_filename** (required): Path to the source `.sfc` ROM file
- **sfcarchive_filename** (optional): Path to the `.7z` archive file containing the ROM

### Examples

```bash
# Process a ROM file with an archive
node process_arcsfc.js example.sfc example.7z

# Process a ROM file without an archive
node process_arcsfc.js game.sfc

# Show help
node process_arcsfc.js --help
```

## Processing Steps

The script performs the following steps in sequence:

### Step 1: Directory Setup
Creates the following subdirectories if they don't exist:
- `done/` - Successfully processed files
- `output/` - Generated BPS patches and metadata JSON files
- `error/` - Files that failed verification
- `temp/` - Temporary working files

### Step 2: Lock Acquisition
- Copies the source ROM to `temp/source.sfc`
- Creates `temp/lock.txt` and acquires an exclusive read lock
- The lock is held for the entire script execution to prevent concurrent processing

### Step 3: Cleanup
- Removes any existing `temp/source.sfc` and `temp/source.7z` files

### Step 4: Archive Copy (if specified)
- If `sfcarchive_filename` is provided, copies it to `temp/source.7z`

### Step 5: Source Copy
- Copies the source ROM file to `temp/source.sfc`

### Step 6: ROM Type Detection
Examines the file size to determine ROM type:

- **Unheadered ROM**: File size is an exact power of 2 in kilobytes, and `size % 1024 == 0`
- **Headered ROM**: File size is exactly 512 bytes greater than a power of 2 in kilobytes, and `size % 1024 == 512`
- **Exception**: If neither condition is met, the script logs an error and exits with status 1

### Step 7: ROM Header Processing

#### 7.A: Unheadered ROM Processing
1. Copy `temp/source.sfc` to `./source_temp_hdr.smc`
2. Execute `wine 'K:\snesheader.exe' source_temp_hdr.smc 1`
3. If exit status is 1, remove temp file, log error, and abort
4. If exit status is 0:
   - Rename `temp/source.sfc` to `temp/source_unh.sfc`
   - Rename `./source_temp_hdr.smc` to `temp/source_hdr.smc`

#### 7.B: Headered ROM Processing
1. Copy `temp/source.sfc` to `./source_temp_unhdr.sfc`
2. Execute `wine 'K:\snesheader.exe' source_temp_unhdr.sfc 0` (remove header)
3. If exit status is 1, remove temp file, log error, and abort
4. If exit status is 0:
   - Rename `temp/source.sfc` to `temp/source_hdr.smc`
   - Rename `./source_temp_unhdr.sfc` to `temp/source_unh.sfc`
5. Copy `temp/source_unh.sfc` to `./source_temp_hdr2.smc`
6. Execute `wine 'K:\snesheader.exe' source_temp_hdr2.smc 1` (re-add header)
7. If exit status is 1, remove temp file and abort
8. If exit status is 0, rename `./source_temp_hdr2.smc` to `temp/source_rehdr.smc`

**Result**: After step 7, the following files exist:
- `temp/source_unh.sfc` - Unheadered ROM
- `temp/source_hdr.smc` - Headered ROM
- `temp/source_rehdr.smc` - Re-headered ROM (only if source was originally headered)

### Step 8: Hash Calculation
Calculates cryptographic hashes for all ROM variants:

- `sfc_rom_sha1_hash` - SHA1 of `temp/source_unh.sfc`
- `smc_rom_sha1_hash` - SHA1 of `temp/source_hdr.smc`
- `sfc_rom_sha256_hash` - SHA256 of `temp/source_unh.sfc`
- `smc2_rom_sha1_hash` - SHA1 of `temp/source_rehdr.smc` (if exists) or `temp/source_hdr.smc`
- `smc2_rom_sha256_hash` - SHA256 of `temp/source_rehdr.smc` (if exists) or `temp/source_hdr.smc`

### Step 9: BPS Patch Creation
Creates a BPS patch using flips:

```bash
flips --create --bps /home/me/smwdb/smw.sfc temp/source_unh.sfc temp/XX.bps
```

Where `XX` is the `sfc_rom_sha1_hash` value.

- If flips exits with status 1, the error is logged and the script aborts
- The BPS filename (without `.bps` extension) is stored as `bps_filename`

### Step 11: Metadata JSON Creation
Creates a JSON file `temp/XX.json` (where `XX` is the SHA1 hash) containing:

#### Required Fields
- `sfcsource_filename` - Basename of the source SFC file
- `sfcarchive_filename` - Basename of the archive file (null if not provided)
- `sfc_rom_sha1_hash` - SHA1 hash of unheadered ROM
- `smc_rom_sha1_hash` - SHA1 hash of headered ROM
- `sfc_rom_sha256_hash` - SHA256 hash of unheadered ROM
- `smc2_rom_sha1_hash` - SHA1 hash of re-headered ROM (or headered if source was unheadered)
- `smc2_rom_sha256_hash` - SHA256 hash of re-headered ROM (or headered if source was unheadered)
- `bps_filename` - Filename of the BPS patch (without extension)

#### Extracted Filename Metadata
The script attempts to extract metadata from filenames using heuristics:

**SFC Filename Attributes** (prefixed with `sfc_filename_`):
- `sfc_filename_title` - Game title
- `sfc_filename_author` - Author name (extracted from "by AuthorName" patterns)
- `sfc_filename_series_name` - Series name (e.g., "Devious Four Chronicles")
- `sfc_filename_sequence_number` - Sequence number in series (e.g., #6)
- `sfc_filename_versioninfo` - Version information (e.g., "Demo", "V1.0", "C3 Demo", "SoEN Early Beta")
- `sfc_filename_additional_version_info` - Additional version info (e.g., "alt", "Debug", "God Mode", "Fixed", "New")
- `sfc_filename_date` - Date from brackets (e.g., "[2012-07-07]" -> "2012-07-07")
- `sfc_filename_language` - Language from parentheses (e.g., "(English)" -> "English")

**7z Filename Attributes** (prefixed with `7z_filename_`, same structure as SFC attributes)

#### File Timestamp Metadata
- `sfc_upload_estimate` - Modification timestamp of the SFC file (ISO format)
- `dir_upload_estimate` - Modification timestamp of the parent directory (ISO format)
- `7z_upload_estimate` - Modification timestamp of the 7z file (ISO format, if archive provided)

#### 7z Archive Metadata (if archive provided)
- `7z_content_filename` - Filename of the file inside the 7z archive
- `7z_content_timestamp` - Timestamp of the file inside the 7z archive
- `7z_content_attr` - File attributes from the 7z archive

### Step 12: Archive Verification (if archive specified)
If `sfcarchive_filename` was provided:

1. Examines `temp/source.7z` contents using `7z l -slt`
2. Verifies the archive contains exactly 1 file
3. Extracts and calculates SHA256 hash of the file in the archive
4. Compares the hash to `sfc_rom_sha256_hash` or `smc2_rom_sha256_hash`
5. **If verified**: Moves the archive to `done/` directory
6. **If mismatch or multiple files**: Moves the archive to `error/` directory

### Step 13: Move Output Files
Moves the generated files to `output/` directory:
- BPS patch file (`XX.bps`)
- Metadata JSON file (`XX.json`)

### Step 14: Finalization
- Moves the source SFC file to `done/` directory
- Appends success message to `output/log.txt`
- Releases the lock file
- Exits with status 0

### Step 15: Error Handling
If any step fails:
- Error details are appended to `output/log.txt`
- Lock file is released
- Script exits with non-zero status

## Filename Parsing Heuristics

The script includes sophisticated filename parsing to extract metadata. Examples of parsed patterns:

### Date Extraction
- `[2012-07-07]` → `date: "2012-07-07"`
- `[2007-2009]` → `date: "2007-2009"`

### Language Extraction
- `(English)` → `language: "English"`
- `(French)` → `language: "French"`

### Author Extraction
- `by Milk n Cookies` → `author: "Milk n Cookies"`
- `by Lexou (Lexator)` → `author: "Lexator"` (extracts alias)
- `by cyphermur9t + kleber dicas` → `author: "cyphermur9t"` (first author)

### Series and Sequence
- `2 Player Co-Op Quest #2` → `series_name: "2 Player Co-Op Quest"`, `sequence_number: 2`
- `Devious Four Chronicles #6` → `series_name: "Devious Four Chronicles"`, `sequence_number: 6`

### Version Information
- `(Demo)` → `versioninfo: "Demo"`
- `(V1.0)` → `versioninfo: "V1.0"`
- `(C3 Demo)` → `versioninfo: "C3 Demo"`
- `(SoEN Early Beta)` → `versioninfo: "SoEN Early Beta"`

### Additional Version Info
- `(alt)` → `additional_version_info: "alt"`
- `(Debug)` → `additional_version_info: "Debug"`
- `(God Mode)` → `additional_version_info: "God Mode"`
- `(Fixed)` → `additional_version_info: "Fixed"`

## Output Files

### BPS Patch File
- **Location**: `output/XX.bps` (where `XX` is the SHA1 hash)
- **Format**: Binary Patch System format
- **Purpose**: Patch to convert base ROM to the processed ROM

### Metadata JSON File
- **Location**: `output/XX.json` (where `XX` is the SHA1 hash)
- **Format**: JSON with pretty-printing (2-space indent)
- **Purpose**: Complete metadata about the processed ROM

### Log File
- **Location**: `output/log.txt`
- **Format**: Timestamped log entries
- **Purpose**: Records all operations, successes, and errors

## Error Conditions

The script exits with non-zero status in the following cases:

1. **ROM size exception** - File size doesn't match valid SNES ROM sizes
2. **snesheader.exe failure** - Wine execution of snesheader.exe fails
3. **flips failure** - BPS patch creation fails
4. **File not found** - Source or archive file doesn't exist
5. **Lock file exists** - Another instance may be running
6. **Archive verification failure** - Archive contents don't match expected hash

## File Organization

After successful processing:

```
<working_directory>/
├── done/
│   ├── <sfcsource_filename>      # Processed source file
│   └── <sfcarchive_filename>      # Verified archive (if provided)
├── output/
│   ├── <sha1_hash>.bps            # BPS patch file
│   ├── <sha1_hash>.json           # Metadata JSON
│   └── log.txt                     # Operation log
├── error/
│   └── <sfcarchive_filename>      # Archive with verification issues (if any)
└── temp/
    ├── source_unh.sfc             # Unheadered ROM (temporary)
    ├── source_hdr.smc             # Headered ROM (temporary)
    └── source_rehdr.smc           # Re-headered ROM (temporary, if applicable)
```

## Notes

- The script uses exclusive file locking to prevent concurrent execution
- All file operations are verified before proceeding to the next step
- The script is designed to be idempotent-safe (can be re-run if previous run failed)
- Temporary files in `temp/` are not automatically cleaned up (may be useful for debugging)
- The lock file (`temp/lock.txt`) is automatically removed on successful completion or error

## Integration

This script is part of the rhtools project and is designed to work with the SMW database processing pipeline. The generated BPS patches and metadata can be used by other tools in the project for game version management and patch distribution.
