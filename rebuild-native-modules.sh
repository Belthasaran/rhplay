#!/bin/bash

# Windows Native Module Rebuild Script
# This script handles native modules for Windows builds

echo "🔧 Handling native modules for Windows..."

# Check if we're building for Windows
if [ "$1" = "windows" ]; then
    echo "Building for Windows platform..."
    
    # For Windows builds on Linux, we have a few options:
    # 1. Use pre-built binaries (if available)
    # 2. Skip native module rebuild and let electron-builder handle it
    # 3. Use alternative libraries
    
    echo "Using electron-builder's native module handling..."
    echo "This will let electron-builder manage the native modules during packaging"
    
    # Clean any existing native modules to force rebuild
    echo "Cleaning existing native modules..."
    rm -rf node_modules/better-sqlite3/build
    rm -rf node_modules/keccak/build
    rm -rf node_modules/lzma-native/build
    rm -rf node_modules/secp256k1/build
    rm -rf native-modules/serialport-nonblock/build
    
    echo "✅ Native modules cleaned for Windows rebuild"
else
    echo "Building for Linux platform..."
    echo "✅ No additional native module handling needed for Linux"
fi

echo "🎯 Native module handling completed!"
