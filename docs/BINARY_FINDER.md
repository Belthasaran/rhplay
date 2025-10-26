## Binary Finder Library

**File:** `lib/binary-finder.js`  
**Date:** October 12, 2025

## Overview

The Binary Finder library provides robust, cross-platform logic for locating required binaries (`flips`, `asar`) and files (`smw.sfc`) across multiple platforms and installation methods. It checks multiple locations in a specific order and provides helpful error messages when resources cannot be found.

## Features

- ✅ Finds **flips**, **asar** binaries, and **smw.sfc** ROM
- ✅ Cross-platform support (Windows, Linux, macOS)
- ✅ Multiple search locations (up to 7 different methods)
- ✅ Database configuration support
- ✅ Environment variable support
- ✅ **SHA224 validation for smw.sfc ROM**
- ✅ Error callbacks for validation failures
- ✅ Automatic validation of found binaries
- ✅ Helpful error messages with setup instructions

## Supported Resources

### 1. Flips Binary (`flips` / `flips.exe`)

The Floating IPS patcher utility for applying BPS/IPS patches.

- **Environment Variable:** `FLIPS_BIN_PATH`
- **Database Setting:** `flips_path` in csettings table
- **Download:** https://github.com/Alcaro/Flips

### 2. Asar Binary (`asar` / `asar.exe`)

The Super NES assembler used for patching ROM hacks.

- **Environment Variable:** `ASAR_BIN_PATH`
- **Database Setting:** `asar_path` in csettings table
- **Download:** https://github.com/RPGHacker/asar

### 3. SMW ROM (`smw.sfc`)

Super Mario World base ROM file (must match expected SHA224 hash).

- **Environment Variable:** `SMW_SFC_PATH`
- **Database Setting:** `sfc_path` in csettings table
- **Required SHA224:** `fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08`

## Search Order

### For Binaries (flips, asar)

1. **Database Setting** - `electron/clientdata.db` → `csettings` table
2. **Environment Variable** - `FLIPS_BIN_PATH` or `ASAR_BIN_PATH`
3. **Current Working Directory**
4. **Project Root Directory**
5. **Tool-Specific Directories** (asar only)
   - `bin/asar`
   - `/mnt/c/snesgaming/bin/asar`
   - `/usr/local/bin/asar`
6. **Common Installation Directories** (platform-specific)
7. **System PATH**

### For SMW ROM (smw.sfc)

1. **Database Setting** - `electron/clientdata.db` → `csettings.sfc_path`
2. **Environment Variable** - `SMW_SFC_PATH`
3. **Current Working Directory**
4. **Project Root Directory**
5. **ROM Subdirectories** - `rom/` and `roms/`

## Usage

### Finding Binaries

```javascript
const { getFlipsPath, getAsarPath, findFlips, findAsar } = require('./lib/binary-finder');

// Method 1: Get path or throw error (recommended for required use)
try {
  const flipsPath = getFlipsPath({ projectRoot: __dirname });
  const asarPath = getAsarPath({ projectRoot: __dirname });
  
  console.log('Flips:', flipsPath);
  console.log('Asar:', asarPath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// Method 2: Find path without throwing (for optional use)
const flipsPath = findFlips({ projectRoot: __dirname });
if (flipsPath) {
  console.log('Found flips:', flipsPath);
} else {
  console.log('Flips not available, skipping');
}
```

### Finding SMW ROM with Validation

```javascript
const { getSmwRomPath, validateSmwRom } = require('./lib/binary-finder');

// Method 1: Get path or throw on error
try {
  const romPath = getSmwRomPath({ 
    projectRoot: __dirname,
    throwOnError: true 
  });
  console.log('ROM found:', romPath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// Method 2: Get path, returns null on error (logs to stderr)
const romPath = getSmwRomPath({ 
  projectRoot: __dirname,
  throwOnError: false 
});

if (romPath) {
  console.log('ROM found:', romPath);
} else {
  console.log('ROM not found or invalid');
}

// Method 3: Validate an existing ROM path
const validation = validateSmwRom('/path/to/smw.sfc');
if (validation.valid) {
  console.log('Valid ROM, SHA224:', validation.hash);
} else {
  console.log('Invalid ROM');
  console.log('Expected:', validation.expected);
  console.log('Actual:', validation.hash);
}
```

### Using Error Callbacks

```javascript
const { BinaryFinder } = require('./lib/binary-finder');

const finder = new BinaryFinder({
  projectRoot: __dirname,
  errorCallback: (error, info) => {
    console.error('ROM Validation Error:', error);
    console.error('File:', info.path);
    console.error('Hash:', info.hash);
    
    // Could send to logging service, show UI notification, etc.
  }
});

const romPath = finder.findSmwRom();
```

### Advanced Usage

```javascript
const { BinaryFinder } = require('./lib/binary-finder');

const finder = new BinaryFinder({
  projectRoot: '/path/to/project',
  clientDbPath: '/path/to/clientdata.db',
  errorCallback: (error, info) => {
    // Handle validation errors
  }
});

// Find all resources
const flipsPath = finder.findFlips();
const asarPath = finder.findAsar();
const romPath = finder.findSmwRom();

// Get last error (useful for ROM validation failures)
const lastError = finder.getLastError();
if (lastError) {
  console.error('Last error:', lastError);
}

// Validate binaries explicitly
if (flipsPath && !finder.validateBinary(flipsPath, 'flips')) {
  console.error('Flips binary failed validation');
}
```

## Configuration Options

```javascript
const finder = new BinaryFinder({
  projectRoot: '/path/to/project',       // Default: process.cwd()
  clientDbPath: '/path/to/clientdata.db', // Default: <projectRoot>/electron/clientdata.db
  errorCallback: (error, info) => { }     // Optional: Called on validation errors
});
```

## Setting Up Resource Paths

### Option 1: Database Setting (Recommended)

```bash
# Connect to clientdata.db
sqlite3 electron/clientdata.db

# Add flips path
INSERT INTO csettings (csettinguid, csetting_name, csetting_value) 
VALUES (lower(hex(randomblob(16))), 'flips_path', '/usr/local/bin/flips');

# Add asar path
INSERT INTO csettings (csettinguid, csetting_name, csetting_value) 
VALUES (lower(hex(randomblob(16))), 'asar_path', '/usr/local/bin/asar');

# Add SMW ROM path
INSERT INTO csettings (csettinguid, csetting_name, csetting_value) 
VALUES (lower(hex(randomblob(16))), 'sfc_path', '/home/user/smw.sfc');
```

### Option 2: Environment Variables

```bash
# Linux/macOS (add to ~/.bashrc or ~/.zshrc)
export FLIPS_BIN_PATH=/usr/local/bin/flips
export ASAR_BIN_PATH=/usr/local/bin/asar
export SMW_SFC_PATH=/home/user/roms/smw.sfc

# Windows (PowerShell)
$env:FLIPS_BIN_PATH = "C:\tools\flips.exe"
$env:ASAR_BIN_PATH = "C:\tools\asar.exe"
$env:SMW_SFC_PATH = "C:\roms\smw.sfc"
```

### Option 3: System Installation

```bash
# Linux/macOS - Install binaries to /usr/local/bin
sudo cp flips /usr/local/bin/
sudo cp asar /usr/local/bin/
sudo chmod +x /usr/local/bin/flips
sudo chmod +x /usr/local/bin/asar

# Place ROM in project directory
cp smw.sfc /path/to/rhtools/smw.sfc
```

### Option 4: Project Directory

```bash
# Simply place files in project root
cp flips /path/to/rhtools/
cp asar /path/to/rhtools/
cp smw.sfc /path/to/rhtools/
chmod +x /path/to/rhtools/flips
chmod +x /path/to/rhtools/asar
```

## SMW ROM Validation

The library automatically validates `smw.sfc` files using SHA224 hash:

### Validation Behavior

1. **File Found → Hash Matches:** Returns file path
2. **File Found → Hash Mismatch:** 
   - Logs error to `stderr`
   - Calls error callback (if provided)
   - Continues searching other locations
   - Returns `null` if no valid ROM found
3. **File Not Found:** Returns `null`

### Hash Mismatch Example

```
✗ SMW ROM found at /home/user/smw.sfc but SHA224 hash mismatch:
  Expected: fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08
  Actual:   1234567890abcdef1234567890abcdef1234567890abcdef12345678
```

### Error Handling

```javascript
const { BinaryFinder } = require('./lib/binary-finder');

const finder = new BinaryFinder({
  projectRoot: __dirname,
  errorCallback: (errorMessage, details) => {
    // errorMessage: String describing the error
    // details: { path, hash, expected, size }
    
    console.error('ROM validation failed:');
    console.error('  Path:', details.path);
    console.error('  Expected SHA224:', details.expected);
    console.error('  Actual SHA224:', details.hash);
  }
});

const romPath = finder.findSmwRom();
if (!romPath) {
  console.error('Could not find valid SMW ROM');
  const lastError = finder.getLastError();
  if (lastError) {
    console.error(lastError);
  }
}
```

## Platform-Specific Paths

### Windows

**Binaries:**
- `C:\Program Files\Flips\flips.exe`
- `C:\Program Files (x86)\Asar\asar.exe`
- `%LOCALAPPDATA%\Flips\flips.exe`
- `C:\tools\flips.exe`

**ROM:**
- Current directory
- Project root
- `rom\smw.sfc`

### Linux/macOS

**Binaries:**
- `/usr/local/bin/flips`
- `/usr/bin/asar`
- `/opt/flips/flips`
- `~/bin/asar`
- `~/.local/bin/flips`

**Asar-specific (from pb_lvlrand.py):**
- `bin/asar`
- `/mnt/c/snesgaming/bin/asar` (WSL)

**ROM:**
- Current directory
- Project root
- `rom/smw.sfc`
- `roms/smw.sfc`

## API Reference

### `getFlipsPath(options)`

Returns path to flips binary or throws error if not found.

**Parameters:**
- `options.projectRoot` (string, optional) - Project root directory

**Returns:** `string` - Absolute path to flips binary

**Throws:** `Error` - If flips not found

### `findFlips(options)`

Returns path to flips binary or null if not found (non-throwing).

**Returns:** `string | null`

### `getAsarPath(options)`

Returns path to asar binary or throws error if not found.

**Parameters:**
- `options.projectRoot` (string, optional) - Project root directory

**Returns:** `string` - Absolute path to asar binary

**Throws:** `Error` - If asar not found

### `findAsar(options)`

Returns path to asar binary or null if not found (non-throwing).

**Returns:** `string | null`

### `getSmwRomPath(options)`

Returns path to SMW ROM or null/throws if not found or invalid.

**Parameters:**
- `options.projectRoot` (string, optional) - Project root directory
- `options.throwOnError` (boolean, optional) - Throw on error vs return null (default: false)
- `options.errorCallback` (function, optional) - Called on validation errors

**Returns:** `string | null` - Path to valid ROM or null

**Throws:** `Error` - If throwOnError is true and ROM not found/invalid

### `findSmwRom(options)`

Returns path to SMW ROM or null if not found (non-throwing, logs errors).

**Returns:** `string | null`

### `validateSmwRom(romPath, options)`

Validates a ROM file's SHA224 hash.

**Parameters:**
- `romPath` (string) - Path to ROM file

**Returns:** Object with:
```javascript
{
  valid: boolean,        // true if hash matches
  hash: string,          // Actual SHA224 hash
  expected: string,      // Expected SHA224 hash
  size: number,          // File size in bytes
  error: string          // Error message if validation failed
}
```

### `BinaryFinder` Class

**Constructor:**
```javascript
new BinaryFinder({ 
  projectRoot, 
  clientDbPath,
  errorCallback 
})
```

**Methods:**
- `findFlips()` - Find flips binary
- `findAsar()` - Find asar binary
- `findSmwRom()` - Find SMW ROM with validation
- `getFlipsPathOrThrow()` - Get flips or throw
- `getAsarPathOrThrow()` - Get asar or throw
- `getSmwRomPath(throwOnError)` - Get ROM path
- `validateSmwRom(path)` - Validate ROM hash
- `validateBinary(path, name)` - Validate binary executable
- `getLastError()` - Get last validation error message

## Error Messages

### Flips Not Found

```
Flips utility not found.

Flips was searched for in the following locations:
  1. Database setting (electron/clientdata.db → csettings table)
  2. Environment variable: FLIPS_BIN_PATH
  3. Current working directory
  4. Project root directory
  5. Common installation directories
  6. System PATH

To fix this issue:
  • Place flips in the project root directory, OR
  • Install to system: sudo cp flips /usr/local/bin/
  • Set FLIPS_BIN_PATH environment variable, OR
  • Add to database: INSERT INTO csettings ...

Download Flips from: https://github.com/Alcaro/Flips
```

### SMW ROM Not Found or Invalid

```
SMW ROM file (smw.sfc) not found or invalid.

Issue encountered:
  SMW ROM found at /path/to/smw.sfc but SHA224 hash mismatch:
  Expected: fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08
  Actual:   1234567890abcdef...

smw.sfc was searched for in the following locations:
  1. Database setting (electron/clientdata.db → csettings.sfc_path)
  2. Environment variable: SMW_SFC_PATH
  3. Current working directory
  4. Project root directory
  5. rom/ and roms/ subdirectories

Requirements:
  • File must be a valid Super Mario World ROM
  • SHA224 hash must be: fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08

To fix this issue:
  • Obtain a legally owned SMW ROM file
  • Place smw.sfc in the project root directory, OR
  • Set SMW_SFC_PATH environment variable, OR
  • Add to database: INSERT INTO csettings ...
```

## Testing

To test resource finding:

```bash
# Test flips
node -e "console.log(require('./lib/binary-finder').getFlipsPath())"

# Test asar
node -e "console.log(require('./lib/binary-finder').getAsarPath())"

# Test SMW ROM
node -e "console.log(require('./lib/binary-finder').getSmwRomPath())"

# Test ROM validation
node -e "console.log(JSON.stringify(require('./lib/binary-finder').validateSmwRom('smw.sfc'), null, 2))"
```

## Backwards Compatibility

The original `flips-finder.js` module is maintained for backwards compatibility and re-exports from `binary-finder.js`:

```javascript
// Old code still works
const { getFlipsPath } = require('./lib/flips-finder');

// New code should use binary-finder
const { getFlipsPath, getAsarPath, getSmwRomPath } = require('./lib/binary-finder');
```

## Version History

- **2025-10-12** - Initial implementation
  - Support for flips, asar, and smw.sfc
  - Cross-platform support
  - Multiple search locations
  - SHA224 validation for ROM files
  - Error callbacks and comprehensive error messages
  - Backwards compatibility with flips-finder.js

