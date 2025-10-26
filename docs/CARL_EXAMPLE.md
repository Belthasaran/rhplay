# CARL Module System - Example Usage

## What is CARL?

CARL (Code Assembly Runtime Loader) allows you to load ASM code modules into a running SMW game without restarting. Modules are called once per frame after VBlank.

## ⚠️ IMPORTANT: ROM Patch Required

**Before using CARL, you MUST patch your SMW ROM:**

1. Apply the CARL hook patch to your ROM:
   ```bash
   asar docs/CARL_ROM_PATCH.asm your_smw_rom.sfc
   ```

2. Upload the patched ROM to your SNES

3. Boot the patched ROM

Without this patch, loaded modules will not execute! The patch adds an NMI hook that calls `$7F8200` every frame, which is where RHTools places the module caller code.

## Basic Example: Moon Jump

**Important**: Upload the ASM file to `/work/carl/moonjump.asm` on your USB2SNES device first.

The file contents:

```asm
; Moon Jump - Hold B to slowly rise

; Check if already initialized
LDA $7F8000      ; Init flag for first module
BNE +
  ; First call - set up
  LDA #$01
  STA $7F8000    ; Mark as initialized
+

; Main logic - runs every frame
LDA $15          ; Controller 1 data
AND #$80         ; Check B button
BEQ +
  ; B is held - apply upward velocity
  LDA #$F8       ; Negative velocity (upward)
  STA $7E007D    ; Mario Y velocity
+

RTL              ; MUST end with RTL
```

## Loading the Module

In the chat commands interface:

```
!load moonjump
```

Expected output:
```
✓ Module "moonjump" loaded (XX bytes at 0x7FA000)
```

## Unloading the Module

```
!unload moonjump
```

## Reloading (Update Code)

After editing the ASM file:

```
!reload moonjump
```

## Module Requirements

1. **Must end with RTL** (`$6B` opcode)
   - Modules are called with JSL, must return with RTL

2. **Register Sizes**
   - A, X, Y are in 8-bit mode on entry
   - Use REP/SEP if you need 16-bit mode

3. **Initialization**
   - First call has init flag = $00
   - Set flag to $01 after setup
   - Each module gets its own init flag at $7F8000+N

4. **Self-Unload**
   - Set A=$DE, X=$CO, Y=$DE before RTL
   - System will detect and unload the module

## Memory Map

```
$7FA000-$7FFFFF : Module code storage (24KB)
$7F8000-$7F80FF : Per-module init flags
$7F8100-$7F81FF : Module address table
$7F8200         : Frame hook caller (JSL chain)
$7F8300         : Frame hook injection point
```

## Advanced Example: P-Meter Lock

```asm
; Lock P-meter at max value

LDA $7F8000      ; Check init flag
BNE +
  LDA #$01
  STA $7F8000    ; Initialize
+

; Lock P-meter
LDA #$46         ; Max P-meter value
STA $7E13E4      ; P-meter address

RTL
```

## Advanced Example: Auto-Jump

```asm
; Automatically jump when on ground

LDA $7F8000
BNE +
  LDA #$01
  STA $7F8000
+

; Check if on ground
LDA $7E0072      ; Mario in-air flag
BNE +            ; Skip if in air

; On ground - jump!
LDA #$F0         ; Jump velocity
STA $7E007D      ; Y velocity

+
RTL
```

## Frame Hook Details

The system automatically generates a hook caller at $7F8200 that looks like:

```asm
JSL $7FA000      ; moonjump module
JSL $7FA0XX      ; second module (if loaded)
JSL $7FA0YY      ; third module (if loaded)
RTL
```

This hook caller is automatically updated when you load/unload modules.

**Note**: The actual VBlank/NMI hijack to call this hook is game-specific and must be set up manually. The CARL system provides the hook caller infrastructure.

## Troubleshooting

### "ASAR not configured"
- Go to Settings → Import ASAR executable
- Download ASAR from https://smwc.me/s/37443
- Select the executable file

### "Module does not end with RTL"
- Make sure your ASM code ends with `RTL` instruction
- ASAR syntax: just `RTL` on its own line

### "Not enough free RAM"
- Unload unused modules with `!unload`
- System has 24KB available for modules
- Check `!modules` to see loaded modules and memory usage

### "Failed to load file"
- Ensure file exists at `/work/carl/modulename.asm`
- File must be uploaded to USB2SNES device
- Check file permissions and path

## Best Practices

1. **Keep modules small** - They run every frame
2. **Use init flags** - Avoid redundant setup
3. **Test thoroughly** - Bad code can crash the game
4. **Comment your code** - Future you will thank you
5. **End with RTL** - Always, no exceptions

## Chat Commands Reference

| Command | Description |
|---------|-------------|
| `!load MODULE` | Load a module from `/work/carl/MODULE.asm` |
| `!unload MODULE` | Unload a module and free its RAM |
| `!reload MODULE` | Reload a module (unload + load) |
| `!modules` | List all loaded modules (TODO) |

## Technical Details

### Assembly Process

1. User's ASM source is wrapped:
   ```asm
   freedata
   JSL module
   module:
   [YOUR CODE HERE]
   ```

2. ASAR assembles into temp ROM

3. System compares assembled ROM vs blank ROM

4. Extracts changed bytes (the assembled code)

5. Strips JSL wrapper (first 4 bytes)

6. Uploads pure module code to SNES RAM

7. Updates frame hook to call new module

### Opcodes Used

- `JSL` = `$22` + 3-byte address (little-endian)
- `RTL` = `$6B`

### Address Conversion

ASAR uses LoROM addressing, which is converted to USB2SNES protocol:
- ROM banks map to SNES address space
- Code extracted as raw bytes
- Uploaded to WRAM (banks $7E/$7F)

