#!/usr/bin/env python3
import struct

rom = open('Invictus_1.1.sfc', 'rb').read()

# The RATS data block starts at ROM $2D452D (SNES $5AC52D)
data_start_snes = 0x5AC52D

print(f"Looking for 3-byte pointer to ${data_start_snes:06X}")

data_ptr = struct.pack('<I', data_start_snes)[:3]
print(f"Searching for bytes: {' '.join(f'{b:02X}' for b in data_ptr)}")
print()

matches = []
for i in range(len(rom) - 3):
    if rom[i:i+3] == data_ptr:
        matches.append(i)

print(f"Found {len(matches)} pointer(s)")
print()

for i in matches:
    # Calculate SNES address
    bank = (i >> 15) & 0x7F
    local = (i & 0x7FFF) | 0x8000
    ptr_snes = local | (bank << 16)
    
    context = rom[max(0, i-8):i+11]
    print(f"ROM ${i:06X} (SNES ${ptr_snes:06X})")
    print(f"  Context: {' '.join(f'{b:02X}' for b in context)}")
    
    # Check if near important locations
    if 0x01BB50 <= i <= 0x01BB65:
        print(f"  *** NEAR STANDARD LM POINTER LOCATION ($03BB57) ***")
    elif 0x019B00 <= i <= 0x019C00:
        print(f"  *** IN ASM HIJACK CODE ***")
    elif 0x020E00 <= i <= 0x020F00:
        print(f"  *** NEAR HIJACK INSTRUCTION ***")
    
    print()

# Also check standard location explicitly
print("=" * 60)
print("CHECKING STANDARD POINTER LOCATION")
print("=" * 60)
std_loc = 0x01BB57
std_data = rom[std_loc:std_loc+3]
std_val = struct.unpack('<I', std_data + b'\x00')[0]
print(f"ROM $01BB57 (SNES $03BB57) contains: {' '.join(f'{b:02X}' for b in std_data)}")
print(f"  If 3-byte pointer: ${std_val:06X}")
print(f"  Expected: ${data_start_snes:06X}")
print(f"  Match: {'YES!' if std_val == data_start_snes else 'NO'}")

