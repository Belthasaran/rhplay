#!/usr/bin/env python3
"""
SMW Text Finder - Search for SMW-encoded text anywhere in a ROM

Searches the entire ROM for text encoded in SMW's character format.
Useful for finding where data is stored when offsets are unknown.

Usage:
    smw_find_text.py <rom.sfc> --search "TEST LEVEL NAME"
    smw_find_text.py <rom.sfc> --scan-all
"""

import sys
import argparse
from pathlib import Path
from typing import List, Tuple

from smw_level_names import SNES_CHARSET


def text_to_smw_bytes(text: str) -> bytes:
    """Convert English text to SMW character encoding"""
    # Reverse lookup
    reverse_charset = {v: k for k, v in SNES_CHARSET.items()}
    
    result = []
    for char in text.upper():
        if char in reverse_charset:
            result.append(reverse_charset[char])
        elif char == ' ':
            result.append(0x1F)
        else:
            # Character not found
            result.append(0xFF)  # Placeholder
    
    return bytes(result)


def find_text_in_rom(rom_data: bytes, search_text: str, min_match: int = None) -> List[Tuple[int, str]]:
    """
    Search for SMW-encoded text in ROM.
    
    Returns list of (offset, matched_text) tuples.
    """
    # Convert search text to SMW encoding
    search_bytes = text_to_smw_bytes(search_text)
    
    # Remove any FF placeholders for partial matching
    if min_match is None:
        min_match = len([b for b in search_bytes if b != 0xFF])
    
    # Search for exact match
    exact_matches = []
    offset = 0
    
    while True:
        pos = rom_data.find(search_bytes, offset)
        if pos == -1:
            break
        exact_matches.append((pos, search_text))
        offset = pos + 1
    
    return exact_matches


def scan_for_readable_text(rom_data: bytes, min_length: int = 5, 
                           max_results: int = 100) -> List[Tuple[int, str]]:
    """
    Scan ROM for any readable SMW-encoded text.
    
    Returns list of (offset, decoded_text) tuples.
    """
    results = []
    
    # Scan with a sliding window
    for offset in range(len(rom_data) - min_length):
        # Try to decode a chunk
        chunk = rom_data[offset:offset + 30]
        
        # Decode
        decoded = ''
        letter_count = 0
        
        for b in chunk:
            if b in SNES_CHARSET:
                char = SNES_CHARSET[b]
                decoded += char
                if char.isalpha():
                    letter_count += 1
            elif b == 0x1F:  # Space
                decoded += ' '
            elif b & 0x80:  # End marker
                decoded += SNES_CHARSET.get(b & 0x7F, '')
                break
            else:
                break  # Non-text byte
        
        # If we found readable text
        if letter_count >= min_length and len(decoded) >= min_length:
            results.append((offset, decoded.strip()))
            
            # Skip ahead to avoid duplicates
            offset += len(decoded)
            
            if len(results) >= max_results:
                break
    
    return results


def main():
    parser = argparse.ArgumentParser(
        description='Search for SMW-encoded text in ROM files',
        epilog='Finds text encoded in SMW character format'
    )
    
    parser.add_argument('rom', help='ROM file to search')
    
    parser.add_argument('--search', metavar='TEXT',
                       help='Search for specific text')
    
    parser.add_argument('--scan-all', action='store_true',
                       help='Scan entire ROM for readable text')
    
    parser.add_argument('--min-length', type=int, default=5,
                       help='Minimum text length for --scan-all (default: 5)')
    
    parser.add_argument('--max-results', type=int, default=100,
                       help='Maximum results to show (default: 100)')
    
    args = parser.parse_args()
    
    if not Path(args.rom).exists():
        print(f"Error: ROM not found: {args.rom}", file=sys.stderr)
        return 1
    
    with open(args.rom, 'rb') as f:
        rom_data = f.read()
    
    print(f"Searching ROM: {Path(args.rom).name}")
    print(f"ROM size: {len(rom_data):,} bytes")
    print()
    
    if args.search:
        # Search for specific text
        matches = find_text_in_rom(rom_data, args.search)
        
        if matches:
            print(f"Found {len(matches)} occurrence(s) of '{args.search}':")
            for offset, text in matches:
                print(f"  0x{offset:06X}: {text}")
                
                # Show context
                context = rom_data[max(0, offset-10):offset+len(text)+10]
                print(f"    Context: {context.hex().upper()[:60]}")
        else:
            print(f"Text '{args.search}' not found in ROM")
    
    elif args.scan_all:
        # Scan for any readable text
        print(f"Scanning for readable text (min length: {args.min_length})...")
        print()
        
        results = scan_for_readable_text(rom_data, args.min_length, args.max_results)
        
        print(f"Found {len(results)} readable text strings:")
        print()
        
        for offset, text in results:
            if len(text) >= args.min_length:
                print(f"0x{offset:06X}: {text[:50]}")
    
    else:
        parser.print_help()
        return 1
    
    return 0


if __name__ == '__main__':
    sys.exit(main())

