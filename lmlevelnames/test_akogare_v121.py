import struct

def snes_to_rom_offset(snes_addr, header_offset=0):
    bank = (snes_addr >> 16) & 0xFF
    offset_in_bank = snes_addr & 0xFFFF
    if offset_in_bank < 0x8000:
        rom_offset = (bank << 15) | offset_in_bank
    else:
        rom_offset = (bank << 15) | (offset_in_bank - 0x8000)
    return rom_offset + header_offset

rom_file = 'Akogare_v121_lm.sfc'
with open(rom_file, 'rb') as f:
    rom_data = f.read()

is_headered = len(rom_data) % 0x400 == 0x200
header_offset = 512 if is_headered else 0

print(f'File: {rom_file}')
print(f'Size: {len(rom_data):,} bytes')
print(f'Headered: {is_headered}')

# Check hijack
snes_hijack = 0x048E81
rom_hijack = snes_to_rom_offset(snes_hijack, header_offset)
hijack_byte = rom_data[rom_hijack]
status = "INSTALLED" if hijack_byte == 0x22 else "NOT INSTALLED"
print(f'Hijack at ROM ${rom_hijack:06X}: 0x{hijack_byte:02X} - {status}')

if hijack_byte == 0x22:
    # Read pointer
    snes_pointer_addr = 0x03BB57
    rom_pointer_addr = snes_to_rom_offset(snes_pointer_addr, header_offset)
    patch_pointer = (rom_data[rom_pointer_addr] | 
                     rom_data[rom_pointer_addr + 1] << 8 | 
                     rom_data[rom_pointer_addr + 2] << 16)
    print(f'Block 0 pointer: SNES ${patch_pointer:06X}')
    
    # Check if block 1 exists at same relative location
    block_1_rom = 0x08EF46
    if block_1_rom + 19 < len(rom_data):
        sample = rom_data[block_1_rom:block_1_rom + 19]
        print(f'Block 1 at ROM ${block_1_rom:06X}: {sample.hex()}')

