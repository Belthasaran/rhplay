#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Find all accessible translevels in an SMW ROM's overworld maps.

- Level Number.asm: Translevel -> Level mapping (00-24 -> 000-024, 25-5F -> 101-13B)
- Overworld Tilemaps.asm: LevelNumberMap structure and event system
"""

import argparse
import json
import os
import re
import struct
import subprocess
import sys
from typing import Dict, List, Tuple, Optional, Set

# Import LC decompression wrapper
try:
    # Try importing from same directory
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from lc_decompress import decompress_lc_lz2, decompress_lc_lz3, LC_LZ2, LC_LZ3
    LC_DECOMPRESS_AVAILABLE = True
except ImportError:
    # Fallback if wrapper not available
    LC_DECOMPRESS_AVAILABLE = False
    def decompress_lc_lz2(*args, **kwargs):
        return None
    def decompress_lc_lz3(*args, **kwargs):
        return None

def snes_to_rom_offset(snes_addr: int, has_header: bool) -> int:
    """Convert SNES LoROM address to ROM file offset."""
    return ((snes_addr & 0x7F0000) >> 1) | (snes_addr & 0x7FFF) + (0x200 if has_header else 0)

def is_headered(path: str) -> bool:
    size = os.path.getsize(path)
    return (size % 0x8000) != 0

def translevel_to_level(translevel: int) -> int:
    """
    Convert translevel number to level number.
    Based on Level Number.asm logic:
    - Translevel 00-24 (0x00-0x18) -> Level 000-024 (0x000-0x018)
    - Translevel 25-5F (0x19-0x5F) -> Level 101-13B (0x101-0x13B)
    """
    if translevel < 0x25:
        return translevel  # 0x00-0x18 -> 0x000-0x018
    else:
        return (translevel - 0x24) + 0x100  # 0x19-0x5F -> 0x101-0x13B

def parse_overworldtables_output(rom_path: str, verbose: bool = False) -> Dict[str, Optional[str]]:
    """
    Run OverworldTables.asm on ROM and parse output for table locations.
    Returns dict with detected table addresses.
    """
    asm_path = 'OverworldTables.asm'
    if not os.path.exists(asm_path):
        asm_path = '../OverworldTables.asm'
        if not os.path.exists(asm_path):
            if verbose:
                print(f"ERROR: OverworldTables.asm not found", file=sys.stderr)
            return {}
    
    result = subprocess.run(
        ['wine', 'asar.exe', '--no-title-check', asm_path, rom_path],
        capture_output=True, text=True
    )
    
    output = result.stdout
    tables = {}
    
    # Parse translevel table (LevelNumberMap)
    if 'Translevel hijack is not applied' in output:
        tables['translevel_hijacked'] = False
        # Vanilla location - need to research
        # TODO: Find vanilla LevelNumberMap location
    elif 'Translevels: ' in output:
        # Extract address after "Translevels: "
        for line in output.splitlines():
            if 'Translevels: ' in line:
                addr_part = line.split('Translevels: ')[1].split()[0]
                tables['translevels'] = addr_part
                tables['translevel_hijacked'] = True
                # Check if compressed
                if '(LC_LZ2/3)' in line:
                    tables['translevels_compressed'] = True
                break
    
    # Parse initial flags
    if 'Initial level flags hijack is not applied' in output:
        for line in output.splitlines():
            if 'Initial flags: ' in line:
                addr = line.split('Initial flags: ')[1].strip()
                tables['initial_flags'] = addr
                break
    
    # Parse Layer 1 event data
    for line in output.splitlines():
        if 'Layer 1 event data: ' in line:
            addr = line.split('Layer 1 event data: ')[1].strip()
            tables['layer1_event_data'] = addr
            break
    
    # Parse Layer 1 event positions (might be in comments or we need to detect)
    # These are referenced in Overworld Tilemaps.asm but may not be printed
    
    return tables

def read_rom_address(rom_data: bytes, addr_str: str, header_offset: int) -> Optional[int]:
    """Read SNES address and convert to ROM offset."""
    try:
        snes_addr = int(addr_str, 16)
        return snes_to_rom_offset(snes_addr, header_offset > 0)
    except ValueError:
        return None

def decompress_lc_lz2_from_rom(rom_data: bytes, offset: int, verbose: bool = False) -> Optional[bytes]:
    """
    Decompress LC_LZ2 data from ROM using Lunar Compress DLL.
    
    Args:
        rom_data: Full ROM data
        offset: ROM file offset where compressed data starts
        verbose: Print verbose messages
        
    Returns:
        Decompressed data or None on failure
    """
    if not LC_DECOMPRESS_AVAILABLE:
        if verbose:
            print("LC_LZ2 decompression not available - Lunar Compress wrapper not found", file=sys.stderr)
        return None
    
    if verbose:
        print(f"Decompressing LC_LZ2 data from ROM offset ${offset:06X}...", file=sys.stderr)
    
    try:
        decompressed = decompress_lc_lz2(rom_data, offset, max_size=0x10000)
        if decompressed:
            if verbose:
                print(f"Successfully decompressed {len(decompressed)} bytes", file=sys.stderr)
            return decompressed
        else:
            if verbose:
                print("LC_LZ2 decompression failed", file=sys.stderr)
            return None
    except Exception as e:
        if verbose:
            print(f"Error during LC_LZ2 decompression: {e}", file=sys.stderr)
        return None

def read_layer1_tilemap_vanilla(rom_data: bytes, header_offset: int, verbose: bool = False) -> Optional[bytes]:
    """
    Read vanilla Layer 1 tilemap from ROM.
    Source: SNES $0CF7DF (loaded into RAM $7EC800)
    Size: 0x800 bytes (2048 bytes = 32x32x2 submaps)
    """
    snes_addr = 0x0CF7DF
    rom_offset = snes_to_rom_offset(snes_addr, header_offset > 0)
    
    if rom_offset + 0x800 > len(rom_data):
        if verbose:
            print(f"Warning: Layer 1 tilemap extends beyond ROM size", file=sys.stderr)
        return None
    
    if verbose:
        print(f"Reading vanilla Layer 1 tilemap from SNES ${snes_addr:06X}, ROM offset ${rom_offset:06X}", file=sys.stderr)
    
    return rom_data[rom_offset:rom_offset + 0x800]

def read_exit_path_table(rom_data: bytes, header_offset: int, verbose: bool = False) -> Optional[bytes]:
    """
    Read exit path directions table from ROM.
    Source: SNES $04D678 (DATA_04D678)
    Size: ~96 bytes (one per translevel)
    """
    snes_addr = 0x04D678
    rom_offset = snes_to_rom_offset(snes_addr, header_offset > 0)
    
    if rom_offset + 96 > len(rom_data):
        if verbose:
            print(f"Warning: Exit path table extends beyond ROM size", file=sys.stderr)
        return None
    
    if verbose:
        print(f"Reading exit path table from SNES ${snes_addr:06X}, ROM offset ${rom_offset:06X}", file=sys.stderr)
    
    return rom_data[rom_offset:rom_offset + 96]

def read_level_number_map(rom_data: bytes, tables: Dict, header_offset: int, verbose: bool = False) -> Optional[bytes]:
    """
    Read and decompress (if needed) the LevelNumberMap.
    Returns decompressed level number map data or None.
    For vanilla ROMs, returns None (will use tilemap scanning instead).
    """
    if 'translevels' not in tables:
        if verbose:
            print("No LevelNumberMap location found (vanilla ROM - will scan tilemap)", file=sys.stderr)
        return None
    
    addr_str = tables['translevels']
    if addr_str:
        rom_offset = read_rom_address(rom_data, addr_str, header_offset)
        if rom_offset is None or rom_offset >= len(rom_data):
            if verbose:
                print(f"Invalid LevelNumberMap address: {addr_str}", file=sys.stderr)
            return None
        
        if verbose:
            print(f"LevelNumberMap at SNES ${int(addr_str, 16):06X}, ROM offset ${rom_offset:06X}", file=sys.stderr)
        
        # Check if compressed
        if tables.get('translevels_compressed', False):
            if verbose:
                print("LevelNumberMap is compressed (LC_LZ2/LC_LZ3) - attempting decompression...", file=sys.stderr)
            # Try LC_LZ2 first, then LC_LZ3
            decompressed = decompress_lc_lz2_from_rom(rom_data, rom_offset, verbose)
            if not decompressed:
                if verbose:
                    print("LC_LZ2 failed, trying LC_LZ3...", file=sys.stderr)
                if LC_DECOMPRESS_AVAILABLE:
                    try:
                        decompressed = decompress_lc_lz3(rom_data, rom_offset, max_size=0x10000)
                        if decompressed and verbose:
                            print(f"Successfully decompressed {len(decompressed)} bytes with LC_LZ3", file=sys.stderr)
                    except Exception as e:
                        if verbose:
                            print(f"LC_LZ3 decompression failed: {e}", file=sys.stderr)
            return decompressed
        else:
            # Read uncompressed data (reasonable max size for tilemap)
            # Overworld tilemap is typically 32x32 = 1024 tiles, but can be larger
            max_size = 2048
            if rom_offset + max_size <= len(rom_data):
                return rom_data[rom_offset:rom_offset + max_size]
            else:
                return rom_data[rom_offset:]
    
    return None

def scan_vanilla_tilemap(tilemap_data: bytes, exit_path_data: Optional[bytes], verbose: bool = False) -> Dict[int, List[Dict]]:
    """
    Scan vanilla Layer 1 tilemap to generate translevel map (like CODE_04D7F9).
    
    Level tiles are identified by tile values $56-$80 (inclusive).
    Translevels are assigned sequentially (1, 2, 3, ...) as level tiles are found.
    
    Returns: Dict mapping translevel -> list of position dictionaries
    """
    translevel_positions = {}  # translevel -> list of position dicts
    
    if not tilemap_data or len(tilemap_data) < 0x800:
        return translevel_positions
    
    OW_WIDTH = 32  # tiles
    OW_HEIGHT = 32  # tiles
    TILES_PER_SUBMAP = OW_WIDTH * OW_HEIGHT  # 1024
    
    translevel_counter = 1  # Starts at 1 (translevel 0 is never assigned)
    
    # Scan through tilemap (0x800 bytes = 2048 tiles = 2 submaps)
    for tile_idx in range(min(len(tilemap_data), 0x800)):
        tile_value = tilemap_data[tile_idx]
        
        # Check if tile is a level tile ($56-$80 inclusive)
        if 0x56 <= tile_value <= 0x80:
            # Calculate tile position
            submap = tile_idx // TILES_PER_SUBMAP
            tile_in_submap = tile_idx % TILES_PER_SUBMAP
            tile_x = tile_in_submap % OW_WIDTH
            tile_y = tile_in_submap // OW_WIDTH
            
            # Assign translevel number
            translevel = translevel_counter
            
            if translevel not in translevel_positions:
                translevel_positions[translevel] = []
            
            pos_info = {
                'submap': submap,
                'tile_x': tile_x,
                'tile_y': tile_y,
                'source': 'tilemap',
                'tile_value': tile_value
            }
            
            # Add exit path direction if available
            if exit_path_data and translevel < len(exit_path_data):
                pos_info['exit_path'] = exit_path_data[translevel]
            
            translevel_positions[translevel].append(pos_info)
            
            # Increment translevel counter
            translevel_counter += 1
            
            # Maximum translevels is ~96 (limited by exit path table)
            if translevel_counter > 96:
                if verbose:
                    print(f"Warning: Reached maximum translevel count (96)", file=sys.stderr)
                break
    
    if verbose:
        print(f"Found {len(translevel_positions)} unique translevels in vanilla tilemap (assigned 1-{translevel_counter-1})", file=sys.stderr)
    
    return translevel_positions

def parse_level_number_map(data: bytes, verbose: bool = False) -> Dict[int, List[Dict]]:
    """
    Parse LevelNumberMap (LM hijacked) to extract translevel numbers per tile position.
    
    Format: Each entry contains translevel number + exit path direction
    Tile positions are linear indices (need to know overworld dimensions)
    
    Returns: Dict mapping translevel -> list of position dictionaries
    """
    # TODO: Understand exact format of LevelNumberMap
    # Each entry likely contains:
    # - Translevel number (1 byte)
    # - Exit path direction (possibly in same byte or separate)
    
    translevel_positions = {}  # translevel -> list of position dicts
    
    if not data or len(data) < 2:
        return translevel_positions
    
    # For LM hijacked ROMs, LevelNumberMap format may vary
    # For now, assume each tile has 1 byte per tile (translevel number)
    # Overworld is typically 32x32 tiles = 1024 tiles per submap
    
    OW_WIDTH = 32  # tiles
    OW_HEIGHT = 32  # tiles
    TILES_PER_SUBMAP = OW_WIDTH * OW_HEIGHT  # 1024
    
    # Try parsing as 1 byte per tile
    for tile_idx in range(min(len(data), TILES_PER_SUBMAP * 2)):  # Support 2 submaps
        translevel = data[tile_idx]
        
        # Skip invalid translevels (range is 0x00-0x5F, but 0 is valid)
        if translevel > 0x5F:
            continue
        
        # Calculate tile position
        submap = tile_idx // TILES_PER_SUBMAP
        tile_in_submap = tile_idx % TILES_PER_SUBMAP
        tile_x = tile_in_submap % OW_WIDTH
        tile_y = tile_in_submap // OW_WIDTH
        
        if translevel not in translevel_positions:
            translevel_positions[translevel] = []
        
        translevel_positions[translevel].append({
            'submap': submap,
            'tile_x': tile_x,
            'tile_y': tile_y,
            'source': 'levelnumbermap'
        })
    
    if verbose:
        print(f"Found {len(translevel_positions)} unique translevels in LevelNumberMap", file=sys.stderr)
    
    return translevel_positions

def find_translevels_in_overworld(rom_data: bytes, header_offset: int, tables: Dict, verbose: bool = False) -> List[Dict]:
    """
    Find all translevels referenced in overworld tilemaps and events.
    Returns list of translevel entries with their mappings and tile positions.
    """
    translevels_found: Dict[int, Dict] = {}  # translevel -> entry data
    
    # Step 1: Try to read LevelNumberMap (LM hijacked ROMs)
    level_map_data = read_level_number_map(rom_data, tables, header_offset, verbose)
    
    if level_map_data:
        # Parse LevelNumberMap (LM hijacked)
        if verbose:
            print("Using LevelNumberMap (LM hijacked ROM)", file=sys.stderr)
        tilemap_translevels = parse_level_number_map(level_map_data, verbose)
        
        for translevel, positions in tilemap_translevels.items():
            if translevel not in translevels_found:
                translevels_found[translevel] = {
                    'translevel': translevel,
                    'level_number': translevel_to_level(translevel),
                    'locations': [],
                    'events': []
                }
            translevels_found[translevel]['locations'].extend(positions)
    
    else:
        # Step 2: Scan vanilla tilemap (vanilla ROMs)
        if verbose:
            print("Using vanilla tilemap scanning (CODE_04D7F9 method)", file=sys.stderr)
        
        tilemap_data = read_layer1_tilemap_vanilla(rom_data, header_offset, verbose)
        exit_path_data = read_exit_path_table(rom_data, header_offset, verbose)
        
        if tilemap_data:
            tilemap_translevels = scan_vanilla_tilemap(tilemap_data, exit_path_data, verbose)
            
            for translevel, positions in tilemap_translevels.items():
                if translevel not in translevels_found:
                    translevels_found[translevel] = {
                        'translevel': translevel,
                        'level_number': translevel_to_level(translevel),
                        'locations': [],
                        'events': []
                    }
                translevels_found[translevel]['locations'].extend(positions)
        else:
            if verbose:
                print("Warning: Could not read Layer 1 tilemap", file=sys.stderr)
    
    # Step 3: Parse Layer 1 events (TODO: implement event parsing)
    # Events can create/modify level tiles
    
    # Step 4: Build output list
    result = []
    for translevel in sorted(translevels_found.keys()):
        result.append(translevels_found[translevel])
    
    return result

def main():
    parser = argparse.ArgumentParser(
        description='Find all accessible translevels in SMW overworld maps'
    )
    parser.add_argument('--romfile', required=True, help='SMW ROM file to analyze')
    parser.add_argument('--output', help='Output JSON file (default: stdout)')
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()
    
    if not os.path.exists(args.romfile):
        print(f"ERROR: ROM file not found: {args.romfile}", file=sys.stderr)
        sys.exit(1)
    
    with open(args.romfile, 'rb') as f:
        rom_data = f.read()
    
    headered = is_headered(args.romfile)
    header_offset = 0x200 if headered else 0
    
    # Step 1: Find translevel table location
    if args.verbose:
        print("Step 1: Detecting translevel table location...", file=sys.stderr)
    
    tables = parse_overworldtables_output(args.romfile, args.verbose)
    
    if args.verbose:
        print(f"Tables found: {tables}", file=sys.stderr)
    
    # Step 2: Find translevels in overworld
    if args.verbose:
        print("Step 2: Scanning overworld tilemaps for translevels...", file=sys.stderr)
    
    translevels_data = find_translevels_in_overworld(rom_data, header_offset, tables, args.verbose)
    
    # Step 3: Build output JSON structure
    output = {
        'rom_file': args.romfile,
        'tables': tables,
        'translevels': translevels_data
    }
    
    # Output JSON
    json_str = json.dumps(output, indent=2)
    
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(json_str)
    else:
        print(json_str)

if __name__ == '__main__':
    main()
