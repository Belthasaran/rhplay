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

# Complete Lunar Magic tile-to-character mapping
TILE_MAP = {
    # Row 1: A-P
    0x00: 'A', 0x01: 'B', 0x02: 'C', 0x03: 'D', 0x04: 'E', 0x05: 'F',
    0x06: 'G', 0x07: 'H', 0x08: 'I', 0x09: 'J', 0x0A: 'K', 0x0B: 'L',
    0x0C: 'M', 0x0D: 'N', 0x0E: 'O', 0x0F: 'P',
    
    # Row 2: Q-Z, punctuation
    0x10: 'Q', 0x11: 'R', 0x12: 'S', 0x13: 'T', 0x14: 'U', 0x15: 'V',
    0x16: 'W', 0x17: 'X', 0x18: 'Y', 0x19: 'Z', 0x1A: '!', 0x1B: '.',
    0x1C: '-', 0x1D: ',', 0x1E: '?', 0x1F: ' ',
    
    # Row 5: lowercase a-p
    0x40: 'a', 0x41: 'b', 0x42: 'c', 0x43: 'd', 0x44: 'e', 0x45: 'f',
    0x46: 'g', 0x47: 'h', 0x48: 'i', 0x49: 'j', 0x4A: 'k', 0x4B: 'l',
    0x4C: 'm', 0x4D: 'n', 0x4E: 'o', 0x4F: 'p',
    
    # Row 6: lowercase q-z, special characters
    0x50: 'q', 0x51: 'r', 0x52: 's', 0x53: 't', 0x54: 'u', 0x55: 'v',
    0x56: 'w', 0x57: 'x', 0x58: 'y', 0x59: 'z', 0x5A: '#', 0x5B: '(',
    0x5C: ')', 0x5D: "'",
}

def decode_level_name(tile_data):
    """Decode a level name from tile data"""
    decoded = []
    for byte in tile_data:
        if byte in TILE_MAP:
            decoded.append(TILE_MAP[byte])
        elif byte == 0x00 or byte == 0xFF:
            # Skip padding
            continue
        else:
            decoded.append(f'[{byte:02X}]')
    
    return ''.join(decoded).strip()

def extract_all_level_names_complete(rom_path):
    """Extract all level names from both blocks"""
    
    with open(rom_path, 'rb') as f:
        rom_data = f.read()
    
    is_headered = len(rom_data) % 0x400 == 0x200
    header_offset = 512 if is_headered else 0
    
    print("=== COMPLETE LEVEL NAME EXTRACTION ===")
    print(f"ROM size: {len(rom_data):,} bytes")
    print(f"Header offset: {header_offset}")
    
    LEVEL_NAME_SIZE = 19
    
    # Block 1: Levels 0x000-0x0FF at SNES $11EA9A
    snes_pointer_addr = 0x03BB57
    rom_pointer_addr = snes_to_rom_offset(snes_pointer_addr, header_offset)
    
    patch_pointer = (rom_data[rom_pointer_addr] |
                     rom_data[rom_pointer_addr + 1] << 8 |
                     rom_data[rom_pointer_addr + 2] << 16)
    
    block_0_rom = snes_to_rom_offset(patch_pointer, header_offset)
    
    # Block 2: Levels 0x100-0x1FF at ROM $08EF46
    block_1_rom = 0x08EF46
    
    print(f"\nBlock 0 (0x000-0x0FF): ROM ${block_0_rom:06X} (SNES ${patch_pointer:06X})")
    print(f"Block 1 (0x100-0x1FF): ROM ${block_1_rom:06X}")
    
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
        # Determine which block to use
        if level_id < 0x100:
            block_offset = block_0_rom
            offset_in_block = level_id * LEVEL_NAME_SIZE
        else:
            block_offset = block_1_rom
            offset_in_block = (level_id - 0x100) * LEVEL_NAME_SIZE
        
        level_offset = block_offset + offset_in_block
        
        if level_offset + LEVEL_NAME_SIZE > len(rom_data):
            print(f"Level 0x{level_id:03X}: beyond ROM size")
            continue
        
        level_data = rom_data[level_offset:level_offset + LEVEL_NAME_SIZE]
        has_name = any(b != 0 and b != 0x1F and b != 0xFF for b in level_data)
        
        if not has_name:
            continue
        
        decoded = decode_level_name(level_data)
        expected = target_levels[level_id]
        
        # Check if decoded matches expected
        match = decoded == expected
        if match:
            matches += 1
        
        level_names[level_id] = {
            'level_id': level_id,
            'expected': expected,
            'decoded': decoded,
            'match': match,
            'rom_offset': level_offset,
            'hex': level_data.hex()
        }
        
        status = "MATCH" if match else "DIFF"
        print(f"{status}: Level 0x{level_id:03X}")
        print(f"  Expected: '{expected}'")
        print(f"  Decoded:  '{decoded}'")
        if not match:
            print(f"  Hex:      {level_data.hex()}")
    
    print(f"\n=== SUMMARY ===")
    print(f"Total levels extracted: {len(level_names)}")
    print(f"Exact matches: {matches}")
    print(f"Differences: {len(level_names) - matches}")
    
    # Show level 13B specifically
    if 0x13B in level_names:
        print(f"\n=== LEVEL 13B ===")
        level_13B = level_names[0x13B]
        print(f"ROM offset: ${level_13B['rom_offset']:06X}")
        print(f"Expected: '{level_13B['expected']}'")
        print(f"Decoded:  '{level_13B['decoded']}'")
        print(f"Status: {'MATCH' if level_13B['match'] else 'DIFF'}")
    
    print(f"\n=== EXTRACTION METHOD SUMMARY ===")
    print("1. Levels 0x000-0x0FF: Use pointer at SNES $03BB57")
    print("2. Levels 0x100-0x1FF: Separate block at ROM $08EF46")
    print("3. Each level name is 19 bytes")
    print("4. Decode using Lunar Magic tile mapping")
    
    return level_names

def main():
    rom_file = "Akogare_lm333_edited.sfc"
    
    try:
        level_names = extract_all_level_names_complete(rom_file)
        
        print(f"\n=== SUCCESS ===")
        print(f"Successfully extracted and decoded level names from")
        print(f"Lunar Magic 3.33 edited ROM: {rom_file}")
    
    except FileNotFoundError:
        print(f"ERROR: Could not find {rom_file}")

if __name__ == "__main__":
    main()

