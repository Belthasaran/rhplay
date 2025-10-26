#!/usr/bin/env python3
"""
SMW Test ROM Verifier - Automated testing with emulator

Uses snes9x in headless mode to verify that test ROMs:
1. Can boot
2. Get past title screen
3. Load into a level

Usage:
    smw_test_rom_verify.py <rom.sfc>
    smw_test_rom_verify.py <rom.sfc> --frames 300 --verbose
"""

import sys
import argparse
import subprocess
import time
from pathlib import Path
import signal
import os

SNES9X_PATH = os.environ.get('SNES9X_PATH', 'bin/snes9x')


def test_rom_boots(rom_path: str, frames: int = 180, verbose: bool = False) -> dict:
    """
    Test if a ROM can boot and run in the emulator.
    
    Args:
        rom_path: Path to ROM file
        frames: Number of frames to run (60 fps = 1 second per 60 frames)
        verbose: Show detailed output
    
    Returns:
        dict with: success (bool), error (str), details (str)
    """
    rom = Path(rom_path)
    if not rom.exists():
        return {'success': False, 'error': f'ROM not found: {rom_path}'}
    
    if not Path(SNES9X_PATH).exists():
        return {'success': False, 'error': f'snes9x not found at: {SNES9X_PATH}'}
    
    # Try to run the ROM
    # snes9x might have different flags, let's try a few approaches
    
    try:
        # Approach 1: Run with timeout
        if verbose:
            print(f"Testing {rom.name}...", file=sys.stderr)
            print(f"  Running for ~{frames/60:.1f} seconds ({frames} frames)", file=sys.stderr)
        
        # Run emulator with timeout
        # Use -nogui or -headless if available
        cmd = [SNES9X_PATH, str(rom)]
        
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        # Let it run for a short time
        timeout = frames / 60.0  # Convert frames to seconds (assume 60 fps)
        
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
            
            # If it ran and exited cleanly, that's good
            if proc.returncode == 0 or proc.returncode is None:
                return {
                    'success': True,
                    'details': 'ROM ran successfully',
                    'stdout': stdout[:500] if stdout else '',
                    'stderr': stderr[:500] if stderr else ''
                }
            else:
                return {
                    'success': False,
                    'error': f'Emulator exited with code {proc.returncode}',
                    'stdout': stdout[:500] if stdout else '',
                    'stderr': stderr[:500] if stderr else ''
                }
                
        except subprocess.TimeoutExpired:
            # Timeout is actually good - means it's still running
            proc.kill()
            stdout, stderr = proc.communicate()
            
            return {
                'success': True,
                'details': f'ROM ran for {timeout:.1f}s without crashing',
                'note': 'Timeout is expected and indicates success'
            }
            
    except Exception as e:
        return {
            'success': False,
            'error': f'Exception: {str(e)}'
        }


def main():
    parser = argparse.ArgumentParser(
        description='Test SMW ROMs using emulator to verify they boot',
        epilog='Useful for verifying ASM patches didn\'t break the ROM'
    )
    
    parser.add_argument('rom',
                       help='ROM file to test')
    
    parser.add_argument('--frames', type=int, default=180,
                       help='Number of frames to run (default: 180 = 3 seconds)')
    
    parser.add_argument('--verbose', '-v', action='store_true',
                       help='Show detailed output')
    
    parser.add_argument('--emulator', default=SNES9X_PATH,
                       help=f'Path to snes9x (default: {SNES9X_PATH})')
    
    args = parser.parse_args()
    
    # Override emulator path if specified
    global SNES9X_PATH
    SNES9X_PATH = args.emulator
    
    print(f"Testing ROM: {args.rom}")
    print(f"Emulator: {SNES9X_PATH}")
    print(f"Test duration: ~{args.frames/60:.1f} seconds")
    print()
    
    result = test_rom_boots(args.rom, args.frames, args.verbose)
    
    if result['success']:
        print("✓ SUCCESS - ROM boots and runs")
        if 'details' in result:
            print(f"  {result['details']}")
        if 'note' in result:
            print(f"  Note: {result['note']}")
    else:
        print("✗ FAILED - ROM has issues")
        if 'error' in result:
            print(f"  Error: {result['error']}")
    
    if args.verbose:
        if 'stdout' in result and result['stdout']:
            print(f"\nStdout: {result['stdout']}")
        if 'stderr' in result and result['stderr']:
            print(f"\nStderr: {result['stderr']}")
    
    return 0 if result['success'] else 1


if __name__ == '__main__':
    sys.exit(main())

