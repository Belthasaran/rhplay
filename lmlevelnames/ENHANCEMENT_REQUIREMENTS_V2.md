# Level Name Extractor V2 Enhancement Requirements
**Date:** October 28, 2025
**Status:** Implementation Guide

---

## Required Changes

### 1. `--novanilla` Enhancement
**Current:** Requires vanilla ROM at runtime  
**New:** Use hardcoded vanilla names from `vanilla_names.txt`

**Implementation:**
- Load `vanilla_names.txt` at start and parse into dictionary
- Format: `Level 0xXXX: NAME`
- Store as `{level_id: name}` dictionary
- No ROM file needed at runtime

**Code Location:** Add after DEFAULT_TILE_MAP, before functions

```python
# Hardcoded vanilla level names (from orig_lm333_noedits.sfc)
VANILLA_LEVEL_NAMES = {}

def load_vanilla_names_from_file(filename='vanilla_names.txt'):
    """Load vanilla names from embedded file or external file."""
    vanilla_names = {}
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            for line in f:
                # Parse: Level 0xXXX: NAME
                if line.startswith('Level 0x'):
                    parts = line.strip().split(': ', 1)
                    if len(parts) == 2:
                        level_id_str = parts[0].replace('Level 0x', '')
                        level_id = int(level_id_str, 16)
                        name = parts[1]
                        vanilla_names[level_id] = name
    except FileNotFoundError:
        pass  # Use empty dict if file not found
    return vanilla_names

# Load at module level
VANILLA_LEVEL_NAMES = load_vanilla_names_from_file()
```

###2. `--editedonly` Enhancement
**Current:** Compares level names only  
**New:** Compare actual level data content

**Implementation:**
- Need to add function to read level data from ROM
- SMW level data is stored separately from level names
- Compare level data hashes between target ROM and vanilla ROM

**Level Data Location in SMW:**
- Level pointer table at ROM offset `0x05D7E (headerless) / 0x05F7E (headered)`
- 3-byte pointers to level data
- Level data is compressed

**Code Addition:**

```python
def get_level_data_hash(rom_data, header_offset, level_id):
    """Get hash of level data for comparison."""
    # Level pointer table location
    LEVEL_POINTER_TABLE = 0x05D7E
    
    pointer_addr = snes_to_rom_offset(LEVEL_POINTER_TABLE, header_offset) + (level_id * 3)
    
    if pointer_addr + 3 > len(rom_data):
        return None
    
    # Read 24-bit pointer
    level_data_ptr = (rom_data[pointer_addr] |
                      rom_data[pointer_addr + 1] << 8 |
                      rom_data[pointer_addr + 2] << 16)
    
    # Convert to ROM offset
    level_data_offset = snes_to_rom_offset(level_data_ptr, header_offset)
    
    # Read up to 1KB of level data (compressed)
    if level_data_offset + 1024 > len(rom_data):
        return None
    
    level_data = rom_data[level_data_offset:level_data_offset + 1024]
    
    # Return hash
    return hashlib.md5(level_data).hexdigest()

def check_level_edited(rom_data, vanilla_rom_data, header_offset, vanilla_header_offset, level_id):
    """Check if level data has been edited."""
    target_hash = get_level_data_hash(rom_data, header_offset, level_id)
    vanilla_hash = get_level_data_hash(vanilla_rom_data, vanilla_header_offset, level_id)
    
    if target_hash is None or vanilla_hash is None:
        return False  # Can't determine, assume not edited
    
    return target_hash != vanilla_hash
```

**Modify filter_level_names function:**
```python
# In filter_level_names():
# For edited_only:
if edited_only and rom_data and vanilla_rom_data:
    if not check_level_edited(rom_data, vanilla_rom_data, header_offset, vanilla_header_offset, level_id):
        continue  # Skip if level data not edited
```

**Modify main() to load vanilla ROM:**
```python
# After loading target ROM:
vanilla_rom_data = None
vanilla_header_offset = 0

if args.editedonly:
    vanilla_rom_path = args.vanilla_rom or 'smw.sfc'  # Vanilla SMW ROM
    try:
        with open(vanilla_rom_path, 'rb') as f:
            vanilla_rom_data = f.read()
        _, vanilla_header_offset = detect_header(vanilla_rom_data)
    except (FileNotFoundError, IOError):
        if args.verbose:
            print(f"Warning: Could not load vanilla ROM for level data comparison", file=sys.stderr)
```

### 3. `--levelsonly` Filter
**New Feature:** Filter out message box text and extraneous content

**Implementation:**
- Load extraneous text lists from files
- Filter level IDs that are known message box content
- Three sources: vanilla, per-ROM extraneous lists

**Code Addition:**

```python
def load_extraneous_ids(filename):
    """Load extraneous level IDs from file."""
    extraneous_ids = set()
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            for line in f:
                # Parse: Level 0xXXX: ...
                if line.startswith('Level 0x'):
                    level_id_str = line.split(':')[0].replace('Level 0x', '')
                    level_id = int(level_id_str, 16)
                    extraneous_ids.add(level_id)
    except FileNotFoundError:
        pass
    return extraneous_ids

# Hardcoded extraneous ranges (message boxes typically in these ranges)
VANILLA_EXTRANEOUS_IDS = load_extraneous_ids('vanilla_extraneous.txt')

def is_extraneous_text(level_id, rom_file, extraneous_ids):
    """Check if level ID is extraneous (message box text)."""
    # Check hardcoded vanilla extraneous
    if level_id in VANILLA_EXTRANEOUS_IDS:
        return True
    
    # Check ROM-specific extraneous
    if level_id in extraneous_ids:
        return True
    
    # Heuristic: Level IDs > 0x060 and < 0x100 are often message boxes in vanilla
    # Level IDs > 0x1DA often extraneous in extended ROMs
    return False
```

**Modify filter_level_names:**
```python
def filter_level_names(
    level_names: Dict[int, Dict],
    ...,
    levels_only: bool = False,
    extraneous_ids: Optional[Set[int]] = None,
    rom_file: str = ''
) -> Dict[int, Dict]:
    """Filter level names..."""
    
    for level_id, info in level_names.items():
        ...
        
        # Filter: levels only (exclude extraneous text)
        if levels_only:
            if is_extraneous_text(level_id, rom_file, extraneous_ids or set()):
                continue  # Skip extraneous
        
        ...
```

**Add command-line argument:**
```python
parser.add_argument('--levelsonly', action='store_true',
                   help='Filter out message box text and extraneous content')
```

**In main(), load ROM-specific extraneous:**
```python
# Load ROM-specific extraneous IDs
extraneous_ids = set()
if args.levelsonly:
    # Try to load ROM-specific extraneous file
    rom_basename = os.path.splitext(os.path.basename(args.romfile))[0]
    extraneous_file = f"{rom_basename}_extraneous.txt"
    extraneous_ids = load_extraneous_ids(extraneous_file)
    
    if args.verbose and extraneous_ids:
        print(f"Loaded {len(extraneous_ids)} extraneous IDs from {extraneous_file}", file=sys.stderr)
```

---

## Updated Command-Line Arguments

```python
# Filtering options
parser.add_argument('--vanilla-rom', metavar='FILE',
                   help='Path to vanilla SMW ROM (for --editedonly level data comparison)')
parser.add_argument('--editedonly', action='store_true',
                   help='Only show levels where level DATA has been edited (not just names)')
parser.add_argument('--novanilla', action='store_true',
                   help='Filter out vanilla level names (uses hardcoded list)')
parser.add_argument('--withwords', action='store_true',
                   help='Only show level names containing English words')
parser.add_argument('--levelsonly', action='store_true',
                   help='Filter out message box text and extraneous content')
```

---

## File Dependencies

### Required Files:
1. **`vanilla_names.txt`** - Hardcoded vanilla level names (already created)
2. **`vanilla_extraneous.txt`** - Vanilla message box IDs (provided)
3. **`smw_lm2_extraneous.txt`** - ROM-specific extraneous (provided)
4. **`orig_Ako_extraneous.txt`** - ROM-specific extraneous (provided)

### Optional Files:
- **`smw.sfc`** or **`smw_clean.sfc`** - Vanilla SMW ROM (for --editedonly)
- **`{romname}_extraneous.txt`** - Per-ROM extraneous lists

---

## Testing Plan

### Test 1: --novanilla without vanilla ROM
```bash
# Should work without needing orig_lm333_noedits.sfc
python levelname_extractor_enhanced_v2_2025_10_28.py --romfile Akogare_lm333_edited.sfc --novanilla
```

**Expected:** Filters out vanilla names using hardcoded list

### Test 2: --editedonly with level data
```bash
# Requires vanilla SMW ROM
python levelname_extractor_enhanced_v2_2025_10_28.py --romfile Akogare_lm333_edited.sfc --editedonly --vanilla-rom smw.sfc
```

**Expected:** Shows only levels where actual level data changed

### Test 3: --levelsonly
```bash
# Filters message boxes
python levelname_extractor_enhanced_v2_2025_10_28.py --romfile orig_lm333_noedits.sfc --levelsonly
```

**Expected:** Excludes levels 0x060-0x0FF (message boxes), 0x100-0x108, 0x1DA+

### Test 4: Combined filters
```bash
python levelname_extractor_enhanced_v2_2025_10_28.py --romfile smw_lm2.sfc --novanilla --levelsonly --withwords
```

**Expected:** Only custom, non-extraneous, English names

---

## Implementation Priority

1. **High Priority:** `--novanilla` hardcoded names (easiest, most useful)
2. **Medium Priority:** `--levelsonly` filter (moderate complexity)
3. **Low Priority:** `--editedonly` level data comparison (complex, requires vanilla ROM)

---

## Notes

### Level Data Comparison Complexity
- SMW level data is compressed (format16/format17/format18)
- Pointer table location varies by ROM version
- Some ROMs have expanded level tables
- May need to handle dynamic repoints

### Alternative for --editedonly
If level data comparison is too complex, could fall back to:
- Compare level name + music + sprite set + other metadata
- Use "edited" flag if available in ROM
- Compare file sizes/timestamps (less reliable)

### Extraneous Text Detection
- Vanilla message boxes: 0x060-0x0FF range
- ROM hacks may use different ranges
- Per-ROM extraneous lists are the most reliable
- Could add heuristics (very short names, non-ASCII, etc.)

---

## Summary

This enhancement makes the script more autonomous and accurate:
- **--novanilla:** No longer needs vanilla ROM file
- **--editedonly:** Checks actual level data, not just names
- **--levelsonly:** Filters out message box garbage

All three features work together to provide clean, relevant level name extraction for ROM hack documentation and analysis.

