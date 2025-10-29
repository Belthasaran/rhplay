#!/usr/bin/env python3
"""
Extract level names from Invictus 1.1
Uses correct offset and tile mapping
"""

# Standard mapping with 0x1F as blank (not 0xFC)
INVICTUS_TILE_MAP = {
    0x00: 'A', 0x01: 'B', 0x02: 'C', 0x03: 'D', 0x04: 'E', 0x05: 'F',
    0x06: 'G', 0x07: 'H', 0x08: 'I', 0x09: 'J', 0x0A: 'K', 0x0B: 'L',
    0x0C: 'M', 0x0D: 'N', 0x0E: 'O', 0x0F: 'P', 0x10: 'Q', 0x11: 'R',
    0x12: 'S', 0x13: 'T', 0x14: 'U', 0x15: 'V', 0x16: 'W', 0x17: 'X',
    0x18: 'Y', 0x19: 'Z', 0x1A: 'a', 0x1B: 'b', 0x1C: 'c', 0x1D: 'd',
    0x1E: 'e', 0x1F: ' ',  # BLANK - different from standard 0xFC
    0x20: 'g', 0x21: 'h', 0x22: 'i', 0x23: 'j',
    0x24: 'k', 0x25: 'l', 0x26: 'm', 0x27: 'n', 0x28: 'o', 0x29: 'p',
    0x2A: 'q', 0x2B: 'r', 0x2C: 'c', 0x2D: 's', 0x2E: 't', 0x2F: 'u',
    0x30: 'v', 0x31: 'w', 0x32: 'x', 0x33: 'y', 0x34: 'z', 0x35: '!',
    0x36: '?', 0x37: '.', 0x38: ',', 0x39: '0', 0x3A: '1', 0x3B: '2',
    0x3C: '3', 0x3D: '4', 0x3E: '5', 0x3F: '6', 0x40: '7', 0x41: '8',
    0x42: '9', 0x43: '#', 0x44: '-', 0x45: '(', 0x46: ')', 0x47: "'",
    0x48: '/', 0x49: ':', 0x5A: '[', 0x5B: '[', 0x5C: ']', 0x5D: ']',
    0x64: '#', 0x65: '~', 0x66: '~', 0x68: '~', 0x69: '~'
}

def extract_invictus_names(rom_path='Invictus_1.1.sfc'):
    """Extract level names from Invictus"""
    
    with open(rom_path, 'rb') as f:
        rom_data = f.read()
    
    # Actual location of level names in Invictus
    offset = 0x2D6BDF
    
    print(f"Extracting level names from: {rom_path}")
    print(f"Data offset: ${offset:06X}")
    print()
    
    names_found = 0
    
    for i in range(300):  # Extract up to 300 level names
        chunk_offset = offset + (i * 19)
        
        if chunk_offset + 19 > len(rom_data):
            break
        
        chunk = rom_data[chunk_offset:chunk_offset+19]
        
        # Decode
        decoded = []
        for byte in chunk:
            if byte in INVICTUS_TILE_MAP:
                decoded.append(INVICTUS_TILE_MAP[byte])
            else:
                decoded.append('?')
        
        decoded_str = ''.join(decoded).rstrip()
        
        # Only show non-empty names
        if decoded_str and decoded_str != '?' * 19:
            print(f"Level {i:3d}: {decoded_str}")
            names_found += 1
    
    print()
    print(f"Total names found: {names_found}")

if __name__ == '__main__':
    extract_invictus_names()

