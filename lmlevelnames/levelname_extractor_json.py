#!/usr/bin/env python3
"""
Level Name Extractor with JSON output for database import
Uses the exact same extraction and filtering logic as levelname_extractor3.py
but outputs in the database import format.
"""

import argparse
import json
import sys
import os

# Import everything from the original script to ensure 100% identical logic
from levelname_extractor3 import (
    levelset,  # Global variable for level filtering
    normalize_lid,
    detect_header,
    check_level_names_patch,
    extract_level_names,
    filter_level_names,
    load_vanilla_level_names,
    load_custom_tile_map,
    DEFAULT_TILE_MAP
)

def main():
    parser = argparse.ArgumentParser(
        description='Extract level names and output in database import format'
    )
    
    parser.add_argument('--romfile', required=True, help='Path to ROM file')
    parser.add_argument('--output', '-o', required=True, help='Output JSON file')
    parser.add_argument('--gameid', required=True, help='Game ID')
    parser.add_argument('--version', required=True, help='Game version')
    parser.add_argument('--tile-map', help='Custom tile mapping file')
    parser.add_argument('--show-graphics', action='store_true',
                       help='Show graphic tile codes (default: hide)')
    parser.add_argument('--range', nargs=2, metavar=('MIN', 'MAX'),
                       help='Level ID range to extract (hex or decimal)')
    parser.add_argument('--verbose', '-v', action='store_true',
                       help='Verbose output')
    
    # Filtering options - EXACTLY the same as original script
    parser.add_argument('--vanilla-rom', metavar='FILE',
                       help='Path to vanilla ROM for comparison filtering')
    parser.add_argument('--editedonly', action='store_true',
                       help='Only show levels where level DATA has been edited (compares actual level content, requires --vanilla-rom)')
    parser.add_argument('--novanilla', action='store_true',
                       help='Filter out vanilla level names')
    parser.add_argument('--withwords', action='store_true',
                       help='Only show level names containing English words')
    parser.add_argument('--levelsonly', action='store_true',
                       help='Filter out message box text and extraneous content (uses pattern detection)')
    
    args = parser.parse_args()

    # IMPORTANT: Use the EXACT same ROM loading logic as the original script
    # This populates the global levelset variable
    import shutil
    import glob
    import re
    
    try:
        if not(os.path.exists("temp")):
            os.mkdir("temp")
        if os.path.exists("temp/temp_lm333.sfc"):
            os.unlink("temp/temp_lm333.sfc")
        shutil.copy("orig_lm333_noedits.sfc", "temp/temp_lm333.sfc")
        shutil.copy(args.romfile, "temp/temp_analyze.sfc")
        orig_path = os.getcwd()
        os.chdir("temp")
        for f in glob.glob("*.mwl"):
            if re.match("^.*\.mwl$", f):
                os.remove(f)
        print("wine ../lm333/lm333.exe -TransferOverworld temp_lm333.sfc temp_analyze.sfc")
        result = os.system('timeout 4 wine ../lm333/lm333.exe -TransferOverworld temp_lm333.sfc temp_analyze.sfc')
        if not(result==0):
            raise Exception("lm333.exe -TransferOVerworld failed")
        result = os.system('timeout 4 wine ../lm333/lm333.exe -ExportMultLevels temp_analyze.sfc MWL 1')
        if not(result==0):
            raise Exception("lm333.exe -ExportMultLEvels failed")
        for f in glob.glob("MWL*.mwl"):
            result = re.match("^MWL ([^.]+)\.mwl$", f)
            if result:
                mgroup = result.groups(0)[0]
                levelset.append(normalize_lid(mgroup))
        os.chdir(orig_path)
        args.romfile = 'temp/temp_lm333.sfc'

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
    
    # Extract level names - EXACT same call as original
    level_names = extract_level_names(rom_data, header_offset, tile_map, 
                                      args.show_graphics, level_range)
    
    if args.verbose:
        print(f"Extracted {len(level_names)} level names", file=sys.stderr)
    
    # Load vanilla level names if filtering requested - EXACT same logic
    vanilla_names = None
    vanilla_rom_data_for_edited = None
    vanilla_header_offset_for_edited = 0
    
    if args.novanilla:
        # For --novanilla, use hardcoded names (no ROM file needed!)
        vanilla_names = load_vanilla_level_names(None, tile_map)
        if args.verbose:
            print(f"Loaded {len(vanilla_names)} hardcoded vanilla level names", file=sys.stderr)
    
    if args.editedonly:
        # For --editedonly, we need the actual vanilla ROM to compare level DATA
        vanilla_rom_path = args.vanilla_rom or 'smw.sfc'
        if args.verbose:
            print(f"Loading vanilla ROM for level data comparison: {vanilla_rom_path}", file=sys.stderr)
        
        try:
            with open(vanilla_rom_path, 'rb') as f:
                vanilla_rom_data_for_edited = f.read()
            _, vanilla_header_offset_for_edited = detect_header(vanilla_rom_data_for_edited)
            
            # Also load vanilla names if not already loaded
            if not vanilla_names:
                vanilla_names = load_vanilla_level_names(vanilla_rom_path, tile_map)
            
            if args.verbose:
                print(f"Loaded vanilla ROM: {len(vanilla_rom_data_for_edited):,} bytes", file=sys.stderr)
        except (FileNotFoundError, IOError) as e:
            if args.verbose:
                print(f"Warning: Could not load vanilla ROM for level data comparison: {e}", file=sys.stderr)
            print(f"ERROR: --editedonly requires a vanilla ROM file", file=sys.stderr)
            sys.exit(1)
    
    # Apply filters - EXACT same call as original script
    if args.editedonly or args.novanilla or args.withwords or args.levelsonly:
        original_count = len(level_names)
        level_names = filter_level_names(
            level_names,
            vanilla_names,
            edited_only=args.editedonly,
            no_vanilla=args.novanilla,
            with_words=args.withwords,
            levels_only=args.levelsonly,
            rom_data=rom_data,
            vanilla_rom_data=vanilla_rom_data_for_edited,
            header_offset=header_offset,
            vanilla_header_offset=vanilla_header_offset_for_edited
        )
        if args.verbose:
            print(f"Filtering: {original_count} -> {len(level_names)} level names", file=sys.stderr)
    
    if args.verbose:
        print("", file=sys.stderr)
    
    # Format output in the requested JSON format
    output_data = {
        args.gameid: {
            "version": args.version,
            "levelnames": {}
        }
    }
    
    for level_id in sorted(level_names.keys()):
        info = level_names[level_id]
        level_key = f"0x{level_id:03X}"
        output_data[args.gameid]["levelnames"][level_key] = info['name']
    
    # Write JSON output
    try:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)
            f.write('\n')
        if args.verbose:
            print(f"Output written to {args.output}", file=sys.stderr)
    except IOError as e:
        print(f"Error writing output file: {e}", file=sys.stderr)
        return 1
    
    return 0

if __name__ == '__main__':
    sys.exit(main())
