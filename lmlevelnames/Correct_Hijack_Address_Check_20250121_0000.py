import struct

def snes_to_rom_offset(snes_addr, header_offset=0):
    """Convert SNES LoROM address to ROM file offset"""
    # For LoROM:
    # SNES $00:8000-$00:FFFF maps to ROM $000000-$007FFF
    # SNES $01:8000-$01:FFFF maps to ROM $008000-$00FFFF
    # etc.
    
    bank = (snes_addr >> 16) & 0xFF
    offset_in_bank = snes_addr & 0xFFFF
    
    if offset_in_bank < 0x8000:
        # Low ROM area - direct mapping
        rom_offset = (bank << 15) | offset_in_bank
    else:
        # High ROM area - subtract 0x8000
        rom_offset = (bank << 15) | (offset_in_bank - 0x8000)
    
    return rom_offset + header_offset

def check_hijack_correctly(rom_path):
    """Check the hijack at the correct address"""
    
    with open(rom_path, 'rb') as f:
        rom_data = f.read()
    
    # Check if ROM is headered
    is_headered = len(rom_data) % 0x400 == 0x200
    header_offset = 512 if is_headered else 0
    
    print("=== CORRECT HIJACK ADDRESS CHECK ===")
    print(f"ROM size: {len(rom_data):,} bytes")
    print(f"Header offset: {header_offset}")
    print(f"Is headered: {is_headered}")
    
    # SNES address $048E81
    snes_addr = 0x048E81
    
    print(f"\n=== ADDRESS CONVERSION ===")
    print(f"SNES address: ${snes_addr:06X}")
    
    # Method 1: My original (WRONG) calculation
    wrong_offset = 0x048E81 + header_offset
    print(f"\nWRONG Method (direct add): ${wrong_offset:06X}")
    print(f"Data at wrong location: {rom_data[wrong_offset:wrong_offset + 16].hex()}")
    
    # Method 2: Correct LoROM conversion
    correct_offset = snes_to_rom_offset(snes_addr, header_offset)
    print(f"\nCORRECT Method (LoROM): ${correct_offset:06X}")
    print(f"Data at correct location: {rom_data[correct_offset:correct_offset + 16].hex()}")
    
    # Method 3: Simple LoROM formula from snesrev
    # For SNES $04:8E81, bank=$04, addr=$8E81
    # ROM offset = bank * $8000 + (addr - $8000) = $04 * $8000 + $0E81 = $20000 + $0E81 = $20E81
    simple_offset = 0x04 * 0x8000 + (0x8E81 - 0x8000) + header_offset
    print(f"\nSIMPLE Method (LoROM): ${simple_offset:06X}")
    print(f"Data at simple location: {rom_data[simple_offset:simple_offset + 16].hex()}")
    
    # Check all three locations
    print(f"\n=== CHECKING FOR JSR INSTRUCTION (0x22) ===")
    
    for name, offset in [("WRONG", wrong_offset), ("CORRECT", correct_offset), ("SIMPLE", simple_offset)]:
        byte = rom_data[offset]
        print(f"{name}: ${offset:06X} = 0x{byte:02X} {'<-- JSR!' if byte == 0x22 else ''}")
        
        if byte == 0x22:
            # Read the JSR target
            target = rom_data[offset + 1] | (rom_data[offset + 2] << 8) | (rom_data[offset + 3] << 16)
            print(f"       JSR target: ${target:06X}")
            
            # Read patch pointer at $3BB57
            pointer_addr_snes = 0x03BB57
            pointer_addr_rom = snes_to_rom_offset(pointer_addr_snes, header_offset)
            print(f"       Patch pointer location (SNES ${pointer_addr_snes:06X} = ROM ${pointer_addr_rom:06X})")
            
            patch_pointer = (rom_data[pointer_addr_rom] |
                            rom_data[pointer_addr_rom + 1] << 8 |
                            rom_data[pointer_addr_rom + 2] << 16)
            print(f"       Patch pointer: ${patch_pointer:06X}")

def main():
    rom_file = "Akogare_lm333_edited.sfc"
    
    try:
        check_hijack_correctly(rom_file)
    except FileNotFoundError:
        print(f"ERROR: Could not find {rom_file}")

if __name__ == "__main__":
    main()

