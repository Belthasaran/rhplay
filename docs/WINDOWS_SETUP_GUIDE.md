# Windows Build Machine Setup Guide

## 🚀 **Complete Windows Setup Instructions**

### **Prerequisites**
1. **Node.js** (v18 or later): Download from [nodejs.org](https://nodejs.org/)
2. **Git**: Download from [git-scm.com](https://git-scm.com/)
3. **Visual Studio Build Tools** (for native modules):
   ```bash
   # Install via npm
   npm install -g windows-build-tools
   
   # OR download from Microsoft
   # https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
   ```

### **Step 1: Clone Repository**
```bash
git clone <your-repository-url>
cd rhplay
```

### **Step 2: Install Dependencies**

#### **Main Dependencies**
```bash
npm install
```

#### **Renderer Dependencies** (CRITICAL!)
```bash
cd electron/renderer
npm install
cd ../..
```

### **Step 3: Verify Installation**
```bash
# Check if vite is available
cd electron/renderer
npx vite --version
cd ../..

# Check if all dependencies are installed
npm list --depth=0
```

### **Step 4: Build Process**

#### **Build Renderer First**
```bash
npm run renderer:build
```

#### **Build Windows Package**
```bash
npm run build:win
```

## 🔧 **Common Issues & Solutions**

### **Issue 1: 'vite' is not recognized**
**Cause**: Renderer dependencies not installed

**Solution**:
```bash
cd electron/renderer
npm install
cd ../..
```

### **Issue 2: '.' is not recognized as an internal or external command**
**Cause**: Bash script `fix-asset-paths.sh` not compatible with Windows Command Prompt

**Solution**: Use the cross-platform Node.js script instead:
```bash
# The build process now automatically uses the correct script
npm run build:win
```

### **Issue 3: Native Module Build Errors**
**Cause**: Missing Windows build tools

**Solution**:
```bash
# Install Windows build tools
npm install -g windows-build-tools

# OR install Visual Studio Build Tools manually
# Then rebuild native modules
npm run postinstall
```

### **Issue 4: Electron-builder Configuration Error**
**Cause**: Invalid configuration properties in package.json

**Error**: `configuration.win has an unknown property 'buildDependenciesFromSource'`

**Solution**: Remove invalid properties from package.json:
```json
{
  "build": {
    "win": {
      "target": [{"target": "portable", "arch": ["x64"]}]
    }
  }
}
```

### **Issue 5: Permission Errors**
**Cause**: Windows security restrictions

**Solution**:
```bash
# Run PowerShell as Administrator
# Or disable Windows Defender real-time protection temporarily
```

## 📋 **Complete Setup Script for Windows**

Create `setup-windows.bat`:
```batch
@echo off
echo Setting up RHTools build environment on Windows...

echo Installing main dependencies...
call npm install
if %errorlevel% neq 0 (
    echo Failed to install main dependencies
    pause
    exit /b 1
)

echo Installing renderer dependencies...
cd electron\renderer
call npm install
if %errorlevel% neq 0 (
    echo Failed to install renderer dependencies
    pause
    exit /b 1
)
cd ..\..

echo Installing Windows build tools...
call npm install -g windows-build-tools
if %errorlevel% neq 0 (
    echo Warning: Failed to install build tools
    echo You may need to install Visual Studio Build Tools manually
)

echo Verifying installation...
cd electron\renderer
call npx vite --version
if %errorlevel% neq 0 (
    echo Error: Vite not found
    pause
    exit /b 1
)
cd ..\..

echo Setup complete! You can now run:
echo   npm run build:win
pause
```

## 🎯 **Step-by-Step Windows Build Process**

### **1. Initial Setup**
```bash
# Clone repository
git clone <repo-url>
cd rhplay

# Install main dependencies
npm install

# Install renderer dependencies (CRITICAL!)
cd electron/renderer
npm install
cd ../..
```

### **2. Verify Setup**
```bash
# Test renderer build
npm run renderer:build

# Should output:
# ✓ built in XXXms
# ✅ Asset path fixing completed!
```

### **3. Build Windows Package**
```bash
npm run build:win
```

### **4. Verify Output**
```bash
# Check if package was created
dir dist-builds\*.exe
```

## ⚠️ **Important Notes**

### **Renderer Dependencies**
- **CRITICAL**: Always run `npm install` in `electron/renderer/` directory
- The renderer has its own `package.json` and `node_modules`
- Main project dependencies don't include renderer dependencies

### **Native Modules**
- Windows build tools are required for `better-sqlite3`
- Install Visual Studio Build Tools or use `windows-build-tools`
- Native modules will be rebuilt during packaging

### **Path Issues**
- Use forward slashes in npm scripts: `npm --prefix electron/renderer`
- Windows handles this automatically
- PowerShell vs Command Prompt may have different behaviors

## 🔍 **Troubleshooting**

### **Check Renderer Dependencies**
```bash
cd electron/renderer
npm list
# Should show: vue, vite, @vitejs/plugin-vue, typescript
```

### **Check Main Dependencies**
```bash
npm list --depth=0
# Should show: electron, electron-builder, better-sqlite3, etc.
```

### **Test Individual Components**
```bash
# Test renderer build
cd electron/renderer
npm run build

# Test main process
cd ../..
npm run electron:start
```

## ✅ **Success Indicators**

When setup is correct, you should see:
- ✅ `npm run renderer:build` completes without errors
- ✅ `npm run build:win` creates `dist-builds/RHTools-1.0.0-portable.exe`
- ✅ Package size around 111MB
- ✅ No "command not found" errors

## 🎯 **Quick Fix for Current Issue**

If you're getting the vite error right now:

```bash
# Navigate to renderer directory
cd electron/renderer

# Install dependencies
npm install

# Verify vite is available
npx vite --version

# Go back to root
cd ../..

# Try build again
npm run build:win
```

This should resolve the "vite is not recognized" error!
