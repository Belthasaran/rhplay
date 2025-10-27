#!/bin/bash

# macOS Asset Generation Script
# Creates placeholder assets for macOS builds

echo "🎨 Creating macOS build assets..."

# Create assets directory
mkdir -p assets

# Create a simple DMG background (placeholder)
echo "Creating DMG background placeholder..."
cat > assets/dmg-background.svg << 'EOF'
<svg width="540" height="380" xmlns="http://www.w3.org/2000/svg">
  <rect width="540" height="380" fill="#f0f0f0"/>
  <text x="270" y="190" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#333">
    RHTools
  </text>
  <text x="270" y="220" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#666">
    Drag to Applications folder
  </text>
</svg>
EOF

# Convert SVG to PNG (if ImageMagick is available)
if command -v convert &> /dev/null; then
    echo "Converting SVG to PNG..."
    convert assets/dmg-background.svg assets/dmg-background.png
    echo "✅ DMG background created: assets/dmg-background.png"
else
    echo "⚠️  ImageMagick not found. Please convert assets/dmg-background.svg to PNG manually."
    echo "   Or install ImageMagick: sudo apt install imagemagick"
fi

# Create a simple icon placeholder
echo "Creating icon placeholder..."
cat > assets/icon.svg << 'EOF'
<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#2563eb" rx="80"/>
  <text x="256" y="280" text-anchor="middle" font-family="Arial, sans-serif" font-size="120" fill="white" font-weight="bold">
    RH
  </text>
  <text x="256" y="350" text-anchor="middle" font-family="Arial, sans-serif" font-size="40" fill="white">
    Tools
  </text>
</svg>
EOF

# Convert SVG to ICO (if ImageMagick is available)
if command -v convert &> /dev/null; then
    echo "Converting icon SVG to ICO..."
    convert assets/icon.svg -resize 512x512 assets/icon.ico
    echo "✅ Icon created: assets/icon.ico"
    
    # Create ICNS file for macOS
    echo "Creating macOS ICNS file..."
    mkdir -p assets/icon.iconset
    
    # Generate different sizes for ICNS
    convert assets/icon.svg -resize 16x16 assets/icon.iconset/icon_16x16.png
    convert assets/icon.svg -resize 32x32 assets/icon.iconset/icon_16x16@2x.png
    convert assets/icon.svg -resize 32x32 assets/icon.iconset/icon_32x32.png
    convert assets/icon.svg -resize 64x64 assets/icon.iconset/icon_32x32@2x.png
    convert assets/icon.svg -resize 128x128 assets/icon.iconset/icon_128x128.png
    convert assets/icon.svg -resize 256x256 assets/icon.iconset/icon_128x128@2x.png
    convert assets/icon.svg -resize 256x256 assets/icon.iconset/icon_256x256.png
    convert assets/icon.svg -resize 512x512 assets/icon.iconset/icon_256x256@2x.png
    convert assets/icon.svg -resize 512x512 assets/icon.iconset/icon_512x512.png
    convert assets/icon.svg -resize 1024x1024 assets/icon.iconset/icon_512x512@2x.png
    
    # Create ICNS file
    if command -v iconutil &> /dev/null; then
        iconutil -c icns assets/icon.iconset -o assets/icon.icns
        echo "✅ macOS icon created: assets/icon.icns"
    else
        echo "⚠️  iconutil not found. Please run this script on macOS to create ICNS file."
        echo "   Or manually convert the PNG files in assets/icon.iconset/ to ICNS format."
    fi
else
    echo "⚠️  ImageMagick not found. Please convert assets/icon.svg to ICO and ICNS manually."
    echo "   Or install ImageMagick: sudo apt install imagemagick"
fi

echo ""
echo "🎯 macOS assets created!"
echo "📁 Assets directory: assets/"
echo ""
echo "📋 Next steps:"
echo "   1. If ImageMagick is not available, manually convert:"
echo "      - assets/dmg-background.svg → assets/dmg-background.png"
echo "      - assets/icon.svg → assets/icon.ico"
echo "      - assets/icon.svg → assets/icon.icns (macOS only)"
echo ""
echo "   2. For production builds, replace placeholder assets with:"
echo "      - Professional icon design"
echo "      - Branded DMG background"
echo ""
echo "   3. Test macOS build: npm run build:mac"
