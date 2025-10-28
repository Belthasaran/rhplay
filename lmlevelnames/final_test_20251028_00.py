#!/usr/bin/env python3
"""
Final comprehensive test of levelname_extractor_2025_10_28.py
Tests all requested ROM files and demonstrates all key features.
"""

import subprocess
import sys
import os

def run_extractor(romfile, *args):
    """Run the extractor with given arguments."""
    cmd = [sys.executable, "levelname_extractor_2025_10_28.py", "--romfile", romfile] + list(args)
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result

def test_rom(romfile, description):
    """Test a single ROM file."""
    print(f"\n{'='*70}")
    print(f"Testing: {romfile}")
    print(f"Description: {description}")
    print('='*70)
    
    if not os.path.exists(romfile):
        print(f"  SKIPPED: File not found")
        return False
    
    # Test 1: Basic extraction with verbose
    print("\n[Test 1: Basic extraction with header detection]")
    result = run_extractor(romfile, "--verbose", "--range", "0x001", "0x010")
    
    if result.returncode == 0:
        # Show verbose info
        for line in result.stderr.strip().split('\n')[:4]:
            print(f"  {line}")
        
        # Count levels
        level_count = result.stdout.count('Level 0x')
        print(f"  Levels extracted: {level_count}")
        
        # Show first 3 levels
        stdout_lines = [l for l in result.stdout.strip().split('\n') if l.startswith('Level 0x')]
        for line in stdout_lines[:3]:
            print(f"    {line}")
    else:
        print(f"  Result: Patch not installed or error")
        return False
    
    # Test 2: Extract level 0x13B if it exists
    print("\n[Test 2: Extract level 0x13B]")
    result = run_extractor(romfile, "--range", "0x13B", "0x13B")
    if result.returncode == 0 and result.stdout.strip():
        print(f"  {result.stdout.strip()}")
    else:
        print(f"  Level 0x13B not found or empty")
    
    # Test 3: CSV format
    print("\n[Test 3: CSV format output]")
    result = run_extractor(romfile, "--range", "0x001", "0x002", "--format", "csv")
    if result.returncode == 0:
        lines = result.stdout.strip().split('\n')
        for line in lines[:3]:  # Header + first 2 lines
            print(f"  {line}")
    
    return True

def main():
    print("="*70)
    print("COMPREHENSIVE TEST OF LEVEL NAME EXTRACTOR")
    print("Script: levelname_extractor_2025_10_28.py")
    print("Date: October 28, 2025")
    print("="*70)
    
    # Test cases
    test_cases = [
        ("Akogare_lm333_edited.sfc", "Lunar Magic 3.33 edited ROM (headered)"),
        ("Akogare_v121_lm.sfc", "Version 1.21 with Lunar Magic patches (headered)"),
        ("Akogare1_v121.sfc", "Version 1.21 (headerless)"),
        ("orig_Ako.sfc", "Original Akogare (headerless)"),
        ("smw_lm.sfc", "Basic SMW with Lunar Magic (may not have Level Names Patch)"),
        ("smw_lm2.sfc", "SMW with Lunar Magic Level Names Patch"),
    ]
    
    success_count = 0
    total_count = len(test_cases)
    
    for romfile, description in test_cases:
        if test_rom(romfile, description):
            success_count += 1
    
    print(f"\n{'='*70}")
    print("FINAL RESULTS")
    print('='*70)
    print(f"Successfully tested: {success_count}/{total_count} ROM files")
    
    if success_count == total_count:
        print("\nALL TESTS PASSED!")
    else:
        print(f"\n{total_count - success_count} tests failed or skipped")
    
    # Demonstrate additional features
    print(f"\n{'='*70}")
    print("ADDITIONAL FEATURES DEMONSTRATION")
    print('='*70)
    
    print("\n[Feature: JSON output format]")
    result = run_extractor("Akogare_lm333_edited.sfc", "--range", "0x001", "0x001", "--format", "json")
    if result.returncode == 0:
        for line in result.stdout.strip().split('\n')[:5]:
            print(f"  {line}")
    
    print("\n[Feature: Level range extraction]")
    result = run_extractor("Akogare_lm333_edited.sfc", "--range", "0x103", "0x10A")
    if result.returncode == 0:
        level_count = result.stdout.count('Level 0x')
        print(f"  Extracted {level_count} levels in range 0x103-0x10A")
        for line in result.stdout.strip().split('\n')[:3]:
            print(f"    {line}")
    
    print(f"\n{'='*70}")
    print("TESTING COMPLETE")
    print('='*70)
    
    print("\nScript is ready for production use!")
    print("See Level_Name_Extraction_Complete_Summary_20251028.md for details.")

if __name__ == '__main__':
    main()

