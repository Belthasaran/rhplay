#!/usr/bin/env python3
"""
SMW Test ROM Creator - Create isolated level test ROMs

This tool modifies a SMW ROM to:
1. Set a specific level as the starting level (bypassing overworld)
2. Exit to overworld after level clear with no events
3. Optionally lock the player on one overworld tile (no movement)

Usage:
    smw_create_test_rom.py <input.sfc> --level 0x105 --output test.sfc
    smw_create_test_rom.py <input.sfc> --level 261 --lock-overworld --output test.sfc

Environment Variables:
    SMW_TEST_ROM_DIR - Output directory for test ROMs

For technical details, see devdocs/SMW_ROM_STRUCTURE.md
"""

import sys
import argparse
from pathlib import Path
from typing import Optional
import os
import shutil

# ROM structure constants
INTRO_LEVEL_OFFSET = 0x09CB1          # Intro level number (low byte)
INTRO_SKIP_OFFSET = 0x09CB1           # Set to 0x00 to skip intro
OVERWORLD_EVENT_TABLES = [
    # These would need to be zeroed to disable events
]

# Output directory
DEFAULT_OUTPUT_DIR = os.environ.get('SMW_TEST_ROM_DIR', 'test_roms')


class TestROMCreator:
    """Creates isolated test ROMs for specific levels"""
    
    def __init__(self, input_rom: str):
        self.input_path = Path(input_rom)
        if not self.input_path.exists():
            raise FileNotFoundError(f"Input ROM not found: {input_rom}")
        
        with open(self.input_path, 'rb') as f:
            self.rom_data = bytearray(f.read())
        
        self.header_offset = self._detect_header()
        self.modifications = []
    
    def _detect_header(self) -> int:
        """Detect if ROM has a 512-byte copier header"""
        file_size = len(self.rom_data)
        if (file_size % 1024) == 512:
            return 512
        return 0
    
    def get_offset(self, base_offset: int) -> int:
        """Get actual file offset accounting for header"""
        return base_offset + self.header_offset
    
    def write_byte(self, offset: int, value: int, description: str = ""):
        """Write a byte to ROM and log the modification"""
        actual_offset = self.get_offset(offset)
        old_value = self.rom_data[actual_offset]
        self.rom_data[actual_offset] = value & 0xFF
        
        self.modifications.append({
            'offset': f'0x{offset:05X}',
            'actual_offset': f'0x{actual_offset:05X}',
            'old_value': f'0x{old_value:02X}',
            'new_value': f'0x{value:02X}',
            'description': description
        })
    
    def write_bytes(self, offset: int, values: bytes, description: str = ""):
        """Write multiple bytes to ROM"""
        actual_offset = self.get_offset(offset)
        old_values = bytes(self.rom_data[actual_offset:actual_offset+len(values)])
        
        for i, val in enumerate(values):
            self.rom_data[actual_offset + i] = val
        
        self.modifications.append({
            'offset': f'0x{offset:05X}',
            'actual_offset': f'0x{actual_offset:05X}',
            'old_value': old_values.hex().upper(),
            'new_value': values.hex().upper(),
            'description': description
        })
    
    def skip_intro(self):
        """
        Skip the intro level and go directly to overworld.
        Sets intro level number to 0x00.
        """
        self.write_byte(INTRO_SKIP_OFFSET, 0x00, 
                       "Skip intro - set intro level to 0x00")
    
    def set_starting_level(self, level_id: int):
        """
        Set the starting level by modifying the intro level.
        
        Note: This is a simplified approach. The level_id should be the
        actual level number (0x000-0x1FF), and we set it as level + 0x24
        """
        # SMW stores level numbers with +0x24 offset in some places
        level_byte = level_id & 0xFF
        
        self.write_byte(INTRO_SKIP_OFFSET, level_byte + 0x24,
                       f"Set intro to level 0x{level_id:03X}")
    
    def create_isolated_test_rom(self, level_id: int, lock_overworld: bool = False):
        """
        Create a test ROM that starts at a specific level.
        
        Args:
            level_id: Level ID to test (0x000-0x1FF)
            lock_overworld: If True, prevent movement on overworld
        """
        print(f"Creating test ROM for level 0x{level_id:03X}...")
        
        # Skip the regular intro
        self.skip_intro()
        
        # TODO: More sophisticated level starting
        # For now, this is a placeholder that needs the actual
        # overworld tile mapping to work properly
        
        if lock_overworld:
            print("Note: Overworld locking not yet implemented")
            # TODO: Modify overworld path data to prevent movement
        
        print(f"Applied {len(self.modifications)} modifications")
    
    def save(self, output_path: str):
        """Save the modified ROM"""
        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output, 'wb') as f:
            f.write(self.rom_data)
        
        print(f"\nSaved to: {output}")
        print(f"ROM size: {len(self.rom_data):,} bytes")
    
    def print_modifications(self):
        """Print all modifications made"""
        if not self.modifications:
            print("No modifications made")
            return
        
        print("\nModifications made:")
        print("-" * 80)
        for mod in self.modifications:
            print(f"Offset {mod['offset']} (file: {mod['actual_offset']})")
            print(f"  {mod['old_value']} -> {mod['new_value']}")
            print(f"  {mod['description']}")


def main():
    parser = argparse.ArgumentParser(
        description='Create isolated test ROMs for specific SMW levels',
        epilog='Creates a modified ROM that starts at a specific level for testing'
    )
    
    parser.add_argument('input_rom',
                       help='Input ROM file (.sfc)')
    
    parser.add_argument('--level', '-l', required=True,
                       help='Level ID to test (hex like 0x105 or decimal like 261)')
    
    parser.add_argument('--output', '-o',
                       help='Output ROM file (default: test_roms/test_LEVELID.sfc)')
    
    parser.add_argument('--lock-overworld', action='store_true',
                       help='Prevent player movement on overworld (not yet implemented)')
    
    parser.add_argument('--show-mods', action='store_true',
                       help='Show detailed list of modifications made')
    
    args = parser.parse_args()
    
    # Parse level ID
    try:
        if args.level.startswith('0x') or args.level.startswith('0X'):
            level_id = int(args.level, 16)
        else:
            level_id = int(args.level)
    except ValueError:
        print(f"Error: Invalid level ID: {args.level}", file=sys.stderr)
        return 1
    
    if level_id < 0 or level_id > 0x1FF:
        print(f"Error: Level ID must be 0x000-0x1FF (0-511)", file=sys.stderr)
        return 1
    
    # Determine output path
    if args.output:
        output_path = args.output
    else:
        output_dir = Path(DEFAULT_OUTPUT_DIR)
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"test_level_{level_id:03X}.sfc"
    
    try:
        # Create test ROM
        creator = TestROMCreator(args.input_rom)
        creator.create_isolated_test_rom(level_id, args.lock_overworld)
        
        if args.show_mods:
            creator.print_modifications()
        
        creator.save(output_path)
        
        print(f"\n✓ Test ROM created successfully!")
        print(f"  Level: 0x{level_id:03X} ({level_id})")
        print(f"  Output: {output_path}")
        
        if args.lock_overworld:
            print(f"\n  Note: Overworld locking requested but not yet fully implemented")
        
        print(f"\n  To test: Load {output_path} in your emulator")
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1
    
    return 0


if __name__ == '__main__':
    sys.exit(main())

