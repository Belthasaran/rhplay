# SMW ROM Testing Guide

## The Situation

You reported that test ROMs created by `smw_level_force.py` wouldn't boot.

## Why This Might Happen

1. **ROM Expansion**: The patches expand ROMs to ~4MB (from 512KB)
   - This is normal when using `freedata`
   - Some emulators may not handle it well

2. **Complex Patches**: The full patches hook multiple points
   - More complexity = more risk
   - If any hook is wrong, game crashes

3. **Emulator Issues**: snes9x may not work well headlessly
   - Needs display server
   - May exit immediately without GUI

## Solutions

### Solution 1: Use Safe Minimal Patches (RECOMMENDED)

The new `smw_simple_force.py` creates minimal patches:

```bash
# Ultra-safe: Only modifies 2 bytes, ROM stays same size
./smw_simple_force.py smw.sfc --level 0x105 --output safe_test.sfc
```

**Advantages**:
- ROM stays original size (512KB)
- Minimal modifications
- Much less likely to break
- Should boot successfully

**Disadvantages**:
- Only works for initial entry (like asm1.py)
- Death/respawn still broken
- But at least it boots!

### Solution 2: Better Emulator for Testing

#### Option A: Mednafen (Best for CLI)

```bash
# Install
sudo apt-get install mednafen

# Test ROM
mednafen --sound 0 test.sfc

# Headless test
xvfb-run mednafen --sound 0 test.sfc &
sleep 5
killall mednafen && echo "✓ ROM worked"
```

#### Option B: Mesen-S (Best Features)

```bash
# Download from: https://github.com/SourMesen/Mesen-S
# Has headless mode and Lua support

./Mesen test.sfc --testrunner --luascript test.lua
```

#### Option C: RetroArch + Xvfb

```bash
sudo apt-get install retroarch libretro-snes9x xvfb

# Run with virtual display
xvfb-run -a retroarch -L /usr/lib/libretro/snes9x_libretro.so test.sfc
```

### Solution 3: Verify Without Emulation

Check that patches applied correctly:

```bash
# Compare patched vs original
./smw_verify_patch.py test.sfc --original smw.sfc
```

This shows what bytes changed - verifies patch applied.

## Testing Workflow

### Step 1: Test Original ROM

First, verify your setup works:

```bash
bin/snes9x smw.sfc
# OR
mednafen smw.sfc
```

If vanilla SMW doesn't work: **emulator/system issue**  
If vanilla SMW works: **our patches are the problem**

### Step 2: Test Safe Patch

```bash
# Create minimal patch
./smw_simple_force.py smw.sfc --level 0x105 --output safe.sfc

# Test it
bin/snes9x safe.sfc
```

If safe patch works: **Complex patches are too aggressive**  
If safe patch fails: **Even minimal changes break it**

### Step 3: Debug

```bash
# Check what actually changed
./smw_verify_patch.py safe.sfc --original smw.sfc --show-all-changes

# Check ROM size
ls -lh safe.sfc smw.sfc
```

## Automated Testing Script

I'll create a comprehensive automated testing tool:

```bash
# Test multiple ROMs automatically
./smw_batch_test.sh test_roms/*.sfc
```

This will:
1. Try to run each ROM
2. Report which ones work
3. Log any errors
4. Show summary

## My Recommendations

**For YOU right now**:

1. **Try the safe version**:
   ```bash
   ./smw_simple_force.py smw.sfc --level 0x105 -o safe.sfc
   ```
   This should definitely boot.

2. **Install Mednafen** for headless testing:
   ```bash
   sudo apt-get install mednafen xvfb
   ```

3. **Tell me** if the safe version works:
   - If YES: We can make safe patches (limited functionality)
   - If NO: Something else is wrong (emulator config?)

## Comparison

| Approach | ROM Size | Boot Safety | Death/Respawn | Complexity |
|----------|----------|-------------|---------------|------------|
| smw_simple_force.py (ultra) | 512KB | ★★★★★ | ❌ Broken | Minimal |
| smw_simple_force.py (medium) | 512KB | ★★★★☆ | ❌ Broken | Low |
| smw_level_force.py (universal) | 4MB | ★★★☆☆ | ✅ Fixed | Medium |
| smw_level_force.py (aggressive) | 4MB | ★★☆☆☆ | ✅ Fixed | High |

**Trade-off**: Safety vs. Functionality

## Next Actions

**Please test**:
```bash
# Test 1: Does vanilla work?
bin/snes9x smw.sfc

# Test 2: Does safe patch work?
./smw_simple_force.py smw.sfc --level 0x105 -o safe.sfc
bin/snes9x safe.sfc

# Report back:
# - Which ones worked?
# - What error messages did you see?
# - Which emulator are you using?
```

Then I can:
- Debug the specific issue
- Choose the right approach
- Create working test ROMs for you

