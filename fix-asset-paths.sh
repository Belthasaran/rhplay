#!/bin/bash

# Post-build script to fix asset paths in HTML files
# This ensures the frontend loads correctly in packaged apps

echo "🔧 Fixing asset paths in HTML files..."

# Find all index.html files in the renderer dist directory
find electron/renderer/dist -name "index.html" -type f | while read html_file; do
    echo "Processing: $html_file"
    
    # Replace absolute paths with relative paths
    sed -i 's|src="/assets/|src="./assets/|g' "$html_file"
    sed -i 's|href="/assets/|href="./assets/|g' "$html_file"
    
    echo "Fixed asset paths in $html_file"
done

echo "✅ Asset path fixing completed!"
