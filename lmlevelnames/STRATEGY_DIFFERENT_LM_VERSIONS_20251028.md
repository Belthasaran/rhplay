# Strategy: Analyzing Level Names Across Different Lunar Magic Versions
**Date:** October 28, 2025  
**Challenge:** Extract level names from ROMs edited with unknown Lunar Magic versions  
**Test Case:** `Invictus_1.1.sfc`

---

## Executive Summary

**Goal:** Develop a systematic approach to identify and extract level names from SMW ROMs edited with any version of Lunar Magic, even when the specific version is unknown.

**Known Facts:**
- ✅ Invictus uses Lunar Magic's level name system
- ✅ Graphics tiles are encoded the same way
- ❓ Unknown LM version with different storage/compression/options
- ❓ Pointer location or structure may differ
- ❓ Data format or layout may have changed

---

## Phase 1: ASM Hijack Code Analysis

### Objective
Trace the actual code execution to find where level names are really loaded from.

### Method 1.1: Disassemble the Hijack Target

**Current Status:**
```
Hijack at: SNES $048E81
Instruction: $22 (JSL)
Target: $03BB20
```

**Action Plan:**
1. **Disassemble** code starting at SNES `$03BB20` (ROM offset `$019B20`)
2. **Trace** the execution flow to find memory reads
3. **Identify** any pointer loads (LDA/LDX/LDY with absolute addressing)
4. **Find** the actual SNES address where level name data is read from

**Implementation:**
```python
def disassemble_hijack_code(rom_data, header_offset):
    """
    Disassemble the level name hijack code to find data pointers
    """
    hijack_target = 0x03BB20
    rom_offset = snes_to_rom_offset(hijack_target, header_offset)
    
    # Read first 200 bytes of the routine
    code_bytes = rom_data[rom_offset:rom_offset+200]
    
    # Look for pointer loads:
    # - LDA $xxxx (AD xx xx)
    # - LDX $xxxx (AE xx xx)
    # - LDY $xxxx (AC xx xx)
    # - LDA $xxxxxx (AF xx xx xx) - long addressing
    
    pointers_found = []
    
    for i in range(len(code_bytes) - 3):
        # LDA absolute long
        if code_bytes[i] == 0xAF:
            addr = struct.unpack('<I', code_bytes[i+1:i+4] + b'\x00')[0]
            pointers_found.append(('LDA long', addr, i))
        
        # LDA/LDX/LDY absolute
        elif code_bytes[i] in [0xAD, 0xAE, 0xAC]:
            addr = struct.unpack('<H', code_bytes[i+1:i+3])[0]
            # Convert to full SNES address (assume same bank)
            addr_full = addr | ((hijack_target & 0xFF0000))
            pointers_found.append(('LDA/LDX/LDY', addr_full, i))
    
    return pointers_found
```

### Method 1.2: Pattern Recognition in Code

**Look for common patterns in Lunar Magic's level name code:**

```assembly
; Typical pattern 1: Load pointer from fixed location
LDA $03BB57      ; Load low byte of pointer
STA $xx
LDA $03BB58      ; Load middle byte
STA $xx
LDA $03BB59      ; Load bank byte
STA $xx

; Typical pattern 2: Direct long load
LDA $xxxxxx,X    ; Load from pointer + X offset

; Typical pattern 3: Calculate offset
LDA level_id
ASL A            ; Multiply by 2
ASL A            ; ...
ASL A            ; ...
ASL A            ; ...
CLC
ADC base_addr    ; Add to base
```

**Action:** Search for these patterns in the hijack code.

---

## Phase 2: Pointer Location Variations

### Objective
Find where the pointer to level name data is actually stored (may not be `$03BB57`).

### Method 2.1: Search for Known SNES Addresses

Since we found a RATS block at ROM `$08258A` with a pointer at ROM `$025412`:

**Analyze the pointer:**
```
ROM: $025412
SNES: $04D412 (LoROM)
Pointer value: $10A590 (points to the RATS block)
```

**Action Plan:**
1. **Check** if `$04D412` is referenced in the hijack code
2. **Search** for other pointers to `$10A590` in the ROM
3. **Look** for patterns of 3-byte pointers near this location

**Implementation:**
```python
def find_all_pointers_to_address(rom_data, target_snes_addr):
    """
    Find all 3-byte pointers in ROM that point to target SNES address
    """
    target_bytes = struct.pack('<I', target_snes_addr)[:3]
    
    matches = []
    for i in range(len(rom_data) - 3):
        if rom_data[i:i+3] == target_bytes:
            # Calculate SNES address of this pointer location
            bank = (i >> 15) & 0x7F
            local = (i & 0x7FFF) | 0x8000
            pointer_snes = local | (bank << 16)
            
            matches.append({
                'rom_offset': i,
                'snes_addr': pointer_snes,
                'points_to': target_snes_addr
            })
    
    return matches
```

### Method 2.2: Compare with Working ROMs

**Action Plan:**
1. **Take** a working ROM from `testrom/` (e.g., `smw19279_1.sfc`)
2. **Extract** its pointer location and value
3. **Compare** the code at the hijack target
4. **Identify** differences in the code patterns

**Implementation:**
```python
def compare_hijack_implementations(rom1_data, rom1_header, rom2_data, rom2_header):
    """
    Compare two ROMs' level name hijack implementations
    """
    comparison = {}
    
    # Compare hijack targets
    target1 = get_hijack_target(rom1_data, rom1_header)
    target2 = get_hijack_target(rom2_data, rom2_header)
    
    comparison['hijack_targets'] = {
        'rom1': target1,
        'rom2': target2,
        'same': target1 == target2
    }
    
    # Compare pointer locations and values
    ptr1 = get_pointer_at_standard_location(rom1_data, rom1_header)
    ptr2 = get_pointer_at_standard_location(rom2_data, rom2_header)
    
    comparison['pointers'] = {
        'rom1': ptr1,
        'rom2': ptr2,
        'same': ptr1 == ptr2
    }
    
    # Compare code at hijack targets
    code1 = get_code_at_address(rom1_data, rom1_header, target1, 100)
    code2 = get_code_at_address(rom2_data, rom2_header, target2, 100)
    
    comparison['code_similarity'] = calculate_similarity(code1, code2)
    
    return comparison
```

---

## Phase 3: Data Block Discovery

### Objective
Find the actual level name data block, even if not using standard RATS tags or pointers.

### Method 3.1: Statistical Analysis

**Level name data has distinctive statistical properties:**

1. **Byte frequency:** High frequency of `$FC` (blank space)
2. **Letter tiles:** Frequent use of `$00-$19` (A-Z)
3. **Block size:** Multiple of 19 bytes
4. **Repeating patterns:** Empty levels = 19× `$FC`

**Implementation:**
```python
def score_level_name_likelihood(data_chunk):
    """
    Score a data chunk on how likely it is to be level name data
    Score: 0-100, higher = more likely
    """
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
    if entropy < 4.0:  # Lower entropy suggests text
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

def scan_rom_for_level_names(rom_data, min_score=60):
    """
    Scan entire ROM for blocks that look like level name data
    """
    candidates = []
    
    # Scan in 19-byte chunks
    for offset in range(0, len(rom_data) - 1000, 19):
        # Sample 50 level names (950 bytes)
        sample = rom_data[offset:offset+950]
        
        score = score_level_name_likelihood(sample)
        
        if score >= min_score:
            candidates.append({
                'offset': offset,
                'score': score,
                'sample': sample[:57]  # First 3 level names
            })
    
    return sorted(candidates, key=lambda x: x['score'], reverse=True)
```

### Method 3.2: Pattern Matching

**Search for known level name patterns:**

```python
def search_for_vanilla_names(rom_data, tile_map):
    """
    Search for vanilla SMW level names in tile format
    This helps identify the level name block even with unknown pointer
    """
    vanilla_names = [
        "YOSHI'S HOUSE",
        "YOSHI'S ISLAND 1",
        "YELLOW SWITCH PALACE",
        "DONUT PLAINS 1",
        "TOP SECRET AREA",
        "DONUT SECRET 1"
    ]
    
    # Convert to tile bytes
    vanilla_patterns = []
    for name in vanilla_names:
        tile_bytes = text_to_tiles(name, tile_map)
        # Pad to 19 bytes with $FC
        tile_bytes += b'\xFC' * (19 - len(tile_bytes))
        vanilla_patterns.append(tile_bytes)
    
    # Search ROM for these patterns
    matches = []
    for pattern in vanilla_patterns:
        for i in range(len(rom_data) - len(pattern)):
            if rom_data[i:i+len(pattern)] == pattern:
                matches.append({
                    'offset': i,
                    'name': tiles_to_text(pattern, tile_map),
                    'level_index': i // 19  # Estimate which level slot
                })
    
    return matches
```

---

## Phase 4: Data Format Variations

### Objective
Handle different compression, packing, or storage formats.

### Method 4.1: Check for Compression

**Different LM versions might compress level name data:**

```python
def detect_compression_format(data):
    """
    Detect if data is compressed and identify format
    """
    # Check for LC_LZ2 compression (common in SNES)
    if data[0:4] == b'LZ2\x00':
        return 'LC_LZ2'
    
    # Check for LZ77 compression
    if data[0] == 0x10:
        return 'LZ77'
    
    # Check for RLE (simple pattern repetition)
    # Look for control bytes followed by data
    if has_rle_pattern(data):
        return 'RLE'
    
    # Check entropy - compressed data has high entropy
    entropy = calculate_entropy(data[:1000])
    if entropy > 7.0:
        return 'Unknown_Compression'
    
    return 'Uncompressed'

def try_decompress(data, format):
    """
    Attempt to decompress data in various formats
    """
    if format == 'LC_LZ2':
        return decompress_lc_lz2(data)
    elif format == 'LZ77':
        return decompress_lz77(data)
    elif format == 'RLE':
        return decompress_rle(data)
    
    return data  # Return as-is if unknown
```

### Method 4.2: Different Block Structures

**Check for variations in how level name blocks are organized:**

1. **Single vs. Dual Block:**
   - Standard: 0x000-0x0FF in one block, 0x100-0x1FF in another
   - Alternative: All levels in single contiguous block
   - Alternative: Multiple smaller blocks by world/area

2. **Variable Length Names:**
   - Standard: Fixed 19 bytes per name
   - Alternative: Null-terminated strings in variable positions
   - Alternative: Length-prefixed strings

3. **Indexed vs. Sequential:**
   - Standard: Sequential order (level 0, 1, 2, ...)
   - Alternative: Indexed with level ID before each name
   - Alternative: Sparse array with offset table

```python
def detect_block_structure(data):
    """
    Analyze data to determine block structure
    """
    analysis = {}
    
    # Test 1: Fixed 19-byte structure
    empty_count = 0
    valid_count = 0
    for i in range(0, min(len(data), 19*100), 19):
        chunk = data[i:i+19]
        if chunk == b'\xFC' * 19:
            empty_count += 1
        elif score_level_name_likelihood(chunk) > 50:
            valid_count += 1
    
    analysis['fixed_19byte'] = {
        'likely': valid_count > 10,
        'confidence': valid_count / 100 if valid_count > 0 else 0
    }
    
    # Test 2: Null-terminated strings
    null_positions = [i for i, b in enumerate(data[:1000]) if b == 0x00]
    avg_distance = np.mean(np.diff(null_positions)) if len(null_positions) > 1 else 0
    
    analysis['null_terminated'] = {
        'likely': 10 < avg_distance < 30,
        'avg_length': avg_distance
    }
    
    # Test 3: Length-prefixed
    # Check if first byte of each chunk predicts chunk content
    length_match_count = 0
    for i in range(0, min(len(data), 500), 20):
        length = data[i]
        if 0 < length < 20:
            # Check if next 'length' bytes look like text
            chunk = data[i+1:i+1+length]
            if score_level_name_likelihood(chunk) > 50:
                length_match_count += 1
    
    analysis['length_prefixed'] = {
        'likely': length_match_count > 5,
        'matches': length_match_count
    }
    
    return analysis
```

---

## Phase 5: Systematic Approach for Unknown Versions

### Complete Analysis Pipeline

```python
class LunarMagicLevelNameAnalyzer:
    """
    Comprehensive analyzer for level names across all LM versions
    """
    
    def __init__(self, rom_path):
        self.rom_data = self.load_rom(rom_path)
        self.header_offset = detect_header(self.rom_data)
        self.analysis_results = {}
    
    def analyze(self):
        """
        Run complete analysis pipeline
        """
        print("Starting Level Name Analysis...")
        
        # Step 1: Check standard implementation
        print("\n[1/6] Checking standard Lunar Magic implementation...")
        self.check_standard_implementation()
        
        # Step 2: Disassemble hijack code
        print("\n[2/6] Analyzing ASM hijack code...")
        self.analyze_hijack_code()
        
        # Step 3: Search for pointer variations
        print("\n[3/6] Searching for pointer locations...")
        self.find_pointer_locations()
        
        # Step 4: Scan for data blocks
        print("\n[4/6] Scanning ROM for level name data...")
        self.scan_for_data_blocks()
        
        # Step 5: Analyze data format
        print("\n[5/6] Analyzing data format...")
        self.analyze_data_format()
        
        # Step 6: Generate extraction strategy
        print("\n[6/6] Generating extraction strategy...")
        self.generate_extraction_strategy()
        
        return self.analysis_results
    
    def check_standard_implementation(self):
        """Step 1: Check if standard LM implementation works"""
        hijack_ok = check_level_names_patch(self.rom_data, self.header_offset)
        pointer_valid = check_pointer_validity(self.rom_data, self.header_offset)
        
        self.analysis_results['standard'] = {
            'hijack_installed': hijack_ok[0],
            'hijack_target': hijack_ok[1],
            'pointer_valid': pointer_valid,
            'works': hijack_ok[0] and pointer_valid
        }
    
    def analyze_hijack_code(self):
        """Step 2: Disassemble and analyze the hijack code"""
        pointers = disassemble_hijack_code(self.rom_data, self.header_offset)
        
        self.analysis_results['hijack_analysis'] = {
            'pointers_found': pointers,
            'likely_data_locations': [p[1] for p in pointers if 0x008000 < p[1] < 0x400000]
        }
    
    def find_pointer_locations(self):
        """Step 3: Search for all possible pointer locations"""
        # Search RATS blocks
        rats_blocks = find_rats_tags(self.rom_data)
        level_name_candidates = []
        
        for offset, size in rats_blocks:
            if size % 19 == 0 and 1000 < size < 100000:
                score = score_level_name_likelihood(
                    self.rom_data[offset+6:offset+6+950]
                )
                if score > 40:
                    level_name_candidates.append({
                        'offset': offset,
                        'size': size,
                        'score': score
                    })
        
        self.analysis_results['data_blocks'] = level_name_candidates
    
    def scan_for_data_blocks(self):
        """Step 4: Statistical scan for level name data"""
        candidates = scan_rom_for_level_names(self.rom_data, min_score=60)
        
        self.analysis_results['scan_results'] = candidates[:20]  # Top 20
    
    def analyze_data_format(self):
        """Step 5: Analyze format of found data blocks"""
        if 'data_blocks' in self.analysis_results:
            for block in self.analysis_results['data_blocks'][:5]:
                offset = block['offset'] + 6  # Skip RATS header
                data = self.rom_data[offset:offset+2000]
                
                block['format_analysis'] = {
                    'compression': detect_compression_format(data),
                    'structure': detect_block_structure(data),
                    'sample_decoded': self.try_decode_sample(data)
                }
    
    def try_decode_sample(self, data):
        """Try to decode first few level names with default tile map"""
        decoded = []
        for i in range(5):
            chunk = data[i*19:(i+1)*19]
            text = decode_tile_data(chunk, DEFAULT_TILE_MAP, False)
            decoded.append(f"Level {i}: {text}")
        return decoded
    
    def generate_extraction_strategy(self):
        """Step 6: Generate specific extraction instructions"""
        strategy = []
        
        # Determine best approach based on analysis
        if self.analysis_results['standard']['works']:
            strategy.append("✓ Use standard extraction method")
        else:
            # Find best candidate
            candidates = self.analysis_results.get('data_blocks', [])
            if candidates:
                best = max(candidates, key=lambda x: x['score'])
                strategy.append(f"→ Use custom block at ROM 0x{best['offset']:06X}")
                strategy.append(f"  Size: {best['size']} bytes")
                strategy.append(f"  Confidence: {best['score']:.1f}%")
            
            # Check if pointer relocation needed
            hijack_pointers = self.analysis_results.get('hijack_analysis', {}).get('pointers_found', [])
            if hijack_pointers:
                strategy.append(f"→ Pointer may be at: {hijack_pointers[0][1]:06X}")
        
        self.analysis_results['strategy'] = strategy
        
        return strategy
```

---

## Phase 6: Implementation for Invictus

### Immediate Action Plan

1. **Run the analyzer:**
```python
analyzer = LunarMagicLevelNameAnalyzer('Invictus_1.1.sfc')
results = analyzer.analyze()
print_analysis_report(results)
```

2. **Test top candidates:**
   - Try extracting from each high-scoring data block
   - Decode with standard tile mapping
   - Compare against known Invictus level names (if any available)

3. **Verify extraction:**
   - Check if decoded names make sense
   - Look for patterns (world names, level numbers, etc.)
   - Validate against ROM hack descriptions/screenshots

### Testing Approach

```python
def test_extraction_candidates(rom_data, candidates, tile_map):
    """
    Test each candidate location and score results
    """
    results = []
    
    for candidate in candidates[:10]:  # Test top 10
        offset = candidate['offset']
        if 'RATS' in candidate:
            offset += 6  # Skip RATS header
        
        # Try extracting 20 level names
        level_names = []
        for i in range(20):
            chunk = rom_data[offset + (i*19):offset + ((i+1)*19)]
            decoded = decode_tile_data(chunk, tile_map, False)
            level_names.append(decoded)
        
        # Score the results
        score = score_extracted_names(level_names)
        
        results.append({
            'offset': offset,
            'score': score,
            'samples': level_names[:5],
            'stats': {
                'readable': sum(1 for n in level_names if is_readable(n)),
                'empty': sum(1 for n in level_names if n.strip() == ''),
                'garbage': sum(1 for n in level_names if is_garbage(n))
            }
        })
    
    return sorted(results, key=lambda x: x['score'], reverse=True)

def is_readable(text):
    """Check if text looks like a readable level name"""
    # Has letters
    has_letters = any(c.isalpha() for c in text)
    # Not too much garbage
    garbage_ratio = sum(1 for c in text if c in '!@#$%^&*()[]{}') / len(text)
    # Not all spaces
    not_empty = text.strip() != ''
    
    return has_letters and garbage_ratio < 0.5 and not_empty

def is_garbage(text):
    """Check if text is mostly garbage"""
    # Too many special chars
    special_count = sum(1 for c in text if not c.isalnum() and c not in ' -.,!?')
    # Or too many repeated chars
    has_repeats = any(text.count(c) > 10 for c in set(text))
    
    return special_count > len(text) * 0.7 or has_repeats
```

---

## Phase 7: Building a Universal Extractor

### Goal
Create an enhanced script that works with any LM version.

### Features to Add

1. **Auto-detection mode:**
```python
def extract_level_names_auto(rom_path):
    """
    Automatically detect and extract level names regardless of LM version
    """
    analyzer = LunarMagicLevelNameAnalyzer(rom_path)
    results = analyzer.analyze()
    
    # Try standard method first
    if results['standard']['works']:
        return extract_standard(rom_path)
    
    # Use best alternative
    best_block = max(results['data_blocks'], key=lambda x: x['score'])
    return extract_from_offset(rom_path, best_block['offset'])
```

2. **Multiple extraction methods:**
```python
--method standard     # Current implementation
--method auto         # Auto-detect best method
--method scan         # Scan entire ROM
--method offset 0xXXXX  # Extract from specific offset
--method compare      # Compare with reference ROM
```

3. **Confidence scoring:**
```python
# Report confidence level for each extraction
Level 0x001: "YOSHI'S HOUSE" (confidence: 95%)
Level 0x002: "cYkGcDUcOVc" (confidence: 15% - LIKELY INVALID)
```

4. **Interactive mode:**
```python
--interactive  # Prompt user to verify/correct extractions
```

---

## Deliverables

### 1. Enhanced Analysis Script: `analyze_lm_version.py`
Complete implementation of the `LunarMagicLevelNameAnalyzer` class.

### 2. Universal Extractor: `levelname_extractor3.py`
Enhanced version of the extractor with auto-detection support.

### 3. Comparison Tool: `compare_lm_implementations.py`
Compare multiple ROMs to identify LM version differences.

### 4. Documentation: `LM_VERSION_DIFFERENCES.md`
Document known differences between LM versions.

---

## Timeline

**Immediate (Next Steps):**
1. Create `analyze_lm_version.py` script
2. Run analysis on Invictus_1.1.sfc
3. Identify actual level name location
4. Test extraction

**Short-term (This Session):**
1. Create comparison with working testrom ROMs
2. Document differences found
3. Implement fixes in extractor

**Medium-term (Future Enhancement):**
1. Build database of LM version signatures
2. Create universal extractor
3. Test on more unknown-version ROMs

---

## Success Criteria

✅ **Phase Complete When:**
1. We can extract readable level names from Invictus_1.1.sfc
2. We understand what's different about this LM version
3. We have a systematic approach for other unknown-version ROMs
4. The extractor can auto-detect and handle this variation

---

**Status:** Ready to implement  
**Next Action:** Create and run `analyze_lm_version.py` on Invictus_1.1.sfc


