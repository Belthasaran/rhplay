# Debugging SMW Patch Issues

## The Problem

You reported: "I tried several, but the game wouldn't even start"

## Possible Causes

### 1. ROM Size Expansion

The patched ROMs are **4MB** (original was 512KB). This is **NORMAL** when using asar's `freedata`:
- asar adds custom code to the end of ROM
- Expands ROM to fit the code
- Should still work in emulators

### 2. Hook Point Issues

The patches hook at:
- `$05D796` - Main level load
- `$00A635` - Level init

These are deep in the game code. If hooks are wrong, game crashes immediately.

### 3. Emulator Compatibility

Some emulators don't like:
- Expanded ROMs
- Modified code sections
- Headless mode

## Testing Approaches

### Option A: Mednafen (Best for Headless)

**Mednafen** has excellent command-line support:

```bash
# Install mednafen
sudo apt-get install mednafen

# Test a ROM headlessly
mednafen -sound 0 -video.fs 0 test.sfc &
sleep 5
killall mednafen

# If it ran for 5 seconds, ROM works!
```

### Option B: Xvfb + snes9x (Virtual Display)

Run snes9x with a virtual framebuffer:

```bash
# Install xvfb
sudo apt-get install xvfb

# Run snes9x in virtual display
xvfb-run -a bin/snes9x test.sfc &
sleep 5
killall snes9x

# ROM works if process doesn't crash immediately
```

### Option C: RetroArch (Headless Mode)

RetroArch has a headless mode built-in:

```bash
# Install retroarch
sudo apt-get install retroarch libretro-snes9x

# Run headlessly
retroarch -L /usr/lib/libretro/snes9x_libretro.so test.sfc --verbose &
```

### Option D: Verify Patches Without Emulation

Check that patches applied correctly by examining the ROM bytes:

```bash
./smw_verify_patch.py test.sfc --original original.sfc
```

## Recommended Testing Strategy

1. **First**: Verify patch applied
   ```bash
   ./smw_verify_patch.py test_roms/test_force_105.sfc --original smw.sfc
   ```

2. **Then**: Test with Mednafen (if available)
   ```bash
   mednafen test_roms/test_force_105.sfc
   ```

3. **Or**: Use Xvfb with snes9x
   ```bash
   xvfb-run bin/snes9x test_roms/test_force_105.sfc
   ```

## Debugging the Patches

### Test 1: Minimal Patch

Try the absolute minimum patch (just skip intro):

```bash
# Create minimal test
cp smw.sfc test_minimal.sfc

# Apply only intro skip
echo 'lorom
org $009CB1
    db $00' > minimal.asm

bin/asar minimal.asm test_minimal.sfc

# Test it
# If this doesn't work, asar or ROM has issues
# If this DOES work, our complex patches have issues
```

### Test 2: Check asar Output

```bash
# Run asar with verbose output
bin/asar -v test_simple_patch.asm test.sfc
```

Look for:
- Warnings about overwrites
- Errors about invalid addresses
- Info about where code was placed

### Test 3: Compare Bytes

```bash
# Check if bytes actually changed
hexdump -C test_minimal.sfc | grep "01cb" -A 2
hexdump -C smw.sfc | grep "01cb" -A 2
```

## Why ROMs Might Not Start

### Possible Reason 1: Wrong Hook Points

If we hook at the wrong address or overwrite critical code:
- Game crashes immediately
- Black screen
- Freeze at Nintendo logo

**Solution**: Verify hook addresses are correct

### Possible Reason 2: Code Crashes

Our custom ASM code might:
- Have bugs
- Corrupt registers
- Break stack
- Infinite loop

**Solution**: Simplify patches, test incrementally

### Possible Reason 3: Freedata Placement

asar's `freedata` puts code somewhere in ROM. If it:
- Overwrites existing data
- Places code in wrong bank
- Conflicts with ROM structure

**Solution**: Use `org $XXX` instead of `freedata`

## Immediate Actions

### 1. Test if Original ROMs Work

```bash
# Does vanilla SMW work?
bin/snes9x smw.sfc

# Does an unpatched sample ROM work?
bin/snes9x refmaterial/samplerom/4964_*.sfc
```

If NO: Emulator or system issue  
If YES: Our patches are breaking ROMs

### 2. Test Minimal Patch

```bash
# Just skip intro, nothing else
./smw_level_force.py smw.sfc --level 0x000 --output test_level_000.sfc

# Does it work?
bin/snes9x test_level_000.sfc
```

If NO: Even simple patches break it  
If YES: Complex patches are the problem

### 3. Check asar Version

```bash
bin/asar --version

# Some asar versions have bugs
# Try version 1.81 or 1.90+
```

## Alternative: Don't Patch, Use RAM

Instead of patching ROM, use emulator features:

### With Mesen-S (has Lua support)

```lua
-- Set level in RAM every frame
function force_level()
    memory.write(0x7E13BF, 0x05)  -- Level 0x105
    memory.write(0x7E17BB, 0x05)
end

emu.addEventCallback(force_level, emu.eventType.startFrame)
```

### With BizHawk (TAS tool, excellent automation)

BizHawk is DESIGNED for automated testing:
- Full Lua scripting
- Memory watch
- Can run headless
- TAStudio for frame-by-frame

```bash
# Install BizHawk, then:
EmuHawk --lua=force_level.lua rom.sfc
```

## My Recommendation

**For automated testing**: Install **Mednafen** or **Mesen-S**

**Mednafen**:
```bash
sudo apt-get install mednafen
mednafen --sound 0 test.sfc  # Boots, press ESC to quit
```

**Mesen-S** (more features):
```bash
# Download from https://github.com/SourMesen/Mesen-S
# Has Lua support, debugging, headless mode
./mesen test.sfc --testrunner
```

## Next Steps

**Tell me**:
1. Can you run vanilla `smw.sfc` in your emulator successfully?
2. Which emulator are you using (snes9x-gtk, bsnes, other)?
3. Do the test ROMs show any error messages?
4. Should I switch to a RAM-modification approach instead of ROM patching?

**Or I can**:
1. Install and configure Mednafen for automated testing
2. Create a simpler patch that's less likely to break
3. Use BizHawk/Mesen-S with Lua scripting instead
4. Debug why the current patches aren't working for you

Let me know which direction you'd prefer!

