#!/usr/bin/env python3
"""
Test levelname_extractor2.py against all ROMs in testrom/ directory
"""

import os
import subprocess
import sys

def test_rom(rom_path):
    """Test a single ROM with various filter combinations"""
    rom_name = os.path.basename(rom_path)
    
    print(f"\n{'='*80}")
    print(f"Testing: {rom_name}")
    print(f"{'='*80}\n")
    
    tests = [
        {
            'name': 'Basic extraction',
            'args': ['--romfile', rom_path]
        },
        {
            'name': 'Filter vanilla names',
            'args': ['--romfile', rom_path, '--novanilla']
        },
        {
            'name': 'Levels only (no message boxes)',
            'args': ['--romfile', rom_path, '--levelsonly']
        },
        {
            'name': 'Combined: no vanilla + levels only',
            'args': ['--romfile', rom_path, '--novanilla', '--levelsonly']
        },
        {
            'name': 'With English words only',
            'args': ['--romfile', rom_path, '--novanilla', '--levelsonly', '--withwords']
        },
    ]
    
    for test in tests:
        print(f"  Test: {test['name']}")
        
        try:
            result = subprocess.run(
                ['python', 'levelname_extractor2.py'] + test['args'],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                # Count level names in output
                level_count = len([line for line in result.stdout.split('\n') if line.startswith('Level 0x')])
                print(f"    [OK] Success: {level_count} level names")
                
                # Show first 3 level names as sample
                lines = [line for line in result.stdout.split('\n') if line.startswith('Level 0x')]
                if lines:
                    print(f"    Sample: {lines[0]}")
                    if len(lines) > 1:
                        print(f"            {lines[1]}")
                    if len(lines) > 2:
                        print(f"            {lines[2]}")
            else:
                print(f"    [FAIL] Failed: {result.returncode}")
                if result.stderr:
                    print(f"    Error: {result.stderr[:200]}")
        
        except subprocess.TimeoutExpired:
            print(f"    [TIMEOUT] Timeout")
        except Exception as e:
            print(f"    [ERROR] Exception: {e}")
    
    print()

def main():
    """Test all ROMs in testrom/ directory"""
    
    testrom_dir = 'testrom'
    
    if not os.path.exists(testrom_dir):
        print(f"ERROR: Directory '{testrom_dir}' not found")
        sys.exit(1)
    
    # Find all .sfc files
    rom_files = [f for f in os.listdir(testrom_dir) if f.endswith('.sfc')]
    rom_files.sort()
    
    if not rom_files:
        print(f"ERROR: No .sfc files found in '{testrom_dir}'")
        sys.exit(1)
    
    print(f"\nFound {len(rom_files)} ROM files to test\n")
    
    for rom_file in rom_files:
        rom_path = os.path.join(testrom_dir, rom_file)
        test_rom(rom_path)
    
    print(f"\n{'='*80}")
    print(f"Completed testing {len(rom_files)} ROM files")
    print(f"{'='*80}\n")

if __name__ == '__main__':
    main()
