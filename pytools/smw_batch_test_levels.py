#!/usr/bin/env python3
"""
SMW Batch Level Test ROM Creator

Creates test ROMs for multiple levels from a single source ROM.
Useful for testing multiple levels in a hack.

Usage:
    smw_batch_test_levels.py <input.sfc> --levels levels.json
    smw_batch_test_levels.py <input.sfc> --auto-detect --vanilla smw.sfc

This will create one test ROM per level in the test_roms/ directory.
"""

import sys
import argparse
from pathlib import Path
import json
import subprocess
from typing import List, Dict

from smw_level_analyzer import ROMAnalyzer
from smw_level_force import apply_patch_with_asar, get_universal_patch


def create_test_roms_for_levels(input_rom: str, level_ids: List[int], 
                                output_dir: str = 'test_roms') -> Dict:
    """
    Create test ROMs for multiple levels.
    
    Returns dict with results for each level.
    """
    results = {}
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    for level_id in level_ids:
        output_file = output_path / f"test_level_{level_id:03X}.sfc"
        
        print(f"Creating test ROM for level 0x{level_id:03X}...", end=' ')
        
        try:
            patch = get_universal_patch(level_id)
            success = apply_patch_with_asar(input_rom, patch, str(output_file))
            
            if success:
                print(f"✓ {output_file.name}")
                results[level_id] = {'status': 'success', 'file': str(output_file)}
            else:
                print(f"✗ Failed")
                results[level_id] = {'status': 'failed', 'error': 'asar failed'}
                
        except Exception as e:
            print(f"✗ Error: {e}")
            results[level_id] = {'status': 'error', 'error': str(e)}
    
    return results


def main():
    parser = argparse.ArgumentParser(
        description='Create test ROMs for multiple levels',
        epilog='Creates one test ROM per level'
    )
    
    parser.add_argument('input_rom',
                       help='Input ROM file (.sfc)')
    
    parser.add_argument('--levels', metavar='JSON_FILE',
                       help='JSON file with list of level IDs')
    
    parser.add_argument('--auto-detect', action='store_true',
                       help='Auto-detect modified levels from vanilla comparison')
    
    parser.add_argument('--vanilla', metavar='ROM',
                       default='smw.sfc',
                       help='Vanilla ROM for auto-detect (default: smw.sfc)')
    
    parser.add_argument('--output-dir', metavar='DIR',
                       default='test_roms',
                       help='Output directory (default: test_roms/)')
    
    parser.add_argument('--limit', type=int,
                       help='Limit number of test ROMs to create')
    
    args = parser.parse_args()
    
    # Get list of levels
    level_ids = []
    
    if args.levels:
        # Load from JSON file
        with open(args.levels, 'r') as f:
            data = json.load(f)
            if isinstance(data, list):
                level_ids = data
            elif isinstance(data, dict) and 'levels' in data:
                level_ids = list(data['levels'].keys())
                # Convert hex strings to ints
                level_ids = [int(lid, 16) if isinstance(lid, str) and lid.startswith('0x') 
                            else int(lid) for lid in level_ids]
    
    elif args.auto_detect:
        # Auto-detect from ROM comparison
        if not Path(args.vanilla).exists():
            print(f"Error: Vanilla ROM not found: {args.vanilla}", file=sys.stderr)
            return 1
        
        print(f"Auto-detecting modified levels...")
        rom = ROMAnalyzer(args.input_rom)
        vanilla = ROMAnalyzer(args.vanilla)
        level_ids = rom.find_valid_levels(vanilla)
        print(f"Found {len(level_ids)} modified levels")
    
    else:
        print("Error: Must specify --levels or --auto-detect", file=sys.stderr)
        parser.print_help()
        return 1
    
    if not level_ids:
        print("No levels to process", file=sys.stderr)
        return 1
    
    # Apply limit
    if args.limit and len(level_ids) > args.limit:
        print(f"Limiting to first {args.limit} levels")
        level_ids = level_ids[:args.limit]
    
    print(f"\nCreating test ROMs for {len(level_ids)} levels...")
    print(f"Input ROM: {args.input_rom}")
    print(f"Output directory: {args.output_dir}")
    print()
    
    # Create test ROMs
    results = create_test_roms_for_levels(args.input_rom, level_ids, args.output_dir)
    
    # Summary
    success_count = sum(1 for r in results.values() if r['status'] == 'success')
    failed_count = len(results) - success_count
    
    print(f"\n" + "=" * 70)
    print(f"Summary:")
    print(f"  Total: {len(results)} levels")
    print(f"  Success: {success_count}")
    print(f"  Failed: {failed_count}")
    print(f"  Output directory: {args.output_dir}")
    print("=" * 70)
    
    if failed_count > 0:
        print("\nFailed levels:")
        for level_id, result in results.items():
            if result['status'] != 'success':
                print(f"  0x{level_id:03X}: {result.get('error', 'Unknown error')}")
    
    return 0 if failed_count == 0 else 1


if __name__ == '__main__':
    sys.exit(main())

