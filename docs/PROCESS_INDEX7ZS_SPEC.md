# process_index7zs.js - Complete Specification

**Version**: 1.0  
**Last Updated**: December 2025  
**Purpose**: Comprehensive specification for the BPS indexing and JSON consolidation tool

---

## Table of Contents

1. [Overview](#overview)
2. [Usage](#usage)
3. [Architecture](#architecture)
4. [Input/Output](#inputoutput)
5. [Processing Flow](#processing-flow)
6. [JSON File Formats](#json-file-formats)
7. [Master JSON Structure](#master-json-structure)
8. [Command-Line Options](#command-line-options)
9. [Error Handling](#error-handling)
10. [Implementation Details](#implementation-details)
11. [Examples](#examples)

---

## Overview

### Purpose

`process_index7zs.js` is a tool designed to:
- Scan 7z archives containing BPS patch files
- Find corresponding JSON metadata files in a directory tree
- Create and maintain master JSON index files that consolidate metadata from multiple sources
- Optionally verify BPS patches by applying them to the base ROM
- Generate missing metadata files when requested

### Key Features

- **Archive Scanning**: Lists contents of 7z archives to find BPS files
- **Recursive Search**: Searches directory trees for matching JSON files
- **Data Consolidation**: Merges metadata from multiple JSON sources
- **Duplicate Handling**: Tracks source JSON files using SHA256 hashes
- **Atomic Writes**: Uses temporary files and rename operations
- **ROM Verification**: Optional verification of BPS patches against base ROM
- **Metadata Generation**: Optional generation of missing metadata files

---

## Usage

### Basic Syntax

```bash
enode.sh process_index7zs.js <JSON File Tree> <BPS Index Folder> <BPS Archives Folder> [options]
```

### Arguments

1. **JSON File Tree** (required)
   - Directory tree containing JSON metadata files
   - Searched recursively for files matching patterns:
     - `<sha1>.json`
     - `<sha1>_levelread.json`
     - `<sha1>_lmfilter.json`
     - `<sha1>_translevel.json`

2. **BPS Index Folder** (required)
   - Directory where master JSON index files are created/updated
   - Files are named: `<sha1>.json`
   - Created if it doesn't exist

3. **BPS Archives Folder** (required)
   - Directory containing 7z archive files
   - Archives are expected to be named: `bps_XX.7z` (where XX is hex digits)
   - Each archive contains BPS files named: `<sha1>.bps`

### Options

- `--checkrom`: Extract BPS files, apply to smw.sfc, verify SHA1, and get ROM size
- `--try-lmfilter`: Attempt to generate missing lmfilter data (requires --checkrom)
- `--try-levelread`: Attempt to generate missing levelread data (requires --checkrom)
- `--try-translevels`: Attempt to generate missing translevels data (requires --checkrom)
- `--update-ardrive`: Scan ArDrive and update metadata for 7z archives
- `--help, -h`: Display help message and exit

### Option Dependencies

- `--try-lmfilter`, `--try-levelread`, and `--try-translevels` all require `--checkrom`
- If any of these options are used without `--checkrom`, the script exits with an error

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────┐
│              process_index7zs.js                         │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────┐ │
│  │ 7z Scanner   │───▶│ BPS Extractor│───▶│ JSON     │ │
│  │              │    │              │    │ Merger   │ │
│  └──────────────┘    └──────────────┘    └──────────┘ │
│         │                    │                  │        │
│         ▼                    ▼                  ▼        │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────┐ │
│  │ Archive List │    │ File Search  │    │ Master   │ │
│  │              │    │              │    │ JSON     │ │
│  └──────────────┘    └──────────────┘    └──────────┘ │
│                                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Optional: ROM Verification & Metadata Generation │   │
│  │  - BPS Extraction                                 │   │
│  │  - flips Application                              │   │
│  │  - SHA1 Verification                              │   │
│  │  - Metadata Script Execution                      │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Archive Scanning**: Scan BPS Archives Folder for `.7z` files
2. **Content Listing**: For each archive, list contents to find `.bps` files
3. **SHA1 Extraction**: Extract SHA1 hash from BPS filename
4. **JSON Search**: Recursively search JSON File Tree for matching JSON files
5. **Data Loading**: Load and parse JSON files (handling malformed formats)
6. **Master JSON Creation/Update**: Create or update master JSON file
7. **Optional Verification**: If `--checkrom` is used, extract and verify BPS
8. **Optional Generation**: If `--try-*` options are used, generate missing metadata

---

## Input/Output

### Input Files

#### 7z Archives
- **Location**: BPS Archives Folder
- **Naming**: `bps_XX.7z` (where XX is 2 hex digits)
- **Contents**: BPS files named `<sha1>.bps`

#### JSON Metadata Files
- **Location**: JSON File Tree (searched recursively)
- **Patterns**:
  - `<sha1>.json` - Main metadata file
  - `<sha1>_levelread.json` - Level names data
  - `<sha1>_lmfilter.json` - Level filter list
  - `<sha1>_translevel.json` - Translevel data

### Output Files

#### Master JSON Files
- **Location**: BPS Index Folder
- **Naming**: `<sha1>.json`
- **Format**: Complete JSON object with consolidated metadata
- **Write Process**: Atomic (writes to `.temp` file, then renames)

#### Temporary Files (when using --checkrom)
- **Location**: `BPS Index Folder/temp/`
- **Files**:
  - Extracted BPS files
  - Generated ROM files (`source_unh.sfc`)
  - Generated metadata files (in `temp/output/`)

---

## Processing Flow

### Step-by-Step Process

1. **Initialization**
   - Validate input directories
   - Create BPS Index Folder if needed
   - Parse command-line options

2. **Archive Scanning**
   - List all `.7z` files in BPS Archives Folder
   - For each archive:
     - List contents using `7z l -slt`
     - Filter for `.bps` files
     - Extract SHA1 hash from filename

3. **BPS Processing**
   - For each BPS file found:
     - Check if already processed (skip duplicates)
     - Search for matching JSON files in JSON File Tree
     - Load existing master JSON if present
     - Process main JSON files
     - Process levelread JSON files
     - Process lmfilter JSON files
     - Process translevel JSON files
     - Update master JSON
     - Write master JSON to file

4. **Optional ROM Verification** (if `--checkrom`)
   - Extract BPS file from archive
   - Calculate BPS hashes (SHA1, SHA256)
   - Apply BPS patch using flips
   - Verify output ROM SHA1 matches expected
   - Get ROM size
   - Update master JSON with verification data

5. **Optional Metadata Generation** (if `--try-*` options)
   - Check if metadata is missing
   - Generate ROM if needed (from --checkrom step)
   - Run appropriate generation script:
     - `try_lmfilter.py` for lmfilter
     - `level_reader` for levelread
     - `findtranslevels/find_translevels.py` for translevels
   - Save output to `temp/output/` for manual review

---

## JSON File Formats

### Main JSON File (`<sha1>.json`)

Complete JSON document with metadata about the ROM and patch:

```json
{
  "sfcsource_filename": "example.sfc",
  "sfcarchive_filename": "example.7z",
  "sfc_rom_sha1_hash": "19f1c0e85ee834a1e3a84f81e682751758688d42",
  "smc_rom_sha1_hash": "...",
  "sfc_rom_sha256_hash": "...",
  "smc2_rom_sha1_hash": "...",
  "smc2_rom_sha256_hash": "...",
  "bps_filename": "19f1c0e85ee834a1e3a84f81e682751758688d42.bps",
  "bps_sha1_hash": "...",
  "bps_sha256_hash": "...",
  "sfc_rom_size": 1048576,
  "sfc_filename_title": "Example Hack",
  "sfc_filename_date": "2007-12-23",
  "sfc_upload_estimate": "1996-12-24T23:32:00.000Z",
  "sfc_parent_directory": "[Super Mario World Hacks] SMW-Unknown",
  ...
}
```

### Levelread JSON File (`<sha1>_levelread.json`)

Starts with `"levelnames" : {` and contains level name mappings:

```json
{
  "levelnames": {
    "001": "VANILLA SECRET 2",
    "002": "VANILLA SECRET 3",
    "106": "CUSTOM LEVEL NAME",
    ...
  }
}
```

### Lmfilter JSON File (`<sha1>_lmfilter.json`)

Single-line JSON dictionary entry with trailing comma (malformed):

```
    "levels": ["106", "161", "121", "008", "104", "036"], 
```

**Note**: The script normalizes this to a proper array of 3-character strings.

### Translevel JSON File (`<sha1>_translevel.json`)

Complete JSON document with translevel data:

```json
{
  "translevels": [
    {
      "level_id": "106",
      "destination": "161",
      ...
    },
    ...
  ]
}
```

---

## Master JSON Structure

### Complete Structure

```json
{
  "folder_categories": ["Kaizo", "Unknown"],
  "sfc_rom_sha1_hash": "19f1c0e85ee834a1e3a84f81e682751758688d42",
  "smc_rom_sha1_hash": "...",
  "sfc_rom_sha256_hash": "...",
  "smc2_rom_sha1_hash": "...",
  "smc2_rom_sha256_hash": "...",
  "bps_filename": "19f1c0e85ee834a1e3a84f81e682751758688d42.bps",
  "bps_sha1_hash": "...",
  "bps_sha256_hash": "...",
  "sfc_rom_size": 1048576,
  "sfcsource_filename": "example.sfc",
  "sfcarchive_filename": "example.7z",
  "sfc_filename_title": "Example",
  "sfc_filename_date": "2007-12-23",
  "7z_filename_title": "Example",
  "7z_filename_date": "2007-12-23",
  "sfc_upload_estimate": "1996-12-24T23:32:00.000Z",
  "dir_upload_estimate": "2025-12-15T17:16:02.606Z",
  "sfc_parent_directory": "[Super Mario World Hacks] SMW-Unknown",
  "7z_parent_directory": "[Super Mario World Hacks] SMW-Unknown",
  "7z_upload_estimate": "2025-11-23T10:23:01.000Z",
  "7z_content_filename": "ZZZ_UNK_G;Mario - Lost in Anti-World (Demo) [2007-12-23] (SMW Hack).sfc",
  "7z_content_timestamp": "1996-12-24 17:32:00",
  "7z_content_attr": "A",
  "index7z_name": "bps_19.7z",
  "indexbps_name": "19f1c0e85ee834a1e3a84f81e682751758688d42.bps",
  "index7z_ipfs_cidv1": "bafybeibkvwfopnx42tlhrj7qn7ihzr3byufsjkyclgv4gapwhximatrqiq",
  "index7z_ardrive_file_name": "bps_19.7z",
  "index7z_ardrive_file_path": "/bps7z/bps_19.7z",
  "index7z_ardrive_file_id": "abc123...",
  "index7z_ardrive_data_txid": "xyz789...",
  "index7z_ardrive_metadata_txid": "def456...",
  "index7z_ardrive_drive_id": "58677413-8a0c-4982-944d-4a1b40454039",
  "index7z_ardrive_folder_id": "1e42b095-4fbf-4411-bcc9-688917d5a5af",
  "sourcejson": [
    {
      "parent_folder": "[Super Mario World Hacks] SMW-Unknown",
      "json_file_sha256_hash": "abc123...",
      "sfcsource_filename": "example.sfc",
      "sfcarchive_filename": "example.7z",
      "sfc_filename_title": "Example",
      "sfc_filename_date": "2007-12-23",
      ...
    }
  ],
  "lmfilter": ["106", "161", "121", "008", "104", "036"],
  "levelnames": {
    "001": "VANILLA SECRET 2",
    "002": "VANILLA SECRET 3",
    ...
  },
  "translevel_data": {
    "translevels": [...]
  }
}
```

### Field Descriptions

#### Top-Level Fields

- **`folder_categories`**: Array of category names extracted from parent folders
- **`sfc_rom_sha1_hash`**: SHA1 hash of the unheadered ROM (from filename)
- **`smc_rom_sha1_hash`**: SHA1 hash of the headered ROM
- **`sfc_rom_sha256_hash`**: SHA256 hash of the unheadered ROM
- **`smc2_rom_sha1_hash`**: SHA1 hash of the re-headered ROM
- **`smc2_rom_sha256_hash`**: SHA256 hash of the re-headered ROM
- **`bps_filename`**: Name of the BPS patch file
- **`bps_sha1_hash`**: SHA1 hash of the BPS file (calculated if missing)
- **`bps_sha256_hash`**: SHA256 hash of the BPS file (calculated if missing)
- **`sfc_rom_size`**: Size of the unheadered ROM in bytes (from --checkrom)
- **`sfcsource_filename`**: Original SFC filename
- **`sfcarchive_filename`**: Original 7z archive filename
- **`sfc_filename_*`**: Metadata extracted from SFC filename
- **`7z_filename_*`**: Metadata extracted from 7z filename
- **`sfc_upload_estimate`**: Timestamp from SFC file modification time
- **`dir_upload_estimate`**: Timestamp from directory modification time
- **`sfc_parent_directory`**: Parent directory name of SFC file
- **`7z_parent_directory`**: Parent directory name of 7z file
- **`7z_upload_estimate`**: Timestamp from 7z file modification time
- **`7z_content_*`**: Metadata from 7z archive contents

#### Index Attributes

- **`index7z_name`**: Name of the 7z archive file containing this BPS (e.g., "bps_19.7z")
- **`indexbps_name`**: Filename of the BPS file within the 7z archive
- **`index7z_ipfs_cidv1`**: IPFS CID v1 hash of the 7z archive file (calculated automatically)
- **`index7z_ardrive_file_name`**: ArDrive filename (set with --update-ardrive)
- **`index7z_ardrive_file_path`**: ArDrive file path (set with --update-ardrive)
- **`index7z_ardrive_file_id`**: ArDrive file entity ID (set with --update-ardrive)
- **`index7z_ardrive_data_txid`**: ArDrive data transaction ID (set with --update-ardrive)
- **`index7z_ardrive_metadata_txid`**: ArDrive metadata transaction ID (set with --update-ardrive)
- **`index7z_ardrive_drive_id`**: ArDrive drive ID (set with --update-ardrive)
- **`index7z_ardrive_folder_id`**: ArDrive folder ID (set with --update-ardrive)

#### Source JSON Array

- **`sourcejson`**: Array of source JSON file entries
  - **`parent_folder`**: Name of the directory containing the JSON file
  - **`json_file_sha256_hash`**: SHA256 hash of the JSON file (for duplicate detection)
  - **All other fields**: Copied from the source JSON file

#### Metadata Fields

- **`lmfilter`**: Array of 3-character level codes (normalized)
- **`levelnames`**: Object mapping level IDs to level names
- **`translevel_data`**: Complete translevel data object

---

## Command-Line Options

### --checkrom

**Purpose**: Verify BPS patches by applying them to the base ROM

**Process**:
1. Extract BPS file from 7z archive
2. Calculate BPS file hashes (SHA1, SHA256) if missing
3. Apply BPS patch to `/home/me/smwdb/smw.sfc` using flips
4. Verify output ROM SHA1 matches the expected hash (from filename)
5. Get ROM size and add to master JSON

**Requirements**:
- `flips` utility in PATH
- `/home/me/smwdb/smw.sfc` must exist
- `7z` utility in PATH

**Output**:
- Updates master JSON with `bps_sha1_hash`, `bps_sha256_hash`, `sfc_rom_size`
- Creates temporary files in `BPS Index Folder/temp/`

### --try-lmfilter

**Purpose**: Generate missing lmfilter data

**Process**:
1. Check if `lmfilter` field is missing in master JSON
2. If missing and `--checkrom` was used:
   - Run `try_lmfilter.py` with environment variables:
     - `GAMETAG=<sha1>`
     - `GAMEVER=1`
     - `ROMFILE=<temp_rom_path>`
   - Copy output from `temp/temp.json` to `temp/output/<sha1>_lmfilter.json`
   - Do NOT add to master JSON (for manual review)

**Requirements**:
- `--checkrom` must be used
- `try_lmfilter.py` must be in current working directory
- Python 3 must be available

**Output**:
- Creates `temp/output/<sha1>_lmfilter.json` for manual review

### --try-levelread

**Purpose**: Generate missing levelread data

**Process**:
1. Check if `levelnames` field is missing in master JSON
2. If missing and `--checkrom` was used:
   - Run `level_reader` binary with ROM file path
   - Save output to `temp/output/<sha1>_levelread.json`
   - Do NOT add to master JSON (for manual review)

**Requirements**:
- `--checkrom` must be used
- `level_reader` binary must be at `~/smwdb/level_reader`
- Binary must be executable

**Output**:
- Creates `temp/output/<sha1>_levelread.json` for manual review

### --try-translevels

**Purpose**: Generate missing translevel data

**Process**:
1. Check if `translevel_data` field is missing in master JSON
2. If missing and `--checkrom` was used:
   - Run `findtranslevels/find_translevels.py` with:
     - `--romfile=<temp_rom_path>`
     - `--output=<output_path>`
   - Save output to `temp/output/<sha1>_translevel.json`
   - Do NOT add to master JSON (for manual review)

**Requirements**:
- `--checkrom` must be used
- `findtranslevels/find_translevels.py` must be in current working directory
- Python 3 must be available

**Output**:
- Creates `temp/output/<sha1>_translevel.json` for manual review

### --update-ardrive

**Purpose**: Scan ArDrive and update metadata for 7z archives

**Process**:
1. Connect to ArDrive using anonymous client
2. List all files in the configured ArDrive folder
3. For each 7z archive found:
   - Match by filename (`index7z_name`)
   - Update master JSON with ArDrive metadata:
     - `index7z_ardrive_file_name`
     - `index7z_ardrive_file_path`
     - `index7z_ardrive_file_id`
     - `index7z_ardrive_data_txid`
     - `index7z_ardrive_metadata_txid`
     - `index7z_ardrive_drive_id`
     - `index7z_ardrive_folder_id`

**Requirements**:
- `ardrive-core-js` package must be installed
- `arweave` package must be installed
- Network access to ArDrive (arweave.net)
- ArDrive folder must be publicly accessible

**Configuration**:
- Default Drive ID: `58677413-8a0c-4982-944d-4a1b40454039`
- Default Folder ID: `1e42b095-4fbf-4411-bcc9-688917d5a5af`

**Output**:
- Updates master JSON files with ArDrive metadata
- Logs which files were found/updated

---

## Error Handling

### File Access Errors

- **Missing directories**: Script creates BPS Index Folder if missing
- **Unreadable directories**: Skipped with warning message
- **Missing files**: Skipped with warning message

### JSON Parsing Errors

- **Malformed JSON**: Script attempts to fix common issues:
  - Single-line files with trailing commas
  - Incomplete JSON objects
  - Missing closing braces
- **Unfixable JSON**: File is skipped with warning

### Archive Errors

- **Invalid 7z files**: Skipped with warning
- **Extraction failures**: Error logged, processing continues
- **Missing BPS files**: Skipped with warning

### Verification Errors

- **flips failures**: Error logged, master JSON not updated with verification data
- **SHA1 mismatches**: Error thrown, processing stops for that BPS file
- **Missing base ROM**: Error thrown, script exits

### Generation Errors

- **Script failures**: Error logged, processing continues
- **Missing scripts**: Error logged, processing continues
- **Timeout errors**: Scripts are killed after 20 seconds

---

## Implementation Details

### 7z Archive Listing

Uses `7z l -slt` command to get detailed file listing:

```bash
7z l -slt "archive.7z"
```

Parses output to extract:
- File paths
- File types
- File sizes

### BPS File Extraction

Uses `7z x` command to extract files:

```bash
7z x -y -o"output_dir" "archive.7z" "file_path"
```

Handles subdirectories by searching for extracted files recursively.

### JSON File Search

Recursively searches directory tree:

```javascript
async function findFilesRecursive(dir, pattern) {
  // Searches all subdirectories
  // Skips symbolic links
  // Returns array of matching file paths
}
```

### JSON Merging Logic

1. **First JSON as Base**: First main JSON file found becomes the base for master JSON
2. **Field Preservation**: Existing fields in master JSON are preserved (not overwritten)
3. **Deep Merging**: Objects are merged recursively
4. **Array Merging**: Arrays are merged with duplicate removal
5. **Source Tracking**: All source JSON files are tracked in `sourcejson` array

### Atomic File Writes

1. Write master JSON to `<sha1>.json.temp`
2. Verify write succeeded
3. Rename `<sha1>.json.temp` to `<sha1>.json`
4. If rename fails, temp file remains (can be cleaned up manually)

### Category Extraction

Extracts category from folder names:

- Pattern: `[Category Name] SMW-Subcategory`
- Extracts: `Subcategory` or `Category Name`
- Falls back to folder name if pattern doesn't match

---

## Examples

### Example 1: Basic Indexing

```bash
enode.sh process_index7zs.js \
  ~/rhplay/refmaterial/arcsfc1 \
  ~/rhplay/refmaterial/index7z \
  ~/rhplay/refmaterial/bps7z/
```

**What it does**:
- Scans `~/rhplay/refmaterial/bps7z/` for 7z archives
- Lists contents of each archive
- Searches `~/rhplay/refmaterial/arcsfc1` for JSON files
- Creates/updates master JSON files in `~/rhplay/refmaterial/index7z`

### Example 2: With ROM Verification

```bash
enode.sh process_index7zs.js \
  ~/rhplay/refmaterial/arcsfc1 \
  ~/rhplay/refmaterial/index7z \
  ~/rhplay/refmaterial/bps7z/ \
  --checkrom
```

**What it does**:
- Same as Example 1, plus:
- Extracts BPS files from archives
- Applies patches to `smw.sfc`
- Verifies SHA1 hashes match
- Calculates ROM sizes
- Updates master JSON with verification data

### Example 3: Generate Missing Metadata

```bash
enode.sh process_index7zs.js \
  ~/rhplay/refmaterial/arcsfc1 \
  ~/rhplay/refmaterial/index7z \
  ~/rhplay/refmaterial/bps7z/ \
  --checkrom \
  --try-lmfilter \
  --try-levelread \
  --try-translevels
```

**What it does**:
- Same as Example 2, plus:
- For each BPS file missing metadata:
  - Generates lmfilter data (if missing)
  - Generates levelread data (if missing)
  - Generates translevel data (if missing)
- Saves generated files to `temp/output/` for manual review

### Example 4: Update ArDrive Metadata

```bash
enode.sh process_index7zs.js \
  ~/rhplay/refmaterial/arcsfc1 \
  ~/rhplay/refmaterial/index7z \
  ~/rhplay/refmaterial/bps7z/ \
  --update-ardrive
```

**What it does**:
- Scans ArDrive folder for 7z archive files
- Matches archives by filename
- Updates master JSON files with ArDrive metadata:
  - File IDs, transaction IDs
  - File paths and names
  - Drive and folder IDs
- Also calculates IPFS CID v1 for each archive

### Example 4: Processing Specific Archive

If you want to process only specific archives, you can:

1. Move desired archives to a temporary folder
2. Run the script on that folder
3. Move results back

```bash
# Create temp folder
mkdir -p ~/temp_bps_archives

# Copy specific archives
cp ~/rhplay/refmaterial/bps7z/bps_19.7z ~/temp_bps_archives/

# Run script
enode.sh process_index7zs.js \
  ~/rhplay/refmaterial/arcsfc1 \
  ~/rhplay/refmaterial/index7z \
  ~/temp_bps_archives/

# Cleanup
rm -rf ~/temp_bps_archives
```

---

## Troubleshooting

### Common Issues

#### Issue: "Directory not accessible"
**Solution**: Check directory permissions and paths

#### Issue: "flips failed" (with --checkrom)
**Solution**: 
- Verify `flips` is in PATH
- Check that base ROM exists at `/home/me/smwdb/smw.sfc`
- Verify BPS file is valid

#### Issue: "SHA1 mismatch" (with --checkrom)
**Solution**: 
- BPS file may be corrupted
- Base ROM may be wrong version
- Check BPS file manually

#### Issue: "Failed to extract from 7z"
**Solution**:
- Verify 7z archive is not corrupted
- Check that `7z` utility is installed
- Verify file permissions

#### Issue: Generated metadata files are empty
**Solution**:
- Check that generation scripts are in correct location
- Verify Python 3 is available
- Check script output for errors
- Review generated files in `temp/output/`

### Debugging Tips

1. **Check temp directory**: Look in `BPS Index Folder/temp/` for extracted files
2. **Review console output**: Script prints detailed progress messages
3. **Inspect master JSON**: Check if fields are being merged correctly
4. **Verify file paths**: Ensure all paths are absolute or correctly relative
5. **Check file permissions**: Ensure script has read/write access

---

## Related Documentation

- `docs/PROGRAMS.MD` - Program listing and quick reference
- `docs/PROCESS_ARCSFC.md` - Related script for processing ROM files
- `jstools/process_arcsfc.js` - Source code for ROM processing

---

## Version History

### Version 1.0 (December 2025)
- Initial release
- Basic indexing functionality
- ROM verification support
- Metadata generation support
- Comprehensive error handling

---

*Last Updated: December 2025*
