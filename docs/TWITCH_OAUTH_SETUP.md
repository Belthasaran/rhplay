# Twitch OAuth Setup Guide

## Overview

This document describes how to set up and build the application with Twitch OAuth client ID embedded for the implicit grant flow.

## Development Setup

In development mode, the client ID is read from the `RHPLAY_TW_CLIENT_ID` environment variable.

### Setting the Environment Variable

**Linux/macOS:**
```bash
export RHPLAY_TW_CLIENT_ID=your_client_id_here
```

**Windows (PowerShell):**
```powershell
$env:RHPLAY_TW_CLIENT_ID="your_client_id_here"
```

**Windows (Command Prompt):**
```cmd
set RHPLAY_TW_CLIENT_ID=your_client_id_here
```

The environment variable will be automatically used when running in development mode.

## Production Build Setup

For production builds, the client ID is embedded in the application bundle (not in source code) for basic obscurity.

### Build Process

1. **Set the environment variable** before building:
   ```bash
   export RHPLAY_TW_CLIENT_ID=your_client_id_here
   ```

2. **Generate the config file** (automatically done during build):
   ```bash
   npm run build:twitch-config
   ```
   
   Or it will be automatically generated when running:
   ```bash
   npm run renderer:build
   npm run build:linux
   npm run build:win
   ```

3. **The config file** (`electron/twitch-config.json`) is:
   - Generated from the environment variable
   - Base64-encoded for basic obscurity (not security)
   - Bundled into the application via `extraResources`
   - Automatically excluded from git (in `.gitignore`)

### Config File Location

The generated config file is located at:
- **Source:** `electron/twitch-config.json`
- **In packaged app:** Bundled in `resources/` directory (platform-dependent)

### Building Production Executables

The build process automatically:
1. Reads `RHPLAY_TW_CLIENT_ID` from environment
2. Generates `electron/twitch-config.json` (base64-encoded)
3. Bundles it via `electron-builder` extraResources
4. Application reads it at runtime

**Example build commands:**
```bash
# Set client ID
export RHPLAY_TW_CLIENT_ID=your_client_id_here

# Build Linux AppImage
npm run build:linux

# Build Windows portable
npm run build:win

# Build macOS
npm run build:mac
```

## Runtime Behavior

### Development Mode
- Reads from `RHPLAY_TW_CLIENT_ID` environment variable
- No config file needed

### Production Mode
- Reads from bundled `twitch-config.json`
- Automatically decodes the base64-encoded client ID
- Works on all platforms without environment variables

## Security Notes

⚠️ **Important:** The client ID is NOT a secret in OAuth implicit grant flow (it must be publicly accessible). However:

- The client ID is base64-encoded in the config file for basic obscurity
- It's not in source code or git repository
- It requires extraction from the bundle to view
- For stronger protection, consider using OAuth Authorization Code flow with a backend server (future enhancement)

## Troubleshooting

### "Twitch client ID not configured" Error

**In Development:**
- Ensure `RHPLAY_TW_CLIENT_ID` environment variable is set
- Restart your development server after setting the variable

**In Production:**
- Ensure you set `RHPLAY_TW_CLIENT_ID` before running the build
- Check that `electron/twitch-config.json` was generated
- Verify the config file is included in the build output

### Config File Not Found

If the config file isn't found in production:
1. Check that `electron/twitch-config.json` exists before building
2. Verify it's listed in `package.json` `build.extraResources`
3. Check build output logs for errors

## Files

- **Config Generator:** `scripts/build-twitch-config.js`
- **Config Reader:** `electron/twitch-config.js`
- **Generated Config:** `electron/twitch-config.json` (git-ignored)
- **Build Config:** `package.json` (extraResources section)

