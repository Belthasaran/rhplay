# Startup Path Validation System

## 🚀 **Overview**

The RHTools application now includes a comprehensive startup validation system that automatically detects and configures OS-specific program paths. This ensures users have the necessary tools configured before using the application.

## 🔍 **What Gets Validated**

### **Critical Paths (Required)**
- **`vanillaRomPath`**: Super Mario World ROM file
- **`flipsPath`**: Flips executable for ROM patching

### **Optional Paths (Nice to Have)**
- **`asarPath`**: Asar assembler executable
- **`uberAsmPath`**: UberASM assembler executable

## 🎯 **Validation Process**

### **1. Vanilla ROM Validation**
- **SHA224 Hash**: `fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08`
- **File Names**: `smw.sfc`, `SuperMarioWorld.sfc`
- **Search Locations**:
  - Current `vanillaRomPath` setting (if set)
  - User data directory (`%APPDATA%\rhtools\` on Windows, `~/.config/rhtools/` on Linux, `~/Library/Application Support/rhtools/` on macOS)

### **2. Flips Path Validation**
- **Search Locations**:
  - Current `flipsPath` setting (if set)
  - User data directory
  - OS-specific standard locations:
    - **Windows**: `C:\Program Files\Flips`, `C:\Program Files (x86)\Flips`
    - **Linux**: `/usr/local/bin`, `/usr/bin`, `/bin`, `~/bin`, `~/.local/bin`
    - **macOS**: `/usr/local/bin`, `/opt/homebrew/bin`, `~/bin`

### **3. Optional Tools Validation**
- **Asar**: Searches for `asar.exe` (Windows) or `asar` (Unix)
- **UberASM**: Searches for `uberasm.exe` (Windows) or `uberasm` (Unix)
- **Search Locations**: Same as Flips, plus user data directory

## 🔧 **Implementation Details**

### **Files Created/Modified**

#### **`electron/startup-path-validator.js`**
- Main validation logic
- Cross-platform path detection
- SHA224 hash validation for ROM files
- Executable validation

#### **`electron/main.js`**
- Integrated startup validation
- Settings modal auto-open logic
- IPC communication with frontend

#### **`electron/renderer/src/App.vue`**
- Frontend handling of validation results
- Settings modal integration
- User notification system

#### **`electron/preload.js`**
- IPC event listeners for startup validation

### **Key Features**

#### **Cross-Platform Compatibility**
```javascript
// OS-specific search paths
if (process.platform === 'win32') {
    paths.push('C:\\Program Files\\Flips');
} else if (process.platform === 'darwin') {
    paths.push('/opt/homebrew/bin');
} else {
    paths.push('/usr/local/bin');
}
```

#### **SHA224 Hash Validation**
```javascript
const hash = crypto.createHash('sha224').update(fileBuffer).digest('hex');
return hash === expectedHash;
```

#### **Executable Detection**
```javascript
// Windows: Check for .exe extension
if (process.platform === 'win32') {
    return filename.endsWith('.exe');
} else {
    // Unix: Check executable bit
    return fs.statSync(filePath).mode & 0o111;
}
```

## 🎯 **User Experience**

### **Successful Validation**
- ✅ All critical paths found and validated
- ✅ Settings automatically updated
- ✅ Application starts normally
- ✅ Console shows: "All critical paths validated successfully"

### **Missing Critical Paths**
- ⚠️ Settings modal automatically opens
- ⚠️ Alert dialog shows missing paths
- ⚠️ User must configure paths before continuing
- ⚠️ Console shows: "Critical paths missing, settings modal will open"

### **Settings Modal Integration**
- **Auto-open**: When critical paths are missing
- **Clear messaging**: Shows which paths need configuration
- **Validation status**: Real-time validation indicators
- **User guidance**: Instructions for each tool

## 📋 **Settings Database Integration**

### **Settings Stored**
- `vanillaRomPath`: Path to SMW ROM file
- `vanillaRomValid`: Boolean validation status
- `flipsPath`: Path to Flips executable
- `asarPath`: Path to Asar executable (optional)
- `uberAsmPath`: Path to UberASM executable (optional)

### **Database Operations**
```javascript
// Get setting
const db = this.dbManager.getConnection('clientdata');
const result = db.prepare(`
    SELECT csetting_value FROM csettings WHERE csetting_name = ?
`).get(key);

// Set setting
db.prepare(`
    INSERT INTO csettings (csettinguid, csetting_name, csetting_value)
    VALUES (?, ?, ?)
    ON CONFLICT(csetting_name) DO UPDATE SET csetting_value = excluded.csetting_value
`).run(uuid, key, String(value));
```

## 🔄 **Startup Flow**

### **1. Application Launch**
```
App starts → Database initialized → Window created → Ready to show
```

### **2. Validation Process**
```
Window ready → Startup validation → Path detection → Settings update
```

### **3. User Experience**
```
Validation complete → Check results → Open settings if needed → Continue
```

## 🛠️ **Configuration**

### **ROM File Requirements**
- **File**: `smw.sfc` or `SuperMarioWorld.sfc`
- **Hash**: SHA224 `fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08`
- **Location**: User data directory or current setting

### **Tool Requirements**
- **Flips**: `flips.exe` (Windows) or `flips` (Unix)
- **Asar**: `asar.exe` (Windows) or `asar` (Unix) - Optional
- **UberASM**: `uberasm.exe` (Windows) or `uberasm` (Unix) - Optional

## 🎯 **Benefits**

### **For Users**
- ✅ **Automatic setup**: No manual path configuration needed
- ✅ **Clear guidance**: Know exactly what's missing
- ✅ **Cross-platform**: Works on Windows, Linux, macOS
- ✅ **Validation**: Ensures tools are correct before use

### **For Developers**
- ✅ **Robust startup**: Handles missing dependencies gracefully
- ✅ **User-friendly**: Clear error messages and guidance
- ✅ **Maintainable**: Centralized validation logic
- ✅ **Extensible**: Easy to add new tool validations

## 🔍 **Troubleshooting**

### **Common Issues**

#### **ROM Not Found**
- **Cause**: ROM file not in user data directory
- **Solution**: Place `smw.sfc` or `SuperMarioWorld.sfc` in user data directory
- **Location**: 
  - Windows: `%APPDATA%\rhtools\`
  - Linux: `~/.config/rhtools/`
  - macOS: `~/Library/Application Support/rhtools/`

#### **Flips Not Found**
- **Cause**: Flips not installed or not in PATH
- **Solution**: Install Flips or place executable in user data directory
- **Download**: [Flips GitHub](https://github.com/Alcaro/Flips)

#### **Hash Mismatch**
- **Cause**: ROM file is not the correct version
- **Solution**: Use the correct Super Mario World ROM (SHA224: `fdc4c00e09a8e08d395003e9c8a747f45a9e5e94cbfedc508458eb08`)

### **Debug Information**
- **Console logs**: Detailed validation process logging
- **Settings status**: Real-time validation indicators in settings
- **Error messages**: Clear guidance on what needs to be fixed

## 🎯 **Result**

The startup validation system ensures that:
- ✅ **Critical tools are available** before the user tries to use them
- ✅ **Settings are automatically configured** when possible
- ✅ **Users get clear guidance** when manual configuration is needed
- ✅ **The application is ready to use** immediately after startup

This creates a much smoother user experience and reduces support requests related to missing or misconfigured tools.
