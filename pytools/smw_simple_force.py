#!/usr/bin/env python3
"""
SMW Simple Level Force - Ultra-safe minimal patch

This version uses the SAFEST possible approach:
- Only modifies a few bytes
- No custom code in freedata
- Minimal impact on ROM

Use this if smw_level_force.py doesn't work.

Usage:
    smw_simple_force.py <input.sfc> --level 0x105 --output safe.sfc
"""

import sys
import argparse
from pathlib import Path
import subprocess
import tempfile
import os


def get_safe_patch(level_id: int) -> str:
    """
    Extremely safe patch - only modifies existing bytes, no new code.
    
    Strategy: Only skip intro and set the intro level number.
    This is the safest possible modification.
    """
    lob = level_id & 0xFF
    level_with_offset = (lob + 0x24) & 0xFF  # Level + $24 format
    
    return f"""
; Ultra-Safe Level Force Patch
; Only modifies 2 bytes - minimal risk

lorom

; Set intro level to our target level
; The intro level loads at game start
org $009CB1
    db ${level_with_offset:02X}    ; Level {level_id:03X} + $24 = ${level_with_offset:02X}

; Short timer for faster testing (optional)
org $00A09C
    db $10
"""


def get_medium_patch(level_id: int) -> str:
    """
    Medium safety patch - uses inline code only, no freedata.
    
    Modifies bytes directly at hook points without adding new code sections.
    """
    lob = level_id & 0xFF
    
    return f"""
; Medium Safety Level Force Patch
; Inline modifications only, no freedata

lorom

; Skip intro
org $009CB1
    db $00

; Short timer
org $00A09C
    db $10

; Modify level init to set our level
; This is inline - just changes a few instructions
org $00A635
    LDA #${lob:02X}    ; Our level (low byte)
    STA $13BF         ; Set current level
    STA $17BB         ; Set level backup  
    NOP               ; Fill remaining bytes
"""


def apply_safe_patch(rom_path: str, patch_text: str, output_path: str, asar_path: str = 'bin/asar') -> tuple:
    """
    Apply patch and return (success, error_message)
    """
    if not Path(asar_path).exists():
        return (False, f"asar not found at: {asar_path}")
    
    # Create temp patch file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.asm', delete=False) as f:
        f.write(patch_text)
        patch_file = f.name
    
    try:
        # Copy ROM
        import shutil
        shutil.copy2(rom_path, output_path)
        
        # Apply patch with verbose output
        result = subprocess.run(
            [asar_path, '-v', patch_file, output_path],
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            return (False, f"asar error:\n{result.stdout}\n{result.stderr}")
        
        return (True, result.stdout)
        
    finally:
        os.unlink(patch_file)


def main():
    parser = argparse.ArgumentParser(
        description='Create ROMs with ULTRA-SAFE minimal patches',
        epilog='Use this if smw_level_force.py creates ROMs that won\'t boot'
    )
    
    parser.add_argument('input_rom', help='Input ROM file')
    parser.add_argument('--level', '-l', required=True, help='Level ID (hex or decimal)')
    parser.add_argument('--output', '-o', required=True, help='Output ROM file')
    
    parser.add_argument('--safety', choices=['ultra', 'medium'],
                       default='ultra',
                       help='Patch safety level (default: ultra)')
    
    parser.add_argument('--show-patch', action='store_true',
                       help='Show the patch before applying')
    
    args = parser.parse_args()
    
    # Parse level
    try:
        if args.level.startswith('0x'):
            level_id = int(args.level, 16)
        else:
            level_id = int(args.level)
    except ValueError:
        print(f"Error: Invalid level ID: {args.level}", file=sys.stderr)
        return 1
    
    if level_id > 0x1FF:
        print(f"Error: Level must be 0x000-0x1FF", file=sys.stderr)
        return 1
    
    # Generate patch
    if args.safety == 'ultra':
        patch = get_safe_patch(level_id)
    else:
        patch = get_medium_patch(level_id)
    
    if args.show_patch:
        print(patch)
        return 0
    
    # Apply patch
    print(f"Creating SAFE test ROM for level 0x{level_id:03X}...")
    print(f"Safety level: {args.safety}")
    print(f"Input:  {args.input_rom}")
    print(f"Output: {args.output}")
    
    success, message = apply_safe_patch(args.input_rom, patch, args.output)
    
    if success:
        print(f"\n✓ Success!")
        print(f"\nPatch applied:")
        for line in message.split('\n')[:10]:
            if line.strip():
                print(f"  {line}")
        
        # Check ROM size
        size = Path(args.output).stat().st_size
        print(f"\nOutput ROM size: {size:,} bytes")
        
        if size > 2_000_000:
            print(f"  ⚠ ROM expanded significantly (original was likely ~512KB)")
            print(f"  This is normal with 'freedata' but some emulators may not like it")
        
        print(f"\n✓ Test ROM created: {args.output}")
        print(f"\nNOTE: This is a MINIMAL patch:")
        if args.safety == 'ultra':
            print(f"  - Only sets the intro level to 0x{level_id:03X}")
            print(f"  - Won't handle death/respawn correctly")
            print(f"  - But SHOULD boot successfully")
        else:
            print(f"  - Modifies level init inline")  
            print(f"  - Should handle initial entry")
        
        return 0
    else:
        print(f"\n✗ Failed!")
        print(f"{message}", file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

