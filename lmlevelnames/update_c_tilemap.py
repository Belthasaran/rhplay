#!/usr/bin/env python3
"""
Generate default_tile_map.h from a hardcoded DEFAULT_TILE_MAP.

Edit DEFAULT_TILE_MAP below, then run:
  python update_c_tilemap.py

This regenerates default_tile_map.h in the same directory.
"""

from pathlib import Path
from datetime import datetime


# Hardcoded tile -> glyph mapping copied from q.py
# Note: any string with length != 1 (e.g., "\\20") is treated as unmapped in C.
DEFAULT_TILE_MAP = {
    # Row 1: A-P (0x00-0x0F)
    0x00: 'A', 0x01: 'B', 0x02: 'C', 0x03: 'D', 0x04: 'E', 0x05: 'F',
    0x06: 'G', 0x07: 'H', 0x08: 'I', 0x09: 'J', 0x0A: 'K', 0x0B: 'L',
    0x0C: 'M', 0x0D: 'N', 0x0E: 'O', 0x0F: 'P',

    # Row 2: Q-Z, punctuation (0x10-0x1F)
    0x10: 'Q', 0x11: 'R', 0x12: 'S', 0x13: 'T', 0x14: 'U', 0x15: 'V',
    0x16: 'W', 0x17: 'X', 0x18: 'Y', 0x19: 'Z', 0x1A: '!', 0x1B: '.',
    0x1C: '-', 0x1D: ',', 0x1E: '?', 0x1F: ' ',

    # Row 3: Special characters (0x20-0x2F) - escape codes (treated unmapped in C)
    0x20: '\\20', 0x21: '\\21', 0x22: '\\22', 0x23: '\\23', 0x24: '\\24',
    0x25: '\\25', 0x26: '\\26', 0x27: '\\27', 0x28: '\\28', 0x29: '\\29',
    0x2A: '\\2A', 0x2B: '\\2B', 0x2C: '\\2C', 0x2D: '\\2D', 0x2E: '\\2E', 0x2F: '\\2F',

    # Row 4: Special characters (0x30-0x3F)
    0x30: '\\30', 0x31: '\\31', 0x32: 'I', 0x33: 'L', 0x34: 'L', 0x35: 'U',
    0x36: 'S', 0x37: 'I', 0x38: 'Y', 0x39: 'E', 0x3A: 'L', 0x3B: 'O',
    0x3C: 'W', 0x3D: '?', 0x3E: '\\3E', 0x3F: '!',

    # Row 5: lowercase a-p (0x40-0x4F)
    0x40: 'a', 0x41: 'b', 0x42: 'c', 0x43: 'd', 0x44: 'e', 0x45: 'f',
    0x46: 'g', 0x47: 'h', 0x48: 'i', 0x49: 'j', 0x4A: 'k', 0x4B: 'l',
    0x4C: 'm', 0x4D: 'n', 0x4E: 'o', 0x4F: 'p',

    # Row 6: lowercase q-z, special characters (0x50-0x5F)
    0x50: 'q', 0x51: 'r', 0x52: 's', 0x53: 't', 0x54: 'u', 0x55: 'v',
    0x56: 'w', 0x57: 'x', 0x58: 'y', 0x59: 'z', 0x5A: '#', 0x5B: '(',
    0x5C: ')', 0x5D: "'", 0x5E: '\\5E', 0x5F: '\\5F',

    # Row 7: Numbers and special (0x60-0x6F)
    0x60: '\\60', 0x61: '\\61', 0x62: '\\62', 0x63: '1', 0x64: '2',
    0x65: '3', 0x66: '4', 0x67: '5', 0x68: '6', 0x69: '7', 0x6A: '8',
    0x6B: '9', 0x6C: '0', 0x6D: '\\6D', 0x6E: '\\6E', 0x6F: '\\6F',

    # Row 8: Special graphics (0x70-0x7F) - treated unmapped in C
    0x70: '\\70', 0x71: '\\71', 0x72: '\\72', 0x73: '\\73', 0x74: '\\74',
    0x75: '\\75', 0x76: '\\76', 0x77: '\\77', 0x78: '\\78', 0x79: '\\79',
    0x7A: '\\7A', 0x7B: '\\7B', 0x7C: '\\7C', 0x7D: '\\7D', 0x7E: '\\7E', 0x7F: '\\7F',
}


def _c_char_literal(byte_val: int) -> str:
    """Return C char literal for given ASCII byte (e.g., 39 -> '\\'\'' )."""
    if byte_val == 39:  # '\''
        return "'\\\''"
    if byte_val == 92:  # '\\'
        return "'\\\\'"
    # printable ASCII
    ch = chr(byte_val)
    if 32 <= byte_val <= 126 and ch not in {'\\', "'"}:
        return f"'{ch}'"
    # non-printable -> 0
    return '0'


def build_tables():
    # Forward: 256 entries default 0 (unmapped)
    forward = [0] * 256
    for tile, glyph in DEFAULT_TILE_MAP.items():
        if isinstance(glyph, str) and len(glyph) == 1:
            forward[tile] = ord(glyph)
        else:
            # escape codes and multi-char tokens are not representable -> 0
            forward[tile] = 0

    # Reverse: ASCII -> first tile code (0xFF if absent)
    reverse = [0xFF] * 256
    for tile_code in range(256):
        ascii_byte = forward[tile_code]
        if ascii_byte != 0 and reverse[ascii_byte] == 0xFF:
            reverse[ascii_byte] = tile_code

    return forward, reverse


def format_array_16_per_row(values, formatter, start_label_hex: int) -> str:
    lines = []
    for i in range(0, 256, 16):
        row = values[i:i + 16]
        label = f"/* 0x{(start_label_hex + i):02X}-0x{(start_label_hex + i + 15):02X} */"
        rendered = ",".join(formatter(v) for v in row)
        lines.append(f"    {label} {rendered},")
    return "\n".join(lines)


def generate_header(forward, reverse) -> str:
    timestamp = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%SZ')
    forward_rows = format_array_16_per_row(
        forward,
        lambda v: _c_char_literal(v) if v != 0 else '0',
        0x00,
    )
    reverse_rows = format_array_16_per_row(
        reverse,
        lambda v: f"0x{v:02X}",
        0x00,
    )
    return (
        "// Auto-generated from update_c_tilemap.py\n"
        f"// Generated: {timestamp}\n"
        "// Forward: TILE_TO_ASCII[0x00..0xFF] -> ASCII byte (0 if unmapped)\n"
        "// Reverse: ASCII_TO_TILE[0x00..0xFF] -> preferred tile code (0xFF if unmapped)\n"
        "// Note: Multiple tile codes may map to the same ASCII; reverse table picks the first.\n\n"
        "#ifndef DEFAULT_TILE_MAP_H\n"
        "#define DEFAULT_TILE_MAP_H\n\n"
        "#include <stdint.h>\n\n"
        "static const uint8_t TILE_TO_ASCII[256] = {\n"
        f"{forward_rows}\n"
        "};\n\n"
        "static const uint8_t ASCII_TO_TILE[256] = {\n"
        f"{reverse_rows}\n"
        "};\n\n"
        "static inline uint8_t tile_to_ascii_byte(uint8_t tileCode) {\n"
        "    return TILE_TO_ASCII[tileCode];\n"
        "}\n\n"
        "static inline uint8_t ascii_byte_to_tile(uint8_t asciiByte) {\n"
        "    return ASCII_TO_TILE[asciiByte];\n"
        "}\n\n"
        "#endif // DEFAULT_TILE_MAP_H\n"
    )


def main():
    forward, reverse = build_tables()
    header = generate_header(forward, reverse)
    out_path = Path(__file__).with_name('default_tile_map.h')
    out_path.write_text(header, encoding='utf-8')
    print(f"Wrote {out_path.name} ({len(header)} bytes)")


if __name__ == '__main__':
    main()



