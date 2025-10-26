# SMW Overworld Character Encoding

## Overview

Super Mario World stores level names on the overworld using a simple offset-based character encoding, not ASCII or any standard text format.

## Character Map

### Standard Vanilla SMW Encoding

| Hex Value | Character | Hex Value | Character | Hex Value | Character |
|-----------|-----------|-----------|-----------|-----------|-----------|
| 0x00 | A | 0x09 | J | 0x12 | S |
| 0x01 | B | 0x0A | K | 0x13 | T |
| 0x02 | C | 0x0B | L | 0x14 | U |
| 0x03 | D | 0x0C | M | 0x15 | V |
| 0x04 | E | 0x0D | N | 0x16 | W |
| 0x05 | F | 0x0E | O | 0x17 | X |
| 0x06 | G | 0x0F | P | 0x18 | Y |
| 0x07 | H | 0x10 | Q | 0x19 | Z |
| 0x08 | I | 0x11 | R | 0x1F | (space) |

### Special Characters

| Hex Value | Character | Usage |
|-----------|-----------|-------|
| 0x1A | ! | Exclamation |
| 0x1B | ? | Question mark |
| 0x1C | . | Period |
| 0x1D | , | Comma |
| 0x1E | ' | Apostrophe |

### Level Numbers

| Hex Value | Character | Usage |
|-----------|-----------|-------|
| 0x64 | 1 | Level number tiles |
| 0x65 | 2 | Level number tiles |
| 0x66 | 3 | Level number tiles |
| 0x67 | 4 | Level number tiles |
| 0x68 | 5 | Level number tiles |
| 0x69 | 6 | Level number tiles |
| 0x6A | 7 | Level number tiles |
| 0x6B | 8 | Level number tiles |
| 0x6C | 9 | Level number tiles |

### Boss Castle Graphics

| Hex Value | Character | Usage |
|-----------|-----------|-------|
| 0x5A | ( | Opening parenthesis/circle |
| 0x5B | ) | Closing parenthesis/circle |
| 0x5D | ' | Boss number indicator |

These are used for castle names like "(2 MORTON'S CASTLE"

## Example Decoding

### Raw Tile Data
```
15 00 0D 08 0B 0B 00 1F 12 04 02 11 04 13 1F 65
```

### Decoded String
```
V  A  N  I  L  L  A     S  E  C  R  E  T     2
15 00 0D 08 0B 0B 00 1F 12 04 02 11 04 13 1F 65
```

**Result**: "VANILLA SECRET 2"

## Important Notes

### 1. GFX-Dependent Encoding

The encoding shown above is for **vanilla SMW** and most vanilla-based hacks. However:

- **Custom hacks may use different GFX files** with completely different character mappings
- The tile numbers are SNES tile indices that reference loaded graphics
- Without knowing the exact GFX files, decoding is approximate

### 2. Unknown Tiles

When you see output like `[38]`, `[39]`, `[3A]` in the level name tool:

- These are tiles not in the standard character map
- Usually special graphics (stars, icons, boss numbers in circles)
- May vary between different ROM hacks

### 3. No Lowercase Support

Vanilla SMW level names use **UPPERCASE ONLY**. Some custom hacks may add lowercase support by:
- Using different tile mappings
- Loading custom font GFX
- These will show as hex codes unless the tool is updated

## Comparison with ASCII

**This is NOT ASCII!** Common mistake:

| SMW Tile | SMW Char | ASCII Value | ASCII Char |
|----------|----------|-------------|------------|
| 0x00 | A | 0x41 | A |
| 0x20 | (undefined) | 0x20 | (space) |
| 0x41 | (undefined) | 0x41 | A |

The SMW encoding is a **simple 0-based offset** where A=0x00, B=0x01, etc.

## Tool Implementation

The `smw_level_names.py` tool uses this character map:

```python
SNES_CHARSET = {
    # Uppercase letters A-Z
    0x00: 'A', 0x01: 'B', 0x02: 'C', 0x03: 'D', 0x04: 'E', 0x05: 'F',
    0x06: 'G', 0x07: 'H', 0x08: 'I', 0x09: 'J', 0x0A: 'K', 0x0B: 'L',
    0x0C: 'M', 0x0D: 'N', 0x0E: 'O', 0x0F: 'P', 0x10: 'Q', 0x11: 'R',
    0x12: 'S', 0x13: 'T', 0x14: 'U', 0x15: 'V', 0x16: 'W', 0x17: 'X',
    0x18: 'Y', 0x19: 'Z',
    # Space
    0x1F: ' ',
    # Numbers (level indicators)
    0x64: '1', 0x65: '2', 0x66: '3', 0x67: '4', 0x68: '5',
    0x69: '6', 0x6A: '7', 0x6B: '8', 0x6C: '9',
    # ... additional special characters ...
}
```

## Common Level Names in Vanilla SMW

| Index | Decoded Name | Notes |
|-------|--------------|-------|
| 1 | VANILLA SECRET 2 | Uses 0x65 for "2" |
| 4 | DONUT GHOST HOUSE | All uppercase |
| 7 | (2 MORTON'S CASTLE | (2 is boss number graphic |
| 8 | GREEN SWITCH PALACE | Standard text |
| 12 | BUTTER BRIDGE 1 | Uses 0x64 for "1" |
| 14 | (4 LUDWIG'S CASTLE | (4 is boss number graphic |

## Verification

You can verify the encoding by:

```bash
# Show raw tile values
./smw_level_names.py rom/hack.sfc --list --raw

# Compare with decoded output
./smw_level_names.py rom/hack.sfc --list
```

## References

- **Tool**: `smw_level_names.py`
- **ROM Structure**: `devdocs/SMW_ROM_STRUCTURE.md`
- **Analysis Summary**: `devdocs/LUNAR_MAGIC_ANALYSIS_SUMMARY.md`

## Historical Note

Early version of the tool used an incorrect character map (attempting ASCII-like mapping), which resulted in garbled output. The current version uses the empirically verified SMW encoding.

