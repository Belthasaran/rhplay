#!/usr/bin/env python3
"""
SMW Level Name Extractor - Extract level names from Super Mario World ROM files

This tool extracts level names as they appear on the overworld in SMW.
Level names are stored in a chunk-based format and must be assembled.

Usage:
    smw_level_names.py --list <romfile.sfc>
    smw_level_names.py --export <romfile.sfc> --output names.json
    smw_level_names.py --level <level_id> <romfile.sfc>

For technical details, see devdocs/SMW_ROM_STRUCTURE.md
"""

import sys
import json
import argparse
from pathlib import Path
from typing import List, Dict, Optional
import struct

# ROM structure constants for level names
NAME_TILE_DATA_OFFSET = 0x21AC5      # 460 bytes of tile data (vanilla)
NAME_ASSEMBLY_INDEX_OFFSET = 0x220FC  # 186 bytes (93 entries × 2 bytes) (vanilla)
CHUNK_PTR_TABLE1_OFFSET = 0x21C91    # Variable size (vanilla)
CHUNK_PTR_TABLE2_OFFSET = 0x21CCF    # Variable size (vanilla)
CHUNK_PTR_TABLE3_OFFSET = 0x21CED    # Variable size (vanilla)
OW_NAME_POSITION_OFFSET = 0x21D22    # 2 bytes

MAX_LEVEL_NAMES = 93  # Maximum number of level name entries (vanilla)

# Lunar Magic relocated level names
LM_LEVEL_NAME_POINTER_OFFSET = 0x010FEB  # 3-byte pointer to LM name table (LM 2.40)
LM_ENTRY_SIZE = 24  # Fixed 24-byte entries
LM_LEVEL_OFFSET = 0xCA  # entry_index = level_id - 0xCA
LM_MAX_ENTRIES = 96  # LM supports 96 level names (0x60)

# Known LM table locations (version-specific, used as fallbacks)
# Order matters! Check more specific/newer locations first
LM_KNOWN_TABLE_LOCATIONS = [
    0x084E42,  # LM 3.61 (latest)
    0x084D3A,  # LM 2.53 (and possibly 2.50-2.59)
    0x085000,  # LM 2.40 (and possibly earlier versions)
]

# SMW overworld character encoding
# Standard vanilla SMW uses this encoding for level names
# Custom hacks may use different GFX, but this works for most vanilla-based hacks
SNES_CHARSET = {
    # Uppercase letters A-Z
    0x00: 'A', 0x01: 'B', 0x02: 'C', 0x03: 'D', 0x04: 'E', 0x05: 'F',
    0x06: 'G', 0x07: 'H', 0x08: 'I', 0x09: 'J', 0x0A: 'K', 0x0B: 'L',
    0x0C: 'M', 0x0D: 'N', 0x0E: 'O', 0x0F: 'P', 0x10: 'Q', 0x11: 'R',
    0x12: 'S', 0x13: 'T', 0x14: 'U', 0x15: 'V', 0x16: 'W', 0x17: 'X',
    0x18: 'Y', 0x19: 'Z',
    # Space
    0x1F: ' ',
    # Special characters (may vary by hack)
    0x1A: '!', 0x1B: '?', 0x1C: '.', 0x1D: ',', 0x1E: "'",
    # Numbers (these positions may vary)
    0x5A: '(', 0x5B: ')', 0x5C: '-', 0x5D: "'",  # Common in vanilla
    # Level number tiles  
    0x64: '1', 0x65: '2', 0x66: '3', 0x67: '4', 0x68: '5',
    0x69: '6', 0x6A: '7', 0x6B: '8', 0x6C: '9',
    # Alternate spaces
    0x9F: ' ', 0xFC: ' ',
}


class LevelNameExtractor:
    """Extracts level names from Super Mario World ROMs"""
    
    def __init__(self, rom_path: str):
        self.rom_path = Path(rom_path)
        self.rom_data = self._load_rom()
        self.header_offset = self._detect_header()
        self.lm_mode = self._detect_lunar_magic()
        self.lm_name_table_offset = None
        
        if self.lm_mode:
            self.lm_name_table_offset = self._get_lm_name_table_offset()
        
    def _load_rom(self) -> bytearray:
        """Load ROM file into memory"""
        if not self.rom_path.exists():
            raise FileNotFoundError(f"ROM file not found: {self.rom_path}")
        
        with open(self.rom_path, 'rb') as f:
            return bytearray(f.read())
    
    def _detect_header(self) -> int:
        """Detect if ROM has a 512-byte copier header"""
        file_size = len(self.rom_data)
        if (file_size % 1024) == 512:
            print(f"[INFO] Detected 512-byte header in {self.rom_path.name}", file=sys.stderr)
            return 512
        return 0
    
    def get_offset(self, base_offset: int) -> int:
        """Get actual file offset accounting for header"""
        return base_offset + self.header_offset
    
    def read_bytes(self, offset: int, length: int) -> bytes:
        """Read bytes from ROM at given offset"""
        actual_offset = self.get_offset(offset)
        if actual_offset + length > len(self.rom_data):
            raise ValueError(f"Read beyond ROM boundary: {actual_offset + length} > {len(self.rom_data)}")
        return bytes(self.rom_data[actual_offset:actual_offset + length])
    
    def read_uint16(self, offset: int) -> int:
        """Read 16-bit little-endian value"""
        data = self.read_bytes(offset, 2)
        return struct.unpack('<H', data)[0]
    
    def _detect_lunar_magic(self) -> bool:
        """Detect if ROM uses Lunar Magic's level name system"""
        # Try finding the LM level name table by scanning for it
        table_offset = self._find_lm_name_table()
        return table_offset is not None
    
    def _find_lm_name_table(self) -> Optional[int]:
        """
        Find LM's level name table by scanning for the data pattern.
        
        LM stores 96 level names in 24-byte fixed entries.
        We scan the expanded ROM area (0x080000+) for this pattern.
        
        NOTE: LM 2.5+ keeps both old and new tables. We need to find
        the one that actually differs from vanilla (has custom names).
        """
        candidates = []
        
        # Try known locations for specific LM versions
        for known_loc in LM_KNOWN_TABLE_LOCATIONS:
            if known_loc < len(self.rom_data):
                if self._verify_lm_name_table(known_loc):
                    candidates.append(known_loc)
        
        # Also try the pointer location
        try:
            actual_offset = LM_LEVEL_NAME_POINTER_OFFSET
            if actual_offset + 3 < len(self.rom_data):
                ptr_bytes = bytes(self.rom_data[actual_offset:actual_offset + 3])
                
                if ptr_bytes != b'\x00\x00\x00' and ptr_bytes != b'\xFF\xFF\xFF':
                    bank = ptr_bytes[2]
                    addr = struct.unpack('<H', ptr_bytes[:2])[0]
                    file_off = ((bank & 0x7F) * 0x8000) + (addr & 0x7FFF)
                    
                    if 0x080000 < file_off < len(self.rom_data):
                        if self._verify_lm_name_table(file_off):
                            if file_off not in candidates:
                                candidates.append(file_off)
        except:
            pass
        
        # If we have multiple candidates, prefer the first one
        # (known locations are ordered with newer versions first)
        if candidates:
            return candidates[0]
        
        # If that didn't work, scan for the table
        # Look in expanded ROM area (0x080000 onwards)
        # Scan more carefully with larger steps to avoid false positives
        for base_offset in range(0x080000, min(0x100000, len(self.rom_data)), 0x200):
            if self._verify_lm_name_table(base_offset):
                return base_offset
        
        return None
    
    def _verify_lm_name_table(self, offset: int) -> bool:
        """
        Verify if an offset contains LM's level name table.
        
        Checks for patterns consistent with 24-byte text entries.
        """
        if offset + (96 * 24) > len(self.rom_data):
            return False
        
        # Read several entries and check if they look like text
        readable_count = 0
        
        for i in range(min(30, 96)):  # Check first 30 entries
            entry_off = offset + (i * 24)
            data = self.rom_data[entry_off:entry_off + 24]
            
            # Decode and check if readable
            decoded = ''.join([SNES_CHARSET.get(b, '') for b in data if b != 0x1F])
            
            # Count actual letters (A-Z)
            letter_count = sum(1 for c in decoded if c.isalpha())
            
            # Good entry has 3+ letters and isn't mostly garbage
            if letter_count >= 3 and len(decoded.replace('.', '')) >= 5:
                readable_count += 1
        
        # If we find many readable entries, this is the table
        # Be strict: need at least 20 out of 30 to avoid false positives
        return readable_count >= 20
    
    def _get_lm_name_table_offset(self) -> Optional[int]:
        """Get the file offset where LM stores level names"""
        return self._find_lm_name_table()
    
    def extract_lm_level_name(self, level_id: int) -> Optional[str]:
        """Extract level name from Lunar Magic's system"""
        if not self.lm_mode or self.lm_name_table_offset is None:
            return None
        
        # Calculate entry index: entry = level_id - 0xCA
        if level_id < LM_LEVEL_OFFSET:
            return None  # Level too low for LM system
        
        entry_index = level_id - LM_LEVEL_OFFSET
        
        if entry_index >= LM_MAX_ENTRIES:
            return None  # Beyond LM's 96 entries
        
        # Read the 24-byte entry
        # NOTE: Read directly from rom_data, NOT using read_bytes()
        # LM table offset is already a raw file offset, don't add header again
        offset = self.lm_name_table_offset + (entry_index * LM_ENTRY_SIZE)
        
        if offset + LM_ENTRY_SIZE > len(self.rom_data):
            return None
        
        data = bytes(self.rom_data[offset:offset + LM_ENTRY_SIZE])
        
        # Decode (simple format - just bytes, padded with spaces)
        decoded = ''.join([SNES_CHARSET.get(b, f'[{b:02X}]') for b in data])
        
        return decoded.strip() if decoded.strip() else None
    
    def get_name_assembly_entry(self, level_id: int) -> tuple:
        """
        Get name assembly entry for a level.
        Returns (chunk1_offset, chunk2_offset, chunk3_offset)
        """
        if level_id >= MAX_LEVEL_NAMES:
            raise ValueError(f"Level ID {level_id} exceeds maximum name entries ({MAX_LEVEL_NAMES})")
        
        offset = NAME_ASSEMBLY_INDEX_OFFSET + (level_id * 2)
        byte0, byte1 = self.read_bytes(offset, 2)
        
        # Parse the 16-bit entry
        chunk3_offset = byte0 & 0x0F
        chunk2_offset = (byte0 >> 4) & 0x0F
        chunk1_offset = byte1 & 0x7F
        
        return (chunk1_offset, chunk2_offset, chunk3_offset)
    
    def read_chunk_data(self, chunk_table_offset: int, chunk_offset: int) -> List[int]:
        """
        Read tile data for a chunk.
        Chunks are stored with bit 7 as end marker.
        """
        # Read 16-bit pointer from chunk table
        ptr_offset = chunk_table_offset + (chunk_offset * 2)
        try:
            chunk_ptr = self.read_uint16(ptr_offset)
        except ValueError:
            # If we can't read the pointer, return empty chunk
            return []
        
        # Pointer is relative to NAME_TILE_DATA_OFFSET
        data_offset = NAME_TILE_DATA_OFFSET + chunk_ptr
        
        tiles = []
        max_tiles = 50  # Safety limit
        
        for i in range(max_tiles):
            try:
                tile_byte = self.read_bytes(data_offset + i, 1)[0]
            except ValueError:
                break
            
            if tile_byte & 0x80:  # End marker
                tiles.append(tile_byte & 0x7F)
                break
            tiles.append(tile_byte)
        
        return tiles
    
    def extract_level_name_raw(self, level_id: int) -> List[int]:
        """
        Extract raw tile bytes for a level name.
        Returns list of tile numbers.
        """
        try:
            chunk1_off, chunk2_off, chunk3_off = self.get_name_assembly_entry(level_id)
        except (ValueError, IndexError):
            return []
        
        # Read all three chunks
        tiles = []
        
        try:
            tiles.extend(self.read_chunk_data(CHUNK_PTR_TABLE1_OFFSET, chunk1_off))
        except (ValueError, IndexError):
            pass
        
        try:
            tiles.extend(self.read_chunk_data(CHUNK_PTR_TABLE2_OFFSET, chunk2_off))
        except (ValueError, IndexError):
            pass
        
        try:
            tiles.extend(self.read_chunk_data(CHUNK_PTR_TABLE3_OFFSET, chunk3_off))
        except (ValueError, IndexError):
            pass
        
        return tiles
    
    def tiles_to_string(self, tiles: List[int]) -> str:
        """
        Convert tile numbers to string.
        This is approximate - actual conversion depends on loaded GFX.
        """
        chars = []
        for tile in tiles:
            if tile in SNES_CHARSET:
                chars.append(SNES_CHARSET[tile])
            elif tile == 0:
                chars.append(' ')
            else:
                # For unknown tiles, show hex
                chars.append(f'[{tile:02X}]')
        
        return ''.join(chars)
    
    def extract_level_name(self, level_id: int, raw: bool = False) -> Optional[str]:
        """
        Extract level name as string.
        If raw=True, returns hex representation of tiles.
        
        Automatically detects and uses Lunar Magic system if available.
        """
        # Try Lunar Magic system first
        if self.lm_mode:
            lm_name = self.extract_lm_level_name(level_id)
            if lm_name:
                if raw:
                    # For LM, show the actual bytes
                    return f"[LM] {lm_name}"
                return lm_name
        
        # Fall back to vanilla system
        tiles = self.extract_level_name_raw(level_id)
        
        if not tiles:
            return None
        
        if raw:
            return ' '.join([f'{t:02X}' for t in tiles])
        else:
            return self.tiles_to_string(tiles)
    
    def extract_all_names(self, raw: bool = False) -> Dict[int, str]:
        """Extract all level names that are defined"""
        names = {}
        
        # Determine max levels based on system
        if self.lm_mode:
            # LM system: levels 0xCA onwards (up to 96 entries)
            max_level = LM_LEVEL_OFFSET + LM_MAX_ENTRIES
            # Also try vanilla range for levels < 0xCA
            for level_id in range(MAX_LEVEL_NAMES):
                name = self.extract_level_name(level_id, raw)
                if name:
                    names[level_id] = name
            # Try LM range
            for level_id in range(LM_LEVEL_OFFSET, max_level):
                name = self.extract_level_name(level_id, raw)
                if name:
                    names[level_id] = name
        else:
            # Vanilla system: 93 entries
            for level_id in range(MAX_LEVEL_NAMES):
                name = self.extract_level_name(level_id, raw)
                if name:
                    names[level_id] = name
        
        return names


def main():
    parser = argparse.ArgumentParser(
        description='Extract level names from Super Mario World ROM files',
        epilog='NOTE: Extracts from standard overworld data. Hacks with custom text systems may show vanilla names. See devdocs/SMW_LEVEL_NAMES_LIMITATIONS.md'
    )
    
    parser.add_argument('rom', nargs='?',
                        help='ROM file to analyze')
    
    parser.add_argument('--list', action='store_true',
                        help='List all level names in the ROM')
    
    parser.add_argument('--level', type=str, metavar='LEVEL_ID',
                        help='Extract specific level name (hex or decimal)')
    
    parser.add_argument('--export', action='store_true',
                        help='Export all level names to JSON')
    
    parser.add_argument('--output', '-o', metavar='FILE',
                        help='Output file for --export (JSON format)')
    
    parser.add_argument('--raw', action='store_true',
                        help='Show raw tile hex values instead of decoded text')
    
    parser.add_argument('--table-offset', metavar='OFFSET',
                        help='Manually specify LM name table offset (e.g. 0x08EA1D for custom hacks)')
    
    args = parser.parse_args()
    
    if not args.rom:
        parser.print_help()
        return 1
    
    extractor = LevelNameExtractor(args.rom)
    
    # Apply manual table offset if specified
    if args.table_offset:
        try:
            manual_offset = int(args.table_offset, 16) if '0x' in args.table_offset.lower() else int(args.table_offset, 16)
            extractor.lm_name_table_offset = manual_offset
            extractor.lm_mode = True
            print(f"[INFO] Using manual LM table offset: 0x{manual_offset:06X}", file=sys.stderr)
        except ValueError:
            print(f"Error: Invalid table offset: {args.table_offset}", file=sys.stderr)
            return 1
    
    if args.level:
        # Extract specific level
        try:
            if args.level.startswith('0x') or args.level.startswith('0X'):
                level_id = int(args.level, 16)
            else:
                level_id = int(args.level)
        except ValueError:
            print(f"Error: Invalid level ID: {args.level}", file=sys.stderr)
            return 1
        
        name = extractor.extract_level_name(level_id, args.raw)
        
        if name:
            print(f"Level {level_id} (0x{level_id:02X}): {name}")
        else:
            print(f"Level {level_id} (0x{level_id:02X}): No name data found")
    
    elif args.list or args.export:
        # Extract all names
        names = extractor.extract_all_names(args.raw)
        
        if args.export:
            output_data = {
                'rom_file': str(extractor.rom_path.name),
                'total_names': len(names),
                'names': {f"0x{lid:02X}": name for lid, name in names.items()},
                'names_decimal': {str(lid): name for lid, name in names.items()}
            }
            
            if args.output:
                with open(args.output, 'w') as f:
                    json.dump(output_data, f, indent=2)
                print(f"Exported {len(names)} level names to {args.output}")
            else:
                print(json.dumps(output_data, indent=2))
        else:
            # List format
            print(f"Level names in {extractor.rom_path.name}:")
            print(f"Total: {len(names)} names\n")
            
            for level_id in sorted(names.keys()):
                name = names[level_id]
                print(f"  {level_id:3d} (0x{level_id:02X}): {name}")
    
    else:
        # Default: list all names
        names = extractor.extract_all_names(args.raw)
        print(f"Level names in {extractor.rom_path.name}:")
        print(f"Total: {len(names)} names\n")
        
        for level_id in sorted(names.keys()):
            name = names[level_id]
            print(f"  {level_id:3d} (0x{level_id:02X}): {name}")
    
    return 0


if __name__ == '__main__':
    sys.exit(main())

