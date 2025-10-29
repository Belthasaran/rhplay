#!/usr/bin/env python3
"""
Analyze and refine tile mapping for level names
Helps identify which tile values map to which characters
"""

import sys
from collections import Counter

DEFAULT_TILE_MAP = {
    0x00: 'A', 0x01: 'B', 0x02: 'C', 0x03: 'D', 0x04: 'E', 0x05: 'F',
    0x06: 'G', 0x07: 'H', 0x08: 'I', 0x09: 'J', 0x0A: 'K', 0x0B: 'L',
    0x0C: 'M', 0x0D: 'N', 0x0E: 'O', 0x0F: 'P', 0x10: 'Q', 0x11: 'R',
    0x12: 'S', 0x13: 'T', 0x14: 'U', 0x15: 'V', 0x16: 'W', 0x17: 'X',
    0x18: 'Y', 0x19: 'Z', 0x1A: 'a', 0x1B: 'b', 0x1C: 'c', 0x1D: 'd',
    0x1E: 'e', 0x1F: 'f', 0x20: 'g', 0x21: 'h', 0x22: 'i', 0x23: 'j',
    0x24: 'k', 0x25: 'l', 0x26: 'm', 0x27: 'n', 0x28: 'o', 0x29: 'p',
    0x2A: 'q', 0x2B: 'r', 0x2C: 'c', 0x2D: 's', 0x2E: 't', 0x2F: 'u',
    0x30: 'v', 0x31: 'w', 0x32: 'x', 0x33: 'y', 0x34: 'z', 0x35: '!',
    0x36: '?', 0x37: '.', 0x38: ',', 0x39: '0', 0x3A: '1', 0x3B: '2',
    0x3C: '3', 0x3D: '4', 0x3E: '5', 0x3F: '6', 0x40: '7', 0x41: '8',
    0x42: '9', 0x43: '#', 0x44: '-', 0x45: '(', 0x46: ')', 0x47: "'",
    0x48: '/', 0x49: ':', 0xFC: ' '
}

def analyze_tile_bytes(rom_data, offset, num_names=50):
    """Analyze tile bytes in level name data"""
    
    print(f"Analyzing {num_names} level names at ROM offset ${offset:06X}\n")
    
    # Extract all tile bytes
    all_bytes = []
    samples = []
    
    for i in range(num_names):
        chunk_offset = offset + (i * 19)
        chunk = rom_data[chunk_offset:chunk_offset+19]
        all_bytes.extend(chunk)
        samples.append((i, chunk))
    
    # Count byte frequency
    byte_freq = Counter(all_bytes)
    
    print("=" * 80)
    print("TILE BYTE FREQUENCY ANALYSIS")
    print("=" * 80)
    print("\nMost common tile bytes (top 40):")
    print(f"{'Hex':>6s} {'Dec':>5s} {'Count':>6s} {'%':>6s}  {'Current Map':20s} {'Visual'}")
    print("-" * 80)
    
    for byte_val, count in sorted(byte_freq.items(), key=lambda x: x[1], reverse=True)[:40]:
        pct = (count / len(all_bytes)) * 100
        current_map = DEFAULT_TILE_MAP.get(byte_val, '???')
        visual = chr(byte_val) if 32 <= byte_val < 127 else '·'
        print(f"${byte_val:02X}   {byte_val:3d}   {count:5d}   {pct:5.1f}%  {current_map:20s} [{visual}]")
    
    print("\n" + "=" * 80)
    print("SAMPLE LEVEL NAMES (RAW BYTES)")
    print("=" * 80)
    
    for i in range(min(20, num_names)):
        level_idx, chunk = samples[i]
        hex_str = ' '.join(f'{b:02X}' for b in chunk)
        decoded = ''.join(DEFAULT_TILE_MAP.get(b, f'[{b:02X}]') for b in chunk)
        print(f"\nLevel {level_idx:3d}: {hex_str}")
        print(f"           Decoded: {decoded}")
    
    print("\n" + "=" * 80)
    print("UNMAPPED TILE ANALYSIS")
    print("=" * 80)
    
    # Find bytes that aren't in the mapping
    unmapped = sorted([b for b in byte_freq.keys() if b not in DEFAULT_TILE_MAP and b != 0xFC])
    
    if unmapped:
        print(f"\nFound {len(unmapped)} tile bytes not in standard mapping:")
        for byte_val in unmapped[:20]:
            count = byte_freq[byte_val]
            pct = (count / len(all_bytes)) * 100
            print(f"  ${byte_val:02X} ({byte_val:3d}): appears {count:4d} times ({pct:5.1f}%)")
    else:
        print("\nAll tile bytes are in the standard mapping")
    
    # Analyze patterns
    print("\n" + "=" * 80)
    print("PATTERN ANALYSIS")
    print("=" * 80)
    
    # Check for common patterns that might indicate character mappings
    print("\nLooking for repeated patterns (might indicate words):")
    
    # Extract 3-byte sequences
    sequences = {}
    for i in range(len(all_bytes) - 2):
        seq = tuple(all_bytes[i:i+3])
        if seq not in sequences:
            sequences[seq] = 0
        sequences[seq] += 1
    
    common_seqs = sorted(sequences.items(), key=lambda x: x[1], reverse=True)[:10]
    for seq, count in common_seqs:
        if count > 2:
            decoded = ''.join(DEFAULT_TILE_MAP.get(b, f'?') for b in seq)
            print(f"  {seq}: {decoded} (appears {count} times)")
    
    return byte_freq, samples

def suggest_corrections(byte_freq, samples):
    """Suggest corrections to tile mapping based on analysis"""
    
    print("\n" + "=" * 80)
    print("SUGGESTED MAPPING CORRECTIONS")
    print("=" * 80)
    
    suggestions = []
    
    # Most common unmapped byte is likely space (if 0xFC is not most common)
    sorted_bytes = sorted(byte_freq.items(), key=lambda x: x[1], reverse=True)
    
    # Check if there's a more common byte than 0xFC
    most_common = sorted_bytes[0][0]
    if most_common != 0xFC and most_common not in DEFAULT_TILE_MAP:
        suggestions.append((most_common, ' ', 'space', 'Most common byte, likely space'))
    
    # Common unmapped bytes might be letters
    # Bytes in range 0x4A-0x7F are unused in standard mapping
    # These might map to lowercase letters, numbers, or special chars
    
    unmapped_common = [b for b, count in sorted_bytes 
                       if b not in DEFAULT_TILE_MAP and b != 0xFC and count > 10]
    
    if suggestions:
        print("\nHigh confidence suggestions:")
        for byte_val, char, name, reason in suggestions:
            print(f"  ${byte_val:02X} -> '{char}' ({name}): {reason}")
    
    if unmapped_common:
        print(f"\nCommon unmapped bytes that need investigation:")
        for byte_val in unmapped_common[:10]:
            count = byte_freq[byte_val]
            pct = (count / sum(byte_freq.values())) * 100
            print(f"  ${byte_val:02X}: {count:4d} occurrences ({pct:5.1f}%)")
    
    # Suggest checking samples
    print("\nRecommendations:")
    print("1. Compare decoded level names with in-game screenshots if available")
    print("2. Look for partial words (might help identify missing mappings)")
    print("3. Check if unmapped bytes follow patterns (e.g., sequential for A-Z)")
    print("4. Test extraction with different ROM hex editors to see actual graphics")

def main():
    if len(sys.argv) < 3:
        print("Usage: python analyze_tile_mapping.py <rom_file> <offset_hex>")
        print("Example: python analyze_tile_mapping.py Invictus_1.1.sfc 3DE1F6")
        sys.exit(1)
    
    rom_path = sys.argv[1]
    offset = int(sys.argv[2], 16)
    
    with open(rom_path, 'rb') as f:
        rom_data = bytearray(f.read())
    
    byte_freq, samples = analyze_tile_bytes(rom_data, offset)
    suggest_corrections(byte_freq, samples)
    
    print("\n" + "=" * 80)
    print("ANALYSIS COMPLETE")
    print("=" * 80)

if __name__ == '__main__':
    main()

