# Invictus Pointer Investigation - Final Report
**Date:** October 28, 2025  
**Question:** Where is the pointer to the dynamically-allocated level name data?

---

## Summary

**Finding:** No traditional 3-byte pointer to the level name data location was found.

**Level Name Location:** ROM `$2D6BDF` (SNES `$5AEBDF`)  
**Data Structure:** Inside a large RATS-tagged block  
**Pointer Status:** ❌ Not found in expected locations

---

## What We Found

### 1. Level Names Are in a Large RATS Block

**RATS Tag Location:** ROM `$2D4527`  
**RATS Data Starts:** ROM `$2D452D` (SNES `$5AC52D`)  
**RATS Block Size:** 65,102 bytes  
**Level Names Start:** 9,906 bytes into the block

This is a **huge data block** (63 KB!) that contains level names somewhere in the middle, not at the start.

### 2. No Pointer to Data Start

Searched for 3-byte pointer `2D C5 5A` (SNES `$5AC52D`):
- ❌ Not found anywhere in ROM
- ❌ Not at standard location `$03BB57`
- ❌ Not in ASM hijack code

### 3. No Pointer to Level Names Start

Searched for 3-byte pointer `DF EB 5A` (SNES `$5AEBDF`):
- ❌ Not found anywhere in ROM
- ❌ Not in ASM hijack code
- ❌ No references in disassembled code

### 4. Standard Pointer Location Contains Garbage

**ROM `$01BB57` (SNES `$03BB57`)** contains: `B9 EB DA`  
**Interprets as:** SNES `$DAEBB9` → ROM `$6D6BB9`  
**Status:** Points beyond ROM size (invalid)

---

## Possible Explanations

### Theory 1: Hardcoded Address in Code

The level name address might be **hardcoded directly in assembly instructions**, not stored as a data pointer.

Example:
```assembly
LDA #$5A      ; Load bank
PHA
PLB           ; Set data bank
LDX #$EBDF    ; Load offset
; ... read data from $5AEBDF
```

We didn't find this pattern in the hijack code we examined, but it could be:
- In a different routine
- Calculated dynamically
- In external code called by the hijack

### Theory 2: Calculated from Base + Offset

The location might be calculated:
```
Base address (in ROM somewhere) + 9906 bytes = Level names
```

We didn't find the base address either, but the calculation could happen in code.

### Theory 3: Different Lunar Magic Version Behavior

This **older or modified LM version** might:
- Not use the standard `$03BB57` pointer location
- Store level name location elsewhere
- Use a completely different mechanism
- Have the location hardcoded in the patch code itself

### Theory 4: Part of Larger Data Structure

The 65KB RATS block might be a **combined data structure** containing:
- Graphics data
- Palette data
- Level names (9906 bytes in)
- Other game data

The code might know to seek 9906 bytes into this block, but we can't find where that offset is stored.

---

## What We Know For Certain

### ✅ Confirmed Facts

1. **Level names ARE at ROM `$2D6BDF`**
   - Verified by pattern search
   - Successfully extracted 200+ names
   - Uses standard tile mapping with `$1F` as blank

2. **They're inside a RATS block**
   - RATS tag at `$2D4527`
   - Block is 65,102 bytes
   - Level names start 9,906 bytes into block

3. **No traditional pointer exists**
   - Not at `$03BB57` (standard location)
   - Not found anywhere in ROM via byte pattern search
   - Not in disassembled hijack code

4. **Location is ROM-specific**
   - RATS blocks are dynamically allocated by Lunar Magic
   - Different edits → different RATS placements
   - This ROM's level names ended up at `$2D6BDF`

---

## Implications for Tool Development

### Challenge

**Cannot reliably find level names** in other ROMs made with this LM version by:
- Reading pointer at `$03BB57` (invalid)
- Searching for RATS blocks (many false positives, correct one is huge)
- Following hijack code (address not found in simple disassembly)

### Solutions

#### Option 1: Pattern-Based Search (Current Solution)

Use `search_for_known_text.py` approach:
- If user has ANY known level names
- Search ROM for those names as tile bytes
- Find the actual location dynamically

**Pros:** Works reliably when you have known names  
**Cons:** Requires user input (known level names)

#### Option 2: Statistical + Validation

Use `analyze_lm_version.py` but with improvements:
1. Find all RATS blocks sized for level names
2. Score each location statistically
3. **Test top N candidates** (not just #1)
4. For each candidate, check:
   - Does it decode to readable text?
   - Does blank byte frequency match expected?
   - Are there common words ("THE", "CASTLE", etc.)?

**Pros:** Fully automatic  
**Cons:** May need to test many candidates

#### Option 3: Deep ASM Analysis

Fully disassemble and trace the hijack code:
1. Follow the JSR/JSL chains
2. Find where level data is actually read
3. Trace back to find the address source

**Pros:** Most thorough, would find the actual mechanism  
**Cons:** Complex, requires full 65816 disassembler

#### Option 4: Manual Database

Build a database of known LM versions:
- Version signature → level name location method
- For this version: "Search for known text patterns"
- For standard LM 3.33: "Use pointer at $03BB57"

**Pros:** Fast lookup once database is built  
**Cons:** Requires analyzing many LM versions

---

## Recommended Approach

### For Invictus and Similar ROMs

1. **Ask user for ANY known level names** (even 1-2 is enough)
2. **Run pattern search** to find actual location
3. **Extract from found location**

### For Tool Enhancement

Add to `levelname_extractor2.py`:

```python
--known-names file.txt        # Enables pattern search
--search-fallback             # Auto-try pattern search if pointer fails
--test-candidates N           # Test top N statistical candidates
```

**Workflow:**
```
1. Try standard pointer at $03BB57
   └─ If valid: extract normally
   └─ If invalid: ↓

2. If --known-names provided:
   └─ Pattern search for known names
   └─ Extract from found location

3. Else if --search-fallback:
   └─ Statistical analysis
   └─ Test top 5 candidates
   └─ Pick best scoring extraction

4. Else:
   └─ Report failure, suggest --known-names
```

---

## Technical Details

### RATS Block Structure

```
Offset $2D4527: RATS Tag
  53 54 41 52  ("STAR")
  XX XX        (Size: 65102 bytes inverted)

Offset $2D452D: Data Start
  [... 9906 bytes of unknown data ...]

Offset $2D6BDF: Level Names Start
  02 0B 00 14 12 13 11 0E 0F 07 0E 01 08 00 1F 1F 1F 1F 1F
  ("CLAUSTROPHOBIA" with 0x1F padding)
  
  [... more level names ...]
```

### Address Calculations

| Description | ROM Offset | SNES Address |
|-------------|------------|--------------|
| RATS Tag | `$2D4527` | `$5AC527` |
| Data Block Start | `$2D452D` | `$5AC52D` |
| Level Names Start | `$2D6BDF` | `$5AEBDF` |
| Offset into block | 9,906 bytes | - |

### Search Results

| Search Target | Bytes | Found? |
|---------------|-------|--------|
| Level name address | `DF EB 5A` | ❌ No |
| Data start address | `2D C5 5A` | ❌ No |
| RATS tag address | `27 C5 5A` | ❌ No |
| Level name offset | `DF EB` | ✅ Yes (19 times, but in data, not as pointer) |

---

## Conclusions

### Primary Conclusion

**The pointer to Invictus's level names does not exist as a traditional 3-byte SNES address stored in ROM.**

The level name location is likely:
- Hardcoded in assembly code, OR
- Calculated dynamically, OR
- Stored in a format we haven't identified yet

### Practical Conclusion

**For extracting level names from unknown-version LM ROMs:**

The most reliable method is **pattern-based search** using any known level names. This bypasses the need to find pointers entirely and works regardless of the LM version's internal structure.

### Development Conclusion

**For tool enhancement:**

Implement **multi-strategy extraction**:
1. Try standard pointer (works for LM 3.33+)
2. Try pattern search (works when known names provided)
3. Try statistical + validation (works as fallback)

This ensures maximum compatibility across all LM versions.

---

## Files Created During Investigation

1. `find_pointer_to_levelnames.py` - Comprehensive pointer search
2. `examine_levelname_region.py` - RATS block analysis
3. `find_rats_pointer.py` - Specific RATS pointer search
4. `disassemble_hijack.py` - ASM code analysis
5. `INVICTUS_POINTER_INVESTIGATION_20251028.md` - This document

---

## Final Answer

**Q: Where is the pointer to the dynamically-allocated level name data?**

**A: It doesn't exist as a traditional pointer in ROM.**

For Invictus 1.1:
- Level names are at ROM `$2D6BDF`
- No 3-byte pointer found anywhere
- Location appears to be hardcoded or calculated in code
- **Solution: Use pattern-based search with known level names**

This is why your insight about dynamic allocation was correct - Lunar Magic does allocate the space dynamically (via RATS), but this particular version doesn't store a discoverable pointer to that location. The location must be determined through other means (pattern search, statistical analysis, or deep code tracing).

---

**Investigation Status:** ✅ Complete  
**Pointer Found:** ❌ No  
**Alternative Solution:** ✅ Yes (pattern-based search)  
**Date:** October 28, 2025


