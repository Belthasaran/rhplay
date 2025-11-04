#!/usr/bin/env python3
"""
Create ICNS file from iconset directory on Linux
Works cross-platform using Python and PIL/Pillow
"""

import os
import sys
import struct
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Error: PIL/Pillow not installed. Install with: pip install Pillow")
    sys.exit(1)

def create_icns_from_iconset(iconset_dir, output_file):
    """Create ICNS file from iconset directory"""
    iconset_path = Path(iconset_dir)
    
    if not iconset_path.exists():
        print(f"Error: Iconset directory not found: {iconset_dir}")
        return False
    
    # Required icon sizes for ICNS
    required_sizes = {
        'icon_16x16.png': 16,
        'icon_16x16@2x.png': 32,
        'icon_32x32.png': 32,
        'icon_32x32@2x.png': 64,
        'icon_128x128.png': 128,
        'icon_128x128@2x.png': 256,
        'icon_256x256.png': 256,
        'icon_256x256@2x.png': 512,
        'icon_512x512.png': 512,
        'icon_512x512@2x.png': 1024
    }
    
    # Load and validate images
    images = {}
    for filename, size in required_sizes.items():
        filepath = iconset_path / filename
        if filepath.exists():
            try:
                img = Image.open(filepath)
                # Convert to RGBA if needed
                if img.mode != 'RGBA':
                    img = img.convert('RGBA')
                # Resize if needed
                if img.size != (size, size):
                    img = img.resize((size, size), Image.Resampling.LANCZOS)
                images[filename] = img
            except Exception as e:
                print(f"Warning: Could not load {filename}: {e}")
        else:
            print(f"Warning: Missing {filename}, will skip")
    
    if not images:
        print("Error: No valid images found in iconset")
        return False
    
    # ICNS file format structure
    # ICNS format: header (8 bytes) + icon entries
    # Each entry: type (4 bytes) + size (4 bytes) + data
    
    # ICNS header
    icns_data = bytearray(b'icns')
    icns_data.extend(struct.pack('>I', 0))  # Placeholder for total size
    
    # ICNS entry types for different sizes
    icns_types = {
        16: b'is32',   # 16x16
        32: b'it32',   # 32x32
        128: b'ih32',  # 128x128
        256: b'il32',  # 256x256
        512: b'ic09',  # 512x512
        1024: b'ic10'  # 1024x1024 (512x512@2x)
    }
    
    # Map icon files to sizes
    icon_sizes = {
        'icon_16x16.png': 16,
        'icon_16x16@2x.png': 32,
        'icon_32x32.png': 32,
        'icon_32x32@2x.png': 64,
        'icon_128x128.png': 128,
        'icon_128x128@2x.png': 256,
        'icon_256x256.png': 256,
        'icon_256x256@2x.png': 512,
        'icon_512x512.png': 512,
        'icon_512x512@2x.png': 1024
    }
    
    # Add each icon to ICNS
    for filename, img in images.items():
        size = icon_sizes.get(filename, 0)
        if size == 0:
            continue
        
        # Use appropriate ICNS type
        icns_type = icns_types.get(size)
        if not icns_type:
            # For sizes not directly mapped, use closest
            if size <= 32:
                icns_type = b'is32'
            elif size <= 128:
                icns_type = b'it32'
            elif size <= 256:
                icns_type = b'il32'
            elif size <= 512:
                icns_type = b'ic09'
            else:
                icns_type = b'ic10'
        
        # Convert image to PNG bytes
        import io
        png_buffer = io.BytesIO()
        img.save(png_buffer, format='PNG')
        png_data = png_buffer.getvalue()
        
        # Add ICNS entry
        icns_data.extend(icns_type)
        icns_data.extend(struct.pack('>I', len(png_data) + 8))  # Entry size (type + size + data)
        icns_data.extend(png_data)
    
    # Update total size in header
    total_size = len(icns_data)
    struct.pack_into('>I', icns_data, 4, total_size)
    
    # Write ICNS file
    try:
        with open(output_file, 'wb') as f:
            f.write(icns_data)
        print(f"✅ Created ICNS file: {output_file}")
        return True
    except Exception as e:
        print(f"Error writing ICNS file: {e}")
        return False

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python3 create-icns-linux.py <iconset_dir> <output.icns>")
        sys.exit(1)
    
    iconset_dir = sys.argv[1]
    output_file = sys.argv[2]
    
    success = create_icns_from_iconset(iconset_dir, output_file)
    sys.exit(0 if success else 1)

