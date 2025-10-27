#!/bin/bash

# RHTools Build Script
# Creates self-contained packages for Windows and Linux

set -e  # Exit on any error

echo "🚀 RHTools Build Script"
echo "======================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    
    # Check Wine (for Windows builds)
    if ! command -v wine &> /dev/null; then
        print_warning "Wine is not installed - Windows builds will fail"
        print_warning "Install with: sudo apt install wine"
    fi
    
    # Check Linux tools
    if ! command -v asar &> /dev/null; then
        print_warning "asar is not installed - Linux builds may have issues"
        print_warning "Install with: sudo apt install asar"
    fi
    
    if ! command -v flips &> /dev/null; then
        print_warning "flips is not installed - Linux builds may have issues"
        print_warning "Install with: sudo apt install flips"
    fi
    
    print_success "Prerequisites check completed"
}

# Prepare Linux binaries
prepare_linux_binaries() {
    print_status "Preparing Linux binaries..."
    
    # Create bin directory if it doesn't exist
    mkdir -p bin
    
    # Copy Linux binaries
    if command -v asar &> /dev/null; then
        cp $(which asar) bin/asar
        print_success "Copied asar binary"
    else
        print_warning "asar not found in PATH"
    fi
    
    if command -v flips &> /dev/null; then
        cp $(which flips) bin/flips
        print_success "Copied flips binary"
    else
        print_warning "flips not found in PATH"
    fi
}

# Prepare database files
prepare_databases() {
    print_status "Preparing database files..."
    
    # Check if database files exist
    if [ ! -f "electron/rhdata.db" ]; then
        print_error "rhdata.db not found in electron/"
        exit 1
    fi
    
    if [ ! -f "electron/patchbin.db" ]; then
        print_error "patchbin.db not found in electron/"
        exit 1
    fi
    
    if [ ! -f "electron/clientdata.db" ]; then
        print_error "clientdata.db not found in electron/"
        exit 1
    fi
    
    print_success "Database files found"
}

# Clean previous builds
clean_builds() {
    print_status "Cleaning previous builds..."
    
    if [ -d "dist-builds" ]; then
        rm -rf dist-builds
        print_success "Cleaned dist-builds directory"
    fi
    
    if [ -d "electron/renderer/dist" ]; then
        rm -rf electron/renderer/dist
        print_success "Cleaned renderer dist directory"
    fi
}

# Install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    
    # Install main dependencies
    npm install
    
    # Install renderer dependencies
    cd electron/renderer
    npm install
    cd ../..
    
    print_success "Dependencies installed"
}

# Build renderer
build_renderer() {
    print_status "Building renderer..."
    
    cd electron/renderer
    npm run build
    cd ../..
    
    print_success "Renderer built"
}

# Build Linux package
build_linux() {
    print_status "Building Linux AppImage..."
    
    npm run build:linux
    
    if [ -f "dist-builds/RHTools-1.0.0.AppImage" ]; then
        print_success "Linux AppImage built successfully"
        ls -lh dist-builds/RHTools-1.0.0.AppImage
    else
        print_error "Linux AppImage build failed"
        exit 1
    fi
}

# Build Windows package
build_windows() {
    print_status "Building Windows portable package..."
    
    npm run build:win
    
    if [ -f "dist-builds/RHTools-1.0.0-portable.exe" ]; then
        print_success "Windows portable package built successfully"
        ls -lh dist-builds/RHTools-1.0.0-portable.exe
    else
        print_error "Windows portable package build failed"
        exit 1
    fi
}

# Verify packages
verify_packages() {
    print_status "Verifying packages..."
    
    # Check Linux package
    if [ -f "dist-builds/RHTools-1.0.0.AppImage" ]; then
        file dist-builds/RHTools-1.0.0.AppImage
        print_success "Linux package verified"
    fi
    
    # Check Windows package
    if [ -f "dist-builds/RHTools-1.0.0-portable.exe" ]; then
        file dist-builds/RHTools-1.0.0-portable.exe
        print_success "Windows package verified"
    fi
}

# Create deployment info
create_deployment_info() {
    print_status "Creating deployment information..."
    
    cat > dist-builds/DEPLOYMENT_INFO.md << EOF
# RHTools Deployment Packages

## Linux Package
- **File**: RHTools-1.0.0.AppImage
- **Size**: $(ls -lh RHTools-1.0.0.AppImage | awk '{print $5}')
- **Type**: Self-contained AppImage
- **Usage**: chmod +x RHTools-1.0.0.AppImage && ./RHTools-1.0.0.AppImage

## Windows Package
- **File**: RHTools-1.0.0-portable.exe
- **Size**: $(ls -lh RHTools-1.0.0-portable.exe | awk '{print $5}')
- **Type**: Self-contained portable executable
- **Usage**: Double-click to run

## Included Components
- Complete Electron runtime
- Vue.js frontend
- SQLite databases (rhdata.db, patchbin.db, clientdata.db)
- Binary tools (asar, flips)
- All Node.js dependencies

## Database Files
- rhdata.db: Game data and metadata
- patchbin.db: Patch information
- clientdata.db: Client settings and configuration

## Binary Tools
- asar.exe (Windows) / asar (Linux): SNES assembler
- flips.exe (Windows) / flips (Linux): IPS/BPS patcher

Built on: $(date)
EOF
    
    print_success "Deployment information created"
}

# Main build function
main() {
    echo "Starting RHTools build process..."
    echo ""
    
    check_prerequisites
    prepare_linux_binaries
    prepare_databases
    clean_builds
    install_dependencies
    build_renderer
    
    # Build packages
    build_linux
    build_windows
    
    verify_packages
    create_deployment_info
    
    echo ""
    print_success "Build completed successfully!"
    echo ""
    echo "Packages created:"
    ls -lh dist-builds/*.AppImage dist-builds/*.exe 2>/dev/null || true
    echo ""
    echo "Deployment information: dist-builds/DEPLOYMENT_INFO.md"
}

# Handle command line arguments
case "${1:-all}" in
    "linux")
        check_prerequisites
        prepare_linux_binaries
        prepare_databases
        clean_builds
        install_dependencies
        build_renderer
        build_linux
        verify_packages
        ;;
    "windows")
        check_prerequisites
        prepare_databases
        clean_builds
        install_dependencies
        build_renderer
        build_windows
        verify_packages
        ;;
    "clean")
        clean_builds
        ;;
    "deps")
        install_dependencies
        ;;
    "all"|"")
        main
        ;;
    *)
        echo "Usage: $0 [linux|windows|clean|deps|all]"
        echo ""
        echo "Commands:"
        echo "  linux    - Build Linux AppImage only"
        echo "  windows  - Build Windows portable only"
        echo "  clean    - Clean build directories"
        echo "  deps     - Install dependencies only"
        echo "  all      - Build both packages (default)"
        exit 1
        ;;
esac
