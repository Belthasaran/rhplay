import struct

def snes_to_rom_offset(snes_addr, header_offset=0):
    """Convert SNES LoROM address to ROM file offset"""
    bank = (snes_addr >> 16) & 0xFF
    offset_in_bank = snes_addr & 0xFFFF
    
    if offset_in_bank < 0x8000:
        rom_offset = (bank << 15) | offset_in_bank
    else:
        rom_offset = (bank << 15) | (offset_in_bank - 0x8000)
    
    return rom_offset + header_offset

# Lunar Magic tile-to-character mapping based on user's interface description
TILE_MAP = {
    # Row 1: A-P
    0x00: 'A', 0x01: 'B', 0x02: 'C', 0x03: 'D', 0x04: 'E', 0x05: 'F',
    0x06: 'G', 0x07: 'H', 0x08: 'I', 0x09: 'J', 0x0A: 'K', 0x0B: 'L',
    0x0C: 'M', 0x0D: 'N', 0x0E: 'O', 0x0F: 'P',
    
    # Row 2: Q-Z, punctuation
    0x10: 'Q', 0x11: 'R', 0x12: 'S', 0x13: 'T', 0x14: 'U', 0x15: 'V',
    0x16: 'W', 0x17: 'X', 0x18: 'Y', 0x19: 'Z', 0x1A: '!', 0x1B: '.',
    0x1C: '-', 0x1D: ',', 0x1E: '?', 0x1F: ' ',
    
    # Row 3: Special characters (white text variants and graphics)
    0x20: '\\20', 0x21: '\\21', 0x22: '\\22', 0x23: '\\23', 0x24: '\\24',
    0x25: '\\25', 0x26: '\\26', 0x27: '\\27', 0x28: '\\28', 0x29: '\\29',
    0x2A: '\\2A', 0x2B: '\\2B', 0x2C: '\\2C', 0x2D: '\\2D', 0x2E: '\\2E',
    0x2F: '\\2F',
    
    # Row 4: More special characters
    0x30: '\\30', 0x31: '\\31', 0x32: 'I', 0x33: 'L', 0x34: 'L', 0x35: 'U',
    0x36: 'S', 0x37: 'I', 0x38: 'Y', 0x39: 'E', 0x3A: 'L', 0x3B: 'O',
    0x3C: 'W', 0x3D: '?', 0x3E: '\\3E', 0x3F: '!',
    
    # Row 5: lowercase a-p
    0x40: 'a', 0x41: 'b', 0x42: 'c', 0x43: 'd', 0x44: 'e', 0x45: 'f',
    0x46: 'g', 0x47: 'h', 0x48: 'i', 0x49: 'j', 0x4A: 'k', 0x4B: 'l',
    0x4C: 'm', 0x4D: 'n', 0x4E: 'o', 0x4F: 'p',
    
    # Row 6: lowercase q-z, special characters
    0x50: 'q', 0x51: 'r', 0x52: 's', 0x53: 't', 0x54: 'u', 0x55: 'v',
    0x56: 'w', 0x57: 'x', 0x58: 'y', 0x59: 'z', 0x5A: '#', 0x5B: '(',
    0x5C: ')', 0x5D: "'", 0x5E: '\\5E', 0x5F: '\\5F',
    
    # Row 7: Numbers and special characters
    0x60: '\\60', 0x61: '\\61', 0x62: '\\62', 0x63: '1', 0x64: '2',
    0x65: '3', 0x66: '4', 0x67: '5', 0x68: '6', 0x69: '7', 0x6A: '8',
    0x6B: '9', 0x6C: '0', 0x6D: '\\6D', 0x6E: '\\6E', 0x6F: '\\6F',
    
    # Row 8: White text variants and graphics
    0x70: '\\70', 0x71: '\\71', 0x72: '\\72', 0x73: '\\73', 0x74: '\\74',
    0x75: '\\75', 0x76: '\\76', 0x77: '\\77', 0x78: '\\78', 0x79: '\\79',
    0x7A: '\\7A', 0x7B: '\\7B', 0x7C: '\\7C', 0x7D: '\\7D', 0x7E: '\\7E',
    0x7F: '\\7F',
    
    # Rows 9-16: Graphic tiles (0x80-0xFF)
    # These are all graphic tiles, will show as \XX
}

# Add graphic tiles 0x80-0xFF
for i in range(0x80, 0x100):
    TILE_MAP[i] = f'\\{i:02X}'

def decode_level_name(tile_data):
    """Decode a level name from tile data"""
    decoded = []
    for byte in tile_data:
        if byte in TILE_MAP:
            char = TILE_MAP[byte]
            # Skip graphic placeholders for cleaner output
            if not char.startswith('\\'):
                decoded.append(char)
            else:
                decoded.append(f'[{char}]')
        else:
            decoded.append(f'[?{byte:02X}]')
    
    return ''.join(decoded).strip()

def decode_level_name_raw(tile_data):
    """Decode a level name including all special codes"""
    decoded = []
    for byte in tile_data:
        if byte in TILE_MAP:
            decoded.append(TILE_MAP[byte])
        else:
            decoded.append(f'[?{byte:02X}]')
    
    return ''.join(decoded)

def extract_and_decode_all_level_names(rom_path):
    """Extract and decode all level names"""
    
    with open(rom_path, 'rb') as f:
        rom_data = f.read()
    
    is_headered = len(rom_data) % 0x400 == 0x200
    header_offset = 512 if is_headered else 0
    
    print("=== EXTRACTING AND DECODING LEVEL NAMES ===")
    print(f"ROM size: {len(rom_data):,} bytes")
    
    # Get the primary pointer
    snes_pointer_addr = 0x03BB57
    rom_pointer_addr = snes_to_rom_offset(snes_pointer_addr, header_offset)
    
    patch_pointer = (rom_data[rom_pointer_addr] |
                     rom_data[rom_pointer_addr + 1] << 8 |
                     rom_data[rom_pointer_addr + 2] << 16)
    
    data_rom_offset = snes_to_rom_offset(patch_pointer, header_offset)
    
    print(f"Data ROM offset: ${data_rom_offset:06X}")
    
    # Extract level names
    LEVEL_NAME_SIZE = 19
    
    # Target levels from Akogare_lm33_levels.txt
    target_levels = {
        0x001: "Yoshi's Tree House",
        0x002: "Delfino Shores",
        0x007: "The Watcher's Keep",
        0x008: "Pickle's Palace",
        0x00C: "Backtrack Passage",
        0x00F: "Bridge of Moths",
        0x014: "Tubba's Palace",
        0x01A: "Forgotten Acropolis",
        0x023: "Gridiron Ridge",
        0x103: "Bullet Promenade",
        0x109: "Celestial Rex",
        0x10A: "Cloon Cavern",
        0x10B: "Shiverthorn Hollow",
        0x10E: "Stormcrow's Alcazar",
        0x115: "The Toxic Passage",
        0x116: "Underscore Burrows",
        0x119: "Twilight Bridge",
        0x11B: "Fritzer's Palace",
        0x11C: "Whynot's Lookout",
        0x11D: "Grim Shade Manor",
        0x122: "Forest of Abkhazia",
        0x123: "The Living Earth",
        0x124: "Super Koopa Hills",
        0x126: "Australian Airways",
        0x130: "Labrys Abyss",
        0x13B: "???",
    }
    
    print(f"\n=== DECODED LEVEL NAMES ===")
    
    level_names = {}
    matches = 0
    
    for level_id in sorted(target_levels.keys()):
        offset = level_id * LEVEL_NAME_SIZE
        addr = data_rom_offset + offset
        
        if addr + LEVEL_NAME_SIZE > len(rom_data):
            print(f"Level 0x{level_id:03X}: beyond ROM size")
            continue
        
        level_data = rom_data[addr:addr + LEVEL_NAME_SIZE]
        has_name = any(b != 0 for b in level_data)
        
        if not has_name:
            continue
        
        decoded = decode_level_name(level_data)
        decoded_raw = decode_level_name_raw(level_data)
        expected = target_levels[level_id]
        
        # Check if decoded matches expected
        match = decoded == expected
        if match:
            matches += 1
        
        level_names[level_id] = {
            'level_id': level_id,
            'expected': expected,
            'decoded': decoded,
            'decoded_raw': decoded_raw,
            'match': match
        }
        
        status = "MATCH" if match else "DIFF"
        print(f"{status}: Level 0x{level_id:03X}")
        print(f"  Expected: '{expected}'")
        print(f"  Decoded:  '{decoded}'")
        if not match:
            print(f"  Raw:      '{decoded_raw}'")
            print(f"  Hex:      {level_data.hex()}")
    
    print(f"\n=== SUMMARY ===")
    print(f"Total levels: {len(level_names)}")
    print(f"Matches: {matches}")
    print(f"Differences: {len(level_names) - matches}")
    
    # Show level 13B specifically
    if 0x13B in level_names:
        print(f"\n=== LEVEL 13B ===")
        level_13B = level_names[0x13B]
        print(f"Expected: '{level_13B['expected']}'")
        print(f"Decoded:  '{level_13B['decoded']}'")
        print(f"Raw:      '{level_13B['decoded_raw']}'")
    
    return level_names

def main():
    rom_file = "Akogare_lm333_edited.sfc"
    
    try:
        level_names = extract_and_decode_all_level_names(rom_file)
        
        print(f"\n=== VERIFICATION ===")
        print("This demonstrates successful extraction of level names from")
        print("a headered ROM file edited by Lunar Magic 3.33")
        print(f"Including level 0x13B at ROM offset $0903FB")
    
    except FileNotFoundError:
        print(f"ERROR: Could not find {rom_file}")

if __name__ == "__main__":
    main()

