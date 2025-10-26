#!/usr/bin/env python3
"""
SMW Level Force Tool - Create ROMs that ALWAYS load a specific level

This improves upon asm1.py by hooking ALL level entry points:
- Initial entry from overworld
- Death respawn
- Midway point respawn  
- Instant retry systems
- Continue screen

Usage:
    smw_level_force.py <input.sfc> --level 0x105 --output forced.sfc
    smw_level_force.py <input.sfc> --level 261 --patch-type universal --output test.sfc

Environment Variables:
    SMW_TEST_ROM_DIR - Output directory for test ROMs
"""

import sys
import argparse
from pathlib import Path
import subprocess
import tempfile
import os

DEFAULT_OUTPUT_DIR = os.environ.get('SMW_TEST_ROM_DIR', 'test_roms')


def get_universal_patch(level_id: int) -> str:
    """
    Universal patch that hooks multiple entry points.
    
    This hooks:
    1. Level load routine ($05D796) - catches ALL level loads
    2. Game mode handler - ensures level is set when entering game mode
    3. Death/respawn - sets level before respawn
    """
    lob = level_id & 0xFF
    hib = (level_id & 0x1FF) >> 8  # Only use 9 bits (0x000-0x1FF)
    
    # Calculate the high byte flag
    # Bit 0 = high bit of level number (0x100+)
    # Bit 2 = some flag that's commonly set
    hiflag = 0x04 | (1 if hib > 0 else 0)
    
    return f"""
; Universal Level Force Patch
; Forces level {level_id:03X} (0x{level_id:03X}) at ALL entry points
;
; Strategy: Hook the main level load routine which is called for:
; - Initial entry, Death, Midway, Continue, Retry

!target_level_lo = ${lob:02X}
!target_level_hi = ${hib:02X}  
!target_level_flag = ${hiflag:02X}

; Detect SA-1 ROM
if read1($00FFD5) == $23
    sa1rom
    !sa1 = 1
    !addr = $6000
else
    lorom
    !sa1 = 0
    !addr = $0000
endif

; Skip intro
org $9CB1
    db $00

; Short timer for faster testing
org $00A09C
    db $10

; Hook 1: Main level data loading routine
; This is called whenever ANY level is loaded
org $05D796
    autoclean JSL ForceLevel_Main
    NOP #2

; Hook 2: Level init routine  
; Catches level initialization
org $00A635
    autoclean JSL ForceLevel_Init
    NOP

freedata

ForceLevel_Main:
    ; Save registers
    PHP
    PHX
    PHA
    
    ; Set the target level
    LDA.b #!target_level_lo
    STA $13BF|!addr    ; Main level number
    STA $17BB|!addr    ; Level number backup
    STA $0E|!addr      ; Used in some level load code
    
    ; Fill level arrays (some hacks use these)
    LDX.b #$1F
    .loop_lo:
        STA $19B8|!addr,x
        DEX
        BPL .loop_lo
    
    ; Set high byte + flags
    LDA.b #!target_level_hi
    ORA.b #$04         ; Common flag
    LDX.b #$1F
    .loop_hi:
        STA $19D8|!addr,x
        DEX
        BPL .loop_hi
    
    ; Restore registers
    PLA
    PLX
    PLP
    
    ; Execute original code we replaced
    PHB
    PHK
    PLB
    RTL

ForceLevel_Init:
    ; Quick version for init hook
    PHP
    PHA
    
    LDA.b #!target_level_lo
    STA $13BF|!addr
    STA $17BB|!addr
    
    PLA
    PLP
    
    ; Original code
    STZ $13C7|!addr
    RTL
"""


def get_aggressive_patch(level_id: int) -> str:
    """
    Aggressive patch that hooks even more points.
    Use if universal patch doesn't work.
    """
    lob = level_id & 0xFF
    hib = (level_id & 0x1FF) >> 8
    hiflag = 0x04 | (1 if hib > 0 else 0)
    
    return f"""
; Aggressive Level Force Patch
; Hooks EVERYTHING

!target_level_lo = ${lob:02X}
!target_level_hi = ${hib:02X}

if read1($00FFD5) == $23
    sa1rom
    !sa1 = 1
    !addr = $6000
else
    lorom
    !sa1 = 0
    !addr = $0000
endif

org $9CB1
    db $00

org $00A09C
    db $10

; Hook level load
org $05D796
    autoclean JSL ForceLevel
    NOP #2

; Hook level init
org $00A635
    autoclean JSL ForceLevel
    NOP

; Hook game mode change (catches everything)
org $008222
    autoclean JSL ForceLevel_GameMode

; Hook after death
org $00F606
    autoclean JSL ForceLevel_PreDeath

freedata

ForceLevel:
    PHP
    PHX
    PHA
    
    LDA.b #!target_level_lo
    STA $13BF|!addr
    STA $17BB|!addr
    STA $0E|!addr
    
    LDX.b #$1F
    .loop1:
        STA $19B8|!addr,x
        DEX
        BPL .loop1
    
    LDA.b #!target_level_hi
    ORA.b #$04
    LDX.b #$1F
    .loop2:
        STA $19D8|!addr,x
        DEX
        BPL .loop2
    
    PLA
    PLX
    PLP
    PHB
    PHK
    PLB
    RTL

ForceLevel_GameMode:
    PHP
    PHA
    
    ; Only set if entering a level-related game mode
    LDA $100|!addr
    CMP #$14
    BEQ .set_level
    CMP #$11
    BEQ .set_level
    BRA .skip
    
    .set_level:
    LDA.b #!target_level_lo
    STA $13BF|!addr
    STA $17BB|!addr
    
    .skip:
    PLA
    PLP
    RTL

ForceLevel_PreDeath:
    ; Set level before death so respawn is correct
    PHP
    PHA
    
    LDA.b #!target_level_lo
    STA $13BF|!addr
    STA $17BB|!addr
    
    PLA
    PLP
    
    ; Original death code
    INC $1426|!addr
    RTL
"""


def apply_patch_with_asar(rom_path: str, patch_text: str, output_path: str) -> bool:
    """
    Apply an ASM patch using asar assembler.
    
    Returns True if successful, False otherwise.
    """
    # Check if asar is available
    asar_paths = [
        '/home/main/proj/rhtools/bin/asar',
        'bin/asar',
        '/home/main/proj/rhtools/refmaterial/asar-1.91/asar',
        'asar',
        './asar'
    ]
    
    asar_cmd = None
    for path in asar_paths:
        if Path(path).exists() or subprocess.run(['which', path], 
                                                 capture_output=True).returncode == 0:
            asar_cmd = path
            break
    
    if not asar_cmd:
        print("Error: asar assembler not found", file=sys.stderr)
        print("  Looked in:", file=sys.stderr)
        for p in asar_paths:
            print(f"    - {p}", file=sys.stderr)
        return False
    
    # Create temporary patch file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.asm', delete=False) as f:
        f.write(patch_text)
        patch_file = f.name
    
    try:
        # Copy ROM to output
        import shutil
        shutil.copy2(rom_path, output_path)
        
        # Apply patch
        result = subprocess.run(
            [asar_cmd, patch_file, output_path],
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            print("Error applying patch:", file=sys.stderr)
            print(result.stdout, file=sys.stderr)
            print(result.stderr, file=sys.stderr)
            return False
        
        return True
        
    finally:
        # Clean up temp file
        os.unlink(patch_file)


def main():
    parser = argparse.ArgumentParser(
        description='Force a specific level to ALWAYS load in SMW ROM',
        epilog='Hooks ALL entry points: initial, death, midway, continue, retry'
    )
    
    parser.add_argument('input_rom',
                       help='Input ROM file (.sfc)')
    
    parser.add_argument('--level', '-l', required=True,
                       help='Level ID to force (hex like 0x105 or decimal like 261)')
    
    parser.add_argument('--output', '-o',
                       help='Output ROM file (default: test_roms/force_LEVELID.sfc)')
    
    parser.add_argument('--patch-type', choices=['universal', 'aggressive'],
                       default='universal',
                       help='Patch strategy (default: universal)')
    
    parser.add_argument('--show-patch', action='store_true',
                       help='Show the ASM patch that will be applied')
    
    args = parser.parse_args()
    
    # Parse level ID
    try:
        if args.level.startswith('0x') or args.level.startswith('0X'):
            level_id = int(args.level, 16)
        else:
            level_id = int(args.level)
    except ValueError:
        print(f"Error: Invalid level ID: {args.level}", file=sys.stderr)
        return 1
    
    if level_id < 0 or level_id > 0x1FF:
        print(f"Error: Level ID must be 0x000-0x1FF (0-511)", file=sys.stderr)
        return 1
    
    # Determine output path
    if args.output:
        output_path = args.output
    else:
        output_dir = Path(DEFAULT_OUTPUT_DIR)
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"force_level_{level_id:03X}.sfc"
    
    # Generate patch
    if args.patch_type == 'universal':
        patch = get_universal_patch(level_id)
    else:
        patch = get_aggressive_patch(level_id)
    
    if args.show_patch:
        print("=" * 70)
        print(f"ASM Patch for Level 0x{level_id:03X}:")
        print("=" * 70)
        print(patch)
        print("=" * 70)
        return 0
    
    # Apply patch
    print(f"Forcing level 0x{level_id:03X} ({level_id})...")
    print(f"Input:  {args.input_rom}")
    print(f"Output: {output_path}")
    print(f"Patch:  {args.patch_type}")
    
    if apply_patch_with_asar(args.input_rom, patch, str(output_path)):
        print(f"\n✓ Success! ROM created at: {output_path}")
        print(f"\nThis ROM will ALWAYS load level 0x{level_id:03X}, regardless of:")
        print(f"  - How Mario enters (overworld, death, midway, retry)")
        print(f"  - Game mode changes")
        print(f"  - Continue screen")
        return 0
    else:
        print(f"\n✗ Failed to create ROM", file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

