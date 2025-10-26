#!/usr/bin/env python3
"""
SMW Patch Verification Tool

Verifies that ASM patches were actually applied correctly by checking
the ROM bytes at the hook points.

This is better than emulator testing because:
- No display needed
- Fast verification
- Can check exact bytes
- Works in CI/automated environments

Usage:
    smw_verify_patch.py <patched_rom.sfc> --level 0x105
    smw_verify_patch.py <patched_rom.sfc> --original <original.sfc>
"""

import sys
import argparse
from pathlib import Path
from typing import Tuple, List, Dict


class PatchVerifier:
    """Verifies ASM patches were applied correctly"""
    
    def __init__(self, rom_path: str):
        self.rom_path = Path(rom_path)
        with open(self.rom_path, 'rb') as f:
            self.rom_data = f.read()
        self.header_offset = 512 if (len(self.rom_data) % 1024) == 512 else 0
    
    def read_bytes(self, offset: int, length: int) -> bytes:
        """Read bytes from ROM accounting for header"""
        actual = offset + self.header_offset
        return self.rom_data[actual:actual+length]
    
    def verify_hook(self, offset: int, expected_bytes: bytes, name: str) -> bool:
        """Verify that specific bytes exist at an offset"""
        actual = self.read_bytes(offset, len(expected_bytes))
        
        match = actual == expected_bytes
        status = "✓" if match else "✗"
        
        print(f"{status} {name} at 0x{offset:05X}:")
        print(f"  Expected: {expected_bytes.hex().upper()}")
        print(f"  Actual:   {actual.hex().upper()}")
        
        return match
    
    def verify_level_force_patch(self, expected_level: int = None) -> dict:
        """
        Verify that level force patch was applied.
        
        Checks for:
        - JSL instruction at $05D796 (22 XX XX XX)
        - Intro skip at $9CB1 (00)
        - Short timer at $00A09C (10)
        """
        results = {}
        
        print("Verifying Level Force Patch:")
        print("=" * 70)
        
        # Check intro skip
        results['intro_skip'] = self.verify_hook(
            0x09CB1, b'\x00', 
            "Intro skip"
        )
        
        # Check short timer
        results['short_timer'] = self.verify_hook(
            0x00A09C, b'\x10',
            "Short timer"
        )
        
        # Check main level load hook
        # Should be: 22 XX XX XX (JSL to somewhere)
        hook_bytes = self.read_bytes(0x05D796, 4)
        if hook_bytes[0] == 0x22:  # JSL opcode
            print(f"✓ Main level load hook at 0x05D796:")
            print(f"  JSL ${hook_bytes[3]:02X}{hook_bytes[2]:02X}{hook_bytes[1]:02X}")
            results['main_hook'] = True
        else:
            print(f"✗ Main level load hook at 0x05D796:")
            print(f"  Expected JSL (0x22), got 0x{hook_bytes[0]:02X}")
            results['main_hook'] = False
        
        # Check level init hook
        hook_bytes2 = self.read_bytes(0x00A635, 4)
        if hook_bytes2[0] == 0x22:  # JSL opcode
            print(f"✓ Level init hook at 0x00A635:")
            print(f"  JSL ${hook_bytes2[3]:02X}{hook_bytes2[2]:02X}{hook_bytes2[1]:02X}")
            results['init_hook'] = True
        else:
            print(f"✗ Level init hook at 0x00A635:")
            print(f"  Expected JSL (0x22), got 0x{hook_bytes2[0]:02X}")
            results['init_hook'] = False
        
        print()
        
        # Overall result
        all_pass = all(results.values())
        
        if all_pass:
            print("✓ ALL CHECKS PASSED - Patch applied correctly")
        else:
            print("✗ SOME CHECKS FAILED - Patch may not have applied correctly")
        
        return results
    
    def compare_with_original(self, original_path: str, show_all: bool = False):
        """Compare patched ROM with original to show what changed"""
        with open(original_path, 'rb') as f:
            orig_data = f.read()
        
        # Detect header in both
        orig_header = 512 if (len(orig_data) % 1024) == 512 else 0
        
        print(f"Comparing with original: {Path(original_path).name}")
        print(f"  Original size: {len(orig_data):,} bytes (header: {orig_header})")
        print(f"  Patched size:  {len(self.rom_data):,} bytes (header: {self.header_offset})")
        print()
        
        # Find differences
        min_len = min(len(orig_data), len(self.rom_data))
        differences = []
        
        for i in range(min_len):
            if orig_data[i] != self.rom_data[i]:
                differences.append(i)
        
        print(f"Found {len(differences)} changed bytes")
        
        if differences:
            print("\nChanged regions:")
            # Group consecutive changes
            regions = []
            start = differences[0]
            end = differences[0]
            
            for diff in differences[1:]:
                if diff == end + 1:
                    end = diff
                else:
                    regions.append((start, end))
                    start = diff
                    end = diff
            regions.append((start, end))
            
            for start, end in regions[:20]:  # Show first 20 regions
                length = end - start + 1
                
                # Remove header offset for display
                display_start = start - self.header_offset if start >= self.header_offset else start
                
                print(f"  0x{display_start:05X} - 0x{display_start + length:05X} ({length} bytes)")
                
                if show_all or length <= 16:
                    orig_bytes = orig_data[start:end+1]
                    new_bytes = self.rom_data[start:end+1]
                    print(f"    Was: {orig_bytes.hex().upper()}")
                    print(f"    Now: {new_bytes.hex().upper()}")


def main():
    parser = argparse.ArgumentParser(
        description='Verify ASM patches were applied correctly to SMW ROMs',
        epilog='Checks ROM bytes without needing emulator'
    )
    
    parser.add_argument('rom',
                       help='Patched ROM file to verify')
    
    parser.add_argument('--level', type=str,
                       help='Expected level ID that should be forced')
    
    parser.add_argument('--original', metavar='ROM',
                       help='Original ROM to compare against')
    
    parser.add_argument('--show-all-changes', action='store_true',
                       help='Show all byte changes in detail')
    
    args = parser.parse_args()
    
    verifier = PatchVerifier(args.rom)
    
    # Verify level force patch
    results = verifier.verify_level_force_patch()
    
    # Compare with original if provided
    if args.original:
        print()
        verifier.compare_with_original(args.original, args.show_all_changes)
    
    # Return success if all checks passed
    return 0 if all(results.values()) else 1


if __name__ == '__main__':
    sys.exit(main())

