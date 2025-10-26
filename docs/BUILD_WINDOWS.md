# Building RHTools for Windows

This guide explains how to create a portable Windows executable of RHTools that can run on Windows 10 and Windows 11 without installation.

## Overview

RHTools uses **electron-builder** to create cross-platform builds. You can build Windows executables directly from Linux without needing a separate Windows machine or build directory.

## Prerequisites

- Node.js (v18+ recommended)
- npm
- Internet connection (for downloading Windows build tools)

## Build Types

### Portable Executable (Recommended)
A single `.exe` file that runs without installation and doesn't modify the Windows registry.

### NSIS Installer
Traditional Windows installer with installation wizard.

## Building from Linux

### 1. Build Windows Portable Executable

```bash
npm run build:win
```

This will:
1. Build the Vue renderer with Vite
2. Package the Electron app with all dependencies
3. Create a portable Windows executable in `dist-builds/`

**Output:** `dist-builds/RHTools-1.0.0-portable.exe`

### 2. Build Both Portable and Installer

```bash
npm run build:win-all
```

**Output:**
- `dist-builds/RHTools-1.0.0-portable.exe` (portable)
- `dist-builds/RHTools-1.0.0-setup.exe` (installer)

### 3. Build Linux AppImage (Optional)

```bash
npm run build:linux
```

**Output:** `dist-builds/RHTools-1.0.0.AppImage`

## Native Dependencies

RHTools uses native Node.js modules that require compilation:
- `better-sqlite3` - Database operations
- `lzma-native` - Compression

electron-builder automatically:
- Downloads Windows build tools
- Rebuilds native modules for Windows
- Bundles everything into the portable executable

## Build Output

All builds are created in the `dist-builds/` directory:

```
dist-builds/
├── RHTools-1.0.0-portable.exe      # Portable Windows executable
├── RHTools-1.0.0-setup.exe         # Windows installer (if using build:win-all)
└── win-unpacked/                   # Unpacked Windows app (for debugging)
```

## Portable Executable Features

The portable executable:
- ✅ Runs on Windows 10 and Windows 11
- ✅ No installation required
- ✅ No admin privileges needed
- ✅ No registry modifications
- ✅ Can run from USB drive, Downloads folder, etc.
- ✅ All dependencies bundled
- ✅ Database files stored in app directory

## Testing on Windows

To test the portable executable:

1. Transfer `RHTools-1.0.0-portable.exe` to a Windows machine
2. Double-click to run
3. Windows Defender may show a warning (see Troubleshooting)

## Troubleshooting

### Windows Defender SmartScreen Warning

When running unsigned executables, Windows may show:
> "Windows protected your PC"

**To run anyway:**
1. Click "More info"
2. Click "Run anyway"

**To avoid this:** Sign the executable with a code signing certificate (requires purchasing a certificate).

### Build Fails on Linux

**Missing dependencies:**
```bash
# Install required build tools
sudo apt-get install -y build-essential
```

**Wine not needed:** electron-builder does NOT require Wine for Windows builds.

### Large File Size

The portable executable includes:
- Electron runtime (~100MB)
- Node.js runtime
- All dependencies
- Native modules

This is normal for Electron apps. Typical size: 150-250MB.

## Advanced Configuration

### Customizing the Build

Edit `package.json` → `build` section:

```json
"build": {
  "appId": "com.rhtools.app",
  "productName": "RHTools",
  "win": {
    "target": [{
      "target": "portable",
      "arch": ["x64"]  // or ["ia32", "x64"] for 32-bit + 64-bit
    }]
  }
}
```

### Adding an Icon

1. Create `assets/icon.ico` (256x256 PNG converted to ICO format)
2. Add to `package.json`:
   ```json
   "win": {
     "icon": "assets/icon.ico"
   }
   ```

### Excluding Files

Files are excluded via the `files` array in `package.json`:
```json
"files": [
  "electron/**/*",
  "!electron/backup/**/*",    // Exclude backups
  "!electron/**/*.db-shm",    // Exclude temp DB files
  "!electron/**/*.db-wal"
]
```

## Build Scripts Reference

| Command | Description |
|---------|-------------|
| `npm run build:win` | Build portable Windows executable |
| `npm run build:win-all` | Build portable + installer for Windows |
| `npm run build:linux` | Build Linux AppImage |
| `npm run app:build` | Build renderer only (no packaging) |

## Security Notes

- The portable executable is NOT code-signed (requires certificate)
- Native modules are rebuilt from source during build
- All dependencies from `package.json` are included
- Database files travel with the executable

## Next Steps

After building:

1. **Test thoroughly** on Windows 10 and 11
2. **Consider code signing** for production release
3. **Document Windows-specific features** in user docs
4. **Set up CI/CD** for automated builds (GitHub Actions, etc.)

## Support

For build issues:
1. Check `dist-builds/builder-debug.yml` for detailed logs
2. Verify Node.js version compatibility
3. Ensure `electron/renderer/dist/` exists (run `npm run renderer:build`)

