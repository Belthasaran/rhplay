#!/usr/bin/env python3
"""
Reverse-engineer tile mapping using known level names
Compares known text with raw bytes to deduce character mappings
"""

import sys
from collections import defaultdict

DEFAULT_TILE_MAP = {
    0x00: 'A', 0x01: 'B', 0x02: 'C', 0x03: 'D', 0x04: 'E', 0x05: 'F',
    0x06: 'G', 0x07: 'H', 0x08: 'I', 0x09: 'J', 0x0A: 'K', 0x0B: 'L',
    0x0C: 'M', 0x0D: 'N', 0x0E: 'O', 0x0F: 'P', 0x10: 'Q', 0x11: 'R',
    0x12: 'S', 0x13: 'T', 0x14: 'U', 0x15: 'V', 0x16: 'W', 0x17: 'X',
    0x18: 'Y', 0x19: 'Z', 0x1A: 'a', 0x1B: 'b', 0x1C: 'c', 0x1D: 'd',
    0x1E: 'e', 0x1F: 'f', 0x20: 'g', 0x21: 'h', 0x22: 'i', 0x23: 'j',
    0x24: 'k', 0x25: 'l', 0x26: 'm', 0x27: 'n', 0x28: 'o', 0x29: 'p',
    0x2A: 'q', 0x2B: 'r', 0x2C: 'c', 0x2D: 's', 0x2E: 't', 0x2F: 'u',
    0x30: 'v', 0x31: 'w', 0x32: 'x', 0x33: 'y', 0x34: 'z', 0x35: '!',
    0x36: '?', 0x37: '.', 0x38: ',', 0x39: '0', 0x3A: '1', 0x3B: '2',
    0x3C: '3', 0x3D: '4', 0x3E: '5', 0x3F: '6', 0x40: '7', 0x41: '8',
    0x42: '9', 0x43: '#', 0x44: '-', 0x45: '(', 0x46: ')', 0x47: "'",
    0x48: '/', 0x49: ':', 0xFC: ' '
}

def load_known_names(filename):
    """Load known level names from file"""
    known_names = {}
    
    with open(filename, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or not line[0].isdigit():
                continue
            
            # Parse "001 SHELL SUMMIT" format
            parts = line.split(None, 1)
            if len(parts) == 2:
                level_id_str, name = parts
                level_id = int(level_id_str, 16)
                known_names[level_id] = name
    
    return known_names

def extract_raw_level_data(rom_data, offset, level_id):
    """Extract raw 19-byte level name data"""
    level_offset = offset + (level_id * 19)
    return rom_data[level_offset:level_offset+19]

def analyze_character_mappings(rom_data, offset, known_names):
    """
    Compare known names with raw bytes to deduce tile mappings
    """
    print("=" * 80)
    print("REVERSE-ENGINEERING TILE MAPPING")
    print("=" * 80)
    print()
    
    # Store potential mappings: byte_value -> {character: count}
    byte_to_char_candidates = defaultdict(lambda: defaultdict(int))
    
    # For each known level name
    for level_id, known_name in sorted(known_names.items()):
        raw_bytes = extract_raw_level_data(rom_data, offset, level_id)
        
        print(f"Level 0x{level_id:03X}: {known_name}")
        print(f"  Raw: {' '.join(f'{b:02X}' for b in raw_bytes)}")
        
        # Pad name to 19 characters
        padded_name = known_name.ljust(19)
        
        # Compare byte-by-byte
        for i, (byte_val, char) in enumerate(zip(raw_bytes, padded_name)):
            if char == ' ' and i >= len(known_name):
                # Trailing space/padding
                byte_to_char_candidates[byte_val]['[BLANK]'] += 1
            elif char == ' ':
                # Space within name
                byte_to_char_candidates[byte_val][' '] += 1
            else:
                # Actual character
                byte_to_char_candidates[byte_val][char] += 1
        
        # Try to decode with current mapping
        decoded = []
        for b in raw_bytes:
            if b in DEFAULT_TILE_MAP:
                decoded.append(DEFAULT_TILE_MAP[b])
            else:
                decoded.append(f'?')
        
        decoded_str = ''.join(decoded).rstrip()
        match = "MATCH!" if decoded_str.upper() == known_name.upper() else "MISMATCH"
        print(f"  Current decode: {decoded_str} [{match}]")
        print()
    
    return byte_to_char_candidates

def deduce_mapping(byte_to_char_candidates):
    """
    Deduce the most likely character mapping for each byte
    """
    print("=" * 80)
    print("DEDUCED CHARACTER MAPPINGS")
    print("=" * 80)
    print()
    
    deduced_map = {}
    
    # Sort by byte value
    for byte_val in sorted(byte_to_char_candidates.keys()):
        candidates = byte_to_char_candidates[byte_val]
        
        # Find most common character for this byte
        if candidates:
            most_common_char = max(candidates.items(), key=lambda x: x[1])
            char, count = most_common_char
            
            # Show all candidates
            all_candidates = ', '.join(f"{c}({n})" for c, n in sorted(candidates.items(), key=lambda x: x[1], reverse=True))
            
            deduced_map[byte_val] = char if char != '[BLANK]' else ' '
            
            # Check against default mapping
            default = DEFAULT_TILE_MAP.get(byte_val, '???')
            match_str = "[OK]" if default == deduced_map[byte_val] else f"[DIFF: was '{default}']"
            
            print(f"${byte_val:02X} -> '{deduced_map[byte_val]}' {match_str}")
            print(f"      Candidates: {all_candidates}")
    
    return deduced_map

def generate_corrected_mapping(deduced_map):
    """
    Generate a corrected tile mapping
    """
    print("\n" + "=" * 80)
    print("CORRECTED TILE MAPPING")
    print("=" * 80)
    print()
    
    corrected = DEFAULT_TILE_MAP.copy()
    
    changes = []
    for byte_val, char in deduced_map.items():
        old_char = corrected.get(byte_val, '???')
        if old_char != char:
            changes.append((byte_val, old_char, char))
            corrected[byte_val] = char
    
    if changes:
        print("Changes from default mapping:")
        for byte_val, old_char, new_char in sorted(changes):
            print(f"  ${byte_val:02X}: '{old_char}' -> '{new_char}'")
    else:
        print("No changes needed - default mapping is correct!")
    
    return corrected

def test_mapping(rom_data, offset, known_names, tile_map):
    """
    Test the corrected mapping against known names
    """
    print("\n" + "=" * 80)
    print("TESTING CORRECTED MAPPING")
    print("=" * 80)
    print()
    
    matches = 0
    total = 0
    
    for level_id, known_name in sorted(known_names.items()):
        raw_bytes = extract_raw_level_data(rom_data, offset, level_id)
        
        decoded = []
        for b in raw_bytes:
            if b in tile_map:
                decoded.append(tile_map[b])
            else:
                decoded.append('?')
        
        decoded_str = ''.join(decoded).rstrip()
        
        # Compare (case-insensitive)
        match = decoded_str.upper() == known_name.upper()
        matches += 1 if match else 0
        total += 1
        
        status = "[OK]" if match else "[FAIL]"
        print(f"Level 0x{level_id:03X}: {status}")
        print(f"  Expected: {known_name}")
        print(f"  Got:      {decoded_str}")
        if not match:
            print(f"  Raw: {' '.join(f'{b:02X}' for b in raw_bytes)}")
        print()
    
    print(f"Results: {matches}/{total} matches ({matches*100/total:.1f}%)")
    
    return matches, total

def export_mapping(tile_map, filename='invictus_tile_map.py'):
    """Export the corrected mapping as a Python dictionary"""
    with open(filename, 'w') as f:
        f.write("# Invictus Tile Mapping (reverse-engineered)\n")
        f.write("# Generated by reverse_engineer_mapping.py\n\n")
        f.write("INVICTUS_TILE_MAP = {\n")
        
        for byte_val in sorted(tile_map.keys()):
            char = tile_map[byte_val]
            # Escape special characters
            if char == "'":
                char_str = "'\\''"
            elif char == "\\":
                char_str = "'\\\\'"
            else:
                char_str = f"'{char}'"
            
            f.write(f"    0x{byte_val:02X}: {char_str},\n")
        
        f.write("}\n")
    
    print(f"\nMapping exported to: {filename}")

def main():
    if len(sys.argv) < 4:
        print("Usage: python reverse_engineer_mapping.py <rom_file> <offset_hex> <known_names_file>")
        print("Example: python reverse_engineer_mapping.py Invictus_1.1.sfc 3DE1F6 invictus_exits_incomplete.txt")
        sys.exit(1)
    
    rom_path = sys.argv[1]
    offset = int(sys.argv[2], 16)
    known_names_file = sys.argv[3]
    
    print(f"ROM: {rom_path}")
    print(f"Data offset: ${offset:06X}")
    print(f"Known names: {known_names_file}")
    print()
    
    # Load data
    with open(rom_path, 'rb') as f:
        rom_data = bytearray(f.read())
    
    known_names = load_known_names(known_names_file)
    print(f"Loaded {len(known_names)} known level names\n")
    
    # Analyze
    byte_to_char = analyze_character_mappings(rom_data, offset, known_names)
    
    # Deduce mapping
    deduced_map = deduce_mapping(byte_to_char)
    
    # Generate corrected mapping
    corrected_map = generate_corrected_mapping(deduced_map)
    
    # Test it
    matches, total = test_mapping(rom_data, offset, known_names, corrected_map)
    
    # Export
    if matches == total:
        print("\n" + "=" * 80)
        print("SUCCESS! All known names matched!")
        print("=" * 80)
        export_mapping(corrected_map)
    else:
        print("\n" + "=" * 80)
        print(f"PARTIAL SUCCESS: {matches}/{total} matches")
        print("Some mappings may still need refinement")
        print("=" * 80)
        export_mapping(corrected_map)

if __name__ == '__main__':
    main()

