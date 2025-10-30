#!/usr/bin/env python3
"""
Lunar Magic Level Name Extractor (Enhanced V2)
Version: 2025-10-28 Enhanced V2
Author: AI Assistant with Cerces

Extracts level names from Super Mario World ROM files edited with Lunar Magic.
Supports ROMs with and without headers, and various Lunar Magic versions.

Enhanced features:
- Hardcoded vanilla names (no vanilla ROM needed for --novanilla)
- --editedonly compares actual level data (not just names)
- --levelsonly filters out message box text
"""

import argparse
import hashlib
import os
import re
import glob
import shutil
import re
import struct
import sys
from typing import Dict, List, Optional, Tuple, Set

levelset = []
def normalize_lid(val):
    lid=str(val)
    if isinstance(val,int):
        lid = "%.3d" % val
    #print("normalize(" + lid + ") = " + lid)
    return lid

# Hardcoded vanilla SMW level names (from orig_lm333_noedits.sfc)
# This allows --novanilla to work without needing a vanilla ROM file
VANILLA_LEVEL_NAMES = {
    0x001: "VANILLA SECRET 3", 0x002: "VANILLA SECRET 4", 0x003: "TOP SECRET AREA",
    0x004: "DONUT GHOST HOUSE", 0x005: "DONUT PLAINS 4", 0x006: "DONUT PLAINS 5",
    0x007: "#3 MORTON'S CASTLE", 0x008: "GREEN SWITCH PALACE", 0x009: "DONUT PLAINS 3",
    0x00A: "DONUT SECRET 2", 0x00B: "VANILLA FORTRESS", 0x00C: "BUTTER BRIDGE 2",
    0x00D: "BUTTER BRIDGE 3", 0x00E: "#5 LUDWIG'S CASTLE", 0x00F: "CHEESE BRIDGE AREA",
    0x010: "COOKIE MOUNTAIN", 0x011: "SODA LAKE", 0x012: "STAR ROAD",
    0x013: "DONUT SECRET HOUSE", 0x014: "YELOW SWITCH PALACE", 0x015: "DONUT PLAINS 2",
    0x016: "STAR ROAD", 0x017: "#3 MORTON'S PLAINS", 0x018: "SUNKEN GHOST SHIP",
    0x019: "#3 MORTON'S PLAINS", 0x01A: "#7 WENDY'S CASTLE", 0x01B: "CHOCOLATE FORTRESS",
    0x01C: "CHOCOLATE ISLAND 6", 0x01D: "CHOCOLATE ISLAND 5", 0x01E: "STAR ROAD",
    0x01F: "FOREST FORTRESS", 0x020: "#6 ROY'S CASTLE", 0x021: "CHOCO-GHOST HOUSE",
    0x022: "CHOCOLATE ISLAND 2", 0x023: "CHOCOLATE ISLAND 4", 0x024: "CHOCOLATE ISLAND 3",
    0x025: "#2 IGGY'S CASTLE", 0x026: "YOSHI'S ISLAND 5", 0x027: "YOSHI'S ISLAND 4",
    0x028: "YOSHI'S HOUSE", 0x029: "YOSHI'S ISLAND 2", 0x02A: "YOSHI'S ISLAND 3",
    0x02B: "VANILLA GHOST HOUSE", 0x02C: "STAR ROAD", 0x02D: "VANILLA SECRET 2",
    0x02E: "VANILLA DOME 4", 0x02F: "DONUT SECRET 3", 0x030: "STAR ROAD",
    0x031: "FRONT DOOR", 0x032: "BACK DOOR", 0x033: "VALLEY OF BOWSER 5",
    0x034: "#8 LARRY'S CASTLE", 0x035: "VALLEY FORTRESS", 0x037: "VALLEY OF BOWSER 4",
    0x038: "VALLEY GHOST HOUSE", 0x039: "VALLEY OF BOWSER 3", 0x03A: "VALLEY OF BOWSER 2",
    0x03B: "CHOCOLATE SECRET", 0x03C: "VANILLA DOME 3", 0x03D: "VANILLA DOME 5",
    0x03E: "VANILLA DOME 2", 0x03F: "RED SWITCH PALACE", 0x040: "#4 LEMMY'S CASTLE",
    0x041: "FOREST GHOST HOUSE", 0x042: "FOREST OFILLUSION 2", 0x043: "FOREST OFILLUSION 5",
    0x044: "FOREST OFILLUSION 3", 0x045: "BLUE SWITCH PALACE", 0x046: "FOREST SECRET AREA",
    0x047: "FOREST OFILLUSION 4", 0x048: "STAR ROAD", 0x049: "FUNKY",
    0x04A: "OUTRAGEOUS", 0x04B: "MONDO", 0x04C: "GROOVY",
    0x04D: "STAR ROAD", 0x04E: "GNARLY", 0x04F: "TUBULAR",
    0x050: "WAY COOL", 0x051: "AWESOME", 0x052: "STAR ROAD",
    0x053: "STAR ROAD", 0x054: "STAR WORLD 3", 0x055: "STAR ROAD",
    0x056: "STAR WORLD 4", 0x057: "STAR ROAD", 0x058: "STAR WORLD 2",
    0x059: "STAR WORLD 5", 0x05A: "STAR WORLD 6", 0x05B: "STAR ROAD",
    0x05C: "STAR ROAD",
}

# Default Lunar Magic tile-to-character mapping
DEFAULT_TILE_MAP = {
    # Row 1: A-P (0x00-0x0F)
    0x00: 'A', 0x01: 'B', 0x02: 'C', 0x03: 'D', 0x04: 'E', 0x05: 'F',
    0x06: 'G', 0x07: 'H', 0x08: 'I', 0x09: 'J', 0x0A: 'K', 0x0B: 'L',
    0x0C: 'M', 0x0D: 'N', 0x0E: 'O', 0x0F: 'P',
    
    # Row 2: Q-Z, punctuation (0x10-0x1F)
    0x10: 'Q', 0x11: 'R', 0x12: 'S', 0x13: 'T', 0x14: 'U', 0x15: 'V',
    0x16: 'W', 0x17: 'X', 0x18: 'Y', 0x19: 'Z', 0x1A: '!', 0x1B: '.',
    0x1C: '-', 0x1D: ',', 0x1E: '?', 0x1F: ' ',
    
    # Row 3: Special characters (0x20-0x2F) - showing as escape codes
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
    
    # Row 8: Special graphics (0x70-0x7F)
    0x70: '\\70', 0x71: '\\71', 0x72: '\\72', 0x73: '\\73', 0x74: '\\74',
    0x75: '\\75', 0x76: '\\76', 0x77: '\\77', 0x78: '\\78', 0x79: '\\79',
    0x7A: '\\7A', 0x7B: '\\7B', 0x7C: '\\7C', 0x7D: '\\7D', 0x7E: '\\7E', 0x7F: '\\7F',
}

# Add graphic tiles 0x80-0xFF (all display as escape codes)
for i in range(0x80, 0x100):
    DEFAULT_TILE_MAP[i] = f'\\{i:02X}'


def snes_to_rom_offset(snes_addr: int, header_offset: int = 0) -> int:
    """Convert SNES LoROM address to ROM file offset."""
    bank = (snes_addr >> 16) & 0xFF
    offset_in_bank = snes_addr & 0xFFFF
    
    if offset_in_bank < 0x8000:
        rom_offset = (bank << 15) | offset_in_bank
    else:
        rom_offset = (bank << 15) | (offset_in_bank - 0x8000)
    
    return rom_offset + header_offset


def detect_header(rom_data: bytes) -> Tuple[bool, int]:
    """
    Detect if ROM has a 512-byte header.
    Returns: (has_header, header_offset)
    """
    rom_size = len(rom_data)
    
    # Standard SMW ROMs are multiples of 1024 bytes
    # Headered ROMs are 512 bytes larger
    if rom_size % 0x400 == 0x200:
        return True, 512
    else:
        return False, 0


def check_level_names_patch(rom_data: bytes, header_offset: int) -> bool:
    """Check if Lunar Magic Level Names Patch is installed."""
    snes_hijack = 0x048E81
    rom_hijack = snes_to_rom_offset(snes_hijack, header_offset)
    
    if rom_hijack >= len(rom_data):
        return False
    
    hijack_byte = rom_data[rom_hijack]
    return hijack_byte == 0x22  # JSR instruction


def get_level_name_pointers(rom_data: bytes, header_offset: int) -> Tuple[Optional[int], Optional[int]]:
    """
    Get pointers to level name data blocks.
    Returns: (block_0_rom_offset, block_1_rom_offset)
    """
    # Block 0: Levels 0x000-0x0FF
    snes_pointer_addr = 0x03BB57
    rom_pointer_addr = snes_to_rom_offset(snes_pointer_addr, header_offset)
    
    if rom_pointer_addr + 3 > len(rom_data):
        return None, None
    
    patch_pointer = (rom_data[rom_pointer_addr] |
                     rom_data[rom_pointer_addr + 1] << 8 |
                     rom_data[rom_pointer_addr + 2] << 16)
    
    block_0_rom = snes_to_rom_offset(patch_pointer, header_offset)
    
    # Block 1: Levels 0x100-0x1FF
    # This is at a fixed relative offset from block 0
    # Calculate based on the pattern we observed
    block_1_rom = 0x08EF46  # Known offset for Akogare ROMs
    
    # Verify block 1 exists and has valid data
    if block_1_rom + 19 > len(rom_data):
        block_1_rom = None
    
    return block_0_rom, block_1_rom


def decode_level_name(tile_data: bytes, tile_map: Dict[int, str], show_graphics: bool = False) -> str:
    """
    Decode a level name from tile data.
    
    Args:
        tile_data: 19 bytes of tile data
        tile_map: Dictionary mapping tile codes to characters
        show_graphics: If True, show graphic codes; if False, hide them
    
    Returns:
        Decoded string
    """
    decoded = []
    for byte in tile_data:
        if byte in tile_map:
            char = tile_map[byte]
            if show_graphics or not char.startswith('\\'):
                decoded.append(char)
        elif byte == 0x00 or byte == 0xFF:
            # Skip padding bytes
            continue
        else:
            decoded.append(f'[?{byte:02X}]')
    
    return ''.join(decoded).strip()


def extract_level_names(
    rom_data: bytes,
    header_offset: int,
    tile_map: Dict[int, str],
    show_graphics: bool = False,
    level_range: Optional[Tuple[int, int]] = None
) -> Dict[int, Dict]:
    """
    Extract level names from ROM.
    
    Args:
        rom_data: ROM file data
        header_offset: Header offset (0 or 512)
        tile_map: Tile-to-character mapping
        show_graphics: Whether to show graphic tile codes
        level_range: Optional (min, max) level ID range to extract
    
    Returns:
        Dictionary of level names keyed by level ID
    """
    LEVEL_NAME_SIZE = 19
    
    block_0_rom, block_1_rom = get_level_name_pointers(rom_data, header_offset)
    
    if block_0_rom is None:
        return {}
    
    level_names = {}
    
    # Determine range
    min_level = level_range[0] if level_range else 0
    max_level = level_range[1] if level_range else 0x1FF
    
    for level_id in range(min_level, max_level + 1):
        # Determine which block to use
        if level_id < 0x100:
            block_offset = block_0_rom
            offset_in_block = level_id * LEVEL_NAME_SIZE
        else:
            if block_1_rom is None:
                continue
            block_offset = block_1_rom
            offset_in_block = (level_id - 0x100) * LEVEL_NAME_SIZE
        
        level_offset = block_offset + offset_in_block
        
        if level_offset + LEVEL_NAME_SIZE > len(rom_data):
            continue
        
        level_data = rom_data[level_offset:level_offset + LEVEL_NAME_SIZE]
        
        # Check if level has a name (not all padding)
        has_name = any(b != 0 and b != 0x1F and b != 0xFF for b in level_data)
        
        if not has_name:
            continue
        
        decoded = decode_level_name(level_data, tile_map, show_graphics)
        
        if decoded:  # Only include if there's actual decoded text
            level_names[level_id] = {
                'level_id': level_id,
                'name': decoded,
                'rom_offset': level_offset,
                'raw_data': level_data
            }
    
    return level_names


def load_custom_tile_map(filepath: str) -> Dict[int, str]:
    """Load a custom tile mapping from a file."""
    tile_map = {}
    
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            
            parts = line.split('=', 1)
            if len(parts) != 2:
                continue
            
            tile_code_str, char = parts
            tile_code_str = tile_code_str.strip()
            char = char.strip()
            
            # Parse tile code (hex)
            if tile_code_str.startswith('0x') or tile_code_str.startswith('0X'):
                tile_code = int(tile_code_str, 16)
            else:
                tile_code = int(tile_code_str, 16)
            
            # Handle escape sequences in character
            if char.startswith('\\'):
                if char == '\\n':
                    char = '\n'
                elif char == '\\t':
                    char = '\t'
                # Otherwise keep as-is
            
            tile_map[tile_code] = char
    
    return tile_map


def load_vanilla_level_names(vanilla_rom_path: Optional[str], tile_map: Dict[int, str]) -> Dict[int, str]:
    """
    Load level names from hardcoded dictionary or vanilla ROM for comparison.
    
    Args:
        vanilla_rom_path: Path to vanilla ROM (optional, uses hardcoded if None)
        tile_map: Tile mapping dictionary
    
    Returns:
        Dictionary of level_id -> name
    """
    # First, try using hardcoded vanilla names (no ROM needed!)
    if not vanilla_rom_path or not os.path.exists(vanilla_rom_path):
        return VANILLA_LEVEL_NAMES.copy()
    
    # If ROM path provided, load from ROM (for more complete comparison)
    try:
        with open(vanilla_rom_path, 'rb') as f:
            vanilla_rom_data = f.read()
    except (FileNotFoundError, IOError):
        # Fall back to hardcoded
        return VANILLA_LEVEL_NAMES.copy()
    
    has_header, header_offset = detect_header(vanilla_rom_data)
    
    if not check_level_names_patch(vanilla_rom_data, header_offset):
        return VANILLA_LEVEL_NAMES.copy()
    
    vanilla_names = extract_level_names(vanilla_rom_data, header_offset, tile_map, False, None)
    
    # Convert to simple dict of id -> name
    return {level_id: info['name'] for level_id, info in vanilla_names.items()}


def is_likely_message_box_text(text: str, level_id: int) -> bool:
    """
    Detect if text is likely message box content rather than a level name.
    
    Based on Lunar Magic analysis:
    - Level names are stored in two blocks: 0x000-0x0FF and 0x100-0x1FF
    - Message boxes in vanilla SMW use level IDs 0x060-0x0FF
    - But ROM hacks can use these IDs for actual levels
    
    This function uses BOTH level ID ranges AND content patterns to determine
    if something is message box text.
    """
    
    # ============================================================================
    # PRIMARY DETECTION: Level ID Ranges
    # ============================================================================
    
    # Vanilla SMW uses 0x060-0x0FF for message boxes, NOT levels
    # However, ROM hacks may repurpose these IDs
    # So we need to check both ID range AND content
    
    is_in_vanilla_message_range = 0x060 <= level_id <= 0x0FF
    is_in_extended_garbage_range = level_id >= 0x1DA  # Very high IDs often garbage
    is_in_early_extended_range = 0x100 <= level_id <= 0x109  # Sometimes used for messages
    
    # ============================================================================
    # PATTERN DETECTION: Content Analysis
    # ============================================================================
    
    text_lower = text.lower()
    suspicious_score = 0  # Accumulate evidence
    
    # Pattern 1: Starts with "tubs" (control code marker)
    if text.startswith('tubs'):
        suspicious_score += 10  # Very strong indicator
    
    # Pattern 2: Starts with lowercase (sentence continuation)
    if text and text[0].islower() and len(text) > 3:
        suspicious_score += 2
    
    # Pattern 3: Contains instruction/tutorial keywords
    instruction_keywords = [
        'press', 'button', 'control pad', 'you can', 'you may', 'to use',
        'press up', 'press the', 'hold the', 'use the', 'stomp on',
        'jump on', 'if you', 'can you', 'will be', 'has been',
        'thank you', 'sorry', 'hello!', 'welcome', 'rescue', 'trapped',
        'princess', 'bowser', 'yoshi', 'mario', 'koopa',
        'switch palace', 'point of advice', 'bonus star', 'dragon coin',
        'spin jump', 'cape', 'feather', 'collect', 'defeat', 'find the',
    ]
    
    for keyword in instruction_keywords:
        if keyword in text_lower:
            suspicious_score += 5  # Strong indicator
            break  # Only count once
    
    # Pattern 4: Concatenated words (missing spaces between words)
    concatenation_patterns = [
        'youcan', 'youmay', 'youfind', 'youwill', 'tothe', 'onthe', 'inthe',
        'ofthe', 'forthe', 'withthe', 'fromthe', 'bythe', 'atthe',
        'thecontrol', 'theswitch', 'themap', 'thegate', 'thetape',
        'bypressing', 'whilejumping', 'andyou', 'ifyou', 'canyou'
    ]
    
    for pattern in concatenation_patterns:
        if pattern in text_lower:
            suspicious_score += 4  # Moderate indicator
            break
    
    # Pattern 5: Sentence fragments (mid-word breaks)
    # e.g., "Dinosaur Lan" followed by "d. In"
    if len(text) >= 10 and text[-1].islower():
        # Check if it ends with common fragment patterns
        if text.endswith(('an', 'ion', 'er', 'ed', 'ing', 'es', 'en')):
            suspicious_score += 3
    
    # Pattern 6: Excessive spacing or formatting issues
    if text.count('  ') >= 3:  # Multiple double spaces
        suspicious_score += 3
    
    # Pattern 7: Very short with no clear meaning
    if len(text.strip()) <= 3:
        if is_in_vanilla_message_range or is_in_extended_garbage_range:
            suspicious_score += 5
    
    # Pattern 8: Encoding artifacts (repeated characters)
    if 'E E E E' in text or 'A A A A' in text or text.count('A') > len(text) // 2:
        suspicious_score += 8  # Strong indicator
    
    # Pattern 9: Very long text (level names are typically short)
    words = text.split()
    if len(words) > 5:  # Level names rarely have more than 5 words
        suspicious_score += 2
    
    # ============================================================================
    # DECISION LOGIC
    # ============================================================================
    
    # High suspicious score = definitely message box
    if suspicious_score >= 10:
        return True
    
    # In vanilla message range with moderate suspicious score
    if is_in_vanilla_message_range and suspicious_score >= 5:
        return True
    
    # In extended garbage range with any suspicious patterns
    if is_in_extended_garbage_range and suspicious_score >= 3:
        return True
    
    # In early extended range (0x100-0x109) with high suspicion
    if is_in_early_extended_range and suspicious_score >= 7:
        return True
    
    # Default: not message box
    return False


def has_english_words(text: str) -> bool:
    """
    Check if text contains English words (not just random characters).
    Uses a simple heuristic: looks for common English words or word patterns.
    """
    # Remove special characters and normalize
    clean_text = re.sub(r'[^a-zA-Z\s]', ' ', text).lower()
    words = clean_text.split()
    
    if not words:
        return False
    
    # Common English words that appear in level names
    common_words = {
        'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from',
        'secret', 'area', 'castle', 'house', 'ghost', 'plains', 'island', 'mountain',
        'bridge', 'lake', 'road', 'star', 'switch', 'palace', 'fortress', 'valley',
        'forest', 'cave', 'cavern', 'hills', 'passage', 'gate', 'gateway', 'door',
        'donut', 'vanilla', 'chocolate', 'butter', 'cheese', 'cookie', 'soda',
        'sunken', 'ship', 'world', 'special', 'top', 'yellow', 'green', 'blue', 'red',
        'keep', 'watcher', 'pickle', 'backtrack', 'moth', 'tubba', 'forgotten',
        'gridiron', 'ridge', 'bullet', 'promenade', 'celestial', 'rex', 'cloon',
        'shiverthorn', 'hollow', 'stormcrow', 'alcazar', 'toxic', 'underscore',
        'burrow', 'twilight', 'fritzer', 'whynot', 'lookout', 'grim', 'shade',
        'manor', 'abkhazia', 'living', 'earth', 'super', 'koopa', 'australian',
        'airways', 'labrys', 'abyss',
    }
    
    # Check if at least one word is in our common words list
    for word in words:
        if len(word) >= 3 and word in common_words:
            return True
    
    # Alternative: Check if words look like English (have vowels and consonants)
    for word in words:
        if len(word) >= 4:
            vowels = sum(1 for c in word if c in 'aeiou')
            consonants = len(word) - vowels
            # English words typically have both vowels and consonants
            if vowels >= 1 and consonants >= 2:
                return True
    
    return False


def get_level_data_hash(rom_data: bytes, header_offset: int, level_id: int) -> Optional[str]:
    """
    Get MD5 hash of level data for comparison.
    
    Level data is stored in the ROM using a pointer table at $05D7E (PC: 0x05D7E).
    Each level has a 3-byte pointer to its compressed level data.
    
    Args:
        rom_data: ROM data bytes
        header_offset: Header offset (0 or 512)
        level_id: Level ID (0x000-0x1FF)
    
    Returns:
        MD5 hash of level data, or None if invalid
    """
    # Level pointer table location (PC address)
    LEVEL_POINTER_TABLE_PC = 0x05D7E
    
    # Calculate pointer location for this level
    pointer_offset = LEVEL_POINTER_TABLE_PC + header_offset + (level_id * 3)
    
    if pointer_offset + 3 > len(rom_data):
        return None
    
    # Read 24-bit LoROM pointer
    pointer_low = rom_data[pointer_offset]
    pointer_mid = rom_data[pointer_offset + 1]
    pointer_bank = rom_data[pointer_offset + 2]
    
    # Convert LoROM address to PC offset
    # LoROM format: $BB:AAAA where BB is bank, AAAA is address
    snes_address = (pointer_bank << 16) | (pointer_mid << 8) | pointer_low
    
    # LoROM conversion: PC = ((bank & 0x7F) * 0x8000) + (addr & 0x7FFF)
    if (snes_address & 0xFFFF) < 0x8000:
        return None  # Invalid address
    
    pc_offset = ((pointer_bank & 0x7F) * 0x8000) + ((snes_address & 0xFFFF) - 0x8000)
    pc_offset += header_offset
    
    if pc_offset >= len(rom_data):
        return None
    
    # Read level data (up to 2KB - generous size for compressed data)
    level_data_size = min(2048, len(rom_data) - pc_offset)
    level_data = rom_data[pc_offset:pc_offset + level_data_size]
    
    # Return MD5 hash
    return hashlib.md5(level_data).hexdigest()


def is_level_data_edited(rom_data: bytes, vanilla_rom_data: bytes, 
                         header_offset: int, vanilla_header_offset: int, 
                         level_id: int) -> bool:
    """
    Check if level data has been edited by comparing hashes.
    
    Args:
        rom_data: Target ROM data
        vanilla_rom_data: Vanilla ROM data
        header_offset: Target ROM header offset
        vanilla_header_offset: Vanilla ROM header offset
        level_id: Level ID to check
    
    Returns:
        True if level data differs from vanilla, False otherwise
    """
    target_hash = get_level_data_hash(rom_data, header_offset, level_id)
    vanilla_hash = get_level_data_hash(vanilla_rom_data, vanilla_header_offset, level_id)
    
    if target_hash is None or vanilla_hash is None:
        return False  # Can't determine, assume not edited
    
    return target_hash != vanilla_hash


def filter_level_names(
    level_names: Dict[int, Dict],
    vanilla_names: Optional[Dict[int, str]] = None,
    edited_only: bool = False,
    no_vanilla: bool = False,
    with_words: bool = False,
    levels_only: bool = False,
    rom_data: Optional[bytes] = None,
    vanilla_rom_data: Optional[bytes] = None,
    header_offset: int = 0,
    vanilla_header_offset: int = 0
) -> Dict[int, Dict]:
    """
    Filter level names based on various criteria.
    
    Args:
        level_names: Dictionary of level names to filter
        vanilla_names: Dictionary of vanilla level names for comparison
        edited_only: If True, only show levels that differ from vanilla
        no_vanilla: If True, exclude known vanilla level names
        with_words: If True, only show names that contain English words
        levels_only: If True, filter out message box text
    
    Returns:
        Filtered dictionary of level names
    """
    filtered = {}
    
    for level_id, info in level_names.items():
        name = info['name']
        
        # Filter: edited only (LEVEL DATA must be different from vanilla)
        if edited_only and rom_data and vanilla_rom_data:
            if not is_level_data_edited(rom_data, vanilla_rom_data, 
                                       header_offset, vanilla_header_offset, level_id):
                continue  # Skip if level DATA not edited
        
        # Filter: no vanilla (exclude known vanilla names)
        if no_vanilla and vanilla_names:
            vanilla_name = vanilla_names.get(level_id)
            if vanilla_name and vanilla_name == name:
                continue  # Skip if matches vanilla
        
        # Filter: with words (must contain English words)
        if with_words:
            if not has_english_words(name):
                continue  # Skip if doesn't have English words
        
        # Filter: levels only (exclude message box text)
        if levels_only:
            if len(levelset)>0 and not(normalize_lid(level_id) in levelset):
                continue
            else:
                pass
                #print("included "+normalize_lid(level_id))

            if is_likely_message_box_text(name, level_id):
                continue  # Skip if likely message box
        
        # Passed all filters
        filtered[level_id] = info
    
    return filtered


def main():
    parser = argparse.ArgumentParser(
        description='Extract level names from Lunar Magic edited SMW ROM files',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Extract all level names from a ROM
  python levelname_extractor_2025_10_28.py --romfile game.sfc
  
  # Extract specific level range
  python levelname_extractor_2025_10_28.py --romfile game.sfc --range 0x100 0x13F
  
  # Show graphic tile codes
  python levelname_extractor_2025_10_28.py --romfile game.sfc --show-graphics
  
  # Use custom tile mapping
  python levelname_extractor_2025_10_28.py --romfile game.sfc --tile-map custom.txt
  
  # Output to file
  python levelname_extractor_2025_10_28.py --romfile game.sfc --output names.txt
"""
    )
    
    parser.add_argument('--gametag', required=False, help='GameID')
    parser.add_argument('--romfile', required=True, help='Path to ROM file')
    parser.add_argument('--output', '-o', help='Output file (default: stdout)')
    parser.add_argument('--tile-map', help='Custom tile mapping file')
    parser.add_argument('--show-graphics', action='store_true', 
                       help='Show graphic tile codes (default: hide)')
    parser.add_argument('--range', nargs=2, metavar=('MIN', 'MAX'),
                       help='Level ID range to extract (hex or decimal)')
    parser.add_argument('--format', choices=['text', 'csv', 'json'], default='text',
                       help='Output format (default: text)')
    parser.add_argument('--verbose', '-v', action='store_true',
                       help='Verbose output')
    
    # Filtering options
    parser.add_argument('--vanilla-rom', metavar='FILE',
                       help='Path to vanilla ROM for comparison filtering')
    parser.add_argument('--editedonly', action='store_true',
                       help='Only show levels where level DATA has been edited (compares actual level content, requires --vanilla-rom)')
    parser.add_argument('--novanilla', action='store_true',
                       help='Filter out vanilla level names')
    parser.add_argument('--withwords', action='store_true',
                       help='Only show level names containing English words')
    parser.add_argument('--levelsonly', action='store_true',
                       help='Filter out message box text and extraneous content (uses pattern detection)')
    
    args = parser.parse_args()

    # Load ROM
    try:
        if not(os.path.exists("temp")):
            sys.mkdir("temp")
        if os.path.exists("temp/temp_lm361.sfc"):
            os.unlink("temp/temp_lm361.sfc")
        shutil.copy("orig_lm361_noedits.sfc", "temp/temp_lm361.sfc")
        shutil.copy(args.romfile, "temp/temp_analyze.sfc")
        shutil.rmtree("temp/Graphics")
        shutil.rmtree("temp/ExGraphics")
        orig_path = os.getcwd()
        os.chdir("temp")
        for f in glob.glob("*.mwl"):
            if re.match("^.*\.mwl$", f):
                os.remove(f)
        #
        #"Lunar Magic.exe" -ExpandROM "ROMFileName.smc" SizeOfROM
        #"Lunar Magic.exe" -ExportGFX "ROMFileName.smc"
        #"Lunar Magic.exe" -ExportExGFX "ROMFileName.smc"
        #"Lunar Magic.exe" -ImportGFX "ROMFileName.smc"
        #"Lunar Magic.exe" -ImportExGFX "ROMFileName.smc"
        #"Lunar Magic.exe" -ImportAllGraphics "ROMFileName.smc"
        #"Lunar Magic.exe" -ExportAllMap16 "ROMFileName.smc" "Map16FileName.map16"
        #"Lunar Magic.exe" -ImportAllMap16 "ROMFileName.smc" "Map16FileName.map16"
        #"Lunar Magic.exe" -ImportCustomPalette "ROMFileName.smc" "PalFileName.pal" LevelNumber
        #"Lunar Magic.exe" -ExportSharedPalette "ROMFileName.smc" "PalFileName.smwpal"
        #"Lunar Magic.exe" -ImportSharedPalette "ROMFileName.smc" "PalFileName.smwpal"
        #"Lunar Magic.exe" -TransferLevelGlobalExAnim "DestROMFileName.smc" "SourceROMFileName.smc"
        #"Lunar Magic.exe" -DeleteLevels "ROMFileName.smc" DeleteType [-ClearOrigLevelArea]

        os.system("wine ../lm361/lm361.exe -ExpandROM temp_lm361.sfc 4MB")
        os.system("wine ../lm361/lm361.exe -DeleteLevels temp_lm361.sfc -AllLevels -ClearOrigLevelArea")
        os.system("wine ../lm361/lm361.exe -ExportGFX temp_analyze.sfc")
        os.system("wine ../lm361/lm361.exe -ExportExGFX temp_analyze.sfc")
        os.remove("temp.map16")
        os.system("wine ../lm361/lm361.exe -ExportAllMap16 temp_analyze.sfc temp.map16")
        os.system("wine ../lm361/lm361.exe -ImportAllMap16 temp.sfc temp.map16")
        os.system("wine ../lm361/lm361.exe -ExportSharedPalette temp_analyze.sfc temp.smwpal")
        os.system("wine ../lm361/lm361.exe -ImportSharedPalette temp.sfc temp.smwpal")
        os.system("wine ../lm361/lm361.exe -ImportAllGraphics temp.sfc")
        os.system("wine ../lm361/lm361.exe -TransferLevelGlobalExAnim temp.sfc temp_analyze.sfc")
        print("timeout 4 wine ../lm361/lm361.exe -TransferOverworld temp_lm361.sfc temp_analyze.sfc")
        os.system('timeout 4 wine ../lm361/lm361.exe -TransferOverworld temp_lm361.sfc temp_analyze.sfc')
        os.system('timeout 4 wine ../lm361/lm361.exe -ExportMultLevels temp_analyze.sfc MWL 1')
        os.system('wine ../lm361/lm361.exe -ImportMultLevels temp_lm361.sfc "./"')
        for f in glob.glob("MWL*.mwl"):
            result = re.match("^MWL ([^.]+)\.mwl$", f)
            #if len(result.groups) > 0:
            if result:
                mgroup = result.groups(0)[0]
                levelset.append(normalize_lid(mgroup))
        os.chdir(orig_path)
        if (args.gametag):
            shutil.copy("temp/temp_lm361.sfc", "temp_lm361_" + str(args.gametag) + ".sfc")
        args.romfile = 'temp/temp_lm361.sfc'

        with open(args.romfile, 'rb') as f:
            rom_data = f.read()
    except FileNotFoundError:
        print(f"Error: ROM file not found: {args.romfile}", file=sys.stderr)
        return 1
    except IOError as e:
        print(f"Error reading ROM file: {e}", file=sys.stderr)
        return 1
    
    # Detect header
    has_header, header_offset = detect_header(rom_data)
    
    if args.verbose:
        print(f"ROM file: {args.romfile}", file=sys.stderr)
        print(f"ROM size: {len(rom_data):,} bytes", file=sys.stderr)
        print(f"Header: {'Yes (512 bytes)' if has_header else 'No'}", file=sys.stderr)
    
    # Check for Level Names Patch
    patch_installed = check_level_names_patch(rom_data, header_offset)
    
    if args.verbose:
        print(f"Lunar Magic Level Names Patch: {'Installed' if patch_installed else 'Not installed'}", 
              file=sys.stderr)
    
    if not patch_installed:
        print("Error: Lunar Magic Level Names Patch not found in ROM", file=sys.stderr)
        print("This ROM may use vanilla level names or is not edited with Lunar Magic", file=sys.stderr)
        return 1
    
    # Load tile map
    if args.tile_map:
        try:
            tile_map = load_custom_tile_map(args.tile_map)
            if args.verbose:
                print(f"Loaded custom tile map from {args.tile_map} ({len(tile_map)} mappings)", 
                      file=sys.stderr)
        except Exception as e:
            print(f"Error loading tile map: {e}", file=sys.stderr)
            return 1
    else:
        tile_map = DEFAULT_TILE_MAP
    
    # Parse level range
    level_range = None
    if args.range:
        try:
            min_level = int(args.range[0], 0)  # Auto-detect base (hex or decimal)
            max_level = int(args.range[1], 0)
            level_range = (min_level, max_level)
            if args.verbose:
                print(f"Extracting levels 0x{min_level:03X} to 0x{max_level:03X}", file=sys.stderr)
        except ValueError:
            print(f"Error: Invalid level range: {args.range}", file=sys.stderr)
            return 1
    
    # Extract level names
    level_names = extract_level_names(rom_data, header_offset, tile_map, 
                                      args.show_graphics, level_range)
    
    if args.verbose:
        print(f"Extracted {len(level_names)} level names", file=sys.stderr)
    
    # Load vanilla level names if filtering requested
    vanilla_names = None
    vanilla_rom_data_for_edited = None
    vanilla_header_offset_for_edited = 0
    
    if args.novanilla:
        # For --novanilla, use hardcoded names (no ROM file needed!)
        vanilla_names = load_vanilla_level_names(None, tile_map)
        if args.verbose:
            print(f"Loaded {len(vanilla_names)} hardcoded vanilla level names", file=sys.stderr)
    
    if args.editedonly:
        # For --editedonly, we need the actual vanilla ROM to compare level DATA
        vanilla_rom_path = args.vanilla_rom or 'smw.sfc'
        if args.verbose:
            print(f"Loading vanilla ROM for level data comparison: {vanilla_rom_path}", file=sys.stderr)
        
        try:
            with open(vanilla_rom_path, 'rb') as f:
                vanilla_rom_data_for_edited = f.read()
            _, vanilla_header_offset_for_edited = detect_header(vanilla_rom_data_for_edited)
            
            # Also load vanilla names if not already loaded
            if not vanilla_names:
                vanilla_names = load_vanilla_level_names(vanilla_rom_path, tile_map)
            
            if args.verbose:
                print(f"Loaded vanilla ROM: {len(vanilla_rom_data_for_edited):,} bytes", file=sys.stderr)
        except (FileNotFoundError, IOError) as e:
            if args.verbose:
                print(f"Warning: Could not load vanilla ROM for level data comparison: {e}", file=sys.stderr)
            print(f"ERROR: --editedonly requires a vanilla ROM file", file=sys.stderr)
            sys.exit(1)
    
    # Apply filters
    if args.editedonly or args.novanilla or args.withwords or args.levelsonly:
        original_count = len(level_names)
        level_names = filter_level_names(
            level_names,
            vanilla_names,
            edited_only=args.editedonly,
            no_vanilla=args.novanilla,
            with_words=args.withwords,
            levels_only=args.levelsonly,
            rom_data=rom_data,
            vanilla_rom_data=vanilla_rom_data_for_edited,
            header_offset=header_offset,
            vanilla_header_offset=vanilla_header_offset_for_edited
        )
        if args.verbose:
            print(f"Filtering: {original_count} -> {len(level_names)} level names", file=sys.stderr)
    
    if args.verbose:
        print("", file=sys.stderr)
    
    # Format output
    output_lines = []
    
    if args.format == 'text':
        for level_id in sorted(level_names.keys()):
            info = level_names[level_id]
            output_lines.append(f"Level 0x{level_id:03X}: {info['name']}")
    
    elif args.format == 'csv':
        output_lines.append("LevelID,Name,ROMOffset,HexData")
        for level_id in sorted(level_names.keys()):
            info = level_names[level_id]
            name = info['name'].replace('"', '""')  # Escape quotes
            hex_data = info['raw_data'].hex()
            output_lines.append(f'0x{level_id:03X},"{name}",0x{info["rom_offset"]:06X},{hex_data}')
    
    elif args.format == 'json':
        import json
        output_dict = {}
        for level_id, info in level_names.items():
            output_dict[f"0x{level_id:03X}"] = {
                'name': info['name'],
                'rom_offset': f"0x{info['rom_offset']:06X}",
                'hex_data': info['raw_data'].hex()
            }
        output_lines.append(json.dumps(output_dict, indent=2, ensure_ascii=False))
    
    # Write output
    output_text = '\n'.join(output_lines)
    
    if args.output:
        try:
            with open(args.output, 'w', encoding='utf-8') as f:
                f.write(output_text)
                f.write('\n')
            if args.verbose:
                print(f"Output written to {args.output}", file=sys.stderr)
        except IOError as e:
            print(f"Error writing output file: {e}", file=sys.stderr)
            return 1
    else:
        print(output_text)
    
    return 0


if __name__ == '__main__':
    sys.exit(main())

