#!/usr/bin/env python3
"""
Examine the region around the level name data
Look for RATS tags, pointers, or other structures
"""

import struct

rom = open('Invictus_1.1.sfc', 'rb').read()

level_data_start = 0x2D6BDF

print("=" * 80)
print("EXAMINING REGION AROUND LEVEL NAME DATA")
print("=" * 80)
print(f"Level data starts at: ${level_data_start:06X}")
print()

# Look back for RATS tag
print("Searching backwards for RATS tag...")
for offset in range(level_data_start - 1, level_data_start - 1000, -1):
    if rom[offset:offset+4] == b'STAR':
        size = struct.unpack('<H', rom[offset+4:offset+6])[0] ^ 0xFFFF
        data_start = offset + 6
        distance = level_data_start - data_start
        
        print(f"\nFound RATS tag at ${offset:06X}:")
        print(f"  Size: {size} bytes")
        print(f"  Data starts at: ${data_start:06X}")
        print(f"  Distance to level names: {distance} bytes")
        
        if distance == 0:
            print(f"  *** Level names are at start of RATS block! ***")
        elif 0 < distance < size:
            print(f"  *** Level names are INSIDE this RATS block ({distance} bytes in) ***")
            print(f"  Block contains {distance // 19} level names before our data")
        
        break

# Show what's immediately before level data
print("\n" + "=" * 80)
print("DATA IMMEDIATELY BEFORE LEVEL NAMES")
print("=" * 80)

before_start = level_data_start - 50
before_data = rom[before_start:level_data_start]
print(f"50 bytes before ${level_data_start:06X}:")
print(' '.join(f'{b:02X}' for b in before_data))
print()

# Try to interpret as level names
print("If these are level names (19 bytes each):")
for i in range(0, len(before_data), 19):
    chunk = before_data[i:i+19]
    if len(chunk) == 19:
        # Check if it looks like a level name
        blank_count = chunk.count(0x1F)
        if blank_count > 10:  # Mostly blank
            decoded = "(mostly blank)"
        else:
            # Try standard mapping
            TILE_MAP = {
                0x00: 'A', 0x01: 'B', 0x02: 'C', 0x03: 'D', 0x04: 'E', 0x05: 'F',
                0x06: 'G', 0x07: 'H', 0x08: 'I', 0x09: 'J', 0x0A: 'K', 0x0B: 'L',
                0x0C: 'M', 0x0D: 'N', 0x0E: 'O', 0x0F: 'P', 0x10: 'Q', 0x11: 'R',
                0x12: 'S', 0x13: 'T', 0x14: 'U', 0x15: 'V', 0x16: 'W', 0x17: 'X',
                0x18: 'Y', 0x19: 'Z', 0x1F: ' '
            }
            decoded = ''.join(TILE_MAP.get(b, '?') for b in chunk).rstrip()
        
        print(f"  -{len(before_data)-i:2d} to -{len(before_data)-i-19:2d}: {decoded}")

# Show structure of the RATS block if found
print("\n" + "=" * 80)
print("SEARCHING FOR POINTER TO RATS BLOCK")
print("=" * 80)

# Find the RATS block that contains our data
for offset in range(level_data_start - 10000, level_data_start, 1):
    if rom[offset:offset+4] == b'STAR':
        size = struct.unpack('<H', rom[offset+4:offset+6])[0] ^ 0xFFFF
        data_start = offset + 6
        data_end = data_start + size
        
        if data_start <= level_data_start < data_end:
            print(f"\nLevel names are inside RATS block at ${offset:06X}")
            print(f"  RATS location: ${offset:06X}")
            print(f"  Data starts: ${data_start:06X}")
            print(f"  Data ends: ${data_end:06X}")
            print(f"  Size: {size} bytes")
            print(f"  Level names start {level_data_start - data_start} bytes into block")
            
            # Calculate SNES addresses
            def rom_to_snes(rom_off):
                bank = (rom_off >> 15) & 0x7F
                local = (rom_off & 0x7FFF) | 0x8000
                return local | (bank << 16)
            
            rats_snes = rom_to_snes(offset)
            data_snes = rom_to_snes(data_start)
            level_snes = rom_to_snes(level_data_start)
            
            print(f"\n  SNES addresses:")
            print(f"    RATS tag: ${rats_snes:06X}")
            print(f"    Data start: ${data_snes:06X}")
            print(f"    Level names: ${level_snes:06X}")
            
            # Search for pointers to any of these
            print(f"\n  Searching for pointers to RATS tag...")
            rats_ptr = struct.pack('<I', rats_snes)[:3]
            found_ptrs = []
            for i in range(len(rom) - 3):
                if rom[i:i+3] == rats_ptr:
                    ptr_snes = rom_to_snes(i)
                    found_ptrs.append((i, ptr_snes))
            
            if found_ptrs:
                print(f"    Found {len(found_ptrs)} pointer(s) to RATS tag:")
                for rom_off, snes in found_ptrs[:10]:
                    context = rom[max(0, rom_off-5):rom_off+8]
                    print(f"      ROM ${rom_off:06X} (SNES ${snes:06X})")
                    print(f"        Context: {' '.join(f'{b:02X}' for b in context)}")
            else:
                print(f"    No pointers to RATS tag found")
            
            # Search for pointers to data start
            print(f"\n  Searching for pointers to data start...")
            data_ptr = struct.pack('<I', data_snes)[:3]
            found_ptrs = []
            for i in range(len(rom) - 3):
                if rom[i:i+3] == data_ptr:
                    ptr_snes = rom_to_snes(i)
                    found_ptrs.append((i, ptr_snes))
            
            if found_ptrs:
                print(f"    Found {len(found_ptrs)} pointer(s) to data start:")
                for rom_off, snes in found_ptrs[:10]:
                    context = rom[max(0, rom_off-5):rom_off+8]
                    print(f"      ROM ${rom_off:06X} (SNES ${snes:06X})")
                    print(f"        Context: {' '.join(f'{b:02X}' for b in context)}")
                    
                    # Check if near standard pointer location
                    if 0x01BB50 <= rom_off <= 0x01BB65:
                        print(f"        *** NEAR STANDARD POINTER LOCATION! ***")
            else:
                print(f"    No pointers to data start found")
            
            break

print("\n" + "=" * 80)
print("COMPLETE")
print("=" * 80)

