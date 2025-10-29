#!/usr/bin/env python3
"""
Find pointer(s) to the actual level name data location
Search for various address representations
"""

import struct
import sys

def snes_to_rom_offset(snes_address, header_offset=0):
    """Convert SNES LoROM address to ROM offset"""
    rom_offset = (snes_address & 0x7FFF) + ((snes_address & 0xFF0000) >> 1)
    return rom_offset + header_offset

def rom_to_snes_address(rom_offset, header_offset=0):
    """Convert ROM offset to SNES LoROM address"""
    rom_offset -= header_offset
    bank = (rom_offset >> 15) & 0x7F
    local = (rom_offset & 0x7FFF) | 0x8000
    return local | (bank << 16)

def search_for_pointers(rom_data, target_offset):
    """
    Search for various representations of the target offset
    """
    print(f"Searching for pointers to ROM offset ${target_offset:06X}")
    print()
    
    # Calculate SNES address
    target_snes = rom_to_snes_address(target_offset)
    print(f"Target SNES address: ${target_snes:06X}")
    print(f"  Bank: ${(target_snes >> 16):02X}")
    print(f"  Offset: ${(target_snes & 0xFFFF):04X}")
    print()
    
    results = {
        '3-byte_pointer': [],
        '2-byte_offset': [],
        '4-byte_long': [],
        'near_references': []
    }
    
    # 1. Search for 3-byte SNES pointer (most common in LM)
    print("=" * 80)
    print("SEARCHING FOR 3-BYTE SNES POINTER")
    print("=" * 80)
    
    pointer_3byte = struct.pack('<I', target_snes)[:3]
    print(f"Looking for bytes: {' '.join(f'{b:02X}' for b in pointer_3byte)}")
    print()
    
    for i in range(len(rom_data) - 3):
        if rom_data[i:i+3] == pointer_3byte:
            # Calculate SNES address of pointer location
            ptr_snes = rom_to_snes_address(i)
            results['3-byte_pointer'].append((i, ptr_snes))
    
    if results['3-byte_pointer']:
        print(f"Found {len(results['3-byte_pointer'])} 3-byte pointer(s):")
        for rom_off, snes_addr in results['3-byte_pointer'][:20]:
            # Show context
            context = rom_data[max(0, rom_off-8):rom_off+11]
            hex_str = ' '.join(f'{b:02X}' for b in context)
            print(f"  ROM ${rom_off:06X} (SNES ${snes_addr:06X})")
            print(f"    Context: {hex_str}")
            
            # Check if near the standard pointer location
            if 0x01BB50 <= rom_off <= 0x01BB60:
                print(f"    *** NEAR STANDARD POINTER LOCATION ($03BB57) ***")
    else:
        print("No 3-byte pointers found")
    
    print()
    
    # 2. Search for 2-byte offset (bank assumed from context)
    print("=" * 80)
    print("SEARCHING FOR 2-BYTE OFFSET")
    print("=" * 80)
    
    offset_2byte = struct.pack('<H', target_snes & 0xFFFF)
    print(f"Looking for bytes: {' '.join(f'{b:02X}' for b in offset_2byte)}")
    print()
    
    for i in range(len(rom_data) - 2):
        if rom_data[i:i+2] == offset_2byte:
            results['2-byte_offset'].append(i)
    
    print(f"Found {len(results['2-byte_offset'])} 2-byte offset(s)")
    if len(results['2-byte_offset']) <= 30:
        for rom_off in results['2-byte_offset']:
            ptr_snes = rom_to_snes_address(rom_off)
            context = rom_data[max(0, rom_off-8):rom_off+10]
            hex_str = ' '.join(f'{b:02X}' for b in context)
            print(f"  ROM ${rom_off:06X} (SNES ${ptr_snes:06X})")
            print(f"    Context: {hex_str}")
    else:
        print(f"  (Too many to display - showing first 10)")
        for rom_off in results['2-byte_offset'][:10]:
            ptr_snes = rom_to_snes_address(rom_off)
            print(f"  ROM ${rom_off:06X} (SNES ${ptr_snes:06X})")
    
    print()
    
    # 3. Search for 4-byte long address
    print("=" * 80)
    print("SEARCHING FOR 4-BYTE LONG ADDRESS")
    print("=" * 80)
    
    pointer_4byte = struct.pack('<I', target_snes)
    print(f"Looking for bytes: {' '.join(f'{b:02X}' for b in pointer_4byte)}")
    print()
    
    for i in range(len(rom_data) - 4):
        if rom_data[i:i+4] == pointer_4byte:
            ptr_snes = rom_to_snes_address(i)
            results['4-byte_long'].append((i, ptr_snes))
    
    if results['4-byte_long']:
        print(f"Found {len(results['4-byte_long'])} 4-byte pointer(s):")
        for rom_off, snes_addr in results['4-byte_long']:
            context = rom_data[max(0, rom_off-8):rom_off+12]
            hex_str = ' '.join(f'{b:02X}' for b in context)
            print(f"  ROM ${rom_off:06X} (SNES ${snes_addr:06X})")
            print(f"    Context: {hex_str}")
    else:
        print("No 4-byte pointers found")
    
    print()
    
    # 4. Search for just the bank byte near known locations
    print("=" * 80)
    print("CHECKING KNOWN POINTER LOCATIONS")
    print("=" * 80)
    
    known_locations = [
        (0x01BB57, "Standard LM pointer location ($03BB57)"),
        (0x01BB54, "3 bytes before standard"),
        (0x01BB5A, "3 bytes after standard"),
        (0x020E81, "ASM hijack at $048E81"),
        (0x019B20, "Hijack target at $03BB20")
    ]
    
    for rom_off, description in known_locations:
        if rom_off < len(rom_data) - 10:
            data = rom_data[rom_off:rom_off+10]
            hex_str = ' '.join(f'{b:02X}' for b in data)
            ptr_snes = rom_to_snes_address(rom_off)
            print(f"\n{description}")
            print(f"  ROM ${rom_off:06X} (SNES ${ptr_snes:06X})")
            print(f"  Data: {hex_str}")
            
            # Try interpreting as pointer
            if len(data) >= 3:
                ptr_val = struct.unpack('<I', data[:3] + b'\x00')[0]
                ptr_rom = snes_to_rom_offset(ptr_val)
                print(f"  If 3-byte pointer: ${ptr_val:06X} -> ROM ${ptr_rom:06X}")
                if abs(ptr_rom - target_offset) < 1000:
                    print(f"    *** CLOSE TO TARGET! (off by {abs(ptr_rom - target_offset)} bytes) ***")
    
    print()
    
    # 5. Check RATS tag before our data
    print("=" * 80)
    print("CHECKING FOR RATS TAG")
    print("=" * 80)
    
    # RATS tags are 6 bytes before the data
    rats_offset = target_offset - 6
    if rats_offset >= 0:
        rats_data = rom_data[rats_offset:rats_offset+10]
        print(f"Checking ROM ${rats_offset:06X} for RATS tag:")
        print(f"  Data: {' '.join(f'{b:02X}' for b in rats_data)}")
        
        if rats_data[:4] == b'STAR':
            size_bytes = rats_data[4:6]
            size = struct.unpack('<H', size_bytes)[0] ^ 0xFFFF
            print(f"  FOUND RATS TAG!")
            print(f"  Size: {size} bytes ({size // 19} level names)")
            
            # Now search for pointers to the RATS tag itself
            rats_snes = rom_to_snes_address(rats_offset)
            print(f"  RATS tag SNES address: ${rats_snes:06X}")
            
            print(f"\n  Searching for pointers to RATS tag...")
            rats_ptr = struct.pack('<I', rats_snes)[:3]
            for i in range(len(rom_data) - 3):
                if rom_data[i:i+3] == rats_ptr:
                    ptr_snes = rom_to_snes_address(i)
                    context = rom_data[max(0, i-8):i+11]
                    hex_str = ' '.join(f'{b:02X}' for b in context)
                    print(f"    ROM ${i:06X} (SNES ${ptr_snes:06X})")
                    print(f"      Context: {hex_str}")
        else:
            print(f"  No RATS tag found (expected 'STAR', got {rats_data[:4]})")
    
    return results

def analyze_hijack_code_for_pointer(rom_data, hijack_target_rom):
    """
    Analyze the ASM hijack code for references to level name data
    """
    print("\n" + "=" * 80)
    print("ANALYZING ASM HIJACK CODE FOR DATA REFERENCES")
    print("=" * 80)
    
    # Read ~200 bytes of code
    code = rom_data[hijack_target_rom:hijack_target_rom+200]
    
    print(f"Analyzing code at ROM ${hijack_target_rom:06X}...")
    print()
    
    # Look for LDA/LDX/LDY instructions that load addresses
    potential_pointers = []
    
    for i in range(len(code) - 3):
        # LDA absolute (AD xx xx)
        if code[i] == 0xAD:
            addr = struct.unpack('<H', code[i+1:i+3])[0]
            potential_pointers.append(('LDA abs', i, addr))
        
        # LDA absolute long (AF xx xx xx)
        elif code[i] == 0xAF:
            addr = struct.unpack('<I', code[i+1:i+4] + b'\x00')[0]
            potential_pointers.append(('LDA long', i, addr))
        
        # LDX absolute (AE xx xx)
        elif code[i] == 0xAE:
            addr = struct.unpack('<H', code[i+1:i+3])[0]
            potential_pointers.append(('LDX abs', i, addr))
        
        # LDY absolute (AC xx xx)
        elif code[i] == 0xAC:
            addr = struct.unpack('<H', code[i+1:i+3])[0]
            potential_pointers.append(('LDY abs', i, addr))
    
    if potential_pointers:
        print(f"Found {len(potential_pointers)} address loads in hijack code:")
        for instr, offset, addr in potential_pointers[:15]:
            print(f"  +{offset:3d}: {instr:12s} ${addr:06X}")
            
            # Check if this address contains a pointer
            if addr < len(rom_data) - 3:
                # Try as ROM offset
                if addr < len(rom_data) - 3:
                    data_at_addr = rom_data[addr:addr+3]
                    ptr_val = struct.unpack('<I', data_at_addr + b'\x00')[0]
                    print(f"         Data at ROM ${addr:06X}: {' '.join(f'{b:02X}' for b in data_at_addr)}")
                    print(f"         If pointer: ${ptr_val:06X}")
                
                # Try as SNES address (add bank)
                snes_addr = addr | 0x030000  # Assume bank $03 (common for LM data)
                snes_rom = snes_to_rom_offset(snes_addr)
                if 0 <= snes_rom < len(rom_data) - 3:
                    data_at_snes = rom_data[snes_rom:snes_rom+3]
                    ptr_val = struct.unpack('<I', data_at_snes + b'\x00')[0]
                    print(f"         As SNES $03{addr:04X} -> ROM ${snes_rom:06X}: {' '.join(f'{b:02X}' for b in data_at_snes)}")

def main():
    if len(sys.argv) < 3:
        print("Usage: python find_pointer_to_levelnames.py <rom_file> <level_data_offset_hex>")
        print("Example: python find_pointer_to_levelnames.py Invictus_1.1.sfc 2D6BDF")
        sys.exit(1)
    
    rom_path = sys.argv[1]
    target_offset = int(sys.argv[2], 16)
    
    with open(rom_path, 'rb') as f:
        rom_data = bytearray(f.read())
    
    print(f"ROM: {rom_path}")
    print(f"ROM Size: {len(rom_data):,} bytes")
    print(f"Target offset: ${target_offset:06X}")
    print()
    
    # Search for pointers
    results = search_for_pointers(rom_data, target_offset)
    
    # Analyze hijack code
    hijack_target_rom = 0x019B20  # Where the hijack points
    analyze_hijack_code_for_pointer(rom_data, hijack_target_rom)
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    
    total_found = (len(results['3-byte_pointer']) + 
                   len(results.get('4-byte_long', [])))
    
    if results['3-byte_pointer']:
        print(f"\nFound {len(results['3-byte_pointer'])} 3-byte pointer(s) to level name data:")
        for rom_off, snes_addr in results['3-byte_pointer'][:10]:
            print(f"  ROM ${rom_off:06X} (SNES ${snes_addr:06X})")
            if 0x01BB50 <= rom_off <= 0x01BB60:
                print(f"    *** This is near the standard LM pointer location! ***")
    else:
        print("\nNo direct 3-byte pointers found")
        print("Possible reasons:")
        print("  - Pointer is calculated dynamically in code")
        print("  - Pointer uses different format (2-byte, bank separate)")
        print("  - Data accessed via different mechanism")

if __name__ == '__main__':
    main()

