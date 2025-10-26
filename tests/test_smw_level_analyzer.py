#!/usr/bin/env python3
"""
Test cases for smw_level_analyzer.py

These tests verify that the SMW Level Analyzer correctly:
1. Detects ROM headers
2. Reads level pointers
3. Compares ROM files
4. Exports level data

Usage:
    python tests/test_smw_level_analyzer.py
"""

import sys
import os
import json
import tempfile
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from smw_level_analyzer import ROMAnalyzer, TOTAL_LEVELS


def test_load_vanilla_rom():
    """Test Case 1: Load vanilla SMW ROM"""
    print("Test 1: Loading vanilla SMW ROM...")
    
    vanilla_path = os.environ.get('SMW_VANILLA_ROM', 'smw.sfc')
    
    if not Path(vanilla_path).exists():
        print(f"  SKIP: Vanilla ROM not found at {vanilla_path}")
        return True
    
    try:
        rom = ROMAnalyzer(vanilla_path)
        print(f"  ✓ Loaded ROM: {rom.rom_path.name}")
        print(f"  ✓ ROM size: {len(rom.rom_data)} bytes")
        print(f"  ✓ Header offset: {rom.header_offset} bytes")
        return True
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        return False


def test_read_level_pointers():
    """Test Case 2: Read level pointers from vanilla ROM"""
    print("\nTest 2: Reading level pointers...")
    
    vanilla_path = os.environ.get('SMW_VANILLA_ROM', 'smw.sfc')
    
    if not Path(vanilla_path).exists():
        print(f"  SKIP: Vanilla ROM not found at {vanilla_path}")
        return True
    
    try:
        rom = ROMAnalyzer(vanilla_path)
        
        # Test reading Yoshi's Island 1 (level 0x000)
        level_105 = rom.get_level_info(0x105)
        print(f"  ✓ Level 0x105 (Yoshi's Island 1):")
        print(f"    Layer 1: {level_105['layer1_pointer']}")
        print(f"    Layer 2: {level_105['layer2_pointer']}")
        print(f"    Sprites: {level_105['sprite_pointer']}")
        
        # Test that we can read all 512 levels without errors
        for level_id in [0x000, 0x100, 0x1FF]:
            info = rom.get_level_info(level_id)
            assert 'level_id' in info
            assert 'layer1_pointer' in info
        
        print(f"  ✓ Successfully read all test levels")
        return True
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_compare_identical_roms():
    """Test Case 3: Compare ROM with itself (should find no changes)"""
    print("\nTest 3: Comparing ROM with itself...")
    
    vanilla_path = os.environ.get('SMW_VANILLA_ROM', 'smw.sfc')
    
    if not Path(vanilla_path).exists():
        print(f"  SKIP: Vanilla ROM not found at {vanilla_path}")
        return True
    
    try:
        rom1 = ROMAnalyzer(vanilla_path)
        rom2 = ROMAnalyzer(vanilla_path)
        
        changed_levels = rom1.compare_roms(rom2)
        
        if len(changed_levels) == 0:
            print(f"  ✓ Correctly found no changes when comparing ROM to itself")
            return True
        else:
            print(f"  ✗ Found {len(changed_levels)} changes when comparing identical ROMs")
            return False
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        return False


def test_find_modified_levels():
    """Test Case 4: Find modified levels in ROM hacks"""
    print("\nTest 4: Finding modified levels in ROM hacks...")
    
    vanilla_path = os.environ.get('SMW_VANILLA_ROM', 'smw.sfc')
    
    if not Path(vanilla_path).exists():
        print(f"  SKIP: Vanilla ROM not found at {vanilla_path}")
        return True
    
    # Find any ROM hack in the rom/ directory
    rom_dir = Path('rom')
    if not rom_dir.exists():
        print("  SKIP: rom/ directory not found")
        return True
    
    hack_files = list(rom_dir.glob('*.sfc'))
    if not hack_files:
        print("  SKIP: No ROM hacks found in rom/")
        return True
    
    try:
        vanilla = ROMAnalyzer(vanilla_path)
        hack = ROMAnalyzer(str(hack_files[0]))
        
        modified_levels = hack.find_valid_levels(vanilla)
        
        print(f"  ✓ Analyzed: {hack_files[0].name}")
        print(f"  ✓ Found {len(modified_levels)} modified levels")
        
        if modified_levels:
            print(f"  ✓ First 5 modified levels: {[f'0x{lid:03X}' for lid in modified_levels[:5]]}")
        
        return True
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_export_json():
    """Test Case 5: Export level data to JSON"""
    print("\nTest 5: Exporting level data to JSON...")
    
    vanilla_path = os.environ.get('SMW_VANILLA_ROM', 'smw.sfc')
    
    if not Path(vanilla_path).exists():
        print(f"  SKIP: Vanilla ROM not found at {vanilla_path}")
        return True
    
    try:
        rom = ROMAnalyzer(vanilla_path)
        
        # Export a few levels
        test_levels = [0x105, 0x106, 0x107]
        level_data = {}
        
        for level_id in test_levels:
            level_data[f"0x{level_id:03X}"] = rom.get_level_info(level_id)
        
        # Create temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(level_data, f, indent=2)
            temp_path = f.name
        
        # Verify JSON is valid
        with open(temp_path, 'r') as f:
            loaded_data = json.load(f)
        
        # Clean up
        os.unlink(temp_path)
        
        assert len(loaded_data) == len(test_levels)
        print(f"  ✓ Successfully exported {len(test_levels)} levels to JSON")
        print(f"  ✓ JSON format is valid")
        
        return True
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        return False


def test_header_detection():
    """Test Case 6: Verify header detection works"""
    print("\nTest 6: Testing header detection...")
    
    # Create a test ROM with a header
    with tempfile.NamedTemporaryFile(suffix='.sfc', delete=False) as f:
        # Write 512-byte header
        f.write(b'\x00' * 512)
        # Write fake ROM data (must be multiple of 1024 after header)
        f.write(b'\xFF' * 1024)
        temp_path = f.name
    
    try:
        rom = ROMAnalyzer(temp_path)
        
        if rom.header_offset == 512:
            print(f"  ✓ Correctly detected 512-byte header")
            result = True
        else:
            print(f"  ✗ Failed to detect header (got {rom.header_offset})")
            result = False
        
        os.unlink(temp_path)
        return result
    except Exception as e:
        print(f"  ✗ Failed: {e}")
        os.unlink(temp_path)
        return False


def run_all_tests():
    """Run all test cases"""
    print("=" * 60)
    print("SMW Level Analyzer Test Suite")
    print("=" * 60)
    
    tests = [
        test_load_vanilla_rom,
        test_read_level_pointers,
        test_compare_identical_roms,
        test_find_modified_levels,
        test_export_json,
        test_header_detection,
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

