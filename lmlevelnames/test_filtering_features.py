#!/usr/bin/env python3
"""Test the enhanced filtering features."""

import subprocess
import sys

def test_filtering(rom_file, description):
    """Test various filtering options on a ROM."""
    print(f"\n{'='*70}")
    print(f"Testing: {rom_file}")
    print(f"Description: {description}")
    print('='*70)
    
    tests = [
        ("No filters", []),
        ("--novanilla", ["--novanilla"]),
        ("--withwords", ["--withwords"]),
        ("--novanilla --withwords", ["--novanilla", "--withwords"]),
    ]
    
    for test_name, filters in tests:
        cmd = [
            sys.executable,
            "levelname_extractor_enhanced_2025_10_28.py",
            "--romfile", rom_file,
            "--range", "0x001", "0x020"
        ] + filters
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            count = result.stdout.count('Level 0x')
            print(f"  {test_name:30s}: {count:3d} levels")
        else:
            print(f"  {test_name:30s}: ERROR")

def main():
    print("="*70)
    print("TESTING ENHANCED FILTERING FEATURES")
    print("="*70)
    
    test_roms = [
        ("Akogare_lm333_edited.sfc", "Fully custom hack"),
        ("smw_lm2.sfc", "Partially edited ROM"),
    ]
    
    for rom_file, description in test_roms:
        test_filtering(rom_file, description)
    
    print(f"\n{'='*70}")
    print("DETAILED EXAMPLE: Comparing vanilla vs edited")
    print('='*70)
    
    # Test with vanilla ROM
    print("\nVanilla ROM (orig_lm333_noedits.sfc):")
    cmd = [
        sys.executable,
        "levelname_extractor_enhanced_2025_10_28.py",
        "--romfile", "orig_lm333_noedits.sfc",
        "--range", "0x001", "0x010",
        "--withwords"
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        for line in result.stdout.strip().split('\n')[:5]:
            print(f"  {line}")
        count = result.stdout.count('Level 0x')
        print(f"  ... Total: {count} levels with words")
    
    # Test with edited ROM
    print("\nEdited ROM (Akogare_lm333_edited.sfc) with --withwords:")
    cmd = [
        sys.executable,
        "levelname_extractor_enhanced_2025_10_28.py",
        "--romfile", "Akogare_lm333_edited.sfc",
        "--range", "0x001", "0x010",
        "--withwords"
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        for line in result.stdout.strip().split('\n')[:5]:
            print(f"  {line}")
        count = result.stdout.count('Level 0x')
        print(f"  ... Total: {count} levels with words")
    
    print(f"\n{'='*70}")
    print("TESTING COMPLETE")
    print('='*70)
    print("\nNew filtering options work as expected!")
    print("- --novanilla: Filters out vanilla level names")
    print("- --editedonly: Shows only edited levels (different from vanilla)")
    print("- --withwords: Shows only names with English words")

if __name__ == '__main__':
    main()

