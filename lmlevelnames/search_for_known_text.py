#!/usr/bin/env python3
"""
Search ROM for known level name text patterns
Convert text to tile bytes and search
"""

import sys

DEFAULT_TILE_MAP = {
    'A': 0x00, 'B': 0x01, 'C': 0x02, 'D': 0x03, 'E': 0x04, 'F': 0x05,
    'G': 0x06, 'H': 0x07, 'I': 0x08, 'J': 0x09, 'K': 0x0A, 'L': 0x0B,
    'M': 0x0C, 'N': 0x0D, 'O': 0x0E, 'P': 0x0F, 'Q': 0x10, 'R': 0x11,
    'S': 0x12, 'T': 0x13, 'U': 0x14, 'V': 0x15, 'W': 0x16, 'X': 0x17,
    'Y': 0x18, 'Z': 0x19, 'a': 0x1A, 'b': 0x1B, 'c': 0x1C, 'd': 0x1D,
    'e': 0x1E, 'f': 0x1F, 'g': 0x20, 'h': 0x21, 'i': 0x22, 'j': 0x23,
    'k': 0x24, 'l': 0x25, 'm': 0x26, 'n': 0x27, 'o': 0x28, 'p': 0x29,
    'q': 0x2A, 'r': 0x2B, 'c': 0x2C, 's': 0x2D, 't': 0x2E, 'u': 0x2F,
    'v': 0x30, 'w': 0x31, 'x': 0x32, 'y': 0x33, 'z': 0x34, '!': 0x35,
    '?': 0x36, '.': 0x37, ',': 0x38, '0': 0x39, '1': 0x3A, '2': 0x3B,
    '3': 0x3C, '4': 0x3D, '5': 0x3E, '6': 0x3F, '7': 0x40, '8': 0x41,
    '9': 0x42, '#': 0x43, '-': 0x44, '(': 0x45, ')': 0x46, "'": 0x47,
    '/': 0x48, ':': 0x49, ' ': 0xFC
}

def text_to_tiles(text, tile_map):
    """Convert text to tile bytes"""
    tiles = []
    for char in text:
        if char in tile_map:
            tiles.append(tile_map[char])
        else:
            # Try uppercase
            if char.upper() in tile_map:
                tiles.append(tile_map[char.upper()])
    return bytes(tiles)

def search_pattern(rom_data, pattern, name):
    """Search for byte pattern in ROM"""
    matches = []
    
    for i in range(len(rom_data) - len(pattern)):
        if rom_data[i:i+len(pattern)] == pattern:
            matches.append(i)
    
    if matches:
        print(f"\nFound '{name}':")
        for offset in matches:
            # Show context
            context_start = max(0, offset - 19)
            context = rom_data[context_start:offset+len(pattern)+19]
            hex_str = ' '.join(f'{b:02X}' for b in context)
            
            print(f"  ROM ${offset:06X}:")
            print(f"    Context: {hex_str}")
            
            # Calculate level index if 19-byte aligned
            if offset % 19 == 0:
                level_idx = offset // 19
                print(f"    If 19-byte format: Level index {level_idx} (0x{level_idx:03X})")
    
    return matches

def main():
    if len(sys.argv) < 2:
        print("Usage: python search_for_known_text.py <rom_file>")
        sys.exit(1)
    
    rom_path = sys.argv[1]
    
    with open(rom_path, 'rb') as f:
        rom_data = bytearray(f.read())
    
    print(f"Searching ROM: {rom_path}")
    print(f"ROM Size: {len(rom_data):,} bytes")
    print()
    
    # Search for known level names
    search_names = [
        "SHELL SUMMIT",
        "CLAUSTROPHOBIA",
        "INVICTUS",
        "STELLAR",
        "RISE AGAIN",
        "KOOPA ROAD",
        "CREDITS",
        "BIOHAZARD",
        "FROSTBITE"
    ]
    
    print("=" * 80)
    print("SEARCHING FOR KNOWN LEVEL NAMES (Standard Tile Mapping)")
    print("=" * 80)
    
    all_matches = {}
    for name in search_names:
        pattern = text_to_tiles(name, DEFAULT_TILE_MAP)
        print(f"\nSearching for: {name}")
        print(f"  Pattern: {' '.join(f'{b:02X}' for b in pattern)}")
        
        matches = search_pattern(rom_data, pattern, name)
        if matches:
            all_matches[name] = matches
        else:
            print(f"  NOT FOUND")
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Found {len(all_matches)} out of {len(search_names)} names")
    
    if all_matches:
        print("\nUnique ROM offsets found:")
        unique_offsets = sorted(set(offset for matches in all_matches.values() for offset in matches))
        for offset in unique_offsets:
            names_at_offset = [name for name, matches in all_matches.items() if offset in matches]
            print(f"  ${offset:06X}: {', '.join(names_at_offset)}")
        
        # Check if they cluster around any address
        if len(unique_offsets) > 1:
            print("\nChecking for clusters...")
            for i in range(len(unique_offsets) - 1):
                distance = unique_offsets[i+1] - unique_offsets[i]
                if distance < 10000:  # Within 10KB
                    print(f"  ${unique_offsets[i]:06X} and ${unique_offsets[i+1]:06X} are {distance} bytes apart")
    else:
        print("\nNO MATCHES FOUND!")
        print("This suggests:")
        print("  1. Invictus uses a different tile mapping than standard LM")
        print("  2. Level names may be compressed or encoded")
        print("  3. The exit IDs in the file may not correspond to level IDs")

if __name__ == '__main__':
    main()

