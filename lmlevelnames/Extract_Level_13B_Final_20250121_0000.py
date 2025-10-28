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

def extract_all_level_names(rom_path):
    """Extract all level names including 0x13B"""
    
    with open(rom_path, 'rb') as f:
        rom_data = f.read()
    
    is_headered = len(rom_data) % 0x400 == 0x200
    header_offset = 512 if is_headered else 0
    
    print("=== EXTRACTING ALL LEVEL NAMES ===")
    print(f"ROM size: {len(rom_data):,} bytes")
    
    # Get the primary pointer
    snes_pointer_addr = 0x03BB57
    rom_pointer_addr = snes_to_rom_offset(snes_pointer_addr, header_offset)
    
    patch_pointer = (rom_data[rom_pointer_addr] |
                     rom_data[rom_pointer_addr + 1] << 8 |
                     rom_data[rom_pointer_addr + 2] << 16)
    
    data_rom_offset = snes_to_rom_offset(patch_pointer, header_offset)
    
    print(f"Data ROM offset: ${data_rom_offset:06X}")
    
    # Extract level names beyond the RATS boundary
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
        0x13B: "???",  # We'll find this!
    }
    
    print(f"\n=== EXTRACTING TARGET LEVEL NAMES ===")
    
    level_names = {}
    
    for level_id in sorted(target_levels.keys()):
        offset = level_id * LEVEL_NAME_SIZE
        addr = data_rom_offset + offset
        
        if addr + LEVEL_NAME_SIZE > len(rom_data):
            print(f"Level 0x{level_id:03X}: beyond ROM size")
            continue
        
        level_data = rom_data[addr:addr + LEVEL_NAME_SIZE]
        has_name = any(b != 0 for b in level_data)
        
        level_names[level_id] = {
            'level_id': level_id,
            'level_id_hex': f"{level_id:03X}",
            'expected': target_levels[level_id],
            'has_name': has_name,
            'raw_bytes': level_data,
            'hex': level_data.hex()
        }
        
        status = "HAS DATA" if has_name else "EMPTY"
        print(f"{status}: Level 0x{level_id:03X}: Expected '{target_levels[level_id]}'")
        if has_name:
            print(f"         Raw: {level_data.hex()}")
            print(f"         Bytes: {' '.join(f'{b:02X}' for b in level_data)}")
    
    # Level 13B specifically
    print(f"\n=== LEVEL 13B (0x13B = {0x13B}) ===")
    if 0x13B in level_names:
        level_13B = level_names[0x13B]
        if level_13B['has_name']:
            print(f"SUCCESS: Level 13B has data!")
            print(f"ROM offset: ${data_rom_offset + (0x13B * LEVEL_NAME_SIZE):06X}")
            print(f"Raw tile data: {level_13B['hex']}")
            print(f"Formatted: {' '.join(f'{b:02X}' for b in level_13B['raw_bytes'])}")
        else:
            print(f"Level 13B is empty (all zeros)")
    
    return level_names

def main():
    rom_file = "Akogare_lm333_edited.sfc"
    
    try:
        level_names = extract_all_level_names(rom_file)
        
        print(f"\n=== SUMMARY ===")
        print(f"Extracted {len(level_names)} target level names")
        
        has_data_count = sum(1 for ln in level_names.values() if ln['has_name'])
        print(f"Levels with data: {has_data_count}")
        
        print(f"\n=== NEXT STEP ===")
        print("Decode the tile data using SMW character mapping")
        print("The data extends beyond the RATS tag boundary")
        print("Lunar Magic allocates more space than the RATS tag indicates")
    
    except FileNotFoundError:
        print(f"ERROR: Could not find {rom_file}")

if __name__ == "__main__":
    main()

