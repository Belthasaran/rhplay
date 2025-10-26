#!/usr/bin/env python3
"""
SMW Automated ROM Testing

Tests SMW ROMs using snes9x with automated input to verify:
1. ROM boots
2. Gets past title screen
3. Enters a level
4. Level loads correctly

Uses Lua scripting or memory watching if available.
"""

import sys
import argparse
import subprocess
import time
import signal
from pathlib import Path
import os

SNES9X_PATH = os.environ.get('SNES9X_PATH', 'bin/snes9x')


def create_test_lua_script(test_type: str = 'boot') -> str:
    """Create a Lua script for automated testing"""
    
    if test_type == 'boot':
        return """
-- Test if ROM boots and gets to gameplay
local frame = 0
local max_frames = 180  -- 3 seconds

function test_boot()
    frame = frame + 1
    
    -- Press Start after 60 frames to skip title
    if frame == 60 then
        joypad.set(1, {Start=true})
    elseif frame == 62 then
        joypad.set(1, {})
    end
    
    -- Press Start again to enter game
    if frame == 120 then
        joypad.set(1, {Start=true})
    elseif frame == 122 then
        joypad.set(1, {})
    end
    
    -- Check if we're in a level (game mode $14)
    local game_mode = memory.readbyte(0x7E0100)
    
    if game_mode == 0x14 then
        print("SUCCESS: In level! Game mode = 0x14")
        os.exit(0)
    end
    
    if frame >= max_frames then
        print("TIMEOUT: Did not reach level after " .. max_frames .. " frames")
        print("Last game mode: 0x" .. string.format("%02X", game_mode))
        os.exit(1)
    end
end

emu.registerafter(test_boot)
"""
    
    elif test_type == 'level_check':
        return """
-- Check which level actually loaded
local frame = 0

function check_level()
    frame = frame + 1
    
    if frame == 60 then
        -- Read level number from RAM
        local level_lo = memory.readbyte(0x7E13BF)
        local level_hi_flags = memory.readbyte(0x7E19D8)
        local level_hi = bit.band(level_hi_flags, 0x01)
        local full_level = (level_hi * 256) + level_lo
        
        print(string.format("Level loaded: 0x%03X (%d)", full_level, full_level))
        print(string.format("  $13BF = 0x%02X", level_lo))
        print(string.format("  $19D8 = 0x%02X (high bit = %d)", level_hi_flags, level_hi))
        
        os.exit(0)
    end
end

emu.registerafter(check_level)
"""


def test_with_lua(rom_path: str, lua_script: str, timeout: float = 10.0) -> dict:
    """
    Test ROM using Lua script.
    
    Returns dict with success and output.
    """
    # Create temporary Lua script
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w', suffix='.lua', delete=False) as f:
        f.write(lua_script)
        lua_file = f.name
    
    try:
        # Run snes9x with Lua script
        # Note: snes9x may not support Lua, will fail gracefully
        cmd = [SNES9X_PATH, rom_path, '--lua', lua_file]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        
        return {
            'success': result.returncode == 0,
            'stdout': result.stdout,
            'stderr': result.stderr,
            'returncode': result.returncode
        }
        
    except subprocess.TimeoutExpired as e:
        return {
            'success': False,
            'error': 'Timeout',
            'stdout': e.stdout.decode() if e.stdout else '',
            'stderr': e.stderr.decode() if e.stderr else ''
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }
    finally:
        os.unlink(lua_file)


def simple_boot_test(rom_path: str) -> dict:
    """
    Simple test: Just try to run the ROM briefly.
    If it doesn't crash immediately, consider it a pass.
    """
    try:
        proc = subprocess.Popen(
            [SNES9X_PATH, rom_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        # Wait 3 seconds
        time.sleep(3)
        
        # Check if still running
        poll = proc.poll()
        
        if poll is None:
            # Still running - good!
            proc.kill()
            proc.wait()
            return {
                'success': True,
                'details': 'ROM ran for 3 seconds without crashing'
            }
        else:
            # Exited - might be bad
            stdout, stderr = proc.communicate()
            return {
                'success': False,
                'error': f'Emulator exited immediately (code {poll})',
                'stderr': stderr.decode()[:200] if stderr else ''
            }
            
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }


def main():
    parser = argparse.ArgumentParser(
        description='Automated testing of SMW ROMs',
        epilog='Tests if ROMs boot and run correctly'
    )
    
    parser.add_argument('rom', help='ROM file to test')
    
    parser.add_argument('--method', choices=['simple', 'lua'],
                       default='simple',
                       help='Test method (default: simple)')
    
    parser.add_argument('--verbose', '-v', action='store_true',
                       help='Show detailed output')
    
    args = parser.parse_args()
    
    if not Path(args.rom).exists():
        print(f"Error: ROM not found: {args.rom}", file=sys.stderr)
        return 1
    
    if not Path(SNES9X_PATH).exists():
        print(f"Error: snes9x not found at: {SNES9X_PATH}", file=sys.stderr)
        return 1
    
    print(f"Testing: {args.rom}")
    print(f"Method: {args.method}")
    print()
    
    if args.method == 'simple':
        result = simple_boot_test(args.rom)
    elif args.method == 'lua':
        lua = create_test_lua_script('boot')
        result = test_with_lua(args.rom, lua)
    
    if result['success']:
        print("✓ TEST PASSED")
        if 'details' in result:
            print(f"  {result['details']}")
    else:
        print("✗ TEST FAILED")
        if 'error' in result:
            print(f"  Error: {result['error']}")
        if args.verbose and 'stderr' in result:
            print(f"  stderr: {result['stderr']}")
    
    return 0 if result['success'] else 1


if __name__ == '__main__':
    sys.exit(main())

