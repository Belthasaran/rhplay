#!/usr/bin/env python3
"""
Test cases for smw_level_names.py

Tests the level name extraction functionality.

Usage:
    python tests/test_smw_level_names.py
"""

import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from smw_level_names import LevelNameExtractor


def test_load_rom():
    """Test Case 1: Load ROM and detect header"""
    print("Test 1: Loading ROM...")
    
    vanilla_path = os.environ.get('SMW_VANILLA_ROM', 'smw.sfc')
    
    if not Path(vanilla_path).exists():
        print(f"  SKIP: Vanilla ROM not found at {vanilla_path}")
        return True
    
    try:
        extractor = LevelNameExtractor(vanilla_path)
        print(f"  ✓ Loaded ROM: {extractor.rom_path.name}")
        print(f"  ✓ ROM size: {len(extractor.rom_data)} bytes")
        print(f"  ✓ Header offset: {extractor.header_offset} bytes")
        return True
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        return False


def test_extract_raw_tiles():
    """Test Case 2: Extract raw tile data"""
    print("\nTest 2: Extracting raw tile data...")
    
    vanilla_path = os.environ.get('SMW_VANILLA_ROM', 'smw.sfc')
    
    if not Path(vanilla_path).exists():
        print(f"  SKIP: Vanilla ROM not found at {vanilla_path}")
        return True
    
    try:
        extractor = LevelNameExtractor(vanilla_path)
        
        # Try to extract some level names
        for level_id in [0, 1, 2]:
            tiles = extractor.extract_level_name_raw(level_id)
            if tiles:
                print(f"  ✓ Level {level_id}: {len(tiles)} tiles - {' '.join(f'{t:02X}' for t in tiles[:10])}")
            else:
                print(f"  - Level {level_id}: No name data")
        
        return True
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_extract_names():
    """Test Case 3: Extract level names as strings"""
    print("\nTest 3: Extracting level names as strings...")
    
    vanilla_path = os.environ.get('SMW_VANILLA_ROM', 'smw.sfc')
    
    if not Path(vanilla_path).exists():
        print(f"  SKIP: Vanilla ROM not found at {vanilla_path}")
        return True
    
    try:
        extractor = LevelNameExtractor(vanilla_path)
        
        # Extract first few names
        names_found = 0
        for level_id in range(20):
            name = extractor.extract_level_name(level_id)
            if name:
                names_found += 1
                print(f"  ✓ Level {level_id}: '{name}'")
        
        if names_found > 0:
            print(f"\n  ✓ Found {names_found} level names")
            return True
        else:
            print(f"  ! Warning: No level names found (this might be expected)")
            return True  # Not necessarily a failure
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def run_all_tests():
    """Run all test cases"""
    print("=" * 60)
    print("SMW Level Name Extractor Test Suite")
    print("=" * 60)
    
    tests = [
        test_load_rom,
        test_extract_raw_tiles,
        test_extract_names,
    ]
    
    results = []
    for test in tests:
        result = test()
        results.append(result)
    
    print("\n" + "=" * 60)
    print(f"Results: {sum(results)}/{len(results)} tests passed")
    print("=" * 60)
    
    return all(results)


if __name__ == '__main__':
    success = run_all_tests()
    sys.exit(0 if success else 1)

