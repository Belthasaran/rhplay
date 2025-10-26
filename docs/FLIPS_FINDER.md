# Flips Finder Library

**File:** `lib/flips-finder.js`  
**Date:** October 12, 2025

## Overview

The Flips Finder library provides robust logic for locating the `flips` binary across multiple platforms and installation methods. It checks multiple locations in a specific order and provides helpful error messages when the binary cannot be found.

## Features

- ✅ Cross-platform support (Windows, Linux, macOS)
- ✅ Multiple search locations (6 different methods)
- ✅ Database configuration support
- ✅ Environment variable support
- ✅ Automatic validation of found binaries
- ✅ Helpful error messages with setup instructions

## Search Order

The library searches for the flips binary in the following order:

1. **Database Setting** - `electron/clientdata.db` → `csettings` table
   - Checks for: `flips_path`, `flips_bin_path`, `FLIPS_PATH`, `FLIPS_BIN_PATH`

2. **Environment Variable** - `FLIPS_BIN_PATH`
   - Example: `export FLIPS_BIN_PATH=/usr/local/bin/flips`

3. **Current Working Directory**
   - Checks: `./flips` or `./flips.exe` (Windows)

4. **Project Root Directory**
   - Checks: `<project_root>/flips` or `<project_root>/flips.exe`

5. **Common Installation Directories**
   - **Linux/macOS:**
     - `/usr/local/bin/flips`
     - `/usr/bin/flips`
     - `/opt/flips/flips`
     - `/opt/local/bin/flips`
     - `~/bin/flips`
     - `~/.local/bin/flips`
     - `/snap/bin/flips`
   
   - **Windows:**
     - `C:\Program Files\Flips\flips.exe`
     - `C:\Program Files (x86)\Flips\flips.exe`
     - `%LOCALAPPDATA%\Flips\flips.exe`
     - `%APPDATA%\Flips\flips.exe`
     - `C:\flips\flips.exe`
     - `C:\tools\flips.exe`

6. **System PATH**
   - Uses `which flips` (Unix) or `where flips.exe` (Windows)

## Usage

### In Scripts

```javascript
const { getFlipsPath, findFlips } = require('./lib/flips-finder');

// Method 1: Get path or throw error (recommended for required use)
try {
  const flipsPath = getFlipsPath({ projectRoot: __dirname });
  console.log('Found flips:', flipsPath);
  // Use flipsPath in commands...
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// Method 2: Find path without throwing (for optional use)
const flipsPath = findFlips({ projectRoot: __dirname });
if (flipsPath) {
  console.log('Found flips:', flipsPath);
} else {
  console.log('Flips not found, skipping patch operations');
}
```

### Configuration Options

```javascript
const { FlipsFinder } = require('./lib/flips-finder');

const finder = new FlipsFinder({
  projectRoot: '/path/to/project',  // Default: process.cwd()
  clientDbPath: '/path/to/clientdata.db'  // Default: <projectRoot>/electron/clientdata.db
});

const flipsPath = finder.findFlips();
```

## Setting Up Flips Path

### Option 1: Database Setting (Recommended)

```bash
# Connect to clientdata.db
sqlite3 electron/clientdata.db

# Add flips path setting
INSERT INTO csettings (csettinguid, csetting_name, csetting_value) 
VALUES (lower(hex(randomblob(16))), 'flips_path', '/usr/local/bin/flips');
```

### Option 2: Environment Variable

```bash
# Linux/macOS (add to ~/.bashrc or ~/.zshrc)
export FLIPS_BIN_PATH=/usr/local/bin/flips

# Windows (PowerShell)
$env:FLIPS_BIN_PATH = "C:\flips\flips.exe"

# Windows (Command Prompt)
set FLIPS_BIN_PATH=C:\flips\flips.exe
```

### Option 3: System PATH

```bash
# Linux/macOS
sudo cp flips /usr/local/bin/
sudo chmod +x /usr/local/bin/flips

# Windows - Add flips directory to PATH via System Properties
```

### Option 4: Project Directory

```bash
# Simply place flips/flips.exe in project root
cp flips /path/to/rhtools/flips
chmod +x /path/to/rhtools/flips
```

## Validation

The finder validates that:

1. File exists
2. File is a regular file (not a directory)
3. File is executable (Unix/Linux)
4. File responds to `--version` or `--help` flags

## Error Messages

When flips is not found, the library provides a comprehensive error message:

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
  • Download Flips from: https://github.com/Alcaro/Flips
  • Place flips in the project root directory, OR
  • Install to system: sudo cp flips /usr/local/bin/
  • Add to PATH, OR
  • Set FLIPS_BIN_PATH environment variable, OR
  • Add to database: INSERT INTO csettings ...
```

## Integration with Scripts

### updategames.js

The main update script automatically uses the flips-finder during initialization:

```javascript
const { getFlipsPath } = require('./lib/flips-finder');

// In verifyPrerequisites():
CONFIG.FLIPS_PATH = getFlipsPath({ projectRoot: __dirname });
```

### Other Scripts

Any script that needs flips can use the same pattern:

```javascript
const { getFlipsPath } = require('./lib/flips-finder');
const { execSync } = require('child_process');

const flipsPath = getFlipsPath();
const command = `"${flipsPath}" --apply patch.bps base.sfc output.sfc`;
execSync(command);
```

## Testing

To test if your flips installation can be found:

```bash
node -e "console.log(require('./lib/flips-finder').getFlipsPath())"
```

Or create a test script:

```javascript
const { getFlipsPath } = require('./lib/flips-finder');

try {
  console.log('Flips found at:', getFlipsPath());
} catch (error) {
  console.error('Error:', error.message);
}
```

## Troubleshooting

### "Flips utility not found"

1. Download flips from https://github.com/Alcaro/Flips
2. Choose one of the setup methods above
3. Run the test command to verify

### "Binary validation failed"

1. Ensure the file is executable: `chmod +x /path/to/flips`
2. Try running manually: `/path/to/flips --version`
3. Verify it's the correct binary (not a script or shortcut)

### Database setting not working

1. Verify clientdata.db exists: `ls -lh electron/clientdata.db`
2. Check the table exists: `sqlite3 electron/clientdata.db ".tables"`
3. Verify the setting: `sqlite3 electron/clientdata.db "SELECT * FROM csettings WHERE csetting_name LIKE '%flips%'"`

## API Reference

### `getFlipsPath(options)`

Returns path to flips binary or throws error if not found.

**Parameters:**
- `options.projectRoot` (string, optional) - Project root directory
- `options.clientDbPath` (string, optional) - Path to clientdata.db

**Returns:** `string` - Absolute path to flips binary

**Throws:** `Error` - If flips not found (includes helpful message)

### `findFlips(options)`

Returns path to flips binary or null if not found (non-throwing version).

**Parameters:** Same as `getFlipsPath()`

**Returns:** `string | null` - Absolute path or null

### `FlipsFinder` Class

**Constructor:**
```javascript
new FlipsFinder({ projectRoot, clientDbPath })
```

**Methods:**
- `findFlips()` - Find flips binary, returns path or null
- `getFlipsPathOrThrow()` - Find flips binary, returns path or throws error
- `validateFlipsBinary(path)` - Validate that a path is a valid flips binary
- `generateErrorMessage()` - Generate helpful error message

## Version History

- **2025-10-12** - Initial implementation
  - Cross-platform support
  - Multiple search locations
  - Database and environment variable support
  - Comprehensive validation and error messages

