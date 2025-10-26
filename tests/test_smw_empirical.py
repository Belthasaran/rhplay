#!/usr/bin/env python3
"""
Test cases for smw_empirical_analysis.py

Tests the empirical analysis functionality.

Usage:
    python tests/test_smw_empirical.py
"""

import sys
import os
from pathlib import Path
from glob import glob

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from smw_empirical_analysis import EmpiricalAnalyzer, DOCUMENTED_OFFSETS


def test_load_rom():
    """Test Case 1: Load ROM and analyze basic properties"""
    print("Test 1: Loading ROM for empirical analysis...")
    
    vanilla_path = os.environ.get('SMW_VANILLA_ROM', 'smw.sfc')
    
    if not Path(vanilla_path).exists():
        print(f"  SKIP: Vanilla ROM not found at {vanilla_path}")
        return True
    
    try:
        analyzer = EmpiricalAnalyzer(vanilla_path, "Vanilla")
        print(f"  ✓ Loaded ROM: {analyzer.name}")
        print(f"  ✓ ROM size: {analyzer.size:,} bytes")
        print(f"  ✓ Header offset: {analyzer.header_offset} bytes")
        return True
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        return False


def test_read_offsets():
    """Test Case 2: Read data at documented offsets"""
    print("\nTest 2: Reading data at documented offsets...")
    
    vanilla_path = os.environ.get('SMW_VANILLA_ROM', 'smw.sfc')
    
    if not Path(vanilla_path).exists():
        print(f"  SKIP: Vanilla ROM not found at {vanilla_path}")
        return True
    
    try:
        analyzer = EmpiricalAnalyzer(vanilla_path)
        
        # Test reading Layer 1 pointer for level 0
        data = analyzer.read_at(DOCUMENTED_OFFSETS['layer1_ptrs'], 3)
        print(f"  ✓ Layer 1 pointer for level 0: {data.hex().upper()}")
        
        # Test reading Level settings for level 0
        data = analyzer.read_at(DOCUMENTED_OFFSETS['level_settings'], 1)
        print(f"  ✓ Level settings for level 0: 0x{data.hex().upper()}")
        
        return True
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_compare_roms():
    """Test Case 3: Compare vanilla vs hack ROM"""
    print("\nTest 3: Comparing vanilla vs hack ROM...")
    
    vanilla_path = os.environ.get('SMW_VANILLA_ROM', 'smw.sfc')
    
    if not Path(vanilla_path).exists():
        print(f"  SKIP: Vanilla ROM not found at {vanilla_path}")
        return True
    
    # Find a hack ROM
    hack_files = glob('rom/*.sfc')
    if not hack_files:
        print("  SKIP: No ROM hacks found in rom/")
        return True
    
    try:
        vanilla = EmpiricalAnalyzer(vanilla_path, "Vanilla")
        hack = EmpiricalAnalyzer(hack_files[0], "Hack")
        
        modified_ptrs = hack.find_modified_level_pointers(vanilla)
        
        total_modified = len(set(modified_ptrs['layer1']) | 
                           set(modified_ptrs['layer2']) | 
                           set(modified_ptrs['sprites']))
        
        print(f"  ✓ Compared {vanilla.name} vs {hack.name}")
        print(f"  ✓ Found {total_modified} modified levels")
        print(f"    - Layer 1: {len(modified_ptrs['layer1'])} levels")
        print(f"    - Layer 2: {len(modified_ptrs['layer2'])} levels")
        print(f"    - Sprites: {len(modified_ptrs['sprites'])} levels")
        
        return True
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def run_all_tests():
    """Run all test cases"""
    print("=" * 60)
    print("SMW Empirical Analysis Test Suite")
    print("=" * 60)
    
    tests = [
        test_load_rom,
        test_read_offsets,
        test_compare_roms,
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

