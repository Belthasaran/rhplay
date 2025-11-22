# SMW Headless Automated Testing

## Overview

The `smw_headless_test.py` tool provides automated testing for SMW ROM patches in a headless emulator environment. It simulates player inputs, samples RAM at execution points, captures screenshots, and collects statistics to verify patches work correctly.

## Features

- **Headless Execution**: Runs emulator without GUI (suitable for CI/CD)
- **Input Simulation**: Automatically presses Start, navigates menus, enters levels
- **RAM Sampling**: Samples critical RAM addresses every second
- **Screenshot Capture**: Optional screenshot capture at key moments
- **JSON Results**: Exports test results to JSON for analysis
- **Multiple Emulators**: Supports BizHawk (recommended), RetroArch, Mesen-S

## Requirements

### BizHawk (Recommended)

BizHawk has the best Lua scripting support and is designed for automation:

```bash
# Download from: https://tasvideos.org/BizHawk
# Set environment variable:
export BIZHAWK_PATH=/path/to/EmuHawk
```

### Alternative: RetroArch

```bash
sudo apt-get install retroarch libretro-snes9x
export RETROARCH_PATH=retroarch
```

## Usage

### Basic Test

```bash
# Test if level 0x106 loads correctly
./pytools/smw_headless_test.py rom.sfc --target-level 0x106

# With screenshots
./pytools/smw_headless_test.py rom.sfc --target-level 0x106 --screenshot-dir screenshots

# Save results to JSON
./pytools/smw_headless_test.py rom.sfc --target-level 0x106 --output results.json
```

### Using Standalone Lua Script

You can also use the Lua script directly in BizHawk:

1. Open BizHawk and load your ROM
2. Tools > Lua Console
3. Load `luatools/smw_headless_test.lua`
4. Edit `TARGET_LEVEL` at the top of the script
5. Script runs automatically and saves `test_results.json`

## Test Process

The automated test performs these steps:

1. **Frame 60**: Press Start (skip title screen)
2. **Frame 120**: Press Start (enter game/overworld)
3. **Frame 300**: Press Start (enter level from overworld)
4. **Frame 400+**: Check if target level loaded
5. **Every 60 frames**: Sample RAM addresses
6. **On success/timeout**: Save results to JSON

## RAM Addresses Sampled

- `$0100`: Game mode
- `$13BF`: Level number (low byte)
- `$17BB`: Level backup
- `$0E`: Level-related value
- `$0F`: Level high byte
- `$1F11`: Submap number
- `$19D8`: Level flags (high byte bit)

## Output Format

Results are saved as JSON with:

```json
{
  "target_level": 262,
  "test_complete": true,
  "final_frame": 450,
  "ram_samples": [
    {
      "frame": 60,
      "time": 1.0,
      "ram": {
        "game_mode": 14,
        "game_mode_name": "InLevel",
        "level_low": 42,
        "full_level_id": 262,
        ...
      }
    }
  ],
  "screenshots": [...]
}
```

## Example Workflow

```bash
# 1. Apply patch to ROM
asar extrapatches/test5.asm rom.sfc patched.sfc

# 2. Run automated test
./pytools/smw_headless_test.py patched.sfc --target-level 0x106 --screenshot-dir test_screenshots

# 3. Check results
cat test_screenshots/test_results.json | jq '.test_complete'
```

## Troubleshooting

### BizHawk Not Found

```bash
# Set path explicitly
export BIZHAWK_PATH=/path/to/EmuHawk
./pytools/smw_headless_test.py rom.sfc --target-level 0x106
```

### Test Times Out

- Increase timeout in Lua script (`MAX_FRAMES`)
- Check if ROM boots manually first
- Verify target level is valid (0x000-0x1FF)

### No Screenshots

- Ensure `--screenshot-dir` directory exists and is writable
- BizHawk must have GUI enabled (even if headless, needs screenshot capability)

## Integration with CI/CD

```yaml
# Example GitHub Actions
- name: Test SMW Patch
  run: |
    export BIZHAWK_PATH=/usr/local/bin/EmuHawk
    ./pytools/smw_headless_test.py test_rom.sfc --target-level 0x106 --output results.json
    jq '.test_complete' results.json
```

## See Also

- `luatools/smw_headless_test.lua` - Standalone Lua script
- `pytools/smw_automated_test.py` - Simpler boot test
- `pytools/smw_test_rom_verify.py` - Basic ROM verification

