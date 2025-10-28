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

def find_level_100_block(rom_path):
    """Find the correct starting offset for levels 0x100+"""
    
    with open(rom_path, 'rb') as f:
        rom_data = f.read()
    
    is_headered = len(rom_data) % 0x400 == 0x200
    header_offset = 512 if is_headered else 0
    
    print("=== FINDING LEVEL 0x100+ BLOCK ===")
    
    # We found "Bullet Promenade" at ROM $08EF7F
    # This should be level 0x103
    
    bullet_offset = 0x08EF7F
    level_103_id = 0x103
    
    print(f"'Bullet Promenade' found at ROM ${bullet_offset:06X}")
    print(f"This should be level 0x{level_103_id:03X}")
    
    # If this is level 0x103 in a block that starts at level 0x100,
    # then the offset from the block start is: (0x103 - 0x100) * 19 = 3 * 19 = 57 bytes
    
    LEVEL_NAME_SIZE = 19
    offset_from_100 = (level_103_id - 0x100) * LEVEL_NAME_SIZE
    
    level_100_block_start = bullet_offset - offset_from_100
    
    print(f"\nCalculation:")
    print(f"  Level 0x103 offset from 0x100: {offset_from_100} bytes (3 * 19)")
    print(f"  Block start: ${bullet_offset:06X} - {offset_from_100} = ${level_100_block_start:06X}")
    
    # Check if there's a RATS tag before this block
    rats_check_offset = level_100_block_start - 8
    
    if rats_check_offset >= 0 and rats_check_offset + 8 < len(rom_data):
        rats_sig = rom_data[rats_check_offset:rats_check_offset + 4]
        print(f"\nChecking for RATS tag at ${rats_check_offset:06X}: {rats_sig}")
        
        if rats_sig == b'STAR':
            rats_size = rom_data[rats_check_offset + 4] | (rom_data[rats_check_offset + 5] << 8)
            rats_size += 1
            num_levels = rats_size // LEVEL_NAME_SIZE
            print(f"SUCCESS: RATS tag found!")
            print(f"  Size: {rats_size} bytes")
            print(f"  Levels: {num_levels}")
        else:
            print(f"No RATS tag found (signature: {rats_sig.hex()})")
    
    # Verify by checking the first few bytes
    print(f"\n=== VERIFYING BLOCK START ===")
    print(f"First 64 bytes at ${level_100_block_start:06X}:")
    print(f"  {rom_data[level_100_block_start:level_100_block_start + 64].hex()}")
    
    # Now extract and decode levels 0x100, 0x101, 0x102, 0x103 from this block
    print(f"\n=== EXTRACTING LEVELS FROM 0x100 BLOCK ===")
    
    # Tile mapping
    TILE_MAP = {
        0x00: 'A', 0x01: 'B', 0x02: 'C', 0x03: 'D', 0x04: 'E', 0x05: 'F',
        0x06: 'G', 0x07: 'H', 0x08: 'I', 0x09: 'J', 0x0A: 'K', 0x0B: 'L',
        0x0C: 'M', 0x0D: 'N', 0x0E: 'O', 0x0F: 'P',
        0x10: 'Q', 0x11: 'R', 0x12: 'S', 0x13: 'T', 0x14: 'U', 0x15: 'V',
        0x16: 'W', 0x17: 'X', 0x18: 'Y', 0x19: 'Z', 0x1A: '!', 0x1B: '.',
        0x1C: '-', 0x1D: ',', 0x1E: '?', 0x1F: ' ',
        0x40: 'a', 0x41: 'b', 0x42: 'c', 0x43: 'd', 0x44: 'e', 0x45: 'f',
        0x46: 'g', 0x47: 'h', 0x48: 'i', 0x49: 'j', 0x4A: 'k', 0x4B: 'l',
        0x4C: 'm', 0x4D: 'n', 0x4E: 'o', 0x4F: 'p',
        0x50: 'q', 0x51: 'r', 0x52: 's', 0x53: 't', 0x54: 'u', 0x55: 'v',
        0x56: 'w', 0x57: 'x', 0x58: 'y', 0x59: 'z', 0x5A: '#', 0x5B: '(',
        0x5C: ')', 0x5D: "'",
    }
    
    target_levels = {
        0x100: "???",
        0x101: "???",
        0x102: "???",
        0x103: "Bullet Promenade",
        0x104: "???",
        0x105: "???",
        0x106: "???",
        0x107: "???",
        0x108: "???",
        0x109: "Celestial Rex",
        0x10A: "Cloon Cavern",
        0x10B: "Shiverthorn Hollow",
    }
    
    for level_id in sorted(target_levels.keys()):
        offset_in_block = (level_id - 0x100) * LEVEL_NAME_SIZE
        level_offset = level_100_block_start + offset_in_block
        
        if level_offset + LEVEL_NAME_SIZE > len(rom_data):
            print(f"Level 0x{level_id:03X}: beyond ROM")
            continue
        
        level_data = rom_data[level_offset:level_offset + LEVEL_NAME_SIZE]
        has_name = any(b != 0 for b in level_data)
        
        if has_name:
            # Decode
            decoded = ''.join([TILE_MAP.get(b, f'[{b:02X}]') for b in level_data]).strip()
            
            print(f"Level 0x{level_id:03X}: '{decoded}'")
            print(f"  Expected: '{target_levels[level_id]}'")
            print(f"  Hex: {level_data.hex()}")
        else:
            print(f"Level 0x{level_id:03X}: (empty)")
    
    # Convert block start to SNES address
    snes_offset = level_100_block_start - header_offset
    bank = snes_offset // 0x8000
    local_offset = snes_offset % 0x8000
    snes_addr = (bank << 16) | (0x8000 + local_offset)
    
    print(f"\n=== SUMMARY ===")
    print(f"Level 0x100-0x1FF block starts at:")
    print(f"  ROM offset: ${level_100_block_start:06X}")
    print(f"  SNES address: ${snes_addr:06X}")

def main():
    rom_file = "Akogare_lm333_edited.sfc"
    
    try:
        find_level_100_block(rom_file)
    except FileNotFoundError:
        print(f"ERROR: Could not find {rom_file}")

if __name__ == "__main__":
    main()

