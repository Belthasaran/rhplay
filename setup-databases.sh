#!/bin/bash

# Database Setup Script for RHTools
# Ensures database files are properly placed and accessible

set -e

echo "🗄️  RHTools Database Setup"
echo "========================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

# Check if we're in a packaged environment
is_packaged() {
    if [ -n "$ELECTRON_IS_PACKAGED" ] || [ -n "$APPIMAGE" ] || [[ "$0" == *".exe" ]]; then
        return 0
    else
        return 1
    fi
}

# Get the appropriate database directory
get_db_directory() {
    if is_packaged; then
        # In packaged app, use user data directory
        if [ -n "$APPIMAGE" ]; then
            # Linux AppImage
            echo "$HOME/.config/rhtools"
        elif [[ "$0" == *".exe" ]]; then
            # Windows portable
            echo "$APPDATA/rhtools"
        else
            # Generic packaged
            echo "$HOME/.config/rhtools"
        fi
    else
        # Development mode
        echo "electron"
    fi
}

# Setup database directory
setup_db_directory() {
    local db_dir=$(get_db_directory)
    
    print_status "Setting up database directory: $db_dir"
    
    # Create directory if it doesn't exist
    mkdir -p "$db_dir"
    
    # Copy database files if they don't exist
    local source_dir="electron"
    if is_packaged; then
        # In packaged app, databases should be in resources
        source_dir="resources"
    fi
    
    # Copy each database file
    for db_file in "rhdata.db" "patchbin.db" "clientdata.db"; do
        local source_path="$source_dir/$db_file"
        local dest_path="$db_dir/$db_file"
        
        if [ -f "$source_path" ] && [ ! -f "$dest_path" ]; then
            cp "$source_path" "$dest_path"
            print_success "Copied $db_file to $db_dir"
        elif [ -f "$dest_path" ]; then
            print_status "$db_file already exists in $db_dir"
        else
            print_warning "$db_file not found in $source_dir"
        fi
    done
    
    echo "$db_dir"
}

# Set environment variables for database paths
set_db_env_vars() {
    local db_dir=$(setup_db_directory)
    
    export RHDATA_DB_PATH="$db_dir/rhdata.db"
    export PATCHBIN_DB_PATH="$db_dir/patchbin.db"
    export CLIENTDATA_DB_PATH="$db_dir/clientdata.db"
    
    print_status "Database paths set:"
    print_status "  RHDATA_DB_PATH: $RHDATA_DB_PATH"
    print_status "  PATCHBIN_DB_PATH: $PATCHBIN_DB_PATH"
    print_status "  CLIENTDATA_DB_PATH: $CLIENTDATA_DB_PATH"
}

# Main function
main() {
    if [ "$1" = "--env" ]; then
        # Just set environment variables
        set_db_env_vars
    else
        # Full setup
        setup_db_directory
        set_db_env_vars
        print_success "Database setup completed"
    fi
}

# Run main function
main "$@"
