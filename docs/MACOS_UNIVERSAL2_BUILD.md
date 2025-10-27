# macOS Universal 2 Build Configuration

## 🍎 **Overview**

RHTools now supports building macOS Universal 2 packages that work on both Intel and Apple Silicon Macs. This document explains the configuration, native module handling, and build process.

## 🎯 **Universal 2 Architecture**

### **What is Universal 2?**
- **Single Binary**: Contains both Intel (x86_64) and Apple Silicon (arm64) architectures
- **Automatic Selection**: macOS automatically selects the correct architecture at runtime
- **Performance**: Native performance on both Intel and Apple Silicon Macs
- **Compatibility**: Works on macOS 11.0+ (Big Sur and later)

### **Architecture Support**
- **Intel Macs**: x86_64 architecture
- **Apple Silicon Macs**: arm64 architecture
- **Legacy Support**: Intel Macs with Rosetta 2

## 🔧 **Configuration Details**

### **Package.json Configuration**
```json
{
  "build": {
    "mac": {
      "target": [
        {
          "target": "dmg",
          "arch": ["universal"]
        }
      ],
      "category": "public.app-category.utilities",
      "icon": "assets/icon.icns",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist"
    },
    "dmg": {
      "title": "${productName} ${version}",
      "artifactName": "${productName}-${version}-universal.dmg",
      "background": "assets/dmg-background.png",
      "window": {
        "width": 540,
        "height": 380
      },
      "contents": [
        {
          "x": 140,
          "y": 200,
          "type": "file"
        },
        {
          "x": 400,
          "y": 200,
          "type": "link",
          "path": "/Applications"
        }
      ]
    }
  }
}
```

### **Key Configuration Options**

#### **Universal Architecture**
- `"arch": ["universal"]` - Builds Universal 2 binary
- `electron-builder` automatically handles architecture detection

#### **Hardened Runtime**
- `"hardenedRuntime": true` - Enables macOS security features
- Required for notarization and App Store distribution
- Provides additional security protections

#### **Entitlements**
- `"entitlements": "build/entitlements.mac.plist"` - Security permissions
- Required for native modules and file system access
- Includes permissions for better-sqlite3, USB2SNES, etc.

## 🔨 **Native Module Handling**

### **Universal 2 Native Modules**

#### **How It Works**
1. **Pre-built Binaries**: `electron-builder` downloads pre-built Universal 2 binaries
2. **Automatic Detection**: Detects macOS architecture and selects correct binary
3. **Fallback Support**: Uses Intel binaries with Rosetta 2 on Apple Silicon if needed

#### **Supported Native Modules**
- **better-sqlite3**: ✅ Universal 2 support
- **keccak**: ✅ Universal 2 support  
- **lzma-native**: ✅ Universal 2 support
- **secp256k1**: ✅ Universal 2 support

#### **Configuration**
```json
{
  "asarUnpack": [
    "node_modules/better-sqlite3/**/*",
    "node_modules/keccak/**/*", 
    "node_modules/lzma-native/**/*",
    "node_modules/secp256k1/**/*"
  ]
}
```

### **Native Module Sources**

#### **Pre-built Binaries**
- **Source**: npm packages with pre-built Universal 2 binaries
- **Advantage**: No compilation required
- **Compatibility**: Automatically compatible with both architectures

#### **Electron Rebuild**
- **Process**: `electron-builder` handles rebuilding automatically
- **Fallback**: If pre-built binaries unavailable, rebuilds from source
- **Universal 2**: Automatically creates Universal 2 binaries

## 🛠️ **Build Process**

### **Build Commands**
```bash
# Build macOS Universal 2 DMG
npm run build:mac

# Build all platforms including macOS
./build.sh all

# Build only macOS
./build.sh macos
```

### **Build Requirements**

#### **On Linux (Cross-Compilation)**
- ✅ **Possible**: Can build macOS packages on Linux
- ⚠️ **Limitations**: 
  - No code signing
  - No notarization
  - Limited testing capabilities
  - Placeholder assets

#### **On macOS (Native Build)**
- ✅ **Recommended**: Full macOS build capabilities
- ✅ **Code Signing**: Can sign with Apple Developer certificates
- ✅ **Notarization**: Can notarize for distribution
- ✅ **Testing**: Can test on actual macOS hardware

### **Build Output**
- **File**: `RHTools-1.0.0-universal.dmg`
- **Size**: ~200-300MB (includes both architectures)
- **Type**: Universal 2 DMG installer
- **Usage**: Mount DMG and drag to Applications folder

## 🔐 **Security & Entitlements**

### **Entitlements File**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- Required for hardened runtime -->
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    
    <!-- Required for native modules -->
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    
    <!-- Required for better-sqlite3 -->
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
    
    <!-- Required for file system access -->
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    
    <!-- Required for network access -->
    <key>com.apple.security.network.client</key>
    <true/>
    
    <!-- Required for USB2SNES functionality -->
    <key>com.apple.security.device.usb</key>
    <true/>
</dict>
</plist>
```

### **Security Features**
- **Hardened Runtime**: Additional security protections
- **Entitlements**: Specific permissions for app functionality
- **Gatekeeper**: macOS security validation
- **Notarization**: Apple validation for distribution

## 📦 **Assets & Resources**

### **Required Assets**
- **Icon**: `assets/icon.icns` - macOS application icon
- **DMG Background**: `assets/dmg-background.png` - DMG installer background
- **Entitlements**: `build/entitlements.mac.plist` - Security permissions

### **Asset Creation**
```bash
# Create macOS assets
./create-macos-assets.sh

# Manual creation
convert assets/icon.svg -resize 512x512 assets/icon.ico
# Create ICNS file on macOS using iconutil
```

## 🚀 **Distribution**

### **DMG Installation**
1. **Download**: `RHTools-1.0.0-universal.dmg`
2. **Mount**: Double-click DMG file
3. **Install**: Drag RHTools to Applications folder
4. **Launch**: Open from Applications folder

### **Code Signing (macOS Only)**
```bash
# Sign with Apple Developer certificate
electron-builder --mac --publish=never --config.mac.identity="Developer ID Application: Your Name"
```

### **Notarization (macOS Only)**
```bash
# Notarize for distribution
xcrun notarytool submit RHTools-1.0.0-universal.dmg --keychain-profile "notarytool-profile"
```

## 🔍 **Testing & Validation**

### **Architecture Testing**
```bash
# Check Universal 2 binary
file RHTools.app/Contents/MacOS/RHTools
# Output: RHTools: Mach-O universal binary with 2 architectures: [x86_64:arm64]

# Check specific architecture
lipo -info RHTools.app/Contents/MacOS/RHTools
# Output: Architectures in the fat file: RHTools are: x86_64 arm64
```

### **Native Module Testing**
- **Intel Mac**: Test with native x86_64 binaries
- **Apple Silicon Mac**: Test with native arm64 binaries
- **Rosetta 2**: Test Intel binaries on Apple Silicon

## ⚠️ **Limitations & Considerations**

### **Cross-Compilation Limitations**
- **No Code Signing**: Cannot sign on Linux
- **No Notarization**: Cannot notarize on Linux
- **Limited Testing**: Cannot test on actual macOS hardware
- **Asset Quality**: Placeholder assets instead of professional ones

### **Native Module Considerations**
- **Pre-built Binaries**: Relies on npm package maintainers
- **Version Compatibility**: Must ensure Electron version compatibility
- **Architecture Support**: Some modules may not support Universal 2

### **Performance Considerations**
- **Binary Size**: Universal 2 binaries are larger than single-architecture
- **Load Time**: Slight overhead for architecture detection
- **Memory Usage**: Both architectures loaded into memory

## 🎯 **Best Practices**

### **Development**
- **Test on Both Architectures**: Test on Intel and Apple Silicon Macs
- **Use Pre-built Binaries**: Prefer packages with Universal 2 support
- **Monitor Dependencies**: Keep native modules updated

### **Distribution**
- **Code Signing**: Sign with Apple Developer certificate
- **Notarization**: Notarize for smooth installation experience
- **Professional Assets**: Use high-quality icons and DMG backgrounds

### **Build Process**
- **macOS Build**: Use macOS machine for production builds
- **CI/CD**: Use GitHub Actions with macOS runners
- **Automation**: Automate signing and notarization process

## 🎯 **Result**

The macOS Universal 2 build configuration provides:
- ✅ **Universal Compatibility**: Works on both Intel and Apple Silicon Macs
- ✅ **Native Performance**: Full performance on both architectures
- ✅ **Modern Security**: Hardened runtime and entitlements
- ✅ **Professional Distribution**: DMG installer with proper assets
- ✅ **Native Module Support**: Automatic Universal 2 binary handling

This ensures RHTools works seamlessly on all modern Mac hardware without requiring separate builds for different architectures.
