#!/usr/bin/env python3
"""
Level Name Extractor with JSON output for database import
Based on levelname_extractor3.py but modified for the specific JSON format needed
"""

import argparse
import json
import os
import sys
import shutil
import glob
import re
from typing import Dict, Optional

# Import the original extractor functions
from levelname_extractor3 import (
    detect_header, check_level_names_patch, extract_level_names,
    filter_level_names, load_vanilla_level_names, DEFAULT_TILE_MAP,
    normalize_lid
)

levelset = []

def main():
    parser = argparse.ArgumentParser(
        description='Extract level names and output in database import format'
    )
    
    parser.add_argument('--romfile', required=True, help='Path to ROM file')
    parser.add_argument('--output', '-o', required=True, help='Output JSON file')
    parser.add_argument('--gameid', required=True, help='Game ID')
    parser.add_argument('--version', required=True, help='Game version')
    parser.add_argument('--levelsonly', action='store_true',
                       help='Filter out message box text and extraneous content')
    parser.add_argument('--verbose', '-v', action='store_true',
                       help='Verbose output')
    
    args = parser.parse_args()

    # Load ROM
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
        os.system('wine ../lm333/lm333.exe -TransferOverworld temp_lm333.sfc temp_analyze.sfc')
        os.system('wine ../lm333/lm333.exe -ExportMultLevels temp_analyze.sfc MWL 1')
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
    
    # Extract level names
    level_names = extract_level_names(rom_data, header_offset, DEFAULT_TILE_MAP, 
                                      False, None)  # show_graphics=False, level_range=None
    
    if args.verbose:
        print(f"Extracted {len(level_names)} level names", file=sys.stderr)
    
    # Apply filters if requested
    if args.levelsonly:
        original_count = len(level_names)
        level_names = filter_level_names(
            level_names,
            None,  # vanilla_names
            edited_only=False,
            no_vanilla=False,
            with_words=False,
            levels_only=True,
            rom_data=rom_data,
            vanilla_rom_data=None,
            header_offset=header_offset,
            vanilla_header_offset=0
        )
        if args.verbose:
            print(f"Filtering: {original_count} -> {len(level_names)} level names", file=sys.stderr)
    
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
        if args.verbose:
            print(f"Output written to {args.output}", file=sys.stderr)
    except IOError as e:
        print(f"Error writing output file: {e}", file=sys.stderr)
        return 1
    
    return 0

if __name__ == '__main__':
    sys.exit(main())
