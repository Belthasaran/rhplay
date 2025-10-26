#!/usr/bin/env python3
"""
SMW Overworld Analyzer - Analyze and read overworld data from SMW ROM files

This tool reads:
1. Mario's starting position on the overworld
2. Overworld tile mappings (which tile contains which level)
3. Path data (where Mario can move)

Usage:
    smw_overworld_analyzer.py --read-start <romfile.sfc>
    smw_overworld_analyzer.py --find-level <level_id> <romfile.sfc>

For technical details, see devdocs/SMW_ROM_STRUCTURE.md
"""

import sys
import json
import argparse
from pathlib import Path
from typing import Dict, Tuple, Optional
import struct

# ROM structure constants for overworld
INITIAL_OW_POSITION_OFFSET = 0x09EF0  # 22 bytes - Initial overworld position
INITIAL_LEVEL_FLAGS_OFFSET = 0x09EE0  # 16 bytes (vanilla), or 0x5DDA0 in LM ROMs

# Overworld position data structure (22 bytes total)
# Corresponds to RAM addresses $1F11-$1F26
# Format: Each value appears twice (Mario, then Luigi)
# Byte 0-1:   Submap number (which overworld map)
# Byte 2-3:   X position (low byte)
# Byte 4-5:   X position (high byte) 
# Byte 6-7:   Y position (low byte)
# Byte 8-9:   Y position (high byte)
# Byte 10-11: Animation state
# Byte 12-13: Level number (low byte)
# Byte 14-15: Level number (high byte) 
# Byte 16-17: Events passed
# Byte 18-19: Events passed (high byte)
# Byte 20-21: Path revision


class OverworldAnalyzer:
    """Analyzes overworld data in SMW ROM files"""
    
    def __init__(self, rom_path: str):
        self.rom_path = Path(rom_path)
        self.rom_data = self._load_rom()
        self.header_offset = self._detect_header()
        
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
        if actual_offset + length > len(self.rom_data):
            raise ValueError(f"Read beyond ROM boundary")
        return bytes(self.rom_data[actual_offset:actual_offset + length])
    
    def read_uint16_le(self, offset: int) -> int:
        """Read 16-bit little-endian value"""
        data = self.read_bytes(offset, 2)
        return struct.unpack('<H', data)[0]
    
    def get_initial_position(self, player: str = 'mario') -> Dict:
        """
        Get initial overworld position for Mario or Luigi.
        
        Returns dict with: submap, x_pos, y_pos, level_num, animation
        """
        position_data = self.read_bytes(INITIAL_OW_POSITION_OFFSET, 22)
        
        # Determine offset based on player (Mario=0, Luigi=1)
        p_offset = 0 if player.lower() == 'mario' else 1
        
        # Parse the data structure
        submap = position_data[0 + p_offset]
        x_lo = position_data[2 + p_offset]
        x_hi = position_data[4 + p_offset]
        y_lo = position_data[6 + p_offset]
        y_hi = position_data[8 + p_offset]
        anim = position_data[10 + p_offset]
        level_lo = position_data[12 + p_offset] if len(position_data) > 12 else 0
        level_hi = position_data[14 + p_offset] if len(position_data) > 14 else 0
        
        # Calculate full 16-bit positions
        x_pos = (x_hi << 8) | x_lo
        y_pos = (y_hi << 8) | y_lo
        level_num = (level_hi << 8) | level_lo if len(position_data) > 14 else None
        
        return {
            'player': player,
            'submap': submap,
            'x_position': x_pos,
            'y_position': y_pos,
            'x_tile': x_pos >> 4,  # Divide by 16 to get tile position
            'y_tile': y_pos >> 4,
            'level_number': level_num,
            'animation_state': anim,
            'raw_data': {
                'submap': f'0x{submap:02X}',
                'x_lo': f'0x{x_lo:02X}',
                'x_hi': f'0x{x_hi:02X}',
                'y_lo': f'0x{y_lo:02X}',
                'y_hi': f'0x{y_hi:02X}',
                'anim': f'0x{anim:02X}',
            }
        }
    
    def get_all_initial_positions(self) -> Dict:
        """Get initial positions for both Mario and Luigi"""
        return {
            'mario': self.get_initial_position('mario'),
            'luigi': self.get_initial_position('luigi'),
            'rom_file': str(self.rom_path.name),
            'rom_offset': f'0x{INITIAL_OW_POSITION_OFFSET:05X}',
            'file_offset_with_header': f'0x{self.get_offset(INITIAL_OW_POSITION_OFFSET):05X}'
        }


def main():
    parser = argparse.ArgumentParser(
        description='Analyze overworld data in Super Mario World ROM files',
        epilog='Part of the SMW ROM analysis toolkit'
    )
    
    parser.add_argument('rom', nargs='?',
                       help='ROM file to analyze')
    
    parser.add_argument('--read-start', action='store_true',
                       help='Read initial starting position')
    
    parser.add_argument('--player', choices=['mario', 'luigi', 'both'],
                       default='both',
                       help='Which player to show data for (default: both)')
    
    parser.add_argument('--output', '-o', metavar='FILE',
                       help='Output to JSON file')
    
    parser.add_argument('--verbose', '-v', action='store_true',
                       help='Show detailed raw data')
    
    args = parser.parse_args()
    
    if not args.rom:
        parser.print_help()
        return 1
    
    if args.read_start:
        analyzer = OverworldAnalyzer(args.rom)
        data = analyzer.get_all_initial_positions()
        
        if args.output:
            with open(args.output, 'w') as f:
                json.dump(data, f, indent=2)
            print(f"Saved to {args.output}")
        else:
            print(f"Overworld Starting Position in {data['rom_file']}")
            print(f"ROM Offset: {data['rom_offset']} (+ header: {data['file_offset_with_header']})")
            print()
            
            for player in ['mario', 'luigi']:
                if args.player != 'both' and args.player != player:
                    continue
                    
                pos = data[player]
                print(f"=== {player.upper()} ===")
                print(f"  Submap: {pos['submap']} (0x{pos['submap']:02X})")
                print(f"  Position: X={pos['x_position']} (0x{pos['x_position']:04X}), Y={pos['y_position']} (0x{pos['y_position']:04X})")
                print(f"  Tile Position: X={pos['x_tile']}, Y={pos['y_tile']}")
                if pos['level_number'] is not None:
                    print(f"  Level Number: {pos['level_number']} (0x{pos['level_number']:03X})")
                print(f"  Animation State: 0x{pos['animation_state']:02X}")
                
                if args.verbose:
                    print(f"\n  Raw data:")
                    for key, val in pos['raw_data'].items():
                        print(f"    {key}: {val}")
                print()
    
    else:
        parser.print_help()
        return 1
    
    return 0


if __name__ == '__main__':
    sys.exit(main())

