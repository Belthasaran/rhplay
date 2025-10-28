#!/usr/bin/env python3
"""Test the levelname extractor against all available ROMs."""

import subprocess
import sys

# List of ROM files to test
rom_files = [
    "Akogare_lm333_edited.sfc",
    "Akogare_v121_lm.sfc",
    "Akogare1_v121.sfc",
    "orig_Ako.sfc",
    "smw_lm.sfc",
    "smw_lm2.sfc"
]

print("=" * 70)
print("TESTING LEVEL NAME EXTRACTOR ON ALL AVAILABLE ROMS")
print("=" * 70)

for rom_file in rom_files:
    print(f"\n{'=' * 70}")
    print(f"Testing: {rom_file}")
    print('=' * 70)
    
    # Test with verbose mode and a small range
    cmd = [
        sys.executable,
        "levelname_extractor_2025_10_28.py",
        "--romfile", rom_file,
        "--verbose",
        "--range", "0x001", "0x020"
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode == 0:
        # Print stderr (verbose info) first
        if result.stderr:
            for line in result.stderr.strip().split('\n'):
                print(f"  {line}")
        
        # Count level names in stdout
        level_count = result.stdout.count('Level 0x')
        print(f"\n  SUCCESS: Extracted {level_count} level names")
        
        # Show first 5 level names
        stdout_lines = [l for l in result.stdout.strip().split('\n') if l.startswith('Level 0x')]
        for line in stdout_lines[:5]:
            print(f"    {line}")
        if len(stdout_lines) > 5:
            print(f"    ... and {len(stdout_lines) - 5} more")
    else:
        print(f"  FAILED: Return code {result.returncode}")
        if result.stderr:
            print(f"  Error: {result.stderr}")

print(f"\n{'=' * 70}")
print("TESTING COMPLETE")
print('=' * 70)

