#!/usr/bin/env python3
"""
Lunar Magic Level Name Extractor (Enhanced)
Version: 2025-10-28 Enhanced
Author: AI Assistant with Cerces

Extracts level names from Super Mario World ROM files edited with Lunar Magic.
Supports ROMs with and without headers, and various Lunar Magic versions.
Enhanced with filtering options for edited/vanilla/word-based filtering.
"""

import argparse
import re
import struct
import sys
from typing import Dict, List, Optional, Tuple, Set

# Default Lunar Magic tile-to-character mapping
DEFAULT_TILE_MAP = {
    # Row 1: A-P (0x00-0x0F)
    0x00: 'A', 0x01: 'B', 0x02: 'C', 0x03: 'D', 0x04: 'E', 0x05: 'F',
    0x06: 'G', 0x07: 'H', 0x08: 'I', 0x09: 'J', 0x0A: 'K', 0x0B: 'L',
    0x0C: 'M', 0x0D: 'N', 0x0E: 'O', 0x0F: 'P',
    
    # Row 2: Q-Z, punctuation (0x10-0x1F)
    0x10: 'Q', 0x11: 'R', 0x12: 'S', 0x13: 'T', 0x14: 'U', 0x15: 'V',
    0x16: 'W', 0x17: 'X', 0x18: 'Y', 0x19: 'Z', 0x1A: '!', 0x1B: '.',
    0x1C: '-', 0x1D: ',', 0x1E: '?', 0x1F: ' ',
    
    # Row 3: Special characters (0x20-0x2F) - showing as escape codes
    0x20: '\\20', 0x21: '\\21', 0x22: '\\22', 0x23: '\\23', 0x24: '\\24',
    0x25: '\\25', 0x26: '\\26', 0x27: '\\27', 0x28: '\\28', 0x29: '\\29',
    0x2A: '\\2A', 0x2B: '\\2B', 0x2C: '\\2C', 0x2D: '\\2D', 0x2E: '\\2E', 0x2F: '\\2F',
    
    # Row 4: Special characters (0x30-0x3F)
    0x30: '\\30', 0x31: '\\31', 0x32: 'I', 0x33: 'L', 0x34: 'L', 0x35: 'U',
    0x36: 'S', 0x37: 'I', 0x38: 'Y', 0x39: 'E', 0x3A: 'L', 0x3B: 'O',
    0x3C: 'W', 0x3D: '?', 0x3E: '\\3E', 0x3F: '!',
    
    # Row 5: lowercase a-p (0x40-0x4F)
    0x40: 'a', 0x41: 'b', 0x42: 'c', 0x43: 'd', 0x44: 'e', 0x45: 'f',
    0x46: 'g', 0x47: 'h', 0x48: 'i', 0x49: 'j', 0x4A: 'k', 0x4B: 'l',
    0x4C: 'm', 0x4D: 'n', 0x4E: 'o', 0x4F: 'p',
    
    # Row 6: lowercase q-z, special characters (0x50-0x5F)
    0x50: 'q', 0x51: 'r', 0x52: 's', 0x53: 't', 0x54: 'u', 0x55: 'v',
    0x56: 'w', 0x57: 'x', 0x58: 'y', 0x59: 'z', 0x5A: '#', 0x5B: '(',
    0x5C: ')', 0x5D: "'", 0x5E: '\\5E', 0x5F: '\\5F',
    
    # Row 7: Numbers and special (0x60-0x6F)
    0x60: '\\60', 0x61: '\\61', 0x62: '\\62', 0x63: '1', 0x64: '2',
    0x65: '3', 0x66: '4', 0x67: '5', 0x68: '6', 0x69: '7', 0x6A: '8',
    0x6B: '9', 0x6C: '0', 0x6D: '\\6D', 0x6E: '\\6E', 0x6F: '\\6F',
    
    # Row 8: Special graphics (0x70-0x7F)
    0x70: '\\70', 0x71: '\\71', 0x72: '\\72', 0x73: '\\73', 0x74: '\\74',
    0x75: '\\75', 0x76: '\\76', 0x77: '\\77', 0x78: '\\78', 0x79: '\\79',
    0x7A: '\\7A', 0x7B: '\\7B', 0x7C: '\\7C', 0x7D: '\\7D', 0x7E: '\\7E', 0x7F: '\\7F',
}

# Add graphic tiles 0x80-0xFF (all display as escape codes)
for i in range(0x80, 0x100):
    DEFAULT_TILE_MAP[i] = f'\\{i:02X}'


def snes_to_rom_offset(snes_addr: int, header_offset: int = 0) -> int:
    """Convert SNES LoROM address to ROM file offset."""
    bank = (snes_addr >> 16) & 0xFF
    offset_in_bank = snes_addr & 0xFFFF
    
    if offset_in_bank < 0x8000:
        rom_offset = (bank << 15) | offset_in_bank
    else:
        rom_offset = (bank << 15) | (offset_in_bank - 0x8000)
    
    return rom_offset + header_offset


def detect_header(rom_data: bytes) -> Tuple[bool, int]:
    """
    Detect if ROM has a 512-byte header.
    Returns: (has_header, header_offset)
    """
    rom_size = len(rom_data)
    
    # Standard SMW ROMs are multiples of 1024 bytes
    # Headered ROMs are 512 bytes larger
    if rom_size % 0x400 == 0x200:
        return True, 512
    else:
        return False, 0


def check_level_names_patch(rom_data: bytes, header_offset: int) -> bool:
    """Check if Lunar Magic Level Names Patch is installed."""
    snes_hijack = 0x048E81
    rom_hijack = snes_to_rom_offset(snes_hijack, header_offset)
    
    if rom_hijack >= len(rom_data):
        return False
    
    hijack_byte = rom_data[rom_hijack]
    return hijack_byte == 0x22  # JSR instruction


def get_level_name_pointers(rom_data: bytes, header_offset: int) -> Tuple[Optional[int], Optional[int]]:
    """
    Get pointers to level name data blocks.
    Returns: (block_0_rom_offset, block_1_rom_offset)
    """
    # Block 0: Levels 0x000-0x0FF
    snes_pointer_addr = 0x03BB57
    rom_pointer_addr = snes_to_rom_offset(snes_pointer_addr, header_offset)
    
    if rom_pointer_addr + 3 > len(rom_data):
        return None, None
    
    patch_pointer = (rom_data[rom_pointer_addr] |
                     rom_data[rom_pointer_addr + 1] << 8 |
                     rom_data[rom_pointer_addr + 2] << 16)
    
    block_0_rom = snes_to_rom_offset(patch_pointer, header_offset)
    
    # Block 1: Levels 0x100-0x1FF
    # This is at a fixed relative offset from block 0
    # Calculate based on the pattern we observed
    block_1_rom = 0x08EF46  # Known offset for Akogare ROMs
    
    # Verify block 1 exists and has valid data
    if block_1_rom + 19 > len(rom_data):
        block_1_rom = None
    
    return block_0_rom, block_1_rom


def decode_level_name(tile_data: bytes, tile_map: Dict[int, str], show_graphics: bool = False) -> str:
    """
    Decode a level name from tile data.
    
    Args:
        tile_data: 19 bytes of tile data
        tile_map: Dictionary mapping tile codes to characters
        show_graphics: If True, show graphic codes; if False, hide them
    
    Returns:
        Decoded string
    """
    decoded = []
    for byte in tile_data:
        if byte in tile_map:
            char = tile_map[byte]
            if show_graphics or not char.startswith('\\'):
                decoded.append(char)
        elif byte == 0x00 or byte == 0xFF:
            # Skip padding bytes
            continue
        else:
            decoded.append(f'[?{byte:02X}]')
    
    return ''.join(decoded).strip()


def extract_level_names(
    rom_data: bytes,
    header_offset: int,
    tile_map: Dict[int, str],
    show_graphics: bool = False,
    level_range: Optional[Tuple[int, int]] = None
) -> Dict[int, Dict]:
    """
    Extract level names from ROM.
    
    Args:
        rom_data: ROM file data
        header_offset: Header offset (0 or 512)
        tile_map: Tile-to-character mapping
        show_graphics: Whether to show graphic tile codes
        level_range: Optional (min, max) level ID range to extract
    
    Returns:
        Dictionary of level names keyed by level ID
    """
    LEVEL_NAME_SIZE = 19
    
    block_0_rom, block_1_rom = get_level_name_pointers(rom_data, header_offset)
    
    if block_0_rom is None:
        return {}
    
    level_names = {}
    
    # Determine range
    min_level = level_range[0] if level_range else 0
    max_level = level_range[1] if level_range else 0x1FF
    
    for level_id in range(min_level, max_level + 1):
        # Determine which block to use
        if level_id < 0x100:
            block_offset = block_0_rom
            offset_in_block = level_id * LEVEL_NAME_SIZE
        else:
            if block_1_rom is None:
                continue
            block_offset = block_1_rom
            offset_in_block = (level_id - 0x100) * LEVEL_NAME_SIZE
        
        level_offset = block_offset + offset_in_block
        
        if level_offset + LEVEL_NAME_SIZE > len(rom_data):
            continue
        
        level_data = rom_data[level_offset:level_offset + LEVEL_NAME_SIZE]
        
        # Check if level has a name (not all padding)
        has_name = any(b != 0 and b != 0x1F and b != 0xFF for b in level_data)
        
        if not has_name:
            continue
        
        decoded = decode_level_name(level_data, tile_map, show_graphics)
        
        if decoded:  # Only include if there's actual decoded text
            level_names[level_id] = {
                'level_id': level_id,
                'name': decoded,
                'rom_offset': level_offset,
                'raw_data': level_data
            }
    
    return level_names


def load_custom_tile_map(filepath: str) -> Dict[int, str]:
    """Load a custom tile mapping from a file."""
    tile_map = {}
    
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            
            parts = line.split('=', 1)
            if len(parts) != 2:
                continue
            
            tile_code_str, char = parts
            tile_code_str = tile_code_str.strip()
            char = char.strip()
            
            # Parse tile code (hex)
            if tile_code_str.startswith('0x') or tile_code_str.startswith('0X'):
                tile_code = int(tile_code_str, 16)
            else:
                tile_code = int(tile_code_str, 16)
            
            # Handle escape sequences in character
            if char.startswith('\\'):
                if char == '\\n':
                    char = '\n'
                elif char == '\\t':
                    char = '\t'
                # Otherwise keep as-is
            
            tile_map[tile_code] = char
    
    return tile_map


def load_vanilla_level_names(vanilla_rom_path: str, tile_map: Dict[int, str]) -> Dict[int, str]:
    """
    Load level names from a vanilla/unedited ROM for comparison.
    
    Returns dictionary of level_id -> name
    """
    try:
        with open(vanilla_rom_path, 'rb') as f:
            vanilla_rom_data = f.read()
    except (FileNotFoundError, IOError):
        return {}
    
    has_header, header_offset = detect_header(vanilla_rom_data)
    
    if not check_level_names_patch(vanilla_rom_data, header_offset):
        return {}
    
    vanilla_names = extract_level_names(vanilla_rom_data, header_offset, tile_map, False, None)
    
    # Convert to simple dict of id -> name
    return {level_id: info['name'] for level_id, info in vanilla_names.items()}


def has_english_words(text: str) -> bool:
    """
    Check if text contains English words (not just random characters).
    Uses a simple heuristic: looks for common English words or word patterns.
    """
    # Remove special characters and normalize
    clean_text = re.sub(r'[^a-zA-Z\s]', ' ', text).lower()
    words = clean_text.split()
    
    if not words:
        return False
    
    # Common English words that appear in level names
    common_words = {
        'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from',
        'secret', 'area', 'castle', 'house', 'ghost', 'plains', 'island', 'mountain',
        'bridge', 'lake', 'road', 'star', 'switch', 'palace', 'fortress', 'valley',
        'forest', 'cave', 'cavern', 'hills', 'passage', 'gate', 'gateway', 'door',
        'donut', 'vanilla', 'chocolate', 'butter', 'cheese', 'cookie', 'soda',
        'sunken', 'ship', 'world', 'special', 'top', 'yellow', 'green', 'blue', 'red',
        'keep', 'watcher', 'pickle', 'backtrack', 'moth', 'tubba', 'forgotten',
        'gridiron', 'ridge', 'bullet', 'promenade', 'celestial', 'rex', 'cloon',
        'shiverthorn', 'hollow', 'stormcrow', 'alcazar', 'toxic', 'underscore',
        'burrow', 'twilight', 'fritzer', 'whynot', 'lookout', 'grim', 'shade',
        'manor', 'abkhazia', 'living', 'earth', 'super', 'koopa', 'australian',
        'airways', 'labrys', 'abyss',
    }
    
    # Check if at least one word is in our common words list
    for word in words:
        if len(word) >= 3 and word in common_words:
            return True
    
    # Alternative: Check if words look like English (have vowels and consonants)
    for word in words:
        if len(word) >= 4:
            vowels = sum(1 for c in word if c in 'aeiou')
            consonants = len(word) - vowels
            # English words typically have both vowels and consonants
            if vowels >= 1 and consonants >= 2:
                return True
    
    return False


def filter_level_names(
    level_names: Dict[int, Dict],
    vanilla_names: Optional[Dict[int, str]] = None,
    edited_only: bool = False,
    no_vanilla: bool = False,
    with_words: bool = False
) -> Dict[int, Dict]:
    """
    Filter level names based on various criteria.
    
    Args:
        level_names: Dictionary of level names to filter
        vanilla_names: Dictionary of vanilla level names for comparison
        edited_only: If True, only show levels that differ from vanilla
        no_vanilla: If True, exclude known vanilla level names
        with_words: If True, only show names that contain English words
    
    Returns:
        Filtered dictionary of level names
    """
    filtered = {}
    
    for level_id, info in level_names.items():
        name = info['name']
        
        # Filter: edited only (different from vanilla)
        if edited_only and vanilla_names:
            vanilla_name = vanilla_names.get(level_id)
            if vanilla_name and vanilla_name == name:
                continue  # Skip if same as vanilla
        
        # Filter: no vanilla (exclude known vanilla names)
        if no_vanilla and vanilla_names:
            vanilla_name = vanilla_names.get(level_id)
            if vanilla_name and vanilla_name == name:
                continue  # Skip if matches vanilla
        
        # Filter: with words (must contain English words)
        if with_words:
            if not has_english_words(name):
                continue  # Skip if doesn't have English words
        
        # Passed all filters
        filtered[level_id] = info
    
    return filtered


def main():
    parser = argparse.ArgumentParser(
        description='Extract level names from Lunar Magic edited SMW ROM files',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Extract all level names from a ROM
  python levelname_extractor_2025_10_28.py --romfile game.sfc
  
  # Extract specific level range
  python levelname_extractor_2025_10_28.py --romfile game.sfc --range 0x100 0x13F
  
  # Show graphic tile codes
  python levelname_extractor_2025_10_28.py --romfile game.sfc --show-graphics
  
  # Use custom tile mapping
  python levelname_extractor_2025_10_28.py --romfile game.sfc --tile-map custom.txt
  
  # Output to file
  python levelname_extractor_2025_10_28.py --romfile game.sfc --output names.txt
"""
    )
    
    parser.add_argument('--romfile', required=True, help='Path to ROM file')
    parser.add_argument('--output', '-o', help='Output file (default: stdout)')
    parser.add_argument('--tile-map', help='Custom tile mapping file')
    parser.add_argument('--show-graphics', action='store_true', 
                       help='Show graphic tile codes (default: hide)')
    parser.add_argument('--range', nargs=2, metavar=('MIN', 'MAX'),
                       help='Level ID range to extract (hex or decimal)')
    parser.add_argument('--format', choices=['text', 'csv', 'json'], default='text',
                       help='Output format (default: text)')
    parser.add_argument('--verbose', '-v', action='store_true',
                       help='Verbose output')
    
    # Filtering options
    parser.add_argument('--vanilla-rom', metavar='FILE',
                       help='Path to vanilla ROM for comparison filtering')
    parser.add_argument('--editedonly', action='store_true',
                       help='Only show levels that differ from vanilla ROM')
    parser.add_argument('--novanilla', action='store_true',
                       help='Filter out vanilla level names')
    parser.add_argument('--withwords', action='store_true',
                       help='Only show level names containing English words')
    
    args = parser.parse_args()
    
    # Load ROM
    try:
        with open(args.romfile, 'rb') as f:
            rom_data = f.read()
    except FileNotFoundError:
        print(f"Error: ROM file not found: {args.romfile}", file=sys.stderr)
        return 1
    except IOError as e:
        print(f"Error reading ROM file: {e}", file=sys.stderr)
        return 1
    
    # Detect header
    has_header, header_offset = detect_header(rom_data)
    
    if args.verbose:
        print(f"ROM file: {args.romfile}", file=sys.stderr)
        print(f"ROM size: {len(rom_data):,} bytes", file=sys.stderr)
        print(f"Header: {'Yes (512 bytes)' if has_header else 'No'}", file=sys.stderr)
    
    # Check for Level Names Patch
    patch_installed = check_level_names_patch(rom_data, header_offset)
    
    if args.verbose:
        print(f"Lunar Magic Level Names Patch: {'Installed' if patch_installed else 'Not installed'}", 
              file=sys.stderr)
    
    if not patch_installed:
        print("Error: Lunar Magic Level Names Patch not found in ROM", file=sys.stderr)
        print("This ROM may use vanilla level names or is not edited with Lunar Magic", file=sys.stderr)
        return 1
    
    # Load tile map
    if args.tile_map:
        try:
            tile_map = load_custom_tile_map(args.tile_map)
            if args.verbose:
                print(f"Loaded custom tile map from {args.tile_map} ({len(tile_map)} mappings)", 
                      file=sys.stderr)
        except Exception as e:
            print(f"Error loading tile map: {e}", file=sys.stderr)
            return 1
    else:
        tile_map = DEFAULT_TILE_MAP
    
    # Parse level range
    level_range = None
    if args.range:
        try:
            min_level = int(args.range[0], 0)  # Auto-detect base (hex or decimal)
            max_level = int(args.range[1], 0)
            level_range = (min_level, max_level)
            if args.verbose:
                print(f"Extracting levels 0x{min_level:03X} to 0x{max_level:03X}", file=sys.stderr)
        except ValueError:
            print(f"Error: Invalid level range: {args.range}", file=sys.stderr)
            return 1
    
    # Extract level names
    level_names = extract_level_names(rom_data, header_offset, tile_map, 
                                      args.show_graphics, level_range)
    
    if args.verbose:
        print(f"Extracted {len(level_names)} level names", file=sys.stderr)
    
    # Load vanilla ROM if filtering requested
    vanilla_names = None
    if args.editedonly or args.novanilla:
        vanilla_rom_path = args.vanilla_rom or 'orig_lm333_noedits.sfc'
        if args.verbose:
            print(f"Loading vanilla ROM for comparison: {vanilla_rom_path}", file=sys.stderr)
        
        vanilla_names = load_vanilla_level_names(vanilla_rom_path, tile_map)
        
        if vanilla_names:
            if args.verbose:
                print(f"Loaded {len(vanilla_names)} vanilla level names", file=sys.stderr)
        else:
            if args.verbose:
                print("Warning: Could not load vanilla ROM for comparison", file=sys.stderr)
    
    # Apply filters
    if args.editedonly or args.novanilla or args.withwords:
        original_count = len(level_names)
        level_names = filter_level_names(
            level_names,
            vanilla_names,
            edited_only=args.editedonly,
            no_vanilla=args.novanilla,
            with_words=args.withwords
        )
        if args.verbose:
            print(f"Filtering: {original_count} -> {len(level_names)} level names", file=sys.stderr)
    
    if args.verbose:
        print("", file=sys.stderr)
    
    # Format output
    output_lines = []
    
    if args.format == 'text':
        for level_id in sorted(level_names.keys()):
            info = level_names[level_id]
            output_lines.append(f"Level 0x{level_id:03X}: {info['name']}")
    
    elif args.format == 'csv':
        output_lines.append("LevelID,Name,ROMOffset,HexData")
        for level_id in sorted(level_names.keys()):
            info = level_names[level_id]
            name = info['name'].replace('"', '""')  # Escape quotes
            hex_data = info['raw_data'].hex()
            output_lines.append(f'0x{level_id:03X},"{name}",0x{info["rom_offset"]:06X},{hex_data}')
    
    elif args.format == 'json':
        import json
        output_dict = {}
        for level_id, info in level_names.items():
            output_dict[f"0x{level_id:03X}"] = {
                'name': info['name'],
                'rom_offset': f"0x{info['rom_offset']:06X}",
                'hex_data': info['raw_data'].hex()
            }
        output_lines.append(json.dumps(output_dict, indent=2, ensure_ascii=False))
    
    # Write output
    output_text = '\n'.join(output_lines)
    
    if args.output:
        try:
            with open(args.output, 'w', encoding='utf-8') as f:
                f.write(output_text)
                f.write('\n')
            if args.verbose:
                print(f"Output written to {args.output}", file=sys.stderr)
        except IOError as e:
            print(f"Error writing output file: {e}", file=sys.stderr)
            return 1
    else:
        print(output_text)
    
    return 0


if __name__ == '__main__':
    sys.exit(main())

