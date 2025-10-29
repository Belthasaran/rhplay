#!/usr/bin/env python3
"""
Lunar Magic Version Analyzer
Analyzes ROMs to detect and extract level names across different LM versions
"""

import struct
import sys
from collections import Counter
import math

# Import tile mapping from levelname_extractor2
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

def detect_header(rom_data):
    """Detect if ROM has a 512-byte header"""
    rom_size = len(rom_data)
    if rom_size % 1024 == 512:
        return 512
    return 0

def snes_to_rom_offset(snes_address, header_offset):
    """Convert SNES LoROM address to ROM offset"""
    rom_offset = (snes_address & 0x7FFF) + ((snes_address & 0xFF0000) >> 1)
    return rom_offset + header_offset

def check_level_names_patch(rom_data, header_offset):
    """Check if Lunar Magic level names patch is installed"""
    hijack_offset = snes_to_rom_offset(0x048E81, header_offset)
    
    if hijack_offset >= len(rom_data):
        return False, None
    
    instruction = rom_data[hijack_offset]
    
    if instruction != 0x22:
        return False, None
    
    if hijack_offset + 4 > len(rom_data):
        return False, None
    
    target_address = struct.unpack('<I', rom_data[hijack_offset+1:hijack_offset+4] + b'\x00')[0]
    
    return True, target_address

def find_rats_tags(rom_data):
    """Find all RATS tags in the ROM"""
    rats_tags = []
    
    for i in range(0, len(rom_data) - 6):
        if rom_data[i:i+4] == b'STAR':
            size_bytes = rom_data[i+4:i+6]
            size = struct.unpack('<H', size_bytes)[0] ^ 0xFFFF
            rats_tags.append((i, size))
    
    return rats_tags

def calculate_entropy(data):
    """Calculate Shannon entropy of data"""
    if not data:
        return 0
    
    byte_counts = Counter(data)
    total = len(data)
    
    entropy = 0
    for count in byte_counts.values():
        if count > 0:
            prob = count / total
            entropy -= prob * math.log2(prob)
    
    return entropy

def score_level_name_likelihood(data_chunk):
    """Score how likely a data chunk is to be level name data (0-100)"""
    if len(data_chunk) < 19:
        return 0
    
    score = 0
    
    # Check 1: Byte frequency (0-30 points)
    byte_freq = Counter(data_chunk)
    blank_tiles = byte_freq.get(0xFC, 0)
    blank_ratio = blank_tiles / len(data_chunk)
    score += blank_ratio * 30
    
    # Check 2: Letter tiles present (0-25 points)
    letter_tiles = sum(byte_freq.get(i, 0) for i in range(0x00, 0x1A))
    letter_ratio = letter_tiles / len(data_chunk)
    score += letter_ratio * 25
    
    # Check 3: Low entropy (text has patterns) (0-20 points)
    entropy = calculate_entropy(data_chunk)
    if entropy < 4.0:
        score += (4.0 - entropy) * 5
    
    # Check 4: Valid tile range (0-15 points)
    valid_tiles = sum(1 for b in data_chunk if b < 0xFD)
    valid_ratio = valid_tiles / len(data_chunk)
    score += valid_ratio * 15
    
    # Check 5: No common code patterns (0-10 points)
    code_bytes = [0x4C, 0x20, 0x60, 0x22, 0xA9, 0x8D, 0xAD, 0x85]
    code_count = sum(1 for b in data_chunk if b in code_bytes)
    code_ratio = code_count / len(data_chunk)
    score += (1 - code_ratio) * 10
    
    return min(score, 100)

def decode_tile_data(tile_bytes, tile_map):
    """Decode tile bytes to text"""
    decoded = []
    for byte in tile_bytes:
        if byte in tile_map:
            decoded.append(tile_map[byte])
        else:
            decoded.append(chr(byte) if 32 <= byte < 127 else '?')
    return ''.join(decoded).rstrip()

def disassemble_pointer_loads(rom_data, start_offset, length=200):
    """Find pointer loads in code"""
    pointers = []
    
    for i in range(length - 3):
        offset = start_offset + i
        if offset + 4 > len(rom_data):
            break
        
        # LDA absolute long (AF xx xx xx)
        if rom_data[offset] == 0xAF:
            addr = struct.unpack('<I', rom_data[offset+1:offset+4] + b'\x00')[0]
            pointers.append(('LDA_LONG', addr, i))
        
        # LDA absolute (AD xx xx)
        elif rom_data[offset] == 0xAD:
            addr = struct.unpack('<H', rom_data[offset+1:offset+3])[0]
            pointers.append(('LDA_ABS', addr, i))
        
        # LDX absolute (AE xx xx)
        elif rom_data[offset] == 0xAE:
            addr = struct.unpack('<H', rom_data[offset+1:offset+3])[0]
            pointers.append(('LDX_ABS', addr, i))
        
        # LDY absolute (AC xx xx)
        elif rom_data[offset] == 0xAC:
            addr = struct.unpack('<H', rom_data[offset+1:offset+3])[0]
            pointers.append(('LDY_ABS', addr, i))
    
    return pointers

class LunarMagicLevelNameAnalyzer:
    """Comprehensive analyzer for level names across all LM versions"""
    
    def __init__(self, rom_path):
        self.rom_path = rom_path
        with open(rom_path, 'rb') as f:
            self.rom_data = bytearray(f.read())
        self.header_offset = detect_header(self.rom_data)
        self.analysis_results = {}
    
    def analyze(self):
        """Run complete analysis pipeline"""
        print(f"Analyzing ROM: {self.rom_path}")
        print(f"ROM Size: {len(self.rom_data):,} bytes")
        print(f"Header: {'Yes (512 bytes)' if self.header_offset else 'No'}")
        print()
        
        print("=" * 80)
        print("[1/6] Checking standard Lunar Magic implementation...")
        print("=" * 80)
        self.check_standard_implementation()
        
        print("\n" + "=" * 80)
        print("[2/6] Analyzing ASM hijack code...")
        print("=" * 80)
        self.analyze_hijack_code()
        
        print("\n" + "=" * 80)
        print("[3/6] Searching for RATS-tagged data blocks...")
        print("=" * 80)
        self.find_rats_blocks()
        
        print("\n" + "=" * 80)
        print("[4/6] Scanning ROM for level name data patterns...")
        print("=" * 80)
        self.scan_for_data_blocks()
        
        print("\n" + "=" * 80)
        print("[5/6] Testing extraction from top candidates...")
        print("=" * 80)
        self.test_extraction()
        
        print("\n" + "=" * 80)
        print("[6/6] Generating extraction strategy...")
        print("=" * 80)
        self.generate_strategy()
        
        return self.analysis_results
    
    def check_standard_implementation(self):
        """Check if standard LM implementation works"""
        hijack_ok, hijack_target = check_level_names_patch(self.rom_data, self.header_offset)
        
        print(f"ASM Hijack at $048E81: {'FOUND' if hijack_ok else 'NOT FOUND'}")
        if hijack_ok:
            print(f"  Target: ${hijack_target:06X}")
        
        # Check pointer at standard location
        pointer_location = snes_to_rom_offset(0x03BB57, self.header_offset)
        if pointer_location + 3 <= len(self.rom_data):
            pointer_bytes = self.rom_data[pointer_location:pointer_location+3]
            pointer_snes = struct.unpack('<I', pointer_bytes + b'\x00')[0]
            pointer_rom = snes_to_rom_offset(pointer_snes, self.header_offset)
            pointer_valid = 0 <= pointer_rom < len(self.rom_data)
            
            print(f"Pointer at $03BB57: ${pointer_snes:06X}")
            print(f"  Points to ROM offset: ${pointer_rom:06X}")
            print(f"  Valid: {'YES' if pointer_valid else 'NO (beyond ROM!)'}")
            
            self.analysis_results['standard'] = {
                'hijack_installed': hijack_ok,
                'hijack_target': hijack_target,
                'pointer_location': pointer_location,
                'pointer_value': pointer_snes,
                'pointer_rom_offset': pointer_rom,
                'pointer_valid': pointer_valid,
                'works': hijack_ok and pointer_valid
            }
        else:
            self.analysis_results['standard'] = {
                'hijack_installed': hijack_ok,
                'works': False
            }
    
    def analyze_hijack_code(self):
        """Disassemble and analyze the hijack code"""
        if not self.analysis_results['standard']['hijack_installed']:
            print("No hijack installed - skipping code analysis")
            return
        
        hijack_target = self.analysis_results['standard']['hijack_target']
        hijack_rom = snes_to_rom_offset(hijack_target, self.header_offset)
        
        print(f"Disassembling code at SNES ${hijack_target:06X} (ROM ${hijack_rom:06X})...")
        
        pointers = disassemble_pointer_loads(self.rom_data, hijack_rom, 200)
        
        print(f"Found {len(pointers)} pointer load instructions:")
        for instr, addr, offset in pointers[:10]:
            print(f"  {instr:12s} ${addr:06X} at offset +{offset}")
        
        # Filter for likely data pointers (in ROM range)
        likely_data = [p for p in pointers if 0x008000 <= p[1] < 0x400000]
        
        self.analysis_results['hijack_analysis'] = {
            'all_pointers': pointers,
            'likely_data_pointers': likely_data,
            'code_offset': hijack_rom
        }
    
    def find_rats_blocks(self):
        """Find and analyze RATS-tagged blocks"""
        print("Searching for RATS tags...")
        rats_tags = find_rats_tags(self.rom_data)
        print(f"Found {len(rats_tags)} RATS tags total")
        
        # Filter for potential level name blocks
        candidates = []
        for offset, size in rats_tags:
            # Must be multiple of 19 and reasonable size
            if size % 19 == 0 and 1000 < size < 100000:
                data_start = offset + 6
                sample = self.rom_data[data_start:data_start+950]
                score = score_level_name_likelihood(sample)
                
                if score > 30:  # Lower threshold to catch more candidates
                    candidates.append({
                        'offset': offset,
                        'data_offset': data_start,
                        'size': size,
                        'num_names': size // 19,
                        'score': score
                    })
        
        candidates.sort(key=lambda x: x['score'], reverse=True)
        
        print(f"Found {len(candidates)} potential level name blocks:")
        for i, cand in enumerate(candidates[:10]):
            print(f"  {i+1}. ROM ${cand['offset']:06X} - {cand['num_names']} names, score: {cand['score']:.1f}")
        
        self.analysis_results['rats_candidates'] = candidates
    
    def scan_for_data_blocks(self):
        """Scan entire ROM for level name patterns"""
        print("Scanning ROM for level name patterns (this may take a moment)...")
        
        candidates = []
        scan_step = 19  # Scan every 19 bytes (level name size)
        
        for offset in range(0, len(self.rom_data) - 1000, scan_step):
            sample = self.rom_data[offset:offset+950]  # 50 level names
            score = score_level_name_likelihood(sample)
            
            if score >= 50:  # High threshold for non-RATS blocks
                candidates.append({
                    'offset': offset,
                    'score': score,
                    'has_rats': self.rom_data[max(0, offset-6):offset-2] == b'STAR'
                })
        
        candidates.sort(key=lambda x: x['score'], reverse=True)
        
        print(f"Found {len(candidates)} high-scoring regions:")
        for i, cand in enumerate(candidates[:10]):
            rats_str = " [RATS]" if cand['has_rats'] else ""
            print(f"  {i+1}. ROM ${cand['offset']:06X} - score: {cand['score']:.1f}{rats_str}")
        
        self.analysis_results['scan_candidates'] = candidates
    
    def test_extraction(self):
        """Test extraction from top candidates"""
        # Combine all candidates
        all_candidates = []
        
        if 'rats_candidates' in self.analysis_results:
            for c in self.analysis_results['rats_candidates'][:5]:
                all_candidates.append({
                    'offset': c['data_offset'],
                    'score': c['score'],
                    'source': 'RATS'
                })
        
        if 'scan_candidates' in self.analysis_results:
            for c in self.analysis_results['scan_candidates'][:5]:
                if not any(abs(c['offset'] - x['offset']) < 100 for x in all_candidates):
                    all_candidates.append({
                        'offset': c['offset'],
                        'score': c['score'],
                        'source': 'SCAN'
                    })
        
        print(f"Testing extraction from {len(all_candidates)} candidates...\n")
        
        results = []
        for cand in all_candidates[:10]:
            offset = cand['offset']
            
            # Extract 10 level names
            level_names = []
            for i in range(10):
                chunk = self.rom_data[offset + (i*19):offset + ((i+1)*19)]
                decoded = decode_tile_data(chunk, DEFAULT_TILE_MAP)
                level_names.append(decoded)
            
            # Score results
            readable = sum(1 for n in level_names if self.is_readable(n))
            empty = sum(1 for n in level_names if not n.strip())
            garbage = sum(1 for n in level_names if self.is_garbage(n))
            
            extraction_score = (readable * 10) + (empty * 2) - (garbage * 5)
            
            results.append({
                'offset': offset,
                'source': cand['source'],
                'data_score': cand['score'],
                'extraction_score': extraction_score,
                'samples': level_names[:5],
                'stats': {
                    'readable': readable,
                    'empty': empty,
                    'garbage': garbage
                }
            })
        
        results.sort(key=lambda x: x['extraction_score'], reverse=True)
        
        for i, res in enumerate(results[:5]):
            print(f"{i+1}. ROM ${res['offset']:06X} [{res['source']}]")
            print(f"   Data score: {res['data_score']:.1f}, Extraction score: {res['extraction_score']}")
            print(f"   Readable: {res['stats']['readable']}/10, Empty: {res['stats']['empty']}/10, Garbage: {res['stats']['garbage']}/10")
            print(f"   Samples:")
            for j, sample in enumerate(res['samples']):
                print(f"     Level {j}: {sample}")
            print()
        
        self.analysis_results['extraction_tests'] = results
    
    def is_readable(self, text):
        """Check if text looks readable"""
        if not text.strip():
            return False
        has_letters = any(c.isalpha() for c in text)
        garbage_chars = sum(1 for c in text if ord(c) > 127 or (not c.isalnum() and c not in ' -.,!?()\'/#:'))
        return has_letters and garbage_chars < len(text) * 0.3
    
    def is_garbage(self, text):
        """Check if text is mostly garbage"""
        if not text.strip():
            return False
        special_count = sum(1 for c in text if ord(c) > 127 or c == '?')
        has_repeats = any(text.count(c) > 10 for c in set(text))
        return special_count > len(text) * 0.5 or has_repeats
    
    def generate_strategy(self):
        """Generate extraction strategy"""
        strategy = []
        
        if self.analysis_results['standard']['works']:
            strategy.append("STRATEGY: Use standard extraction method")
            strategy.append(f"  Pointer at $03BB57 is valid")
        else:
            print("Standard method does NOT work for this ROM")
            print()
            
            if 'extraction_tests' in self.analysis_results and self.analysis_results['extraction_tests']:
                best = self.analysis_results['extraction_tests'][0]
                
                if best['extraction_score'] > 20:
                    strategy.append("STRATEGY: Use custom offset extraction")
                    strategy.append(f"  Extract from ROM offset: ${best['offset']:06X}")
                    strategy.append(f"  Confidence: HIGH (score: {best['extraction_score']})")
                    strategy.append(f"  Source: {best['source']}")
                    strategy.append("")
                    strategy.append("Sample output:")
                    for i, sample in enumerate(best['samples']):
                        strategy.append(f"  Level {i}: {sample}")
                else:
                    strategy.append("STRATEGY: Unable to reliably extract level names")
                    strategy.append("  No candidates scored high enough")
                    strategy.append("  Manual investigation required")
            else:
                strategy.append("STRATEGY: Unable to find level name data")
                strategy.append("  No viable candidates found")
        
        print("\n" + "=" * 80)
        print("RECOMMENDED EXTRACTION STRATEGY")
        print("=" * 80)
        for line in strategy:
            print(line)
        print()
        
        self.analysis_results['strategy'] = strategy
        
        return strategy

def main():
    if len(sys.argv) < 2:
        print("Usage: python analyze_lm_version.py <rom_file>")
        sys.exit(1)
    
    rom_path = sys.argv[1]
    
    analyzer = LunarMagicLevelNameAnalyzer(rom_path)
    results = analyzer.analyze()
    
    print("\n" + "=" * 80)
    print("ANALYSIS COMPLETE")
    print("=" * 80)
    print(f"Results saved in analysis object")
    print()

if __name__ == '__main__':
    main()

