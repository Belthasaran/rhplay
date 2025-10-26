#!/usr/bin/env python3
"""
SMW Level Analyzer - Extract and compare level data from Super Mario World ROM files

This tool can:
1. List all valid (non-vanilla) levels in a ROM hack
2. Compare two ROM files to find changed levels
3. Extract level pointers and metadata
4. Export level data in various formats

Usage:
    smw_level_analyzer.py --list <romfile.sfc>
    smw_level_analyzer.py --compare <rom1.sfc> <rom2.sfc>
    smw_level_analyzer.py --extract <romfile.sfc> --output levels.json
    smw_level_analyzer.py --diff <rom1.sfc> <rom2.sfc> --vanilla <vanilla.sfc>

For more information, see devdocs/SMW_ROM_STRUCTURE.md
"""

import sys
import json
import argparse
from pathlib import Path
from typing import List, Dict, Tuple, Optional
import os

# Import level name extractor
try:
    from smw_level_names import LevelNameExtractor
    LEVEL_NAMES_AVAILABLE = True
except ImportError:
    LEVEL_NAMES_AVAILABLE = False

# Environment variable to override vanilla ROM path
DEFAULT_VANILLA_ROM = os.environ.get('SMW_VANILLA_ROM', 'smw.sfc')

# ROM structure constants
LAYER1_POINTER_OFFSET = 0x2E000
LAYER2_POINTER_OFFSET = 0x2E600
SPRITE_POINTER_OFFSET = 0x2EC00
LEVEL_SETTINGS_OFFSET = 0x2F600

LAYER_POINTER_SIZE = 3  # 3 bytes per level for Layer 1/2
SPRITE_POINTER_SIZE = 2  # 2 bytes per level for sprites
TOTAL_LEVELS = 512

# Vanilla SMW commonly used level ranges
VANILLA_PRIMARY_LEVELS = range(0x000, 0x025)  # 0x000 - 0x024
VANILLA_SUBLEVELS = range(0x101, 0x13C)       # 0x101 - 0x13B


class ROMAnalyzer:
    """Analyzes Super Mario World ROM files for level data"""
    
    def __init__(self, rom_path: str, enable_names: bool = False):
        self.rom_path = Path(rom_path)
        self.rom_data = self._load_rom()
        self.header_offset = self._detect_header()
        
        # Level name extractor (optional)
        self.name_extractor = None
        if enable_names and LEVEL_NAMES_AVAILABLE:
            try:
                self.name_extractor = LevelNameExtractor(str(rom_path))
            except Exception as e:
                print(f"[WARN] Could not initialize level name extractor: {e}", file=sys.stderr)
        
    def _load_rom(self) -> bytearray:
        """Load ROM file into memory"""
        if not self.rom_path.exists():
            raise FileNotFoundError(f"ROM file not found: {self.rom_path}")
        
        with open(self.rom_path, 'rb') as f:
            return bytearray(f.read())
    
    def _detect_header(self) -> int:
        """Detect if ROM has a 512-byte copier header"""
        file_size = len(self.rom_data)
        if (file_size % 1024) == 512:
            print(f"[INFO] Detected 512-byte header in {self.rom_path.name}", file=sys.stderr)
            return 512
        return 0
    
    def get_offset(self, base_offset: int) -> int:
        """Get actual file offset accounting for header"""
        return base_offset + self.header_offset
    
    def read_bytes(self, offset: int, length: int) -> bytes:
        """Read bytes from ROM at given offset"""
        actual_offset = self.get_offset(offset)
        return bytes(self.rom_data[actual_offset:actual_offset + length])
    
    def get_level_layer1_pointer(self, level_id: int) -> bytes:
        """Get 3-byte Layer 1 pointer for a level"""
        offset = LAYER1_POINTER_OFFSET + (level_id * LAYER_POINTER_SIZE)
        return self.read_bytes(offset, LAYER_POINTER_SIZE)
    
    def get_level_layer2_pointer(self, level_id: int) -> bytes:
        """Get 3-byte Layer 2 pointer for a level"""
        offset = LAYER2_POINTER_OFFSET + (level_id * LAYER_POINTER_SIZE)
        return self.read_bytes(offset, LAYER_POINTER_SIZE)
    
    def get_level_sprite_pointer(self, level_id: int) -> bytes:
        """Get 2-byte sprite pointer for a level"""
        offset = SPRITE_POINTER_OFFSET + (level_id * SPRITE_POINTER_SIZE)
        return self.read_bytes(offset, SPRITE_POINTER_SIZE)
    
    def get_level_settings(self, level_id: int) -> int:
        """Get level settings byte"""
        offset = LEVEL_SETTINGS_OFFSET + level_id
        return self.read_bytes(offset, 1)[0]
    
    def get_level_info(self, level_id: int) -> Dict:
        """Get all information about a level"""
        layer1_ptr = self.get_level_layer1_pointer(level_id)
        layer2_ptr = self.get_level_layer2_pointer(level_id)
        sprite_ptr = self.get_level_sprite_pointer(level_id)
        settings = self.get_level_settings(level_id)
        
        # Parse settings byte (iuveeeee format)
        no_yoshi_intro = bool(settings & 0x80)
        unknown_vert = bool(settings & 0x40)
        vertical = bool(settings & 0x20)
        entrance_screen = settings & 0x1F
        
        info = {
            'level_id': level_id,
            'level_id_hex': f'0x{level_id:03X}',
            'layer1_pointer': layer1_ptr.hex().upper(),
            'layer1_pointer_int': int.from_bytes(layer1_ptr, 'little'),
            'layer2_pointer': layer2_ptr.hex().upper(),
            'layer2_pointer_int': int.from_bytes(layer2_ptr, 'little'),
            'sprite_pointer': sprite_ptr.hex().upper(),
            'sprite_pointer_int': int.from_bytes(sprite_ptr, 'little'),
            'settings': {
                'raw': f'0x{settings:02X}',
                'no_yoshi_intro': no_yoshi_intro,
                'vertical_level': vertical,
                'entrance_screen': entrance_screen
            }
        }
        
        # Add level name if available
        if self.name_extractor and level_id < 93:  # Only 93 name entries exist
            try:
                level_name = self.name_extractor.extract_level_name(level_id)
                if level_name:
                    info['level_name'] = level_name.strip()
            except Exception:
                pass  # Silently ignore name extraction errors
        
        return info
    
    def find_valid_levels(self, vanilla_rom: Optional['ROMAnalyzer'] = None) -> List[int]:
        """
        Find all valid levels in the ROM.
        If vanilla_rom is provided, returns levels that differ from vanilla.
        Otherwise, returns levels with non-zero pointers.
        """
        valid_levels = []
        
        for level_id in range(TOTAL_LEVELS):
            if vanilla_rom:
                # Compare against vanilla
                if self.is_level_modified(level_id, vanilla_rom):
                    valid_levels.append(level_id)
            else:
                # Check if level has non-zero pointers
                layer1 = self.get_level_layer1_pointer(level_id)
                if layer1 != b'\x00\x00\x00':
                    valid_levels.append(level_id)
        
        return valid_levels
    
    def is_level_modified(self, level_id: int, vanilla_rom: 'ROMAnalyzer') -> bool:
        """Check if a level is modified compared to vanilla ROM"""
        # Check Layer 1
        if self.get_level_layer1_pointer(level_id) != vanilla_rom.get_level_layer1_pointer(level_id):
            return True
        
        # Check Layer 2
        if self.get_level_layer2_pointer(level_id) != vanilla_rom.get_level_layer2_pointer(level_id):
            return True
        
        # Check Sprites
        if self.get_level_sprite_pointer(level_id) != vanilla_rom.get_level_sprite_pointer(level_id):
            return True
        
        return False
    
    def compare_roms(self, other_rom: 'ROMAnalyzer') -> List[int]:
        """Compare this ROM with another and return list of changed level IDs"""
        changed_levels = []
        
        for level_id in range(TOTAL_LEVELS):
            if self.is_level_modified(level_id, other_rom):
                changed_levels.append(level_id)
        
        return changed_levels


def format_level_list(levels: List[int], format_type: str = 'hex') -> str:
    """Format level list for output"""
    if format_type == 'hex':
        return ', '.join([f'0x{lid:03X}' for lid in levels])
    elif format_type == 'dec':
        return ', '.join([str(lid) for lid in levels])
    elif format_type == 'both':
        return ', '.join([f'{lid} (0x{lid:03X})' for lid in levels])
    return str(levels)


def main():
    parser = argparse.ArgumentParser(
        description='Analyze Super Mario World ROM files for level data',
        epilog='For detailed documentation, see devdocs/SMW_ROM_STRUCTURE.md'
    )
    
    parser.add_argument('--list', metavar='ROM',
                        help='List all valid/modified levels in a ROM')
    
    parser.add_argument('--compare', nargs=2, metavar=('ROM1', 'ROM2'),
                        help='Compare two ROMs and show changed levels')
    
    parser.add_argument('--extract', metavar='ROM',
                        help='Extract detailed level information')
    
    parser.add_argument('--vanilla', metavar='VANILLA_ROM',
                        default=DEFAULT_VANILLA_ROM,
                        help=f'Path to vanilla SMW ROM (default: {DEFAULT_VANILLA_ROM})')
    
    parser.add_argument('--output', '-o', metavar='FILE',
                        help='Output file for --extract (JSON format)')
    
    parser.add_argument('--format', choices=['hex', 'dec', 'both'],
                        default='hex',
                        help='Format for level IDs (default: hex)')
    
    parser.add_argument('--filter-vanilla', action='store_true',
                        help='Only show non-vanilla levels when listing')
    
    parser.add_argument('--show-names', action='store_true',
                        help='Show English level names (when available)')
    
    args = parser.parse_args()
    
    if args.list:
        # List levels in a ROM
        rom = ROMAnalyzer(args.list, enable_names=args.show_names)
        
        if args.filter_vanilla and Path(args.vanilla).exists():
            vanilla = ROMAnalyzer(args.vanilla)
            levels = rom.find_valid_levels(vanilla)
            print(f"Modified levels in {Path(args.list).name} (compared to vanilla):")
        else:
            levels = rom.find_valid_levels()
            print(f"Valid levels in {Path(args.list).name}:")
        
        print(f"Total: {len(levels)} levels")
        
        if args.show_names and rom.name_extractor:
            # Show with names
            print("\nLevel ID | Level Name")
            print("-" * 50)
            for level_id in levels:
                if level_id < 93:
                    name = rom.name_extractor.extract_level_name(level_id)
                    name = name.strip() if name else "(no name)"
                else:
                    name = "(no name data)"
                print(f"{level_id:3d} (0x{level_id:03X}) | {name}")
        else:
            print(format_level_list(levels, args.format))
        
    elif args.compare:
        # Compare two ROMs
        rom1 = ROMAnalyzer(args.compare[0])
        rom2 = ROMAnalyzer(args.compare[1])
        
        changed_levels = rom1.compare_roms(rom2)
        
        print(f"Comparing {Path(args.compare[0]).name} vs {Path(args.compare[1]).name}:")
        print(f"Total changed levels: {len(changed_levels)}")
        
        if changed_levels:
            print("\nChanged level IDs:")
            print(format_level_list(changed_levels, args.format))
            
            # Show first few differences in detail
            print("\nFirst 5 changes (detailed):")
            for level_id in changed_levels[:5]:
                info1 = rom1.get_level_info(level_id)
                info2 = rom2.get_level_info(level_id)
                
                print(f"\n  Level {info1['level_id_hex']}:")
                print(f"    {Path(args.compare[0]).name}: Layer1={info1['layer1_pointer']}, Layer2={info1['layer2_pointer']}")
                print(f"    {Path(args.compare[1]).name}: Layer1={info2['layer1_pointer']}, Layer2={info2['layer2_pointer']}")
        else:
            print("No level changes detected.")
    
    elif args.extract:
        # Extract detailed level information
        rom = ROMAnalyzer(args.extract, enable_names=True)  # Always enable names for extract
        
        # Determine which levels to extract
        if Path(args.vanilla).exists():
            vanilla = ROMAnalyzer(args.vanilla)
            levels = rom.find_valid_levels(vanilla)
        else:
            levels = rom.find_valid_levels()
        
        level_data = {}
        for level_id in levels:
            level_data[f"0x{level_id:03X}"] = rom.get_level_info(level_id)
        
        output_data = {
            'rom_file': str(rom.rom_path.name),
            'total_levels': len(levels),
            'levels': level_data
        }
        
        if args.output:
            with open(args.output, 'w') as f:
                json.dump(output_data, f, indent=2)
            print(f"Extracted {len(levels)} levels to {args.output}")
        else:
            print(json.dumps(output_data, indent=2))
    
    else:
        parser.print_help()
        return 1
    
    return 0


if __name__ == '__main__':
    sys.exit(main())

