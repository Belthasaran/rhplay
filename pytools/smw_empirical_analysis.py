#!/usr/bin/env python3
"""
SMW Empirical ROM Analysis Tool

This tool performs empirical analysis by comparing actual ROM files to discover:
1. Where level data pointers are stored
2. What changes when levels are modified in Lunar Magic
3. Verification of ROM structure offsets

This is the GROUND TRUTH - what actually happens beats documentation.

Usage:
    smw_empirical_analysis.py --verify-offsets <vanilla.sfc> <hack.sfc>
    smw_empirical_analysis.py --find-changes <rom1.sfc> <rom2.sfc>
    smw_empirical_analysis.py --scan-all-hacks --vanilla <vanilla.sfc>
"""

import sys
import argparse
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import json
from collections import defaultdict

# Documented offsets to verify
DOCUMENTED_OFFSETS = {
    'layer1_ptrs': 0x2E000,
    'layer2_ptrs': 0x2E600,
    'sprite_ptrs': 0x2EC00,
    'level_settings': 0x2F600,
    'secondary_entrance_low': 0x2F800,
    'secondary_entrance_pos': 0x2FA00,
    'secondary_entrance_flags': 0x2FE00,
}


class EmpiricalAnalyzer:
    """Empirically analyzes ROMs by comparing actual binary data"""
    
    def __init__(self, rom_path: str, name: str = None):
        self.rom_path = Path(rom_path)
        self.name = name or self.rom_path.name
        self.rom_data = self._load_rom()
        self.header_offset = self._detect_header()
        self.size = len(self.rom_data)
        
    def _load_rom(self) -> bytes:
        """Load ROM file"""
        if not self.rom_path.exists():
            raise FileNotFoundError(f"ROM not found: {self.rom_path}")
        with open(self.rom_path, 'rb') as f:
            return f.read()
    
    def _detect_header(self) -> int:
        """Detect copier header"""
        return 512 if (len(self.rom_data) % 1024) == 512 else 0
    
    def read_at(self, offset: int, length: int) -> bytes:
        """Read bytes at offset (accounting for header)"""
        actual = offset + self.header_offset
        if actual + length > len(self.rom_data):
            return b''
        return self.rom_data[actual:actual + length]
    
    def compare_regions(self, other: 'EmpiricalAnalyzer', 
                       offset: int, length: int) -> List[Tuple[int, bytes, bytes]]:
        """
        Compare a memory region between two ROMs.
        Returns list of (relative_offset, self_bytes, other_bytes) for differences.
        """
        self_data = self.read_at(offset, length)
        other_data = other.read_at(offset, length)
        
        if len(self_data) != len(other_data):
            # ROMs have different sizes
            min_len = min(len(self_data), len(other_data))
            self_data = self_data[:min_len]
            other_data = other_data[:min_len]
        
        differences = []
        for i in range(len(self_data)):
            if self_data[i] != other_data[i]:
                # Find the extent of this difference
                start = i
                while i < len(self_data) and self_data[i] != other_data[i]:
                    i += 1
                differences.append((start, self_data[start:i], other_data[start:i]))
        
        return differences
    
    def find_modified_level_pointers(self, vanilla: 'EmpiricalAnalyzer') -> Dict[str, List[int]]:
        """Find which level pointer tables have changes"""
        results = {
            'layer1': [],
            'layer2': [],
            'sprites': [],
        }
        
        # Check Layer 1 pointers (512 levels × 3 bytes)
        for level_id in range(512):
            offset = DOCUMENTED_OFFSETS['layer1_ptrs'] + (level_id * 3)
            self_ptr = self.read_at(offset, 3)
            vanilla_ptr = vanilla.read_at(offset, 3)
            if self_ptr != vanilla_ptr and self_ptr != b'' and vanilla_ptr != b'':
                results['layer1'].append(level_id)
        
        # Check Layer 2 pointers
        for level_id in range(512):
            offset = DOCUMENTED_OFFSETS['layer2_ptrs'] + (level_id * 3)
            self_ptr = self.read_at(offset, 3)
            vanilla_ptr = vanilla.read_at(offset, 3)
            if self_ptr != vanilla_ptr and self_ptr != b'' and vanilla_ptr != b'':
                results['layer2'].append(level_id)
        
        # Check Sprite pointers (2 bytes)
        for level_id in range(512):
            offset = DOCUMENTED_OFFSETS['sprite_ptrs'] + (level_id * 2)
            self_ptr = self.read_at(offset, 2)
            vanilla_ptr = vanilla.read_at(offset, 2)
            if self_ptr != vanilla_ptr and self_ptr != b'' and vanilla_ptr != b'':
                results['sprites'].append(level_id)
        
        return results


def verify_documented_offsets(vanilla_path: str, hack_path: str):
    """Verify that documented offsets are correct by comparing vanilla vs hack"""
    print("=" * 70)
    print("EMPIRICAL VERIFICATION OF DOCUMENTED ROM OFFSETS")
    print("=" * 70)
    
    vanilla = EmpiricalAnalyzer(vanilla_path, "Vanilla")
    hack = EmpiricalAnalyzer(hack_path, "Hack")
    
    print(f"\nVanilla ROM: {vanilla.size:,} bytes (header: {vanilla.header_offset})")
    print(f"Hack ROM:    {hack.size:,} bytes (header: {hack.header_offset})")
    
    # Test Layer 1 Pointer Table
    print("\n--- Layer 1 Pointer Table (0x2E000) ---")
    layer1_changes = 0
    for i in range(10):  # Check first 10 levels
        offset = DOCUMENTED_OFFSETS['layer1_ptrs'] + (i * 3)
        v_ptr = vanilla.read_at(offset, 3)
        h_ptr = hack.read_at(offset, 3)
        
        if v_ptr != h_ptr:
            layer1_changes += 1
            status = "CHANGED"
        else:
            status = "same"
        
        print(f"  Level 0x{i:03X}: {v_ptr.hex().upper():8s} → {h_ptr.hex().upper():8s}  [{status}]")
    
    # Count total changes
    print(f"\nCounting all Layer 1 changes across 512 levels...")
    modified_ptrs = hack.find_modified_level_pointers(vanilla)
    
    print(f"  Layer 1 modified: {len(modified_ptrs['layer1'])} levels")
    print(f"  Layer 2 modified: {len(modified_ptrs['layer2'])} levels")
    print(f"  Sprites modified: {len(modified_ptrs['sprites'])} levels")
    
    # Show union of all modifications
    all_modified = set(modified_ptrs['layer1']) | set(modified_ptrs['layer2']) | set(modified_ptrs['sprites'])
    print(f"\n  Total unique modified levels: {len(all_modified)}")
    
    if len(all_modified) > 0:
        print(f"\n  First 20 modified levels:")
        for level_id in sorted(list(all_modified))[:20]:
            in_l1 = '✓' if level_id in modified_ptrs['layer1'] else ' '
            in_l2 = '✓' if level_id in modified_ptrs['layer2'] else ' '
            in_sp = '✓' if level_id in modified_ptrs['sprites'] else ' '
            print(f"    0x{level_id:03X} ({level_id:3d}): L1[{in_l1}] L2[{in_l2}] Spr[{in_sp}]")
    
    # Test Level Settings Table
    print("\n--- Level Settings Table (0x2F600) ---")
    settings_changes = 0
    for i in range(10):
        offset = DOCUMENTED_OFFSETS['level_settings'] + i
        v_set = vanilla.read_at(offset, 1)
        h_set = hack.read_at(offset, 1)
        
        if v_set != h_set:
            settings_changes += 1
            status = "CHANGED"
        else:
            status = "same"
        
        print(f"  Level 0x{i:03X}: 0x{v_set.hex().upper()} → 0x{h_set.hex().upper()}  [{status}]")
    
    print("\n✓ Offset verification complete!")
    print(f"  Summary: Found {len(all_modified)} modified levels in hack ROM")
    
    return modified_ptrs


def scan_rom_differences(rom1_path: str, rom2_path: str, 
                        offset: int, length: int, entry_size: int):
    """Scan a specific region and report differences"""
    rom1 = EmpiricalAnalyzer(rom1_path, "ROM1")
    rom2 = EmpiricalAnalyzer(rom2_path, "ROM2")
    
    entries = length // entry_size
    changes = []
    
    for i in range(entries):
        off = offset + (i * entry_size)
        data1 = rom1.read_at(off, entry_size)
        data2 = rom2.read_at(off, entry_size)
        
        if data1 != data2 and data1 != b'' and data2 != b'':
            changes.append({
                'index': i,
                'offset': off,
                'rom1_data': data1.hex().upper(),
                'rom2_data': data2.hex().upper(),
            })
    
    return changes


def main():
    parser = argparse.ArgumentParser(
        description='Empirical ROM analysis - verify offsets against actual ROM behavior',
        epilog='This tool provides GROUND TRUTH by analyzing actual ROM files.'
    )
    
    parser.add_argument('--verify-offsets', nargs=2, metavar=('VANILLA', 'HACK'),
                       help='Verify documented offsets are correct')
    
    parser.add_argument('--find-changes', nargs=2, metavar=('ROM1', 'ROM2'),
                       help='Find all changes between two ROMs')
    
    parser.add_argument('--vanilla', metavar='ROM',
                       default='smw.sfc',
                       help='Vanilla ROM for comparison (default: smw.sfc)')
    
    parser.add_argument('--scan-region', nargs=3, metavar=('ROM', 'OFFSET', 'LENGTH'),
                       help='Scan a specific region and show hex dump')
    
    parser.add_argument('--output', '-o', metavar='FILE',
                       help='Output results to JSON file')
    
    args = parser.parse_args()
    
    if args.verify_offsets:
        results = verify_documented_offsets(args.verify_offsets[0], args.verify_offsets[1])
        
        if args.output:
            with open(args.output, 'w') as f:
                json.dump(results, f, indent=2)
            print(f"\nResults saved to {args.output}")
    
    elif args.find_changes:
        print("=" * 70)
        print("FINDING ALL CHANGES BETWEEN TWO ROMS")
        print("=" * 70)
        
        rom1 = EmpiricalAnalyzer(args.find_changes[0], "ROM1")
        rom2 = EmpiricalAnalyzer(args.find_changes[1], "ROM2")
        
        print(f"\nROM1: {rom1.name} - {rom1.size:,} bytes")
        print(f"ROM2: {rom2.name} - {rom2.size:,} bytes")
        
        # Check all documented regions
        for name, offset in DOCUMENTED_OFFSETS.items():
            if 'ptrs' in name or 'ptr' in name:
                if 'sprite' in name:
                    entry_size = 2
                    length = 512 * 2
                else:
                    entry_size = 3
                    length = 512 * 3
            else:
                entry_size = 1
                length = 512
            
            changes = scan_rom_differences(args.find_changes[0], args.find_changes[1],
                                          offset, length, entry_size)
            
            print(f"\n{name} (0x{offset:05X}): {len(changes)} changes")
            
            if changes and len(changes) <= 20:
                for change in changes[:10]:
                    print(f"  0x{change['index']:03X}: {change['rom1_data']} → {change['rom2_data']}")
    
    elif args.scan_region:
        rom_path = args.scan_region[0]
        offset = int(args.scan_region[1], 0)  # Accept hex or decimal
        length = int(args.scan_region[2], 0)
        
        rom = EmpiricalAnalyzer(rom_path)
        data = rom.read_at(offset, length)
        
        print(f"ROM: {rom.name}")
        print(f"Offset: 0x{offset:05X} (with header: 0x{offset + rom.header_offset:05X})")
        print(f"Length: {length} bytes\n")
        
        # Hex dump
        for i in range(0, len(data), 16):
            hex_part = ' '.join(f'{b:02X}' for b in data[i:i+16])
            ascii_part = ''.join(chr(b) if 32 <= b < 127 else '.' for b in data[i:i+16])
            print(f"{offset + i:08X}: {hex_part:<48s} {ascii_part}")
    
    else:
        parser.print_help()
        return 1
    
    return 0


if __name__ == '__main__':
    sys.exit(main())

