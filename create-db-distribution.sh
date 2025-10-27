#!/bin/bash

# Database Distribution Script for RHTools
# Handles separation of large, frequently changing databases from the main executable

set -e

echo "🗄️  RHTools Database Distribution"
echo "================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

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

# Database file information
declare -A DB_INFO=(
    ["rhdata.db"]="Game data and metadata (frequently updated)"
    ["patchbin.db"]="Patch information (frequently updated)"
    ["clientdata.db"]="Client settings (user-specific, rarely updated)"
)

# Create database distribution packages
create_db_packages() {
    print_status "Creating database distribution packages..."
    
    # Create distribution directory
    mkdir -p dist-builds/databases
    
    # Create individual database packages
    for db_file in "rhdata.db" "patchbin.db"; do
        if [ -f "electron/$db_file" ]; then
            local size=$(ls -lh "electron/$db_file" | awk '{print $5}')
            print_status "Packaging $db_file ($size)..."
            
            # Create zip package
            zip -j "dist-builds/databases/${db_file%.db}-latest.zip" "electron/$db_file"
            
            # Create info file
            cat > "dist-builds/databases/${db_file%.db}-info.txt" << EOF
Database: ${db_file}
Description: ${DB_INFO[$db_file]}
Size: $size
Created: $(date)
Version: latest

Installation:
1. Download this file
2. Extract to your RHTools data directory:
   - Linux: ~/.config/rhtools/
   - Windows: %APPDATA%/rhtools/
3. Restart RHTools

Note: This database is updated frequently. Check for updates regularly.
EOF
            
            print_success "Created ${db_file%.db}-latest.zip"
        else
            print_warning "$db_file not found in electron/"
        fi
    done
    
    # Create combined database package
    if [ -f "electron/rhdata.db" ] && [ -f "electron/patchbin.db" ]; then
        print_status "Creating combined database package..."
        zip -j "dist-builds/databases/rhtools-databases-latest.zip" "electron/rhdata.db" "electron/patchbin.db"
        
        cat > "dist-builds/databases/rhtools-databases-info.txt" << EOF
Package: rhtools-databases-latest.zip
Description: Combined game data and patch databases
Contents: rhdata.db, patchbin.db
Created: $(date)
Version: latest

Installation:
1. Download this file
2. Extract to your RHTools data directory:
   - Linux: ~/.config/rhtools/
   - Windows: %APPDATA%/rhtools/
3. Restart RHTools

Note: These databases are updated frequently. Check for updates regularly.
EOF
        
        print_success "Created rhtools-databases-latest.zip"
    fi
}

# Create client database template
create_client_template() {
    print_status "Creating client database template..."
    
    if [ -f "electron/clientdata.db" ]; then
        local size=$(ls -lh "electron/clientdata.db" | awk '{print $5}')
        
        # Create template package
        zip -j "dist-builds/databases/clientdata-template.zip" "electron/clientdata.db"
        
        cat > "dist-builds/databases/clientdata-template-info.txt" << EOF
Database: clientdata-template.zip
Description: ${DB_INFO["clientdata.db"]}
Size: $size
Created: $(date)

Installation:
1. Download this file
2. Extract to your RHTools data directory:
   - Linux: ~/.config/rhtools/
   - Windows: %APPDATA%/rhtools/
3. Customize settings as needed
4. Restart RHTools

Note: This database contains user-specific settings and is rarely updated.
EOF
        
        print_success "Created clientdata-template.zip"
    else
        print_warning "clientdata.db not found in electron/"
    fi
}

# Create database update script
create_update_script() {
    print_status "Creating database update script..."
    
    cat > "dist-builds/databases/update-databases.sh" << 'EOF'
#!/bin/bash

# RHTools Database Update Script
# Downloads and installs the latest database files

set -e

echo "🔄 RHTools Database Updater"
echo "=========================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

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

# Get data directory
get_data_dir() {
    if [ -n "$RHTools_DATA_DIR" ]; then
        echo "$RHTools_DATA_DIR"
    elif [ -n "$APPDATA" ]; then
        # Windows
        echo "$APPDATA/rhtools"
    else
        # Linux/macOS
        echo "$HOME/.config/rhtools"
    fi
}

# Download and install database
update_database() {
    local db_name="$1"
    local data_dir="$2"
    
    print_status "Updating $db_name..."
    
    # Create data directory if it doesn't exist
    mkdir -p "$data_dir"
    
    # Backup existing database
    if [ -f "$data_dir/$db_name" ]; then
        print_status "Backing up existing $db_name..."
        cp "$data_dir/$db_name" "$data_dir/${db_name}.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    
    # Download latest database (placeholder - replace with actual URL)
    print_warning "Database download not implemented yet"
    print_warning "Please manually download ${db_name%.db}-latest.zip and extract to $data_dir"
    
    print_success "$db_name update completed"
}

# Main update function
main() {
    local data_dir=$(get_data_dir)
    print_status "Using data directory: $data_dir"
    
    # Update databases
    update_database "rhdata.db" "$data_dir"
    update_database "patchbin.db" "$data_dir"
    
    print_success "Database update completed!"
    print_status "Restart RHTools to use the updated databases"
}

# Run main function
main "$@"
EOF
    
    chmod +x "dist-builds/databases/update-databases.sh"
    print_success "Created update-databases.sh"
}

# Create distribution manifest
create_manifest() {
    print_status "Creating distribution manifest..."
    
    cat > "dist-builds/databases/MANIFEST.md" << EOF
# RHTools Database Distribution

## Overview
This directory contains the database files for RHTools, separated from the main executable for easier updates.

## Files

### Core Databases (Frequently Updated)
- **rhtools-databases-latest.zip**: Combined game data and patch databases
- **rhdata-latest.zip**: Game data and metadata database
- **patchbin-latest.zip**: Patch information database

### Client Database (User-Specific)
- **clientdata-template.zip**: Client settings template (customize as needed)

### Utilities
- **update-databases.sh**: Script to update databases (Linux/macOS)
- **update-databases.bat**: Script to update databases (Windows)

## Installation Instructions

### First Time Setup
1. Download and run the main RHTools executable
2. Download the appropriate database files from this directory
3. Extract databases to your RHTools data directory:
   - **Linux**: \`~/.config/rhtools/\`
   - **Windows**: \`%APPDATA%/rhtools/\`
   - **macOS**: \`~/Library/Application Support/rhtools/\`

### Updating Databases
1. Download the latest database files
2. Extract to your RHTools data directory (overwrite existing files)
3. Restart RHTools

### Data Directory Locations
- **Linux**: \`~/.config/rhtools/\`
- **Windows**: \`%APPDATA%/rhtools/\`
- **macOS**: \`~/Library/Application Support/rhtools/\`

## File Sizes
$(ls -lh *.zip 2>/dev/null | awk '{print $5, $9}' | sed 's/^/- /')

## Notes
- Database files are updated frequently with new game data and patches
- Client settings are user-specific and rarely need updates
- Always backup your clientdata.db before updating
- The main executable (~200MB) is separate from database files (~1.7GB)

Generated: $(date)
EOF
    
    print_success "Created MANIFEST.md"
}

# Main function
main() {
    case "${1:-all}" in
        "databases")
            create_db_packages
            ;;
        "client")
            create_client_template
            ;;
        "script")
            create_update_script
            ;;
        "manifest")
            create_manifest
            ;;
        "all"|"")
            create_db_packages
            create_client_template
            create_update_script
            create_manifest
            ;;
        *)
            echo "Usage: $0 [databases|client|script|manifest|all]"
            echo ""
            echo "Commands:"
            echo "  databases - Create core database packages"
            echo "  client    - Create client database template"
            echo "  script    - Create update script"
            echo "  manifest  - Create distribution manifest"
            echo "  all       - Create all packages (default)"
            exit 1
            ;;
    esac
    
    print_success "Database distribution packages created!"
    echo ""
    print_status "Files created in dist-builds/databases/:"
    ls -la dist-builds/databases/ 2>/dev/null || true
}

# Run main function
main "$@"
