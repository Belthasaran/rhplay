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

def find_extended_level_names(rom_path):
    """Find where levels 0x100+ are stored"""
    
    with open(rom_path, 'rb') as f:
        rom_data = f.read()
    
    is_headered = len(rom_data) % 0x400 == 0x200
    header_offset = 512 if is_headered else 0
    
    print("=== FINDING EXTENDED LEVEL NAME STORAGE (0x100+) ===")
    
    # The primary pointer at $03BB57 only covers 0x000-0x05F
    # There must be additional pointers for 0x100-0x1FF
    
    # Check the JSR target code more carefully
    snes_hijack = 0x048E81
    rom_hijack = snes_to_rom_offset(snes_hijack, header_offset)
    
    jsr_target = (rom_data[rom_hijack + 1] |
                  rom_data[rom_hijack + 2] << 8 |
                  rom_data[rom_hijack + 3] << 16)
    
    jsr_target_rom = snes_to_rom_offset(jsr_target, header_offset)
    
    print(f"JSR target (SNES): ${jsr_target:06X}")
    print(f"JSR target (ROM): ${jsr_target_rom:06X}")
    
    # Read more of the code to find additional pointer references
    code_size = 256
    code_data = rom_data[jsr_target_rom:jsr_target_rom + code_size]
    
    print(f"\n=== ANALYZING LEVEL NAME LOADING CODE ===")
    print(f"Code (first 128 bytes): {code_data[:128].hex()}")
    
    # Look for pointer loads - the code likely indexes based on level ID
    # Level 0x100+ would be in a different bank or offset
    
    # Check for additional pointers near $03BB57
    print(f"\n=== CHECKING FOR MULTIPLE POINTER REGIONS ===")
    
    pointer_base_snes = 0x03BB57
    pointer_base_rom = snes_to_rom_offset(pointer_base_snes, header_offset)
    
    # Read several 3-byte pointers
    for i in range(-5, 10):
        addr = pointer_base_rom + (i * 3)
        if addr + 3 > len(rom_data):
            continue
        
        pointer = (rom_data[addr] |
                   rom_data[addr + 1] << 8 |
                   rom_data[addr + 2] << 16)
        
        # Check if this looks like a valid pointer to expanded ROM
        if 0x100000 <= pointer <= 0x300000:
            snes_addr = pointer_base_snes + (i * 3)
            print(f"SNES ${snes_addr:06X} (offset {i*3:+3d}): ${pointer:06X}")
            
            # Check if this pointer has a RATS tag
            data_rom = snes_to_rom_offset(pointer, header_offset)
            rats_rom = data_rom - 8
            
            if rats_rom >= 0 and rats_rom + 8 < len(rom_data):
                rats_sig = rom_data[rats_rom:rats_rom + 4]
                if rats_sig == b'STAR':
                    rats_size = rom_data[rats_rom + 4] | (rom_data[rats_rom + 5] << 8)
                    rats_size += 1
                    num_levels = rats_size // 19
                    print(f"       -> RATS tag found, {num_levels} levels")
                    print(f"       -> First 32 bytes: {rom_data[data_rom:data_rom + 32].hex()}")
    
    # Alternative: Maybe levels 0x100-0x1FF use a completely different system
    # Let's search for the known level names as tile data
    print(f"\n=== SEARCHING FOR KNOWN LEVEL NAMES AS TILE DATA ===")
    
    # "Bullet Promenade" = tile codes for these letters
    # B=0x01, u=0x54, l=0x4B, l=0x4B, e=0x44, t=0x53, space=0x1F
    # P=0x0F, r=0x51, o=0x4E, m=0x4C, e=0x44, n=0x4D, a=0x40, d=0x43, e=0x44
    
    bullet_pattern = bytes([0x01, 0x54, 0x4B, 0x4B, 0x44, 0x53, 0x1F, 0x0F, 0x51, 0x4E, 0x4C, 0x44, 0x4D, 0x40, 0x43, 0x44])
    
    print(f"Searching for 'Bullet Promenade' pattern: {bullet_pattern.hex()}")
    
    # Search for this pattern in the ROM
    offset = 0
    found_count = 0
    while offset < len(rom_data) - len(bullet_pattern):
        if rom_data[offset:offset + len(bullet_pattern)] == bullet_pattern:
            found_count += 1
            # Calculate which level this would be (19 bytes per level)
            # Try to find the start of the level name block
            
            # Go back to find a potential start (aligned to 19 bytes)
            for start_offset in range(max(0, offset - 19 * 512), offset, 19):
                # Check if this could be the start of a level name block
                test_offset = offset - start_offset
                if test_offset % 19 == 0:
                    level_id = test_offset // 19
                    
                    snes_offset = offset - header_offset
                    bank = snes_offset // 0x8000
                    local_offset = snes_offset % 0x8000
                    snes_addr = (bank << 16) | (0x8000 + local_offset)
                    
                    print(f"\nFound at ROM ${offset:06X} (SNES ${snes_addr:06X})")
                    print(f"  Possible level ID: 0x{level_id:03X} (if block starts at ${start_offset:06X})")
                    print(f"  Context: {rom_data[offset-8:offset + 24].hex()}")
                    break
            
            if found_count >= 3:  # Limit output
                break
        
        offset += 1
    
    if found_count == 0:
        print("Pattern not found - checking if level names use different encoding for 0x100+")
    
    # Maybe the code uses bank switching or a different pointer for levels 0x100+
    # Let's check if there's a pattern in the code that switches banks
    print(f"\n=== HYPOTHESIS: SEPARATE DATA BLOCK FOR 0x100+ ===")
    print("Lunar Magic might store levels 0x000-0x0FF in one block")
    print("and levels 0x100-0x1FF in a separate block")
    print("\nLooking for a second pointer or bank switch in the loading code...")

def main():
    rom_file = "Akogare_lm333_edited.sfc"
    
    try:
        find_extended_level_names(rom_file)
    except FileNotFoundError:
        print(f"ERROR: Could not find {rom_file}")

if __name__ == "__main__":
    main()

