#!/usr/bin/env python3
"""
SMW Level Name Comparator - Compare level names between two SMW ROM files

This tool compares the level names (as they appear on the overworld) between
two ROM files and reports any differences.

Usage:
    smw_compare_names.py <rom1.sfc> <rom2.sfc>
    smw_compare_names.py <rom1.sfc> <rom2.sfc> --output changes.json
    smw_compare_names.py <rom1.sfc> <rom2.sfc> --show-unchanged

For more information, see devdocs/SMW_CHARACTER_ENCODING.md
"""

import sys
import json
import argparse
from pathlib import Path
from typing import Dict, List, Tuple

from smw_level_names import LevelNameExtractor


def compare_level_names(rom1_path: str, rom2_path: str) -> Tuple[List[Dict], List[int], List[int]]:
    """
    Compare level names between two ROMs.
    
    Returns:
        (changed_names, rom1_only, rom2_only)
        - changed_names: List of dicts with level_id, rom1_name, rom2_name
        - rom1_only: Level IDs that have names only in ROM1
        - rom2_only: Level IDs that have names only in ROM2
    """
    extractor1 = LevelNameExtractor(rom1_path)
    extractor2 = LevelNameExtractor(rom2_path)
    
    names1 = extractor1.extract_all_names()
    names2 = extractor2.extract_all_names()
    
    # Find all level IDs that exist in either ROM
    all_ids = set(names1.keys()) | set(names2.keys())
    
    changed = []
    rom1_only = []
    rom2_only = []
    
    for level_id in sorted(all_ids):
        name1 = names1.get(level_id, "").strip()
        name2 = names2.get(level_id, "").strip()
        
        if name1 and not name2:
            rom1_only.append(level_id)
        elif name2 and not name1:
            rom2_only.append(level_id)
        elif name1 != name2:
            changed.append({
                'level_id': level_id,
                'level_id_hex': f'0x{level_id:02X}',
                'rom1_name': name1,
                'rom2_name': name2
            })
    
    return changed, rom1_only, rom2_only


def main():
    parser = argparse.ArgumentParser(
        description='Compare level names between two Super Mario World ROM files',
        epilog='Shows which level names have changed between two ROM versions'
    )
    
    parser.add_argument('rom1', help='First ROM file')
    parser.add_argument('rom2', help='Second ROM file')
    
    parser.add_argument('--output', '-o', metavar='FILE',
                       help='Output differences to JSON file')
    
    parser.add_argument('--show-unchanged', action='store_true',
                       help='Also show levels with identical names')
    
    parser.add_argument('--raw', action='store_true',
                       help='Show raw tile hex values')
    
    args = parser.parse_args()
    
    # Validate files exist
    if not Path(args.rom1).exists():
        print(f"Error: ROM file not found: {args.rom1}", file=sys.stderr)
        return 1
    if not Path(args.rom2).exists():
        print(f"Error: ROM file not found: {args.rom2}", file=sys.stderr)
        return 1
    
    # Compare names
    print(f"Comparing level names:")
    print(f"  ROM 1: {Path(args.rom1).name}")
    print(f"  ROM 2: {Path(args.rom2).name}")
    print()
    
    changed, rom1_only, rom2_only = compare_level_names(args.rom1, args.rom2)
    
    # Show results
    if changed:
        print(f"Changed level names: {len(changed)}")
        print("=" * 70)
        for item in changed:
            print(f"\nLevel {item['level_id']:3d} ({item['level_id_hex']})")
            print(f"  {Path(args.rom1).name}: {item['rom1_name']}")
            print(f"  {Path(args.rom2).name}: {item['rom2_name']}")
    else:
        print("No changed level names detected.")
    
    if rom1_only:
        print(f"\n\nLevel names only in {Path(args.rom1).name}: {len(rom1_only)}")
        print("-" * 70)
        extractor1 = LevelNameExtractor(args.rom1)
        for level_id in rom1_only:
            name = extractor1.extract_level_name(level_id, raw=args.raw)
            print(f"  {level_id:3d} (0x{level_id:02X}): {name}")
    
    if rom2_only:
        print(f"\n\nLevel names only in {Path(args.rom2).name}: {len(rom2_only)}")
        print("-" * 70)
        extractor2 = LevelNameExtractor(args.rom2)
        for level_id in rom2_only:
            name = extractor2.extract_level_name(level_id, raw=args.raw)
            print(f"  {level_id:3d} (0x{level_id:02X}): {name}")
    
    # Show unchanged if requested
    if args.show_unchanged:
        extractor1 = LevelNameExtractor(args.rom1)
        extractor2 = LevelNameExtractor(args.rom2)
        
        names1 = extractor1.extract_all_names()
        names2 = extractor2.extract_all_names()
        
        unchanged = []
        for level_id in sorted(set(names1.keys()) & set(names2.keys())):
            name1 = names1[level_id].strip()
            name2 = names2[level_id].strip()
            if name1 and name2 and name1 == name2:
                unchanged.append((level_id, name1))
        
        if unchanged:
            print(f"\n\nUnchanged level names: {len(unchanged)}")
            print("-" * 70)
            for level_id, name in unchanged:
                print(f"  {level_id:3d} (0x{level_id:02X}): {name}")
    
    # Export to JSON if requested
    if args.output:
        output_data = {
            'rom1': str(Path(args.rom1).name),
            'rom2': str(Path(args.rom2).name),
            'changed_count': len(changed),
            'changed_names': changed,
            'rom1_only_count': len(rom1_only),
            'rom1_only': [{'level_id': lid, 'level_id_hex': f'0x{lid:02X}'} for lid in rom1_only],
            'rom2_only_count': len(rom2_only),
            'rom2_only': [{'level_id': lid, 'level_id_hex': f'0x{lid:02X}'} for lid in rom2_only]
        }
        
        with open(args.output, 'w') as f:
            json.dump(output_data, f, indent=2)
        print(f"\n\nResults exported to {args.output}")
    
    # Summary
    print("\n" + "=" * 70)
    print(f"Summary:")
    print(f"  Changed level names: {len(changed)}")
    print(f"  Names only in ROM 1: {len(rom1_only)}")
    print(f"  Names only in ROM 2: {len(rom2_only)}")
    print("=" * 70)
    
    return 0


if __name__ == '__main__':
    sys.exit(main())

