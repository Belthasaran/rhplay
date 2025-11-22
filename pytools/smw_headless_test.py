#!/usr/bin/env python3
"""
SMW Headless Automated Testing Tool

Tests SMW ROM patches in a headless emulator environment:
- Simulates player inputs (Start, navigation, level entry)
- Samples RAM at execution points
- Captures screenshots for comparison
- Collects statistics and reports results

Supports:
- BizHawk (recommended - best Lua support)
- RetroArch (headless mode)
- Mesen-S (headless mode)

Usage:
    smw_headless_test.py <rom.sfc> --target-level 0x106
    smw_headless_test.py <rom.sfc> --target-level 0x106 --emulator bizhawk
    smw_headless_test.py <rom.sfc> --target-level 0x106 --screenshot-dir screenshots
"""

import sys
import argparse
import subprocess
import time
import json
import tempfile
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import os

# Emulator paths (can be overridden via env vars)
BIZHAWK_PATH = os.environ.get('BIZHAWK_PATH', 'EmuHawk')
RETROARCH_PATH = os.environ.get('RETROARCH_PATH', 'retroarch')
MESEN_PATH = os.environ.get('MESEN_PATH', 'Mesen-S')


class HeadlessTester:
    """Headless emulator testing for SMW ROMs"""
    
    def __init__(self, rom_path: str, target_level: int, emulator: str = 'bizhawk'):
        self.rom_path = Path(rom_path)
        self.target_level = target_level
        self.emulator = emulator
        self.results = {
            'rom': str(self.rom_path),
            'target_level': f'0x{target_level:03X}',
            'emulator': emulator,
            'test_start': time.time(),
            'ram_samples': [],
            'screenshots': [],
            'statistics': {},
            'errors': []
        }
        
    def create_bizhawk_lua_script(self, screenshot_dir: Optional[Path] = None) -> str:
        """Create BizHawk Lua script for automated testing"""
        
        target_level_lo = self.target_level & 0xFF
        target_level_hi = (self.target_level >> 8) & 0x01
        
        screenshot_cmd = ''
        if screenshot_dir:
            screenshot_cmd = f'gui.savescreenshot("{screenshot_dir}/frame_" .. string.format("%06d", frame) .. ".png")'
        
        return f'''--[[
    SMW Headless Test Script for BizHawk
    Tests level {self.target_level:03X} (0x{self.target_level:03X})
    Target: Low={target_level_lo:02X}, High={target_level_hi}
]]

local frame = 0
local max_frames = 1800  -- 30 seconds at 60fps
local test_complete = false
local ram_samples = {{}}
local screenshots = {{}}

-- RAM addresses to sample
local RAM_ADDRESSES = {{
    {{addr=0x0100, name="game_mode"}},
    {{addr=0x13BF, name="level_low"}},
    {{addr=0x17BB, name="level_backup"}},
    {{addr=0x0E, name="level_0E"}},
    {{addr=0x0F, name="level_high"}},
    {{addr=0x1F11, name="submap"}},
    {{addr=0x19D8, name="level_flags"}},
}}

-- Read WRAM byte
function read_wram(addr)
    memory.usememorydomain("WRAM")
    return memory.readbyte(addr)
end

-- Sample RAM state
function sample_ram(frame_num)
    local sample = {{
        frame = frame_num,
        time = frame_num / 60.0,  -- Assume 60fps
        ram = {{}}
    }}
    
    for _, entry in ipairs(RAM_ADDRESSES) do
        sample.ram[entry.name] = read_wram(entry.addr)
    end
    
    -- Calculate full level ID
    local level_lo = sample.ram.level_low
    local level_hi_flags = sample.ram.level_flags
    local level_hi = level_hi_flags & 0x01
    local full_level = (level_hi * 256) + level_lo
    
    sample.ram.full_level_id = full_level
    sample.ram.game_mode_name = get_game_mode_name(sample.ram.game_mode)
    
    return sample
end

-- Get game mode name
function get_game_mode_name(mode)
    local modes = {{
        [0x00] = "TitleScreen",
        [0x01] = "Intro",
        [0x02] = "TitleScreen2",
        [0x03] = "TitleScreen3",
        [0x0E] = "Overworld",
        [0x0F] = "Overworld2",
        [0x10] = "OWtoLevel",
        [0x11] = "MarioStart",
        [0x14] = "InLevel",
    }}
    return modes[mode] or string.format("Unknown_0x%02X", mode)
end

-- Main test function
function run_test()
    frame = frame + 1
    
    -- Sample RAM every 60 frames (1 second)
    if frame % 60 == 0 then
        local sample = sample_ram(frame)
        table.insert(ram_samples, sample)
        
        -- Print status
        print(string.format("Frame %d: Mode=%s, Level=0x%03X, $13BF=0x%02X, $0F=0x%02X",
            frame, sample.ram.game_mode_name, sample.ram.full_level_id,
            sample.ram.level_low, sample.ram.level_high))
        
        -- Capture screenshot at key moments
        if screenshot_dir and (
            sample.ram.game_mode_name == "InLevel" or
            sample.ram.game_mode_name == "Overworld" or
            frame == 60 or frame == 120 or frame == 300
        ) then
            {screenshot_cmd}
            table.insert(screenshots, {{
                frame = frame,
                file = string.format("frame_%06d.png", frame)
            }})
        end
    end
    
    -- Input simulation
    local joypad_state = {{}}
    
    -- Press Start after 60 frames (skip title)
    if frame == 60 then
        joypad_state.Start = true
    elseif frame == 62 then
        joypad_state.Start = false
    -- Press Start again after 120 frames (enter game)
    elseif frame == 120 then
        joypad_state.Start = true
    elseif frame == 122 then
        joypad_state.Start = false
    -- After entering overworld, wait a bit then press Start to enter level
    elseif frame >= 300 and frame < 600 then
        local game_mode = read_wram(0x0100)
        if game_mode == 0x0E or game_mode == 0x0F then
            -- On overworld, press Start to enter level
            if frame == 300 then
                joypad_state.Start = true
            elseif frame == 302 then
                joypad_state.Start = false
            end
        end
    end
    
    joypad.set(1, joypad_state)
    
    -- Check if we're in the target level
    if frame >= 400 then
        local level_lo = read_wram(0x13BF)
        local level_hi_flags = read_wram(0x19D8)
        local level_hi = level_hi_flags & 0x01
        local full_level = (level_hi * 256) + level_lo
        
        if full_level == {self.target_level} then
            print(string.format("SUCCESS: Target level 0x%03X loaded at frame %d", {self.target_level}, frame))
            test_complete = true
            -- Sample one more time
            table.insert(ram_samples, sample_ram(frame))
            -- Wait a bit more to ensure level is fully loaded
            if frame >= 600 then
                emu.frameadvance()
                emu.frameadvance()
                emu.frameadvance()
                -- Final sample
                table.insert(ram_samples, sample_ram(frame + 3))
                -- Save results
                save_results()
                emu.exit()
            end
        end
    end
    
    -- Timeout check
    if frame >= max_frames then
        print(string.format("TIMEOUT: Did not reach target level after %d frames", max_frames))
        local last_sample = ram_samples[#ram_samples]
        if last_sample then
            print(string.format("Last level: 0x%03X, Mode: %s",
                last_sample.ram.full_level_id, last_sample.ram.game_mode_name))
        end
        save_results()
        emu.exit()
    end
    
    emu.frameadvance()
end

-- Save test results to JSON
function save_results()
    local results = {{
        target_level = {self.target_level},
        ram_samples = ram_samples,
        screenshots = screenshots,
        final_frame = frame,
        test_complete = test_complete
    }}
    
    local json_file = "{screenshot_dir or '.'}/test_results.json"
    local json_str = json.encode(results)
    
    local f = io.open(json_file, "w")
    if f then
        f:write(json_str)
        f:close()
        print("Results saved to: " .. json_file)
    else
        print("ERROR: Could not write results file")
    end
end

-- Register callback
event.onframeend(run_test)
print("SMW Headless Test Script loaded")
print("Target level: 0x" .. string.format("%03X", {self.target_level}))
print("Starting test...")
'''
    
    def run_bizhawk_test(self, screenshot_dir: Optional[Path] = None) -> Dict:
        """Run test using BizHawk emulator"""
        
        if not shutil.which(BIZHAWK_PATH):
            return {
                'success': False,
                'error': f'BizHawk not found. Set BIZHAWK_PATH env var or install BizHawk.'
            }
        
        # Create temporary Lua script
        with tempfile.NamedTemporaryFile(mode='w', suffix='.lua', delete=False) as f:
            lua_script = self.create_bizhawk_lua_script(screenshot_dir)
            f.write(lua_script)
            lua_file = f.name
        
        try:
            # Run BizHawk with Lua script
            # BizHawk command line: EmuHawk.exe --lua=script.lua rom.sfc
            cmd = [
                BIZHAWK_PATH,
                f'--lua={lua_file}',
                str(self.rom_path)
            ]
            
            print(f"Running BizHawk test...")
            print(f"  ROM: {self.rom_path}")
            print(f"  Target level: 0x{self.target_level:03X}")
            print(f"  Lua script: {lua_file}")
            if screenshot_dir:
                print(f"  Screenshots: {screenshot_dir}")
            print()
            
            # Run with timeout (30 seconds)
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=35
            )
            
            # Parse results JSON if it exists
            results_file = screenshot_dir / 'test_results.json' if screenshot_dir else Path('test_results.json')
            if results_file.exists():
                with open(results_file) as f:
                    test_data = json.load(f)
                    self.results.update(test_data)
            
            self.results['emulator_output'] = {
                'stdout': result.stdout,
                'stderr': result.stderr,
                'returncode': result.returncode
            }
            
            # Determine success
            if results_file.exists() and self.results.get('test_complete'):
                self.results['success'] = True
            else:
                self.results['success'] = False
                self.results['errors'].append('Test did not complete successfully')
            
            return self.results
            
        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'error': 'Test timed out after 35 seconds'
            }
        except Exception as e:
            return {
                'success': False,
                'error': f'Exception: {str(e)}'
            }
        finally:
            # Clean up Lua script
            try:
                os.unlink(lua_file)
            except:
                pass
    
    def run_retroarch_test(self, screenshot_dir: Optional[Path] = None) -> Dict:
        """Run test using RetroArch (headless mode)"""
        # RetroArch implementation would go here
        # Requires libretro core and different approach
        return {
            'success': False,
            'error': 'RetroArch testing not yet implemented'
        }
    
    def run_test(self, screenshot_dir: Optional[Path] = None) -> Dict:
        """Run the test with selected emulator"""
        
        if screenshot_dir:
            screenshot_dir = Path(screenshot_dir)
            screenshot_dir.mkdir(parents=True, exist_ok=True)
        
        if self.emulator == 'bizhawk':
            return self.run_bizhawk_test(screenshot_dir)
        elif self.emulator == 'retroarch':
            return self.run_retroarch_test(screenshot_dir)
        else:
            return {
                'success': False,
                'error': f'Unknown emulator: {self.emulator}'
            }
    
    def print_results(self):
        """Print formatted test results"""
        print("\n" + "="*60)
        print("TEST RESULTS")
        print("="*60)
        print(f"ROM: {self.results['rom']}")
        print(f"Target Level: {self.results['target_level']}")
        print(f"Emulator: {self.results['emulator']}")
        print()
        
        if self.results.get('success'):
            print("✓ TEST PASSED")
        else:
            print("✗ TEST FAILED")
            if self.results.get('errors'):
                for error in self.results['errors']:
                    print(f"  Error: {error}")
        print()
        
        # Show RAM samples
        if self.results.get('ram_samples'):
            print("RAM Samples:")
            print("-" * 60)
            for sample in self.results['ram_samples'][-5:]:  # Last 5 samples
                ram = sample.get('ram', {})
                print(f"Frame {sample.get('frame', 0):4d} ({sample.get('time', 0):.1f}s): "
                      f"Mode={ram.get('game_mode_name', '?')}, "
                      f"Level=0x{ram.get('full_level_id', 0):03X}, "
                      f"$13BF=0x{ram.get('level_low', 0):02X}, "
                      f"$0F=0x{ram.get('level_high', 0):02X}, "
                      f"Submap=0x{ram.get('submap', 0):02X}")
            print()
        
        # Show statistics
        if self.results.get('statistics'):
            print("Statistics:")
            for key, value in self.results['statistics'].items():
                print(f"  {key}: {value}")
            print()
        
        # Show screenshots
        if self.results.get('screenshots'):
            print(f"Screenshots captured: {len(self.results['screenshots'])}")
            for shot in self.results['screenshots'][:5]:  # First 5
                print(f"  Frame {shot.get('frame', 0)}: {shot.get('file', '?')}")
            print()


def main():
    parser = argparse.ArgumentParser(
        description='Headless automated testing for SMW ROM patches',
        epilog='Tests ROMs in headless emulator with simulated inputs and RAM sampling'
    )
    
    parser.add_argument('rom', help='ROM file to test')
    parser.add_argument('--target-level', type=lambda x: int(x, 0), required=True,
                       help='Target level to test (e.g., 0x106 or 262)')
    parser.add_argument('--emulator', choices=['bizhawk', 'retroarch', 'mesen'],
                       default='bizhawk',
                       help='Emulator to use (default: bizhawk)')
    parser.add_argument('--screenshot-dir', type=str,
                       help='Directory to save screenshots (default: no screenshots)')
    parser.add_argument('--output', type=str,
                       help='Output JSON file for results')
    parser.add_argument('--verbose', '-v', action='store_true',
                       help='Show detailed output')
    
    args = parser.parse_args()
    
    if not Path(args.rom).exists():
        print(f"Error: ROM not found: {args.rom}", file=sys.stderr)
        return 1
    
    # Create tester
    tester = HeadlessTester(args.rom, args.target_level, args.emulator)
    
    # Run test
    screenshot_dir = Path(args.screenshot_dir) if args.screenshot_dir else None
    results = tester.run_test(screenshot_dir)
    
    # Print results
    tester.print_results()
    
    # Save results to JSON if requested
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2)
        print(f"Results saved to: {args.output}")
    
    return 0 if results.get('success') else 1


if __name__ == '__main__':
    sys.exit(main())

