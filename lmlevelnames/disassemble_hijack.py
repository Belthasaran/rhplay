#!/usr/bin/env python3
"""
Disassemble the ASM hijack code to find how it accesses level names
"""

import struct

rom = open('Invictus_1.1.sfc', 'rb').read()

# Hijack target
hijack_target_rom = 0x019B20  # SNES $03BB20

print("=" * 80)
print("DISASSEMBLING ASM HIJACK CODE")
print("=" * 80)
print(f"Code at ROM ${hijack_target_rom:06X} (SNES $03BB20)")
print()

code = rom[hijack_target_rom:hijack_target_rom+300]

# Simple disassembler - look for key instructions
print("Key instructions:")
print()

for i in range(len(code) - 4):
    offset = hijack_target_rom + i
    
    # LDA immediate (A9 xx)
    if code[i] == 0xA9:
        val = code[i+1]
        print(f"${offset:06X}: A9 {val:02X}        LDA #${val:02X}")
    
    # LDA absolute (AD xx xx)
    elif code[i] == 0xAD:
        addr = struct.unpack('<H', code[i+1:i+3])[0]
        print(f"${offset:06X}: AD {code[i+1]:02X} {code[i+2]:02X}     LDA ${addr:04X}")
        
        # Check if this address contains interesting data
        if addr < len(rom):
            data_at_addr = rom[addr:addr+3]
            print(f"            Data at ROM ${addr:06X}: {' '.join(f'{b:02X}' for b in data_at_addr)}")
    
    # LDA absolute long (AF xx xx xx)
    elif code[i] == 0xAF:
        addr = struct.unpack('<I', code[i+1:i+4] + b'\x00')[0]
        print(f"${offset:06X}: AF {code[i+1]:02X} {code[i+2]:02X} {code[i+3]:02X}  LDA ${addr:06X}")
    
    # STA absolute (8D xx xx)
    elif code[i] == 0x8D:
        addr = struct.unpack('<H', code[i+1:i+3])[0]
        print(f"${offset:06X}: 8D {code[i+1]:02X} {code[i+2]:02X}     STA ${addr:04X}")
    
    # LDX absolute (AE xx xx)
    elif code[i] == 0xAE:
        addr = struct.unpack('<H', code[i+1:i+3])[0]
        print(f"${offset:06X}: AE {code[i+1]:02X} {code[i+2]:02X}     LDX ${addr:04X}")
    
    # LDY absolute (AC xx xx)
    elif code[i] == 0xAC:
        addr = struct.unpack('<H', code[i+1:i+3])[0]
        print(f"${offset:06X}: AC {code[i+1]:02X} {code[i+2]:02X}     LDY ${addr:04X}")
    
    # JSL (22 xx xx xx)
    elif code[i] == 0x22:
        addr = struct.unpack('<I', code[i+1:i+4] + b'\x00')[0]
        print(f"${offset:06X}: 22 {code[i+1]:02X} {code[i+2]:02X} {code[i+3]:02X}  JSL ${addr:06X}")
    
    # JSR (20 xx xx)
    elif code[i] == 0x20:
        addr = struct.unpack('<H', code[i+1:i+3])[0]
        print(f"${offset:06X}: 20 {code[i+1]:02X} {code[i+2]:02X}     JSR ${addr:04X}")

print()
print("=" * 80)
print("LOOKING FOR LEVEL NAME DATA ADDRESS")
print("=" * 80)
print()

# The level names are at SNES $5AEBDF
# In code, this might be referenced as:
# - $EBDF with bank $5A loaded separately
# - Full $5AEBDF address
# - Calculated from a base address

target_snes = 0x5AEBDF
target_offset = target_snes & 0xFFFF  # $EBDF
target_bank = (target_snes >> 16) & 0xFF  # $5A

print(f"Looking for references to:")
print(f"  Full address: ${target_snes:06X}")
print(f"  Offset only: ${target_offset:04X}")
print(f"  Bank byte: ${target_bank:02X}")
print()

# Search for the offset
offset_bytes = struct.pack('<H', target_offset)
print(f"Searching code for offset ${target_offset:04X} ({offset_bytes[0]:02X} {offset_bytes[1]:02X})...")

for i in range(len(code) - 2):
    if code[i:i+2] == offset_bytes:
        offset = hijack_target_rom + i
        # Show context
        context = code[max(0, i-5):i+7]
        print(f"  Found at ${offset:06X}: {' '.join(f'{b:02X}' for b in context)}")

print()

# Search for the bank byte
print(f"Searching code for bank byte ${target_bank:02X}...")
for i in range(len(code)):
    if code[i] == target_bank:
        offset = hijack_target_rom + i
        context = code[max(0, i-5):i+6]
        # Only show if it looks like it's being loaded
        if i > 0 and code[i-1] in [0xA9, 0xA2, 0xA0]:  # LDA/LDX/LDY immediate
            print(f"  Found at ${offset:06X}: {' '.join(f'{b:02X}' for b in context)}")

print()

# Also check the data block start
data_start = 0x5AC52D
data_offset = data_start & 0xFFFF
data_bank = (data_start >> 16) & 0xFF

print(f"Also checking for RATS block start ${data_start:06X}:")
print(f"  Offset: ${data_offset:04X}")
print(f"  Bank: ${data_bank:02X}")
print()

data_offset_bytes = struct.pack('<H', data_offset)
for i in range(len(code) - 2):
    if code[i:i+2] == data_offset_bytes:
        offset = hijack_target_rom + i
        context = code[max(0, i-5):i+7]
        print(f"  Found offset at ${offset:06X}: {' '.join(f'{b:02X}' for b in context)}")

