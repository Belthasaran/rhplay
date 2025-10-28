import struct

def check_rats_tag_283(rom_path):
    """Check RATS tag #283 (209 levels) for level 13B"""
    
    with open(rom_path, 'rb') as f:
        rom_data = f.read()
    
    print("=== CHECKING RATS TAG #283 FOR LEVEL 13B ===")
    
    # RATS tag #283 info from previous scan
    rats_offset = 0x0CEB00
    data_offset = 0x0CEB08
    size = 3971
    num_levels = 209
    
    print(f"RATS offset: ${rats_offset:06X}")
    print(f"Data offset: ${data_offset:06X}")
    print(f"Size: {size} bytes")
    print(f"Number of levels: {num_levels}")
    print(f"First 64 bytes: {rom_data[data_offset:data_offset + 64].hex()}")
    
    # Check if level 0x13B is in range
    level_13B_id = 0x13B  # = 315 decimal
    
    print(f"\n=== LEVEL 13B CHECK ===")
    print(f"Level 13B = 0x{level_13B_id:03X} = {level_13B_id} decimal")
    print(f"This RATS tag has {num_levels} levels (0-{num_levels-1})")
    
    if level_13B_id < num_levels:
        print(f"SUCCESS: Level 13B is within this RATS tag!")
        
        LEVEL_NAME_SIZE = 19
        level_13B_offset = level_13B_id * LEVEL_NAME_SIZE
        level_13B_data = rom_data[data_offset + level_13B_offset:data_offset + level_13B_offset + LEVEL_NAME_SIZE]
        
        print(f"\n=== LEVEL 13B DATA ===")
        print(f"Offset in data: 0x{level_13B_offset:04X} ({level_13B_offset} bytes)")
        print(f"ROM offset: ${data_offset + level_13B_offset:06X}")
        print(f"Raw bytes: {level_13B_data.hex()}")
        print(f"Formatted: {' '.join(f'{b:02X}' for b in level_13B_data)}")
        print(f"Has name: {any(b != 0 for b in level_13B_data)}")
        
        # Also check a few other target levels
        target_levels = {
            0x001: "Yoshi's Tree House",
            0x002: "Delfino Shores",
            0x103: "Bullet Promenade",
            0x109: "Celestial Rex",
            0x13B: "???",
        }
        
        print(f"\n=== CHECKING OTHER TARGET LEVELS ===")
        for level_id, expected_name in sorted(target_levels.items()):
            if level_id < num_levels:
                offset = level_id * LEVEL_NAME_SIZE
                level_data = rom_data[data_offset + offset:data_offset + offset + LEVEL_NAME_SIZE]
                has_name = any(b != 0 for b in level_data)
                print(f"Level 0x{level_id:03X}: {'HAS DATA' if has_name else 'empty'} - Expected: '{expected_name}'")
                if has_name:
                    print(f"  Raw: {level_data.hex()}")
    else:
        print(f"FAIL: Level 13B is NOT in this RATS tag")
        print(f"Need at least {level_13B_id + 1} levels, but only have {num_levels}")

def main():
    rom_file = "Akogare_lm333_edited.sfc"
    
    try:
        check_rats_tag_283(rom_file)
    except FileNotFoundError:
        print(f"ERROR: Could not find {rom_file}")

if __name__ == "__main__":
    main()

