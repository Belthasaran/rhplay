# RHTools Complete Deployment Guide

## Overview
RHTools is now fully configured for self-contained deployment on both Windows and Linux platforms. This guide covers the complete build process, dependencies, and deployment instructions.

## ✅ Completed Tasks

### 1. Dependencies Reassessment
- **Binary Tools**: Added Windows (`asar.exe`, `flips.exe`) and Linux (`asar`, `flips`) binaries
- **Database Files**: Included `rhdata.db`, `patchbin.db`, `clientdata.db` with proper path handling
- **Native Dependencies**: `better-sqlite3`, `lzma-native`, `keccak`, `secp256k1` properly bundled

### 2. Build Scripts Created
- **`build.sh`**: Comprehensive build script with colored output and error handling
- **`setup-databases.sh`**: Database initialization and path management
- **Repeatable Process**: Fully automated build pipeline

### 3. Package Configuration Updated
- **Windows**: Includes `Flips/asar.exe`, `Flips/flips.exe`, `Flips/dll/asar.dll`
- **Linux**: Includes `bin/asar`, `bin/flips` (copied from system PATH)
- **Databases**: All three database files included and properly handled

## 🚀 Build Process

### Prerequisites
```bash
# Install Wine (for Windows builds)
sudo apt install wine

# Install Linux tools (optional, will be copied from system)
sudo apt install asar flips
```

### Build Commands
```bash
# Build both packages
./build.sh

# Build Linux only
./build.sh linux

# Build Windows only
./build.sh windows

# Clean build directories
./build.sh clean

# Install dependencies only
./build.sh deps
```

## 📦 Package Contents

### Linux AppImage (`RHTools-1.0.0.AppImage`)
- **Size**: ~1.8GB
- **Type**: Self-contained AppImage
- **Contents**:
  - Complete Electron runtime
  - Vue.js frontend (built)
  - SQLite databases (`rhdata.db`, `patchbin.db`, `clientdata.db`)
  - Linux binaries (`asar`, `flips`)
  - All Node.js dependencies

### Windows Portable (`RHTools-1.0.0-portable.exe`)
- **Size**: ~1.7GB
- **Type**: Self-contained portable executable
- **Contents**:
  - Complete Electron runtime
  - Vue.js frontend (built)
  - SQLite databases (`rhdata.db`, `patchbin.db`, `clientdata.db`)
  - Windows binaries (`asar.exe`, `flips.exe`, `asar.dll`)
  - All Node.js dependencies

## 🗄️ Database Handling

### Development Mode
- Databases located in `electron/` directory
- Direct file access

### Production Mode (Packaged)
- Databases copied to user data directory:
  - **Linux**: `~/.config/rhtools/`
  - **Windows**: `%APPDATA%/rhtools/`
- Automatic initialization on first run
- Environment variable overrides supported:
  - `RHDATA_DB_PATH`
  - `PATCHBIN_DB_PATH`
  - `CLIENTDATA_DB_PATH`

## 🔧 Binary Tools Integration

### Windows Tools
- **Location**: `Flips/asar.exe`, `Flips/flips.exe`
- **Usage**: Direct executable calls
- **Dependencies**: `Flips/dll/asar.dll` included

### Linux Tools
- **Location**: `bin/asar`, `bin/flips`
- **Source**: Copied from system PATH during build
- **Usage**: Direct executable calls

### Tool Discovery
The application uses the `BinaryFinder` class to locate tools in this order:
1. Database settings (`csettings` table)
2. Environment variables (`ASAR_BIN_PATH`, `FLIPS_BIN_PATH`)
3. Current working directory
4. Project root directory
5. System PATH

## 📋 Build Script Features

### `build.sh` Capabilities
- ✅ Prerequisites checking
- ✅ Linux binary preparation
- ✅ Database file validation
- ✅ Clean build directories
- ✅ Dependency installation
- ✅ Renderer building
- ✅ Package creation
- ✅ Package verification
- ✅ Deployment info generation

### Error Handling
- Colored output for better visibility
- Comprehensive error messages
- Prerequisites validation
- Build verification

## 🚀 Deployment Instructions

### For End Users

#### Linux
```bash
# Download and run AppImage
chmod +x RHTools-1.0.0.AppImage
./RHTools-1.0.0.AppImage
```

#### Windows
```bash
# Download and run portable executable
RHTools-1.0.0-portable.exe
```

### For Developers

#### Full Build
```bash
./build.sh
```

#### Individual Components
```bash
# Linux only
./build.sh linux

# Windows only (requires Wine)
./build.sh windows
```

## 🔍 Verification

### Package Verification
```bash
# Check Linux package
file dist-builds/RHTools-1.0.0.AppImage

# Check Windows package
file dist-builds/RHTools-1.0.0-portable.exe
```

### Contents Verification
```bash
# List Linux package contents
ls -la dist-builds/linux-unpacked/

# List Windows package contents
ls -la dist-builds/win-unpacked/
```

## 📊 File Sizes Summary

| Component | Linux | Windows |
|-----------|-------|---------|
| **Total Package** | 1.8GB | 1.7GB |
| **Main Executable** | 196MB | 202MB |
| **Unpacked Directory** | ~240MB | ~250MB |
| **Databases** | ~1.7GB | ~1.7GB |
| **Binaries** | ~2MB | ~8MB |

## 🎯 Key Features

### Self-Contained Packages
- ✅ No external dependencies required
- ✅ Complete Electron runtime included
- ✅ All Node.js modules bundled
- ✅ Native modules pre-compiled
- ✅ Database files included
- ✅ Binary tools included

### Cross-Platform Support
- ✅ Windows portable executable
- ✅ Linux AppImage
- ✅ Proper path handling
- ✅ Environment variable support

### Production Ready
- ✅ Database initialization
- ✅ User data directory management
- ✅ Error handling and logging
- ✅ Tool discovery and validation

## 🔧 Maintenance

### Updating Dependencies
```bash
npm update
cd electron/renderer && npm update
```

### Rebuilding Packages
```bash
./build.sh clean
./build.sh
```

### Database Updates
- Databases are copied to user data directory on first run
- Updates require manual database replacement
- Environment variables can override default paths

## 📝 Notes

- **Wine Required**: Windows builds require Wine on Linux systems
- **System Tools**: Linux builds copy `asar` and `flips` from system PATH
- **Database Size**: Large databases (~1.7GB) are included in packages
- **Portable**: Both packages are completely portable and self-contained

The RHTools application is now fully prepared for distribution with comprehensive build scripts, proper dependency management, and self-contained packages for both Windows and Linux platforms.
