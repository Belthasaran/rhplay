# Lunar Magic Binary Analysis Guide
## How to Reverse Engineer LM's Level Name Discovery

---

## Problem Statement

**Goal**: Understand how Lunar Magic's executable code discovers relocated level name tables in ROM files.

**Why**: To achieve 100% automatic detection without requiring `--table-offset` for custom hacks.

**Current Status**: We've exhausted ROM-side analysis. The answer is in LM's binary code.

---

## What We Need to Find

### Primary Objectives

1. **File Open Routine**
   - How LM loads .sfc/.smc files
   - Where it reads table offset information
   - Whether it checks multiple locations

2. **Table Discovery Code**
   - The exact algorithm LM uses
   - Order of fallback locations
   - Validation/verification logic

3. **Metadata Storage**
   - .mwl/.mw2 file format
   - Where table offset is stored
   - How LM reads/writes this data

4. **RAT Tag Parsing**
   - RAT header format
   - Type codes (what marks "level names"?)
   - How to scan and interpret tags

---

## Binary Analysis Starting Points

### LM Binaries Available

```
refmaterial/Lunar_Magic_lm361/x64/lm.exe      - 64-bit version
refmaterial/Lunar_Magic_lm361/lm32.exe        - 32-bit version
```

Both are Windows PE executables. Use 32-bit version for simpler analysis.

### Tools Needed

**Disassembler/Decompiler**:
- Ghidra (FREE, recommended)
- IDA Pro (commercial)
- Binary Ninja (commercial)
- radare2/Cutter (FREE)

**String Analysis**:
- `strings` command (already used)
- PE Explorer
- CFF Explorer

**Debugger** (optional):
- x64dbg (for dynamic analysis)
- WinDbg
- OllyDbg (32-bit only)

---

## Entry Point 1: String-Based Search

### Known Strings in LM Binary

From our previous analysis, LM contains:

```
"Level Number (0-%X)"
"Level Number Too Large!"
"Choose a valid level number."
"Delete modified levels in the expanded area of the ROM."
"LMRELOC1"
```

### Search Strategy

1. **Find string references in Ghidra**
   ```
   Search > For Strings > "Level Number"
   Right-click > References > Show References to Address
   ```

2. **Trace backwards from string usage**
   - Find functions that reference these strings
   - These are likely level-related UI/logic code
   - Follow call graph upwards

3. **Look for error messages**
   ```
   "Unable to read level names"
   "Invalid table offset"
   "Level name table not found"
   ```
   
   Error paths often reveal the logic that failed.

---

## Entry Point 2: File I/O Functions

### Windows API Calls to Look For

LM must read the ROM file. Search for:

```c
CreateFileA/CreateFileW    - Opens files
ReadFile                   - Reads data
SetFilePointer            - Seeks to offsets
GetFileSize               - Checks file size
MapViewOfFile             - Memory-maps files
```

### Search Method in Ghidra

1. **Find API imports**
   ```
   Symbol Tree > Imports > KERNEL32.DLL
   Look for: CreateFileA, ReadFile, SetFilePointer
   ```

2. **Cross-reference analysis**
   ```
   Right-click on CreateFileA > Find References
   Identify ROM file open vs. other files (.mwl, .mw2)
   ```

3. **Trace file reads**
   - After CreateFileA, look for ReadFile calls
   - Check what offset is passed to SetFilePointer
   - If offset is 0x084E42, 0x084D3A, etc., you found it!

---

## Entry Point 3: Known Offset Constants

### Hexadecimal Constants to Search

In Ghidra's search, look for these as immediate values:

```
0x084E42    - LM 3.61 table offset
0x084D3A    - LM 2.53 table offset  
0x085000    - LM 2.40 table offset
0x010FEB    - Old pointer location
0x2E000     - Layer 1 pointer table (already found)
```

### Search Method

```
Search > For Scalars
Enter: 0x84E42
Check "All Fields"
```

If you find code like:
```c
if (file_offset == 0x084E42) {
    // Found LM 3.61 table
}
```

That's the discovery routine!

---

## Entry Point 4: The "STAR" Signature

### RAT Tag Search

Search for the ASCII bytes "STAR" (0x53544152):

```
Search > Memory
Pattern: 53 54 41 52
```

### What to Look For

Code that:
```c
while (scanning_rom) {
    if (memcmp(rom_data + offset, "STAR", 4) == 0) {
        // Parse RAT tag
        rat_type = read_dword(offset + 4);
        if (rat_type == LEVEL_NAMES_TYPE) {
            table_offset = offset + RAT_HEADER_SIZE;
            return table_offset;
        }
    }
    offset++;
}
```

---

## Entry Point 5: .mwl/.mw2 File Format

### Project File Analysis

LM stores project data in .mwl files. To understand:

1. **Create test project**
   ```
   - Open vanilla SMW in LM
   - Edit a level name
   - Save project as test.mwl
   - Hex dump the .mwl file
   ```

2. **Compare before/after**
   ```
   - Create two .mwl files with different table offsets
   - Diff them to find the offset field
   ```

3. **Search binary for .mwl parsing**
   ```
   Search for string: ".mwl"
   Find file open/read code
   Trace how data is parsed
   ```

### Expected .mwl Structure

Likely contains:
```
[Header]
- Magic number/signature
- Version
- ROM size
- Checksum

[Data Pointers]
- Level data offset
- Sprite data offset
- Level name table offset  <-- THIS IS WHAT WE NEED
- Graphics offset
- etc.
```

---

## Entry Point 6: UI Event Handlers

### "Open ROM" Button/Menu

When user clicks "File > Open", LM executes code to:
1. Show file dialog
2. Load ROM into memory
3. **Discover table locations** <-- This is what we want
4. Display level editor

### Finding the Open Handler

1. **Search for file dialog strings**
   ```
   "Select ROM File"
   "*.smc;*.sfc"
   "Open ROM"
   ```

2. **Find GetOpenFileName API call**
   ```
   Symbol Tree > Imports > COMDLG32.DLL
   Look for: GetOpenFileNameA
   ```

3. **Trace execution after file open**
   - After file is loaded, LM must discover tables
   - This is the key code path we need

---

## Ghidra Analysis Workflow

### Step-by-Step Guide

1. **Load Binary**
   ```
   File > Import File
   Select: lm32.exe
   Analyze: Yes (auto-analysis)
   Wait for analysis to complete
   ```

2. **Search for Known Offsets**
   ```
   Search > For Scalars > 0x84E42
   
   If found in code:
   - Double-click to jump to location
   - Press 'D' to disassemble
   - Press 'F' to create function
   - Right-click > Rename to "find_level_name_table"
   ```

3. **Analyze Function**
   ```
   Window > Decompiler
   Read the C-like pseudocode
   Look for:
   - if/else chains checking offsets
   - loops scanning memory
   - function calls to validation routines
   ```

4. **Trace Call Graph**
   ```
   Window > Function Call Graph
   See what calls find_level_name_table()
   See what it calls
   ```

5. **Add Comments**
   ```
   ; Comments help you understand
   Right-click > Add Comment
   Document what each section does
   ```

---

## Specific Code Patterns to Look For

### Pattern 1: Offset Array

```c
uint32_t known_offsets[] = {
    0x084E42,  // LM 3.61
    0x084D3A,  // LM 2.53
    0x085000,  // LM 2.40
};

for (int i = 0; i < 3; i++) {
    if (validate_table_at(rom, known_offsets[i])) {
        return known_offsets[i];
    }
}
```

### Pattern 2: Pointer Read

```c
// Read 3-byte pointer from ROM
uint32_t ptr_offset = 0x010FEB;
uint32_t table_addr = read_24bit(rom, ptr_offset);

// Convert SNES to file offset
uint32_t file_offset = snes_to_file(table_addr);

if (validate_table_at(rom, file_offset)) {
    return file_offset;
}
```

### Pattern 3: RAT Tag Scan

```c
for (uint32_t offset = 0x80000; offset < rom_size; offset++) {
    if (memcmp(rom + offset, "STAR", 4) == 0) {
        uint32_t rat_type = *(uint32_t*)(rom + offset + 4);
        
        // Check if this is a level name table RAT
        if (rat_type == 0x?????) {  // Unknown type code
            return offset + 8;  // Skip STAR + type
        }
    }
}
```

### Pattern 4: Validation Function

```c
bool validate_level_name_table(uint8_t* rom, uint32_t offset) {
    int valid_entries = 0;
    
    // Check first 10 entries
    for (int i = 0; i < 10; i++) {
        uint8_t* entry = rom + offset + (i * 24);
        
        // Count valid SMW characters
        int valid_chars = 0;
        for (int j = 0; j < 24; j++) {
            uint8_t c = entry[j] & 0x7F;
            if (is_valid_smw_char(c)) {
                valid_chars++;
            }
        }
        
        if (valid_chars >= 5) {
            valid_entries++;
        }
    }
    
    return (valid_entries >= 7);  // At least 7/10 entries look valid
}
```

---

## Dynamic Analysis Alternative

### Using a Debugger

If static analysis is too difficult, use dynamic debugging:

1. **Run LM in x64dbg**
   ```
   - Load lm32.exe in x64dbg
   - Set breakpoint on CreateFileA
   - Click "File > Open" in LM
   - Breakpoint hits
   - Step through code to see file reading
   ```

2. **Trace File Reads**
   ```
   - Set breakpoint on ReadFile
   - Watch the offset parameter
   - If offset = 0x084E42, you found it!
   - Trace back to see calling code
   ```

3. **Watch Memory**
   ```
   - Set memory breakpoint on ROM buffer
   - See when LM reads table data
   - Trace execution to find discovery code
   ```

---

## Questions to Answer

As you analyze, document:

1. **What is the EXACT discovery algorithm?**
   ```
   Step 1: ?
   Step 2: ?
   Step 3: ?
   ```

2. **Where are known offsets stored?**
   ```
   - Hardcoded array at address: 0x?
   - Read from file: ?
   - Both: ?
   ```

3. **What validation is used?**
   ```
   - Character frequency check?
   - Header signature check?
   - Entry count validation?
   ```

4. **Is there a RAT type code?**
   ```
   Type code for level names: 0x?
   RAT header format: ?
   ```

5. **How are .mwl files structured?**
   ```
   Offset of table pointer in .mwl: ?
   Field size: ?
   Endianness: ?
   ```

---

## Expected Results

### What Success Looks Like

After analysis, you should be able to:

1. **Replicate LM's algorithm**
   ```python
   def find_lm_level_name_table(rom_data):
       # Exact same logic as LM
       # 100% compatibility
       pass
   ```

2. **Parse RAT tags**
   ```python
   def parse_rat_tags(rom_data):
       for tag in find_star_tags(rom_data):
           if tag.type == LEVEL_NAMES:
               return tag.offset
   ```

3. **Read .mwl files**
   ```python
   def read_mwl_table_offset(mwl_path):
       # Extract table offset from project file
       pass
   ```

---

## Fallback: Community Resources

If binary analysis is too complex:

### Ask the Community

1. **SMW Central Forums**
   - Post in "SMW Hacking" section
   - Ask about LM's table discovery
   - Someone may have already analyzed this

2. **Lunar Magic Discord/IRC**
   - LM has an active community
   - Ask developers directly
   - May get official documentation

3. **GitHub/GitLab**
   - Search for "lunar magic" projects
   - Someone may have reverse-engineered this
   - Check for .mwl file parsers

---

## Prompt for AI/Future Investigation

```
I need help analyzing Lunar Magic (lm32.exe) to understand how it
discovers relocated level name tables in SMW ROM files.

Known facts:
- Standard table locations: 0x084E42 (LM 3.61), 0x084D3A (LM 2.53), 0x085000 (LM 2.40)
- Custom hacks can use different locations (e.g., 0x08EA1D)
- LM correctly finds all of these
- Standard pointer at 0x010FEB doesn't work for custom locations

Need to find:
1. LM's discovery algorithm
2. Whether it uses RAT tags (STAR signature)
3. How .mwl files store table offsets
4. Validation logic for table detection

Binary info:
- File: refmaterial/Lunar_Magic_lm361/lm32.exe
- Type: PE32 Windows executable
- Size: ~3MB

Starting points:
- Search for hex: 0x84E42, 0x84D3A, 0x85000
- Search for string: "STAR", "Level Number"
- Find: CreateFileA, ReadFile API calls
- Look for: .mwl file parsing code

Goal: Implement LM-compatible table discovery in Python
```

---

## Success Criteria

Reverse engineering is complete when we can:

✅ Replicate LM's discovery algorithm exactly  
✅ Auto-detect 100% of ROMs (including custom hacks)  
✅ Parse RAT tags programmatically  
✅ Read .mwl project files  
✅ Remove need for `--table-offset` flag  

**Estimated Effort**: 2-5 days of focused binary analysis

**Estimated Expertise**: Intermediate reverse engineering skills

**Tools Required**: Ghidra (free), patience, and persistence

---

## Documentation to Create

After completing analysis:

1. `LM_DISCOVERY_ALGORITHM.md` - The exact algorithm
2. `RAT_TAG_FORMAT.md` - RAT tag structure
3. `MWL_FILE_FORMAT.md` - Project file format
4. `smw_level_names.py` - Updated with 100% detection

This will be the definitive reference for LM's level name system.

